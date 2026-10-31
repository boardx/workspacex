-- Preserve historical Stripe passes while adding a durable WeChat Native identity.
ALTER TABLE billing_monthly_orders ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'stripe' CHECK(provider IN ('stripe','wechat'));
ALTER TABLE billing_monthly_orders ADD COLUMN IF NOT EXISTS checkout_url text;
ALTER TABLE billing_monthly_orders DROP CONSTRAINT IF EXISTS billing_monthly_orders_session_ref_check;
ALTER TABLE billing_monthly_orders DROP CONSTRAINT IF EXISTS billing_monthly_orders_payment_ref_check;
ALTER TABLE billing_monthly_orders ADD CONSTRAINT billing_monthly_orders_session_ref_check CHECK(session_ref IS NULL OR
 (provider='stripe' AND session_ref ~ '^cs_[A-Za-z0-9_]+$') OR (provider='wechat' AND session_ref ~ '^bm[0-9]{14}[A-Za-z0-9]{6}$'));
ALTER TABLE billing_monthly_orders ADD CONSTRAINT billing_monthly_orders_payment_ref_check CHECK(payment_ref IS NULL OR
 (provider='stripe' AND payment_ref ~ '^pi_[A-Za-z0-9_]+$') OR (provider='wechat' AND payment_ref ~ '^wx_[A-Za-z0-9_]+$'));
GRANT UPDATE(checkout_url) ON billing_monthly_orders TO app_rw;
