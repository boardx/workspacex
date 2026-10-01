# 契约束 `workflow-runtime` — ② 用例（签核面第 ② 件）

> 依据：`requirements/02-workflow-runtime.md` R1–R12。形状单源：`packages/contracts/src/workflow-runtime.ts`
> 的 `workflowRuntime.<op>`；下文 `err` 取值全部来自 `WorkflowErrorCode`，运行中阻断来自 `WorkflowReasonCode`。
> 不变量编号见 `domain.md`。

## 一、对外用例（有 HTTP 面）

### UC-WR-1 发布 Definition 版本 — `publishDefinitionVersion`（WF01）
- in: `WorkflowDefinitionVersionInput`（key, version, graphRef, title, inputSchema, stages[]）
- out: `WorkflowDefinitionVersionView`（status=`published`）
- pre: 调用者为组织管理员。
- 校验：graphRef 已在代码注册表；stageId 集合与图节点一一对应；每个 Skill 引用可解析（I-3）。
- err: `workflow_not_found` | `definition_invalid`（响应 message 指明哪条校验失败）

### UC-WR-2 列出可运行 Workflow — `listRunnableWorkflows`（WF03/WF08）
- in: `{agentId}`；out: `{items[{key, version, title, inputSchema}]}`
- pre: 发起人对 Agent 有运行权限；只返回 `workflowAllowlist` 内的版本（E6：不可运行者不出现）。
- err: `workflow_not_found`（Agent 不可见）

### UC-WR-3 启动实例 — `startInstance`（WF01/WF03）
- in: `{key, version?, agentId, requestId, input}`；out: `{instanceId, status, stateVersion, definitionVersion, pinnedSkills}`，HTTP 201
- 步骤：receipt 查重（A1）→ 白名单与输入校验 → 冻结版本（I-4/I-5）→ receipt.begin → 建实例 → 取 lease(epoch=1) → receipt.finalize。
- err: `workflow_not_found` | `workflow_version_not_published` | `workflow_not_allowed`(403, E6) | `skill_version_unresolved`(422, E5，带 `missingSkills`) | `trigger_input_invalid`(422) | `idempotency_key_reused`(409)

### UC-WR-4 读实例 — `getInstance`（WF03/WF08）
- out: `WorkflowInstanceProjection`（只来自业务行，I-8；checkpoint 丢失时仍能显示已完成阶段，E11）
- 可见：发起人、该实例门的指定审批人（只读）、组织管理员。
- err: `workflow_not_found`（他组织 / 非成员 / 无关成员一律 404，R5）

### UC-WR-5 我的运行 — `listMyInstances`（WF08）
- in: `{status?[], cursor?, limit}`；out: `{items, nextCursor}`；空列表是合法结果（七态之「空列表」）。
- err: 无

### UC-WR-6 事件流 — `streamInstanceEvents`（WF03/WF08）
- in: `{instanceId, lastEventId?}`（Last-Event-ID 头）；每条 data = `WorkflowSseEnvelope`
- 行为：从 `lastEventId+1` 补发；差距超保留窗口先发 `snapshot`（E10）；断线不影响服务端运行。SSE 不可用时前端降级轮询 UC-WR-4。
- err: `workflow_not_found`

### UC-WR-7 取消 — `cancelInstance`（WF03）
- in: `{instanceId, expectedStateVersion, requestId}`；out: `{instanceId, status(cancelling|cancelled), stateVersion}`
- 行为：置 `cancelling`，下一个副作用被 effect-gateway 以 `cancel_requested` 拦下 → `cancelled`；已 finalize 的副作用不回滚、列在 provenance。
- pre: 发起人或组织管理员；审批人不能取消。
- err: `workflow_not_found` | `state_version_conflict`(409，带 `latestProjection`) | `instance_terminal`

### UC-WR-8 恢复 — `resumeInstance`（WF02/WF03）
- in 同上；out 同上。lease epoch CAS（I-16）。
- err: `workflow_not_found` | `state_version_conflict` | `instance_terminal` | `lease_conflict`(E2)

### UC-WR-9 从阶段重试 — `retryStage`（WF03/WF08）
- in: `{instanceId, stageId, expectedStateVersion, requestId}`；out: `{attempt(新), stateVersion}`；旧 attempt 业务行保留（E9）。
- err: `workflow_not_found` | `state_version_conflict` | `stage_not_retryable` | `instance_terminal`

### UC-WR-10 待我审批 — `listMyApprovals`（WF05/WF08）
- out: `{items[{instanceId, workflowKey, definitionVersion, agentId, initiatorUserId, gate}]}`
- err: 无

