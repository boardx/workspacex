# W030 — PRD-to-Sprint

> 类型：Reference Workflow · 域：Product · 作者化任务：AUTHOR-W030 · 状态：待独立评审
> **代码基线**：`main@30c1c4332025151610502988b0379b95ff7298c7`。凡涉及现有 WorkspaceX 代码的陈述均以此基线核对（`git show 30c1c433:<path>`）；未读实现的行为标 **UNVERIFIED**，基线上不存在/未接线的能力标 **proposed-unwired**。
> 权威：`requirements/work-stack-v2/`（ADR-116）；运行时：ADR-118（第 4 条业务行是事实、第 5 条实例固定版本、第 6 条 effect-gateway、第 9 条 Skill 由 Workflow 固定）；工具分类：ADR-120（第 2 条默认只读、第 3 条被拒不换供应商）；评测门：ADR-119。
> 对齐的已 PASS 契约（只引用，不改）：`skills/S067-prd-spec-writing.md`、`skills/S068-prioritization.md`、`skills/S070-sprint-planning.md`、`skills/S142-work-item-management.md`、`skills/S076-design-handoff.md`、`digital-humans/D003-product-manager.md`。上游 `workflows/W029-problem-to-prd.md` 已 PASS（`reviews/W029.review.md`），本文只依赖它的产物形状 `prdRef: {documentId, versionId}` 与 G4 批准回执 `{gate: "G4", documentId, versionId, contentHash, outcome: "approved"|"request_changes"|"reject"}`，并在 §14 标注。

## 1. 边界（一句话）
把**一版已批准且冻结的 PRD + 一版已定稿的原型**，变成**一个团队下一个冲刺的「承诺集合」，并在看板上落成有真人负责人的卡片**。每张卡能回溯到 `requirementId`、验收条件 id 和原型节点；每个进入承诺的估点来自团队而不是模型。

W030 **不做**：改写 PRD（回 W029）、选解法（W029 的 S068 `solution-select`）、路线图改序（W032）、冲刺中途重排（S070 `replan`，聊天直接调用，不经 W030）、发布就绪（见本文 §14 第 5 条）。W030 的终点是「冲刺开始前的承诺被落卡」，不是「冲刺完成」。

## 2. 组合图（精确 ID，来自两张矩阵）

### 2.1 参与 Skill（WORKFLOW-SKILL-MATRIX.md 第 36 行：`W030 | PRD-to-Sprint | Product | S067, S068, S070, S142, S076`）
| Skill | 名称 | 在 W030 中的模式与唯一职责 | 依据（已 PASS 契约） |
|---|---|---|---|
| S067 | PRD / Spec Writing | `mode = "readiness"`：对冻结 PRD 版本只读判 `PrdReadiness.status`，不改写正文 | S067 §4 D4、§6 `PrdReadiness`、决策 4 |
| S076 | Design Handoff | 冻结 `prototypeVersionId`，产出 `DesignHandoffPackage`（状态穷举、验收条件、`workItemDrafts`、`readiness`） | S076 §4 步骤 1–10、§6、决策 3、5 |
| S068 | Prioritization | `mode = "scope-cut"`：在 `appetite` 内对**工作项草稿**做 MoSCoW 切分，`status: "proposed"` | S068 §4.0、C1–C2、D1–D2 |
| S070 | Sprint Planning | `mode = "plan"`：容量、承诺/stretch、冲刺目标；`entry.mode = "w030-verified"` | S070 P1–P10、§6 |
| S142 | Work Item Management | `mode = "sprint-commit"`：把 committed 条目转成 `WorkItemChangeSet`（`effectState` 恒为 `proposed-not-applied`） | S142 §5.3、§7、§9、§10 |

Skill 版本由 `WorkflowDefinition(W030, v1).stages[*].skills[*] = {stableId, versionRange}` 在实例启动时解析并冻结（ADR-118 第 5 条）。按 ADR-118 第 9 条（已读 `docs/adr/ADR-118-generic-workflow-runtime.md:26`），发起 Agent 只需在 `workflowAllowlist` 中被允许运行 W030 v1，**不需要**挂载以上任何 Skill。本文不提出任何挂载边。

### 2.2 消费者（DIGITALHUMAN-COMPOSITION-MATRIX.md 中 Exact Workflows 含 W030 的行，共 3 个）
| DigitalHuman | 矩阵行 | 该行 Workflow 列（原样） | 在 W030 中的典型位置 |
|---|---|---|---|
| D003 Product Manager | 第 9 行 | W027, W028, W029, W030, W031, W032 | 发起人；G1 缺口接受、G3 范围切分、G4 计划批准的缺省批准人（`prdOwnerUserId`） |
| D015 Agile / Product Operating Model Coach | 第 21 行 | W030, W032, W053, W002 | 发起时缺省 `commitMode = "plan-only"`（决策 6）；在 G4 表单上给出 S070 风险解读 |
| D038 Software Engineer | 第 44 行 | W007, W056, W030, W008 | G2 估点会的参与者；可以发起，但落卡批准仍需项目写角色（决策 6） |

各行 Skill 列只代表聊天中直接调用（ADR-118 第 9 条）。例如 S076 不在任何 D 行的 Skill 列（S076 §2.2），S142 不在 D003 行（D003 §12 第 2 条），这不影响它们在 W030 阶段内被使用。

### 2.3 相邻 Workflow（划界）
- **W029 Problem-to-PRD**：唯一的上游。W029 终态 `prd_approved` 给出 `nextWorkflowSuggestion = {workflowId: "W030", prdRef}`，**不自动**启动 W030（W029 决策 6）。W030 以 `prdRef` 启动，读 W029 的 G4 批准回执（§4 `P0`）。
- **W032 Roadmap Review**：用 S068 `rerank` 改路线图名次；W030 只切一份 PRD 的范围，不改路线图。
- **W053 Weekly PMO Review**：用 S142 `hygiene-review` 检查冲刺中的卡；W030 落的卡是它的输入之一。

## 3. 实体特有决策

