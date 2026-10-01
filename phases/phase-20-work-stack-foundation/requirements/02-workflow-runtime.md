# 通用 Workflow Runtime（workflow-runtime）

> 元数据：估点 **34**（迭代 3 核心 ≈18：domain/ports 与版本固定 5、checkpointer 工厂 + 统一 receipt/lease 6、start/resume/cancel API + SSE 信封 7；迭代 4 ≈16：effect-gateway 权限重查 4、人工门 approve/deny 3、pg-boss + webhook 触发 3、引导式研究迁移 4、运行面板 + 审批 UI 2（UI 主体随契约束 `workflow-runtime` 的 ui.md 另核）。与 `../feature_list.json` 中 spec_ref 指向本文件的 feature 点数之和对账，由 validate-fl 核对）。

> 权威依据：`docs/adr/ADR-118-generic-workflow-runtime.md`（第 1–9 条）、`docs/proposals/PROP-WORK-STACK-001.md`（先读「修订 R1」，再读 §4.2）、`docs/adr/ADR-116`（Agent = 数字人、`workflowAllowlist`）、`docs/adr/ADR-120`（工具能力分类 `capabilityCategory`）、`docs/proposals/WORK-STACK-PHASE1-IMPL.plan.md`（迭代 3、4 验收行）。实体样例：`requirements/work-stack-v2/workflows/W001-research-to-brief.md`（§2 Skill 版本冻结、§8 receipt 与崩溃恢复、§10 落点）。
> 契约束：`contracts/workflow-runtime/`（ui / usecases / domain / coverage / design-signoff）。**签核状态由人类填写，本文件不涉及。**

## 现状基线（本文件所有"现有代码"断言只来自以下已读文件）
- 引导式研究：`apps/api/src/application/research/guided-research-workflow-graph.ts`（`graphVersion` 仅是 state 字段，每次命令 +1）、`guided-workflow-service.ts`（`checkpointConfig` 以 `thread_id: sessionId`；sha256 `fingerprint` 做幂等）、`guided-workflow-receipt-ports.ts`（`find / begin / finalize` 三段 receipt，finalize 带 `checkpointId`、`graphVersion`、`stableResponse`）、`guided-report-stream.ts`（`snapshot` + `report_delta` 带 `sequence`）。
- `apps/api/src/infrastructure/research/langgraph-guided-research-runtime.ts`：`new PostgresSaver(new pg.Pool({...config, max: 5}), undefined, { schema: "langgraph_interview" })`，并从 `../interview/workflow/langgraph-digital-interview-runtime` 反向 import `withCheckpointNamespace`——即 ADR-118「背景」所述的跨域耦合与共用 schema。
- 数字访谈：`infrastructure/interview/workflow/langgraph-digital-interview-runtime.ts`（`withCheckpointNamespace` → `FixedNamespaceCheckpointSaver`）、`digital-report-lease.ts`（5 分钟无进展可接管）、`pg-digital-interview-effects.ts`（1847 行，本阶段**不迁移**）。
- Agent run：`application/agent-run/run-lease.ts`（`RunLease{orgId, runId, epoch, verify}`、`assertCurrentRunLease()` 在出站副作用前调用）、`tool-execution-authority.ts`（`ToolExecutionAuthority`）、`validate-interrupt-decision.ts`。
- 定时：`infrastructure/agent-run/pg-boss-scheduler.ts`（队列 `workspacex-scheduled-run`，schema `workspacex_scheduler`，只能唤醒 agent run）。
- 接口：`interface/controllers/guided-research.controller.ts`（`getGuidedResearchWorkflow`、`executeGuidedResearchNode`、`confirmResearch*`、`streamGuidedResearchRuntime` 等 operations）；前端 `apps/web/components/research-studio/guided-research-live.tsx` 等。
- 基线无 `apps/api/src/{domain,application,infrastructure}/workflow/` 顶层目录、无 `workflow_stage_outputs` 表、无 effect-gateway、无 webhook 触发（W001 §10 同样标注 proposed-unwired）。

