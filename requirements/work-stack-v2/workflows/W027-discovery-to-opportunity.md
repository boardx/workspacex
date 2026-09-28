# W027 — Discovery-to-Opportunity

> 类型：Reference Workflow · 域：Product · 作者化任务：AUTHOR-W027 · 状态：待独立评审
> 基线：`main@30c1c4332025151610502988b0379b95ff7298c7`。仓库代码事实均在该基线读过；ADR-116~121 不在该基线树内（`git ls-tree 30c1c433 docs/adr/` 无命中），是在当前工作树的合并检出（HEAD `9e467506`，含 #4536）中读到的，下文引用它们时按「Proposed ADR」对待。
> 权威：`requirements/work-stack-v2/`（ADR-116）；运行时：ADR-118（第 4 条业务行是事实、第 5 条实例固定版本、第 6 条 effect-gateway、第 9 条 Skill 由 Workflow 固定）；工具分类：ADR-120；评测门：ADR-119。
> 对齐的已 PASS 契约（只引用，不修改）：`skills/S062-user-interview-planning.md`、`skills/S063-research-synthesis.md`、`skills/S064-problem-framing.md`、`skills/S065-opportunity-mapping.md`；划界参考 `workflows/W001-research-to-brief.md`、`skills/S066-product-brainstorming.md`。
> **参与 Skill 评审状态**：S061、S062、S009、S063、S064、S065 均已 PASS。本文只绑定它们终稿里的具名字段，并在 §2.3 列出每一处绑定。

## 1. 这个 Workflow 解决什么（一句话边界）
把**一个产品方向的意图**（「我们想让中小团队管理员首周多邀请成员」），经过「先登记判据 → 真人访谈与客户原话取证 → 按判据改判假设 → 框定问题 → 机会树」，变成**一个由人确认的目标机会（或一个有据可查的「停 / 转向 / 证据不足」结论）**。
- 不是 W028 Research-to-Insight：W028 从已有研究问题出发、有 S171 证据评审，终点是洞察；W027 从**方向假设**出发、无 S171，终点是**目标机会**。
- 不是 W029 Problem-to-PRD：W027 不写 PRD、不排 backlog（S067/S068 不在本行），`OpportunityMap.handoff.S067` 只作为 W029 的可选输入。
- 不执行实验：fake-door、concierge、pricing-commitment 等只作为人工任务列出（决策 6），W027 没有任何对外发送或触达真实用户的效果。

## 2. 组合图（精确 ID，来自两张矩阵）

### 2.1 参与 Skill（WORKFLOW-SKILL-MATRIX.md 第 33 行：`W027 | Discovery-to-Opportunity | Product | S061, S062, S009, S063, S064, S065`）
| Skill | 名称 | 模式 | 在 W027 中的唯一职责 | 评审状态 |
|---|---|---|---|---|
| S061 | Product Discovery | `plan`（阶段 1）、`update`（阶段 7） | 登记可证伪假设与**先于证据冻结**的判据（`criteriaDigest`）；取证后按判据机械改判，给 `discoveryState` | PASS |
| S062 | User Interview Planning | `discovery` | 产出研究问题（`questionId` 全链主键）、分层抽样、筛选题、同意计划、中立提纲 | PASS |
| S009 | Customer Research | `voice-corpus` | 从访谈转写 / 工单 / 开放题取逐字片段，产出与 S063 输入同形的 `corpus[]` | PASS |
| S063 | Research Synthesis | `qualitative-corpus` | 主题化 Finding；本 Workflow 中恒为 `status="provisional"`（S063 决策 6、X6） | PASS |
| S064 | Problem Framing | — | 由改判后的读数框定 `ProblemFrame`（draft / needs-choice …） | PASS |
| S065 | Opportunity Mapping | `build`（首轮）/ `revise`（二轮） | 机会树、兄弟支配比较、建议目标 | PASS |

Skill 版本由 `WorkflowDefinition(W027, v1).stages[*].skills[*] = {stableId, versionRange}` 在启动时解析并冻结进实例（ADR-118 第 5 条）。S061 在两个阶段出现，两个阶段固定**同一个** S061 版本（`update` 需校验 `plan` 产出的 digest，跨版本不保证 digest 算法一致）。发起 Agent 不需要挂载这些 Skill（ADR-118 第 9 条），只需在 `workflowAllowlist` 中被允许运行 W027 v1；`workflowAllowlist` 在基线 `apps/api/src`、`packages/contracts/src` 中无命中 → **proposed-unwired**（与 S065 §8 一致）。

### 2.2 消费者（DIGITALHUMAN-COMPOSITION-MATRIX.md 中 Exact Workflows 含 W027 的行，共 3 个）
| DigitalHuman | 矩阵行 | Workflows 列（原样） | 在 W027 中的差异（只经 trigger 传入） |
|---|---|---|---|
| D003 Product Manager | 第 9 行 | W027, W028, W029, W030, W031, W032 | 缺省 `ownerRole="pm"`：G5/G6 的批准人须为发起人本人 |
| D011 Design Thinking Expert | 第 17 行 | W027, W028, W029, W031, W002 | 缺省 `journeySteps` 由发起人在 G1 提供（D011 gaps 含 Persona/Journey facilitation，W027 不补这一能力，见 §13 提议 4） |
| D043 UX Researcher | 第 49 行 | W027, W028, W031, W060 | 缺省 `ownerRole="researcher"`：G2 / G3（提纲与田野）的批准人为发起人；G6（目标机会）**必须**另有产品 owner 签（决策 8） |

各 D 行 Skill 列只列直接对话 Skill（ADR-118 第 9 条），与 W027 能否运行无关；本文不提出任何挂载边。

