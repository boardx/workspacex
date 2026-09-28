# 契约束 `workflow-runtime` — 领域模型与不变量（支撑材料）

> 最内层，不依赖任何人。形状的权威在 `packages/contracts/src/workflow-runtime.ts`；
> 本文件是**不变量**与**枚举封闭性**的唯一收敛点（ADR-023 决策二）。
> 依据：ADR-118 第 1–9 条、ADR-116 第 3 条、ADR-120 第 1–3 条、`requirements/02-workflow-runtime.md` R3/R4/R7/R9。

## 一、现状基线（本束断言只来自以下已读文件）

- `apps/api/src/application/research/guided-workflow-service.ts`：`checkpointConfig(sessionId)` 返回
  `{ configurable: { thread_id: sessionId } }`；`fingerprint()` 以 sha256(stableJson) 做幂等；
  `GuidedResearchWorkflowError(reasonCode, latestProjection?)` —— 本束 409 带 `latestProjection` 的形状来源。
- `apps/api/src/infrastructure/research/langgraph-guided-research-runtime.ts`：自建
  `new PostgresSaver(…, { schema: "langgraph_interview" })` 并反向 import
  `../interview/workflow/langgraph-digital-interview-runtime` 的 `withCheckpointNamespace`（02 号文件「现状基线」，ADR-118「背景」）。
- `packages/contracts/src/run-control.ts`：`ToolExecutionCheckInput` 已以 `leaseEpoch` + `reason: lease_lost` 表达 lease 语义——本束 lease 沿用 epoch 概念。

## 二、实体与值对象

| 实体 / 表 | 关键字段 | 说明 |
|---|---|---|
| WorkflowDefinition（`workflow_definitions`） | `org_id`, `key` | 一个 key 一行；官方包可跨组织导入 |
| WorkflowDefinitionVersion（`workflow_definition_versions`） | `key`, `version`, `graph_ref`, `status`, `stages`(json), `input_schema` | 元数据；图本体在代码注册表（ADR-118 第 2 条） |
| WorkflowInstance（`workflow_instances`） | `org_id`, `definition_version`, `pinned_skills`(json), `agent_id`, `agent_version_id`, `initiator_user_id`, `trigger_kind`, `status`, `state_version`, `reason_code` | 版本固定落这里 |
| WorkflowStageOutput（`workflow_stage_outputs`） | `instance_id`, `stage_id`, `attempt`, 业务指针 | 业务事实 |
| WorkflowReceipt（`workflow_receipts`） | `org_id`, `scope`(command/effect), `request_key`, `fingerprint`, `status`, `stable_response`, `checkpoint_id` | 沿用 guided research begin/finalize 形状 |
| WorkflowLease（`workflow_leases`） | `instance_id`, `holder`, `epoch`, `expires_at` | epoch CAS |
| WorkflowEvent（`workflow_events`） | `instance_id`, `seq`, `type`, `state_version`, `payload` | 事件日志 |
| WorkflowGate（随事件与 instance 投影） | `gate_id`, `stage_id`, `decision`, `decided_by`, `reason` | 人工门决定 |
| WorkflowTrigger（`workflow_triggers`） | `org_id`, `kind`, `workflow_key`, `version`, `owner_user_id`, `agent_id`, `secret_ref` | 运行身份 = owner |
| checkpoint | schema `langgraph_workflow`，`checkpoint_ns = key:version`，`thread_id = instanceId` | 只存编排状态与指针 |

表名以本节为准（02 号文件 R1 声明「名称以契约束 domain.md 为准」）。

## 三、封闭枚举（新增成员须走 ADR；测试断言「集合一致 + 未声明值不通过」，不断言长度）

