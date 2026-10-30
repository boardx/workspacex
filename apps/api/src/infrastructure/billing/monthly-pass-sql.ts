/** Closed owner-global statements; webhook recovery never admits tenant-content SQL. */
export const MONTHLY_PASS_SQL=Object.freeze({
 latest:`SELECT o.*,COALESCE(p.remaining_hundredths,0)::text AS remaining_hundredths FROM billing_monthly_orders o
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
