# 契约束 `work-content` — ② 用例（签核面第 ② 件）

> 依据：`requirements/05-content-lines.md` R1–R12。形状单源：`packages/contracts/src/work-content.ts` 的 `operations.<op>`；
> 通用失败码来自 `workflow-runtime.ts` 的 `WorkflowErrorCode`，内容线专属失败码来自 `WorkContentErrorCode`。不变量编号见 `domain.md`。
> 启动 / 读实例 / SSE / 通用 approve·deny 走 `workflowRuntime.*`（workflow-runtime 束），本束不复述。

## 一、对外用例（有 HTTP 面）

### UC-WC-1 Workflow 目录 — `listWorkflowCatalog`（CT02/CT05/CT08/CT11）
- in: `{line?, agentId?}`；out: `{items: WorkflowCatalogItem[]}`
- 可见：组织成员；只返回本组织已导入的 Workflow。`agentId` 给出时标出该 Agent 白名单内项（UI 用）。
- 规则：注册失败项 `availability=unavailable`、`unavailableReason=workflow_skill_pin_unresolved`、列出 `unresolvedPins`（E2，I-C4）。
- err: 无（空列表是合法空态）。

### UC-WC-2 目录详情 — `getWorkflowCatalogEntry`
- out: `WorkflowCatalogItem`（阶段、门、双签标记、效果能力分类、skillPins）。
- err: `workflow_not_found`（他组织一律 404）。

### UC-WC-3 读产出 — `getInstanceOutput`（CT03/CT06/CT09）
- out: `outcome`、`output`（ResearchBrief | DataNeedsStatement | PrdArtifact）、`crmItems`、`manualChecklist`、`deferredProposals`。
- 可见性同 `workflowRuntime.getInstance`。
- 规则：ResearchBrief 每条 claim 有 evidenceRefs（I-C6）；A4 时 `output.kind=data_needs_statement` 且 `outcome=with_holds`。
- err: `workflow_not_found`。

### UC-WC-4 读线索决定卡 — `getLeadDecisionCard`（CT09）
- out: 每条线索的分层 / 分诊 / 卫生问题 / 证据 / `recordVersion` / `itemDigest` / 执行结果 / 冲突差异。
- err: `workflow_not_found` | `gate_not_open`。

### UC-WC-5 线索逐条决定 — `decideLeadItems`（CT09）
- pre: 调用者属 W011 规定审批资格（队列经理 / RevOps / 本人线索）。
- 步骤：校验 `itemDigest` 与当前一致（否则 `lead_decision_stale`）→ 记录决定 → 全部条目决定后门关闭 → 对每条 approve：P2 重查审批资格 → effect-gateway P3 重查 `crm.write` + 携带 `recordVersion` 乐观写 → P4 核实收件人读权限后 `notify.inapp`。
- 逐条结果：`written` | `conflict`(E4，读回当前值，展示差异，需重新批准) | `forbidden`(E5，落事件，已写不回滚) | `written_manual`(A5) | `rejected`(E7，零副作用) | `held`(E11)。
- 崩溃恢复：未 finalize receipt 先读回再决定，重放不写第二次（E6，I-C8）。
- err: `workflow_not_found` | `gate_not_open` | `not_designated_approver` | `self_approval_forbidden` | `state_version_conflict` | `idempotency_key_reused` | `lead_decision_stale` | `gate_item_not_found`。

### UC-WC-6 W013 三联决定 — `decideMeetingFollowup`（CT08/CT09 范围内的 W013）
- in: `recordDigest + framingDecision + changeSetDigest + decision`。
- 规则：批准绑定三元组；审批人改选 framing（A3）→ 服务端重算 changeSetDigest，旧批准失效 → `lead_decision_stale`；新商机只写 5 字段（I-C13）；跟进邮件走独立 G2 + `mail.send`，收件人由服务端解析（I-C14）；事件触发实例无自动批准（I-C10，E8 超时 → `review_expired` 事件，不批准）。
- err: `workflow_not_found` | `gate_not_open` | `not_designated_approver` | `state_version_conflict` | `lead_decision_stale`。

