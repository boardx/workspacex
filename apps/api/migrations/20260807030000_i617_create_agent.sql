-- #617：`createAgent`（契约 `agent-runtime.ts:1387`，F55）全仓零 controller 挂载补线。
--
-- 复用 20260804150000_wave2_agent_starter_import.sql 建的「执行侧」`agents` 表——
-- 与 coord-agent-auth 已核实一致：`org_agents`/`chat_thread_agents`（#619 的 chat 选择器侧
-- 模型）是第三套不同的模型，本迁移不碰。
--
-- 那张表原本只服务 agent-starter-import 这一条写路径：导入的 agent **一落地就是已发布**
-- （`published_version_id` 立刻指向一行 `agent_versions`）。`createAgent` 走的是另一条路——
-- `domain/agent/definition.ts` 的 `AgentDefinition` 是「当前定义」，`发布` 前只有 `agents`
-- 这一行、没有任何 `agent_versions` 行（该表要求 `model_id`/`instructions` 均 NOT NULL，
-- 一个刚新建的草稿两者都没有）。所以本迁移只给 `agents` 加列，不碰 `agent_versions`。
--
-- 可独立重放：全程 IF NOT EXISTS / DO $$ ... $$ 幂等块。

ALTER TABLE agents
  ADD COLUMN IF NOT EXISTS initials text,
  ADD COLUMN IF NOT EXISTS role text,
  ADD COLUMN IF NOT EXISTS visibility text,
  ADD COLUMN IF NOT EXISTS clone_from text,
  ADD COLUMN IF NOT EXISTS source text,
  -- ⚠ 契约 `AgentPublishState` 的四态闭集（`packages/contracts/src/agent-runtime.ts:289`）：
  --   草稿 / 待审核 / 运行中 / 已停用。不在这里重复声明第二份枚举——CHECK 只做闭集校验，
  --   取值单一事实源仍是契约。
  ADD COLUMN IF NOT EXISTS publish_state text,
  -- `AgentDefinition.modelId`：null 表示尚未选模型（草稿态允许）。`createAgent` 本身不收
  -- modelId 入参（契约 `createAgent.in` 没有这个字段），新建出的行恒为 NULL；
  -- 未来 `updateAgentDefinition` 才会写它——这里只是给字段留位置，不代表本迁移实现了它。
  ADD COLUMN IF NOT EXISTS model_id text,
  ADD COLUMN IF NOT EXISTS concurrency_limit integer,
  ADD COLUMN IF NOT EXISTS degrade_policy text,
  -- I-30 / O-22①：复制不继承权限，`toolWhitelist` 恒为空数组——CHECK 在 DB 侧兜底，
  -- 与应用层 `domain/agent/clone.ts` 的两道防线呼应，不是重复：应用层挡的是
  -- 「代码路径」，这里挡的是「谁绕过应用层直接 INSERT」。
  ADD COLUMN IF NOT EXISTS tool_whitelist jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS skill_mounts jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_visibility_closed'
  ) THEN
    ALTER TABLE agents ADD CONSTRAINT agents_visibility_closed
      CHECK (visibility IS NULL OR visibility IN ('全组织可用', '仅某组'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_source_closed'
  ) THEN
    ALTER TABLE agents ADD CONSTRAINT agents_source_closed
      CHECK (source IS NULL OR source IN ('self', 'community'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_publish_state_closed'
  ) THEN
    ALTER TABLE agents ADD CONSTRAINT agents_publish_state_closed
      CHECK (publish_state IS NULL OR publish_state IN ('草稿', '待审核', '运行中', '已停用'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_degrade_policy_closed'
  ) THEN
    ALTER TABLE agents ADD CONSTRAINT agents_degrade_policy_closed
      CHECK (degrade_policy IS NULL OR degrade_policy IN ('按阈值降级', '不降级', '跟随组织级'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_concurrency_limit_positive'
  ) THEN
    ALTER TABLE agents ADD CONSTRAINT agents_concurrency_limit_positive
      CHECK (concurrency_limit IS NULL OR concurrency_limit > 0);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_tool_whitelist_is_array'
  ) THEN
    ALTER TABLE agents ADD CONSTRAINT agents_tool_whitelist_is_array
      CHECK (jsonb_typeof(tool_whitelist) = 'array');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_skill_mounts_is_array'
  ) THEN
    ALTER TABLE agents ADD CONSTRAINT agents_skill_mounts_is_array
      CHECK (jsonb_typeof(skill_mounts) = 'array');
  END IF;
  -- clone_from 指向同一组织下的另一个 agent；沿用 `agents_id_org_uniq` 复合唯一键。
  -- 不设 ON DELETE 级联/置空——源 agent 是否可删不是本迁移的判断范围。
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'agents_clone_from_fk'
  ) THEN
    ALTER TABLE agents ADD CONSTRAINT agents_clone_from_fk
      FOREIGN KEY (clone_from, org_id) REFERENCES agents(id, org_id);
  END IF;
END $$;

COMMENT ON COLUMN agents.publish_state IS
  '`AgentDefinition.publishState`（F55）。仅 `createAgent`/`updateAgentDefinition` 等走
   「当前定义」路径的行会填它；agent-starter-import 落的行（一落地即已发布）不填，
   这一列对它们恒为 NULL——两条写路径的落库形状本就不同，不强行对齐。';
COMMENT ON COLUMN agents.tool_whitelist IS
  'I-30 / O-22①：`cloneFrom` 是否非 null 与本列是否为空无关——新建与复制出的 agent
   恒为 `[]`，必须重新配置工具白名单才能提交发布（I-28）。';