### 2.3 阶段间接口绑定（字段级，逐条来自对方文档）
| 接缝 | 上游字段 | 下游字段 | 绑定方式 | 对方状态 |
|---|---|---|---|---|
| 触发 → S061 plan | `trigger.intent / seedAssumptions / market / locale` | S061 §5 `plan` 输入同名字段 | `intent/market/locale` 原样；`seedAssumptions` 每项补 `origin:"stated-by-user"`（trigger 元素只有 `{text}`，S061 §5 要求 `{text, origin}`，`origin` 必填） | S061 PASS |
| S061 plan → S062 | `DiscoveryPlan.outcome`、`assumptions[selected]`、`evidenceRequests[]` | S062 §5 `decision / hypotheses[] / priorEvidence[] / context` | 见 §5 说明「阶段 2 映射」 | S062 PASS；S062 §14 提议 3 把这一映射交给 W027 定义，本文在 §5 定义 |
| S062 → S009 | `researchQuestions[].{questionId,text}`、`strata[]` | S009 §5 `questions[]`、`subject.frame` | `questions` 原样（S062 决策 5）；`strata` 降维见决策 5 | S009 PASS；S062 §14 提议 1 的接缝 |
| S009 → S063 | `CustomerEvidencePack.corpus[]` | S063 §5 `corpus[]` | 原样（S009 V2 声明同形） | S063 PASS |
| S063 → S061 update | `ResearchSynthesis.synthesisId`、`findings[].questionId` | S061 §5 `synthesisRef`、`findingMap[]` | `findingMap` 由 `rqTestMap` 机械推导（决策 3） | S061 PASS |
| S061 update + S063 → S064 | `DiscoveryReadout`、`synthesisId` | S064 §5 `rawInput`、`synthesisRefs[]` | 见 §5 说明「阶段 8 输入」 | S064 PASS |
| S064 → S065 | `ProblemFrame.frameId/version`（`handoff.S065.rootProblem` 非空） | S065 §5 `frameRef`、`synthesisRefs`、`readoutRef` | 服务端读取，I3 不接受内联 | S065 PASS |

## 3. 实体特有决策

**决策 1 — 判据在任何证据进入实例之前冻结，冻结点是 G1 的人工回执，不是 S061 的输出时刻。**
S061 P6 计算 `criteriaDigest`，但「看证据前修订」只有在 Workflow 层面才可判定：W027 把 G1 批准回执写成 `{planId, planVersion, criteriaDigest, approvedAt, approverUserId}`，并以此为界——G1 之后、阶段 5（S009 取证）完成之前修订判据记 `beforeEvidence=true`；阶段 5 完成之后任何修订一律 `beforeEvidence=false`，且 `DiscoveryOutcome.criteriaAmendedAfterEvidence=true` 显示在最终产物首屏。阶段 7 调 S061 `update` 时，W027 传入的 `criteriaDigest` 取自 **G1 回执**，不取自调用时的 plan 行；两者不一致即 S061 返回 `CRITERIA_TAMPERED`，W027 不重试，进入 G4 让人决定「按新版判据并标 after-evidence」或「取消」。

**决策 2 — W027 不加 S171；provisional 证据可以进入 S064/S065，但 W027 的终点目标永远标「探索级」，不得作为 W029 的已验证输入。**
回应 S063 §14 提议 1 的二选一：选「接受风险并声明」。理由：(a) 矩阵第 33 行没有 S171，本文不改边；(b) W027 的样本是 5–15 人的探索访谈，S171 的 GRADE 式分级对单一研究的定性语料增益有限，真正的防线是 S061 的预登记判据与 S065 决策 4 的「provisional 封顶中」；(c) 需要「高」证据强度的场景应走 W028（有 S171）。落地规则：`DiscoveryOutcome.evidenceGrade` 恒为 `"exploratory-provisional"`；`OpportunityMap.evidenceBasis.anyProvisional` 必须为 `true`（schema 不变式 W5）；W027 发布的目标机会若被 W029 引用，W029 须自行决定是否补 W028，W027 不写任何「已验证」措辞。是否把 S171 加进本行见 §13 提议 1（只提议）。

**决策 3 — Finding → 测试的映射由「RQ↔测试」的人工映射机械推导，模型不做语义匹配。**
S061 决策 3 要求 `findingMap` 显式给出；S062 决策 5 规定 `questionId` 由 S062 唯一生产；S063 的每个 theme Finding 带 `questionId`。W027 因此在 **G2**（提纲审批）处让人确认一张 `rqTestMap: Array<{questionId, testIds[]}>`（W027 预填建议，来源标 `model-suggested`，人可改；每个 `selected` 测试必须至少被一个 RQ 覆盖，否则 G2 不能批准）。阶段 7 的 `findingMap` = 对每个 `testId`，取 `findings[].questionId ∈ rqTestMap⁻¹(testId)` 且 `kind ∈ {theme, conflict}` 的全部 `findingId`，纯函数计算、可复算（`deriveFindingMap`，proposed-unwired）。映射结果为空的测试照 S061 U2 判 `untested`，W027 不补救。

**决策 4 — 真人访谈在 Workflow 之外由人执行；W027 只做「提纲导入」这一个内部写，永不预约、永不外发。**
基线已有访谈执行面且把人类门写死：`send-booking-invite.ts` 首行判定 `canSendBookingInvite(actorKind)`，只有 `actorKind==="human"` 才放行（`domain/interview/booking-draft.ts:27`）；`confirm-outline.ts` 在缺项时抛 `OUTLINE_INCOMPLETE`；`start-session.ts:83` 要求大纲 `status==="confirmed"`。W027 阶段 3 只把 S062 `guide[]` 以 `pending_confirm` 导入访谈模块（适配器 `importPlanAsOutline` 为 **proposed-unwired**，名称沿用 S062 决策 1），确认仍走 `confirmOutline`，预约与外发仍走人类主体。阶段 4「田野」是一个等待人类声明完成的门（G3），W027 不轮询访谈模块、不推断「访谈做完了」——基线中是否有可订阅的「访谈场次完成」事件 **UNVERIFIED**，本文不依赖它。

**决策 5 — S062 的分层条件不能被 S009 `SamplingFrame` 表达时，不降维猜测，改由 G3 的人工分层归属承载。**
S009 §5 `SamplingFrame.filters` 只有 `plan/region/tenureMonths/industry/lifecycleStage`，表达不了「尝试过但未完成导出」这类行为判别（S062 §14 提议 1 已指出）。W027 规则：(a) S062 `strata[].criterion` 能逐字映射到上述五个字段的，映射进 `subject.frame.filters`；(b) 不能映射的，**不**写入 filters，而在 G3 要求研究员为每条访谈记录填 `stratumId`（`fieldworkLog`），W027 以此核对 `plannedPerStratum` 与反幸存者层（S062 OUT7）是否真的采到人；(c) 工单 / 开放题来源的片段无 `stratumId`，只进入 S063，不计入分层覆盖。反幸存者层实际受访 < 3 → `DiscoveryOutcome.limitations` 必须含该层名，且 S061 中依赖该层 RQ 的测试在 G4 被标注「分层未覆盖」。

