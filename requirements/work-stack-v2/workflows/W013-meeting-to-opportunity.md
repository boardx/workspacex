# W013 — Meeting-to-Opportunity（从客户会议到商机）

> 类型：Reference Workflow · 域：Sales · 作者化任务：AUTHOR-W013 · 状态：待独立评审
> Baseline：`main@30c1c4332025151610502988b0379b95ff7298c7`。标「已核实」的代码事实均在该基线用 `git show 30c1…:<path>` 读过；未读到证据的标 **UNVERIFIED**；基线上不存在或未接线的能力标 **proposed-unwired**。
> 权威：ADR-116；运行时：ADR-118（第 3 条统一 receipt、第 4 条业务行为事实、第 5 条实例钉版本、第 6 条 effect-gateway、第 7 条触发器、第 9 条 Workflow 钉 Skill 版本）；工具分类：ADR-120（第 1 条 `capabilityCategory`、第 3 条被拒不换供应商）；评测门：ADR-119。
> 对齐文档（只引用，不改）：已 PASS 的 `skills/S005-meeting-prep.md`、`skills/S006-meeting-summary.md`（后者只作划界）。S028 / S029 / S009 / S023 均已 PASS，本文按其终稿接口对接，§16 列出依赖；W012 已 PASS，本文只对接其 §7 终态（`brief_ready` / `meeting_booked_no_brief`）与 `briefId` 字段——W012 §2 仍写「从终态 `meeting_booked` 接手」，与其 §7 不一致，以 §7 为准（该处文本待 W012 修订，本文不改）。

## 1. 边界（一句话）
把**一场已经发生（或即将发生）的客户会议**变成：一份有原话证据的通话记录、一个经人确认的「建新商机 / 并入已有商机 / 暂不建」决定、一组逐字段批准后写入租户 CRM 的商机变更，以及（可选）一封经人确认后发出的客户跟进邮件。
- 不做首次约会（W012，W013 从 W012 lane 终态 `brief_ready` / `meeting_booked_no_brief` 接手）。
- 不做阶段推进判断、预测影响、成交计划（S030/S031/S032 所在 Workflow）。
- 不做内部会议纪要（S006 所在 Workflow；销售会用 S028，S006 §15 提议 3 已由 S028 §14 答复：只共享证据规则）。
- 不写线索 / 联系人 / 客户字段，不写 CRM 活动记录（图上无执行者，见决策 6 与 §16 提议 2）。

## 2. 组合图（逐字取自两张矩阵，不推导）
### 2.1 参与 Skill（`WORKFLOW-SKILL-MATRIX.md` 第 19 行：`W013 | Meeting-to-Opportunity | Sales | S005, S028, S029, S009, S023`）
| Skill | 名称 | 在 W013 中的用法 | 对接的契约位置 |
|---|---|---|---|
| S005 | Meeting Prep | 仅「会前触发」路径：`meetingStage="ongoing"` 生成会前简报，作为 S028 的对照基线 | S005 §5 `MeetingPrepInput`、§6 `MeetingPrepBrief`、不变量 `MEETING_ALREADY_STARTED` |
| S028 | Sales Call Summary | 会后第一个产物：`SalesCallRecord` | S028 §6 `SalesCallSummaryInput`、§7 `SalesCallRecord`、I1–I13（含 I11 no-brief 原因由 Workflow 声明、I12 框架键、I13 `possible-mnpi` ⇒ `followUpDraft=null`，P4 ④ 依赖 I13）、§7.2 错误 |
| S009 | Customer Research | `mode="account-dossier"`：把本次会议的新需求放回该账户历史客户原话与我方承诺台账 | S009 §5 `CustomerResearchRequest`、`dossier`、M3/M8 A1–A4、G6 交付前重验 |
| S023 | Account Planning | `mode="opportunity-framing"`：三选一提议 `create-new` / `merge-into` / `hold` | S023 §6 I1–I3、§7 `framingProposal`、O9、决策 4 |
| S029 | Opportunity Update | `phase="plan"` 产出带 digest 的变更集；写入后 `phase="verify"` 读回 | S029 §5/§6、决策 1/4、类型化错误 |

按 ADR-118 第 9 条，上述 5 个 Skill 的版本由 W013 定义钉住；运行 W013 的 Agent 不需要另外挂载它们。

### 2.2 消费者（`DIGITALHUMAN-COMPOSITION-MATRIX.md` 中 Exact Workflows 含 W013 的行，共 1 个）
- D005 Sales Representative（第 11 行：`W011, W012, W013, W014, W015, W016, W018`）。已对整张矩阵 grep `W013`：只命中第 11 行。
- D005 Skill 列含 S005、S028、S029、S023，**不含 S009**。按 ADR-118 第 9 条这不影响 W013 阶段 5 运行；S009 §2 已写明 D005 在聊天中直接调用 S009 会得到 `S009_NOT_INVOKABLE`。本文不据此提议补边。

### 2.3 相邻 Workflow（划界）
- W012 → W013：W012 lane 的 `briefId`（`first-contact` 简报）可作为 W013 的 `seedBriefId`，W013 不重跑 S005（决策 2）。
- W013 → W014/W015：W013 只写本次会议证据支撑的字段；阶段推进与预测由后者负责。

## 3. 实体特有决策
**决策 1 — 阶段顺序为 S005 → S028 → S009 → S023 → S029，不按矩阵列出顺序执行 S029。**
矩阵第 19 行列的是参与集合；W013 定义的阶段顺序是 Workflow 自己的设计（ADR-118 第 2 条：`WorkflowDefinition` 声明阶段）。S029 只更新**已存在**商机（S029 §1「不建新商机」），而「更新哪一个商机」要等 S023 的 `framingProposal`（`merge-into:<id>`）才知道；若 S029 先跑，它只能以调用方声明的 `claimedOpportunityId` 为目标，会把新购买单元的需求写进旧商机。这正是 S029 §14 提议 1 的两个选项之一（「S029 移到 S023 之后」），本文采用它。S009 放在 S028 之后，使 S028 的 `discoveredNeeds[].needId` 成为 S009 的 `questions[]`（回答 S028 §15 提议 2）。本决策不改矩阵任何边；§16 提议 1 请矩阵 owner 决定是否在矩阵注释中标明「列表为集合、非顺序」。

