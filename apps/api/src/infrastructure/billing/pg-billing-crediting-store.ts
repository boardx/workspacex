import { ConsoleLogger } from "../logging/console-logger";
import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { PaymentNoticeError, type BillingCreditingStore, type CreditingResult, type VerifiedPaymentReceipt } from "../../application/billing/billing-notify-ports";
import { assertBillingGlobalStatement, BILLING_GLOBAL_SQL } from "./billing-global-boundary";
type Receipt = { provider_event_id: string; order_no: string; amount_fen: number; currency: string; transaction_id: string | null; trade_state: string; paid_at: Date | null; receipt_hash: string; signature_verified: boolean; state: string };
type Order = { order_no: string; owner_type: string; owner_id: string; status: string; amount_fen: number; currency: string; base_credits: number; bonus_credits: number; channel_order_no: string | null; closed_at: Date | null; last_error_code: string | null };
const pending: CreditingResult = { completed: false, manual: false };
function result(state: string): CreditingResult { return { completed: state !== "pending", manual: state === "failed" }; }
/** Only verified owner-global billing facts cross this shared-pool boundary. */
export class PgBillingCreditingStore implements BillingCreditingStore {
  private readonly logger = new ConsoleLogger();
  constructor(private readonly db: DatabasePort) {}
  private transaction<T>(fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.db.withoutTenant(async session => {
      await session.query("SET LOCAL statement_timeout = '2000ms'");
      await session.query("SET LOCAL lock_timeout = '750ms'");
      return fn({ query: (sql, params) => { assertBillingGlobalStatement(sql); return session.query(sql, params); } });
    });
  }
  private async order(s: TenantSession, receipt: Receipt): Promise<Order> {
    const order = (await s.query<Order>(BILLING_GLOBAL_SQL.lockOrder, [receipt.order_no])).rows[0];
    if (!order || order.amount_fen !== receipt.amount_fen || order.currency !== receipt.currency ||
        (order.channel_order_no !== null && order.channel_order_no !== receipt.transaction_id))
      throw new PaymentNoticeError("order_mismatch", receipt.signature_verified, receipt.order_no);
    return order;
  }
  async accept(r: VerifiedPaymentReceipt): Promise<CreditingResult> {
    return this.transaction(async s => {
      await s.query(BILLING_GLOBAL_SQL.insertReceipt,
      [r.providerEventId,r.orderNo,r.appId,r.mchId,r.amountFen,r.currency,r.transactionId,r.tradeState,r.paidAt,r.receiptHash,r.signatureVerified]);
      const receipt = (await s.query<Receipt>(BILLING_GLOBAL_SQL.lockReceipt, [r.providerEventId])).rows[0]!;
      if (receipt.receipt_hash !== r.receiptHash) throw new PaymentNoticeError("receipt_conflict", r.signatureVerified, r.orderNo);
      const order = await this.order(s, receipt);
      if (receipt.state !== "pending") return result(receipt.state);
      if (r.tradeState === "SUCCESS") {
        const bound = await s.query<{order_no: string}>(BILLING_GLOBAL_SQL.transactionOwner, [r.transactionId,r.orderNo]);
        if (bound.rows.length) throw new PaymentNoticeError("transaction_conflict",r.signatureVerified,r.orderNo);
        // The unique index arbitrates races after this diagnostic read. A racing
        // unique violation rolls acceptance back and receives 503, never a false ACK.
        if (order.status === "CLOSED") await s.query(BILLING_GLOBAL_SQL.bindClosedOrder, [r.orderNo,r.transactionId]);
        await s.query(BILLING_GLOBAL_SQL.captureClosure, [r.providerEventId, order.closed_at]);
        if (order.status === "PENDING") await s.query(BILLING_GLOBAL_SQL.claimOrder, [r.orderNo,r.transactionId]);
      }
      return pending;
    });
  }
  private async event(s: TenantSession, r: Receipt, outcome: string) {
    await s.query(BILLING_GLOBAL_SQL.insertEvent, [r.provider_event_id,r.order_no,outcome,r.signature_verified]);
    const existing = (await s.query<{provider: string; order_no: string; signature_verified: boolean; result: string}>(BILLING_GLOBAL_SQL.readEvent, [r.provider_event_id])).rows[0];
    if (!existing || existing.provider !== "wechat" || existing.order_no !== r.order_no || existing.signature_verified !== r.signature_verified || existing.result !== outcome) throw new PaymentNoticeError("event_conflict",r.signature_verified,r.order_no);
  }
  private async finish(s: TenantSession, r: Receipt, state: string, outcome: string) {
    await this.event(s,r,outcome);
    await s.query(BILLING_GLOBAL_SQL.finishReceipt, [r.provider_event_id,state]);
    return result(state);
  }
  private async manualRecovery(s: TenantSession, r: Receipt) {
    await s.query(BILLING_GLOBAL_SQL.bindRecovery, [r.provider_event_id,`payment-recovery:${r.order_no}`]);
    return this.finish(s,r,"failed","rejected");
  }
  async processOne(id: string): Promise<CreditingResult> {
    try {
      return await this.transaction(async s => {
        const r = (await s.query<Receipt>(BILLING_GLOBAL_SQL.tryLockReceipt, [id])).rows[0];
        if (!r) return pending;
        if (r.state !== "pending") return result(r.state);
        const o = await this.order(s,r);
        if (r.trade_state !== "SUCCESS") return this.finish(s,r,"ignored","ignored");
        if (o.status === "SUCCESS") return this.finish(s,r,"done","ok");
        // A distinct provider event must not reopen automatic crediting after a
        // paid order has been delegated to manual capacity recovery. Reuse the
        // same recovery identity even if wallet capacity has since changed.
        if ((o.status === "CLOSED" || o.status === "FAILED") && o.last_error_code === "invalid_amount") return this.manualRecovery(s,r);
        if (o.status === "FAILED") return this.finish(s,r,"failed","rejected");
        if (o.status !== "PROCESSING" && o.status !== "CLOSED") throw new Error("payment_order_not_claimed");
        await s.query(BILLING_GLOBAL_SQL.ensureWallet, [o.owner_type,o.owner_id]);
        const w = (await s.query<{wallet_id: string; balance: number; total_purchased: number}>(BILLING_GLOBAL_SQL.lockWallet, [o.owner_type,o.owner_id])).rows[0]!;
        const total = o.base_credits + o.bonus_credits;
        if (w.balance + total > 2147483647 || w.total_purchased + o.base_credits > 2147483647) {
          this.logger.info("billing_payment_manual_recovery", { traceId: id, orderNo: o.order_no, reason: "wallet_limit" });
          await s.query(o.status === "CLOSED" ? BILLING_GLOBAL_SQL.markClosedCapacity : BILLING_GLOBAL_SQL.failCapacity, [o.order_no]);
          return this.manualRecovery(s,r);
        }
        await s.query(BILLING_GLOBAL_SQL.purchaseLedger, [w.wallet_id,o.base_credits,w.balance+o.base_credits,o.order_no]);
        if (o.bonus_credits > 0) await s.query(BILLING_GLOBAL_SQL.bonusLedger, [w.wallet_id,o.bonus_credits,w.balance+total,o.order_no]);
        await s.query(BILLING_GLOBAL_SQL.updateWallet, [w.wallet_id,total,o.base_credits]);
        if (o.status === "CLOSED") this.logger.info("billing_late_paid_order", { traceId: id, orderNo: o.order_no });
        await s.query(BILLING_GLOBAL_SQL.succeedOrder, [o.order_no,r.transaction_id,r.paid_at]);
        return this.finish(s,r,"done","ok");
      });
    } catch (error) {
      const code = error instanceof PaymentNoticeError ? error.reason : typeof error === "object" && error !== null && "code" in error ? String(error.code) : "unknown";
      this.logger.error("billing_receipt_recovery_required", { traceId: id, err: { providerEventId: id, code } });
      // A connection loss can mean an unknown COMMIT outcome. Conditional retry must
      // never overwrite a terminal receipt or turn a transient failure into FAILED.
      try { await this.transaction(s => s.query(BILLING_GLOBAL_SQL.deferReceipt, [id,error instanceof PaymentNoticeError ? error.reason : "crediting_retry"])); } catch { /* Durable pending receipt remains recoverable after DB recovery. */ }
      if (error instanceof PaymentNoticeError) throw error;
      return pending;
    }
  }
  async due(): Promise<string[]> {
    return this.transaction(async s => (await s.query<{provider_event_id: string}>(BILLING_GLOBAL_SQL.dueReceipts)).rows.map(r => r.provider_event_id));
  }
  async auditRejection(signatureVerified: boolean, orderNo: string | null): Promise<void> {
    await this.transaction(s => s.query(BILLING_GLOBAL_SQL.rejectEvent, [`security:wechat:${randomUUID()}`,orderNo,signatureVerified]));
  }
}