**决策 1 — 阶段顺序固定为 S067 → S076 → [估点会] → S068 → S070 → S142，裁定三份 Skill 文档的顺序分歧。**
三份已 PASS 文档对顺序各有预期：S142 §2.1 按矩阵列相邻写成 S070 → S142 → S076；S070 §14 提议 1 写成 S076 先出草稿（S076 §2.1 只要求 PRD 已存在，明确把阶段先后留给 W030 作者决定，不表态）；S068 §4.0 写 scope-cut 的候选是「S067 的需求条目 id」。硬约束只有这些：
- S070 P1 要求 `prdReadinessRef`、`handoffRef`、`prioritizationRef` 三者都已存在 ⇒ S067、S076、S068 都在 S070 之前；
- S070 `PRIORITY_STALE`：「S068 输出的候选 id 集合与 S076 草稿 id 集合对不上」即报错 ⇒ S068 的候选**必须是 S076 的 `draftId`**，因此 S068 在 S076 之后；
- S068 II5：Effort 只接受 `estimate-by` 或 `appetite` ⇒ S068 之前必须拿到团队估点，因此估点会（G2）在 S068 之前；
- S142 §5.3 的输入是「S070 已经选定的冲刺条目」⇒ S142 在 S070 之后。
满足全部约束的顺序只有上面这一条。W030 中 S068 的 `candidates[]` 取 `{candidateId: draftId, kind: "requirement", title: draft.title, factors.effort: G2 估点（`source = {kind: "estimate-by", principalId: <G2 回执的 estimatorPrincipalId>}`，按 S068 §5 inputSchema 的 FactorSource 对象形式）}`，`sourceRef` 省略（S068 的 `sourceRef.skill` 枚举不含 S076）。S068 文档写的「需求条目 id」粒度与此不一致，这是契约问题，见本文 §14 第 1 条；本文不假定 S068 已改。

**决策 2 — 估点会是一道 `required` 人工门（G2），不是 Skill，也不是 `ask`。**
S070 决策 4 与 S070 §14 提议 2：committed 估点只能来自团队，`team` 估点须随人工门的「估点会结果」提交。S070 §14 提议 2 建议的是 `ask` 级闸门，W030 有意偏离、改为 `required`（理由见下），这是裁定而非契约冲突。W030 在 S076 之后设 G2：表单逐张列 `workItemDrafts`（标题、requirementIds、criterionIds、涉及的 nodeIds），参与者填 `{draftId, value, unit, estimatorPrincipalId}`；G2 回执是估点的唯一事实源，S068 的 `estimate-by` 与 S070 的 `estimate.source = "team"` 都从这张回执派生，平台不接受调用方内联估点。
不设为 `ask` 的理由：若可跳过，S068 会把全部草稿列入 `unestimated`、S070 全部进 `needsEstimate`，实例只会空转到 `draft-needs-estimates`。允许**部分**估点：未估的草稿照常流转，S068 放进 `unestimated`、S070 放进 `needsEstimate`，由 G4 决定回 G2 补估还是接受它们留在冲刺外。单条 > 8 点（或 > 5 人日）的草稿会在 S070 进 `tooLarge[]`，W030 不回 S076 重切（S076 草稿切分以节点为约束，W030 不改），只在 G4 表单列出，由人决定是否另起一轮 W030。

**决策 3 — G3 只能「接受 / 改输入重跑 / 拒绝」，不能手改 MoSCoW 结果。**
S070 只信服务端按 `prioritizationRef` 读到的 S068 输出（S070 §8「S067 / S068 / S076 引用」行）。如果 G3 允许人把某条从 should 拖到 must，S070 读到的仍是原 S068 输出，人改的那一版不存在于任何可引用的业务行里。因此 G3 的可选动作是：
- `accept`：S068 输出成为本实例的切分事实；
- `rerun`：只允许改 S068 的**输入**——`appetite`、为某草稿加 `deadline`（`kind ∈ {regulatory, contract, certificate, signed-commitment}` 且附 `evidenceRef`，S068 A2 会把它钉进 `pinned` → must）、`bucket` 标注、`allowGapFill`；平台以新输入重跑 S068，产生新 `proposalId`；
- `reject` → 终态 `scope_rejected`。
「我就是要这条进 must」只能通过给出可核实的外部截止日或扩大 appetite 表达，这让每个 must 都有可审计的来源。`rerun` 上限 3 次，第 4 次视为 `reject`。

**决策 4 — G4 同时批准计划和指派负责人；负责人由人填，Workflow 在交给 S142 前注入 `ownerHint.principalId`。**
S070 不变式 8：`handoff.S142.candidates[].ownerHint` 恒为 `null`；S142 M2 在 ownerHint 为空时把候选放进 `needsOwner`，O1 又要求 create 的 owner 属于服务端成员集合。若不在 S142 之前补负责人，S142 产出的变更集里一张可执行的 create 都没有。W030 把指派并入 G4：批准人对每个 committed 条目选一个 `principalId`（候选范围 = 该项目非 observer 成员 ∩ S070 `capacity.people[].principalId`），平台把它写进交接候选的 `ownerHint.principalId`，其余字段原样传。这是 Workflow 对 S070 交接的**富化**，不改 S070 输出本身（S070 业务行保持 `ownerHint = null`），富化后的候选集作为独立业务行 `W030OwnerAssignment` 持久化。指派不能指给 `agent:` 前缀主体（S142 O1、`assertHumanOwner`）。

**决策 5 — 落卡是 `write` 级副作用，逐条执行、执行前先对最新看板重跑 S142，失败不回滚已建卡。**
基线 `createTask` 用 `randomUUID()` 生成 id，没有幂等键（已读 `apps/api/src/application/board/create-task.ts`）；S142 §10 要求执行 `create` 前以最新 `GET /tasks` 重跑一次，由 `originRefs`（proposed-unwired，先由 W030 运行账本提供 `draftId → taskId`）把已建卡判为 `noop-duplicate`。W030 的执行规则：
- G5 批准后，平台先取最新 `GET /tasks?projectId=<projectId>` 重跑 S142，再按新变更集逐条执行。注意：S142 §7/§10 的 `changeSetId`、`proposalId` 都由 inputHash 派生，而 `existingItems` 是输入的一部分——已有卡建成后重取 `GET /tasks`，输入变了，二者也随之变化，「同输入 ⇒ 同 `changeSetId`」在 W030 的重跑场景中不成立。因此 W030 不以 `changeSetId`/`proposalId` 作落卡幂等锚点，改用跨重跑稳定的 S076 `draftId`（见 §8.1）；重跑后的新提议经运行账本 `draftId → taskId` 判 `noop-duplicate`；
- 每条 create / transition 一个 effect receipt；某条失败不撤销已成功的卡（撤卡本身是写，且会让已被别人看到的卡消失），终态记为 `partially_committed`；
- 卡片由 `createTask` 写入时 `sourceKind` 恒为 `MANUAL_SOURCE_KIND`（已读 `create-task.ts` 与 `apps/api/src/domain/board/source-kind.ts:18`），W030 来源只能进 S142 `unwiredFields.sourceKind`；在 sourceKind 扩展接线之前，看板上 W030 卡显示为「手工创建」——这是基线限制，不是 W030 伪造来源。

**决策 6 — 发起者身份不授予写权限；`commitMode` 决定实例是否可能产生看板写。**
trigger 的 `commitMode ∈ {"commit", "plan-only"}`。`plan-only` 实例在 G4 之后只发布冲刺计划 artifact，永不进入阶段 10–11。D015（教练角色，S142 §9：D015 只出提议不执行）发起时缺省 `plan-only`；D003、D038 缺省 `commit`。无论哪个 Agent 发起，G5 的批准人必须是在 `projectId` 上非 observer 的人（`board.controller.ts` 的 `resolveProjectRole`：无成员关系 403 `NO_PROJECT_ROLE`、observer 403 `OBSERVER_CANNOT_VIEW_BOARD`），落卡以 G5 批准人为执行主体。`plan-only` 不能在实例中途升级为 `commit`；要落卡须以同一 `planId` 发起新实例（§4 `resumeFromPlanId`）。

