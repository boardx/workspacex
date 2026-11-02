/** Closed statements for trusted settlement and owner-scoped credit reconciliation. */
export const PERSONAL_CREDIT_TERM_SQL = Object.freeze({
  personalTermUserLock: "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
  personalTermPriceSnapshot: `SELECT p.product,p.catalog_version FROM billing_personal_payment_receipts r
    JOIN billing_personal_purchases p ON p.purchase_ref=r.purchase_ref
    WHERE r.provider=$1 AND r.payment_ref=$2 AND p.provider=r.provider AND p.user_id=$3 AND p.generation=$4`,
  personalTermPayment: "SELECT * FROM billing_personal_terms WHERE provider=$1 AND payment_ref=$2",
  personalTermSubscription: "SELECT user_id,purchase_anchor FROM billing_personal_terms WHERE provider=$1 AND subscription_ref=$2",
  personalTermOverlap: "SELECT 1 FROM billing_personal_terms WHERE user_id=$1 AND period_start<$3 AND period_end>$2 LIMIT 1",
  personalTermInsert: `INSERT INTO billing_personal_terms(user_id,provider,payment_ref,subscription_ref,catalog_version,sku,billing_cycle,currency,amount_minor,purchase_anchor,month_offset,period_start,period_end,monthly_credits)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(provider,payment_ref) DO NOTHING`,
  personalTermWindows: `SELECT p.invoice_ref,p.subscription_ref,p.plan_ref,p.period_start,p.period_end,p.granted_hundredths::text
    FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id) WHERE w.owner_type='user' AND w.owner_id=$1`,
  personalTermNextCheck: "UPDATE billing_personal_terms SET next_check_at=$2 WHERE term_id=$1 AND next_check_at IS DISTINCT FROM $2",
  personalTermDueOwners: `SELECT user_id FROM (
    SELECT user_id FROM billing_personal_terms WHERE next_check_at<=now()
    UNION SELECT w.owner_id AS user_id FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id)
      WHERE w.owner_type='user' AND p.source_kind='welcome' AND p.expired_at IS NULL AND p.period_end<=now()
    ) due WHERE ($1::text IS NULL OR user_id>$1) ORDER BY user_id LIMIT $2`,
  personalTermsOwner: "SELECT * FROM billing_personal_terms WHERE user_id=$1 ORDER BY period_start,term_id",
});
