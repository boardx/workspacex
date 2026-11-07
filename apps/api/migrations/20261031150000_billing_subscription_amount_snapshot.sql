-- Historical prices are unknown unless captured from a verified payment; never backfill with today's price.
ALTER TABLE billing_monthly_orders ADD COLUMN IF NOT EXISTS amount_minor bigint;
ALTER TABLE billing_monthly_orders ADD COLUMN IF NOT EXISTS currency text;
DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='billing_monthly_orders'::regclass AND conname='billing_monthly_orders_amount_snapshot_check') THEN
ALTER TABLE billing_monthly_orders ADD CONSTRAINT billing_monthly_orders_amount_snapshot_check CHECK (
 (amount_minor IS NULL AND currency IS NULL) OR
 (amount_minor IS NOT NULL AND amount_minor>=0 AND amount_minor<=9007199254740991 AND currency IS NOT NULL AND currency ~ '^[A-Z]{3}$')
);
END IF;
END $$;
GRANT UPDATE(amount_minor,currency) ON billing_monthly_orders TO app_rw;