**决策 7 — `ready-with-gaps` 的接受逐类处理：合规元素与无障碍缺口不能批量接受。**
S076 决策 3：`gapsAcceptedBy` 只能由 W030 人工门写入。G1 表单把 `gaps[]` 分两组：
- 可批量接受：`STATE_UNSPECIFIED`（非 a11y）、`ORPHAN_COMMENT`、`LINK_ITEM_OUT_OF_RANGE`、`LOCALE_OVERFLOW_RISK`、`TOKEN_GAP`；
- 必须逐条接受并填理由：`COMPLIANCE_ELEMENT_MISSING`、detail 标注 a11y 的 `STATE_UNSPECIFIED`、`UNTESTABLE_CRITERION`、`OVERLAY_NO_DISMISS`。
全部接受后平台写 `gapsAcceptedBy = <批准人 userId>`；任一条被拒 → 终态 `handoff_not_ready`（回设计补）。批准人 = trigger 的 `prdOwnerUserId`；缺省为发起人。

## 4. Trigger schema
```ts
// packages/contracts/src/workflow-definition.ts（ADR-118 新建；proposed-unwired，基线不存在）中 W030 的 trigger 输入
const W030Trigger = z.object({
  kind: z.enum(["manual", "agent_request", "workflow_suggestion"]), // workflow_suggestion = 由 W029 nextWorkflowSuggestion 一键发起；不支持 schedule / webhook
  requestId: z.string().uuid(),
  orgId: OrgId,
  initiatorUserId: UserId,                                   // 权限主体；agent_request 时为背后的人
  initiatorAgentVersionId: z.string().nullable(),            // 须在该 Agent 的 workflowAllowlist 内
  prdRef: z.object({ documentId: z.string(), versionId: z.string() }),     // W029 已批准版本
  design: z.object({ designProjectId: z.string(), prototypeVersionId: z.string() }), // 必填，S076 VERSION_REQUIRED
  projectId: z.string(),                                     // 必填、非空：看板落卡目标（避开 POST /tasks projectId=null 不解析角色的缺口，S142 §8）
  prdOwnerUserId: UserId.optional(),                         // G1/G3/G4 批准人；缺省 initiatorUserId
  appetite: z.object({ amount: z.number().positive(), unit: z.enum(["person-day", "person-week"]) }), // S068 scope-cut 必填；不接受 calendar-week（S068 II2，见 §5 阶段 5 说明）
  sprint: z.object({
    name: z.string().max(60),
    startDate: z.string().date(), endDate: z.string().date(),  // 5–30 个自然日（S070 §5）
    timeZone: z.string(),                                      // IANA
  }),
  team: z.object({ teamId: z.string(), hoursPerDay: z.number().min(4).max(10).default(8), ceremonyHours: z.number().min(0) }),
  estimation: z.object({ unit: z.enum(["points", "person-days"]) }),
  velocityHistory: z.array(z.object({ sprintId: z.string(), completedPoints: z.number(), availablePersonDays: z.number() })).max(12).optional(),
  carryover: z.array(z.object({ taskId: z.string(), remaining: z.number(), carryReason: CarryReason, carryCount: z.number().int() })).max(50).default([]),
  market: z.enum(["CN", "US", "global"]),
  workCalendarRef: z.string().optional(),                    // market=CN 必填（superRefine）
  holidayCalendarRef: z.string().optional(),
  locale: z.enum(["zh-CN", "en-US"]),
  commitMode: z.enum(["commit", "plan-only"]).optional(),    // 缺省按决策 6
  resumeFromPlanId: z.string().optional(),                   // plan-only 实例的计划，用于只做阶段 9–11
});
```
进门校验（不满足即 `INPUT_INVALID`，实例不创建）：`market = "CN"` ⇒ `workCalendarRef` 存在；`resumeFromPlanId` 存在 ⇒ `commitMode = "commit"` 且该计划所属实例终态为 `plan_published`、`prdRef` 与本 trigger 相同；`carryover[].taskId` 由 P1 核实属于 `projectId`。
`workflow_suggestion` 触发时 `prdRef` 取自 W029 的 `nextWorkflowSuggestion`，其余字段仍需人填——W029 不知道冲刺窗口和团队。

## 5. 阶段表
状态机：`requested → P1 → readiness_check → handoff → [G1 gaps] → [G2 estimation] → scope_cut → [G3 scope] → planning → [G4 plan+owners] → (plan-only: publish_plan → plan_published) | (commit: P4 → commit_proposal → [G5 commit] → P5 → committing → publish_plan → committed)`

| # | stage | Skill IDs | 工具能力分类（ADR-120，均为提案名） | 状态转移 | sideEffect | humanGate |
|---|---|---|---|---|---|---|
| 0 | intake | —（平台：P0、P1） | `knowledge.read`（PRD 版本与 W029 G4 回执）、`design.read`、`project.read` | requested → intake_ok ｜ → prd_not_approved ｜ → stale_prd ｜ → blocked_no_access | read | none |
| 1 | readiness | S067 `readiness` | `knowledge.read` | intake_ok → readiness_check → prd_ready ｜ → prd_not_ready | read | none |
| 2 | handoff | S076 | `design.read`、`knowledge.read` | prd_ready → handoff → handoff_ready ｜ handoff_with_gaps ｜ → handoff_not_ready | read | none |
| 3 | gaps_gate | — | — | handoff_with_gaps → awaiting_gap_acceptance → handoff_ready ｜ → handoff_not_ready | write（G1 回执写 `gapsAcceptedBy`，实例业务行） | **G1**：required，仅 `readiness = ready-with-gaps` 时出现；分组规则见决策 7 |
| 4 | estimation_gate | — | `team.roster.read`（proposed-unwired，S070 §7） | handoff_ready → awaiting_estimates → estimated | write（G2 回执，实例业务行） | **G2**：required，多人填写、一人提交（决策 2） |
| 5 | scope_cut | S068 `scope-cut` | 无（纯计算）；conditional `knowledge.read`（`deadline.evidenceRef`） | estimated → scope_cut → scope_proposed ｜ `PINNED_EXCEEDS_APPETITE` → awaiting_scope（仅可 rerun/reject） | none | none |
| 6 | scope_gate | — | — | scope_proposed → awaiting_scope → scope_accepted ｜ rerun → scope_cut（≤3）｜ reject → scope_rejected | write（G3 回执） | **G3**：required（决策 3） |
| 7 | planning | S070 `plan` | `knowledge.read`（S067/S068/S076 输出、工作日历）；conditional `team.roster.read`、`sprint.history.read`（均 proposed-unwired） | scope_accepted → planning → planned（带 `SprintPlan.status`）｜ `PRECONDITION_NOT_READY`/`PRIORITY_STALE` → failed（不应发生，见 §8 F3）｜ `CALENDAR_UNRESOLVED` → blocked_calendar | none | none |
| 8 | plan_gate | — | `project.read`（成员列表，供指派） | planned → awaiting_plan_approval → plan_approved ｜ back_to_estimation → awaiting_estimates ｜ back_to_scope → awaiting_scope ｜ extend_sprint → planning ｜ reject → plan_rejected | write（G4 回执 + `W030OwnerAssignment`） | **G4**：required；批准只在 `SprintPlan.status = "ready-for-commit"` 时可点（S070 不变式 3）；其余状态只能选回退动作 |
| 9 | commit_proposal | S142 `sprint-commit` | `board.read`（`GET /tasks`） | plan_approved → P4 → commit_proposal → commit_proposed | read | none |
| 10 | commit_gate + committing | —（执行 S142 提议） | `board.write`（`POST /tasks`、`PATCH /tasks/:id/status`，平台内部写） | commit_proposed → awaiting_commit → P5 → committing → commit_done ｜ partial → commit_partial ｜ reject → commit_declined | **write** | **G5**：required；逐条或整批确认（S142 §9）；每条执行前 **P5** |
| 11 | publish_plan | — | `artifact.write`（平台内部写）；optional `notify.inapp` | commit_done → committed ｜ commit_partial → partially_committed ｜ commit_declined → plan_published ｜（plan-only）plan_approved → plan_published | write | none（G4/G5 覆盖）；写前 **P6** |