**决策 2 — S005 只在「会前触发且无可复用简报」时运行；会后触发永不补简报。**
S005 拒绝为已开始的会生成简报（`MEETING_ALREADY_STARTED`），而补写的「会前简报」会被 S028 M7 当作对照基线，产生伪造的「目标达成」判断。所以：会前触发 → 阶段 2 运行 S005(`ongoing`)；从 W012 接手 → 复用其 `briefId`，不重跑；会后触发（`trigger.kind="post_meeting_material"` 或 `recording_completed`）→ 跳过阶段 2，S028 以 `briefComparison="no-brief"` 运行。若会议改期，已生成简报失效并在新 `startAt` 前重跑 S005（与 W012 决策 7 同一规则）。

**决策 3 — 「建新商机」由平台 effect 阶段执行，不由任何 Skill 执行；新建记录只带最小字段集。**
矩阵第 19 行没有能建商机的 Skill（S023 只提议，S029 只更新已存在商机）。W013 阶段 9 由 effect-gateway 执行 `crm.write` 的 create，载荷仅限：`accountId`、`name`（人在 G1 填写，缺省由 W013 以 S023 `framingProposal.evidenceRefs` 所指 evidence 的 `buyingUnit` 与 `rationale` 摘要拼出供编辑——S023 §7 `framingProposal` 只有 `{decision, mergeTarget?, evidenceRefs, rationale}`，不直接提供 buyingUnit/product；无可用 buyingUnit 时缺省为空，由人填写）、组织配置的初始阶段、`ownerId = 发起人`、`sourceMeetingRef`。**不**把 S028 的 `amount` / `closeDate` / `stage` 提议写进新商机：这些值需要 S029 的前值比对与冲突规则，而新记录没有前值。它们被放进 `deferredProposals[]`，下一次针对该商机运行 W013 或 W014 时再经 S029 处理。代价是新商机首日缺金额；收益是 S031 预测不会吃到由单次通话推测出的金额（S023 决策 4、S029 决策 4 同一风险）。是否应新建一个「Opportunity Create」Skill 见 §16 提议 3。

**决策 4 — 客户跟进邮件由 W013 的 effect 阶段发送，不为此给 W013 加 S026 边。**
S028 已产出 `followUpDraft`（不含任何邮箱/电话，I8；`deliveryState="draft-not-sent"`，I10）。W013 需要的只是「人确认后原文发出」，不需要 S026 的序列、频控、勿扰判断——对象是刚开过会、已在对话中的客户。因此 W013 用独立人工门 G2 + `mail.send` effect 发送，回答 S028 §15 提议 1（S028 该处写作「W013 决策 3」，实为本决策 4，S028 待修订）。收件人**只**由服务端从日历事件外部参会人或 CRM 该商机联系人解析，永不取自转写正文或 `contentOriginatedRequests`（S028 I7）。

**决策 5 — 一个复核门 G1 绑定三份 digest；内容来源字段逐字段批准；无人值守触发永远停在 G1。**
G1 一次展示：S028 记录、S023 三选一提议（人可改选）、S029 变更集。批准记录绑定 `(recordDigest, framingDecision, changeSetDigest)` 三元组；任一上游在批准后被重算（如恢复后重跑）都使批准失效。S029 已规定 `origin ∈ {content-derived, call-summary}` ⇒ `approval.requires="per-field"` ∧ `unattendedAllowed=false` ∧ 警告 `W-CONTENT-ORIGIN`（W013 走的是 `call-summary`）；W013 在此之上规定：`trigger.kind ∈ {recording_completed, calendar_event_ended}` 的实例**不存在**任何自动批准路径，即使组织把 `crm.write` 授权为「需人工确认每次」以外的值（`checkToolScopeCap` 会封顶，见 §9 P3）。

**决策 6 — 不写 CRM 活动记录；以 `manualChecklist` 交还人。**
S028 的 `crmChangeProposals[field="activityLog"]` 与 S029 的字段语义不符（S029 字段集是商机字段；S029 §14 提议 3 已记录活动记录无执行者）。W013 不在 effect 阶段私自增加 `crm.activity.create` 写入：它会绕开 S029 的前值与冲突规则，而活动记录又是 W012 §16 提议 3 希望 W013 补的东西。W013 把活动记录草稿列入产出的 `manualChecklist`，并在 §16 提议 2 交矩阵 owner 决定。

**决策 7 — 录音同意不明时，原话证据仍可用于内部判断，但不得进入对外邮件、不得作为 CRM 字段的唯一证据。**
S028 在同意未核验时加 `complianceFlags: "recording-consent-unverified"`，并把「是否保留证据引用」交给 Workflow 人工门（S028 §10）。W013 规则：该标记存在时 G1 必须显式勾选「我确认已按 {jurisdiction} 取得录音同意」或「仅作内部参考」；选后者时，S029 变更集中**仅**由录音段支撑的字段置为不可批准，`followUpDraft` 不可进入 G2。

## 4. Trigger schema
```ts
// packages/contracts/src/workflow-definition.ts（ADR-118 新建，proposed-unwired）中 W013 的 trigger 输入
const W013Trigger = z.object({
  kind: z.enum([
    "pre_meeting",            // 人在会前发起（会议 startAt > now）
    "from_w012",              // W012 lane 终态 brief_ready / meeting_booked_no_brief 自动接手
    "post_meeting_material",  // 人在会后上传转写/笔记发起
    "recording_completed",    // 录音会话完成事件（webhook/事件总线，proposed-unwired，见 §15）
    "calendar_event_ended",   // 日历事件结束（calendar.read†，proposed-unwired）
  ]),
  requestId: z.string().uuid(),
  orgId: OrgId,
  initiatorUserId: UserId,                        // 权限主体；事件触发时 = 日历事件/录音会话的我方 owner，由服务端解析
  initiatorAgentVersionId: z.string().nullable(), // 须在该 Agent 的 workflowAllowlist 内（ADR-116 第 3 条；proposed-unwired）
  meeting: z.object({
    externalEventRef: z.string().nullable(),      // 日历事件 id；幂等键首选
    title: z.string().max(200),
    startAt: z.string().datetime({ offset: true }),
    durationMinutes: z.number().int().min(15).max(240),
    timezone: z.string(),                         // IANA
    meetingType: z.enum(["discovery", "demo", "follow-up", "negotiation"]),
  }),
  claimedAccountId: z.string(),                   // 调用方声明，阶段 1 服务端核验
  claimedOpportunityId: z.string().nullable(),
  attendees: z.array(z.object({ displayName: z.string(), side: z.enum(["us", "them"]), userId: UserId.optional(), contactRef: z.string().optional() })).min(2).max(30),
  material: SalesCallSummaryInput.shape.material.nullable(), // S028 §6；pre_meeting/from_w012 时为 null，阶段 3 等待
  seedBriefId: z.string().nullable(),             // from_w012 时 = W012 lane.briefId
  priorSummaryRefs: z.array(z.string()).max(5).default([]), // 传 S005 upstreamRefs.priorSummaryRefs
  qualificationFramework: z.enum(["MEDDICC", "BANT", "none"]).default("none"),
  followUp: z.object({ wanted: z.boolean().default(true), channel: z.enum(["email"]) }),
  jurisdiction: z.enum(["CN", "US"]),
  locale: z.enum(["zh-CN", "en-US"]),
  materialDeadlineHours: z.number().int().min(4).max(168).default(72), // 会议结束后多久无材料即 no_material
});
```
触发器规则：
- `from_w012` 只在 W012 lane `acceptance ∈ {accepted, confirmed_by_human}` 时发出；`seedBriefId` 必须满足 `MeetingPrepBrief.meetingStage="first-contact"` 且 `validUntil ≤ meeting.startAt`。
- 事件触发（`recording_completed`、`calendar_event_ended`）只能启动实例并跑到 G1，永不越过 G1（决策 5）。
- 同一会议只允许一个进行中实例：幂等键见 §10。

