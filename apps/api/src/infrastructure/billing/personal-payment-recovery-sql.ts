export const PERSONAL_PAYMENT_RECOVERY_SQL = Object.freeze({
  recoveryPending: `SELECT * FROM billing_personal_purchases WHERE generation=$1 AND fulfilled_at IS NULL AND closed_at IS NULL
    AND NOT payment_review_required AND recovery_next_check_at<=clock_timestamp()
    AND ($2::text IS NULL OR purchase_ref>$2) ORDER BY purchase_ref LIMIT $3`,
  recoveryBindings: `SELECT p.*,b.subscription_ref,b.invoice_cursor FROM billing_personal_stripe_bindings b
    JOIN billing_personal_purchases p USING(purchase_ref) WHERE p.generation=$1 AND b.next_check_at<=clock_timestamp()
    AND ($2::text IS NULL OR b.subscription_ref>$2) ORDER BY b.subscription_ref LIMIT $3`,
  recoveryPendingHint: `UPDATE billing_personal_purchases SET recovery_next_check_at=clock_timestamp()+$2::bigint*interval '1 millisecond',
    recovery_attempts=CASE WHEN $3::text IS NULL THEN 0 ELSE LEAST(recovery_attempts+1,1000) END,
    recovery_error=$3,payment_review_required=payment_review_required OR $4
    WHERE purchase_ref=$1 AND fulfilled_at IS NULL AND closed_at IS NULL AND NOT payment_review_required`,
  recoveryBindingHint: `UPDATE billing_personal_stripe_bindings SET invoice_cursor=$3,
    next_check_at=clock_timestamp()+(CASE WHEN $3::text IS NOT NULL OR $7::boolean THEN $4::bigint
      WHEN status IN ('canceled','incomplete_expired') THEN $6::bigint ELSE $5::bigint END)*interval '1 millisecond'
    WHERE subscription_ref=$1 AND invoice_cursor IS NOT DISTINCT FROM $2::text`,
});