说明：
- **阶段 0 / P0**：服务端读 `prdRef` 版本，要求存在 W029 `gate = G4, outcome = approved` 的回执且其 `contentHash` 等于该版本 `contentHash`（W029 V1）；无回执 → `prd_not_approved`。若同一 `documentId` 已有更新的 approved 版本 → `stale_prd`（不静默改用新版，新版可能改了需求）。W029 回执表的形状取自已 PASS 的 W029 文档（G4 回执 `{gate, documentId, versionId, contentHash, outcome}`），读取适配器 **proposed-unwired**。
- **阶段 1**：S067 输入只允许 `{mode: "readiness", prdRef, locale}`（S067 §5 不变式）。`not-ready` 时实例终止并把 `blockers[]`（按 `requirementId`/`questionId`）作为产物，建议以 `changeRequest` 回 W029。W029 G4 允许带 blocking 问题批准（W029 阶段 13 说明），这种 PRD 在此必然 `not-ready`，是设计意图。
- **阶段 2**：`prdRequirements` 由平台从 PRD 版本机械映射 `{requirementId, text, priority?}`；W029 产出的 PRD `priority` 恒不存在（W029 V4），因此 S076 的 I1「must 级未覆盖需求 ⇒ not-ready」在 W030 v1 中**不会**因 priority 触发，未覆盖需求只作为 `uncoveredRequirements` 出现在 G1/G4 表单。这是已知弱点，W030 用 G4 的强制展示弥补（§8 F6）。
- **阶段 4**：G2 表单不展示 S068/S070 的任何结果（此时尚未运行），避免估点被名次锚定。carryover 条目的剩余估点来自 trigger，不在 G2 重估。
- **阶段 5**：S068 II2 要求 effort 与 appetite 可换算，而故事点与人日不可换算。因此 `estimation.unit = "points"` 时，G2 表单要求每条草稿同时填 `points`（供 S070）与 `personDays`（供 S068），两列属于同一张估点会回执，不构成两处事实；`estimation.unit = "person-days"` 时只填一列。`appetite.unit` 只允许人日/人周。
- **阶段 7 输入映射**：`candidates` = S076 `workItemDrafts`（`candidateId = draftId`、`origin = "s076-draft"`、`draftKind = kind`、`requirementIds`、`estimate = {value: G2.points 或 personDays, source: "team"}`）∪ trigger `carryover`（`origin = "carryover"`、`estimate.source = "carryover-remaining"`）；`prdReadinessRef`、`handoffRef`、`prioritizationRef` 指向本实例阶段 1、2、5 的业务行；`team.members` 不由 Workflow 声明，由 S070 按 `teamId` 取（接线前为 `declared-by-caller`，S070 §8）。
- **G4 回退动作**：`over-scope` → `back_to_scope`（回 G3 rerun 缩 appetite 或 reject）或 `extend_sprint`（改 `sprint.endDate`，≤30 天，重跑阶段 7）；`draft-needs-estimates` → `back_to_estimation`（只对 `needsEstimate` ∪ `tooLarge` 中的 id 重开 G2）；`goal-invalid` → 只能 `reject` 或 `extend_sprint`/`back_to_scope`（S070 不接受人工改目标文本，目标是它的输出）。G4 回退总次数 ≤ 4，第 5 次视为 reject。
- **阶段 9 输入**：`mode = "sprint-commit"`，`projectId` = trigger，`candidates` = `W030OwnerAssignment`（S070 `handoff.S142.candidates` + 决策 4 注入的 ownerHint），每条 `sourceRefs = [{kind: "s068-backlog", id: "<proposalId>#<draftId>"}]`（S142 枚举无 S076/S070 来源，见本文 §14 第 2 条），`existingItems` = P4 时刻 `GET /tasks?projectId` 的结果（S142 II2：同一 project），`anchorAt = sprint.startDate`、`timeZone`、`workCalendarRef` 透传。carryover 条目的已有卡在 `inbox` 时 S142 提 `transition → todo`，否则不动。
- **S142 `warnings`**（例如条目数超容量提示）只展示在 G5，不改变变更集。