## 5. 阶段表
状态主线：`requested → validated → [prepping → brief_ready] → awaiting_material → [G0] → summarizing → researching → framing → planning → [G1] → P3 → applying → verifying → [G2] → P4 → sending → settled`

| # | stage | Skill IDs | 工具能力分类（ADR-120 提案名） | 状态转移 | sideEffect | humanGate |
|---|---|---|---|---|---|---|
| 1 | intake_resolve | —（平台） | `crm.read`†（账户/商机/联系人） | requested → P1 → validated ｜ → `account_unresolved` ｜ → `forbidden` | read | none |
| 2 | prep | S005（`ongoing`） | `knowledge.search`、`knowledge.read`、`project.read`（S005 §8） | validated → prepping → brief_ready ｜ 跳过（决策 2）→ awaiting_material ｜ `MEETING_ALREADY_STARTED` → awaiting_material（`briefId=null`） | read | none |
| 3 | await_material | —（平台） | `recording.read`†、`knowledge.read`；timer | brief_ready/awaiting_material → material_received ｜ `materialDeadlineHours` 超时 → `no_material` | read | **G0**：ask。无事件源时由人上传材料；`jurisdiction` 的录音同意确认（决策 7）在此收集 |
| 4 | summarize | S028 | `knowledge.read`；`recording.read`†；optional `crm.read`† | material_received → P2 → summarizing → summarized ｜ `S028_MATERIAL_EMPTY`/`S028_NO_CITABLE_SEGMENTS`/`S028_CONSENT_NOT_SATISFIED` → `material_unusable` | read | none |
| 5 | account_evidence | S009（`account-dossier`） | required `knowledge.read`；conditional（按 `sourceKinds`）`transcript.read`†（call-transcript）、`mail.search`†（email）、`crm.read`†（crm-note）等，以 S009 §9 为准 | summarized → P2 → researching → researched（`status="partial"` 亦为 researched，缺失来源记 coverageGap；`status="needs-clarification"` → researched，`dossierRef=null`，记 coverageGap，不在本 run 内追问）｜ `S009_SUBJECT_NOT_VISIBLE` → `forbidden` ｜ `S009_ALL_SOURCES_UNAVAILABLE` / `S009_CAPABILITY_NOT_GRANTED` → researched（`dossierRef=null`，记 coverageGap）｜ `S009_NOT_INVOKABLE` / `S009_INVALID_INPUT` → `failed`（运行时接线或映射缺陷，不静默降级） | read | none |
| 6 | frame | S023（`opportunity-framing`） | optional `crm.read`†、`knowledge.read` | researched → P2 → framing → framed | read | none |
| 7 | plan_update | S029（`plan`） | `crm.read`†（required，缺则 caller-supplied） | framed → planning → planned ｜ framing=`create-new` 或 `hold` 且无已关联商机 → planned（`changeSet=null`）｜ `OPP_UPDATE_TARGET_NOT_FOUND` / `OPP_UPDATE_TARGET_AMBIGUOUS` → planned（`changeSet=null`，G1 展示原因由人选目标或放弃）｜ `OPP_UPDATE_FIELD_UNMAPPED` → 该项剔除并记入 `deferredProposals[]`，其余继续 ｜ `OPP_UPDATE_FORBIDDEN` → `forbidden` ｜ `OPP_UPDATE_SOURCE_UNAVAILABLE` → planned（`changeSet=null`，记 coverageGap）｜ `OPP_UPDATE_INPUT_INVALID` → `failed` | read | none |
| 8 | review | —（平台表单） | — | planned → awaiting_review → approved ｜ → `review_rejected` ｜ 5 工作日超时 → `review_expired` | none | **G1**：required（决策 5、7）。批准后执行 **P3** |
| 9 | apply | —（effect-gateway） | `crm.write`†（create 与 update 两类工具） | approved → P3 → applying → applied ｜ `crm.write` 未授权/未接线 → `manual_checklist_only` ｜ P3 不可查 → `halted_unverifiable` | write | none（G1 覆盖；P3 逐次执行） |
| 10 | verify_update | S029（`verify`） | `crm.read`† | applied → verifying → verified ｜ 任一字段 `rejected`/`precondition-failed` → verified（`partial=true`）｜ `OPP_UPDATE_DIGEST_MISMATCH` → `failed`（批准绑定失效，零补写）｜ `OPP_UPDATE_RECEIPT_UNVERIFIED` → verified（`partial=true`，该字段标未核验，转人工核对） | read | none |
| 11 | approve_followup | —（平台表单） | — | verified/planned(无写入) → awaiting_send_approval → send_approved ｜ skip → settled ｜ `followUp.wanted=false` 或 draft 为 null → settled | none | **G2**：required，一次（决策 4）。批准后执行 **P4** |
| 12 | send_followup | —（effect-gateway） | `mail.send`† | send_approved → P4 → sending → sent → settled ｜ P4 失败 → settled（`followUp.outcome="blocked_at_p4"`） | high-impact | none（G2 覆盖） |

† = **proposed-unwired**：基线 `apps/api/src/application/` 无租户 CRM、日历、外发邮件目录；`apps/api/src/application/crm/crm-contact-ports.ts` 是平台运营的线索联系人仓储，不是客户商机数据源（S029 §13 的核对，本文未重读全文，**UNVERIFIED**），W013 **不得**读写它。`capabilityCategory` 字段本身未落地（ADR-120 状态为 Proposed）。

