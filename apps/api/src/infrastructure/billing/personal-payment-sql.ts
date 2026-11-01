export const PERSONAL_PAYMENT_SQL = Object.freeze({
  personalPurchaseRef: "SELECT * FROM billing_personal_purchases WHERE purchase_ref=$1",
  personalPurchaseRefLock: "SELECT * FROM billing_personal_purchases WHERE purchase_ref=$1 FOR UPDATE",
  personalReceiptLock: "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
  personalReceiptFind: "SELECT * FROM billing_personal_payment_receipts WHERE provider=$1 AND payment_ref=$2",
  personalReceiptInsert: `INSERT INTO billing_personal_payment_receipts(provider,payment_ref,purchase_ref,amount_minor,currency,paid_at)
    VALUES($1,$2,$3,$4,$5,$6)`,
  personalReceiptManual: "UPDATE billing_personal_payment_receipts SET manual_review=true,manual_reason=$3 WHERE provider=$1 AND payment_ref=$2",
  personalPurchaseReview: "UPDATE billing_personal_purchases SET payment_review_required=true WHERE purchase_ref=$1",
  personalPurchaseFulfilled: "UPDATE billing_personal_purchases SET fulfilled_at=COALESCE(fulfilled_at,clock_timestamp()) WHERE purchase_ref=$1",
  personalStripeBinding: "SELECT * FROM billing_personal_stripe_bindings WHERE subscription_ref=$1 OR purchase_ref=$2",
  personalStripeCustomerOwner: `SELECT p.user_id FROM billing_personal_stripe_bindings b JOIN billing_personal_purchases p USING(purchase_ref)
    WHERE b.customer_ref=$1 AND p.user_id<>$2 LIMIT 1`,
  personalStripeBind: `INSERT INTO billing_personal_stripe_bindings(subscription_ref,purchase_ref,session_ref,customer_ref,price_ref,purchase_anchor,status,cancel_at_period_end,next_check_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  personalStripeSnapshot: "UPDATE billing_personal_stripe_bindings SET status=$2,cancel_at_period_end=$3,snapshot_at=clock_timestamp(),next_check_at=$4 WHERE subscription_ref=$1",
  personalGrantSavepoint: "SAVEPOINT personal_payment_grant",
  personalGrantRollback: "ROLLBACK TO SAVEPOINT personal_payment_grant",
  personalGrantRelease: "RELEASE SAVEPOINT personal_payment_grant",
  personalPackLedger: `INSERT INTO credit_transactions(wallet_id,type,direction,credits,balance_after,source_type,source_id)
    VALUES($1,'purchase',1,$2,$3,'payment_order',$4)`,
  personalPackWallet: "UPDATE credit_wallets SET balance=$2,total_purchased=total_purchased+$3,updated_at=now() WHERE wallet_id=$1",
});
