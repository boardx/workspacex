-- F976 (plan-control 契约束) —— 执行控制：暂停（可恢复）/ 恢复续跑 / 重试单步。
--
-- 权威规格：phases/phase-01-run-a-project/contracts/plan-control/{domain,usecases}.md
-- UC-9 pausePlanRun / UC-13 resumePlanRun / UC-10 retryPlanStep。
--
-- ## remote_run_id —— P-2 实现期探针的答案（domain.md 三·⑤）
--
-- 探针结论：远端（LangGraph）run_id 在本仓 `deep-agent-model-provider.ts` 的
-- `createRun` 里只作为方法内局部变量存在，从未持久化到 `agent_runs`。UC-9 pause
-- 需要它来调用 `POST /threads/{remoteThreadId}/runs/{runId}/cancel`——本列补上这条
-- 记账。写入点：`ModelCallInput.onRemoteRunStarted` 回调（`execute-run.ts` 注入，
-- 见该文件 `ExecuteAgentRunDeps.planLedger` 附近的接线），provider 创建远端 run
-- 成功后立即回调，可选、不影响不需要它的执行路径（与 `planLedger` 等既有可选
-- 依赖同一条纪律）。
--
-- ## paused_at —— UC-9 的落点
--
-- 不复用 `status` 列表达"已暂停"：`agent_runs_status_check` 的六个值都不是这个语义，
-- 硬塞会让 `agent_runs_enforce_status_transition` 的状态机多出一条从未设计过的边，
-- 且 `agent_runs_failure_shape_check` 会强制 `status='failed'` 必须带 `error_code`，
-- 而暂停不是失败。新增一列独立表达，`status` 保持不变（这一行仍然是"曾经在跑的
-- 那次 run"，只是远端被 interrupt 打断了）。

ALTER TABLE agent_runs
  ADD COLUMN IF NOT EXISTS remote_run_id text NULL,
  ADD COLUMN IF NOT EXISTS paused_at timestamptz NULL;

SELECT kernel_apply_org_freeze_policies();
