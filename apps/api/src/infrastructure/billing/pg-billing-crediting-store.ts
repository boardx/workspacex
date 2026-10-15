import { randomUUID } from "node:crypto";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import { PaymentNoticeError, type BillingCreditingStore, type CreditingResult, type VerifiedPaymentReceipt } from "../../application/billing/billing-notify-ports";
import { assertBillingGlobalStatement } from "./billing-global-boundary";
type Receipt = { provider_event_id: string; order_no: string; amount_fen: number; currency: string; transaction_id: string | null; trade_state: string; paid_at: Date | null; receipt_hash: string; state: string };
type Order = { order_no: string; owner_type: string; owner_id: string; status: string; amount_fen: number; currency: string; base_credits: number; bonus_credits: number; channel_order_no: string | null; closed_at: Date | null };
const pending: CreditingResult = { completed: false, manual: false };
function result(state: string): CreditingResult { return { completed: state !== "pending", manual: state === "failed" }; }
/** Only verified owner-global billing facts cross this shared-pool boundary. */
export class PgBillingCreditingStore implements BillingCreditingStore {
  constructor(private readonly db: DatabasePort) {}
  private transaction<T>(fn: (s: TenantSession) => Promise<T>): Promise<T> {
    return this.db.withoutTenant(async session => {
      await session.query("SET LOCAL statement_timeout = '2000ms'");
      await session.query("SET LOCAL lock_timeout = '750ms'");
      return fn({ query: (sql, params) => { assertBillingGlobalStatement(sql); return session.query(sql, params); } });
    });
  }
  private async order(s: TenantSession, receipt: Receipt): Promise<Order> {
    const order = (await s.query<Order>("SELECT * FROM billing_orders WHERE order_no=$1 FOR UPDATE", [receipt.order_no])).rows[0];
    if (!order || order.amount_fen !== receipt.amount_fen || order.currency !== receipt.currency ||
        (order.channel_order_no !== null && order.channel_order_no !== receipt.transaction_id))
      throw new PaymentNoticeError("order_mismatch", true, receipt.order_no);
    return order;
  }
  async accept(r: VerifiedPaymentReceipt): Promise<CreditingResult> {
    return this.transaction(async s => {
      await s.query(`INSERT INTO billing_payment_receipts(provider_event_id,order_no,app_id,mch_id,amount_fen,currency,transaction_id,trade_state,paid_at,receipt_hash,signature_verified)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true) ON CONFLICT(provider_event_id) DO NOTHING`,
      [r.providerEventId,r.orderNo,r.appId,r.mchId,r.amountFen,r.currency,r.transactionId,r.tradeState,r.paidAt,r.receiptHash]);
      const receipt = (await s.query<Receipt>("SELECT * FROM billing_payment_receipts WHERE provider_event_id=$1 FOR UPDATE", [r.providerEventId])).rows[0]!;
      if (receipt.receipt_hash !== r.receiptHash) throw new PaymentNoticeError("receipt_conflict", true, r.orderNo);
      const order = await this.order(s, receipt);
      if (receipt.state !== "pending") return result(receipt.state);
      if (r.tradeState === "SUCCESS") {
        await s.query("UPDATE billing_payment_receipts SET previous_closed_at=COALESCE(previous_closed_at,$2) WHERE provider_event_id=$1", [r.providerEventId, order.closed_at]);
        if (order.status === "PENDING") await s.query("UPDATE billing_orders SET status='PROCESSING',channel_order_no=$2,notify_at=now() WHERE order_no=$1", [r.orderNo,r.transactionId]);
      }
      return pending;
    });
  }
  private async event(s: TenantSession, r: Receipt, outcome: string) {
    await s.query("INSERT INTO billing_webhook_events(provider,provider_event_id,order_no,signature_verified,result) VALUES('wechat',$1,$2,true,$3) ON CONFLICT(provider_event_id) DO NOTHING", [r.provider_event_id,r.order_no,outcome]);
    const existing = (await s.query<{provider: string; order_no: string; signature_verified: boolean; result: string}>("SELECT provider,order_no,signature_verified,result FROM billing_webhook_events WHERE provider_event_id=$1", [r.provider_event_id])).rows[0];
    if (!existing || existing.provider !== "wechat" || existing.order_no !== r.order_no || !existing.signature_verified || existing.result !== outcome) throw new PaymentNoticeError("event_conflict",true,r.order_no);
  }
  private async finish(s: TenantSession, r: Receipt, state: string, outcome: string) {
    await this.event(s,r,outcome);
    await s.query("UPDATE billing_payment_receipts SET state=$2,processed_at=now(),last_error=NULL WHERE provider_event_id=$1", [r.provider_event_id,state]);
    return result(state);
  }
  async processOne(id: string): Promise<CreditingResult> {
    try {
      return await this.transaction(async s => {
        const r = (await s.query<Receipt>("SELECT * FROM billing_payment_receipts WHERE provider_event_id=$1 FOR UPDATE SKIP LOCKED", [id])).rows[0];
        if (!r) return pending;
        if (r.state !== "pending") return result(r.state);
        const o = await this.order(s,r);
        if (r.trade_state !== "SUCCESS") return this.finish(s,r,"ignored","ignored");
        if (o.status === "SUCCESS") return this.finish(s,r,"done","ok");
        if (o.status === "FAILED") return this.finish(s,r,"failed","rejected");
        if (o.status !== "PROCESSING" && o.status !== "CLOSED") throw new Error("payment_order_not_claimed");
        await s.query("INSERT INTO credit_wallets(owner_type,owner_id) VALUES($1,$2) ON CONFLICT(owner_type,owner_id) DO NOTHING", [o.owner_type,o.owner_id]);
        const w = (await s.query<{wallet_id: string; balance: number; total_purchased: number}>("SELECT wallet_id,balance,total_purchased FROM credit_wallets WHERE owner_type=$1 AND owner_id=$2 FOR UPDATE", [o.owner_type,o.owner_id])).rows[0]!;
        const total = o.base_credits + o.bonus_credits;
        if (w.balance + total > 2147483647 || w.total_purchased + o.base_credits > 2147483647) {
          if (o.status === "CLOSED") throw new Error("late_payment_wallet_limit");
          await s.query("UPDATE billing_orders SET status='FAILED',last_error_code='crediting_failed',last_error_message='wallet_limit_manual_recovery',notify_at=now() WHERE order_no=$1", [o.order_no]);
          await s.query("UPDATE billing_payment_receipts SET recovery_source_id=$2 WHERE provider_event_id=$1", [id,`payment-recovery:${o.order_no}`]);
          return this.finish(s,r,"failed","rejected");
        }
        await s.query("INSERT INTO credit_transactions(wallet_id,type,credits,balance_after,source_type,source_id) VALUES($1,'purchase',$2,$3,'payment_order',$4)", [w.wallet_id,o.base_credits,w.balance+o.base_credits,o.order_no]);
        if (o.bonus_credits > 0) await s.query("INSERT INTO credit_transactions(wallet_id,type,credits,balance_after,source_type,source_id) VALUES($1,'bonus',$2,$3,'payment_order',$4)", [w.wallet_id,o.bonus_credits,w.balance+total,o.order_no]);
        await s.query("UPDATE credit_wallets SET balance=balance+$2,total_purchased=total_purchased+$3,updated_at=now() WHERE wallet_id=$1", [w.wallet_id,total,o.base_credits]);
        await s.query("UPDATE billing_orders SET status='SUCCESS',channel_order_no=$2,paid_at=$3,notify_at=now(),closed_at=NULL,last_error_code=NULL,last_error_message=NULL WHERE order_no=$1", [o.order_no,r.transaction_id,r.paid_at]);
        return this.finish(s,r,"done","ok");
      });
    } catch (error) {
      if (error instanceof PaymentNoticeError) throw error;
      // A connection loss can mean an unknown COMMIT outcome. Conditional retry must
      // never overwrite a terminal receipt or turn a transient failure into FAILED.
      try { await this.transaction(s => s.query("UPDATE billing_payment_receipts SET attempts=attempts+1,retry_at=now()+LEAST(300,5*(attempts+1))*interval '1 second',last_error='crediting_retry' WHERE provider_event_id=$1 AND state='pending'", [id])); } catch { /* Durable pending receipt remains recoverable after DB recovery. */ }
      return pending;
    }
  }
  async due(): Promise<string[]> {
    return this.transaction(async s => (await s.query<{provider_event_id: string}>("SELECT provider_event_id FROM billing_payment_receipts WHERE state='pending' AND retry_at<=now() ORDER BY retry_at,received_at LIMIT 10")).rows.map(r => r.provider_event_id));
  }
  async auditRejection(signatureVerified: boolean, orderNo: string | null): Promise<void> {
    await this.transaction(s => s.query("INSERT INTO billing_webhook_events(provider,provider_event_id,order_no,signature_verified,result) VALUES('wechat',$1,$2,$3,'rejected')", [`security:wechat:${randomUUID()}`,orderNo,signatureVerified]));
  }
}
