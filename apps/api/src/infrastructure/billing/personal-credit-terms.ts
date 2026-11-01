import { PERSONAL_PRICE_CATALOG, PERSONAL_PRICE_CATALOG_VERSION } from "../../domain/billing/personal-price-catalog";
import { creditMonthBoundary, paidCreditWindows } from "../../domain/billing/personal-credit-calendar";
import type { TenantSession } from "../../application/ports/database.port";
import { CREDIT_PERIOD_GRANT_SQL } from "./credit-period-sql";
import { grantPaidSubscriptionPeriod, normalizeCreditPeriods } from "./pg-credit-periods";
import { PERSONAL_CREDIT_TERM_SQL as SQL } from "./personal-credit-term-sql";

/** Internal input: only an authenticated provider receipt bound to a server order may supply it. */
export type VerifiedPersonalPayment = {
  userId: string; provider: "wechat" | "stripe"; paymentRef: string; subscriptionRef: string;
  sku: string; currency: string; amountMinor: number; purchaseAnchor: Date; monthOffset: number; periodStart: Date; periodEnd: Date;
};
type TermRow = { term_id: string; user_id: string; provider: string; payment_ref: string; subscription_ref: string;
  catalog_version: string; sku: string; billing_cycle: "month" | "year"; currency: string; amount_minor: string;
  purchase_anchor: Date; month_offset: number; period_start: Date; period_end: Date };