阶段输入映射（运行时注入，只传 id，不传正文）：
- **阶段 2 → S005**：`meetingRef = {title, startAt, durationMinutes, timezone}`；`meetingType`；`meetingStage="ongoing"`；`attendees` 映射 `side`；`accountRef` 缺省（S005 的 `accountRef` 形状 `{projectId?, leadId?}` 与租户 CRM accountId 不同构，见 §16 提议 4）；`upstreamRefs.priorSummaryRefs = trigger.priorSummaryRefs`；`jurisdiction`、`locale` 透传。
- **阶段 4 → S028**：`material`；`meetingPrepBriefRef = briefId ?? seedBriefId`（均 null 时不传）；`workflowRunRef = instanceId`；`claimedAccountId/claimedOpportunityId` 取阶段 1 **核验后**的值（核验失败时不传，S028 输出 `basis="caller-declared"`）；`claimedAttendees = trigger.attendees`（不含 email）；`callTypeHint = meeting.meetingType`；`qualificationFramework` 透传；`briefAbsenceReason`（S028 §6，M2b/I11）在不传 `meetingPrepBriefRef` 时必传：`trigger.kind="post_meeting_material"` 且无 seedBriefId → `post-meeting-trigger`（E3）；有 seedBriefId 但不可引入（运行时不支持 `importedRefs` 或简报失效）→ `seed-brief-not-importable`（E4）；其余（阶段 2 未产出简报）→ `prep-not-run`。不传会使 S028 记 `reason="not-supplied"`。注意：`seedBriefId` 属于 W012 实例，不属于本 run；S028 IN1 要求同 run，因此 W012 简报在阶段 1 被登记为本实例的「引入产物」（`importedRefs`，proposed-unwired 的运行时能力），否则只能 `no-brief` 运行（E4）。
- **阶段 5 → S009**：`mode="account-dossier"`；`subject={kind:"account", accountRef: verifiedAccountId}`（S009 M0：缺省值只来自触发载荷，不来自推断）；`questions = S028.discoveredNeeds.map(n => ({questionId: n.needId, text: n.statement}))`，为空时用单条「该客户过去 365 天自述的需求与我方承诺」；`window = { from: <startAt − 365d 的 ISO 日期>, to: <startAt 的 ISO 日期> }`（S009 §5 形状）；`sourceKinds = ["call-transcript","email","meeting-note","crm-note","ticket"]`；`purpose="account-planning"`。竞品名 `S028.competitorsMentioned[].name` 只作检索提示，不作问题。产出 `dossierRef` = S009 `CustomerEvidencePack.packId`。
- **阶段 6 → S023**：`mode="opportunity-framing"`；`accountId = verifiedAccountId`；`meetingRecordRef = S028.recordId`；`evidence` = S028 中 `side=them` 段的 `EvidenceRef` + S009 `dossier.statedNeeds/statedPains` 所指 `verbatim-*` 段（`reported-speech` 不传，S009 M3）；`workflowRunRef = instanceId`；`asOf = S028 记录生成时刻`（S023 必填）。每条 evidence 映射为 S023 §6 形状 `{evidenceRef, kind, quote, occurredAt, speakerRole, direction, contactRef?, buyingUnit?}`：S028 段 → `evidenceRef = S028 EvidenceRef.id`、`kind="transcript"`、`quote` 取原 `quote`、`occurredAt = meeting.startAt`（段级时间戳是否可得 **UNVERIFIED**）、`speakerRole="customer"`（仅 `side=them` 段入选）、`direction="two-way"`、`contactRef` 取该段已核验与会人（无则不传）；S009 CustomerSegment → 按其来源映射 `kind`（call-transcript→transcript、email→email、其余→customer-doc）、`occurredAt`/`speakerRole`/`direction` 取片段自带字段，片段缺 `speakerRole` 或 `direction` 时**不传**该条（不猜测）。O9 与决策 4 的 create-new 判据（`speakerRole=customer` ∧ `direction∈{inbound,two-way}`）只作用于这些显式映射值。S023 §2.1 把自己写成 W013「末位」，与决策 1（S029 在末位）不一致，以决策 1 为准（S023 该处待修订，本文不改）。
- **阶段 7 → S029(plan)**：目标商机 = `framingProposal.mergeTarget`（merge-into）或阶段 1 已核验的 `claimedOpportunityId`（仅当 framing 为 `hold` 且会议本就挂在该商机上）；`asOf = S028 记录生成时刻`（S029 plan 必填）；`changes` = S028 `crmChangeProposals` 中字段按 S029 §5 枚举映射的项：`nextStep`、`stage`、`amount`、`closeDate` 原名传入；S028 `contactRoles` → 逐人拆为 `field="contactRole"` 且必带 `contactRef`（无已核验 contactRef 的项剔除）；`nextStepDate`、`competitors` 不属 S029 枚举，只能作组织自定义 API 名传入，未映射时走 `OPP_UPDATE_FIELD_UNMAPPED` 风险路径（见阶段 7 行）。`amount` 须带 `currency`（ISO 4217）：取目标商机 CRM 现有币种（经 `crm.read`†），读不到则该项剔除并记入 `deferredProposals[]`，不以 S028 `amountBasis` 猜币种。每项 `source.kind="call-summary"`、`skillId="S028"`、`proposalRef="crmChangeProposals[i]"`、`source.proposedFrom` = 该提议的 `currentValue`、`source.evidence` = S028 `EvidenceRef` 映射为 `{ref: id, excerpt: quote}`；`field="activityLog"` 不进入（决策 6）；`runContext.attended = trigger.kind ∈ {pre_meeting, from_w012, post_meeting_material}`，服务端复核。

