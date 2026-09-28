/*
 * WF01（Phase 20 work-stack-foundation）—— Workflow Definition / Version / Instance 三张表 + I-2 / I-4 的库内门。
 *
 * ① workflow_definitions：一个 (org_id, key) 一行（domain.md「WorkflowDefinition」）。
 * ② workflow_definition_versions：(org_id, key, version) 主键；published 行的 graph_ref / stages / input_schema
 *    永不改变，只可迁到 retired（I-2）——由触发器 wf_definition_version_immutable 在库里拒绝，不靠调用方自觉。
 *    删除：app_rw 没有 DELETE 权限；只有删组织的级联（owner 身份）会带走它们。
 * ③ workflow_instances：启动时冻结 definition_version 与 pinned_skills（I-4/I-5）。
 *    触发器 wf_instance_pin_immutable 拒绝任何改动 definition_version / workflow_key / graph_ref / pinned_skills /
 *    agent_version_id 的 UPDATE；status / state_version / reason_code 留给 WF02/WF03 的状态机推进。
 *    外键指向版本行，保证实例冻结的一定是存在的版本。
 * 三表 RLS：本组织可见（app.current_org），FORCE，app_rw 无 DELETE。
 */
CREATE TABLE IF NOT EXISTS workflow_definitions (
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  key        text NOT NULL CHECK (key ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, key)
);

CREATE TABLE IF NOT EXISTS workflow_definition_versions (
  org_id       text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  key          text NOT NULL,
  version      integer NOT NULL CHECK (version >= 1),
  graph_ref    text NOT NULL,
  title        text NOT NULL,
  status       text NOT NULL CHECK (status IN ('draft', 'published', 'retired')),
  stages       jsonb NOT NULL CHECK (jsonb_typeof(stages) = 'array'),
  input_schema jsonb NOT NULL CHECK (jsonb_typeof(input_schema) = 'object'),
  published_at timestamptz,
  PRIMARY KEY (org_id, key, version),
  FOREIGN KEY (org_id, key) REFERENCES workflow_definitions (org_id, key) ON DELETE CASCADE,
  CHECK ((status = 'draft') = (published_at IS NULL))
);

CREATE TABLE IF NOT EXISTS workflow_instances (
  id                 text PRIMARY KEY,
  org_id             text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  workflow_key       text NOT NULL,
  definition_version integer NOT NULL,
  graph_ref          text NOT NULL,
  pinned_skills      jsonb NOT NULL CHECK (jsonb_typeof(pinned_skills) = 'array'),
  agent_id           text NOT NULL,
  agent_version_id   text NOT NULL,
  initiator_user_id  text NOT NULL,
  trigger_kind       text NOT NULL CHECK (trigger_kind IN ('manual', 'schedule', 'webhook')),
  status             text NOT NULL,
  state_version      integer NOT NULL CHECK (state_version >= 1),
  reason_code        text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (org_id, workflow_key, definition_version)
    REFERENCES workflow_definition_versions (org_id, key, version) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS workflow_instances_org_key_idx ON workflow_instances (org_id, workflow_key, definition_version);

CREATE OR REPLACE FUNCTION wf_definition_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'draft' AND (
       NEW.org_id IS DISTINCT FROM OLD.org_id OR NEW.key IS DISTINCT FROM OLD.key OR NEW.version IS DISTINCT FROM OLD.version
    OR NEW.graph_ref IS DISTINCT FROM OLD.graph_ref OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.stages IS DISTINCT FROM OLD.stages OR NEW.input_schema IS DISTINCT FROM OLD.input_schema
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
    OR NOT (NEW.status = OLD.status OR (OLD.status = 'published' AND NEW.status = 'retired'))) THEN
    RAISE EXCEPTION 'workflow definition version % % is immutable (I-2)', OLD.key, OLD.version USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS wf_definition_version_immutable ON workflow_definition_versions;
CREATE TRIGGER wf_definition_version_immutable BEFORE UPDATE ON workflow_definition_versions
  FOR EACH ROW EXECUTE FUNCTION wf_definition_version_immutable();

CREATE OR REPLACE FUNCTION wf_instance_pin_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.org_id IS DISTINCT FROM OLD.org_id
    OR NEW.workflow_key IS DISTINCT FROM OLD.workflow_key OR NEW.definition_version IS DISTINCT FROM OLD.definition_version
    OR NEW.graph_ref IS DISTINCT FROM OLD.graph_ref OR NEW.pinned_skills IS DISTINCT FROM OLD.pinned_skills
    OR NEW.agent_id IS DISTINCT FROM OLD.agent_id OR NEW.agent_version_id IS DISTINCT FROM OLD.agent_version_id
    OR NEW.initiator_user_id IS DISTINCT FROM OLD.initiator_user_id OR NEW.trigger_kind IS DISTINCT FROM OLD.trigger_kind THEN
    RAISE EXCEPTION 'workflow instance % pinned fields are immutable (I-4)', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
DROP TRIGGER IF EXISTS wf_instance_pin_immutable ON workflow_instances;
CREATE TRIGGER wf_instance_pin_immutable BEFORE UPDATE ON workflow_instances
  FOR EACH ROW EXECUTE FUNCTION wf_instance_pin_immutable();

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['workflow_definitions', 'workflow_definition_versions', 'workflow_instances']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
  END LOOP;
END
$$;
REVOKE ALL ON workflow_definitions, workflow_definition_versions, workflow_instances FROM app_rw;
GRANT SELECT, INSERT ON workflow_definitions TO app_rw;
GRANT SELECT, INSERT, UPDATE ON workflow_definition_versions TO app_rw;
GRANT SELECT, INSERT, UPDATE ON workflow_instances TO app_rw;

SELECT kernel_apply_org_freeze_policies();
