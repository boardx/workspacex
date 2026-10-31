ALTER TABLE billing_orders DROP CONSTRAINT billing_orders_provider_check;
ALTER TABLE billing_orders ADD CONSTRAINT billing_orders_provider_check CHECK(provider IN ('wechat','stripe'));
ALTER TABLE billing_orders ADD COLUMN stripe_session_ref text CHECK(stripe_session_ref IS NULL OR (provider='stripe' AND stripe_session_ref ~ '^cs_[A-Za-z0-9_]+$'));
CREATE UNIQUE INDEX billing_orders_stripe_session_unique ON billing_orders(stripe_session_ref) WHERE stripe_session_ref IS NOT NULL;
CREATE UNIQUE INDEX billing_orders_stripe_payment_unique ON billing_orders(channel_order_no) WHERE provider='stripe' AND channel_order_no IS NOT NULL;

GRANT UPDATE(stripe_session_ref,qr_code_url) ON billing_orders TO app_rw;
