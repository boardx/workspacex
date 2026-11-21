CREATE TABLE IF NOT EXISTS billing_product_catalog_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id text NOT NULL,
 market text NOT NULL CHECK (market IN ('cn', 'us')),
 sku text NOT NULL,
 old_value jsonb NOT NULL,
 new_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE billing_product_catalog_changes IS 'kernel-no-tenant-data: append-only global storefront product edits; actor, market and nonsecret product data.';
GRANT INSERT ON billing_product_catalog_changes TO app_billing_tariff_writer;
GRANT UPDATE (amount_fen,base_credits,bonus_credits,bonus_rate,total_credits,enabled,included_seats,extra_seat_amount_fen,extra_seat_monthly_credits)
 ON credit_packages TO app_billing_tariff_writer;
