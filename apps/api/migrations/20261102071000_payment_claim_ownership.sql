-- One provider receipt identity can never fund both personal and Team accounts.
CREATE TABLE IF NOT EXISTS billing_payment_claims (
 provider text NOT NULL,payment_ref text NOT NULL,owner_type text NOT NULL CHECK(owner_type IN ('user','team')),
 owner_id text NOT NULL,purchase_ref text NOT NULL,PRIMARY KEY(provider,payment_ref)
);
REVOKE ALL ON billing_payment_claims FROM PUBLIC,app_rw;
-- Replaying the migration validates every existing claim rather than overwriting its owner.
CREATE OR REPLACE FUNCTION billing_register_paid_claim(p_provider text,p_ref text,p_type text,p_owner text,p_purchase text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $register$
DECLARE previous billing_payment_claims%ROWTYPE;
BEGIN
 IF p_provider IS NULL OR p_ref IS NULL OR p_owner IS NULL OR p_purchase IS NULL THEN RAISE EXCEPTION 'payment_claim_owner_missing';END IF;
 INSERT INTO billing_payment_claims(provider,payment_ref,owner_type,owner_id,purchase_ref) VALUES(p_provider,p_ref,p_type,p_owner,p_purchase) ON CONFLICT DO NOTHING;
 SELECT * INTO previous FROM billing_payment_claims WHERE provider=p_provider AND payment_ref=p_ref;
 IF previous.owner_type<>p_type OR previous.owner_id<>p_owner OR previous.purchase_ref<>p_purchase THEN RAISE EXCEPTION 'payment_claim_owner_conflict';END IF;
END;
$register$;
REVOKE ALL ON FUNCTION billing_register_paid_claim(text,text,text,text,text) FROM PUBLIC,app_rw;
CREATE OR REPLACE FUNCTION billing_claim_payment_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $claim$
DECLARE expected_type text; expected_owner text; previous billing_payment_claims%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='billing_personal_payment_receipts' THEN
  expected_type:='user';
  SELECT user_id INTO expected_owner FROM billing_personal_purchases WHERE purchase_ref=NEW.purchase_ref;
 ELSIF TG_TABLE_NAME='billing_team_receipts' THEN
  expected_type:='team';expected_owner:=billing_team_purchase_org(NEW.purchase_ref);
  IF NEW.org_id IS DISTINCT FROM expected_owner THEN RAISE EXCEPTION 'payment_claim_owner_conflict';END IF;
 ELSE RAISE EXCEPTION 'payment_claim_source_invalid';
 END IF;
 IF expected_owner IS NULL THEN RAISE EXCEPTION 'payment_claim_owner_missing';END IF;
 PERFORM billing_register_paid_claim(NEW.provider,NEW.payment_ref,expected_type,expected_owner,NEW.purchase_ref);
 RETURN NEW;
END;
$claim$;
REVOKE ALL ON FUNCTION billing_claim_payment_owner() FROM PUBLIC,app_rw;
DROP TRIGGER IF EXISTS billing_personal_payment_claim ON billing_personal_payment_receipts;
CREATE TRIGGER billing_personal_payment_claim BEFORE INSERT ON billing_personal_payment_receipts FOR EACH ROW EXECUTE FUNCTION billing_claim_payment_owner();
DROP TRIGGER IF EXISTS billing_team_payment_claim ON billing_team_receipts;
CREATE TRIGGER billing_team_payment_claim BEFORE INSERT ON billing_team_receipts FOR EACH ROW EXECUTE FUNCTION billing_claim_payment_owner();
INSERT INTO billing_payment_claims(provider,payment_ref,owner_type,owner_id,purchase_ref)
 SELECT r.provider,r.payment_ref,'user',p.user_id,r.purchase_ref FROM billing_personal_payment_receipts r JOIN billing_personal_purchases p USING(purchase_ref) ON CONFLICT DO NOTHING;
DO $validate$
BEGIN
 IF EXISTS(SELECT 1 FROM billing_personal_payment_receipts r JOIN billing_personal_purchases p USING(purchase_ref)
 JOIN billing_payment_claims c ON c.provider=r.provider AND c.payment_ref=r.payment_ref
 WHERE c.owner_type<>'user' OR c.owner_id<>p.user_id OR c.purchase_ref<>r.purchase_ref) THEN RAISE EXCEPTION 'payment_claim_backfill_conflict'; END IF;
END;
$validate$;
COMMENT ON TABLE billing_payment_claims IS 'kernel-no-tenant-data: immutable provider payment ownership. Receipt INSERT triggers alone claim ownership in the same transaction; app_rw cannot mutate the registry.';

-- Legacy lanes remain mechanically isolated too. Raw, unverified callback receipts never claim money.
CREATE OR REPLACE FUNCTION billing_claim_legacy_paid_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $legacy$
DECLARE typ text; own text; ref text; provider_name text; purchase text;
BEGIN
 IF TG_TABLE_NAME='billing_orders' THEN
  IF NEW.status<>'SUCCESS' OR NEW.channel_order_no IS NULL THEN RETURN NEW;END IF;
  typ:=NEW.owner_type;own:=NEW.owner_id;provider_name:=NEW.provider;purchase:=NEW.order_no;
  ref:=CASE WHEN provider_name='wechat' THEN 'wx_'||NEW.channel_order_no ELSE NEW.channel_order_no END;
 ELSIF TG_TABLE_NAME='billing_monthly_orders' THEN
  IF NEW.state<>'paid' THEN RETURN NEW;END IF;
  typ:='user';own:=NEW.user_id;provider_name:=NEW.provider;purchase:='pass_'||NEW.order_id::text;ref:=NEW.payment_ref;
 ELSIF TG_TABLE_NAME='credit_subscription_periods' THEN
  IF NEW.invoice_ref !~ '^(in|pi|wx)_[A-Za-z0-9_]+$' THEN RETURN NEW;END IF;
  SELECT owner_type,owner_id INTO typ,own FROM credit_wallets WHERE wallet_id=NEW.wallet_id;
  provider_name:=CASE WHEN NEW.invoice_ref LIKE 'wx_%' THEN 'wechat' ELSE 'stripe' END;
  purchase:=NEW.subscription_ref;ref:=NEW.invoice_ref;
 ELSE RAISE EXCEPTION 'payment_claim_source_invalid';END IF;
 PERFORM billing_register_paid_claim(provider_name,ref,typ,own,purchase);
 RETURN NEW;
END;
$legacy$;
REVOKE ALL ON FUNCTION billing_claim_legacy_paid_owner() FROM PUBLIC,app_rw;
DROP TRIGGER IF EXISTS billing_legacy_order_claim ON billing_orders;
CREATE TRIGGER billing_legacy_order_claim BEFORE INSERT OR UPDATE OF status,channel_order_no ON billing_orders FOR EACH ROW EXECUTE FUNCTION billing_claim_legacy_paid_owner();
DROP TRIGGER IF EXISTS billing_legacy_monthly_claim ON billing_monthly_orders;
CREATE TRIGGER billing_legacy_monthly_claim BEFORE INSERT OR UPDATE OF state,payment_ref ON billing_monthly_orders FOR EACH ROW EXECUTE FUNCTION billing_claim_legacy_paid_owner();
DROP TRIGGER IF EXISTS billing_legacy_period_claim ON credit_subscription_periods;
CREATE TRIGGER billing_legacy_period_claim BEFORE INSERT ON credit_subscription_periods FOR EACH ROW EXECUTE FUNCTION billing_claim_legacy_paid_owner();
DO $backfill$
DECLARE r record;
BEGIN
 FOR r IN
  SELECT provider,CASE WHEN provider='wechat' THEN 'wx_'||channel_order_no ELSE channel_order_no END AS ref,owner_type AS typ,owner_id AS own,order_no AS purchase FROM billing_orders WHERE status='SUCCESS' AND channel_order_no IS NOT NULL
  UNION ALL SELECT provider,payment_ref,'team',org_id,purchase_ref FROM billing_team_receipts
  UNION ALL SELECT provider,payment_ref,'user',user_id,'pass_'||order_id::text FROM billing_monthly_orders WHERE state='paid'
  UNION ALL SELECT CASE WHEN p.invoice_ref LIKE 'wx_%' THEN 'wechat' ELSE 'stripe' END,p.invoice_ref,w.owner_type,w.owner_id,p.subscription_ref FROM credit_subscription_periods p JOIN credit_wallets w USING(wallet_id) WHERE p.invoice_ref ~ '^(in|pi|wx)_[A-Za-z0-9_]+$'
 LOOP PERFORM billing_register_paid_claim(r.provider,r.ref,r.typ,r.own,r.purchase);END LOOP;
END;
$backfill$;
