/*
 * #654 阶段2a —— 增量持久化路线的第一块骨架：`agent_run_deltas`。
 *
 * ## 为什么是新表，不是 `agent_run_steps` 的新 kind
 *
 * `agent_run_steps` 的形状（status/failure_code/input_digest/output_digest，一次 run
 * 只有 4 条：accepted/context_built/model_called/chat_writeback）是"粗粒度阶段"，且
 * `kind` 是与 `wave2Runtime.AgentRunStepKind` 契约枚举一一对应的一份事实（本文件同目录
 * 迁移的头注写明"一份事实，两种语言"，有测试读 `pg_constraint` 断言两边相等）。
 * token 级增量是完全不同的形状——一次 run 可能有几十到几百条、只有"这一段文本"
 * 这一个字段、没有 status/failure_code 的概念（增量本身不会"失败"，`model_called`
 * 步骤的成败仍然只由现有的 succeeded/failed 语义表达）。硬塞进 `agent_run_steps`
 * 会：①污染契约枚举的"一份事实"边界，②让 append-only 触发器和 status/failure_code
 * 的 CHECK 约束对一种它们不是为之设计的形状生效。新表是纯增量：不改
 * `agent_run_steps` 的表结构、契约枚举、或 append-only 触发器实现。
 *
 * ## 这解决什么、不解决什么
 *
 * 解决：`ModelCallPort` 的可选 `completeStream` 变体在拿到 provider 的每个 token 增量
 * 时，有地方落盘（`execute-run.ts` 调 `appendModelDelta`），SSE 桥接端点可以订阅/轮询
 * 这张表把增量转发给前端，而不必等整个 run 到终态才第一次吐字。
 *
 * 不解决：执行触发模型仍然是"队列批量认领"（`executeQueuedRuns` 定时 tick），本迁移
 * 不改 `agent_runs`/`agent_run_steps` 的任何列或状态机。`ModelCallPort.complete`（非流式）
 * 完全不受影响——`completeStream` 是新增的可选方法，没有实现它的 provider
 * （`DeepResearchModelProvider`、`BailianImageProvider`）继续走原来的一次性 `complete`。
 *
 * ## Append-only，理由与 `agent_run_steps` 相同
 *
 * 增量是"模型说过的话的记录"，不是可变状态；一旦写入就不该被后续调用改写或删除
 * （除父组织级联删除外）。同一份"两半机制"证据（GRANT 面 + 触发器）。
 */

CREATE TABLE IF NOT EXISTS agent_run_deltas (
  id         text PRIMARY KEY,
  org_id     text NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  run_id     text NOT NULL REFERENCES agent_runs (id) ON DELETE CASCADE,
  seq        integer NOT NULL,
  text       text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_run_deltas_seq_uniq UNIQUE (org_id, run_id, seq),
  -- 空字符串增量不是"没说话"，是上游把心跳/空 delta 事件误当内容转发进来的信号；
  -- 拒绝它比默默落一行空文本更早暴露适配器的 bug。
  CONSTRAINT agent_run_deltas_text_nonempty_check CHECK (text <> '')
);

CREATE INDEX IF NOT EXISTS agent_run_deltas_run_idx ON agent_run_deltas (org_id, run_id, seq);

CREATE OR REPLACE FUNCTION i654_agent_run_delta_append_only() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id = OLD.org_id) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'AgentRun deltas are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS agent_run_deltas_append_only_trg ON agent_run_deltas;
CREATE TRIGGER agent_run_deltas_append_only_trg BEFORE UPDATE OR DELETE ON agent_run_deltas
  FOR EACH ROW EXECUTE FUNCTION i654_agent_run_delta_append_only();

ALTER TABLE agent_run_deltas ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run_deltas FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_run_deltas_tenant ON agent_run_deltas;
CREATE POLICY agent_run_deltas_tenant ON agent_run_deltas
  USING (org_id = current_setting('app.current_org', true))
  WITH CHECK (org_id = current_setting('app.current_org', true));

REVOKE ALL ON agent_run_deltas FROM app_rw;
GRANT SELECT, INSERT ON agent_run_deltas TO app_rw;

SELECT kernel_apply_org_freeze_policies();