### UC-WC-7 Board 运行卡 — `listBoardRunCards`（CT10）
- in: `{projectId?}`；out: `{cards: BoardWorkflowRunCard[]}`
- 步骤：按查看者读权限过滤实例（E10）→ 纯函数映射（I-C11）→ 与任务卡合并进 `card-projection` 两视图。
- A1：无发起 Agent 时 `agents=[]`，只显示发起人。
- err: 无（无权限 = 卡不存在，不是错误）。

### UC-WC-8 81 实体对账 — `getPhase1Reconciliation`（CT11）
- pre: 组织管理员 / 平台运营（只读目录元数据，不读租户实例）。
- out: 期望 58/19/4；`missing`、`unexpected`（W017 出现即进此）；每实体 `visibleCount=1` 且 `gateStatusPresent`；`ok` 全真才真。

### 白名单外发起（CT06，E3）
- 走 `workflowRuntime.startInstance`（Runtime start 准入内判定，HTTP / 定时 / webhook 同一路径），HTTP 403 `workflow_not_allowed`，body = `WorkflowNotAllowedErrorBody`（`WorkflowErrorBody` + `allowlistHint: WorkflowNotAllowlistedHint{code: workflow_not_allowlisted, handoffCandidates}`）（例 D011→W030 → `["D003"]`），不静默降级。

## 二、内部用例（无 HTTP 面）

- **UC-WC-I1 构建 pack**（CT01/CT04/CT07）：`skills/work-<line>/` → `skills/starter-packs/work-<line>/1.0.0.json`；逐文件 sha256；manifest 过 WorkSkillManifest 校验；缺 v2 ID / digest 不符 / 引用未 PASS 实体 → 退出非 0 列出实体 ID 与字段，不产出文件（E1，I-C3）。
- **UC-WC-I2 导入 pack**：复用 work-skill-meta 束 `POST /admin/skills/starter-pack-imports`，本束不新增接口。
- **UC-WC-I3 注册 Workflow 定义**（CT02/CT05/CT08）：图工厂注册 + skillPins 解析；失败只标该 Workflow 不可用（E2，I-C4）。
- **UC-WC-I4 矩阵闭合 lint**（V8）：解析两张矩阵，比对全部定义与角色包；任何差异退出非 0。
- **UC-WC-I5 三条旅程 e2e**（CT03/CT06/CT09）：回环模型 + 桩工具，单条 ≤ 5 分钟（R10）。

## 三、开放问题（请签核人裁决）

- **Q1 状态词汇**：05 号 R3/CT10 写 `requested / awaiting_* / completed*`，现有 `WorkflowInstanceStatus` 无这些值。本束按 I-C11 映射到现有枚举，并用 `succeeded + outcome=with_holds` 表达 `completed_with_holds`。是否接受，还是要求 runtime 束新增状态？
- **Q2 失败码**：05 号用 `WORKFLOW_NOT_ALLOWLISTED` / `WORKFLOW_SKILL_PIN_UNRESOLVED`（大写），runtime 已有 `workflow_not_allowed` / `skill_version_unresolved`。本束复用 runtime 的 HTTP 码并以 body 细分。是否同意，或统一改名？
- **Q3 Pin 门槛**：05 号 E2 写「门状态低于 G2 即注册失败」，ADR-119 #4 写「只有过 G5 的 verified Skill 能被官方 Agent 绑定」。Workflow pin 的最低门到底是 G2 还是 G5（ADR-118 #9 说 Agent 不挂载，那 ADR-119 #4 是否覆盖 pin）？
- **Q4 skillGaps 放哪**：`agent-role.ts` 当前无 `skillGaps` 字段；D011 的 3 条 gap 应加到 agent-role 契约，还是只放在角色包 JSON？
- **Q5 Board 来源值**：`board.SourceKind` 全是中文值，`workflow_run` 是英文提案名；新值应叫「Workflow 运行」还是 `workflow_run`？
- **Q6 `cancelled` / `needs_attention` 徽标**：本束归入 `failed` 徽标；是否需要独立「已取消」「需处理」徽标？
- **Q7 对账接口可见性**：`getPhase1Reconciliation` 是否只给平台运营（跨组织目录），还是组织管理员也可看本组织视角？