## 6. 产出 schema
```ts
// W030 只定义自己的投影；逐项内容引用各 Skill 输出业务行，不复制枚举。
const W030OwnerAssignment = z.object({
  planId: z.string(),                                    // S070 SprintPlan.planId
  assignments: z.array(z.object({ candidateId: z.string(), ownerUserId: UserId })), // 与 committed id 集合相等
  approvedBy: UserId, gateReceiptId: z.string(),
});

const EffectReceipt = z.object({
  receiptId: z.string(),
  key: z.string(),                                       // §8 幂等键
  effect: z.enum(["task.create", "task.transition", "artifact.write", "notify.inapp"]),
  proposalId: z.string().nullable(),                     // S142 proposalId；artifact/notify 为 null
  principalUserId: UserId,                               // 执行主体 = G5 批准人（artifact 为 G4 批准人）
  permissionCheck: z.object({ point: z.enum(["P4", "P5", "P6"]), checkedAt: z.string().datetime(), result: z.enum(["allowed", "denied"]), code: z.string().optional() }),
  status: z.enum(["begun", "succeeded", "failed", "unknown"]),
  resultRef: z.string().nullable(),                      // taskId / artifactVersionId
  errorCode: z.string().nullable(),                      // CreateTaskRejectReason / TransitionRejectReason / HTTP 403 码
});

const W030Outcome = z.object({
  instanceId: z.string(), definitionVersion: z.string(),
  terminal: W030Terminal,                                // §7
  prdRef: z.object({ documentId: z.string(), versionId: z.string(), contentHash: z.string() }),
  design: z.object({ prototypeVersionId: z.string(), designFingerprint: z.string().nullable() }), // S076 指纹
  refs: z.object({
    prdReadinessId: z.string().nullable(), handoffPackageId: z.string().nullable(),
    prioritizationProposalId: z.string().nullable(), sprintPlanId: z.string().nullable(),
    changeSetId: z.string().nullable(),
  }),
  gateReceipts: z.array(z.object({ gate: z.enum(["G1", "G2", "G3", "G4", "G5"]), receiptId: z.string(), actorUserId: UserId, outcome: z.string(), at: z.string().datetime() })),
  sprintPlanArtifact: z.object({ artifactId: z.string(), versionId: z.string() }).nullable(),
  cards: z.array(z.object({ candidateId: z.string(), draftId: z.string().nullable(), taskId: z.string(), requirementIds: z.array(z.string()), criterionIds: z.array(z.string()), ownerUserId: UserId })),
  notCommitted: z.array(z.object({ candidateId: z.string(), reason: z.enum(["stretch", "excluded", "needs-estimate", "too-large", "needs-owner", "effect-failed", "permission-denied", "duplicate"]) })),
  blockers: z.array(z.object({ source: z.enum(["S067", "S076", "S070"]), kind: z.string(), ref: z.string() })), // 非空仅在未落卡终态
  effects: z.array(EffectReceipt),
});
```
不变式（`evals/work-stack/W030/check-outcome.mjs`，proposed-unwired）：
- **V1** `terminal = "committed"` ⇔ `changeSetId ≠ null` ∧ 存在 G5 approved 回执 ∧ 变更集中每条可执行 create/transition 都有 `status = succeeded` 的 receipt ∧ `sprintPlanArtifact ≠ null`。
- **V2** `terminal = "partially_committed"` ⇔ 存在 G5 approved 回执 ∧ 至少一条 `task.*` receipt `succeeded` ∧ 至少一条 `failed`、`unknown` 或 `permissionCheck.result = denied`。
- **V3** `terminal ∉ {committed, partially_committed}` ⇒ 不存在任何 `effect ∈ {task.create, task.transition}` 且 `status ∈ {succeeded, begun, unknown}` 的 receipt（`plan_published`、`commit_declined` 路径永不写看板）。
- **V4** `terminal ∈ {committed, partially_committed, plan_published}` ⇔ `sprintPlanArtifact ≠ null`；其余终态无 `artifact.write` receipt。
- **V5** 每个 `task.*` receipt 的 `permissionCheck.point = "P5"` 且 `result = allowed` 才可能 `succeeded`；`denied` 的 receipt `status = failed`、`resultRef = null`。
- **V6** `cards[].candidateId ⊆ SprintPlan.committed[].candidateId`；`cards` 中 `ownerUserId` = `W030OwnerAssignment` 中对应值；`cards` ∪ `notCommitted` 覆盖 S070 全部输入候选且两者不交。
- **V7** `cards[].criterionIds` 取自 S076 `workItemDrafts[draftId].criterionIds`，非空（carryover 卡 `draftId = null` 时可空）。
- **V8** G4 回执的 `planId` = `sprintPlanId`；G3 回执的 `proposalId` = `prioritizationProposalId`；G1 回执存在 ⇔ S076 `readiness = ready-with-gaps`。

## 7. 终态
| 终态 | 条件 | 已发生的写 | 产物 |
|---|---|---|---|
| `committed` | G5 批准、全部可执行提议成功、计划 artifact 已写 | 卡片 + artifact（+ 站内通知） | `W030Outcome` 全量 |
| `partially_committed` | G5 批准后部分卡片失败 / P5 拒绝 / 结果未知且放弃 | 部分卡片 + artifact | 同上，`notCommitted` 列出原因 |
| `plan_published` | `commitMode = plan-only` 的 G4 批准；或 G5 选「不落卡」 | 仅 artifact | 计划 artifact；可用 `resumeFromPlanId` 另起实例落卡 |
| `prd_not_approved` | P0 找不到匹配 contentHash 的 G4 批准回执 | 无 | 原因码 |
| `stale_prd` | 同一 documentId 有更新的 approved 版本（P0，或 P4/P6 复查时发现） | P4 前无；P6 时可能已有卡片——此时不进本终态，见 §8 | 新旧 versionId |
| `prd_not_ready` | S067 `not-ready` | 无 | `PrdReadiness.blockers` + 回 W029 的建议 |
| `handoff_not_ready` | S076 `not-ready`，或 G1 拒绝任一必须逐条接受的缺口 | G1 回执（若有） | S076 `blockers`/被拒 gaps |
| `scope_rejected` | G3 reject 或 rerun 超限 | G2/G3 回执 | S068 最后一版 proposal |
| `plan_rejected` | G4 reject 或回退超限 | G1–G4 回执 | S070 最后一版计划 |
| `blocked_calendar` | S070 `CALENDAR_UNRESOLVED`（CN 日历未覆盖窗口） | 回执（若有） | 缺失的日历区间 |
| `blocked_no_access` | P1 失败（PRD/设计/项目不可读或 observer） | 无 | 403 码，不泄露对象存在性 |
| `expired` | 任一人工门等待超过 7 天（G2 为 5 个工作日） | 已写回执 | 停留阶段 |
| `cancelled` | 发起人取消（任一非终态；`committing` 中取消只停后续条目） | 已写的保留 | 同 `partially_committed` 字段 |
| `failed` | 不可重试错误：Skill 版本被撤销且无兼容版本、S070 `PRECONDITION_NOT_READY`/`PRIORITY_STALE`（平台缺陷）、组织撤销 W030 授权 | 已写的保留 | 原因码 |

## 8. Receipts、幂等、崩溃恢复与权限重查