## R1 概览（Use Case 名称 / Actor / 目标 / 系统边界）
- **Use Case 名称**：启动、推进、审批、恢复与取消一个版本固定的 Workflow 实例。
- **Actor**：
  - 组织成员（发起人）：在 Workspace 里对某个角色 Agent 发起一个 Workflow 运行。
  - 审批人：被 Workflow 定义的人工门（humanGate）指定、有权批准/拒绝某阶段副作用的成员。
  - 角色 Agent（ADR-116：Agent 即数字人）：在 `workflowAllowlist` 允许的 Workflow 版本内执行阶段。
  - 触发源（系统 Actor）：pg-boss 定时任务、外部 webhook 调用方。
  - 组织管理员：发布 WorkflowDefinition 版本、配置 webhook 密钥、查看全组织实例。
- **目标**：第一阶段 19 个 Workflow 和迁移后的引导式研究共用**一个**运行时——统一 checkpointer、receipt、lease、SSE、副作用网关和触发器，崩溃后可恢复且不重复副作用，外部副作用执行前重查权限并可经人工门拦截。
- **系统边界**：
  - 新建 `apps/api/src/domain/workflow/`、`application/workflow/`、`infrastructure/workflow/`（ADR-118 第 1 条）；ports：`WorkflowDefinitionStore`、`WorkflowInstanceStore`、`WorkflowReceiptStore`、`WorkflowLeaseStore`、`WorkflowEventLog`、`WorkflowTriggerStore`。
  - `packages/contracts` 新增 workflow operations 与 SSE 信封 schema（API 契约单源）。
  - 数据：`workflow_definitions`、`workflow_definition_versions`、`workflow_instances`、`workflow_stage_outputs`、`workflow_receipts`、`workflow_leases`、`workflow_events`、`workflow_triggers`（名称以契约束 domain.md 为准）；checkpoint 独立 schema `langgraph_workflow`。
  - 引导式研究迁到新运行时（ADR-118 第 8 条 Stage 1）；数字访谈**不**迁（Stage 2）。
  - 前端：Workflow 运行面板 + 审批 UI（`apps/web`）。
  - 边界外：Skill 目录（01 号文件 / 迭代 2）、Agent 扩展与白名单编辑 UI（迭代 5）、Eval 与门（迭代 6）、Board 投影（迭代 10）。

## R2 前置条件 / 触发条件
- **前置条件**：
  - 目标 WorkflowDefinition 至少有一个 `published` 版本，其 `stages[*].skills[*] = {stableId, versionRange}` 可在启动时解析到已发布的 Skill 版本（W001 §2 的形态）。
  - 执行 Agent 的当前 `agent_versions` 在 `workflowAllowlist` 中包含该 `workflowKey@version`（ADR-116 第 3 条）；Agent **不需要**挂载这些 Skill（ADR-118 第 9 条）。
  - 发起人是该组织成员，且对该 Agent 有运行权限（沿用 Agent 现有三层权限交集）。
  - webhook 触发：组织已配置该 Workflow 的 webhook 触发器与签名密钥。
- **触发条件**：
  - 手动：`POST /workflows/{key}/instances`（start）。
  - 定时：pg-boss 作业到期，payload 为 `{kind: "workflow", triggerId}`（泛化现有 `workspacex-scheduled-run` 队列，原 agent-run 唤醒保持兼容）。
  - webhook：`POST /workflow-triggers/{triggerId}/webhook`，带签名头与 `Idempotency-Key`。
  - 人工门：审批人对 `awaiting_gate_decision` 阶段调用 approve / deny。
  - 恢复：进程重启后 lease 过期的实例由 worker 接管 resume；或用户在面板点「继续」。

## R3 主流程
1. 管理员 → 发布 WorkflowDefinition 版本（元数据：阶段、每阶段 Skill 引用、工具能力分类、sideEffect 类别、humanGate）→ 系统校验：图工厂 `key:version` 已在代码注册表中存在、阶段 id 与图节点一一对应、Skill 引用可解析；通过后版本置 `published`，**不可变**。
2. 发起人 → 在运行面板选 Agent 与 Workflow，填 trigger 输入并提交 start（带客户端 `requestId`）→ 系统：
   a. 以 `(orgId, requestId)` 查 receipt，命中且指纹一致则直接返回原响应；
   b. 校验 `workflowAllowlist`、trigger 输入 schema；
   c. 解析并**冻结** WorkflowDefinition 版本和每个 Skill 版本进 `workflow_instances`（ADR-118 第 5 条）；
   d. `receipt.begin` → 建实例（`status=running`, `stateVersion=1`）→ 取 lease（`epoch=1`）→ `receipt.finalize`（记 `checkpointId`、`definitionVersion`、稳定响应）；
   e. 返回 `{instanceId, status, stateVersion}`，HTTP 201。
