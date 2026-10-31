export const STRIPE_CREDIT_SQL={
 ownerLock:"SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
 pending:"SELECT * FROM billing_orders WHERE owner_type=$1 AND owner_id=$2 AND provider='stripe' AND status IN ('PENDING','PROCESSING') ORDER BY created_at LIMIT 1 FOR UPDATE",
 reserve:`INSERT INTO billing_orders(order_no,owner_type,owner_id,created_by,package_id,amount_fen,base_credits,bonus_credits,currency,provider,status,qr_code_url,created_at,expired_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'stripe','PENDING','pending',$10,$11) RETURNING *`,
 bind:"UPDATE billing_orders SET stripe_session_ref=$2,qr_code_url=$3 WHERE order_no=$1 AND provider='stripe' AND (stripe_session_ref IS NULL OR stripe_session_ref=$2)",
 session:"SELECT * FROM billing_orders WHERE stripe_session_ref=$1 AND provider='stripe' FOR UPDATE",
 paymentOwner:"SELECT order_no FROM billing_orders WHERE provider='stripe' AND channel_order_no=$1 AND order_no<>$2",
 close:"UPDATE billing_orders SET status='CLOSED',closed_at=now() WHERE order_no=$1 AND provider='stripe' AND status='PENDING'",
} as const;