### UC-WR-11 批准 — `approveGate`（WF05）
- in: `{instanceId, gateId, expectedStateVersion, requestId}`；out: `{gate, status, stateVersion}`
- 行为：记决定（I-17）→ 恢复执行 → effect-gateway 照常重查权限；重查失败则阶段 `blocked_permission`（E4）。
- err: `workflow_not_found` | `state_version_conflict` | `gate_already_decided`(409，带 `decidedGate`) | `gate_not_open` | `not_designated_approver`(403) | `self_approval_forbidden`(403) | `idempotency_key_reused`

### UC-WR-12 拒绝 — `denyGate`（WF05）
- in: 同上 + `reason`(必填)；无 effect receipt；按 `onDenyStageId` 回退或实例 `rejected`；理由入事件日志。
- err: 同 UC-WR-11 + `deny_reason_required`

### UC-WR-13 webhook 触发 — `triggerWebhook`（WF06）
- in: `{triggerId, signature, timestamp, idempotencyKey, payload}`（头部名单源 `WORKFLOW_WEBHOOK_HEADERS`，窗 `WORKFLOW_WEBHOOK_TIMESTAMP_WINDOW_SECONDS`=300）
- out: `{instanceId, status}`（调用方拿不到实例详情，R5）
- 运行身份 = 触发器 owner，走 UC-WR-3 内核。
- err: `webhook_signature_invalid`(401，不写 receipt 不建实例) | `idempotency_key_reused`(409) | `workflow_not_found` | `workflow_not_allowed` | `skill_version_unresolved` | `trigger_input_invalid`

## 二、内部端口用例（无 HTTP 面）

| 用例 | 端口 | 输入 → 输出 | 失败 |
|---|---|---|---|
| UC-WR-I1 取 saver | `WorkflowCheckpointerFactory` | `(graphRef, instanceId)` → saver（schema `langgraph_workflow`，共享池） | 无（唯一构造点，I-9） |
| UC-WR-I2 执行副作用 | `EffectGateway.execute` | `(instanceId, stageId, effectKey, capabilityCategory, args)` → finalize 结果 + provenance | `workflow_lease_lost`、权限类 `WorkflowReasonCode` → `blocked_permission`、`cancel_requested` |
| UC-WR-I3 崩溃恢复对账 | `EffectGateway.reconcile` | begun receipt → `reconciled` 或 `unresolved`（实例 `needs_attention`，`effect_unreconciled`） | 永不重放（I-14） |
| UC-WR-I4 定时唤醒 | pg-boss handler | `WorkflowScheduledJobPayload{kind:'workflow',triggerId}`，作业 id 作 requestId，运行输入取触发器的 `default_input`（domain.md，作业本身不带 payload）→ UC-WR-3 | 同 UC-WR-3；原 agent-run payload 不受影响；触发器已不存在/非 `schedule` kind 时安静跳过（无调用方可回错误） |
| UC-WR-I5 引导式研究迁移 | 迁移脚本 + `guided-research@1` 注册 | `langgraph_interview` checkpoint → `langgraph_workflow`；receipt → `workflow_receipts` | 搬不动的会话只读保留并列入报告（E12） |

引导式研究 controller 的 operations 路径与响应形状不变（`packages/contracts/src/research.ts` 现有定义），本束不新增其对外契约。

## 三、开放问题（待签核人裁决）

- **Q1** 实例对「指定审批人」的只读可见范围：是整实例 projection，还是仅门预览 + 阶段时间线？（本契约暂按整实例 projection，但 `viewerCapabilities` 全 false。）
- **Q2** `needs_attention` 被列为终态（02 号 R6），但 E1 暗示人工核对后可继续——是否需要「人工标记已核对并 resume」操作？本契约未提供，如需要须新增 operation（走 ADR-023 新契约面）。
- **Q3** 管理员「下线（retired）」Definition 版本、「管理触发器 / 轮换 webhook 密钥」在 R5 中列为管理员能力，但 R3/R12 无对应验收；本契约**未**提供 retire / trigger CRUD / 密钥轮换操作——是否并入本束还是留到 agent-role 束 / 后续迭代？
- **Q4** SSE 保留窗口大小（超窗先发 snapshot）未定量；建议 1000 条（对齐 R9「补发 1000 条 < 2s」）。
- **Q5** `startInstance.version` 缺省时取「白名单内最新 published」还是「全局最新 published」？本契约按前者。
- **Q6** webhook 签名头名称 `x-workspacex-signature` / `x-workspacex-timestamp` 为本束新定，是否对齐某外部约定。
