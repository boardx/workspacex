/** Closed owner-global billing statements; public callers never supply SQL or owners. */
export const PERSONAL_CHECKOUT_SQL = Object.freeze({
  pricingEpochLock: "SELECT pg_advisory_xact_lock_shared(hashtextextended($1,0))",
  pricingEpoch: "SELECT generation,activated_at<=clock_timestamp() AS active FROM billing_pricing_epoch WHERE singleton=true",
  personalPurchaseUserLock: "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
  personalPurchaseByKey: "SELECT * FROM billing_personal_purchases WHERE user_id=$1 AND idempotency_key=$2",
  personalPurchaseOwnerLock: "SELECT * FROM billing_personal_purchases WHERE user_id=$1 AND purchase_ref=$2 FOR UPDATE",
  personalPurchaseActiveTerm: "SELECT 1 FROM billing_personal_terms WHERE user_id=$1 AND period_start<=now() AND period_end>now() LIMIT 1",
  personalPurchaseRenewingStripe: `SELECT 1 FROM billing_personal_stripe_bindings b JOIN billing_personal_purchases p USING(purchase_ref)
    WHERE p.user_id=$1 AND b.status NOT IN ('canceled','incomplete_expired') LIMIT 1`,
  personalPurchaseBoundStripeSession: "SELECT session_ref FROM billing_personal_stripe_bindings WHERE purchase_ref=$1",
  personalPurchaseClose: "UPDATE billing_personal_purchases SET closed_at=COALESCE(closed_at,clock_timestamp()) WHERE purchase_ref=$1 AND fulfilled_at IS NULL AND NOT payment_review_required",
  personalPurchaseOpenPro: "SELECT * FROM billing_personal_purchases WHERE user_id=$1 AND product->>'kind'='subscription' AND fulfilled_at IS NULL AND closed_at IS NULL",
  personalPurchaseInsert: `INSERT INTO billing_personal_purchases(purchase_ref,user_id,idempotency_key,generation,catalog_version,provider,product)
    VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING *`,
  personalPurchaseBind: "UPDATE billing_personal_purchases SET session_ref=$3,payment_url=$4,expires_at=$5 WHERE user_id=$1 AND purchase_ref=$2 RETURNING *",
});