3. 运行时 worker → 用 checkpointer 工厂取 saver（schema `langgraph_workflow`，`checkpoint_ns = key:version`，`thread_id = instanceId`，共享连接池）→ 按冻结版本的图工厂执行下一阶段。
4. 每个阶段 → 业务产出写 `workflow_stage_outputs`（`instanceId + stageId + attempt`）后才推进 checkpoint；checkpoint 只存指针（ADR-118 第 4 条）；projection 只读业务行，**不读** `channel_values`。
5. 阶段需要外部副作用（如 `crm.write`、`mail.send`）→ 调 `effect-gateway`：
   a. `assertLease`（epoch 仍是自己的）；
   b. **重查权限**：发起人与 Agent 当前权限交集、`ToolExecutionAuthority` 对该工具/能力分类的授权、MCP `sideEffect` 封顶；
   c. 以 `(instanceId, stageId, effectKey)` 写 effect receipt `begin`；
   d. 调用工具 → `finalize` 结果 + provenance（谁、哪个 Agent 版本、哪个 Skill 版本、哪次审批）。
6. 阶段定义了 humanGate → 实例置 `awaiting_gate_decision`，事件日志写 `gate_opened`（含待执行副作用的预览），通知审批人；运行时释放 lease 并挂起（LangGraph interrupt）。
7. 审批人 → 在审批 UI 点「批准」（带 `expectedStateVersion` 与 `requestId`）→ 系统校验审批人资格与版本 → 记审批决定 → 恢复执行，第 5 步照常重查权限后执行副作用。
8. 全程 → 每个状态变化先写 `workflow_events`（单调 `seq`），再经 SSE 推送；信封 `{instanceId, seq, type: "snapshot"|"delta", stateVersion, payload}`。客户端带 `Last-Event-ID`（=最后 seq）重连时，从 `seq+1` 补发；若差距超保留窗口，先发一个 `snapshot`。
9. 最后一个阶段完成 → 实例置 `succeeded`，产出指向业务行；面板显示终态与产出链接。
10. 发起人 → 可随时 cancel（带 `expectedStateVersion`）→ 实例置 `cancelling`，当前阶段在下一个副作用前被 effect-gateway 拦下 → 置 `cancelled`；已 finalize 的副作用不回滚，只在 provenance 中列出。
11. 定时/webhook 触发 → 系统以触发器配置的「运行身份」（发起人 = 触发器 owner）走第 2 步；webhook 以 `Idempotency-Key` 作 `requestId`。
12. 引导式研究迁移 → `guided-research-workflow-graph.ts` 注册为 `guided-research@1`；`guided-research.controller.ts` 现有 operations 保持路径与响应形状不变，内部改走 workflow 用例；receipt 迁到 `workflow_receipts`（沿用 begin/finalize 形状）；checkpoint 从 `langgraph_interview` 迁至 `langgraph_workflow`；删除对 `../interview/workflow/langgraph-digital-interview-runtime` 的反向 import。

## R4 备选流程与异常流程
- **备选流程**：
  - A1：同一 `requestId` 重复 start / approve → 返回首次稳定响应，不新建实例、不重复审批（沿用 guided research 的 fingerprint 语义）。
  - A2：WorkflowDefinition 发布了 v2 → 在跑的 v1 实例继续按 v1 与其冻结的 Skill 版本跑完；只有新实例用 v2。面板在实例头部显示所固定的版本号。
  - A3：阶段无副作用也无人工门 → 连续推进，SSE 只发 delta。
  - A4：审批人「拒绝」（deny，必填理由）→ 该副作用不执行（无 effect receipt `begin`）；按定义走 `onDeny` 分支（回到上一阶段修改或实例置 `rejected` 终态），理由写入事件日志。
  - A5：多个审批人 → 第一个有效决定生效，后到的决定得 409 `gate_already_decided` 并看到已决定的人与结果。
  - A6：Agent 被从 `workflowAllowlist` 移除 → 在跑实例不中断（版本固定），但新 start 被拒；恢复阶段的副作用仍由第 5 步重查权限决定。
