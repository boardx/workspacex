/*
 * AG02（Phase 20 work-stack-foundation，契约束 agent-role，03-agent-role.md R3 ②，ADR-120 #2）——
 * agent_versions.tool_policy 从「必须为空数组」放宽为「数组且每项为能力分类字符串」。
 *
 * 单一事实源：`packages/contracts/src/agent-role.ts` 的 `StarterPackToolPolicy`
 * （= z.array(CapabilityCategory).max(64)，正则在 `work-skill-meta.ts`）。SQL 无法 import TS，
 * 下面的正则/上限是被机械核对的副本：apps/api/tests/agent/toolpolicy-check-migration.test.ts
 * 对同一组样本同时跑契约 safeParse 与本 CHECK，断言判定一致。
 * 分类只是声明，不产生任何授权（写分类须组织显式授予，不从包继承）。
 */
CREATE OR REPLACE FUNCTION agent_tool_policy_ok(p jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_typeof(p) = 'array'
     AND jsonb_array_length(p) <= 64
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(p) e
        WHERE jsonb_typeof(e) <> 'string'
           OR length(e #>> '{}') > 64
           OR (e #>> '{}') !~ '^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$'
     )
$$;

ALTER TABLE agent_versions DROP CONSTRAINT IF EXISTS agent_versions_tool_policy_check;
ALTER TABLE agent_versions
  ADD CONSTRAINT agent_versions_tool_policy_check CHECK (agent_tool_policy_ok(tool_policy));
