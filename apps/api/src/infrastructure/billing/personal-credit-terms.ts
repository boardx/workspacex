import {PricingProduct} from "@repo/contracts/billing-pricing";
import {readProductConfiguration,personalConfiguredProducts} from "./product-catalog-configuration";
import {BILLING_ACCOUNTING_GENERATION} from "../../domain/billing/billing-generation";
import { creditMonthBoundary, paidCreditWindows, paidCreditMonthCount } from "../../domain/billing/personal-credit-calendar";
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
  monthly_credits:number; next_check_at: Date | null; purchase_anchor: Date; month_offset: number; period_start: Date; period_end: Date };
type ExistingWindow = { invoice_ref: string; subscription_ref: string; plan_ref: string; period_start: Date; period_end: Date; granted_hundredths: string };
const windowKey = (subscription: string, start: Date, end: Date) => JSON.stringify([subscription, start.toISOString(), end.toISOString()]);
type FrozenProduct={product:unknown;catalog_version:string|null};
function productFor(input: VerifiedPersonalPayment, at: Date, snapshot:FrozenProduct) {
  const parsed=PricingProduct.safeParse(snapshot.product);
  const product=parsed.success?parsed.data:null;
  if (!snapshot.catalog_version || !product || product.sku!==input.sku || product.kind !== "subscription" || product.currency !== input.currency || product.amountMinor !== input.amountMinor ||
    !["wechat", "stripe"].includes(input.provider) || input.provider === "wechat" && input.currency !== "CNY" ||
    [input.userId, input.paymentRef, input.subscriptionRef].some(value => typeof value !== "string" || !value || value.length > 255)) throw new Error("personal_term_invalid");
  if (!Number.isFinite(at.getTime()) || !Number.isSafeInteger(input.monthOffset) || input.monthOffset < 0 ||
    creditMonthBoundary(input.purchaseAnchor, input.monthOffset).getTime() !== input.periodStart.getTime() ||
    creditMonthBoundary(input.purchaseAnchor, input.monthOffset + paidCreditMonthCount(product.cycle)).getTime() !== input.periodEnd.getTime()) throw new Error("personal_term_invalid");
  if (input.periodStart > at) throw new Error("personal_term_not_started");
  return product;
}
function matches(row: TermRow, input: VerifiedPersonalPayment,version:string): boolean {
  return row.user_id === input.userId && row.subscription_ref === input.subscriptionRef && row.sku === input.sku &&
    row.catalog_version === version && row.currency === input.currency && Number(row.amount_minor) === input.amountMinor &&
    row.purchase_anchor.getTime() === input.purchaseAnchor.getTime() && row.month_offset === input.monthOffset &&
    row.period_start.getTime() === input.periodStart.getTime() && row.period_end.getTime() === input.periodEnd.getTime();
}
function termProduct(row:TermRow):FrozenProduct {
 return {catalog_version:row.catalog_version,product:{sku:row.sku,kind:"subscription",currency:row.currency,amountMinor:Number(row.amount_minor),cycle:row.billing_cycle,monthlyCredits:row.monthly_credits}};
}
async function trustedProduct(s:TenantSession,input:VerifiedPersonalPayment):Promise<FrozenProduct>{
 const paid=(await s.query<FrozenProduct>(SQL.personalTermPriceSnapshot,[input.provider,input.paymentRef,input.userId,BILLING_ACCOUNTING_GENERATION])).rows[0];
 if(paid)return paid;
 // Existing trusted internal receipt callers have no browser entry point. Freeze configuration once;
 // public checkout settlement always takes the durable purchase branch above.
 if(input.currency!=="CNY"&&input.currency!=="USD")throw Error("personal_term_invalid");
 const configured=await readProductConfiguration(s,input.currency==="CNY"?"cn":"us");
 return {catalog_version:configured.version,product:personalConfiguredProducts(configured.rows).find(p=>p.sku===input.sku)};
}
/** Caller provides a transaction. This boundary verifies immutable money/term snapshots, never a browser return. */
export async function recordPaidPersonalTerm(s: TenantSession, input: VerifiedPersonalPayment, at: Date = new Date()): Promise<void> {
  await s.query(SQL.personalTermUserLock, [`personal-subscription:${input.provider}:${input.subscriptionRef}`]);
  await s.query(SQL.personalTermUserLock, [`billing-subscription:${input.userId}`]);
  let row = (await s.query<TermRow>(SQL.personalTermPayment, [input.provider, input.paymentRef])).rows[0];
  const snapshot=row?termProduct(row):await trustedProduct(s,input);
  if (row && !matches(row,input,row.catalog_version)) throw new Error("personal_term_replay_mismatch");
  const product=productFor(input,at,snapshot);
  const bindings = (await s.query<Pick<TermRow,"user_id"|"purchase_anchor">>(SQL.personalTermSubscription,[input.provider,input.subscriptionRef])).rows;
  if (bindings.some(row => row.user_id !== input.userId || row.purchase_anchor.getTime() !== input.purchaseAnchor.getTime())) throw new Error("personal_term_subscription_mismatch");
  if (!row) {
    if ((await s.query(SQL.personalTermOverlap, [input.userId, input.periodStart, input.periodEnd])).rows.length) throw new Error("personal_term_overlap");
    await s.query(SQL.personalTermInsert, [input.userId, input.provider, input.paymentRef, input.subscriptionRef, snapshot.catalog_version,
      input.sku, product.cycle, input.currency, input.amountMinor, input.purchaseAnchor, input.monthOffset, input.periodStart, input.periodEnd,product.monthlyCredits]);
    row = (await s.query<TermRow>(SQL.personalTermPayment, [input.provider, input.paymentRef])).rows[0];
  }
  if (!row || !matches(row, input,snapshot.catalog_version!)) throw new Error("personal_term_replay_mismatch");
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
    const product = productFor(input, at,termProduct(term));
    if (product.cycle !== term.billing_cycle) throw new Error("personal_term_invalid");
    const windows=paidCreditWindows(term.purchase_anchor, term.billing_cycle, at, term.month_offset);
    for (const window of windows) {
      const invoiceRef = `term:${term.term_id}:${window.index}`;
      const prior = byInvoice.get(invoiceRef) ?? byWindow.get(windowKey(term.subscription_ref,window.start,window.end));
      if(prior) {
        if(prior.subscription_ref !== term.subscription_ref || prior.plan_ref !== term.sku ||
          prior.period_start.getTime() !== window.start.getTime() || prior.period_end.getTime() !== window.end.getTime() ||
          BigInt(prior.granted_hundredths) !== BigInt(product.monthlyCredits)*100n) throw new Error("credit_period_replay_mismatch");
        continue;
      }
      await grantPaidSubscriptionPeriod(s, { userId, subscriptionRef: term.subscription_ref, invoiceRef,
        planRef: term.sku, periodStart: window.start, periodEnd: window.end,credits:product.monthlyCredits }, at);
    }
    const total=paidCreditMonthCount(term.billing_cycle);
    const next = windows.length < total ? creditMonthBoundary(term.purchase_anchor,term.month_offset+windows.length)
      : term.period_end > at ? term.period_end : null;
    if((term.next_check_at?.getTime() ?? null) !== (next?.getTime() ?? null)) await s.query(SQL.personalTermNextCheck,[term.term_id,next]);
  }
}