### 8.1 幂等
- **实例**：键 `(orgId, initiatorUserId, requestId)`；同键不同 payloadFingerprint → `IDEMPOTENCY_KEY_REUSED`。另加业务唯一性：同一 `(prdRef.versionId, projectId, sprint.name)` 同时只能有一个非终态实例，第二个请求返回已有实例 id——防止两个 PM 为同一冲刺各落一套卡。
- **Skill 阶段**：每次 Skill 调用一个 node receipt（形状沿用 `apps/api/src/application/research/guided-workflow-receipt-ports.ts` 的 `find`/`begin`/`finalize`；已 PASS 的 W029 §8 已读该文件：`begin` 带 `payloadFingerprint`，`finalize` 带 `checkpointId`、`graphVersion`、`stableResponse`），键 = `hash(instanceId, stageId, inputHash)`；G3 rerun 与 G4 回退因输入变化产生新键，旧输出保留为历史业务行。
- **人工门**：回执键 = `hash(instanceId, gate, 该门看到的上游输出 id)`；上游输出已变（例如 G4 回退后重跑 S070）时旧回执不再适用，必须重新批准。
- **落卡**：`task.create` 键 = `hash(instanceId, draftId)`（`draftId` 来自 S076，跨 S142 重跑稳定；不用 `changeSetId`/`proposalId`，因其随 `existingItems` 变化，见决策 5）；`task.transition` 键 = `hash(instanceId, taskId, from, to)`；`artifact.write` 键 = `hash(instanceId, planId)`；`notify.inapp` 键 = `hash(instanceId, ownerUserId)`。

### 8.2 崩溃恢复
- checkpoint 只存指针（ADR-118 第 4 条）；所有 Skill 输出、回执、`W030OwnerAssignment`、effect receipt 写入 `workflow_stage_outputs` 与统一 receipt 表（均 proposed-unwired）。
- 恢复时先执行 **P7**（见下），再从最早未 finalize 的阶段继续；已 finalize 的 Skill 输出直接复用，不重跑（S076 绑定 `designFingerprint`，重跑若原型已变会得到不同草稿，与 G2 估点对不上）。
- **`task.create` 处于 `begun` 的恢复**（最危险的点，基线 `createTask` 无幂等键）：不直接重发。先取最新 `GET /tasks?projectId` 重跑 S142：命中运行账本 `draftId → taskId` 则判 `noop-duplicate` 并把 receipt 补记为 `succeeded`；账本无记录时，用「标题逐字相等 ∧ owner 相等 ∧ 创建时间 ≥ receipt.begunAt」查找，唯一命中则认领，零命中才重发，多命中标 `unknown` 并在实例上留待人处理（不自动删卡）。残余风险：并发中他人恰好手建同名同 owner 卡会被误认领，概率低且不造成重复，接受。
- **`mail`/外发**：W030 不外发，没有 `mail.send` 阶段。

### 8.3 权限重查（每个效果点前，全部落事件）
- **P1 intake**：发起人对 `prdRef` 可读（`PRD_VERSION_NOT_FOUND` 同码不泄露存在性，S067 §6）；对 `designProjectId` 可读且属同一组织（S076 §7：`getPrototypeVersion` 无 org 参数，适配器必须显式按 orgId 过滤，**proposed-unwired**）；在 `projectId` 上有非 observer 角色（`resolveProjectRole`，已读 `apps/api/src/interface/controllers/board.controller.ts:49`）；`carryover[].taskId` 对发起人可见。
- **P4 G4 批准后、读看板前**：重查 G4 批准人在 `projectId` 的角色；重查每个指派 owner 仍是组织活跃成员且非 observer（成员查询函数 UNVERIFIED）；复查 P0（无更新的 approved PRD 版本）。任一 owner 失效 → 回 G4 重新指派，不带着失效 owner 进 S142。
- **P5 G5 批准后、每一条 create/transition 执行前**（经 effect-gateway，**proposed-unwired**；ADR-118 第 6 条）：以 G5 批准人为主体重查 `resolveProjectRole`（写路径 `POST /tasks` 只在 `projectId` 非空时解析角色——W030 trigger 强制非空，已读 `board.controller.ts` create 分支）；transition 另由 `PATCH /tasks/:id/status` 的 `listVisibleWithin` 判可见性（不可见 403 `CANNOT_MODIFY_TASK`）；owner 用 `assertHumanOwner`（写路径内）；P0 复查。P5 拒绝的条目 receipt 记 `denied` 并进入 `notCommitted(permission-denied)`，**不**换其他主体重试（ADR-120 第 3 条精神：被拒不绕行）。若 P0 复查发现更新的 approved PRD：停止剩余条目，终态 `partially_committed`（已建卡保留），产物标 `prdSupersededDuringCommit = true`。
- **P6 publish 前**：G4（或 G5）批准人对目标 artifact 所在项目的写权限；站内通知逐 owner 核其仍为活跃成员。artifact 写是否经 MCP：按本文设计为平台内部写，基线行为 **UNVERIFIED**。
- **P7 崩溃恢复**：重跑 P1 全部检查；在 `committing` 中恢复的另外对剩余条目逐条执行 P5。

### 8.4 重试预算
Skill 结构化输出失败 ≤ 3 次（计数写业务行，跨崩溃不清零）；`task.create` 遇 5xx ≤ 2 次重试（先走 8.2 认领流程），422（`CreateTaskRejectReason`）不重试直接 `failed`；403 不重试。

## 9. 失败模式（W030 特有）
| # | 失败 | 检测 | 处置 |
|---|---|---|---|
| F1 | 模型估点混进承诺 | S070 committed 出现 `estimateSource ≠ team/carryover-remaining`，或 G2 回执外的估点 | 平台只从 G2 回执构造 `estimate`；S070 不变式 4 兜底 |
| F2 | 人在 G3 手改 MoSCoW，S070 读到的仍是旧切分 | G3 表单无编辑能力（决策 3） | 只允许 rerun 改输入 |
| F3 | S068 用需求 id、S070 用草稿 id，交接对不上 | S070 `PRIORITY_STALE` | 决策 1 固定 S068 候选 = draftId；若仍出现视为平台缺陷 → `failed` |
| F4 | 所有卡落成「待指派」而无一可执行 | S142 `needsOwner` 非空 | 决策 4：G4 指派；S142 仍返回 needsOwner 时（owner 失效）回 G4 |
| F5 | 崩溃后重复建卡 | 同 proposalId 出现两张卡 | 8.2 认领流程；E6 |
| F6 | PRD 需求在原型里没有落点却被带进冲刺 | S076 `uncoveredRequirements` 非空而 G4 未展示 | G4 表单强制列出 uncoveredRequirements 与 `untracedElements`；批准需勾选「已知晓」 |
| F7 | 批准时是 v3、落卡时 PRD 已出 v4 | P0 在 P4/P5 复查 | `stale_prd` 或 `partially_committed + prdSupersededDuringCommit` |
| F8 | 教练角色（D015）实例意外写看板 | `commitMode = plan-only` 下出现 `task.*` receipt | V3；plan-only 实例定义中无阶段 9–10 |
| F9 | G5 批准人没有项目写角色，靠发起 Agent 的身份落卡 | P5 以 G5 批准人为主体 | 403 → `permission-denied`，不换主体 |
| F10 | 为同一冲刺并发跑两个实例 | 8.1 业务唯一性 | 第二个请求返回已有实例 |

