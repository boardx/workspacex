/** Closed owner-global statements; webhook recovery never admits tenant-content SQL. */
export const MONTHLY_PASS_SQL=Object.freeze({
 conflict:"SELECT 1 FROM billing_payment_conflicts WHERE conflict_key=$1 AND resolved_at IS NULL",
 userConflict:"SELECT 1 FROM billing_payment_conflicts WHERE user_id=$1 AND resolved_at IS NULL LIMIT 1",
 recordConflict:"INSERT INTO billing_payment_conflicts(conflict_key,user_id,provider_ref,other_ref) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
 legacyActive:"SELECT subscription_ref FROM billing_subscriptions WHERE user_id=$1 AND (synchronization_uncertain OR (status NOT IN ('canceled','incomplete_expired') AND (NOT cancel_at_period_end OR current_period_end IS NULL OR current_period_end>now()))) UNION ALL SELECT b.subscription_ref FROM billing_stripe_bindings b WHERE b.user_id=$1 AND b.synchronization_uncertain AND b.binding_generation>=COALESCE((SELECT binding_generation FROM billing_subscriptions WHERE user_id=$1),0)",
 latest:`SELECT o.*,COALESCE(p.remaining_hundredths,0)::text AS remaining_hundredths,
 EXISTS(SELECT 1 FROM billing_payment_conflicts c WHERE c.user_id=o.user_id AND c.resolved_at IS NULL) AS requires_review FROM billing_monthly_orders o
 LEFT JOIN credit_subscription_periods p ON p.invoice_ref=o.payment_ref WHERE o.user_id=$1 ORDER BY o.created_at DESC,o.order_id DESC LIMIT 1`,
 pending:"SELECT * FROM billing_monthly_orders WHERE user_id=$1 AND state='pending' FOR UPDATE",
 active:"SELECT 1 FROM billing_monthly_orders WHERE user_id=$1 AND state='paid' AND period_end>now() LIMIT 1",
 insert:"INSERT INTO billing_monthly_orders(order_id,user_id) VALUES($1,$2) RETURNING *",
 owner:"SELECT user_id FROM billing_monthly_orders WHERE order_id=$1",
 lock:"SELECT * FROM billing_monthly_orders WHERE order_id=$1 FOR UPDATE",
 bind:"UPDATE billing_monthly_orders SET session_ref=$3 WHERE order_id=$1 AND user_id=$2 AND state='pending' AND (session_ref IS NULL OR session_ref=$3) RETURNING order_id",
 expire:"UPDATE billing_monthly_orders SET state='expired' WHERE order_id=$1 AND user_id=$2 AND session_ref=$3 AND state='pending'",
 paid:"UPDATE billing_monthly_orders SET state='paid',payment_ref=$2,period_start=$3,period_end=$4 WHERE order_id=$1",
});