type ExistingWindow = { invoice_ref: string; subscription_ref: string; plan_ref: string; period_start: Date; period_end: Date; granted_hundredths: string };
const windowKey = (subscription: string, start: Date, end: Date) => JSON.stringify([subscription, start.toISOString(), end.toISOString()]);
function productFor(input: VerifiedPersonalPayment, at: Date) {
  const product = [...PERSONAL_PRICE_CATALOG.cn, ...PERSONAL_PRICE_CATALOG.us].find(item => item.sku === input.sku);
  if (!product || product.kind !== "subscription" || product.currency !== input.currency || product.amountMinor !== input.amountMinor ||
    !["wechat", "stripe"].includes(input.provider) || input.provider === "wechat" && input.currency !== "CNY" ||
    [input.userId, input.paymentRef, input.subscriptionRef].some(value => typeof value !== "string" || !value || value.length > 255)) throw new Error("personal_term_invalid");
  if (!Number.isFinite(at.getTime()) || !Number.isSafeInteger(input.monthOffset) || input.monthOffset < 0 ||
    creditMonthBoundary(input.purchaseAnchor, input.monthOffset).getTime() !== input.periodStart.getTime() ||
    creditMonthBoundary(input.purchaseAnchor, input.monthOffset + (product.cycle === "year" ? 12 : 1)).getTime() !== input.periodEnd.getTime()) throw new Error("personal_term_invalid");
  if (input.periodStart > at) throw new Error("personal_term_not_started");
  return product;
}
function matches(row: TermRow, input: VerifiedPersonalPayment): boolean {
  return row.user_id === input.userId && row.subscription_ref === input.subscriptionRef && row.sku === input.sku &&
    row.catalog_version === PERSONAL_PRICE_CATALOG_VERSION && row.currency === input.currency && Number(row.amount_minor) === input.amountMinor &&
    row.purchase_anchor.getTime() === input.purchaseAnchor.getTime() && row.month_offset === input.monthOffset &&
    row.period_start.getTime() === input.periodStart.getTime() && row.period_end.getTime() === input.periodEnd.getTime();
}
/** Caller provides a transaction. This boundary verifies immutable money/term snapshots, never a browser return. */
export async function recordPaidPersonalTerm(s: TenantSession, input: VerifiedPersonalPayment, at: Date = new Date()): Promise<void> {
  const product = productFor(input, at);
  await s.query(SQL.personalTermUserLock, [`personal-subscription:${input.provider}:${input.subscriptionRef}`]);
  await s.query(SQL.personalTermUserLock, [`billing-subscription:${input.userId}`]);
  let row = (await s.query<TermRow>(SQL.personalTermPayment, [input.provider, input.paymentRef])).rows[0];
  if (row && !matches(row, input)) throw new Error("personal_term_replay_mismatch");
  const bindings = (await s.query<Pick<TermRow,"user_id"|"purchase_anchor">>(SQL.personalTermSubscription,[input.provider,input.subscriptionRef])).rows;
  if (bindings.some(row => row.user_id !== input.userId || row.purchase_anchor.getTime() !== input.purchaseAnchor.getTime())) throw new Error("personal_term_subscription_mismatch");
  if (!row) {
    if ((await s.query(SQL.personalTermOverlap, [input.userId, input.periodStart, input.periodEnd])).rows.length) throw new Error("personal_term_overlap");
    await s.query(SQL.personalTermInsert, [input.userId, input.provider, input.paymentRef, input.subscriptionRef, PERSONAL_PRICE_CATALOG_VERSION,
      input.sku, product.cycle, input.currency, input.amountMinor, input.purchaseAnchor, input.monthOffset, input.periodStart, input.periodEnd]);
    row = (await s.query<TermRow>(SQL.personalTermPayment, [input.provider, input.paymentRef])).rows[0];
  }
  if (!row || !matches(row, input)) throw new Error("personal_term_replay_mismatch");
  await grantDuePersonalTerms(s, input.userId, at);
}
/** Scheduler and authenticated owner reads share this transaction function; future windows are excluded. */
export async function grantDuePersonalTerms(s: TenantSession, userId: string, at: Date = new Date()): Promise<void> {
  if (!userId || !Number.isFinite(at.getTime())) throw new Error("personal_term_invalid");
  await s.query(SQL.personalTermUserLock, [`billing-subscription:${userId}`]);
  const terms = (await s.query<TermRow>(SQL.personalTermsOwner, [userId])).rows;
  if (!terms.length) return;
  const wallet = (await s.query<{wallet_id:string}>(CREDIT_PERIOD_GRANT_SQL.periodLockUserWallet,[userId])).rows[0];
  if(wallet) await normalizeCreditPeriods(s,wallet.wallet_id,at);
  const existing = (await s.query<ExistingWindow>(SQL.personalTermWindows,[userId])).rows;
  const byInvoice = new Map(existing.map(row=>[row.invoice_ref,row]));
  const byWindow = new Map(existing.map(row=>[windowKey(row.subscription_ref,row.period_start,row.period_end),row]));
  for (const term of terms) {
    // Revalidate persisted terms before any financial write; malformed configuration must fail closed.
    const input: VerifiedPersonalPayment = { userId, provider: term.provider as VerifiedPersonalPayment["provider"], paymentRef: term.payment_ref,
      subscriptionRef: term.subscription_ref, sku: term.sku, currency: term.currency, amountMinor: Number(term.amount_minor), purchaseAnchor: term.purchase_anchor, monthOffset: term.month_offset, periodStart: term.period_start, periodEnd: term.period_end };
    const product = productFor(input, at);
    if (term.catalog_version !== PERSONAL_PRICE_CATALOG_VERSION || product.cycle !== term.billing_cycle) throw new Error("personal_term_invalid");
    for (const window of paidCreditWindows(term.purchase_anchor, term.billing_cycle, at, term.month_offset)) {
      const invoiceRef = `term:${term.term_id}:${window.index}`;
      const prior = byInvoice.get(invoiceRef) ?? byWindow.get(windowKey(term.subscription_ref,window.start,window.end));
      if(prior) {
        if(prior.subscription_ref !== term.subscription_ref || prior.plan_ref !== term.sku ||
          prior.period_start.getTime() !== window.start.getTime() || prior.period_end.getTime() !== window.end.getTime() ||
          BigInt(prior.granted_hundredths) !== BigInt(product.monthlyCredits)*100n) throw new Error("credit_period_replay_mismatch");
        continue;
      }
      await grantPaidSubscriptionPeriod(s, { userId, subscriptionRef: term.subscription_ref, invoiceRef,
        planRef: term.sku, periodStart: window.start, periodEnd: window.end }, at);
    }
  }
}
