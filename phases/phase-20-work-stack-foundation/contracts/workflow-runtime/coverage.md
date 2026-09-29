# 契约束 `workflow-runtime` — UC 覆盖证明（支撑材料）

> 需求单一事实源：`requirements/02-workflow-runtime.md`。R12 原文未编号，本表按其出现顺序编为 V1–V16。
> API 操作名均为 `packages/contracts/src/workflow-runtime.ts` 的 `workflowRuntime.<op>`；内部端口见 usecases.md 第二节。

## 一、R12 → API 操作 → 前端消费点

| 行键 | 验收线索 | API 操作 | 前端消费点 | 状态 |
|---|---|---|---|---|
| V1 | 成功态：start 201 且固定 definition/Skill 版本；逐阶段 succeeded；stage_outputs 每阶段有行；projection 不引用 channel_values | `startInstance`、`getInstance` | `workflow-start-dialog`、`workflow-run-panel`、`workflow-stage-<stageId>` | 契约闭合；待实现 |
| V2 | 版本固定：v1 运行中发布 v2，v1 按原版本完成，新实例用 v2 | `publishDefinitionVersion`、`startInstance`、`getInstance` | `workflow-pinned-version`、`workflow-stage-skills-<stageId>` | 契约闭合；待实现 |
| V3 | 幂等：同 requestId 两次 start 1 实例同响应；pg-boss 重复投递 1 实例 | `startInstance`；内部 UC-WR-I4 | `workflow-start-submit`（重复点击） | 契约闭合；待实现 |
| V4 | 崩溃恢复：begin 后崩溃，桩调用计数仍 1，进入对账或 needs_attention | 内部 UC-WR-I3；`getInstance` | `workflow-banner-needs-attention` | 契约闭合；待实现 |
| V5 | 并发：两个 resume 仅一个拿 lease，另一个 lease_conflict；epoch 过期抛 workflow_lease_lost | `resumeInstance`；内部 UC-WR-I2 | `workflow-action-resume` | 契约闭合；待实现 |
| V6 | 版本冲突：过期 expectedStateVersion 的 cancel/approve 得 409 含最新 projection | `cancelInstance`、`approveGate`（`WorkflowErrorBody.latestProjection`） | `workflow-action-cancel`、`workflow-approve` 冲突后刷新 | 契约闭合；待实现 |
| V7 | 权限重查：审批后撤销授权，副作用不执行，blocked_permission 带 reasonCode | `approveGate`；内部 UC-WR-I2；`getInstance` | `workflow-banner-blocked-permission` | 契约闭合；待实现 |
| V8 | 启动拒绝：422 skill_version_unresolved；403 workflow_not_allowed；他组织查询 404 | `startInstance`、`getInstance`、`listRunnableWorkflows` | `workflow-start-dialog` 错误态、`workflow-run-entry` 不渲染 | 契约闭合；待实现 |
| V9 | 审批：deny 无 receipt 理由入日志；第二人 409 gate_already_decided；非指定 403；默认不能自批 | `denyGate`、`approveGate`、`listMyApprovals` | `workflow-approval-drawer`、`workflow-deny-reason`、`workflow-approval-list` | 契约闭合；待实现 |
| V10 | webhook：错签 401 无实例；同 key 不同 payload 409；正确返回 {instanceId,status} | `triggerWebhook` | —（API 层验收；实例随后出现在 `workflow-run-list`） | 契约闭合；待实现 |
| V11 | SSE：Last-Event-ID 重连 seq 连续无重复；超窗先 snapshot | `streamInstanceEvents` | `workflow-event-log`、`workflow-sse-status` | 契约闭合；待实现 |
| V12 | 失败重试：超限 failed，已完成产出可见；从该阶段重试产生新 attempt | `retryStage`、`getInstance` | `workflow-action-retry-<stageId>` | 契约闭合；待实现 |
| V13 | 取消：下一个副作用被拦，终态 cancelled，已完成副作用列在 provenance | `cancelInstance`、`getInstance`（`effects`） | `workflow-action-cancel`、`workflow-run-panel` provenance 区 | 契约闭合；待实现 |
| V14 | 迁移：引导式研究 e2e 全绿；research 基础设施无 langgraph_interview / interview/workflow；未迁清单 0 | 内部 UC-WR-I5；现有 `research.ts` 引导式研究 operations 不变 | `/research/[sessionId]` 现有页面 | 契约闭合；待实现 |
| V15 | 统一性门：new PostgresSaver 仅工厂一处；无自建 receipt/lease 表 | 内部 UC-WR-I1（lint/grep 门） | —（API 层验收，代码门） | 契约闭合；待实现 |
| V16 | UI：面板七种态；无运行权限看不到入口 | `listRunnableWorkflows`、`getInstance`、`listMyInstances`、`listMyApprovals` | `workflow-run-panel`、`workflow-run-list-empty`、`workflow-run-entry` | 契约闭合；六态截图缺口见 ui.md 第三节 |

## 二、反向核对：API → UC

| API 操作 | 被哪些行需要 |
|---|---|
| `publishDefinitionVersion` | V2（R3-1） |
| `listRunnableWorkflows` | V8、V16（R8 入口，E6） |
| `startInstance` | V1、V2、V3、V8 |
| `getInstance` | V1、V2、V4、V7、V8、V12、V13、V16 |
| `listMyInstances` | V16（R8「我的运行」） |
| `streamInstanceEvents` | V11 |
| `cancelInstance` | V6、V13 |
| `resumeInstance` | V5（R2「用户在面板点继续」） |
| `retryStage` | V12 |
| `listMyApprovals` | V9、V16 |
| `approveGate` | V6、V7、V9 |
| `denyGate` | V9 |
| `triggerWebhook` | V10 |

无孤儿操作。R5 中管理员的「下线版本 / 管理触发器 / 轮换密钥」没有 R12 线索、本契约也未提供操作——见 usecases.md Q3。