**决策 6 — S061 `externalTasks`（`evidenceOwner=external` 的测试，即 S061 P5 所称「W027 内无对应 Skill 的方法」；S061 决策 6 列举 fake-door / concierge / pricing-commitment / usage-data-query）不在 W027 v1 执行，作为产物中的待办交还给人。**
回应 S061 §13 提议 1：接受人工任务作为终态内容，不为 W027 新增实验执行 Skill。W027 的六个 Skill 没有任何写外部能力；这些方法要么触达真实用户（CN《广告法》、US FTC Act §5 的欺骗性表述风险，S061 §9），要么需要行为数据查询（`usage` 不是「声音」，S009 IN4 禁止进 `voice-corpus`）。W027 v1 不执行这些方法、不定义 S061 U3b 所需的外部结果批准门（`approvalRef` 指向的已批准记录），阶段 7 调 `update` 时也**不传** `externalResults`；因此 S061 U3b 与 S061 §7「经 ADR-118 effect-gateway 与 W027 人工门执行」所描述的路径在 W027 v1 中不可达（proposed-unwired，见 §13 提议 6），对应测试在本实例阶段 7 必然 `untested`；若它是 `kills-direction` 假设，S061 U5 只能落到规则 4 `need-more-evidence`，W027 据此进入终态 `awaiting_external_tests`，而不是在缺证据的情况下继续画树（决策 7）。

**决策 7 — 读数状态决定后半程是否运行，证据回合最多 2 轮。**
S061 `discoveryState` 到 W027 路由的唯一表：
| `discoveryState` | W027 动作 |
|---|---|
| `continue-provisional` | 进入阶段 8（S064） |
| `continue` | 在 W027 中不可达（S063 恒 provisional，S061 决策 4 降级）；若出现即判 S061 输出不合规，按结构化输出重试 |
| `pivot` | 进入阶段 8，S064 `rawInput` 只携带被 `supported` 的 `desirability-problem` 假设；被 `refuted` 的解法假设对应的 `candidateSolutions` 不传入 S065（在 `DiscoveryOutcome.retiredSolutions` 中列出） |
| `stop` | 终态 `direction_refuted`，不运行 S064/S065 |
| `need-more-evidence` | 若全部 `inconclusive/untested` 测试的 `evidenceOwner=external` → 终态 `awaiting_external_tests`；否则若 `evidenceRound < 2` → 以 `nextEvidenceRequests` 回到阶段 2 开第二轮；否则终态 `evidence_exhausted` |
第二轮复用第一轮的 `planId`、不新增假设（新假设须新开实例），因此判据 digest 不变；第二轮的 S063 合成输入是**两轮 corpus 的并集**，S065 使用 `revise` 模式仅在已有首轮地图时发生（首轮 `stop/need-more-evidence` 不会产生地图，所以实际上 W027 v1 中 S065 只用 `build`；`revise` 留给后续实例以 `previousMapId` 显式发起）。

**决策 8 — 目标机会的确认（G6）是 multi-gate：研究员可以框定问题，但不能单独认定「做哪个机会」。**
S065 决策 5 与 S064 决策 5 都把 `accepted` 交给 Workflow 人工关卡。W027 规定：G5（接受 ProblemFrame）由发起人 `required`；G6（接受 `proposedTarget` 或从 `needs-choice` 的前沿中选一个）需要**产品 owner** 签。发起人即产品 owner（D003 发起、`ownerRole="pm"`）时单签；D043 / D011 发起时须第二签人 = trigger 中的 `productOwnerUserId`（必填），二者不得为同一人。S065 输出 `insufficient-evidence` 时 G6 不提供「选定」按钮，只能「接受为无目标地图」或「开新实例补证据」。

**决策 9 — 每个效果点前重查权限；取证快照在跨越人工门后重验同意位。**
重查点（全部落事件，任何一点失败都不沿用旧授权）：
- **P1（阶段 3 导入提纲前）**：发起人对目标访谈 / 项目的写权限；`existingInterviewId` 给出时按 `decideInterviewVisibility` + `discloseDecided` 判可见（S062 §8，已核实同组合在 `generate-outline.ts` 使用）。失败 → 不导入，G2 回执作废，回到 `awaiting_plan_review`。
- **P2（阶段 5 S009 调用前，即 G3 之后）**：发起人对每个来源类所需能力的组织授权（ADR-120）+ 对象可见性；部分来源被拒按 S009 走 `status="partial"`，**不**换同类供应商重试（ADR-120 第 3 条）。
- **P3（阶段 6 S063 调用前 + 每次 G4/G5/G6 批准后）**：对 corpus 全部 `segmentId` 重跑 S009 §8 G6「交付前重验」（可见性 + 同意位 `ai_analysis`，`deriveConsentStatus` 派生）。撤回同意的片段移出 corpus，**使 S063 起全部下游阶段失效重跑**；全部被撤 → 终态 `consent_revoked`。
- **P4（阶段 10 发布前）**：发起人对目标项目 / 文档的写权限；地图与 frame 中引用的全部 `findingId` 以发起人身份可读。
- **P5（崩溃恢复）**：从 checkpoint 恢复的实例先对 corpus 执行一次 P3，再从最早失效阶段重跑。

## 4. Trigger schema
```ts
// packages/contracts/src/workflow-definition.ts（ADR-118 新建，proposed-unwired）中 W027 的 trigger 输入
const W027Trigger = z.object({
  kind: z.enum(["manual", "agent_request"]),        // 不支持 schedule / webhook：发现研究必须由人带着方向发起（见说明）
  requestId: z.string().uuid(),
  orgId: OrgId,
  initiatorUserId: UserId,                          // 权限主体；agent_request 时仍是背后的人
  initiatorAgentVersionId: z.string().nullable(),   // 须在该 Agent 的 workflowAllowlist 内（proposed-unwired）
  ownerRole: z.enum(["pm", "researcher", "design"]), // 缺省按 §2.2：D003→pm，D043→researcher，D011→design
  productOwnerUserId: UserId.optional(),            // ownerRole≠"pm" 时必填，且 ≠ initiatorUserId（决策 8）
  intent: z.string().min(20).max(2000),             // = S061 plan.intent
  decision: z.string().min(10).max(300),            // 本轮发现要改变的具体决定；= S062 decision（S062 P1）
  seedAssumptions: z.array(z.object({ text: z.string().max(200) })).max(30).default([]),
  targetPopulation: z.string().max(300),            // = S062 targetPopulation
  projectId: z.string(),                            // 发布与提纲导入的归属项目
  existingInterviewId: z.string().optional(),       // 已建好的访谈；否则阶段 3 新建（proposed-unwired）
  market: z.enum(["CN", "US", "global"]),
  locale: z.enum(["zh-CN", "en-US"]),
  fieldwork: z.object({
    plannedMinutes: z.number().int().min(15).max(120),
    maxSessions: z.number().int().min(1).max(60),
    channels: z.array(z.enum(["existing-customers","csm-referral","in-product-intercept","panel-vendor","internal-staff","public-post"])).min(1),
    modality: z.array(z.enum(["remote-video","remote-audio","in-person"])).min(1),
    incentive: z.object({ kind: z.enum(["cash","gift-card","service-credit","none"]), note: z.string().optional() }).optional(),
    jurisdiction: z.enum(["CN", "US", "CN+US"]),
    deadlineDays: z.number().int().min(7).max(60).default(42),  // G3 超时；本字段是该数值的唯一声明处
  }),
  corpusSources: z.array(z.enum(["interview","call-transcript","ticket","survey-open","public-review"])).min(1).default(["interview"]),
  corpusWindow: z.object({ from: z.string().date(), to: z.string().date() }),   // S009 window，跨度 ≤ 730 天
  journeySteps: z.array(z.string()).min(3).max(9).optional(),   // 透传 S065
  constraints: z.array(z.object({ text: z.string(), kind: z.enum(["hard","soft"]) })).max(20).default([]),
});
```
- `corpusSources` 不含 `usage` / `email` / `crm-note`：S009 IN4 禁止 `usage` 进 `voice-corpus`；邮件与 CRM 备注多为内部转述（`reported-speech`），S009 OUT1 禁止 `dossier.statedNeeds/statedPains` 与 `languageBank` 引用这类片段（并不从 voice-corpus 中排除它们），对 W027 的发现证据价值低，徒增读取面。
- 不支持 `schedule`：一个方向的发现是一次性研究，定时重跑会在同一 `planId` 下反复看新证据，破坏决策 1 的「证据前 / 后」边界。
- 请求体中出现 `participants/contacts/phone/email/wechat` 任一键 → 拒绝启动（与 S062 IN6 同判据，W027 在 trigger 层先拦）。

