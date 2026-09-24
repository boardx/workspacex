/*
 * Phase 18 F02 —— 组织大脑本体的 canonical 表与 RLS（契约束 chat-knowledge-graph，domain.md 一、三）。
 *
 * ## 这份迁移建什么
 *
 * - `ontology_objects`（新）：实体节点。`object_kind` 是封闭枚举（S0-5）。
 * - `ontology_actions`（新）：append-only 的动作日志——谁、何时、做了什么、依据什么、结果如何
 *   （accepted / rejected + 原因）。**不许改、不许删**，由触发器强制。
 * - `object_embeddings`（新）：实体与结论的向量，按 model/version 分区思路同 `segment_embeddings`。
 * - `claims` 扩列：补齐 context-engine 规定的 6 个生命周期字段，以及 claim_kind / 作用域 /
 *   撤销与驳回时间 / 决策七态 `decision_state`（O-25；本阶段不写，只让列存在）。
 *   **生命周期仍只有 `status` 一个字段**（I-2）：三态、五态都是它的投影，不落库。
 * - `ontology_edges` 扩展：端点类型加 object / claim / chat_message；加 status（active / invalidated，
 *   软失效，uc-18-5）、created_by、provenance_event_id、作用域。
 *
 * ## 作用域与 RLS
 *
 * - 本体行都带 `scope_kind / scope_id`。枚举现在就包含 L0–L4 全部五级（外扩不改表），
 *   但本阶段**只允许写入** chat_session / personal——那条校验在执行器（F03），不在 CHECK 里，
 *   因为 phase-02/03 放开时要改的应该是执行器的配置，而不是一次迁移。
 * - org 隔离沿用 `app.current_org`（同 0009）。
 * - **个人空间（personal）额外一层 RESTRICTIVE 策略**：只有 `scope_id = app.current_user_id` 的
 *   会话看得见（I-14）。`app.current_user_id` 没设置 ⇒ 看不见任何 personal 行（fail closed）。
 *   为什么用 RESTRICTIVE：它与 org 策略是 AND 关系，任何将来新加的 PERMISSIVE 策略都绕不过它。
 *
 * ## 旧数据兼容
 *
 * 0009 起就有的 `claims` / `ontology_edges` 行（检索通道的夹具、F45 删除级联）没有作用域，
 * 新列一律可空或带默认值；scope 为空的旧行只受 org 策略约束，行为与今天完全一致。
 *
 * ## 写权限
 *
 * 新表对 `app_rw` **只授 SELECT**。写入经 F03 的执行器函数（SECURITY DEFINER）——这是 I-3
 * 「模型不直写本体表」在数据库层的落点。`claims` / `ontology_edges` 的既有写权限本迁移不动
 * （F45 删除级联与检索夹具依赖它们），模型身份写入的拦截由 F03 以触发器补上。
 */

-- ─────────────────────────────── 作用域枚举（五级，本阶段只写前两级） ───────────────────────────────

-- ─────────────────────────────── ontology_objects ───────────────────────────────
CREATE TABLE IF NOT EXISTS ontology_objects (
  id                  text PRIMARY KEY,
  org_id              text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  scope_kind          text NOT NULL CHECK (scope_kind IN ('chat_session', 'personal', 'project', 'org', 'platform')),
  scope_id            text NOT NULL CHECK (length(scope_id) > 0),
  object_kind         text NOT NULL CHECK (object_kind IN (
    'person', 'organization', 'project', 'product', 'concept', 'term', 'metric', 'event'
  )),
  name                text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  aliases             text[] NOT NULL DEFAULT '{}',
  created_by          text NOT NULL CHECK (created_by IN ('human', 'model', 'import')),
  -- 实体合并（uc-18-3 mergeObjects）：被合并的一方不物理删除，指向保留方，审计可追。
  merged_into         text REFERENCES ontology_objects (id) ON DELETE SET NULL,
  provenance_event_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (merged_into IS NULL OR merged_into <> id)
);

CREATE INDEX IF NOT EXISTS ontology_objects_scope_idx
  ON ontology_objects (org_id, scope_kind, scope_id, object_kind);
-- 实体解析（F06）按「同作用域 + 同类型 + 同名（不分大小写）」找候选。
CREATE INDEX IF NOT EXISTS ontology_objects_name_idx
  ON ontology_objects (org_id, scope_kind, scope_id, lower(name));

