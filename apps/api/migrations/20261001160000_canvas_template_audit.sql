-- #3010: immutable template lifecycle history. No public request/schema change.
-- Host/bootstrap writes have explicit unattributed provenance, never a fabricated user.
CREATE TABLE IF NOT EXISTS canvas_template_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  version integer NOT NULL,
  action text NOT NULL,
  from_status text,
  to_status text NOT NULL,
  actor_id text,
  actor_source text NOT NULL CHECK (actor_source IN ('principal', 'host')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  changed_fields text[] NOT NULL,
  CHECK ((actor_source='principal') = (actor_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS canvas_template_audit_version_idx ON canvas_template_audit(org_id,key,version,id);
ALTER TABLE canvas_template_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE canvas_template_audit FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS canvas_template_audit_tenant ON canvas_template_audit;
CREATE POLICY canvas_template_audit_tenant ON canvas_template_audit
  USING (org_id=current_setting('app.current_org',true))
  WITH CHECK (org_id=current_setting('app.current_org',true));
REVOKE ALL ON canvas_template_audit FROM app_rw;
GRANT SELECT ON canvas_template_audit TO app_rw;

CREATE OR REPLACE FUNCTION canvas_template_audit_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP='DELETE' AND NOT EXISTS (SELECT 1 FROM public.organizations WHERE id=OLD.org_id) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'canvas template audit is append-only';
END;
$$ LANGUAGE plpgsql SET search_path=public,pg_temp;
DROP TRIGGER IF EXISTS canvas_template_audit_append_only_trg ON canvas_template_audit;
CREATE TRIGGER canvas_template_audit_append_only_trg BEFORE UPDATE OR DELETE ON canvas_template_audit
  FOR EACH ROW EXECUTE FUNCTION canvas_template_audit_append_only();

-- The template write and its audit cannot commit independently. Application users
-- may read history but cannot insert or forge it through the audit table.
CREATE OR REPLACE FUNCTION record_canvas_template_audit() RETURNS trigger AS $$
DECLARE
  actor text := NULLIF(current_setting('app.canvas_template_actor',true),'');
  requested text := NULLIF(current_setting('app.canvas_template_action',true),'');
  operation text;
  previous text;
  fields text[];
BEGIN
  IF TG_OP='INSERT' THEN
    operation := CASE WHEN requested='adopt' THEN 'adopt' WHEN NEW.version=1 THEN 'create' ELSE 'mint' END;
    fields := ARRAY['created'];
  ELSE
    IF to_jsonb(OLD)-'updated_at'=to_jsonb(NEW)-'updated_at' THEN RETURN NEW; END IF;
    previous := OLD.status;
    operation := CASE
      WHEN OLD.status='archived' AND NEW.status<>'archived' THEN 'restore'
      WHEN NEW.status='archived' AND requested='publish' THEN 'supersede'
      WHEN NEW.status='archived' THEN 'archive'
      WHEN OLD.status<>NEW.status AND NEW.status='published' THEN 'publish'
      WHEN OLD.status<>NEW.status AND NEW.status='trial' THEN 'trial'
      ELSE 'edit' END;
    SELECT array_agg(item.key ORDER BY item.key) INTO fields
      FROM jsonb_each(to_jsonb(NEW)-'updated_at') item
      WHERE item.value IS DISTINCT FROM to_jsonb(OLD)->item.key;
  END IF;
  INSERT INTO public.canvas_template_audit(org_id,key,version,action,from_status,to_status,actor_id,actor_source,changed_fields)
    VALUES(NEW.org_id,NEW.key,NEW.version,operation,previous,NEW.status,actor,
      CASE WHEN actor IS NULL THEN 'host' ELSE 'principal' END,fields);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp;
REVOKE ALL ON FUNCTION record_canvas_template_audit() FROM PUBLIC;
DROP TRIGGER IF EXISTS canvas_templates_audit_trg ON canvas_templates;
CREATE TRIGGER canvas_templates_audit_trg AFTER INSERT OR UPDATE ON canvas_templates
  FOR EACH ROW EXECUTE FUNCTION record_canvas_template_audit();
SELECT kernel_apply_org_freeze_policies();
