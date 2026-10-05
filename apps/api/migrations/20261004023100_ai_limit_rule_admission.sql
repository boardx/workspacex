-- Explicitly opted-in rules only; no existing rule, plan or quota is activated.
ALTER TABLE ai_request_reservations ADD COLUMN IF NOT EXISTS formal_model_id text NULL;
ALTER TABLE ai_request_reservations ADD COLUMN IF NOT EXISTS agent_id text NULL;
CREATE TABLE IF NOT EXISTS ai_limit_rule_decisions (
 org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
 request_id text NOT NULL, input jsonb NOT NULL, result jsonb NOT NULL,
 event_id text NULL REFERENCES limit_events(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(org_id,request_id)
);
ALTER TABLE ai_limit_rule_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_limit_rule_decisions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_scope ON ai_limit_rule_decisions;
CREATE POLICY tenant_scope ON ai_limit_rule_decisions
 USING(org_id=current_setting('app.current_org',true)) WITH CHECK(org_id=current_setting('app.current_org',true));
GRANT SELECT,INSERT ON ai_limit_rule_decisions TO app_rw;
CREATE OR REPLACE FUNCTION ai_limit_decision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND NOT EXISTS(SELECT 1 FROM organizations WHERE id=OLD.org_id) THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'AI limit decisions are append-only';
END $$;
DROP TRIGGER IF EXISTS ai_limit_decision_immutable ON ai_limit_rule_decisions;
CREATE TRIGGER ai_limit_decision_immutable BEFORE UPDATE OR DELETE ON ai_limit_rule_decisions
 FOR EACH ROW EXECUTE FUNCTION ai_limit_decision_immutable();
SELECT kernel_apply_org_freeze_policies();

-- All actual ledger/start writers share admission's org lock, including adapters
-- with no reservation. Otherwise a concurrent paid unmatched start can be missed.
-- "ai_" sorts before the existing receipt reconciliation/physical locks.
CREATE OR REPLACE FUNCTION ai_usage_rule_lock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('["ai-limit-rules",' || to_json(NEW.org_id)::text || ']',0));
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS ai_usage_rule_lock ON token_usage_events;
CREATE TRIGGER ai_usage_rule_lock BEFORE INSERT ON token_usage_events
 FOR EACH ROW EXECUTE FUNCTION ai_usage_rule_lock();
DROP TRIGGER IF EXISTS ai_usage_rule_lock ON token_usage_enrichments;
CREATE TRIGGER ai_usage_rule_lock BEFORE INSERT ON token_usage_enrichments
 FOR EACH ROW EXECUTE FUNCTION ai_usage_rule_lock();
DROP TRIGGER IF EXISTS ai_usage_rule_lock ON model_request_starts;
CREATE TRIGGER ai_usage_rule_lock BEFORE INSERT ON model_request_starts
 FOR EACH ROW EXECUTE FUNCTION ai_usage_rule_lock();