## 5. 阶段表
状态机：`requested → hypothesizing → [G1] → interview_planning → [G2] → P1 → outline_importing → awaiting_fieldwork → [G3] → P2 → gathering → P3 → synthesizing → adjudicating → [G4] → (回 interview_planning ｜ framing) → [G5] → mapping → [G6] → P4 → publishing → 终态`

| # | stage | Skill IDs | 工具能力分类（ADR-120，均为提案名） | 状态转移 | sideEffect | humanGate |
|---|---|---|---|---|---|---|
| 1 | hypothesize | S061（`plan`） | 条件：`knowledge.read`（解引用 `contextRefs`）；optional `sandbox.exec`（`rank.mjs`、`digest.mjs`） | requested → hypothesizing → hypotheses_drafted ｜ outcome_unanchored（等待补答） | read | **G1** required：确认 outcome、入选假设、判据；批准回执冻结 `criteriaDigest`（决策 1）。`outcome.status="unanchored"` 时 G1 只能「补答后重跑」或「取消」 |
| 2 | plan_interviews | S062（`discovery`） | 条件：`knowledge.read`、`interview.read`（仅 `existingInterviewId`）；optional `sandbox.exec`（`plan-lint.mjs`） | hypotheses_frozen → interview_planning → interview_planned ｜ plan_blocked | read | **G2** required：批准提纲 + 确认 `rqTestMap`（决策 3）+ 授权导入。S062 `status∈{blocked, needs-clarification}` 时 G2 不可批准 |
| 3 | import_outline | —（平台适配器 `importPlanAsOutline`，proposed-unwired） | `interview.write`（内部写，不经 MCP） | plan_approved → outline_importing → outline_pending_confirm | write | none（G2 覆盖）；执行前 **P1**。`fieldworkMode="none"` 时跳过（见说明） |
| 4 | fieldwork | —（人在访谈模块执行 `confirmOutline`、预约、访谈） | — | outline_pending_confirm → awaiting_fieldwork → fieldwork_declared ｜ fieldwork_abandoned | none（W027 自身无效果） | **G3** required：研究员提交 `fieldworkLog`（每场 `interviewRecordRef + stratumId`），或声明放弃；超时 `fieldwork.deadlineDays` |
| 5 | gather | S009（`voice-corpus`） | `transcript.read`；条件：`ticket.read`、`survey.read`、`web.fetch`（仅 `public-review`） | fieldwork_declared → gathering → corpus_ready ｜ consent_revoked ｜ corpus_empty | read | none；执行前 **P2** |
| 6 | synthesize | S063（`qualitative-corpus`，`domainProfile="product"`） | `knowledge.read`（限输入列出的 `sourceVersionId`）；optional `sandbox.exec`（`confidence.mjs`） | corpus_ready → synthesizing → synthesized | read | none；执行前 **P3** |
| 7 | adjudicate | S061（`update`） | `skill-artifact.read`；optional `sandbox.exec`（`adjudicate.mjs`） | synthesized → adjudicating → adjudicated → 按决策 7 路由 | read | **G4** ask：展示 verdict 与 `unplannedSignals`；以下任一成立升为 required：`CRITERIA_TAMPERED`、任一 verdict `reason="concentrated-source"`、决策 5 的「分层未覆盖」、决策 7 将开第二轮 |
| 8 | frame | S064 | 条件：`knowledge.read`（读 `synthesisRefs`、`previousFrameId`）；optional `sandbox.exec`（`check-frame.mjs`） | adjudicated(continue-provisional ｜ pivot) → framing → frame_drafted ｜ frame_needs_choice ｜ frame_too_broad | read | **G5** required：接受 frame（写 `accepted`）或在 `needs-choice` 中选 `chosenProblemIndex` 后重入 S064（≤2 次）；`too-broad`/`solution-in-disguise` 只能「修改 rawInput 重入」或终止 |
| 9 | map | S065（`build`） | 条件：`knowledge.read`；optional `sandbox.exec`（`check-map.mjs`、`dominance.mjs`） | frame_accepted → mapping → map_proposed ｜ map_needs_choice ｜ map_insufficient | read | **G6** required，multi-gate（决策 8）：接受 `proposedTarget` / 从前沿选定 / 接受为无目标地图 / 拒绝 |
| 10 | publish | —（平台） | `artifact.write`（内部写，不经 MCP） | g6_decided → publishing → 终态 | write | none（G6 覆盖）；执行前 **P4** |