## 10. CN / US 差异（仅列实质性的）
- **工作日历**：CN 冲刺窗口常跨国庆/春节调休；`market = CN` 时 trigger 必填 `workCalendarRef`，S070 与 S142 都用同一版本（一个 trigger 字段，两处透传），日历未覆盖窗口 → `blocked_calendar`，不按周一至周五推算。US 缺 `holidayCalendarRef` 只降级为 S070 `assumptions[]`。
- **扩容方式**：S070 拒绝 `hoursPerDay > 10`；W030 的 G4 回退只提供「延长冲刺」与「缩范围」，**不提供**「加班扩容」选项——CN 场景常见的「周末补一下」在 W030 中没有入口。
- **合规元素缺口**：S076 `COMPLIANCE_ELEMENT_MISSING`（如 CN 面向个人用户的隐私政策/单独同意勾选、US 面向加州用户的 opt-out 链接）在 G1 只能逐条接受并写理由（决策 7）；`jurisdiction = both` 时两地缺口分开列。
- **无障碍**：US 联邦采购场景（Section 508）的 a11y 缺口与 CN GB/T 37668-2019 参照下的缺口在 G1 同样逐条接受；W030 不判定法律适用，只保证「没人明确接受就不会进冲刺」。
- **时区**：`anchorAt = sprint.startDate` 以 `sprint.timeZone` 解释；跨 CN/US 的分布式团队以冲刺时区为准，G2/G4 的截止时间也按该时区显示。

## 11. WorkspaceX 落点（基线 `30c1c4332025151610502988b0379b95ff7298c7`）
已核实（`git show 30c1c433:<path>` 读过）：
- `apps/api/src/application/board/create-task.ts`：`CreateTaskInput{orgId, projectId|null, title, ownerUserId, executor?, dueAt?, riskLevel?, waitingOn?, status?}`；拒绝码 `TITLE_REQUIRED | OWNER_REQUIRED | OWNER_MUST_BE_HUMAN | MANUAL_CREATE_CANNOT_TARGET_INBOX | UNKNOWN_STATUS | UNKNOWN_RISK_LEVEL`；id 为 `randomUUID()`，无幂等键；无估点、sprint 字段。
- `apps/api/src/interface/controllers/board.controller.ts`：`GET /tasks` 要求 `projectId`；`POST /tasks` 仅在 `projectId` 非空时调 `resolveProjectRole`；`PATCH /tasks/:id/status` 先取卡再按角色与 `listVisibleWithin` 判可见，无项目卡只允许 owner/executor。
- `apps/api/src/domain/board/transition-matrix.ts`：`decideTransition(from, to, reason?, opts?)`，拒绝码含 `INBOX_REENTRY_FORBIDDEN`、`REASON_REQUIRED`、`GLOBAL_SCOPE_CROSS_PROJECT_FORBIDDEN`。
- `apps/api/src/application/board/writeback-port.ts`：回写端口只有手工来源的 no-op 实现（头注）；`change-task-status-with-writeback.ts` 文件存在。
- `apps/api/src/domain/board/source-kind.ts:18`：`MANUAL_SOURCE_KIND`。
- `apps/api/src/application/research/guided-workflow-receipt-ports.ts`：`begin`/`finalize` receipt 仓储接口。
- `packages/contracts/src/design-prototype.ts`、`design-workbench.ts`（S076 输入来源，存在性已核）。
- 基线 `apps/api/src` 与 `packages/contracts/src` 中无冲刺（sprint）实体（`git grep -il sprint` 只命中无关的 design/live-collab 契约）。
proposed-unwired 汇总：`workflow-definition.ts`、`apps/api/src/{domain,application,infrastructure}/workflow/`、`workflow_stage_outputs`、effect-gateway、W029 G4 回执读取适配器、设计项目按 org 过滤的读取适配器、`team.roster.read`、`sprint.history.read`、看板卡 `originRefs`/`sprintId`/非手工 `sourceKind`、`evals/work-stack/W030/`。

## 12. 外部参考与溯源（A3：只取控制流模式，不复制文字）
| 来源 | 路径 | commit | 许可证（artifact 级） | 取用内容 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins（克隆 `scratchpad/upstream/knowledge-work-plugins`） | `product-management/skills/sprint-planning/SKILL.md`（:21-37 STANDALONE/SUPERCHARGED 框图、:41-45 输入五项）；`product-management/skills/write-spec/SKILL.md`（:75 写完规格后「offer … engineering ticket breakdown」）；`product-management/CONNECTORS.md`（:5、:21 `~~project tracker` 按类别而非供应商） | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`product-management/LICENSE`） | reference-only：规格 → 拆票 → 冲刺计划 → 「接了 tracker 才建票」的链条，对应本文阶段 1–10 与 `commitMode`；工具按类别声明对应 ADR-120。**不采用**：其 SUPERCHARGED 下「Create sprint, assign items」由模型直接执行——W030 把建卡放到 G5 之后并由人指派（决策 4、5） |
| RefoundAI/lenny-skills（克隆 `scratchpad/upstream/lenny-skills`） | `skills/shipping-velocity/SKILL.md`（:51-54 「Define projects by appetite not estimates」） | `13598cc54e09399bc1bc1398b0fca284110efb2f` | MIT（仓根 `LICENSE`） | reference-only：先定 appetite 再切范围 → trigger 的 `appetite` 与阶段 5 的位置。播客引语不复制 |

两者均为行为重建，不进入 `provenance[].copied`；克隆位于会话 scratchpad，不入库。

## 13. 评测（`evals/work-stack/W030/`，proposed-unwired；夹具为合成数据，确定性 case 跑回环模型）
基线（ADR-119 G5）：同一输入交给只有 `board.write` 工具、不挂 W030 的通用 Agent。