-- ─────────────────────────────── ontology_actions（append-only） ───────────────────────────────
CREATE TABLE IF NOT EXISTS ontology_actions (
  id               text PRIMARY KEY,
  org_id           text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  scope_kind       text NOT NULL CHECK (scope_kind IN ('chat_session', 'personal', 'project', 'org', 'platform')),
  scope_id         text NOT NULL,
  actor_kind       text NOT NULL CHECK (actor_kind IN ('human', 'model', 'system')),
  actor_id         text NOT NULL,
  action_type      text NOT NULL CHECK (length(action_type) > 0),
  payload          jsonb NOT NULL,
  -- 触发源：消息 id / 附件版本 id / 卡片 id。抽取任务的幂等键 = (source_ref, pipeline_version)（I-7）。
  source_ref       text,
  pipeline_version text,
  outcome          text NOT NULL CHECK (outcome IN ('accepted', 'rejected')),
  reject_code      text,
  reject_reason    text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((outcome = 'rejected') = (reject_code IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS ontology_actions_scope_idx
  ON ontology_actions (org_id, scope_kind, scope_id, created_at);
CREATE INDEX IF NOT EXISTS ontology_actions_source_idx
  ON ontology_actions (org_id, source_ref, pipeline_version) WHERE source_ref IS NOT NULL;

CREATE OR REPLACE FUNCTION ontology_actions_append_only() RETURNS trigger AS $$
BEGIN
  -- org 被删除时的级联（ON DELETE CASCADE）要放行：那是整个租户离开，不是篡改一条日志。
  -- 同 0013 的理由，用 session_user 而不是 current_user 判断：级联时 current_user 会被改写。
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'ontology_actions is append-only (% refused)', TG_OP USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ontology_actions_append_only_trg ON ontology_actions;
CREATE TRIGGER ontology_actions_append_only_trg
  BEFORE UPDATE OR DELETE ON ontology_actions
  FOR EACH ROW EXECUTE FUNCTION ontology_actions_append_only();

-- ─────────────────────────────── object_embeddings ───────────────────────────────
CREATE TABLE IF NOT EXISTS object_embeddings (
  org_id        text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  target_kind   text NOT NULL CHECK (target_kind IN ('object', 'claim')),
  target_id     text NOT NULL,
  model         text NOT NULL,
  model_version text NOT NULL,
  embedding     vector NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (target_kind, target_id, model, model_version),
  FOREIGN KEY (model, model_version) REFERENCES embedding_models (model, model_version)
);

CREATE INDEX IF NOT EXISTS object_embeddings_model_idx
  ON object_embeddings (org_id, model, model_version);

CREATE OR REPLACE FUNCTION object_embedding_dims_match() RETURNS trigger AS $$
DECLARE
  want integer;
BEGIN
  SELECT dims INTO want FROM embedding_models
   WHERE model = NEW.model AND model_version = NEW.model_version;
  IF want IS NULL THEN
    RAISE EXCEPTION 'embedding model %/% is not registered', NEW.model, NEW.model_version;
  END IF;
  IF vector_dims(NEW.embedding) <> want THEN
    RAISE EXCEPTION 'embedding for % % has % dimensions but model %/% is registered with %',
      NEW.target_kind, NEW.target_id, vector_dims(NEW.embedding), NEW.model, NEW.model_version, want;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS object_embedding_dims_match_trg ON object_embeddings;
CREATE TRIGGER object_embedding_dims_match_trg
  BEFORE INSERT OR UPDATE ON object_embeddings
  FOR EACH ROW EXECUTE FUNCTION object_embedding_dims_match();

-- ─────────────────────────────── claims 扩列 ───────────────────────────────
ALTER TABLE claims ADD COLUMN IF NOT EXISTS claim_kind          text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS confidence          real;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS valid_from          timestamptz;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS valid_to            timestamptz;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS created_by          text NOT NULL DEFAULT 'import';
ALTER TABLE claims ADD COLUMN IF NOT EXISTS reviewed_by         text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS supersedes_claim_id text REFERENCES claims (id) ON DELETE SET NULL;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS scope_kind          text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS scope_id            text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS revoked_at          timestamptz;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS revocation_reason   text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS rejected_at         timestamptz;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS decision_state      text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS provenance_event_id text;
ALTER TABLE claims ADD COLUMN IF NOT EXISTS created_at          timestamptz NOT NULL DEFAULT now();
ALTER TABLE claims ADD COLUMN IF NOT EXISTS updated_at          timestamptz NOT NULL DEFAULT now();

-- CHECK 一律 DROP-then-ADD：写在 ADD COLUMN 里的内联 CHECK 在列已存在时是静默空操作（同 0021 的教训）。
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_claim_kind_chk;
ALTER TABLE claims ADD CONSTRAINT claims_claim_kind_chk
  CHECK (claim_kind IS NULL OR claim_kind IN ('fact', 'hypothesis', 'decision', 'todo', 'risk'));
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_confidence_chk;
ALTER TABLE claims ADD CONSTRAINT claims_confidence_chk
  CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1));
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_created_by_chk;
ALTER TABLE claims ADD CONSTRAINT claims_created_by_chk
  CHECK (created_by IN ('human', 'model', 'import'));
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_scope_chk;
ALTER TABLE claims ADD CONSTRAINT claims_scope_chk
  CHECK ((scope_kind IS NULL) = (scope_id IS NULL)
     AND (scope_kind IS NULL OR scope_kind IN ('chat_session', 'personal', 'project', 'org', 'platform')));
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_validity_chk;
ALTER TABLE claims ADD CONSTRAINT claims_validity_chk
  CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from < valid_to);