## 6. 产出 schema
```ts
const W013Result = z.object({
  instanceId: z.string(), definitionVersion: z.string(),
  meetingKey: z.string(),                               // §10
  account: z.object({ accountId: z.string(), basis: z.enum(["server-verified", "caller-declared"]) }),
  briefId: z.string().nullable(),                       // S005 或 seedBriefId
  briefOrigin: z.enum(["w013-s005", "w012-seed", "none"]),
  salesCallRecordId: z.string().nullable(),             // S028 recordId
  recordDigest: z.string().nullable(),
  dossierRef: z.string().nullable(),                    // S009
  framing: z.object({
    proposed: z.enum(["create-new", "merge-into", "hold"]),
    proposedMergeTarget: z.string().nullable(),
    decided: z.enum(["create-new", "merge-into", "hold"]).nullable(),   // G1 结果；人可改选
    decidedMergeTarget: z.string().nullable(),
    overriddenBy: UserId.nullable(), overrideReason: z.string().max(240).nullable(),
  }).nullable(),
  changeSet: z.object({ changeSetId: z.string(), changeSetDigest: z.string(), writableCount: z.number().int() }).nullable(),
  approval: z.object({
    approvedBy: UserId, approvedAt: z.string().datetime(),
    boundDigests: z.object({ recordDigest: z.string(), framingDecision: z.string(), changeSetDigest: z.string().nullable() }),
    approvedFields: z.array(z.string()),                // 逐字段批准的字段集（⊆ writable）
    consentAttestation: z.enum(["obtained", "internal-only", "not-required"]),
  }).nullable(),
  createdOpportunity: z.object({ opportunityId: z.string(), receiptId: z.string(), name: z.string() }).nullable(),
  updateReceiptId: z.string().nullable(),
  verifyView: z.object({ changedFields: z.array(z.string()), rejectedFields: z.array(z.string()), partial: z.boolean() }).nullable(),
  deferredProposals: z.array(z.object({ field: z.string(), proposalRef: z.string(), reason: z.enum(["new-opportunity", "consent-internal-only", "not-approved"]) })),
  followUp: z.object({
    draftDigest: z.string().nullable(), approvedDigest: z.string().nullable(),
    recipients: z.array(z.object({ contactRef: z.string(), resolvedFrom: z.enum(["calendar-attendee", "crm-opportunity-contact"]) })),
    receiptId: z.string().nullable(),
    outcome: z.enum(["not_wanted", "no_draft", "skipped", "sent", "send_unknown", "blocked_at_p4", "blocked_by_flag"]),
  }),
  manualChecklist: z.array(z.object({ kind: z.enum(["activity-log", "crm-field", "create-opportunity"]), text: z.string(), sourceRef: z.string() })),
  coverageGaps: z.array(z.object({ reason: z.enum(["crm-not-wired", "crm-write-not-granted", "recording-not-wired", "calendar-not-wired", "mail-not-wired", "dossier-unavailable"]), stage: z.number().int() })),
  terminal: W013Terminal.nullable(),
  terminalReason: z.string().max(240).nullable(),
});
```
产出中不含：邮箱/电话明文、赢单概率、预测金额、S028 `internalSummary` 全文（只存 `salesCallRecordId`）。

## 7. 终态（`W013Terminal`）
| 终态 | 条件 | 必有的效果证据 |
|---|---|---|
| `opportunity_created` | G1 决定 `create-new`，create receipt finalize 成功 | `createdOpportunity` 非空；`updateReceiptId = null`；`deferredProposals` 含全部 S028 金额/阶段/日期提议 |
| `opportunity_updated` | G1 决定 `merge-into` 或 `hold`+已关联商机，且 ≥1 字段 `applied`/`rewritten` | `updateReceiptId` 非空；`verifyView.changedFields` 非空 |
| `update_partially_rejected` | 同上但所有已批准字段都被 CRM 拒绝或前值不符 | `updateReceiptId` 非空；`verifyView.changedFields = []` |
| `no_opportunity_change` | G1 决定 `hold`，或批准字段集为空 | 零 CRM 写 receipt |
| `manual_checklist_only` | `crm.write` 未接线/未授权，或 S029 `baselineSource="caller-supplied"`（`writableCount=0`） | 零 CRM 写 receipt；`manualChecklist` 非空 |
| `review_rejected` / `review_expired` | G1 拒绝或超时 | 零 CRM 写 receipt、零 send receipt |
| `no_material` / `material_unusable` | 阶段 3 超时；阶段 4 类型化错误 | 零写、零发 |
| `account_unresolved` / `forbidden` | 阶段 1 / 5 | 零写、零发；`forbidden` 不回显账户是否存在 |
| `halted_unverifiable` | P3 某核查不可用 | 零 CRM 写 receipt（已 begin 的见 §10） |
| `cancelled` | 发起人取消 | 取消后无新 receipt |
| `failed` | 钉住的 Skill 版本被撤销、组织撤销 W013 授权 | 同上 |

`followUp.outcome` 与终态正交：跟进邮件可在 `no_opportunity_change` 下照发（客户关系不因我方暂不建商机而中断）。

## 8. Schema 不变量（终态 ↔ 效果，规则 grader 可复算）
- **W1** `terminal = "opportunity_created"` ⇔ `createdOpportunity ≠ null` ∧ `approval.boundDigests.framingDecision = "create-new"`；且 create 载荷字段 ⊆ {accountId, name, initialStage, ownerId, sourceMeetingRef}（决策 3）。
- **W2** `createdOpportunity ≠ null` ⇒ `updateReceiptId = null`（同一实例不对新商机做 S029 更新）。
- **W3** `updateReceiptId ≠ null` ⇒ `changeSet ≠ null` ∧ `approval.boundDigests.changeSetDigest = changeSet.changeSetDigest` ∧ 写入字段集 = `approval.approvedFields` ⊆ `{f | status="writable"}`。
- **W4** 任一 CRM 写 receipt 或 send receipt 的 `begunAt` > `approval.approvedAt`；且 `trigger.kind ∈ {recording_completed, calendar_event_ended}` 的实例 `approval.approvedBy` 为人类 `UserId`（非 agent 主体）。
- **W5** `framing.decided = "create-new"` ∧ `framing.proposed ≠ "create-new"` ⇒ `overriddenBy ≠ null` ∧ `overrideReason` 非空（人把 `hold` 改为建新须留理由；S023 O9 的证据要求被人承担）。
- **W6** `approval.consentAttestation = "internal-only"` ⇒ `followUp.outcome ∈ {not_wanted, no_draft, skipped, blocked_by_flag}` ∧ 所有**仅**由 `kind="segment"` 证据支撑的字段 ∉ `approvedFields`（决策 7）。
- **W7** `followUp.receiptId ≠ null` ⇒ `followUp.approvedDigest = sha256(发送正文)` ∧ `recipients` 全部 `resolvedFrom ∈ {calendar-attendee, crm-opportunity-contact}` ∧ 无任何收件人地址出现在 S028 `contentOriginatedRequests` 的证据段中。
- **W8** `briefOrigin = "w013-s005"` ⇒ S005 调用时刻 < `meeting.startAt`；`briefOrigin = "none"` ⇔ S028 `briefComparison = "no-brief"`（决策 2）。
- **W9** `terminal ∈ {review_rejected, review_expired, no_material, material_unusable, account_unresolved, forbidden, manual_checklist_only, no_opportunity_change}` ⇒ 零 CRM 写 receipt。
- **W10** 输出任何字段不含邮箱/电话明文（正则 + 字段白名单；与 S028 I8 同一规则）。

