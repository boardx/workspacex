# 发给 Agent 工作台 peer 的接口对齐请求

2026-09-07。我们负责 Tools/Skills、实际加载事实和子任务取消；请你们继续负责统一 journal、主任务控制及工作台展示。以下是需要提供的接口，不要求重复实现我们的能力。

1. **契约版本**：相关最新 commit/PR、导出符号、实际调用入口和验收证据。请注明已提交但尚未合入 main 的依赖。
2. **Skill 加载事件入口**：统一 journal 的 writer/API 和 payload 契约。我们提供固定 skill/version、实际读取路径及关联 ToolCall 等事实。区分发现元数据、读取正文、执行成功；不能仅凭 call_skill 或读取 SKILL.md 判定执行成功。持久化、去重、回放和 UI 归工作台。
3. **父取消接点**：父取消调用子任务取消的位置，以及可传递的可信 orgId、parentRunId、幂等标识。子任务接口归本批次。首批保证 pending 原子取消；running 未取得远端停止确认时明确拒绝/报告未停止，工作台不得提前显示全部已停止。
4. **执行前检查入口**：如何验证 run/attempt 仍允许执行、审批是否有效、是否已经取消。我们复用现有权威决策接原生工具/MCP，不把内部 lease 或 attempt 记录当作授权，也不要求另建一套系统。

联合验收：Skill 加载事件实时与回放不重复；父取消后 pending 子任务不启动；running 未确认停止时状态诚实；迟到结果不覆盖取消终态。

## 本批次当前事实

- ebe8afe29：原生 Skills 加载/版本校验已实现，有加载行为测试；没有公开 journal 加载事件交付声明。
- 352a506ba：单个 pending 子任务取消接口已提交。`POST /agent-runs/:runId/subtask-runs/:id/cancel`；共享符号 `subtaskRun.CancelSubtaskRunResult`、`CancelSubtaskRunFailure`；内部端口 `SubtaskRunStore.cancel(orgId,parentRunId,id)`。200 返回 cancelled，重复请求幂等；running 返回409 `cancellation_not_supported_for_running`，completed/failed 返回409 `terminal_conflict`。23项真实DB/HTTP测试及API/Web类型检查通过，独立review无阻断。证据：`evidence/WX-T042/pending-cancel.md`及同目录日志。父级联与晚到enqueue拒绝尚未接入。
- 只读检查的 peer head 是 b5ba846364d9e30c143f6cc6f791a5b6c25be8d3，contracts 无dirty。主 run lease 属于内部栅栏，不是执行授权接口。

责任单源仍为 peer-boundaries.md。本文件是本次对接请求，不另立事件或生命周期契约。