- **异常流程**：
  - E1：进程在副作用 `begin` 后、`finalize` 前崩溃 → 恢复时发现未 finalize 的 effect receipt，**不重放**调用，改为按工具的只读对账（有 `reconcile` 则查远端，否则实例置 `needs_attention` 并提示人工核对）；与 `run-lease.ts` 注释「已派发操作接管时不重放」一致。
  - E2：两个 worker 同时 resume 同一实例 → lease 以 `epoch` CAS 获取，失败者得 `lease_conflict` 并退出；持有者 epoch 过期后任何副作用前的 `assertLease` 抛 `workflow_lease_lost`，不产生外部调用。
  - E3：客户端 cancel/approve 带过期 `expectedStateVersion` → 409 `state_version_conflict`，响应体带最新 projection（同 `GuidedResearchWorkflowError.latestProjection` 形状）。
  - E4：effect-gateway 重查权限失败（发起人被移出组织、工具授权被撤、能力分类超出 MCP sideEffect 封顶）→ 副作用不执行，阶段置 `blocked_permission`，事件记 `reasonCode`，面板显示「权限已变更，需管理员处理」；不自动重试。
  - E5：start 时 Skill `versionRange` 无法解析到已发布版本 → 422 `skill_version_unresolved`，列出缺失的 stableId，不建实例。
  - E6：start 时 Agent 不在白名单 / 发起人无 Agent 运行权限 → 403 `workflow_not_allowed`；面板中该 Workflow 不出现在「可运行」列表。
  - E7：webhook 签名校验失败或时间戳超窗 → 401，不写 receipt、不建实例；同一 `Idempotency-Key` 但 payload 指纹不同 → 409 `idempotency_key_reused`。
  - E8：pg-boss 作业重复投递 → 以作业 id 作 `requestId`，第二次命中 receipt，不重复建实例。
  - E9：阶段内模型/工具调用失败 → 阶段 `attempt+1` 重试到定义的上限，超限实例置 `failed` 并保留已完成阶段的业务行；面板提供「从该阶段重试」（新 attempt，旧 attempt 业务行保留）。
  - E10：SSE 断线 → 实例继续在服务端运行（不依赖连接）；重连按 `Last-Event-ID` 补发，无缺号、无重复 seq。
  - E11：checkpoint 丢失或损坏 → 实例置 `needs_attention`，projection 仍能从业务行显示已完成阶段；不从 checkpoint 编造状态。
  - E12：引导式研究迁移期间存在 `langgraph_interview` 中的在跑会话 → 迁移脚本逐条搬 checkpoint 并校验；搬不动的会话保持只读可查看，报告列出清单，不静默丢弃。
  - E13：审批人打开审批 UI 时门已被他人决定或实例已取消 → 按钮禁用并显示当前状态，不允许提交。

## R5 权限与可见性
- 组织成员（发起人）：可对自己有运行权限、且在白名单允许内的 Agent 启动 Workflow；可查看、取消、恢复**自己发起**的实例；看得到自己实例的事件与产出。
- 审批人：只能对被人工门指定（按角色或具体成员）的阶段 approve/deny；可只读查看该实例（为审批所需的上下文）；不能 cancel 他人实例。发起人本人是否可自批由门定义 `allowSelfApproval` 决定，默认 **不可**。
- 组织管理员：可发布/下线 WorkflowDefinition 版本、管理 webhook 与定时触发器、查看与取消全组织实例；**不能**替审批人做决定，除非门定义把管理员列为审批人。
- 角色 Agent：只能执行白名单内固定版本；副作用仅经 effect-gateway，受发起人权限 ∩ Agent 工具策略 ∩ MCP 封顶约束。
- webhook 调用方：只能触发签名匹配的单个 triggerId，拿不到实例详情（仅返回 `{instanceId, status}`）。
- 其他组织成员 / 非成员 / 他组织：不能看到实例存在（404，不是 403）；面板不显示入口。