说明：
- **阶段 2 映射（S061 → S062）**：`decision` = trigger.decision；`context.who` = `DiscoveryPlan.outcome.actor`，`context.situation` = `outcome.behavior + costOfInaction`；`hypotheses[]` = 入选假设 `{hypothesisId: assumptionId, text}`（S062 OUT10 会检查假设名词不出现在提纲中，这正是 W027 需要的中立性）；`priorEvidence[]` = 对每个可解引用的 `assumptions[].contextRef` 生成 `{evidenceRef: contextRef, summary}`，`summary` 取该假设的 `text`（即「此证据被引用来支撑的假设」，不另做模型摘要）；`targetPopulation` 取 trigger；`constraints` **不**取 trigger.constraints（那是 `Array<{text,kind}>`，形状不符），而由 trigger.fieldwork 逐字段映射：`{plannedMinutes, maxSessions, channels, modality, incentive, jurisdiction}` 同名原样，`deadlineDays` 不传（仅供 G3 超时），`languages` 按 `jurisdiction` 推导——`CN`→`["zh-CN"]`，`US`→`["en-US"]`，`CN+US`→`["zh-CN","en-US"]`，再并入 trigger.locale（去重），以满足 S062 IN5。第二轮时 `hypotheses[]` 只含 `inconclusive/untested` 且 `evidenceOwner≠external` 的测试所属假设，`priorEvidence` 追加 `{evidenceRef: 首轮 synthesisId, summary: "W027 首轮 S063 综合"}`。
- **`fieldworkMode`**：全部入选测试的 `evidenceOwner ∈ {S009}`（工单 / 开放题挖掘）且 `corpusSources` 不含 `interview` 时为 `none`：跳过阶段 3、4，S062 仍运行（它是 `questionId` 的唯一生产者，S062 决策 5），其提纲只作为问题集，`limitations` 写明「未做访谈」。否则为 `interviews`。
- **阶段 5 输入**：`mode="voice-corpus"`，`questions` = S062 `researchQuestions[].{questionId,text}`，`subject={kind:"segment", frame}`（决策 5 映射），`window` = trigger.corpusWindow，`sourceKinds` = trigger.corpusSources，`purpose="discovery"`。S062 标 `pilotExcludedFromCorpus: true`：G3 中标为 `pilot` 的场次，其记录不进入 S009 的来源列表。
- **阶段 5 结果路由**：S009 `status="degraded-consent"` → 终态 `consent_revoked`；`status="partial"` 继续但把 `sourceStatus` 中 `denied/unavailable` 原样写入 `DiscoveryOutcome.coverage`；`segments` 为空且非同意原因 → 终态 `evidence_exhausted`（`why="corpus_empty"`）；`concentration.flag="dominated"` → G4 升 required。
- **阶段 8 输入（S064）**：`rawInput` = 按决策 7 选出的 `supported` 假设文本 + 被 `refuted` 的解法假设（作为「不要框成这个」的负例，放入 `constraints` 的 soft 项）；`synthesisRefs=[{skill:"S063", synthesisId}]`；`market`、`locale` 取 trigger。S064 的措辞上限由服务端读 S063 `assertionCeiling`（S064 决策 4），W027 不传 ceiling。
- **阶段 9 输入（S065）**：`frameRef={skill:"S064", frameId, version}`（G5 回执中的版本）；`synthesisRefs` 同上；`readoutRef={skill:"S061", planId, planVersion}`；`journeySteps`、`constraints` 取 trigger；`market`、`locale` 取 trigger。S065 I3 禁止内联，W027 只传 id。
- **G5 与 S064 的 `accepted`**：S064 输出只到 draft；G5 批准回执 `{frameId, version, acceptedBy, acceptedAt}` 是 `accepted` 的唯一写入源（S064 决策 5）。S065 A1 允许 `status=draft` 或已 accepted，W027 只在 accepted 后调用，防止未确认的根被建树。
- **G6 与 S065 的 `accepted`**：G6 回执 `{mapId, version, targetOppId | null, signers[]}` 是目标机会被接受的唯一写入源（S065 决策 5）；S065 输出里的 `decision.status` 不被改写。

## 6. 产出 schema
```ts
// W027 只定义自己的投影与回执；Skill 产物以 id + version 引用，不复制其字段。
const GateReceipt = z.object({
  gateId: z.enum(["G1","G2","G3","G4","G5","G6"]),
  instanceId: z.string(), attempt: z.number().int(),
  decision: z.enum(["approved","revised","rejected","abandoned","timed_out"]),
  signers: z.array(z.object({ userId: UserId, role: z.enum(["initiator","product_owner"]) })).min(1),
  payloadDigest: z.string(),                 // 被批准内容的 sha256（G1 = criteriaDigest；G2 = plan + rqTestMap；G5 = frame 版本；G6 = map 版本 + target）
  decidedAt: z.string().datetime(),
});

const FieldworkLog = z.object({
  sessions: z.array(z.object({
    interviewRecordRef: z.string(),          // 访谈模块内记录 id；不含姓名/联系方式
    stratumId: z.string(),                   // S062 strata[].stratumId
    pilot: z.boolean(),
    participantId: z.string(),               // 与 S009 segments[].participantId 同一命名空间（UNVERIFIED：访谈模块主体 id 是否即此 id）
  })).max(60),
  declaredBy: UserId, declaredAt: z.string().datetime(),
});

const DiscoveryOutcome = z.object({
  outcomeId: z.string(), instanceId: z.string(), definitionVersion: z.string(),
  terminalState: W027TerminalState,          // §7
  evidenceGrade: z.literal("exploratory-provisional"),       // 决策 2
  intent: z.string(), decision: z.string(),
  plan: z.object({ planId: z.string(), planVersion: z.number(), criteriaDigest: z.string(),
                   frozenAtGate: z.literal("G1"), criteriaAmendedAfterEvidence: z.boolean() }),
  rounds: z.array(z.object({
    round: z.union([z.literal(1), z.literal(2)]),
    interviewPlanId: z.string(),             // S062 planId
    rqTestMap: z.array(z.object({ questionId: z.string(), testIds: z.array(z.string()).min(1) })),
    fieldworkMode: z.enum(["interviews","none"]),
    stratumCoverage: z.array(z.object({ stratumId: z.string(), planned: z.number(), achieved: z.number(),
                                        isNonCompleterStratum: z.boolean() })),
    evidencePackId: z.string().nullable(),   // S009 packId
    synthesisId: z.string().nullable(),      // S063 synthesisId（status 恒 provisional）
  })).min(1).max(2),
  readout: z.object({ planId: z.string(), planVersion: z.number(), discoveryState: z.enum(["continue-provisional","pivot","stop","need-more-evidence"]) }).nullable(),
  frame: z.object({ frameId: z.string(), version: z.number(), acceptedAtGate: z.literal("G5") }).nullable(),
  map: z.object({ mapId: z.string(), version: z.number(),
                  targetOppId: z.string().nullable(),       // 仅来自 G6 回执
                  decisionStatusFromS065: z.enum(["proposed","needs-choice","insufficient-evidence"]) }).nullable(),
  retiredSolutions: z.array(z.object({ solutionId: z.string(), refutedAssumptionId: z.string() })),
  externalTasks: z.array(z.object({ taskId: z.string(), testId: z.string(), method: z.string(), description: z.string(),
                                    complianceNotes: z.array(z.string()) })),  // 决策 6：只列出，不执行；taskId/testId/description 取 S061 externalTasks[]，method/complianceNotes 按 testId 连接 S061 tests[] 取得；保留 taskId 供 S061 U3b 回流做键
  coverage: z.object({ sourceStatus: z.array(z.object({ sourceKind: z.string(), state: z.enum(["read","denied","unavailable","not-requested"]) })),
                       consentExcludedSegments: z.number(), concentrationFlag: z.enum(["ok","dominated"]) }),
  limitations: z.array(z.string()),
  gateReceipts: z.array(GateReceipt),
  publishReceipt: z.object({ receiptId: z.string(), artifactRef: z.string() }).nullable(),
});
```
**Schema 不变式（终态 ↔ 效果，`scripts/check-w027-outcome.mjs`，proposed-unwired）**：
- **W1** `terminalState="target_accepted"` ⇔ `map.targetOppId ≠ null` ∧ 存在 `G6.decision="approved"` 且 `signers` 满足决策 8 ∧ `publishReceipt ≠ null`。
- **W2** `map.targetOppId ≠ null` ⇒ `map.decisionStatusFromS065 ∈ {proposed, needs-choice}`，且当为 `needs-choice` 时 `targetOppId ∈` S065 该层 `frontier`；`insufficient-evidence` ⇒ `targetOppId = null`。
- **W3** `terminalState ∈ {direction_refuted, awaiting_external_tests, evidence_exhausted}` ⇒ `frame = null ∧ map = null`（未框定就不画树），且 `readout ≠ null`。
- **W4** 任一终态：不存在对外发送类 receipt（W027 无 high-impact 阶段）；outline 导入 receipt 数 ≤ 轮次数，且每条都有同轮 `G2.approved` 在前。
- **W5** `map ≠ null` ⇒ 服务端读到的 `OpportunityMap.evidenceBasis.anyProvisional = true`。
- **W6** `plan.criteriaDigest` 等于 G1 回执 `payloadDigest`；若 `criteriaAmendedAfterEvidence=true`，`limitations[0]` 必须声明之。
- **W7** 每个 `rounds[].rqTestMap` 覆盖该轮全部入选且 `evidenceOwner≠external` 的 `testId`。
- **W8** `publishReceipt ≠ null` ⇒ `terminalState ∈ {target_accepted, map_without_target, direction_refuted, evidence_exhausted, awaiting_external_tests}`（发布的是「结论页」，`rejected/cancelled/failed/consent_revoked/fieldwork_abandoned/plan_blocked` 不发布）。
- **W9** 输出中不得出现 `%`、「大多数用户」、"most users"（与 S065 不变式 8 同判据，覆盖 W027 自己写的 `limitations` 与结论页文案）。

