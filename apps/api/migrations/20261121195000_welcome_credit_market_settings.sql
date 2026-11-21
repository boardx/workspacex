CREATE TABLE IF NOT EXISTS welcome_credit_market_settings (
 market text PRIMARY KEY CHECK (market IN ('cn', 'us')),
 credits integer NOT NULL CHECK (credits BETWEEN 1 AND 2147483647),
 validity_days integer NOT NULL CHECK (validity_days BETWEEN 1 AND 3650),
 revision uuid NOT NULL DEFAULT gen_random_uuid()
);
INSERT INTO welcome_credit_market_settings(market,credits,validity_days)
 VALUES ('cn',1000,30),('us',1000,30) ON CONFLICT (market) DO NOTHING;

CREATE TABLE IF NOT EXISTS welcome_credit_market_changes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 actor_id text NOT NULL,
 market text NOT NULL REFERENCES welcome_credit_market_settings(market),
 previous jsonb NOT NULL,
 current_value jsonb NOT NULL,
 changed_at timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE welcome_credit_market_settings IS 'kernel-no-tenant-data: current nonsecret signup credit rule by market.';
COMMENT ON TABLE welcome_credit_market_changes IS 'kernel-no-tenant-data: append-only operator audit for signup credit rules.';
GRANT SELECT ON welcome_credit_market_settings TO app_rw, app_billing_tariff_writer;
GRANT UPDATE (credits, validity_days, revision) ON welcome_credit_market_settings TO app_billing_tariff_writer;
GRANT INSERT ON welcome_credit_market_changes TO app_billing_tariff_writer;

CREATE OR REPLACE FUNCTION billing_new_account_welcome() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $welcome$
DECLARE
  epoch billing_pricing_epoch%ROWTYPE;
  wallet credit_wallets%ROWTYPE;
  policy welcome_credit_market_settings%ROWTYPE;
  issued_at timestamptz;
  batch_id uuid;
  granted_balance credit_wallets.balance%TYPE;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('workspacex.billing.pricing-epoch',0));
  SELECT * INTO epoch FROM billing_pricing_epoch WHERE singleton=true;
  IF NOT FOUND THEN RAISE EXCEPTION 'billing_pricing_epoch_missing'; END IF;
  IF epoch.generation IS NULL THEN RETURN NEW; END IF;
  IF epoch.generation<>'billing-credits-2026-11-v1' THEN RAISE EXCEPTION 'billing_pricing_epoch_mismatch'; END IF;
  IF epoch.activated_at>clock_timestamp() OR NEW.created_at<epoch.activated_at THEN RETURN NEW; END IF;
  SELECT * INTO STRICT policy FROM welcome_credit_market_settings
    WHERE market=COALESCE(NULLIF(current_setting('app.billing_market',true),''),'cn');
  INSERT INTO credit_wallets(owner_type,owner_id) VALUES('user',NEW.user_id) ON CONFLICT(owner_type,owner_id) DO NOTHING;
  SELECT * INTO wallet FROM credit_wallets WHERE owner_type='user' AND owner_id=NEW.user_id FOR UPDATE;
  IF EXISTS(SELECT 1 FROM credit_subscription_periods WHERE wallet_id=wallet.wallet_id AND source_kind='welcome') THEN RETURN NEW; END IF;
  issued_at:=date_trunc('milliseconds',clock_timestamp());
  INSERT INTO credit_subscription_periods(wallet_id,subscription_ref,invoice_ref,plan_ref,period_start,period_end,granted_hundredths,remaining_hundredths,source_kind)
    VALUES(wallet.wallet_id,'welcome:'||NEW.user_id,'welcome:'||NEW.user_id,'welcome-credit-v1',issued_at,issued_at+policy.validity_days::bigint*86400000*interval '1 millisecond',policy.credits::bigint*100,policy.credits::bigint*100,'welcome') RETURNING period_id INTO batch_id;
  UPDATE credit_wallets SET balance=balance+policy.credits,total_granted=total_granted+policy.credits,updated_at=now()
    WHERE wallet_id=wallet.wallet_id AND balance+policy.credits<=2147483647 AND total_granted+policy.credits<=2147483647 RETURNING balance INTO granted_balance;
  IF NOT FOUND THEN RAISE EXCEPTION 'credit_balance_unrepresentable'; END IF;
  INSERT INTO credit_transactions(wallet_id,type,direction,credits,balance_after,source_type,source_id)
    VALUES(wallet.wallet_id,'welcome_grant',1,policy.credits,granted_balance,'welcome_period',batch_id::text);
  RETURN NEW;
END;
$welcome$;