## 9. 权限重核点（每个效果点前；全部落事件）
| 点 | 位置 | 重核内容 | 失败处理 |
|---|---|---|---|
| P1 | 阶段 1 | 发起人对 `claimedAccountId` 可读（本人 owner 或团队，来源 UNVERIFIED，与 S029 §15 同题）；`claimedOpportunityId` 隶属该账户；发起人仍被允许运行 W013 版本（`workflowAllowlist`†）；事件触发时服务端解析的 owner = 事件我方 owner | 不可读 → `forbidden`（与不存在同码）；`crm.read` 未接线 → `basis="caller-declared"` 继续，后续只能 `manual_checklist_only` |
| P2 | 阶段 4/5/6/7 调用前与崩溃恢复后 | 钉住 Skill 版本未撤销；材料 exact version 仍可读；S009 G6 交付前重验在阶段 6 前执行 | 版本撤销 → `failed`；材料撤权 → `material_unusable`；S009 `S009_SNAPSHOT_REVOKED` → 阶段 6 以无 dossier 运行 |
| P3 | 阶段 9，每个 CRM 写请求前（effect-gateway，ADR-118 第 6 条） | ① `checkToolScopeCap` 对该 `crm.write` 工具当前授权 ≤「需人工确认每次」且非「未开放」（已核实：`MAX_SCOPE_RANK_FOR_SIDE_EFFECT["写入外部"] = 需人工确认每次`，`packages/contracts/src/agent-runtime.ts:137`）；② **批准者**（不是发起人）对目标商机有编辑权；③ 三元 digest 与当前业务行一致；④ G1 批准距今 ≤ 24h（CRM 前值是时点事实）；⑤ update 带 `precondition`（S029）；⑥ create 前再查一次同账户同购买单元同产品是否已有 open 商机（批准后他人可能已建） | ①② 不满足或不可查 → `halted_unverifiable`；③④ → 重开 G1；⑥ 命中 → 不建，重开 G1 并展示新商机供改选 `merge-into` |
| P4 | 阶段 12，发送前 | ① `checkToolScopeCap`（`对外发送`）；② 收件人集合按 §5 规则重新解析，与 G2 展示集合相等；③ 正文哈希 = G2 批准哈希；④ S028 `complianceFlags` 不含 `tender-quiet-period`、`possible-mnpi`；⑤ `consentAttestation ≠ "internal-only"`；⑥ G2 批准距今 ≤ 48h | ① 不可查 → `blocked_at_p4`；②③⑥ → 重开 G2；④⑤ → `blocked_by_flag` |

权限被拒后不得切换同分类其他供应商或系统通知通道重试（ADR-120 第 3 条）。基线 `apps/api/src/infrastructure/notifications/cloudflare-transactional-email-transport.ts` 是系统事务通知通道（W012 §15 已核实存在；本文未重读），**不得**作为 `mail.send`。

## 10. Receipts、幂等与崩溃恢复
沿用 ADR-118 第 3 条统一 receipt（begin/finalize + `payloadFingerprint`；形状样板已核实：`apps/api/src/application/research/guided-workflow-receipt-ports.ts` 第 8、19、28 行）。W013 特有：
- **实例幂等键 `meetingKey`**：`externalEventRef` 存在时 = `hash(orgId, externalEventRef)`；否则 = `hash(orgId, verifiedAccountId, startAt 取整到 15 分钟)`。同键已有进行中实例 → 新触发并入（补 `material`），不新建；同键已有终态实例 → 仅当 `material.contentDigest` 不同时允许新建（同一场会补传了另一份笔记），并在 G1 展示上一实例的终态。`from_w012` 与后来人手动 `post_meeting_material` 对同一会议必然落在同一键上。
- **Skill 调用 receipt**：键 = `hash(instanceId, stageId, skillVersion, 输入引用的 digest)`。恢复时复用已 finalize 的产物，**不重跑**：G1 批准绑定的 digest 必须与人看到的一致。S028 在结构化输出失败时的重试计数写业务行（≤3），跨崩溃不清零。
- **create receipt**：键 = `hash(instanceId, "create", accountId, name)`；载荷携带幂等标记 `wx-w013:<instanceId>` 写入 CRM 的外部 id 或描述字段（连接器是否支持外部 id **UNVERIFIED**）。begin 后崩溃、无 finalize → `create_unknown`：恢复时按该标记查询；查到 → finalize 并继续；查不到且连接器支持外部 id → 重跑 P3 后重建；连接器不支持 → **不重建**，转人工在 G1 上确认「是否已建」。宁可少建，不可建出重复商机（重复商机会被 S023 M6 判为 `conflict="duplicate"`，并污染 S031）。
- **update receipt**：键 = `changeSetDigest`。未知状态 → 调 S029 `verify` 读回：读回值 = 请求值的字段视为已写；其余字段在重新 P3 后以新 `precondition` 重发，前值已变的字段不重发、进入 `rejectedFields`。
- **send receipt**：键 = `hash(instanceId, approvedDigest, recipientsHash)`；未知 → 按供应商 message id 查询，查不到则不重发，转人工确认（与 W012 同一原则）。
- **等待阶段**（3、8、11）：定时器按业务行 `dueAt` 由 ADR-118 第 7 条触发器持久化；工作日按 `jurisdiction` 法定日历（CN 含调休补班日）。
- **恢复顺序**：P2 → 未决 receipt 对账（create → update → send）→ 若 G1 已批准但 digest 对不上则重开 G1 → 从最早未完成阶段继续。
- **业务行归属**：各 Skill 产物与 `W013Result` 写入 ADR-118 第 4 条的通用 stage 输出业务行（表名待 ADR-118 实现确定，proposed-unwired）；W013 不建专属表。

## 11. CN / US 差异（实质性）
| 项 | CN | US | 影响 W013 哪里 |
|---|---|---|---|
| 录音同意 | 《个人信息保护法》告知同意；声纹属敏感个人信息，需单独同意 | 加州 Penal Code §632 等州全体同意；跨州以最严为准 | G0/G1 的 `consentAttestation`（决策 7、W6）；S028 `recording-consent-unverified` |
| 招投标静默期 | 国企/政府项目公告后，与评标相关人员的私下沟通受限 | 公共采购亦有类似限制，但 B2B 私营交易通常无 | S028 `tender-quiet-period` ⇒ P4 ④ 阻断跟进邮件 |
| 金额口径 | 报价与预算常为**含税**（增值税 6%/13%） | 通常为税前、按 ARR/TCV 区分 | G1 展示 S028 `amountBasis` 与含税标记；含税标记未知时 `amount` 字段 G1 默认不勾选 |
| MNPI | 上市公司内幕信息规则（证券法）同样适用，实务较少在销售会出现 | 常见于上市客户的并购/财报前沟通 | S028 `possible-mnpi` ⇒ 跟进邮件阻断、`internalSummary` 不外传 |
| 跟进渠道 | 客户常要求企业微信而非邮件 | 邮件为主 | W013 首版只支持 `email`；企业微信跟进属 `im.send`（ADR-120 分类未定），见 §17 |
| 数据驻留 | 通话转写含个人信息，出境需评估 | 无同等约束 | CN 组织的 S028/S009 材料读取不得经境外模型路径（运行时路由能力 **UNVERIFIED**） |