## 7. 终态
| 终态 | 条件 | 产物 / 效果 |
|---|---|---|
| `target_accepted` | G6 批准某机会为目标，P4 通过 | 发布结论页（DiscoveryOutcome + 地图 + frame 引用）；`OpportunityMap.handoff.S067` 可供 W029 引用，标「探索级」 |
| `map_without_target` | G6 选择「接受为无目标地图」（S065 为 needs-choice 未选定或 insufficient-evidence） | 发布结论页；`researchQuestions` 列为下一轮建议 |
| `direction_refuted` | S061 `stop` | 发布结论页（被推翻的假设 + verdict + 证据 id） |
| `awaiting_external_tests` | 决策 6/7：剩余关键测试只能由外部方法完成 | 发布结论页，`externalTasks` 列为待办；新实例可带 `seedAssumptions` 续做 |
| `evidence_exhausted` | 第二轮后仍 `need-more-evidence`，或 corpus 为空 | 发布结论页（各 RQ 覆盖与缺口） |
| `plan_blocked` | G1 或 G2 因 S061 unanchored / S062 blocked 等在 14 天内未解决，或被拒 | 不发布；已存业务行保留 |
| `fieldwork_abandoned` | G3 声明放弃或超时 `deadlineDays` | 不发布；已导入的提纲保持 `pending_confirm` 或人已确认的状态，W027 不回删 |
| `consent_revoked` | P3 / S009 发现可用片段全部因同意撤回或撤权被移除 | 不发布；S063 及以后产物标失效 |
| `rejected` | G5 或 G6 被拒 | 不发布；产物保留 30 天用于评测 |
| `cancelled` | 发起人在任一非终态取消 | 不发布 |
| `failed` | 不可重试错误：固定的 Skill 版本被撤销且无兼容版本、组织撤销 W027 授权、S061 `CRITERIA_TAMPERED` 后 G4 选择放弃 | 失败原因码 |

## 8. Receipts、幂等与崩溃恢复
沿用 ADR-118 的统一 receipt（形状同基线 `apps/api/src/application/research/guided-workflow-receipt-ports.ts` 的 `begin` / `finalize` + `payloadFingerprint`，已核实）。W027 特有：
- **实例幂等键**：`(orgId, initiatorUserId, requestId)`；同键不同 `payloadFingerprint` → `IDEMPOTENCY_KEY_REUSED`。
- **S061 plan**：一个 receipt，键 `hash(instanceId, "plan", intent, seedAssumptions)`；G1 之后 plan 行只读，G1 之后的崩溃恢复**永不**重跑 `plan`（重跑会产生新的 `assumptionId` 与 digest，破坏决策 1）。
- **提纲导入（唯一的外部可见写）**：键 `hash(instanceId, round, s062PlanId)`，导入时把该键写进访谈大纲的外部引用字段（字段是否存在 **UNVERIFIED**；若不存在，由 `importPlanAsOutline` 的实现补，proposed-unwired）。崩溃发生在 begin 之后、finalize 之前：恢复时先按外部引用查大纲是否已建，已建则直接 finalize，绝不重复建。
- **田野**：G3 回执即田野事实；W027 不从访谈模块反推场次数。恢复时若 G3 未决，继续等待并保留原超时起点（超时不因崩溃重置）。
- **S009 / S063**：各一个 receipt，键包含 `fieldworkLog` 摘要与 `corpusWindow`；已 finalize 的 pack / synthesis 在恢复时复用，**不重读来源**——但必须先执行 P5（= P3），有片段被撤则从 S063 重跑（S009 pack 以剔除后的片段集生成新版本，旧版本标 superseded）。
- **S061 update / S064 / S065**：纯推理，receipt 只用于防重复计费与计数；输入全部是 id，重跑结果以脚本复算一致为准（S061 `adjudicate.mjs`、S065 `dominance.mjs`）。
- **发布**：键 `hash(instanceId, outcomeId, mapVersion|null)`；发布前 P4。
- **重试预算**：Skill 结构化输出失败 ≤ 3 次（计数写业务行，跨崩溃不清零）；S064 重入 ≤ 2 次；证据回合 ≤ 2。
- **业务行**：DiscoveryPlan / InterviewPlan / EvidencePack / ResearchSynthesis / DiscoveryReadout / ProblemFrame / OpportunityMap 均为 ADR-118 的阶段输出业务行（按 `instanceId + stageId + attempt`）；具体表名等 ADR-118 实现确定（与 W001 评审非阻断项同一处理）。checkpoint 只存指针。
- 权限被拒后不得切换同分类其他供应商（ADR-120 第 3 条），例如 `transcript.read` 某会议转写供应商 403 不能改用另一家。