-- 决策七态（O-25 / PROP §3.5）。本阶段不写入，列与枚举先在，外扩时不改表。
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_decision_state_chk;
ALTER TABLE claims ADD CONSTRAINT claims_decision_state_chk
  CHECK (decision_state IS NULL OR decision_state IN (
    'leading', 'discussing', 'to_verify', 'awaiting_decision', 'conflict', 'vetoed', 'suggested'
  ));
-- I-4 的数据库一半：模型产出的结论生命周期最高到 proposed。人工确认后该行 created_by 仍是 model、
-- 但 reviewed_by 非空——所以约束写成「accepted 必有 reviewed_by」，而不是「model 不能 accepted」。
ALTER TABLE claims DROP CONSTRAINT IF EXISTS claims_accept_needs_reviewer_chk;
ALTER TABLE claims ADD CONSTRAINT claims_accept_needs_reviewer_chk
  CHECK (status <> 'accepted' OR created_by <> 'model' OR reviewed_by IS NOT NULL);

CREATE INDEX IF NOT EXISTS claims_kg_scope_idx
  ON claims (org_id, scope_kind, scope_id, status) WHERE scope_kind IS NOT NULL;

-- ─────────────────────────────── ontology_edges 扩展 ───────────────────────────────
ALTER TABLE ontology_edges ADD COLUMN IF NOT EXISTS status              text NOT NULL DEFAULT 'active';
ALTER TABLE ontology_edges ADD COLUMN IF NOT EXISTS invalidated_at      timestamptz;
ALTER TABLE ontology_edges ADD COLUMN IF NOT EXISTS created_by          text NOT NULL DEFAULT 'import';
ALTER TABLE ontology_edges ADD COLUMN IF NOT EXISTS provenance_event_id text;
ALTER TABLE ontology_edges ADD COLUMN IF NOT EXISTS scope_kind          text;
ALTER TABLE ontology_edges ADD COLUMN IF NOT EXISTS scope_id            text;
ALTER TABLE ontology_edges ADD COLUMN IF NOT EXISTS created_at          timestamptz NOT NULL DEFAULT now();

-- 端点类型：0009 的六种保留（检索夹具与 F45 在用），加上本体的三种。
ALTER TABLE ontology_edges DROP CONSTRAINT IF EXISTS ontology_edges_src_kind_check;
ALTER TABLE ontology_edges DROP CONSTRAINT IF EXISTS ontology_edges_dst_kind_check;
ALTER TABLE ontology_edges DROP CONSTRAINT IF EXISTS ontology_edges_kinds_chk;
ALTER TABLE ontology_edges ADD CONSTRAINT ontology_edges_kinds_chk
  CHECK (src_kind IN ('person', 'project', 'decision', 'requirement', 'research', 'segment', 'object', 'claim', 'chat_message')
     AND dst_kind IN ('person', 'project', 'decision', 'requirement', 'research', 'segment', 'object', 'claim', 'chat_message'));
