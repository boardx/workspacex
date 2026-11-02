-- Additive Team purchase facts. No production epoch activation or catalog enabling.
CREATE TABLE IF NOT EXISTS billing_team_quotes (
 quote_ref text PRIMARY KEY, org_id text NOT NULL,generation text NOT NULL,
 quote jsonb NOT NULL CHECK(jsonb_typeof(quote)='object'),created_at timestamptz NOT NULL,expires_at timestamptz NOT NULL,
 CHECK(expires_at>created_at)
);
CREATE TABLE IF NOT EXISTS billing_team_purchases (
 purchase_ref text PRIMARY KEY CHECK(length(purchase_ref) BETWEEN 6 AND 32),org_id text NOT NULL,
 generation text NOT NULL,idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 16 AND 128),
 quote_ref text NOT NULL REFERENCES billing_team_quotes(quote_ref),quote jsonb NOT NULL CHECK(jsonb_typeof(quote)='object'),
 created_by text NOT NULL,created_at timestamptz NOT NULL,checkout_expires_at timestamptz NOT NULL,
 session_ref text,payment_url text,expires_at timestamptz,fulfilled_at timestamptz,closed_at timestamptz,
 payment_review_required boolean NOT NULL DEFAULT false,fulfillment jsonb,
 UNIQUE(org_id,generation,idempotency_key),UNIQUE(session_ref),
 CHECK(checkout_expires_at>created_at),
 CHECK((session_ref IS NULL AND payment_url IS NULL AND expires_at IS NULL) OR (session_ref IS NOT NULL AND payment_url IS NOT NULL AND expires_at IS NOT NULL)),
 CHECK((fulfilled_at IS NOT NULL)=(fulfillment IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS billing_team_open_license ON billing_team_purchases(org_id,generation)
 WHERE quote->>'purpose' IN ('initial','renewal','add_seats') AND fulfilled_at IS NULL AND closed_at IS NULL;
CREATE TABLE IF NOT EXISTS billing_team_receipts (
 provider text NOT NULL,payment_ref text NOT NULL,purchase_ref text NOT NULL REFERENCES billing_team_purchases(purchase_ref),
 org_id text NOT NULL,amount_minor bigint NOT NULL CHECK(amount_minor>0),currency text NOT NULL,
 paid_at timestamptz NOT NULL,verified_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 manual_review boolean NOT NULL DEFAULT false,manual_reason text,PRIMARY KEY(provider,payment_ref)
);
CREATE TABLE IF NOT EXISTS billing_team_terms (
 purchase_ref text PRIMARY KEY REFERENCES billing_team_purchases(purchase_ref),org_id text NOT NULL,
 generation text NOT NULL,paid_term jsonb NOT NULL CHECK(jsonb_typeof(paid_term)='object'),next_check_at timestamptz
);
DO $policies$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['billing_team_quotes','billing_team_purchases','billing_team_receipts','billing_team_terms'] LOOP
  -- Financial facts outlive organization lifecycle. New purchase admission checks canonical writability.
  -- Converge replay of this unpublished schema without carrying automatic lifecycle freeze policies.
  EXECUTE format('ALTER TABLE %I DROP CONSTRAINT IF EXISTS %I',t,t||'_org_id_fkey');
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I',t||'_org_frozen_ins',t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I',t||'_org_frozen_upd',t);
  EXECUTE format('DROP POLICY IF EXISTS %I ON %I',t||'_org_frozen_del',t);
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS tenant_scope ON %I',t);
  EXECUTE format('CREATE POLICY tenant_scope ON %I USING(org_id=current_setting(''app.current_org'',true)) WITH CHECK(org_id=current_setting(''app.current_org'',true))',t);
  EXECUTE format('REVOKE ALL ON %I FROM app_rw',t);
 END LOOP;
END;
$policies$;
GRANT SELECT,INSERT ON billing_team_quotes TO app_rw;
GRANT SELECT,INSERT ON billing_team_purchases,billing_team_receipts,billing_team_terms TO app_rw;
GRANT UPDATE(session_ref,payment_url,expires_at,fulfilled_at,closed_at,payment_review_required,fulfillment) ON billing_team_purchases TO app_rw;
GRANT UPDATE(manual_review,manual_reason) ON billing_team_receipts TO app_rw;
GRANT UPDATE(next_check_at) ON billing_team_terms TO app_rw;
SELECT kernel_apply_org_freeze_policies();
-- Verified provider entry points resolve only a financial routing pointer, never tenant business data.
CREATE OR REPLACE FUNCTION billing_team_purchase_org(reference text) RETURNS text
LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $lookup$
 SELECT org_id FROM billing_team_purchases WHERE purchase_ref=reference;
$lookup$;
REVOKE ALL ON FUNCTION billing_team_purchase_org(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing_team_purchase_org(text) TO app_rw;
CREATE OR REPLACE FUNCTION billing_team_due_orgs(active_generation text,after_org text,batch_limit integer)
RETURNS TABLE(org_id text) LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp SET row_security=off AS $due$
 SELECT d.org_id FROM (
  SELECT p.org_id FROM billing_team_purchases p WHERE p.generation=active_generation AND p.fulfilled_at IS NULL AND p.closed_at IS NULL AND NOT p.payment_review_required
  UNION SELECT t.org_id FROM billing_team_terms t WHERE t.generation=active_generation AND t.next_check_at<=clock_timestamp()
 ) d WHERE after_org IS NULL OR d.org_id>after_org ORDER BY d.org_id LIMIT greatest(1,least(batch_limit,20));
$due$;
REVOKE ALL ON FUNCTION billing_team_due_orgs(text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing_team_due_orgs(text,text,integer) TO app_rw;