## 9. CN / US 差异（仅列实质性的）
| 维度 | CN | US |
|---|---|---|
| 访谈录音与 AI 分析 | 《个人信息保护法》：录音、转写、AI 分析须分别告知同意；S062 `consentPlan` 固定映射 `CONSENT_ITEMS`（已核实 `packages/contracts/src/consent-item.ts`），W027 在 P3 按 `ai_analysis` 位过滤，撤回即剔除 | 无统一联邦法；加州受访者适用 CCPA/CPRA，部分州（如伊利诺伊）对录音须全体同意；同一 P3 机制，法律依据不同 |
| 语料跨境 | `jurisdiction="CN+US"` 且访谈在 CN 进行时，转写进入 US 部署的模型分析构成出境；W027 在 G2 强制显示「语料出境」提示，无出境评估时 `corpusSources` 限本地部署可读来源 | 无对应强制步骤 |
| 激励 | 现金激励常经第三方平台代发，涉及个税代扣；`incentive.kind="cash"` 时 G2 提示由人处理，W027 不处理支付 | 礼品卡 / 现金常见；超过年度阈值的税表问题同样只提示 |
| 外部方法待办 | fake-door / 定价测试须标注「功能调研 / 尚未上线」，不得收真实款项（S061 §9）——写进 `externalTasks[].complianceNotes` | FTC Act §5：可用可退款预付但须写明退款条款——同上 |
| 主体切分 | 企业软件的采购、IT 管理员、使用者常为三方；S065 在 `market="CN"` 时强制按主体拆顶层机会（S065 §9），G6 页面按主体分组展示前沿 | PLG 团队常一人兼任，不强制拆 |

## 10. WorkspaceX 落点
**已在基线核实存在**：
- 访谈执行面与人类门：`apps/api/src/application/interview/confirm-outline.ts`（`OUTLINE_INCOMPLETE`）、`start-session.ts:83`（要求 `confirmed`）、`send-booking-invite.ts` + `apps/api/src/domain/interview/booking-draft.ts:27`（`canSendBookingInvite` 仅 human）、`draft-booking-invite.ts`、`generate-outline.ts`、`consent-gate.ts`。
- receipt 形状：`apps/api/src/application/research/guided-workflow-receipt-ports.ts`（`begin`/`finalize`/`payloadFingerprint`）。
- 对象级披露：`apps/api/src/application/security/permission-filter.ts`；同意项：`packages/contracts/src/consent-item.ts`；普遍性门槛：`packages/contracts/src/thresholds.ts:270`（`generalizationClaimMinIndependentSubjects`，由 S062 运行时读取，W027 不引用数值）。
- 引用校验：`apps/api/src/application/context-pack/verify-citation.ts`（能否校验 S063 `findingId` 命名空间 **UNVERIFIED**，W027 的 P4 以「以发起人身份读取 synthesis」代替）。

**proposed-unwired**：`apps/api/src/{domain,application,infrastructure}/workflow/`（ADR-118）、`WorkflowDefinition(W027)`、`workflowAllowlist`、`importPlanAsOutline`、`deriveFindingMap`、`scripts/check-w027-outcome.mjs`、能力分类 `interview.write/interview.read/transcript.read/ticket.read/survey.read/skill-artifact.read/knowledge.read/artifact.write`、`evals/work-stack/W027/`。

**UNVERIFIED**：访谈场次完成事件是否可订阅；访谈模块主体 id 与 S009 `participantId` 是否同一命名空间；大纲是否有外部引用字段。

## 11. 外部参考与溯源（A3：只取控制流与方法模式，不复制文字）
| 来源 | 路径 | commit | 许可证（artifact 级） | 取用内容 |
|---|---|---|---|---|
| RefoundAI/lenny-skills | `skills/continuous-discovery/SKILL.md`（:16–17 机会空间与轻量取证；:22–24 机会必须写成未满足需要而非功能） | `13598cc54e09399bc1bc1398b0fca284110efb2f`（克隆 `scratchpad/upstream/lenny-skills`） | MIT（仓根 `LICENSE`，Copyright (c) 2025 Refound AI） | reference-only：outcome → opportunity → solution → experiment 的阶段顺序；嘉宾引语不引用。差异：W027 在机会树之前插入「预登记判据 + 机械改判」（决策 1、7） |
| anthropics/knowledge-work-plugins | `product-management/skills/synthesize-research/SKILL.md`、`product-management/skills/product-brainstorming/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7`（克隆 `scratchpad/upstream/kwp`） | Apache-2.0（`product-management/LICENSE`） | reference-only：研究 → 综合 → 假设检验的流程切分；W027 不采用其 opportunity sizing 与 RICE（S065 决策 2） |

两者均为行为参考，不进入任何 `provenance[].copied`；克隆位于会话 scratchpad，不入库。

## 12. 评测（`evals/work-stack/W027/`，确定性 case 跑回环模型；夹具均为合成数据）
基线：同一 `intent` 交给不挂 W027、可直接调用 S062/S063/S065 的通用 Agent（ADR-119 G5）。

