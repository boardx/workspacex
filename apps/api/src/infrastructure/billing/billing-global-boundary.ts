import {MONTHLY_PASS_SQL} from "./monthly-pass-sql";
import {CREDIT_PERIOD_GRANT_SQL} from "./credit-period-sql";
/** Single-source global billing statements for verified receipts, Stripe subscription synchronization and order expiry. No caller-supplied SQL is admitted. */
export const BILLING_GLOBAL_SQL = Object.freeze({
  ...CREDIT_PERIOD_GRANT_SQL,
  ...MONTHLY_PASS_SQL,
  stripeEventLock: "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
  stripeUserLock: "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
  stripeIntentOwner: "SELECT user_id FROM billing_purchase_intents WHERE intent_hash=$1",
  stripeBindingOwner: "SELECT user_id,customer_ref FROM billing_stripe_bindings WHERE subscription_ref=$1",
  stripeApply: "SELECT billing_apply_stripe_event($1,$2,$3,$4,$5::jsonb,$6) AS result",
  closeExpiredOrders: `WITH due AS (
    SELECT order_no FROM billing_orders
    WHERE status='PENDING' AND created_at<=now()-interval '15 minutes' AND expired_at<=now()
    ORDER BY expired_at,order_no LIMIT 100 FOR UPDATE SKIP LOCKED
  ) UPDATE billing_orders o SET status='CLOSED',closed_at=now()
    FROM due WHERE o.order_no=due.order_no AND o.status='PENDING' RETURNING o.order_no`,
  transactionOwner: "SELECT order_no FROM billing_orders WHERE provider='wechat' AND channel_order_no=$1 AND order_no<>$2",
  bindClosedOrder: "UPDATE billing_orders SET channel_order_no=$2 WHERE order_no=$1",
  lockOrder: "SELECT * FROM billing_orders WHERE order_no=$1 FOR UPDATE",
  insertReceipt: `INSERT INTO billing_payment_receipts(provider_event_id,order_no,app_id,mch_id,amount_fen,currency,transaction_id,trade_state,paid_at,receipt_hash,signature_verified)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(provider_event_id) DO NOTHING`,
  lockReceipt: "SELECT * FROM billing_payment_receipts WHERE provider_event_id=$1 FOR UPDATE",
  captureClosure: "UPDATE billing_payment_receipts SET previous_closed_at=COALESCE(previous_closed_at,$2) WHERE provider_event_id=$1",
  claimOrder: "UPDATE billing_orders SET status='PROCESSING',channel_order_no=$2 WHERE order_no=$1",
  insertEvent: "INSERT INTO billing_webhook_events(provider,provider_event_id,order_no,signature_verified,result) VALUES('wechat',$1,$2,$4,$3) ON CONFLICT(provider_event_id) DO NOTHING",
  readEvent: "SELECT provider,order_no,signature_verified,result FROM billing_webhook_events WHERE provider_event_id=$1",
  finishReceipt: "UPDATE billing_payment_receipts SET state=$2,processed_at=now(),last_error=NULL WHERE provider_event_id=$1",
  tryLockReceipt: "SELECT * FROM billing_payment_receipts WHERE provider_event_id=$1 FOR UPDATE SKIP LOCKED",
  ensureWallet: "INSERT INTO credit_wallets(owner_type,owner_id) VALUES($1,$2) ON CONFLICT(owner_type,owner_id) DO NOTHING",
  lockWallet: "SELECT wallet_id,balance,total_purchased FROM credit_wallets WHERE owner_type=$1 AND owner_id=$2 FOR UPDATE",
  failCapacity: "UPDATE billing_orders SET status='FAILED',last_error_code='invalid_amount',last_error_message='wallet_limit_manual_recovery' WHERE order_no=$1",
  // CLOSED may transition only to SUCCESS. Preserve closure while marking paid
  // funds for durable manual recovery; this code also prevents cashier repayment.
  markClosedCapacity: "UPDATE billing_orders SET last_error_code='invalid_amount',last_error_message='wallet_limit_manual_recovery' WHERE order_no=$1 AND status='CLOSED'",
  bindRecovery: "UPDATE billing_payment_receipts SET recovery_source_id=$2 WHERE provider_event_id=$1",
  purchaseLedger: "INSERT INTO credit_transactions(wallet_id,type,credits,balance_after,source_type,source_id) VALUES($1,'purchase',$2,$3,'payment_order',$4)",
  bonusLedger: "INSERT INTO credit_transactions(wallet_id,type,credits,balance_after,source_type,source_id) VALUES($1,'bonus',$2,$3,'payment_order',$4)",
  updateWallet: "UPDATE credit_wallets SET balance=balance+$2,total_purchased=total_purchased+$3,updated_at=now() WHERE wallet_id=$1",
  succeedOrder: "UPDATE billing_orders SET status='SUCCESS',channel_order_no=$2,paid_at=$3,notify_at=now(),closed_at=NULL,last_error_code=NULL,last_error_message=NULL WHERE order_no=$1",
  deferReceipt: "UPDATE billing_payment_receipts SET attempts=attempts+1,retry_at=now()+LEAST(300,5*(attempts+1))*interval '1 second',last_error=$2 WHERE provider_event_id=$1 AND state='pending'",
  dueReceipts: "SELECT provider_event_id FROM billing_payment_receipts WHERE state='pending' AND retry_at<=now() ORDER BY retry_at,received_at LIMIT 10",
  rejectEvent: "INSERT INTO billing_webhook_events(provider,provider_event_id,order_no,signature_verified,result) VALUES('wechat',$1,$2,$3,'rejected')"
});
const allowed = new Set<string>(Object.values(BILLING_GLOBAL_SQL));
export function assertBillingGlobalStatement(sql: string): void {
  if (!allowed.has(sql)) throw new Error("billing_global_sql_outside_boundary");
}