| # | 输入（fixture） | 通过判据（规则 grader） |
|---|---|---|
| E1 | PRD v2（REQ-1..6，无 blocking 问题）+ 原型 4 屏全已绘制、无未解决批注；G2 给全部 5 张草稿 team 估点；appetite 20 人日；5 人团队 10 个工作日、速度 [30,42,34]；G3 accept、G4 批准并指派、G5 整批确认 | 终态 `committed`；`cards.length = SprintPlan.committed.length`；每张卡 `criterionIds` 非空；每条 `task.create` receipt `permissionCheck.point = P5, allowed` |
| E2 | PRD 含 1 条 `blocking = true` 的 openQuestion（W029 G4 带问题批准） | 终态 `prd_not_ready`；`blockers[0] = {source: S067, kind: blocking-question}`；无 S076 调用、无任何 receipt 除 node receipt |
| E3 | S076 `ready-with-gaps`：1 条 `TOKEN_GAP` + 1 条 `COMPLIANCE_ELEMENT_MISSING`（CN 单独同意勾选缺失）；批准人尝试整批接受 | 整批接受只覆盖 TOKEN_GAP；合规缺口未逐条填理由前 `gapsAcceptedBy` 仍为 null，阶段 4 不开始；逐条接受后 S070 `entry.handoffReadiness = ready-with-gaps` 且 `gapsAcceptedBy` = 批准人 |
| E4 | G2 只给 3/5 草稿估点，另 2 张（均为 S068 must）无估点 | S068 `unestimated` 含该 2 id；S070 `status = draft-needs-estimates`；G4 批准按钮不可用，只有 `back_to_estimation`，重开的 G2 只列这 2 张 |
| E5 | G3 批准人试图把 should 条目 D4 手动改为 must | 请求被拒（schema 无此动作）；以 `deadline{kind: contract, evidenceRef}` rerun 后 D4 进 `pinned` 与 `cut.must`，新 `proposalId` 被 S070 引用 |
| E6 | 阶段 10 第 3 条 `task.create` 已写入 DB、receipt 仍 `begun` 时模拟崩溃 | 恢复后该条被 S142 判 `noop-duplicate` 或经认领补记 `succeeded`；项目中该标题的卡恰好 1 张；其余条目继续执行 |
| E7 | G4 批准后、G5 前把指派 owner U3 改为 observer | P4 检出，回 G4 重新指派；S142 未以 U3 调用；无 U3 为 owner 的卡 |
| E8 | G5 批准后执行到第 2 条时撤销 G5 批准人的项目成员关系 | 第 2 条起 receipt `denied`（403 `NO_PROJECT_ROLE`），终态 `partially_committed`；第 1 张卡保留；未改用发起 Agent 或其他人身份重试 |
| E9 | D015 发起，trigger 未给 `commitMode` | 实例 `commitMode = plan-only`；终态 `plan_published`；无任何 `task.*` receipt（V3）；随后 D003 以 `resumeFromPlanId` 发起的新实例从阶段 9 开始且不重跑 S067/S076/S068/S070 |
| E10 | market = CN，冲刺 2026-09-28 至 2026-10-11，缺 `workCalendarRef` | 进门 `INPUT_INVALID`，实例不创建；给出只覆盖到 09-30 的日历版本 → 终态 `blocked_calendar` |
| E11 | S070 返回 `over-scope`（2 条 must `must-not-fit`） | G4 只提供 back_to_scope / extend_sprint / reject；选 extend_sprint 把 endDate 延 4 天 → S070 重跑，`status = ready-for-commit` 后才可批准；G4 旧回执不适用新计划（V8） |
| E12 | G4 与 G5 之间 W029 批准了同一 documentId 的 v3 | P4 复查 → 终态 `stale_prd`；无 `task.*` receipt |
| E13 | 同 requestId 同 payload 重放；另一人以不同 requestId 为同 `(prdVersion, projectId, sprint.name)` 发起 | 前者返回同一实例零新增 receipt；后者返回已有实例 id，不新建 |
| E14 | 原型第 3 屏 `prototype[2] = null`（规划未绘制） | S076 blocker `SCREEN_NOT_DRAWN` → 终态 `handoff_not_ready`；G1 不出现（blocker 不可被接受） |
| E15 | PRD 需求 REQ-5 在原型中无落点（`uncoveredRequirements = [REQ-5]`，无 priority） | 实例可继续（W029 PRD 无 priority，S076 I1 不触发）；G4 表单列出 REQ-5 并要求勾选「已知晓」，未勾选不能批准 |
| E16 | carryover 条目 T9 在看板上为 `inbox`，S070 将其放入 committed | S142 对 T9 提 `transition → todo`（非 create）；执行后 T9 `todo`，无新卡；`decideTransition` 结果与 precheck 一致 |
| E17 | `estimation.unit = points`，appetite 以人日给出，G2 仅填 points | G2 提交被拒，提示每条需同时给 `personDays`；补齐后 S068 用 personDays、S070 用 points，两列来自同一回执 id |

G5 对比判据：E1/E4/E6/E8/E9/E15 中基线至少失败 3 条而 W030 全过，才可标 verified。

## 14. Graph change proposals
本文不改矩阵、不假定任何提议已生效。
1. **S068 `scope-cut` 的候选粒度（改 S068 契约，不改矩阵）**：S068 §4.0 写候选为「S067 的需求条目 id」，但 S070 `PRIORITY_STALE` 要求 S068 候选 = S076 `draftId`。建议 S068 的 `candidates[].kind` 增加 `"work-item-draft"`、`sourceRef.skill` 增加 `"S076"`，并把 §4.0 表格 W030 行改为「S076 的 `workItemDrafts[].draftId`」。落地前 W030 按决策 1 以 `kind = "requirement"`、省略 `sourceRef` 运行。
2. **S142 `sourceRefs.kind` 增加 `"s076-draft"`（改 S142 契约）**：W030 当前借用 `s068-backlog` 并以 `<proposalId>#<draftId>` 编码，可工作但语义不精确。
3. **S067 保留在 W030（回应 S067 §14 第 2 条）**：readiness 检查不移给 S070。S070 P1 只核对 S067 输出的 `status`，不具备 D4 的检查能力；把 D4 挪进 S070 会让同一检查两处声明。
4. **不加 S077 / S078 边（回应 S076 §13 第 2 条）**：`TOKEN_GAP` 与 a11y 缺口在 G1 暴露并需人接受（决策 7）；若评测或试用中 G1 因这两类被拒占比 > 20%，再提议加边。
5. **S073 发布就绪阶段（回应 D003 §12 第 5 条）**：不在 W030 v1 增加。W030 终点是冲刺开始前落卡，发布就绪发生在冲刺结束后，应属另一个 Workflow；由目录修订决定。
6. **S070 §14 提议 6（S142 输入加 committed 标记）**：W030 只把 committed 交给 S142（S070 P10），不需要该标记；W030 不提此需求。
7. **S070 §14 提议 1、2 已由本文裁定**：顺序见决策 1，估点会见决策 2；S142 §15 第 1 条的「S070 → S142 → S076」预期不成立，建议 S142 下次修订时改为「S070 → S142」。

## 15. 未决问题
- W029 已 PASS；P0 依赖其 G4 回执形状（`gate, documentId, versionId, contentHash, outcome`），已与 PASS 版对齐；若 W029 日后改动该形状需同步本文 §5 阶段 0。
- `capabilityCategory` 名称（`board.write`、`design.read`、`team.roster.read` 等）待 ADR-120 分类表定稿；本文均为提案名。
- 团队（roster）与历史速度接线前，S070 的容量来自调用方声明；W030 v1 的计划可信度因此受限，G4 表单须显示 S070 `assumptions[]`。
- 认领流程（8.2）中「标题逐字相等 ∧ owner 相等」的启发式在看板卡 `originRefs` 接线后应删除，改为精确匹配。
- 门超时（7 天 / G2 5 个工作日）是否上升为组织策略，待 ADR-118 实现对齐。
