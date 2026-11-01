import {MONTHLY_SUBSCRIPTION_CREDITS} from "@repo/contracts/billing-subscription";
import type {TenantSession} from "../../application/ports/database.port";
import {creditDecimal, creditHundredths} from "../../application/billing/credit-consumption";
import {CREDIT_PERIOD_GRANT_SQL as SQL} from "./credit-period-sql";

type Period = {period_id: string; wallet_id: string; subscription_ref: string; invoice_ref: string; plan_ref: string;
  period_start: Date; period_end: Date; granted_hundredths: string; remaining_hundredths: string};
type PaidPeriod = {userId: string; subscriptionRef: string; invoiceRef: string; periodStart: Date; periodEnd: Date; planRef: string};
const monthlyHundredths = BigInt(MONTHLY_SUBSCRIPTION_CREDITS) * 100n;
const creditLimit = 214748364700n;

/** Caller holds the wallet lock. Expiration and financial audit commit together. */
export async function normalizeCreditPeriods(s: TenantSession, walletId: string, at: Date): Promise<void> {
  const periods = (await s.query<Pick<Period, "period_id" | "remaining_hundredths">>(
    SQL.periodDue, [walletId, at])).rows;
  for (const period of periods) {
    const remaining = BigInt(period.remaining_hundredths);
    if (remaining > 0n) {
      const wallet = (await s.query<{balance: string}>(SQL.periodExpireWallet, [walletId, creditDecimal(remaining)])).rows[0];
      if (!wallet) throw new Error("credit_wallet_missing");
      await s.query(SQL.periodExpireLedger, [walletId, creditDecimal(remaining), wallet.balance, period.period_id]);
    }
    await s.query(SQL.periodMarkExpired, [period.period_id, at]);
  }
}

/** Caller has authenticated a paid monthly invoice; this function never trusts browser state. */
export async function grantPaidSubscriptionPeriod(s: TenantSession, input: PaidPeriod, at: Date = new Date()): Promise<"granted" | "duplicate"> {
  const duration = input.periodEnd.getTime() - input.periodStart.getTime();
  if (!Number.isFinite(at.getTime()) || !Number.isFinite(duration) || duration < 27 * 86_400_000 || duration > 32 * 86_400_000 ||
    !input.userId || !input.subscriptionRef || !input.invoiceRef || !input.planRef) throw new Error("credit_period_invalid");
  // Advance events may be retried at the actual period start; never grant future credits early.
  if (input.periodStart > at) throw new Error("credit_period_not_started");
  await s.query(SQL.periodEnsureUserWallet, [input.userId]);
  const wallet = (await s.query<{wallet_id: string}>(SQL.periodLockUserWallet, [input.userId])).rows[0]!;
  await normalizeCreditPeriods(s, wallet.wallet_id, at);
  const existing = (await s.query<Period>(SQL.periodFindIdentity,
    [input.invoiceRef, wallet.wallet_id, input.subscriptionRef, input.periodStart, input.periodEnd])).rows;
  if (existing.length) {
    if (existing.length !== 1 || existing.some(row => row.wallet_id !== wallet.wallet_id || row.subscription_ref !== input.subscriptionRef ||
      row.plan_ref !== input.planRef || row.period_start.getTime() !== input.periodStart.getTime() || row.period_end.getTime() !== input.periodEnd.getTime() || BigInt(row.granted_hundredths) !== monthlyHundredths)) throw new Error("credit_period_replay_mismatch");
    return "duplicate";
  }
  const current = (await s.query<{balance: string; total_granted: number}>(SQL.periodWalletState, [wallet.wallet_id])).rows[0]!;
  const balance = creditHundredths(current.balance) + monthlyHundredths;
  if (balance > creditLimit || current.total_granted + MONTHLY_SUBSCRIPTION_CREDITS > 2147483647) throw new Error("credit_balance_unrepresentable");
  const row = (await s.query<{period_id: string}>(SQL.periodInsert, [wallet.wallet_id, input.subscriptionRef, input.invoiceRef, input.planRef, input.periodStart, input.periodEnd, monthlyHundredths.toString()])).rows[0]!;
  await s.query(SQL.periodGrantWallet, [wallet.wallet_id, creditDecimal(balance), MONTHLY_SUBSCRIPTION_CREDITS]);
  await s.query(SQL.periodGrantLedger, [wallet.wallet_id, creditDecimal(monthlyHundredths), creditDecimal(balance), row.period_id]);
  await normalizeCreditPeriods(s, wallet.wallet_id, at);
  return "granted";
}

/** Allocate only the newly billable debit; caller writes its unique consumption ledger and total balance in the same transaction. */
export async function allocateCreditDebit(s: TenantSession, input: {walletId: string; requestId: string; hundredths: bigint; at: Date}): Promise<void> {
  if (input.hundredths < 0n) throw new Error("invalid_credit_debit");
  let remaining = input.hundredths;
  const periods = (await s.query<Pick<Period, "period_id" | "remaining_hundredths">>(`SELECT period_id,remaining_hundredths::text FROM credit_subscription_periods
    WHERE wallet_id=$1 AND expired_at IS NULL AND period_start<=$2 AND period_end>$2 AND remaining_hundredths>0 ORDER BY period_end,period_id FOR UPDATE`, [input.walletId, input.at])).rows;
  for (const period of periods) {
    if (remaining === 0n) break;
    const available = BigInt(period.remaining_hundredths), debit = available < remaining ? available : remaining;
    await s.query("UPDATE credit_subscription_periods SET remaining_hundredths=remaining_hundredths-$2 WHERE period_id=$1", [period.period_id, debit.toString()]);
    await s.query("INSERT INTO credit_subscription_allocations(request_id,period_id,hundredths) VALUES($1,$2,$3)", [input.requestId, period.period_id, debit.toString()]);
    remaining -= debit;
  }
}

/** Read after normalization under the wallet lock; expiry is not dependent on a background job. */
export async function creditPeriodSnapshot(s: TenantSession, walletId: string): Promise<{hundredths: bigint; expiresAt: string | null}> {
  const row = (await s.query<{hundredths: string; expires_at: Date | null}>(`SELECT COALESCE(sum(remaining_hundredths),0)::text AS hundredths,
    min(period_end) AS expires_at FROM credit_subscription_periods WHERE wallet_id=$1 AND expired_at IS NULL`, [walletId])).rows[0]!;
  return {hundredths: BigInt(row.hundredths), expiresAt: row.expires_at?.toISOString() ?? null};
}
