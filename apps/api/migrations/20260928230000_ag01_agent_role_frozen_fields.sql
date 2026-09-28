/*
 * AG01（Phase 20 work-stack-foundation，契约束 agent-role，ADR-116 #3：Agent 即 DigitalHuman）——
 * `agent_versions` 增加角色冻结字段列。形状与回填默认值的唯一事实源是
 * `packages/contracts/src/agent-role.ts` 的 `AgentRoleFields` / `AGENT_ROLE_FIELD_DEFAULTS`；
 * 迁移测试（apps/api/tests/agent/version-snapshot-frozen-fields.test.ts）逐字断言本文件的列默认值
 * 等于该常量、CHECK 的判定与契约 enum 一致。
 *
 * 旧行回填：ADD COLUMN ... DEFAULT 是元数据操作，不触发 UPDATE 触发器，已发布版本的不可变触发器不受影响。
 *   avatar NULL（前端回退首字母）、role_category NULL、catalog_source 'org'、workflow_allowlist '{}'。
 */
ALTER TABLE agent_versions
  ADD COLUMN IF NOT EXISTS avatar jsonb
    CHECK (avatar IS NULL OR (jsonb_typeof(avatar) = 'object' AND avatar->>'kind' = 'illustration')),
  ADD COLUMN IF NOT EXISTS role_category text
    CHECK (role_category IS NULL OR role_category IN ('research','product','sales','design','general')),
  ADD COLUMN IF NOT EXISTS catalog_source text NOT NULL DEFAULT 'org'
    CHECK (catalog_source IN ('official','org')),
  ADD COLUMN IF NOT EXISTS workflow_allowlist text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (array_position(workflow_allowlist, NULL) IS NULL),
  ADD COLUMN IF NOT EXISTS delegation_policy jsonb NOT NULL
    DEFAULT '{"allowedTargets":[],"maxDepth":0,"requireApproval":true}'::jsonb
    CHECK (jsonb_typeof(delegation_policy) = 'object'),
  ADD COLUMN IF NOT EXISTS escalation_policy jsonb NOT NULL DEFAULT '{"rules":[]}'::jsonb
    CHECK (jsonb_typeof(escalation_policy) = 'object'),
  ADD COLUMN IF NOT EXISTS kpi jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(kpi) = 'array');