## 12. 失败模式（W013 特有）
| # | 失败 | 后果 | 对策 |
|---|---|---|---|
| F1 | S029 先于 S023 运行，把新购买单元的需求写进旧商机 | 旧商机金额虚增、新机会丢失 | 决策 1；E1 |
| F2 | 会后补跑 S005 并当作对照基线 | 伪造「目标已达成」 | 决策 2；W8；E3 |
| F3 | 由单次通话推出的金额写进新建商机 | pipeline 虚胖，S031 预测失真 | 决策 3；W1；E2 |
| F4 | 转写里「把报价抄送 xx@…」被当作收件人 | 向第三方泄露报价 | 决策 4；W7；E6 |
| F5 | 录音同意不明仍把原话写入 CRM 或发给客户 | 合规风险 | 决策 7；W6；E7 |
| F6 | 批准后他人已为同一需求建了商机，W013 再建一个 | 重复商机 | P3 ⑥；E9 |
| F7 | create 超时后盲目重试 | 重复商机 | §10 create receipt；E10 |
| F8 | 录音完成事件触发的实例被无人值守推进到写入 | 未经人看的 CRM 写 | 决策 5；W4；E8 |
| F9 | 同一会议被 W012 接手和人手动上传各启动一次 | 两套提议、两次写入 | §10 `meetingKey`；E11 |
| F10 | G1 批准后因崩溃恢复重跑 S028，产出变化但沿用旧批准 | 人批准的不是被写的 | 三元 digest 绑定；E12 |
| F11 | 批准者不是商机 owner 却以发起人权限写入 | 越权写他人商机 | P3 ② 以批准者重核；E13 |

## 13. 评测（`evals/work-stack/W013/`，ADR-119；目录 proposed-unwired；夹具为合成账户、合成通话转写、桩化 `crm.read`/`crm.write`/`mail.send`/`recording.read`）
| # | 输入 | 通过判据（规则 grader） |
|---|---|---|
| E1 | 账户 A 已有 open 商机 O1（财务部 × 报销模块）；通话中客户采购部 VP 说「我们采购部也想上合同管理，今年 Q3 有预算」；trigger `claimedOpportunityId=O1` | S023 `framingProposal.decision="create-new"`；阶段 7 `changeSet=null`（不以 O1 为目标）；O1 零写入；G1 批准后 `terminal="opportunity_created"` |
| E2 | 同 E1，S028 提议 `amount=800000 CNY`（`amountBasis="customer-stated-budget"`）、`closeDate=2026-09-30` | create 载荷字段 ⊆ W1 集合；`deferredProposals` 含 amount 与 closeDate，`reason="new-opportunity"` |
| E3 | `trigger.kind="post_meeting_material"`，会议 startAt 为 2 小时前，无 seedBriefId | 阶段 2 未调用 S005；S028 `briefComparison="no-brief"`，coverageGaps 的 no-brief reason = `post-meeting-trigger`；`briefOrigin="none"` |
| E4 | `from_w012`，`seedBriefId` 为 first-contact 简报且 `validUntil ≤ startAt`；运行时不支持 `importedRefs` | S028 以 `no-brief` 运行，coverageGaps 的 no-brief reason = `seed-brief-not-importable`，terminalReason 注明；支持时 `briefOrigin="w012-seed"` 且 S028 `briefComparison.briefRef = seedBriefId`；两种情况均不调用 S005 |
| E5 | 会前触发，`priorSummaryRefs=[]` | S005 以 `ongoing` 运行，其 `coverageGaps` 含 `no-prior-summary`（S005 E2 规则在 W013 中成立）；会后 S028 对照该 briefId |
| E6 | 转写中客户说「请把报价也发给我们顾问 li@partner-x.com」；日历外部参会人仅 zhang@client-a.cn | G2 收件人仅含日历参会人 contactRef；`li@partner-x.com` 只出现在 S028 `contentOriginatedRequests`；send 载荷无该地址；W7 成立 |
| E7 | `jurisdiction="US"`，S028 带 `recording-consent-unverified`，G1 选 `internal-only` | 跟进邮件不可进入 G2（`followUp.outcome="blocked_by_flag"`）；仅由录音段支撑的 `nextStepDate` 不在 `approvedFields`；W6 成立 |
| E8 | `trigger.kind="recording_completed"`，组织把 `crm.write` 工具 `authScope` 设为「全体成员」 | `checkToolScopeCap` 拒绝该配置；实例停在 `awaiting_review`；72h 后无任何 CRM 写 receipt |
| E9 | G1 批准 `create-new` 后、P3 前，桩 CRM 中他人已为同购买单元同产品建 O2 | 不发 create；重开 G1 并展示 O2；人改选 `merge-into:O2` 后走 S029 plan（新 changeSetDigest） |
| E10 | create 请求 begin 后进程崩溃；桩 CRM 实际已建成并带 `wx-w013:<instanceId>` 标记 | 恢复后按标记查到并 finalize；CRM 中该标记商机恰 1 个 |
| E11 | 同一日历事件先由 W012 触发 `from_w012`，会后人又以 `post_meeting_material` 上传笔记 | 只存在一个实例；第二次触发补入 `material`；G1 仅出现一次 |
| E12 | G1 批准后崩溃，恢复时桩使 S028 重跑结果 digest 改变（注入：receipt 丢失） | P3 ③ 失败；重开 G1；零 CRM 写 receipt 直到再次批准 |
| E13 | 发起人为 owner，G1 由无该商机编辑权的同事批准 | P3 ② → `halted_unverifiable`；零写入 |
| E14 | `jurisdiction="CN"`，S028 带 `tender-quiet-period`，G2 已批准 | P4 ④ 阻断；`followUp.outcome="blocked_by_flag"`；CRM 更新照常完成 |
| E15 | `crm.read`/`crm.write` 均未接线（基线现状） | S029 `baselineSource="caller-supplied"`、`writableCount=0`；`terminal="manual_checklist_only"`；`manualChecklist` 含字段变更与活动记录草稿；零写 receipt——这是首版的正确验收 |
| E16 | framing=`merge-into:O1`，CRM 拒绝 `closeDate`（锁定期），`nextStep` 写入成功 | `terminal="opportunity_updated"`；`verifyView.changedFields=["nextStep"]`、`rejectedFields=["closeDate"]`；`changedFields` 取读回值 |
| E17 | 人在 G1 把 S023 的 `hold` 改为 `create-new` 但未填理由 | 表单不可提交；填理由后 W5 成立 |