ALTER TABLE ontology_edges DROP CONSTRAINT IF EXISTS ontology_edges_status_chk;
ALTER TABLE ontology_edges ADD CONSTRAINT ontology_edges_status_chk
  CHECK (status IN ('active', 'invalidated') AND ((status = 'invalidated') = (invalidated_at IS NOT NULL)));
ALTER TABLE ontology_edges DROP CONSTRAINT IF EXISTS ontology_edges_created_by_chk;
ALTER TABLE ontology_edges ADD CONSTRAINT ontology_edges_created_by_chk
  CHECK (created_by IN ('human', 'model', 'import'));
ALTER TABLE ontology_edges DROP CONSTRAINT IF EXISTS ontology_edges_scope_chk;
ALTER TABLE ontology_edges ADD CONSTRAINT ontology_edges_scope_chk
  CHECK ((scope_kind IS NULL) = (scope_id IS NULL)
     AND (scope_kind IS NULL OR scope_kind IN ('chat_session', 'personal', 'project', 'org', 'platform')));
-- 本体边（两端之一是 object / claim）的关系必须落在两个封闭枚举里（契约 KgRelation）；
-- 0009 的旧边（person / decision / segment …）关系词是自由文本，保持不变。
ALTER TABLE ontology_edges DROP CONSTRAINT IF EXISTS ontology_edges_kg_relation_chk;
ALTER TABLE ontology_edges ADD CONSTRAINT ontology_edges_kg_relation_chk
  CHECK (NOT (src_kind IN ('object', 'claim') OR dst_kind IN ('object', 'claim'))
      OR relation IN ('supported_by', 'may_shorten', 'blocks', 'hard_constraint', 'candidate_for',
                      'mentions', 'about', 'derived_from', 'supersedes', 'belongs_to', 'decided_by'));

CREATE INDEX IF NOT EXISTS ontology_edges_kg_scope_idx
  ON ontology_edges (org_id, scope_kind, scope_id, status) WHERE scope_kind IS NOT NULL;

-- ─────────────────────────────── RLS ───────────────────────────────
DO $$
DECLARE
  t text;
BEGIN
  -- org 隔离：新表与 0009 同一条写法（未设置 app.current_org ⇒ 什么都看不见）。
  FOREACH t IN ARRAY ARRAY['ontology_objects', 'ontology_actions', 'object_embeddings']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_tenant', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (org_id = current_setting(''app.current_org'', true)) '
      'WITH CHECK (org_id = current_setting(''app.current_org'', true))',
      t || '_tenant', t);
  END LOOP;

  -- 个人空间（I-14）：RESTRICTIVE，与 org 策略 AND。未设置 app.current_user_id ⇒ personal 行不可见。
  FOREACH t IN ARRAY ARRAY['ontology_objects', 'ontology_actions', 'claims', 'ontology_edges']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', t || '_personal_owner', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I AS RESTRICTIVE '
      'USING (scope_kind IS DISTINCT FROM ''personal'' OR scope_id = current_setting(''app.current_user_id'', true)) '
      'WITH CHECK (scope_kind IS DISTINCT FROM ''personal'' OR scope_id = current_setting(''app.current_user_id'', true))',
      t || '_personal_owner', t);
  END LOOP;
END
$$;

-- object_embeddings 没有作用域列：它的可见性跟随目标行。召回时总是 JOIN 回 objects / claims
-- 再按上面的策略过滤（ADR-114 决策 3 的同一原则：内容与权限只在 canonical 表判定）。

REVOKE ALL ON ontology_objects, ontology_actions, object_embeddings FROM app_rw;
GRANT SELECT ON ontology_objects, ontology_actions, object_embeddings TO app_rw;

-- F22 组织冻结：新的租户表在**本迁移里**装上 `_org_frozen_*` 三条策略（冻结的组织不可写）。
-- 不能指望后面哪个迁移顺手补——migrate:check 的强制重放会在 0014 重跑时替我们装上，
-- 于是「首次部署的库」与「重放后的库」schema 不一致（同 #342 / #1667 的教训）。
SELECT kernel_apply_org_freeze_policies();