## R6 后置条件 / 不包含
- **后置条件**：
  - 每个实例有：固定的 definition 版本与 Skill 版本集合、单调事件日志、每个副作用的 receipt 与 provenance、终态之一（`succeeded` / `failed` / `cancelled` / `rejected` / `needs_attention`）。
  - 引导式研究的现有 e2e 在新运行时上全绿；`langgraph-guided-research-runtime.ts` 不再引用 interview 目录与 `langgraph_interview` schema。
- **不包含**：
  - 通用 DSL / 可视化编排器（ADR-118 第 2 条，推迟到 Stage 3）。
  - 数字访谈迁移（Stage 2，风险高）。
  - 实时语音（ADR-121 独立轨道）。
  - 19 个具体业务 Workflow 的内容实现（迭代 7–9）；本域只提供运行时与一个示例 Workflow。
  - Board 上的运行投影（迭代 10）。
  - Workflow 白名单的编辑 UI（迭代 5，agent-role 束）。

## R7 业务规则
- 业务行是事实，checkpoint 只是编排状态；任何 projection、UI、导出不得读 `channel_values`（ADR-118 第 4 条）。
- 实例固定启动时的 Definition 与 Skill 版本，不做在跑实例迁移（第 5 条）。
- 新 Workflow 不得自建 checkpointer、receipt 或 lease（ADR-118「后果」）；由 lint/测试门控：`application|infrastructure` 下 `new PostgresSaver` 只允许出现在 checkpointer 工厂中。
- 所有外部副作用必须经 effect-gateway，且执行前重查权限；审批通过不等于授权永久有效。
- 已 `begin` 未 `finalize` 的副作用永不盲目重放。
- 事件先落库再推送；SSE `seq` 每实例严格单调、无空洞。
- 拒绝必须带理由；审批决定不可撤销（要改需新实例或新 attempt）。
- 同一事实单一来源：SSE 信封、状态枚举、reasonCode 只在 `packages/contracts` 定义一次，前后端共用。

## R8 界面线索
- 前端入口：
  - Agent 详情 / 对话页的「运行 Workflow」按钮 → 选择白名单内 Workflow 与版本 → trigger 输入表单（按 Definition 的 trigger schema 渲染）。
  - Workflow 运行面板（实例页）：阶段时间线（每阶段状态、attempt、固定的 Skill 版本）、实时日志（SSE）、产出链接、「取消」「从该阶段重试」按钮、固定版本徽标、`needs_attention` / `blocked_permission` 提示条。
  - 审批 UI：待我审批列表 + 审批抽屉（副作用预览、目标系统与能力分类、发起人与 Agent、批准 / 拒绝(必填理由)）；已决定时只读显示结果。
  - 「我的运行」列表：按状态筛选。
  - 引导式研究现有 `research-studio` 页面保持外观不变（迁移只换后端）。
- 线框：待 UI 先行阶段产出，放在 `contracts/workflow-runtime/ui.md`；需覆盖运行中、等待审批、被拒、权限阻断、断线重连、失败可重试、空列表七种态。
- 提醒：开工前 UI 须随契约束 `workflow-runtime` 的 `design-signoff.md` 第 ① 节由人类签核（ADR-023）；本阶段按 2026-09-28 人类授权可先开发、后补签。

## R9 非功能约束
- 性能/规模：单组织并发 50 个运行中实例；checkpointer 共享一个连接池（上限沿用现有 `max: 5` 量级，按配置可调），不得每实例建池；SSE 从事件落库到推送 p95 < 1s；重连补发 1000 条事件 < 2s。
- 安全/隐私/合规：webhook HMAC-SHA256 签名 + 5 分钟时间戳窗口 + 密钥可轮换；事件日志与 provenance 不写入密钥与原始凭证；所有表带 `org_id` 并按组织隔离；审计：审批与副作用 provenance 保留期与现有审计日志一致。
- 兼容与降级：引导式研究现有 API 路径与响应形状不变；pg-boss 原 agent-run 唤醒作业不受影响；SSE 不可用时面板降级为轮询 projection（与 `getGuidedResearchRuntimeProgress` 同类）。