- `WorkflowInstanceStatus`：running / awaiting_gate_decision / blocked_permission / cancelling / succeeded / failed / cancelled / rejected / needs_attention。
- 终态 `WORKFLOW_TERMINAL_STATUSES`：succeeded / failed / cancelled / rejected / needs_attention（02 号 R6）。
- `WorkflowStageStatus`、`WorkflowSideEffectClass`、`WorkflowTriggerKind`、`WorkflowGateDecision`、`WorkflowEffectReceiptStatus`、`WorkflowEventType`。
- `WorkflowErrorCode`（HTTP 失败）与 `WorkflowReasonCode`（运行中阻断原因）——两者不得混用同一枚举。

## 四、不变量（任何时刻为真，违反即数据损坏；每条可写成断言）

- **I-1** 每行 workflow_* 业务表都带 `org_id`，且实例、事件、receipt、lease、stage_output 的 `org_id` 与其实例一致。
- **I-2** `workflow_definition_versions` 中 `status='published'` 的行，其 `graph_ref / stages / input_schema` 永不改变（只可迁到 `retired`）。
- **I-3** 任一 published 版本的 `graph_ref` 在代码图工厂注册表中存在，且 `stages[*].stageId` 集合 == 该图节点集合（一一对应）。
- **I-4** 任一实例的 `definition_version` 与 `pinned_skills` 在创建后永不改变（ADR-118 第 5 条）。
- **I-5** 任一实例的 `pinned_skills` 覆盖其版本定义中每个 `stages[*].skills[*]`，且每项指向一个已发布 Skill 版本；执行 Agent 的 `skill_version_ids` **不要求**包含它们（ADR-118 第 9 条）。
- **I-6** 对同一 `(org_id, request_key)` 至多一条 command receipt；因此至多一个实例由同一 requestId / Idempotency-Key / pg-boss 作业 id 创建。
- **I-7** 同一 receipt 的 `fingerprint` 永不改变；finalized 后 `stable_response` 永不改变。
- **I-8** projection 的所有字段可由业务行（instances / stage_outputs / events / receipts）重建；读路径代码不引用 `channel_values`（grep 门，ADR-118 第 4 条）。
- **I-9** checkpoint 只存在于 schema `langgraph_workflow`，`checkpoint_ns` == 实例的 `key:version`，`thread_id` == `instanceId`；`application|infrastructure` 下 `new PostgresSaver` 只出现在 checkpointer 工厂一处。
- **I-10** 每实例 `workflow_events.seq` 从 1 起严格单调 +1、无空洞、无重复（`(instance_id, seq)` 唯一）。
- **I-11** 每个状态变化先有 event 行，再有推送；任何已推送的 delta 的 seq 都存在于 `workflow_events`。
- **I-12** 终态实例的 `status` 永不再改变；`state_version` 每次状态变化严格 +1。
- **I-13** 每条 effect receipt 以 `(instance_id, stage_id, effect_key)` 唯一；其 `begin` 之前存在同实例、同时刻有效 epoch 的 lease，并存在一次执行前权限重查记录（发起人 ∩ Agent 权限 ∩ ToolExecutionAuthority ∩ MCP sideEffect 封顶）。
- **I-14** status=`begun` 的 effect receipt 在恢复路径上不产生第二次外部调用；它只能迁到 `reconciled`（只读对账）或 `unresolved`（实例 `needs_attention`）。
- **I-15** 事件 payload、provenance、gate 预览不含 webhook 密钥与原始凭证。
- **I-16** 每实例同时至多一个有效 lease；lease 获取是 epoch CAS，epoch 单调递增。
- **I-17** 每个 gate 至多一个 decision；`denied` 必带非空 reason；denied 的 gate 所在阶段无对应 effect receipt。gate 决定不可撤销。
- **I-18** 决定者 ∈ 该门的指定审批人集合；`allowSelfApproval=false` 时决定者 ≠ 发起人。

## 五、规则（不是不变量，由用例执行）

- 审批通过不等于授权永久有效：执行前照常重查（I-13 的记录是结果，不是规则本身）。
- 权限被拒后不得用同分类的其他供应商静默重试（ADR-120 第 3 条）。
- 数字访谈不迁移（ADR-118 第 8 条 Stage 2）；本束只迁引导式研究。