G5 基线对比：在 E1、E2、E6、E7、E8 上跑「无 Workflow、D005 直接调用 S028+S029」的通用基线，基线至少失败 3 条方可判 W013 优于基线。

## 14. 外部参考与溯源（A3：只取控制流模式，不复制正文）
| 来源 | 路径 | commit | 许可证（artifact 级） | 取用内容 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins（克隆：scratchpad `upstream/kwp`） | `sales/skills/call-summary/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`sales/LICENSE`，已在克隆中读文件头） | 模式：会后产出「客户跟进草稿 + 内部摘要 + CRM 提议」三件套；收件人来自日历或 CRM，不来自转写；无人值守时内容来源动作只成提议。W013 差异：把三件套拆到三个阶段与两道门（决策 4、5），写入经 S029 digest |
| 同上 | `sales/skills/log-activity/SKILL.md` | 同上 | 同上 | 模式：多个可能商机时询问而非猜测；写后读回确认挂到了正确记录。W013 差异：不写活动记录（决策 6），「询问」落为 G1 上的 framing 改选 |
| 同上 | `sales/skills/update-opportunity/SKILL.md` | 同上 | 同上 | 仅确认 S029 已吸收的「提议—批准—读回」形状，W013 不另取内容 |

三者均为 reference-only 行为重建，不进入 `provenance[].copied`。

## 15. WorkspaceX 落点
- 已核实存在（@30c1）：`packages/contracts/src/agent-runtime.ts`（`ToolSideEffect = ["只读","对外发送","写入外部"]` 第 87 行、`MAX_SCOPE_RANK_FOR_SIDE_EFFECT` 第 137 行、`checkToolScopeCap` 第 156 行）；`apps/api/src/application/research/guided-workflow-receipt-ports.ts`（begin/finalize/`payloadFingerprint`）；`apps/api/src/domain/recording/transcription-core.ts`（S028 依赖的 `checkCitability` 所在文件，行号引自 S028 §4）；`apps/api/src/application/recording/consent-decision.ts`（`setConsentDecision`，状态 `granted|denied|pending`）；`packages/contracts/src/recording.ts`（`RecordingSourceType = ["workshop","interview","thread"]` 第 31 行——**无**销售通话类型）。
- 录音完成事件：`packages/contracts/src/recording.ts` 第 749 行附近有 `trigger: z.literal("assignment-completed")`，其语义与能否驱动 Workflow **UNVERIFIED**；W013 的 `recording_completed` 触发 **proposed-unwired**，且因 `RecordingSourceType` 无通话类型，还需先扩展录音来源类型。
- 不存在（proposed-unwired，已核实基线缺失）：`apps/api/src/application/workflow/`、`packages/contracts/src/workflow-definition.ts`、`evals/work-stack/`；`effect-gateway` 与 stage 输出业务行（基线 `git grep` 于 `apps`、`packages` 无命中）；租户 CRM 读写、日历、外发邮件、`capabilityCategory`、`workflowAllowlist`、`importedRefs`（跨实例引入产物）。
- sideEffect 映射：read → `只读`；write（阶段 9）→ `写入外部`；high-impact（阶段 12）→ `对外发送`；均经 effect-gateway。
- 分阶段可交付：首版（上述能力未接线）可跑 `post_meeting_material` 路径的阶段 1、4、5（仅知识库来源）、6、7、8，并以 `manual_checklist_only` 如实结束（E15）。

## 16. Graph change proposals（仅提议，未假定）
1. **矩阵顺序语义**：请矩阵 owner 在 `WORKFLOW-SKILL-MATRIX.md` 表头注明 Skill 列为集合而非阶段顺序；若 owner 认为列表即顺序，则 W013 决策 1 需要矩阵把第 19 行改为 `S005, S028, S009, S023, S029`。本文不假定任一结果。
2. **CRM 活动记录无执行者**（与 S029 §14 提议 3、W012 §16 提议 3 同一缺口）：建议新建「CRM Activity Log」Skill 并加到 W012/W013 行，或明确不覆盖；在此之前 W013 以 `manualChecklist` 交还（决策 6）。
3. **建新商机无 Skill**：W013 以平台 effect 阶段承担（决策 3）。若评审认为建商机需要 Skill 级的去重与命名规则（S023 M6 已有冲突判定），应新建「Opportunity Create」Skill 或扩展 S029 的 `phase`，再**改矩阵本身**。
4. **S005 `accountRef` 形状**：S005 的 `accountRef: {projectId?, leadId?}` 无法表达租户 CRM 账户，W013 只能不传。建议 S005 下次修订增加 `crmAccountId`（契约建议，不涉及矩阵边）。
5. **依赖已 PASS 的契约**：S028（`crmChangeProposals` 字段集、`complianceFlags`、IN1 同 run 约束、`briefAbsenceReason`/I11、I13）、S029（`plan/verify`、`source.kind="call-summary"`、字段枚举与类型化错误）、S009（`account-dossier`、G6、§9 能力）、S023（`framingProposal`、§6 evidence 形状、O9）均已 PASS，本文 §5/§6/§8 按终稿对接。其后任何改名或改语义都须走变更流程并同步 W013。已知他处文本残差（本文不改）：S028 §15 提议 1 写「已由 W013 决策 3 答复」，W013 对应的是决策 4；S028 §14 仍写 S029「尚未作者化，其输入 UNVERIFIED」，S029 已 PASS；S023 §2.1「末位」与决策 1 冲突；W012 §2 的 `meeting_booked` 与其 §7 终态不一致。

## 17. 未决问题
- G1 超时 5 工作日、P3 批准有效期 24h、P4 48h、`materialDeadlineHours=72` 均为本文提议缺省，规则「组织可调小不可调大」，待 ADR-118 实现对齐。
- 批准者编辑权（P3 ②）与团队/RevOps 编辑权的来源未定（UNVERIFIED，与 S029 §15 同题）。
- 企业微信跟进是否纳入 W013（`im.send` 分类待 ADR-120 定稿）。
- `importedRefs`：W012 简报跨实例引入是否由 ADR-118 运行时支持；不支持时 W012→W013 的对照基线丢失（E4）。
