/*
 * AG01（Phase 20 work-stack-foundation，契约束 agent-role，ADR-116 #3：Agent 即 DigitalHuman）——
 * 角色冻结字段：`agents`（草稿）与 `agent_versions`（发布快照）各加同一组 7 列。
 *
 * 单一事实源：形状与默认值 = `packages/contracts/src/agent-role.ts` 的 `AgentRoleFields` /
 * `AGENT_ROLE_FIELD_DEFAULTS`。SQL 无法 import TS，所以本文件里的字面量是**被机械核对的副本**：
 * apps/api/tests/agent/version-snapshot-frozen-fields.test.ts
 *   ① 从 information_schema 读两张表 7 列的 column_default，求值后逐字等于 AGENT_ROLE_FIELD_DEFAULTS；
 *   ② 对同一组样本同时跑契约 safeParse 与本文件的 CHECK，断言判定一致（头像 key 全集、W###、
 *      maxDepth 上限、转交目标、升级目标、角色分类、目录来源）；
 *   ③ 把「DB 比契约宽」的部分钉住（见下），宽的部分由应用层 Zod 拦截。
 *
 * DB 刻意比契约宽的地方（不在 SQL 里复制的细节，写入口一律先过 Zod）：
 *   - avatar.alt、escalation rule.matter、kpi.metric/description 的长度与正则；
 *   - jsonb 对象上多出来的键（契约 `.strict()`）。
 *
 * 旧行回填：ADD COLUMN ... DEFAULT 是元数据操作，不触发 UPDATE 触发器，
 * 已发布版本的不可变触发器（agent_versions_immutable_trg）不受影响。
 */
CREATE OR REPLACE FUNCTION agent_role_fields_ok(
  p_avatar jsonb, p_workflow_allowlist text[], p_delegation jsonb, p_escalation jsonb, p_kpi jsonb
) RETURNS boolean LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF p_avatar IS NOT NULL THEN
    IF jsonb_typeof(p_avatar) <> 'object'
       OR p_avatar->>'kind' IS DISTINCT FROM 'illustration'
       OR jsonb_typeof(p_avatar->'key') IS DISTINCT FROM 'string'
       OR p_avatar->>'key' !~ '^(person-([1-9]|1[0-9]|2[0-4])|robot)$'
       OR jsonb_typeof(p_avatar->'alt') IS DISTINCT FROM 'string' THEN
      RETURN false;
    END IF;
  END IF;

  IF p_workflow_allowlist IS NULL
     OR cardinality(p_workflow_allowlist) > 64
     OR array_position(p_workflow_allowlist, NULL) IS NOT NULL
     OR array_to_string(p_workflow_allowlist, ',') !~ '^(W[0-9]{3}(,W[0-9]{3})*)?$' THEN
    RETURN false;
  END IF;

  IF p_delegation IS NULL OR jsonb_typeof(p_delegation) <> 'object'
     OR jsonb_typeof(p_delegation->'allowedTargets') IS DISTINCT FROM 'array'
     OR jsonb_typeof(p_delegation->'maxDepth') IS DISTINCT FROM 'number'
     OR jsonb_typeof(p_delegation->'requireApproval') IS DISTINCT FROM 'boolean' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p_delegation->'allowedTargets') > 32
     OR jsonb_path_exists(p_delegation,
          '$.allowedTargets[*] ? (@.type() != "string" || !(@ like_regex "^D[0-9]{3}$"))')
     OR (p_delegation->>'maxDepth')::numeric NOT IN (0, 1, 2) THEN
    RETURN false;
  END IF;

  IF p_escalation IS NULL OR jsonb_typeof(p_escalation) <> 'object'
     OR jsonb_typeof(p_escalation->'rules') IS DISTINCT FROM 'array' THEN
    RETURN false;
  END IF;
  IF jsonb_array_length(p_escalation->'rules') > 64
     OR jsonb_path_exists(p_escalation,
          '$.rules[*] ? (!(@.target == "requester" || @.target == "project_owner" || @.target == "org_admin"))') THEN
    RETURN false;
  END IF;

  IF p_kpi IS NULL OR jsonb_typeof(p_kpi) <> 'array' OR jsonb_array_length(p_kpi) > 16 THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

ALTER TABLE agent_versions
  ADD COLUMN IF NOT EXISTS avatar jsonb,
  ADD COLUMN IF NOT EXISTS role_category text
    CHECK (role_category IS NULL OR role_category IN ('research','product','sales','design','general')),
  ADD COLUMN IF NOT EXISTS catalog_source text NOT NULL DEFAULT 'org'
    CHECK (catalog_source IN ('official','org')),
  ADD COLUMN IF NOT EXISTS workflow_allowlist text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS delegation_policy jsonb NOT NULL
    DEFAULT '{"allowedTargets":[],"maxDepth":0,"requireApproval":true}'::jsonb,
  ADD COLUMN IF NOT EXISTS escalation_policy jsonb NOT NULL DEFAULT '{"rules":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS kpi jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE agent_versions DROP CONSTRAINT IF EXISTS agent_versions_role_fields_ok;
ALTER TABLE agent_versions ADD CONSTRAINT agent_versions_role_fields_ok
  CHECK (agent_role_fields_ok(avatar, workflow_allowlist, delegation_policy, escalation_policy, kpi));

/* 草稿同形：发布把这 7 列从 agents 原样拷进 agent_versions（infrastructure/agent/agent-version-insert.ts）。 */
ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS avatar jsonb,
  ADD COLUMN IF NOT EXISTS role_category text
    CHECK (role_category IS NULL OR role_category IN ('research','product','sales','design','general')),
  ADD COLUMN IF NOT EXISTS catalog_source text NOT NULL DEFAULT 'org'
    CHECK (catalog_source IN ('official','org')),
  ADD COLUMN IF NOT EXISTS workflow_allowlist text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS delegation_policy jsonb NOT NULL
    DEFAULT '{"allowedTargets":[],"maxDepth":0,"requireApproval":true}'::jsonb,
  ADD COLUMN IF NOT EXISTS escalation_policy jsonb NOT NULL DEFAULT '{"rules":[]}'::jsonb,
  ADD COLUMN IF NOT EXISTS kpi jsonb NOT NULL DEFAULT '[]'::jsonb,
  /* updateAgentRoleDraft 的乐观并发号（AgentRoleAdminView.version）。 */
  ADD COLUMN IF NOT EXISTS role_draft_version integer NOT NULL DEFAULT 0 CHECK (role_draft_version >= 0);
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_role_fields_ok;
ALTER TABLE agents ADD CONSTRAINT agents_role_fields_ok
  CHECK (agent_role_fields_ok(avatar, workflow_allowlist, delegation_policy, escalation_policy, kpi));
