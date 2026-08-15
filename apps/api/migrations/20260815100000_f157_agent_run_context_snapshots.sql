-- F157（08-chat/uc-8-7 R3②，人类 2026-08-11「yes to all」逐字签核）：
-- 可审计上下文快照——每次 agent run 后，记录本次实际喂给模型的历史结构：
-- L1 保留轮数 / L2 摘要覆盖边界 / L3 召回条数与来源 / token 估值。
--
-- ## 为什么是新表，不是 agent_run_steps 的一个 jsonb 列
--
-- `agent_run_steps` 是「run 走了哪几步、每步成败」的**过程**记录（append-only，一 run 多行），
-- 快照是「这次到底组装出了什么形状」的**一份结构化事实**（一 run 恰好一行）——两者的读法不同：
-- 检索快照总是「给我 run_id，回我唯一一条」，塞进 steps 会变成「在多行里找 kind=context_snapshot
-- 的那一行、再解出它的 jsonb」，多一层无意义的间接。且 steps 的 `inputDigest`/`outputDigest`
-- 是摘要，不是结构化字段——快照要求「L1 保留轮数」这种可直接查询、可 CHECK 约束的整数字段，
-- 塞进摘要哈希无法满足。新表 + 直接列，是本仓库既有先例（`thread_context_state` 同理）里
-- 「一份可独立检索的结构化事实 = 一张表」的一致做法，不是发明新模式。
--
-- 一次 run 一行：PK 就是 run_id（agent_runs.id 全局唯一，ON DELETE CASCADE 随 run 清理）。
-- org_id 供 RLS，与 `thread_context_state`/`agent_runs` 同一条既有纪律。
--
-- 可重放：IF NOT EXISTS 全程（migrate:check 忽略版本表强制重放每个文件）。

CREATE TABLE IF NOT EXISTS agent_run_context_snapshots (
  run_id                 text PRIMARY KEY REFERENCES agent_runs (id) ON DELETE CASCADE,
  org_id                 text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- L1：本轮最终保留在近端窗口、原样进模型的历史消息条数。
  l1_message_count       integer NOT NULL CHECK (l1_message_count >= 0),
  -- L2：这次是否正常参与组装。不含 'not_configured'——L2 在 `ExecuteAgentRunDeps` 里永远
  -- 参与，不是像 L3 那样的可选依赖，所以它只有 ok/degraded 两种可能。
  l2_status               text NOT NULL CHECK (l2_status IN ('ok','degraded')),
  -- L2：这次实际生效的摘要覆盖边界（复用 thread_context_state.summarized_through_id 语义）。
  -- NULL = 降级，或从未摘要过。
  l2_covered_through_id   text,
  -- L3：这次是否参与、参与后是否正常。三态：ok / degraded / not_configured（这次执行根本
  -- 没接 L3——`deps.files` 缺省）。
  l3_status               text NOT NULL CHECK (l3_status IN ('ok','degraded','not_configured')),
  l3_hit_count            integer NOT NULL DEFAULT 0 CHECK (l3_hit_count >= 0),
  -- L3：命中来源标记去重集合（FileRetrievalSourceKind 的字面值，如 'chat-attachment'）。
  l3_sources              jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(l3_sources) = 'array'),
  -- 保守字符预算换算出的估值（~4 字符/token，同 execute-run.ts 的 HISTORY_MAX_CHARS 换算），
  -- 不是真实 token 数——真实计费数字在 F159 的 token_usage_events。
  estimated_tokens        integer NOT NULL CHECK (estimated_tokens >= 0),
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- 按 org 批量读（RLS 已按 org 收口，此索引服务「一个 org 的所有快照」场景，同
-- thread_context_state_org_idx 先例）。
CREATE INDEX IF NOT EXISTS agent_run_context_snapshots_org_idx
  ON agent_run_context_snapshots (org_id);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = 'agent_run_context_snapshots') THEN
    RAISE EXCEPTION 'agent_run_context_snapshots did not get created';
  END IF;
END
$$;

/* ─────────────────────────── RLS ─────────────────────────── */

ALTER TABLE agent_run_context_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_context_snapshots FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_run_context_snapshots_tenant ON agent_run_context_snapshots;
CREATE POLICY agent_run_context_snapshots_tenant ON agent_run_context_snapshots
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

-- 一 run 一行、写入一次；只需要写与读，不删（run 删除靠 FK 级联）、不改（快照是不可变事实）。
REVOKE ALL ON agent_run_context_snapshots FROM app_rw;
GRANT SELECT, INSERT ON agent_run_context_snapshots TO app_rw;

-- 新增租户表之后必须重新调用一次组织冻结策略，否则组织冻结对这张新表不生效
-- （同 F34/F35/F36/F153/F154 成例）。
SELECT kernel_apply_org_freeze_policies();