| # | 输入（fixture） | 通过判据（规则 grader） |
|---|---|---|
| E1 | intent「让中小团队管理员首周邀请更多成员」；G1 后在阶段 5 完成前修改 A2 的 passCriterion | amendment `beforeEvidence=true`；`criteriaAmendedAfterEvidence=false` |
| E2 | 同 E1，但在阶段 5 完成后修改判据 | `criteriaAmendedAfterEvidence=true` 且 `limitations[0]` 声明；阶段 7 传入的 digest 来自新 G1' 回执，旧 digest 调用返回 `CRITERIA_TAMPERED` |
| E3 | S063 产出 F1（questionId=RQ2）、F2（RQ4）；`rqTestMap=[{RQ2:[T1]},{RQ4:[T1,T3]}]`；T2 无 RQ | `findingMap = {T1:[F1,F2], T3:[F2]}`，T2 为 `untested`；两次复算结果逐字节一致；无模型调用参与映射 |
| E4 | G2 中某个入选测试没有被任何 RQ 覆盖 | G2 批准按钮不可用（W7）；强行提交返回校验错误 |
| E5 | RQ「为什么试用团队放弃导出」，S062 有未完成者层 S3（plannedPerStratum=3）；G3 的 fieldworkLog 中 S3 仅 1 场 | `stratumCoverage[S3].achieved=1`；`limitations` 含 S3；G4 升 required 并标「分层未覆盖」 |
| E6 | G3 标 2 场为 pilot | 这两场的 `interviewRecordRef` 不出现在 S009 来源；S063 `inputDigest.participantCount` 不计它们 |
| E7 | 阶段 6 完成后、G5 批准前，受访者 P4 撤回 `ai_analysis` 同意 | G5 批准后 P3 剔除 P4 片段，S063 起重跑；新 synthesis 中无 P4 的 segmentId；若 P4 是某 theme 的唯一 experience 参与者，该 Finding 置信度随之变化并使 S061 verdict 重算 |
| E8 | S061 读数 `stop`（「管理员不知道可以邀请」这一 kills-direction 问题假设被 refuted） | 终态 `direction_refuted`；`frame=null`、`map=null`（W3）；结论页发布且无 S064/S065 调用 |
| E9 | 关键假设仅能用 pricing-commitment 检验（`evidenceOwner=external`） | 该测试 `untested`；终态 `awaiting_external_tests`；`externalTasks` 含 complianceNotes（CN 夹具含「尚未上线」标注要求）；无任何外发 receipt（W4） |
| E10 | 首轮 `need-more-evidence`，第二轮仍是 | 恰好 2 轮，终态 `evidence_exhausted`；第二轮 `hypotheses[]` 只含 inconclusive/untested 的非 external 假设；两轮 `planId`、digest 相同 |
| E11 | 读数 `pivot`：问题假设 supported，「一键批量邀请」解法假设 refuted | S064 `rawInput` 不以该解法为问题；S065 输入的解法池不含「一键批量邀请」；`retiredSolutions` 列出它 |
| E12 | S064 返回 `needs-choice`（两个候选问题） | G5 选 index 1 后以 `previousFrameId` 重入；S065 仅在 G5 accepted 后调用；未选前无 S065 receipt |
| E13 | S065 前沿含 O1、O2（needs-choice）；发起人为 D043 研究员，`productOwnerUserId=U9` | G6 需发起人 + U9 双签；研究员以两个身份自签被拒；选 O2 后 `targetOppId=O2 ∈ frontier`（W2），终态 `target_accepted` |
| E14 | 5 个互不支配机会（S065 `insufficient-evidence`） | G6 无「选定」选项；只能 `map_without_target`；`targetOppId=null` |
| E15 | 阶段 3 在 begin 后崩溃，大纲实际已建 | 恢复后按外部引用找到大纲并 finalize；访谈模块中该实例只有 1 份大纲 |
| E16 | trigger 带 `participants:[{phone:…}]` | 拒绝启动；无任何 receipt |
| E17 | `market=CN, jurisdiction="CN+US"`，US 部署 | G2 显示语料出境提示；无出境评估确认时 `corpusSources` 中跨境来源被移除并记入 `limitations` |
| E18 | 某机会的 6 条证据全部来自同一大客户工单（S009 `concentration.flag="dominated"`） | G4 升 required；S065 该机会 `concentrated=true`；结论页 `coverage.concentrationFlag="dominated"` |
| E19 | 任一产物文案中出现「73% 的管理员」 | W9 拒绝；发布不发生 |

G5 对比判据：在 E2/E3/E5/E8/E11/E13 上基线至少失败 3 条而 W027 全过，才能标 verified。

## 13. Graph change proposals（只提议，不改矩阵，不假定采纳）
1. **是否把 S171 `claim-audit` 加进 W027**（S063 §14 提议 1 的另一选项）：本文按决策 2 不加。若产品侧要求 W027 的目标机会直接作为 W029 的已验证输入，则应在 S063 与 S064 之间加 S171，届时 S065 可给出 `high`；由矩阵 owner 裁定。
2. **是否在 S064 与 S065 之间加 S066**（S066 §14 提议 1、S065 §14 提议 1）：W027 的解法池只有 S061 `candidateSolutions`、用户给出与 S065 B1 重分类的解法，`solutionCoverage` 常为 `single/none`。本文不加：W027 的终点是「选哪个机会」，解法发散属于 W029 之前或之内的工作；若矩阵 owner 认为 W027 应交付「机会 + ≥2 解法」，应加 S066 并在 G6 前增加解法审阅。
3. **S062 → S009 分层接缝**：请 S009 作者裁定 `voice-corpus` 是否直接接收 S062 `strata[]`；在此之前 W027 用决策 5 的人工分层归属兜底。
4. **D011 的 journey 能力缺口**：W027 只透传 `journeySteps`，不补旅程引导；缺口归 D011 作者（S065 §14 提议 3 同一事项）。
5. **S061 字段对齐（已核对）**：S061 已 PASS。W027 依赖的字段 `criteriaDigest`、`tests[].{testId, assumptionId, evidenceOwner, method, complianceNotes}`、`evidenceRequests[]`、`externalTasks[]`、`DiscoveryReadout.{verdicts, discoveryState, nextEvidenceRequests, unplannedSignals}` 均存在于 S061 终稿；S061 后续若更名，W027 同步。
6. **外部结果回流门（proposed-unwired）**：S061 U3b 的 `update.externalResults[]` 需要 `approvalRef` 指向 W027 人工门的已批准记录。W027 v1 不定义该门、不执行外部方法、不传 `externalResults`（决策 6）。提议：在后续版本中于 `awaiting_external_tests` 之后增加一个 required 人工门，批准外部任务执行（经 ADR-118 effect-gateway）并对回执签发 `approvalRef`，再以同一 `planVersion` 调 S061 `update` 带 `externalResults`（以 `externalTasks[].taskId` 为键）。记录形态与核实接口 UNVERIFIED。

## 14. 未决问题
- 能力分类名（`interview.write` 等）待 ADR-120 分类表定稿，均为提案名。
- G1/G2 的 14 天、G3 的 `deadlineDays` 缺省 42 天是否作为组织策略可调，以及可调方向（本文建议只允许调短 G1/G2）。
- 访谈模块主体 id 与 S009 `participantId` 的同一性（UNVERIFIED）决定 E6/E7 能否确定性判定；在核实前 E6/E7 标 pending。
- `importPlanAsOutline` 由 W027 实现者还是访谈模块 owner 提供，需在 ADR-118 Stage 2（迁移数字访谈）时一并确定。