## R10 已知约束 / 依赖
- 依赖：`@langchain/langgraph` + `@langchain/langgraph-checkpoint-postgres`（已在用）；pg-boss（已在用）；`ToolExecutionAuthority`；Agent 版本的 `workflowAllowlist`（迭代 5 落字段，迭代 3–4 先以 port 注入并用测试桩）；Skill 目录版本解析（迭代 2，01 号文件）；ADR-120 `capabilityCategory`（缺失时按 MCP `sideEffect` 封顶保守判）。
- 技术约束：NestJS 洋葱架构（domain 不依赖 infrastructure）；DB 迁移沿用仓库现有迁移工具；业务源文件 ≤ 2000 行。

## R11 切分提示
- 迭代 3：
  1. WF01 domain 模型 + ports + 版本固定（Definition/Version/Instance、状态机、Skill 版本冻结）。
  2. WF02 checkpointer 工厂（`langgraph_workflow`、`key:version` 命名空间、共享池）+ 统一 receipt + lease（epoch CAS）。
  3. WF03 start/resume/cancel API + 事件日志 + SSE 信封 + 示例 Workflow（崩溃恢复测试载体）。
- 迭代 4：
  4. WF04 effect-gateway（权限重查 + effect receipt + provenance + 不重放对账）。
  5. 人工门 approve/deny + 审批 UI。
  6. pg-boss 泛化 + webhook 触发（签名、幂等键）。
  7. WF05 引导式研究迁移（含 checkpoint 数据迁移与反向 import 清除）。
  8. 运行面板 UI（可与 5 合并视点数）。
- 依赖顺序：1 → 2 → 3 → 4 → {5, 6} → 7；8 依赖 3 与 5。

## R12 AI Ready 验收线索
- 成功态：示例 Workflow start 返回 201 且实例记录固定的 definition 与 Skill 版本；逐阶段推进后 `succeeded`；`workflow_stage_outputs` 每阶段有行；projection 结果与业务行一致且代码中 projection 不引用 `channel_values`（grep 门）。
- 版本固定（A2）：v1 实例运行中发布 v2，v1 实例仍以 v1 图与原 Skill 版本完成，新实例用 v2。
- 幂等（A1/E8）：同一 `requestId` 两次 start 只有 1 个实例、返回同一响应；重复投递的 pg-boss 作业只建 1 个实例。
- 崩溃恢复（E1）：注入「副作用 begin 后崩溃」→ 恢复后外部桩调用计数仍为 1，实例进入对账或 `needs_attention`。
- 并发（E2）：两个 resume 并发，恰好一个拿到 lease，另一个得 `lease_conflict`；epoch 过期后副作用前抛 `workflow_lease_lost`，桩调用计数 0。
- 版本冲突（E3）：过期 `expectedStateVersion` 的 cancel/approve 得 409 且响应含最新 projection。
- 权限重查（E4）：审批通过后、执行前撤销工具授权 → 副作用不执行，阶段 `blocked_permission`，带 reasonCode。
- 启动拒绝（E5/E6）：Skill 版本不可解析 → 422 `skill_version_unresolved`；Agent 不在白名单 → 403 `workflow_not_allowed`；他组织成员查询实例 → 404。
- 审批（A4/A5/E13）：deny 后无 effect receipt、无外部调用、理由入事件日志；两人同时审批第二人得 409 `gate_already_decided`；未被指定的成员审批得 403；发起人默认不能自批。
- webhook（E7）：错误签名 401 且无实例；同 `Idempotency-Key` 不同 payload 409；正确调用返回 `{instanceId, status}`。
- SSE（E10）：断线后带 `Last-Event-ID` 重连，收到的 seq 连续无重复；超保留窗口先收到 `snapshot`。
- 失败重试（E9/E11）：阶段超限失败后 `failed`，已完成阶段产出仍可见；「从该阶段重试」产生新 attempt。
- 取消：cancel 后下一个副作用被拦，终态 `cancelled`，已完成副作用列在 provenance。
- 迁移（R3-12/E12）：引导式研究现有 e2e 全绿；`grep -r "langgraph_interview\|interview/workflow" apps/api/src/infrastructure/research` 无结果；迁移报告列出未迁会话数（期望 0）。
- 统一性门：`new PostgresSaver` 只出现在 checkpointer 工厂一处；新 Workflow 无自建 receipt/lease 表。
- UI：运行面板展示七种态（运行中 / 等待审批 / 被拒 / 权限阻断 / 断线重连 / 失败可重试 / 空列表）；无运行权限用户看不到「运行 Workflow」入口。
