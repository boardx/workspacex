# W032 — Roadmap Review

> 类型：Reference Workflow · 域：Product · 作者化任务：AUTHOR-W032 · 状态：待独立评审
> 基线：`main@30c1c4332025151610502988b0379b95ff7298c7`（下文「已核实」均指在该 SHA 上读过文件）。
> 权威：`requirements/work-stack-v2/`（ADR-116）；运行时：ADR-118（第 4 条业务行是事实、第 5 条实例固定版本、第 6 条 effect-gateway、第 9 条 Skill 由 Workflow 固定）；工具分类：ADR-120；评测门：ADR-119。
> 对齐的已 PASS 契约（只引用，不修改）：`skills/S068-prioritization.md`、`skills/S155-business-review.md`。
> 引用但尚未 PASS 的契约（字段以其当前稿为准，定稿变化时本文随之修订）：`skills/S069-roadmap-planning.md`、`skills/S072-metrics-review.md`、`skills/S009-customer-research.md`、`skills/S008-competitive-analysis.md`。

## 1. 边界
W032 把**一份已批准的路线图版本 vN** 在一个复盘周期后变成**经人类批准的 vN+1（或显式「维持 vN」的复核记录）**，并且回答三个问题：
1. vN 中已上线、已到 `reviewAfter` 的条目，它们声明要推动的指标动了没有（结果复盘）；
2. 自 vN 以来出现的新信息（客户需求计数、对手能力变化、指标结论）让排序怎么变、每处变化的原因是什么（改序）；
3. 在容量不变的前提下，Now/Next/Later 怎么重排，谁受影响（重规划 + 变更沟通）。

不做的事：从零建路线图（S069 `mode="create"` 属对话直调或 W030 之外的规划场景，W032 只接受 `revise`）；冲刺拆解（W030）；实验设计（W031）；经营周报（W004）。W032 的终点是**人签字的版本**，模型产出的一切在 G2 之前都是 `draft` / `proposed`。

## 2. 组合图（精确 ID，来自两张矩阵）

### 2.1 参与 Skill（`WORKFLOW-SKILL-MATRIX.md` 第 38 行：`W032 | Roadmap Review | Product | S069, S068, S072, S009, S008, S155`）
| Skill | 名称 | W032 中调用模式 | 在 W032 中的唯一职责 | 引用的对方契约 |
|---|---|---|---|---|
| S072 | Metrics Review | `mode="outcome-review"` | 对 vN 中已上线条目给四值结论 `moved-as-expected / no-detectable-change / moved-opposite / not-measurable` | S072 §4 D2、§6 `outcomeReviews`、决策 4 |
| S155 | Business Review | `reviewKind="roadmap-outcome"` | 以 vN 的 `committed` 条目为承诺做对账，产出偏差、上期行动闭环与 `decisionsNeeded`（`recommendedOptionId=null`） | S155 §4、§5.2、B1–B10、决策 1 |
| S009 | Customer Research | `mode="demand-check"` | 对候选路线图条目给去重账户计数 `explicitRequest / painOnly / counterSignal` | S009 M8 D1–D4、OUT4 |
| S008 | Competitive Analysis | `mode="feature-parity"`，`decisionContext="roadmap-review"` | 以路线图主题为能力清单出对手 × 能力矩阵与四类 implication，不含建议 | S008 §4.3 P1–P3、决策 3、E9 |
| S068 | Prioritization | `mode="rerank"` | 在上一版 `PrioritizationProposal` 上改序，每处名次带变化挂 `changeCause` | S068 §4.0、C3–C4、输出不变式 7 |
| S069 | Roadmap Planning | `purpose="plan"`，`mode="revise"` | 读 S068 名次带，做依赖/容量/视野重排，产出 vN+1 草稿与 `changeLog` | S069 §4 A–E、§5.3 不变量 1–9 |

Skill 版本由 `WorkflowDefinition(W032, v1).stages[*].skills[*] = {stableId, versionRange}` 在实例启动时解析并冻结（ADR-118 第 5 条；`WorkflowDefinition` 本身 **proposed-unwired**，基线 `apps/api/src/domain/` 下无 `workflow/` 目录，已核实）。发起 Agent 不需要挂载这六个 Skill（ADR-118 第 9 条）；只需在 `workflowAllowlist` 中被允许运行 W032 v1。

### 2.2 消费者（`DIGITALHUMAN-COMPOSITION-MATRIX.md` Exact Workflows 列含 W032 的行，共 4 个）
| DigitalHuman | 矩阵行 | 在 W032 中的缺省角色（仅 trigger 缺省值，不改阶段） |
|---|---|---|
| D003 Product Manager | 第 9 行 | 缺省发起人与 G2 第一签人（路线图 owner） |
| D015 Agile / Product Operating Model Coach | 第 21 行 | 发起时缺省 `reviewFocus="cadence-health"`：G2 页面突出 `churnNow`、`whiplashFlag`、`healthObservations`；不改变批准权 |
| D017 Decision Science Expert | 第 23 行 | 缺省 `reviewFocus="decision-quality"`：G2 页面突出 S068 `stable=false` / `flipDriver` 与 S155 `decisionsNeeded` |
| D018 AI Transformation Architect | 第 24 行 | 缺省 `reviewFocus="portfolio"`：G2 页面突出 `capacityLedger.mix` 与 S068 `portfolioWarning` |

`reviewFocus` 只影响 G2 审阅视图的排序，不影响任何 Skill 输入；四个消费者产出的 `RoadmapReviewRecord` 结构一致。D015/D017/D018 发起时，发起人仍是其背后的人类 principal，且 G2 第一签人必须是该 `productScopeId` 的路线图 owner（§3 决策 5），DigitalHuman 本身无签字权。

### 2.3 相邻 Workflow（划界）
- W030 Sprint Planning：消费 W032 批准后 vN+1 的 Now 段条目；W032 不下钻到冲刺。
- W031 Experiment Loop：S072 在 W031 是 `experiment-metric-audit`；W032 若 `outcomeReviews` 某条 `basis="experiment-result"`，其 `experimentResultRef` 来自 W031 已完成实例，W032 不发起实验。
- W004 Weekly Business Review：同样用 S155，但 `reviewKind="executive-weekly"`；W032 的 S155 结果不进入 W004，反之亦然。

## 3. 实体特有决策

**决策 1 — 阶段顺序固定为「先复盘、再取新证据、再改序、最后重排」，且 S068 在 S069 之前；不允许让 S069 先排再倒推排序。**
S069 A3 规定「排序只读，越序必须 `rankOverride`」，S069 §5.4 `RANKING_MISSING` 要求 `rankingRef` 覆盖全部 `initiativeId`；S068 D2 规定交给 S069 的只有 `handoff.S069.bandOrder`。因此 S068 必须在 S069 之前完成。S068 C4 要求每处改序挂 `changeCause`（`new-evidence:<ref>` 等），所以 S072/S155/S009/S008 的产物必须在 S068 之前落为业务行并有可引用的 `ref`。结果：阶段 2（S072）→ 3（S155）→ 4（S009）→ 5（S008）→ 6（S068）→ 7（S069）。S009 与 S008 之间有数据依赖（S008 `evidence.customerResearchRef` = S009 `packId`），不并行。

**决策 2 — 候选集与粒度由 vN 决定，一次实例只审一个 `productScopeId`。**
S068 A1 / II4 要求同批候选 `kind` 相同，否则 `MIXED_GRANULARITY`。W032 的候选集 = vN 的全部 `items[].initiativeId`（kind 恒为 `roadmap-item`，`sourceRef = {skill:"S069", artifactId: planArtifactId, itemId}`）∪ trigger 的 `newInitiatives[]`（新提案必须是同粒度的路线图举措；把「改按钮文案」这类任务级条目交进来时在阶段 1 拒收，提示走 W030）。跨产品线的组合评审不在 W032 内做，拆多个实例。

**决策 3 — 新证据只能以 `newInformation` 与 `evidenceRefs` 进入 S068/S069，不能直接改写打分因子；Reach 仍只接受 S068 允许的来源。**
S068 `FactorSource` 只有 `metric-query | contract | estimate-by | synthesis-finding | appetite | assumed`，没有「客户需求计数」或「竞品 implication」类来源。W032 不去伪造：S009 的 `explicitRequestAccounts` 不被写成 `reach`（它是去重账户数，不是受影响用户数），S008 的 `parity-gap` 不被写成 `impact`。它们只作为 `newInformation[{ref, summary}]` 交给 S068，由 S068 C4 产出 `changeCause = new-evidence:<ref>`；因子值变化只能来自 trigger 中人提供的新估算（`estimate-by`）或指标查询。缺口作为 §13 提议 3 提给 S068 owner，不在本 Workflow 内近似。

**决策 4 — 「维持现状」是一等结果：S068 无名次带变化且 S069 `changeLog` 为空时，终态 `reaffirmed`，不产生 vN+1。**
kwp roadmap-update「Avoiding Roadmap Whiplash」（:250-254）要求变更有阈值、按节奏批量、跟踪变更频率。W032 落地为：(a) 无变化不发新版本，只写一条 `RoadmapReviewRecord(outcome="reaffirmed")` 并经 G2（ask 级）确认；(b) S069 `whiplashFlag=true` 或 `churnNow > 0.3` 时 G2 升为 multi-gate；(c) 非节奏内发起（距 vN 批准 < `minReviewIntervalDays`，缺省 30）必须带 `outOfCycleReason`，否则 trigger 被拒（`OUT_OF_CYCLE_UNJUSTIFIED`）。

**决策 5 — 批准权属于路线图 owner；DigitalHuman 与 S068/S069 都无权把 `proposed/draft` 变成 `approved`。**
S068 输出恒 `status:"proposed"`，S069 恒 `status:"draft"`（S069 §5.2、S069 §6 第 176 行指向 W032 人工门）。W032 的 G2 是唯一转换点：第一签人 = `productScopeId` 的路线图 owner（`roadmapOwnerPrincipalId`，trigger 声明、服务端核实其对 `productScopeId` 有写权限）；以下任一条件成立时 G2 为 multi-gate，需第二签人（`approverPolicy.secondApproverPrincipalId`，与第一签人不同人）：`whiplashFlag=true`；任一带 `hardDeadline.source ∈ {contract, regulation}` 的条目被降出其视野或进 `notDoing`；任一 `commitment="committed"` 条目被移出 Now。S069 不变量 8 要求「无证据变更 `trigger=strategy` 且 `decidedBy` 为人」——W032 在 G2 表单上逐条收集 `decidedBy`，没填的 `strategy` 变更不能批准。

**决策 6 — 结果复盘不写「功能成功/失败」，也不让复盘结论自动降级条目。**
S072 决策 4 与 S155 决策 1/5 都只给相关性结论（`causalClaim="correlation-only"`）。W032 把 `moved-opposite` / `no-detectable-change` 转成 S068 的 `newInformation` 与 S155 的 `decisionsNeeded`，**不**自动把对应后续条目移到 `notDoing`；是否继续投入是 G2 上的人类选择（S155 `decisionsNeeded.options` 至少含「维持现状」）。

**决策 7 — 竞品材料只进内部视图；外部可见版路线图单独过 G4，且只发 S069 `external-safe` 投影。**
S008 `audience` 恒为 `internal-only`（S008 决策 5 / A7）；S069 不变量 7 规定 `external-safe` 不含 `announced=false` 项与 S008 引用。W032 缺省不对外；trigger `externalView.enabled=true` 时才进入阶段 12，且该阶段为 multi-gate（路线图 owner + `disclosureApproverPrincipalId`，通常是法务/IR）。

## 4. Trigger schema
```ts
// packages/contracts/src/workflow-definition.ts（ADR-118 新建，proposed-unwired）中 W032 的 trigger 输入
const W032Trigger = z.object({
  kind: z.enum(["manual", "schedule", "agent_request"]),   // 无 webhook：指标告警/竞品新闻不能自动开启改版（决策 4）
  requestId: z.string().uuid(),
  orgId: OrgId,
  initiatorUserId: UserId,                                   // 权限主体
  initiatorAgentVersionId: z.string().nullable(),            // D003/D015/D017/D018 之一，须在 workflowAllowlist
  reviewFocus: z.enum(["default", "cadence-health", "decision-quality", "portfolio"]).default("default"),
  productScopeId: z.string(),
  basePlanRef: z.object({ skill: z.literal("S069"), planId: z.string(), version: z.number().int() }), // vN，必须 approved
  basePrioritizationRef: z.object({ proposalId: z.string(), version: z.number().int() }),             // vN 所用的 S068 版本
  priorReviewRef: z.object({ artifactId: z.string(), versionId: z.string() }).optional(),             // 上一次 W032 的 S155 结果
  reviewPeriod: z.object({ start: z.string().date(), end: z.string().date(), timezone: z.string() }),
  outOfCycleReason: z.string().max(300).optional(),          // 决策 4 (c)
  calendar: z.enum(["CN-mainland", "US-federal", "custom"]),
  locale: z.enum(["zh-CN", "en-US"]),
  market: z.enum(["CN", "US", "global"]),
  metrics: z.array(z.object({                                // → S072.metrics；series 与 dataSourceRef 恰有其一
    metricId: z.string(), aggregation: z.enum(["ratio", "mean", "count", "cumulative"]),
    series: z.array(SeriesPoint).optional(), dataSourceRef: z.object({ kind: z.enum(["report", "query"]), id: z.string() }).optional(),
    definitionRef: z.object({ skill: z.literal("S166"), definitionId: z.string(), version: z.number() }).optional(),
  })).min(1).max(25),
  eventLog: z.array(S072EventLogEntry).default([]),
  materiality: S155Materiality.optional(),                   // 缺省不设：S155 输出 threshold-not-configured
  newInitiatives: z.array(S069Initiative).max(30).default([]),
  estimateUpdates: z.array(z.object({ initiativeId: z.string(), personWeeks: z.number().positive(),
                                      confidence: z.enum(["high", "medium", "low"]), estimatorPrincipalId: UserId })).default([]),
  capacity: S069Capacity,                                    // 人数为调用方声明（S069 §6：无 HR 接线，proposed-unwired）
  customerEvidence: z.object({ frame: S009SamplingFrame, window: z.object({ from: z.string().date(), to: z.string().date() }),
                               sourceKinds: z.array(S009SourceKind).min(1) }),
  competitive: z.object({ competitorsDeclared: z.array(z.object({ name: z.string() })).max(8).default([]),
                          comparisonBasis: S008ComparisonBasis,
                          uploads: z.array(z.object({ fileRef: z.string(), kind: z.enum(["test-record", "analyst-report", "other"]) })).default([]),
                          allowWebFetch: z.boolean().default(false) }),
  roadmapOwnerPrincipalId: UserId,
  approverPolicy: z.object({ secondApproverPrincipalId: UserId.optional() }),
  notifyAffectedStakeholders: z.boolean().default(true),
  externalView: z.object({ enabled: z.boolean().default(false), disclosureApproverPrincipalId: UserId.optional(),
                           destinationArtifactProjectId: z.string().optional() }).default({ enabled: false }),
});
```
进门校验（阶段 1，确定性）：`basePlanRef` 指向的版本 `status=approved` 且是 `productScopeId` 当前最新批准版（否则 `BASE_PLAN_STALE`，防止两个实例基于同一 vN 各自产出 vN+1）；`basePrioritizationRef.version` 是最新（对齐 S068 `PROPOSAL_VERSION_STALE`）；`reviewPeriod.end ≤ today`；决策 4 (c)；`newInitiatives[].kind` 只能是 `bet|incremental|foundation`（S069 枚举）；`externalView.enabled ⇒ disclosureApproverPrincipalId` 存在且 ≠ `roadmapOwnerPrincipalId`。
`schedule` 触发：由路线图 owner 建立的节奏（月 / 季），每次运行都重新执行全部闸门，**不**继承上次批准。

## 5. 阶段表
状态机：`requested → [G1 scope] → P1 → reviewing_outcomes → reconciling → checking_demand → mapping_competition → reranking → [G1b cycle?] → replanning → validating → [G2 decision] → P2 → publishing → published → [G3 notify] → P3 → notified → [G4 external] → P4 → external_published`

| # | stage | Skill IDs | 工具能力分类（ADR-120 提案名） | 状态转移 | sideEffect | humanGate |
|---|---|---|---|---|---|---|
| 1 | scope | —（平台：读 vN、校验 trigger） | `artifact.read`、`project.read` | requested → awaiting_scope → scope_confirmed ｜ scope_declined ｜ rejected_at_intake | read | **G1** ask（`outOfCycleReason` 存在或 `newInitiatives > 10` 时 required）。批准后执行 **P1** |
| 2 | outcome_review | S072（`outcome-review`） | `metrics.read`（仅 `dataSourceRef` 时；proposed-unwired） | scope_confirmed → reviewing_outcomes → outcomes_reviewed | read | none |
| 3 | reconcile | S155（`roadmap-outcome`，`audience.kind="author-only"`） | `artifact.read`（`priorReviewRef`） | outcomes_reviewed → reconciling → reconciled | read | none |
| 4 | demand_check | S009（`demand-check`，`purpose="roadmap"`） | `transcript.read`、`knowledge.read`；条件：`crm.read`（仅用于 `arrBand`） | reconciled → checking_demand → demand_checked | read | none |
| 5 | competition | S008（`feature-parity`） | 条件：`web.fetch`（`allowWebFetch=true` 且组织已授权）；`asset.read`（uploads） | demand_checked → mapping_competition → competition_mapped | read | none |
| 6 | rerank | S068（`rerank`） | — | competition_mapped → reranking → reranked ｜ → awaiting_cycle_resolution（`DEPENDENCY_CYCLE`） ｜ → blocked_pinned_over_capacity（`PINNED_EXCEEDS_APPETITE`） | none | 条件 **G1b** required：仅在 `DEPENDENCY_CYCLE` 时，人删边或合并条目后回到阶段 6 |
| 7 | replan | S069（`plan` / `revise`） | — | reranked → replanning → replanned ｜ → awaiting_cycle_resolution（S069 `DEPENDENCY_CYCLE`） | none | 同 G1b |
| 8 | validate | —（平台：S069 不变量 1–9 复核、S068 不变量 7、跨 Skill 一致性 X1–X6，§6） | `sandbox.exec`（运行校验脚本） | replanned → validating → validated ｜ reaffirm_candidate ｜ → replanning（≤1 次） ｜ failed | read | none |
| 9 | decide | — | — | validated / reaffirm_candidate → awaiting_decision → approved ｜ approved_reaffirm ｜ revise → reranking ｜ rejected | none | **G2** required（决策 5 条件下 multi-gate；`reaffirm_candidate` 为 ask）。批准后执行 **P2** |
| 10 | publish | — | `artifact.write`（平台内部写；现有 `wx_artifact_publish` 在 L1，已核实 `tool-risk-tier.ts:64`） | approved → publishing → published ｜ approved_reaffirm → publishing → reaffirmed ｜ P2 失败 → validating | write | none（G2 覆盖） |
| 11 | notify | — | `notify.inapp` | published → awaiting_notify → notifying → notified ｜ partially_notified ｜ skipped（`notifyAffectedStakeholders=false` 或无受影响方） | high-impact | **G3** required（逐收件人列出将收到的变更条目）。每收件人发送前执行 **P3** |
| 12 | external_view | — | `artifact.write`（外部可见项目） | notified/skipped → awaiting_disclosure → external_publishing → external_published ｜ disclosure_declined | high-impact | **G4** multi-gate（owner + disclosure approver，决策 7）。发布前执行 **P4** |

阶段说明（只写 W032 特有的输入映射）：
- **阶段 2**：`roadmapItems` = vN 中 `horizon="now"`、`expectedOutcome.reviewAfter ≤ reviewPeriod.end` 且已上线的条目（上线日期取 trigger `eventLog` 中 `kind="release"` 且 `scope.itemId` 匹配的事件；找不到上线事件的条目不进 S072，记 `RoadmapReviewRecord.unreviewedItems[{itemId, why:"no-release-event"}]`）；`expectedMetricId = expectedOutcome.metricRef`，`expectedDirection = expectedOutcome.direction`，`roadmapRef = {skill:"S069", artifactId}`。S072 返回 `NO_EVALUABLE_METRIC` 时阶段不失败：继续，但 `RoadmapReviewRecord.outcomeEvidence="none-evaluable"`，且 G2 页面首屏显示「本轮没有可评估的结果复盘」。
- **阶段 3**：`commitments` = vN 中 `commitment="committed"` 的条目，`kind="roadmap-outcome"`，`metricRef/targetValue` 取 `expectedOutcome`；`actuals` 取 S072 `verdicts[].current`（S072 输出不变式 1 保证其来自计算脚本），`producedBy="S072:<reportId>"`；`driverAnalyses = [{ref: S072 reportId, producedBySkill:"S072", coversCommitmentIds}]`；`governance.decisionRights` 至少含 `{role:"roadmap-owner", scope: productScopeId}`，使 S155 的 `decisionsNeeded.ownerRole` 可解析。`audience` 固定 `author-only`，避免 S155 `S155_AUDIENCE_REJECTED`。
- **阶段 4**：`roadmapItems` = 候选集中 `horizon ∈ {next, later}` 的条目 ∪ `newInitiatives`（Now 段已承诺条目不做需求计数——它们的依据在 vN 批准时已定，重新计数只会引入抖动）；`subject = {kind:"segment", frame: customerEvidence.frame}`。
- **阶段 5**：`roadmapThemes` = vN `outcomes[]`（每个 outcome 一个 theme，`capabilityHints` = 挂在该 outcome 下条目的 `title`）；`evidence.customerResearchRef` = 阶段 4 `packId`；`evidence.uploads` = trigger uploads；`evidence.webSources` 只来自本实例 `web.fetch` 回执；**不提供 `searchLedger`**（W032 行无 S003，见 §13 提议 1）。因此 S008 结果常为 `status="provisional"`；G2 页面对 provisional 的 implication 标「待核」。
- **阶段 6**：`candidates[].kind="roadmap-item"`；`bucket` 映射：S069 `bet → big-bet`、`incremental → incremental`、`foundation →` 不传（S068 记为 `unclassified`；S068 `table-stakes` 与 S069 `foundation` 语义不同，不硬映射，§13 提议 4）；`factors.effort` = 最新 `estimateUpdates`，否则沿用上一版的 `estimate-by` 因子；`newInformation` = `[S072 reportId, S155 reviewId, S009 packId, S008 analysisId]` 中实际产出的引用，每条 `summary` 由平台按固定模板生成（如「S072: I-12 moved-opposite」），不由模型自由写；`deadline` 取 S069 `hardDeadline`（`source=contract → kind=contract`，`regulation → regulatory`，`launch-event` 不映射——它不是外部硬截止，S068 A2 不应钉住）。
- **阶段 7**：`rankingRef = {skill:"S068", rankingId: proposalId}`；`initiatives` 只传 S068 `bands ∪ pinned` 中的条目；S068 `unestimated` 条目**不**传给 S069（否则触发 `RANKING_MISSING`），记入 `RoadmapReviewRecord.parkedUnestimated[]` 并在 G2 显示；`evidenceRefs` 为阶段 2–5 的产物引用。
- **阶段 8 → `reaffirm_candidate`**：S068 `changes` 中无 `fromBand ≠ toBand` 且 S069 `changeLog=[]` 且 `adjustments=[]`（决策 4）。
- **阶段 9 的 `revise`**：审批人可修改 `estimateUpdates`、删除 `newInitiatives`、补 `decidedBy`；回到阶段 6（S068/S069 重跑，阶段 2–5 产物复用，不重读数据）。`revise` 上限 3 次，第 4 次只能 approve/reject。

## 6. 产出 schema 与跨 Skill 不变量
```ts
const RoadmapReviewRecord = z.object({
  reviewRecordId: z.string(), workflowInstanceId: z.string(), definitionVersion: z.string(),
  productScopeId: z.string(), reviewPeriod: ReviewPeriod, locale: Locale,
  basePlan: z.object({ planId: z.string(), version: z.number() }),
  resultPlan: z.object({ planId: z.string(), version: z.number() }).nullable(),    // outcome=reaffirmed ⇒ null
  outcome: z.enum(["revised", "reaffirmed"]),
  artifacts: z.object({                                  // 六个 Skill 产物的业务行指针（ADR-118 第 4 条）
    s072ReportId: z.string().nullable(), s155ReviewId: z.string(), s009PackId: z.string(),
    s008AnalysisId: z.string(), s068ProposalRef: z.object({ proposalId: z.string(), version: z.number() }),
    s069PlanDraftRef: z.object({ planId: z.string(), version: z.number() }).nullable(),
  }),
  outcomeEvidence: z.enum(["evaluated", "partially-evaluated", "none-evaluable"]),
  unreviewedItems: z.array(z.object({ itemId: z.string(), why: z.enum(["no-release-event", "review-not-due", "metric-access-denied"]) })),
  parkedUnestimated: z.array(z.string()),                // S068 unestimated
  changeSummary: z.array(z.object({                      // 由 S069 changeLog 与 S068 changes 按 itemId 连接得到
    itemId: z.string(), change: S069ChangeKind, fromBand: z.number().nullable(), toBand: z.number().nullable(),
    s068Cause: S068ChangeCause.nullable(), s069Trigger: S069Trigger, evidenceRefs: z.array(EvidenceRef),
    decidedBy: UserId.nullable(), affectedStakeholders: z.array(UserId),
  })),
  cadence: z.object({ churnNow: z.number().nullable(), whiplashFlag: z.boolean(), inCycle: z.boolean(), outOfCycleReason: z.string().nullable() }),
  approvals: z.array(z.object({ gate: z.enum(["G1", "G1b", "G2", "G3", "G4"]), approverPrincipalId: UserId,
                                decision: z.enum(["approve", "revise", "reject"]), at: z.string().datetime(), note: z.string().max(500).optional() })),
  permissionChecks: z.array(z.object({ point: z.enum(["P1", "P2", "P3", "P4", "P5"]), at: z.string().datetime(),
                                       result: z.enum(["pass", "pruned", "blocked"]), prunedRefs: z.array(z.string()) })),
  notifications: z.array(DeliveryReceiptRef),            // 阶段 11
  externalView: z.object({ artifactVersionId: z.string(), itemIds: z.array(z.string()) }).nullable(),
  terminalState: W032TerminalState,
});
```
跨 Skill 不变量（阶段 8 机检，`scripts/check-w032.mjs`，proposed-unwired）：
- **X1** S069 草稿中每个 `rank` 与 S068 `handoff.S069.bandOrder` 一致；违反者必有 `rankOverride`（与 S069 不变量 6 同义，W032 在 S068/S069 两个产物之间再核一次，因为二者分属不同阶段的业务行）。
- **X2** `changeSummary` 中每个 `fromBand ≠ toBand` 的条目：`s068Cause` 非空；每个 S069 `changeLog` 条目：`evidenceRefs` 非空或（`s069Trigger="strategy"` 且 `decidedBy` 在 G2 前补齐）。
- **X3** S069 `changeLog[].trigger="outcome-review"` ⇒ 其 `evidenceRefs` 含 S072 `outcomeReviews` 中对应 `itemId` 的条目，且该条 `result ≠ "moved-as-expected"` 或 S155 对应承诺 `significance="significant"`。
- **X4** S069 `changeLog[].trigger="competitive"` ⇒ 引用的 S008 implication `kind ∈ {parity-gap, threat-watch}`；引用 `status="provisional"` 的 S008 结果时，G2 表单对该条要求显式确认。
- **X5** S009 `demand[].evidenceStatus="none-found-in-read-sources"` 的条目，不得以 `trigger="evidence"` 被提升视野。
- **X6** 任一 vN `committed` 条目在 vN+1 中不再是 `committed` ⇒ 其 `affectedStakeholders` 非空，或 `changeSummary` 条目写明 `requestedBy` 为空。

终态 ↔ 效果不变式（`terminalState` 与业务行必须同时成立）：
- **T1** `terminalState ∈ {published, notified, partially_notified, external_published, disclosure_declined}` ⇔ `outcome="revised"` 且 `resultPlan ≠ null` 且存在一条 G2 `approve` 且（决策 5 条件成立时）两名不同 approver；vN+1 artifact 版本恰有一个。
- **T2** `terminalState="reaffirmed"` ⇔ `resultPlan=null`，无新 plan artifact 版本，无 `notifications`，无 `externalView`。
- **T3** `notifications` 非空 ⇒ 存在 G3 `approve`，且每条 receipt 之前有同收件人的 P3 `pass`。
- **T4** `externalView ≠ null` ⇔ `terminalState="external_published"`，且 G4 有两名不同 approver 且 P4 `pass`。
- **T5** `terminalState ∈ {rejected, scope_declined, rejected_at_intake, blocked_dependency_cycle, blocked_pinned_over_capacity, cancelled, failed}` ⇒ 无 vN+1、无通知、无外部版本；S068/S069 产物保持 `proposed/draft`。
- **T6** 任何终态下，vN 本身不被修改（S069 版本只追加）。

## 7. 终态
| 终态 | 条件 | 产物 |
|---|---|---|
| `published` | G2 批准、P2 通过，`notifyAffectedStakeholders=false` 或无受影响方，未启用外部视图 | vN+1（approved）+ Record |
| `notified` | 发布后 G3 通过，全部收件人送达 | 同上 + 每收件人 DeliveryReceipt |
| `partially_notified` | 部分收件人 P3 被阻或发送最终失败 | 同上 + `blockedRecipients[]` |
| `external_published` | G4 通过，P4 通过 | 同上 + external-safe artifact 版本 |
| `disclosure_declined` | G4 被拒或超时 7 天 | vN+1 内部版本有效，无外部版本 |
| `reaffirmed` | 决策 4 (a)，G2 确认 | Record（`outcome=reaffirmed`） |
| `rejected` | G2 被拒 | Record + 草稿保留 90 天（供下次 W032 以 `priorReviewRef` 引用 S155 结果） |
| `scope_declined` | G1 被拒或超时 72h | 无 |
| `rejected_at_intake` | 进门校验失败（`BASE_PLAN_STALE`、`OUT_OF_CYCLE_UNJUSTIFIED`、粒度不符） | 错误码 |
| `blocked_dependency_cycle` | G1b 超时 7 天未解环 | 环上 itemId 列表 |
| `blocked_pinned_over_capacity` | S068 `PINNED_EXCEEDS_APPETITE`：合同/法规钉住项已超净容量 | 钉住项清单 + 容量账；需人扩容量或谈截止日后重新发起 |
| `cancelled` | 发起人取消（任一非终态） | 已产出的业务行保留 |
| `failed` | 不可重试错误（Skill 版本撤销、W032 授权被撤、阶段 8 第 2 次仍违反不变量） | 原因码 + 违反的不变量 ID |

## 8. 权限重查点（每个效果点前，决策 5/7 配套）
- **P1 G1 批准后、阶段 2 前**：重查发起人对 `productScopeId`、vN artifact、`priorReviewRef`、`dataSourceRef`、`uploads` 的读权限。`priorReviewRef` 不可读 → 与 S155 `S155_PRIOR_REVIEW_UNREADABLE` 一致，**整体停止**（不降级为「无上期」）；其余不可读引用剔除并记 `permissionChecks(pruned)`。
- **P2 G2 批准后、发布前**：重查 (a) 第一/第二签人当前仍对 `productScopeId` 有写权限（G2 可等待 14 天，期间可能换人）；(b) vN 仍是最新批准版（另一实例抢先发布 → `BASE_PLAN_STALE`，本实例回到 `validating` 并要求以新 vN 重新发起，不合并）；(c) S009 G6 交付前重验——撤回同意的片段移除，若使某条 `changeSummary` 的唯一证据消失，该条变为无证据变更，回到阶段 9 要求补 `decidedBy`。
- **P3 G3 批准后、每收件人发送前**（effect-gateway，ADR-118 第 6 条）：收件人对 `productScopeId` 的读权限；通知正文只含该收件人 `requestedBy` 相关条目的标题与新视野，不含 S008 内容、S009 片段原文与 `arrBand`。无读权限的收件人被阻，不以摘要替代。
- **P4 G4 批准后、外部发布前**：重算 S069 不变量 7（`external-safe` 不含 `announced=false`、不含 S008 引用），并以 disclosure approver 身份核实目标外部项目的写权限；任一失败 → 不发布，终态 `disclosure_declined`。
- **P5 崩溃恢复**：从 checkpoint 恢复时先对全部已持久化产物的来源引用批量重查（同 P1 范围 + S009 G4/G5）；撤权导致某阶段输入变化 → 从最早受影响阶段起标记 stale 重跑。已发布的 vN+1 不回溯修改，写 `staleness` 事件通知 owner。

## 9. Receipts、幂等与崩溃恢复
统一 receipt 沿用 ADR-118（形状同已核实的 `apps/api/src/application/research/guided-workflow-receipt-ports.ts`：`begin` / `finalize` + `payloadFingerprint`）。W032 特有：
- **实例幂等键** `(orgId, productScopeId, basePlanRef.version, requestId)`；另设**并发锁** `(orgId, productScopeId)`：同一产品范围同时只能有一个处于 `validating` 之前的活动实例（ADR-118 lease），第二个实例在阶段 1 返回 `REVIEW_IN_PROGRESS`。理由：两个并行 rerank 各自基于 vN，会产生互相冲突的 vN+1。
- **阶段 2–5 的幂等**：每个 Skill 调用一个 receipt，键 = `hash(instanceId, stageId, inputDigest)`；产物是业务行（S072 `reportDigest` 可直接作为指纹）。崩溃后已 finalize 的产物复用，不重读指标/客户/竞品数据——否则同一实例前后证据不一致，S068 的 `changeCause` 会指向已不存在的版本。
- **阶段 6–7**：S068/S069 自身产生版本号（`previous.version + 1`）。receipt 键含 `basePrioritizationRef.version` / `basePlanRef.version` 与 `revise` 轮次，重放不会造出 v+2。G2 `revise` 产生新轮次，旧轮次草稿保留但标 `superseded`。
- **阶段 10**：`artifact.write` receipt 键 = `hash(productScopeId, basePlan.version, resultPlan.version)`；发布与「vN 仍最新」检查在同一事务（乐观并发：写入条件 `latestApprovedVersion = basePlan.version`）。
- **阶段 11**：每收件人一个 effect receipt，键 = `hash(resultPlan.planId, resultPlan.version, recipientUserId, "notify.inapp")`；超时视为未知，先查回执再决定是否重发。
- **重试预算**：Skill 结构化输出失败 ≤ 2 次（S008 `SCHEMA_INVARIANT_VIOLATED` 自身上限 1 次，W032 不叠加额外重试）；阶段 8 → 7 回退 ≤ 1 次；计数写业务行，跨崩溃不清零。
- 某能力分类被拒（如 `crm.read`）后不得换同分类其他供应商（ADR-120 第 3 条）；S009 `arrBand` 直接为 `null`。

## 10. 失败模式（W032 特有）
| # | 失败 | 后果 | 防线 |
|---|---|---|---|
| F1 | 并行两个实例基于同一 vN 各自批准 | 两份 vN+1，团队按不同版本排期 | 并发锁 + P2(b) + 阶段 10 乐观并发 |
| F2 | 把 S009 需求账户数当 Reach 塞进 RICE | 大客户工单多的条目被系统性高估 | 决策 3；E4 |
| F3 | 一个条目指标 `moved-opposite` 就被模型直接砍掉 | 相关性被当因果，好条目被误杀 | 决策 6；S155 `decisionsNeeded` 保留维持现状选项 |
| F4 | 合同截止条目被容量挤出 Now 而无人察觉 | 违约 | S068 A2 钉住 + 决策 5 multi-gate + S069 不变量 5 |
| F5 | 每次有新竞品消息就发起一次改版 | 路线图抖动、团队失去信任 | 无 webhook；决策 4 (c)；`whiplashFlag` multi-gate |
| F6 | 竞品矩阵或未公告条目进入外部路线图 | 泄密 / 比较广告风险 | 决策 7；P4 重算 S069 不变量 7 |
| F7 | 通知把客户原话、ARR 档位发给无权读者 | 越权披露 | P3 正文白名单 |
| F8 | 缺上线事件的条目被 S072 当作已上线复盘 | 基线期错位，结论无意义 | 阶段 2 入选条件；`unreviewedItems(no-release-event)` |
| F9 | 未估算的新举措被静默丢弃 | 提案人不知道为什么没进路线图 | `parkedUnestimated` 在 G2 与 Record 中显示 |

## 11. CN / US 差异（仅列实质性的）
- **节假日与容量**：`calendar="CN-mainland"` 时 S069 C1 按含调休的法定假日计算工作日（春节 / 国庆所在季度的 Now 容量显著低于其他季度），`reviewPeriod` 跨春节时 S072 的 YoY 对比须按农历对齐（S072 `eventLog` 中登记 `kind="holiday"`）；US 按联邦假日，Q4 感恩节–新年区间同理登记。W032 不自行换算，只保证把 `calendar` 一致地传给 S069 与 S155。
- **外部路线图披露**：US 上市公司对外发布的路线图含前瞻性陈述，Reg FD / safe-harbor 语言由 disclosure approver 把关；CN 上市公司同类信息受证监会信息披露规则约束，且对外宣传中与具名竞品比较受《反不正当竞争法》《广告法》约束——这是 S008 内容永不进入外部视图的额外理由（决策 7）。两地均由 G4 multi-gate 承接，W032 不内置法律判断。
- **客户证据**：CN 下 S009 读取访谈/通话需满足 PIPL 的处理目的范围，`purpose="roadmap"` 须在同意位允许的用途内（S009 M5 同意位过滤）；US 无统一联邦要求，但 CCPA 适用的消费者数据同样只按既有同意位读取。W032 不另存同意状态。

## 12. WorkspaceX 落点
- 已核实存在（@30c1c43）：`apps/api/src/application/research/guided-workflow-receipt-ports.ts`（receipt 形状）；`apps/api/src/domain/agent-run/tool-risk-tier.ts`（`wx_artifact_publish` 在 L1，第 64 行；`wx_project_read`、`wx_knowledge_read` 在 L0，第 39 行）；`packages/contracts/src/agent-runtime.ts`（`ToolSideEffect = ["只读","对外发送","写入外部"]`，第 87 行）；`apps/api/src/application/mcp/ports.ts`；`packages/contracts/src/board.ts`（`TaskStatus`，看板任务，**不是**路线图模型）；`apps/api/src/domain/inbox/` 目录存在（站内通知的实际发送端口 **UNVERIFIED**）。
- 基线中**不存在**：路线图领域模型（在 `apps/`、`packages/` 按 `roadmap` 检索只命中 web mock / survey 模板 / 官网静态页，已核实）；`apps/api/src/domain/workflow/`；`WorkflowDefinition` 契约；`metrics.read`、`notify.inapp` 等能力分类字段。以上均 **proposed-unwired**。
- `RoadmapPlan` / `PrioritizationProposal` / `RoadmapReviewRecord` 的存储：建议作为 artifact 版本（`wx_artifact_publish` 追加语义与「vN 不可变、只追加 vN+1」一致），落在 ADR-118 的 `workflow_stage_outputs` 业务行之上——**proposed-unwired**，由 ADR-118 实现方确认。
- 映射到 `ToolSideEffect`：read → 只读；阶段 10 `artifact.write` → 平台内部写，不经 MCP；阶段 11 `notify.inapp` → 站内发送，按 high-impact 处理但不是「对外发送」；阶段 12 → 外部可见写，映射「写入外部」。
- 评测目录：`evals/work-stack/W032/`（ADR-119，proposed-unwired）。

## 13. 外部参考与溯源（A3，只取流程模式）
| 来源 | 路径 | commit | 许可（artifact 级） | 取用 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `product-management/skills/roadmap-update/SKILL.md`（Workflow :19-60；Communicating Roadmap Changes :232-248；Avoiding Roadmap Whiplash :250-254） | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`product-management/LICENSE`） | **reference-only** 流程模式：先读现状 → 判操作类型 → 改序时问「什么变了」→ 前后对比 → 标出越过硬截止的条目；变更沟通「原因 / 取舍 / 新计划 / 受影响方」；抖动阈值与按节奏批量。W032 差异：沟通只在 G3 后按收件人裁剪发送；抖动变成可机检的 multi-gate 条件而非建议 |

克隆位于 scratchpad（`upstream/knowledge-work-plugins`），不入库；不复制原文。其中内嵌的打分框架段（:137-178）不采用，打分归 S068。

## 14. 评测（`evals/work-stack/W032/`，合成夹具，回环模型，规则 grader）
基线：同一夹具交给只挂 S069 的对话 Agent（ADR-119 G5）。

| # | 输入 | 通过判据 |
|---|---|---|
| E1 | vN 含 I-3（Now，committed，expected `activation_rate` up，reviewAfter 已过，eventLog 有 release）；series 显示落在噪声带内 | S072 `outcomeReviews[I-3].result="no-detectable-change"`；S155 对应承诺有 `decisionsNeeded` 且含维持现状；vN+1 中 I-3 后续条目未被自动移入 `notDoing`（决策 6） |
| E2 | 同 E1 但 eventLog 无 I-3 的 release 事件 | I-3 不进 S072 输入；`unreviewedItems` 含 `{I-3, no-release-event}` |
| E3 | S072 所有指标 `untrusted`（定义缺失） | 阶段不失败；`outcomeEvidence="none-evaluable"`；G2 页面首屏提示；无 `trigger="outcome-review"` 的 changeLog（X3） |
| E4 | S009 给 N-7 `explicitRequestAccounts=12`（其中 1 个账户 40 张工单） | S068 输入中 N-7 `reach` 来源不是 S009；`newInformation` 含 S009 packId；`changes[N-7].changeCause` 以 `new-evidence:` 开头 |
| E5 | S008 对主题 T-2 给 `parity-gap`，但锚格仅 vendor-claim（`status=provisional`）；S069 将 L-4 从 later 提到 next，`trigger="competitive"` | X4 生效：G2 表单对 L-4 要求显式确认；未确认不能 approve |
| E6 | 合同截止 I-9（`hardDeadline.source=contract`）容量不足被 S069 降到 Next | G2 为 multi-gate；只有一名 approver 时无法进入 publishing；两名不同人批准后 `approvals` 有两条 G2 |
| E7 | 钉住项合计 > 净容量 | 终态 `blocked_pinned_over_capacity`；无 vN+1；S068 产物 `status="proposed"`（T5） |
| E8 | 候选中出现依赖环 N-1 → N-2 → N-1 | 进入 G1b；人删边后阶段 6 重跑成功；7 天不处理 → `blocked_dependency_cycle` |
| E9 | 新信息全部无改序效果，S069 changeLog 为空 | 终态 `reaffirmed`；无新 plan 版本、无通知（T2） |
| E10 | vN 批准 12 天后发起，无 `outOfCycleReason` | `rejected_at_intake`，错误码 `OUT_OF_CYCLE_UNJUSTIFIED`；零 Skill 调用 |
| E11 | 两个实例同时基于 v5 发起 | 第二个 `REVIEW_IN_PROGRESS`；若第一实例发布后第二实例以 v5 再发起 → `BASE_PLAN_STALE` |
| E12 | G2 等待期间第一签人被移出产品范围写权限，随后点批准 | P2(a) 阻止发布；Record 记 `permissionChecks(P2, blocked)`；需新 owner 重新批准 |
| E13 | G3 批准后、发送前，收件人 U5 失去 `productScopeId` 读权限 | U5 无 receipt；终态 `partially_notified`；其他收件人正文不含 S009 片段原文与 `arrBand` |
| E14 | `externalView.enabled=true`，S069 草稿含 `announced=false` 的 N-3 与引用 S008 的条目 | 外部 artifact 不含 N-3、不含任何 S008 引用；G4 两名不同 approver；disclosure approver = owner 时 trigger 进门即拒 |
| E15 | S069 changeLog 中 N-5 `evidenceRefs=[]`、`trigger="strategy"`，G2 表单未填 `decidedBy` | 无法 approve（X2、S069 不变量 8）；填入人类 principal 后可批准 |
| E16 | 阶段 4 完成后模拟崩溃；恢复前某访谈参与者撤回 AI 处理同意 | P5 重验移除相关片段；阶段 4 标 stale 重跑、阶段 2/3 receipt 计数不变；S009 `excluded.consentAiDeclined` 增加 |
| E17 | 同 requestId 同 payload 重放；再以同 requestId 改 `reviewPeriod` 重放 | 前者返回同一实例、零新增 receipt；后者 `IDEMPOTENCY_KEY_REUSED` |
| E18 | `calendar="CN-mainland"`，Now = 含国庆假期的季度 | S069 `capacityLedger.netCapacityPersonWeeks` 小于同人数的 `US-federal` 夹具；W032 传给 S069 与 S155 的 `calendar` 相同 |
| E19 | `newInitiatives` 含任务级条目「改结算按钮文案」 | 阶段 1 拒收该条并提示 W030；其余继续（决策 2），不触发 S068 `MIXED_GRANULARITY` |
| E20 | G2 选 `revise` 4 次 | 第 4 次只提供 approve/reject；S068 版本号按轮次递增、无跳号 |

G5 对比判据：E1、E4、E6、E9、E14、E15 中基线至少失败 3 条而 W032 全过，才能标 verified。

## 15. Graph change proposals（只提议，不改矩阵，不假定采纳）
1. **S008 在 W032 中无内部检索来源**：W032 行无 S003，S008 `evidence.searchLedger` 无法提供，内部竞品情报（销售战报、丢单复盘）进不来，结果多为 `provisional`。提议评估把 S003 加入 W032 行；在采纳前按阶段 5 说明运行（S008 §14 提议 1 也指向此处；W032 选择「接受风险并声明」，不加 S171）。
2. **S063 缺席**：S009 §15 提议 4 指出 `demand-check` 只给计数。W032 的决策 3 使计数只作为 `newInformation` 进入，不需要综合叙述，因此**不**提议加入 S063。
3. **S068 `FactorSource` 无客户证据来源**（决策 3）：提给 S068 owner 评估是否增加 `{kind:"customer-evidence", packId, roadmapItemId}` 且只允许影响 Confidence，不影响 Reach。
4. **S068 `bucket` 与 S069 `kind` 枚举不对齐**（`big-bet/incremental/table-stakes` vs `bet/incremental/foundation`）：`foundation` 当前被记为 `unclassified`，使 S068 `portfolioWarning` 与 S069 `mix` 对同一组合给出不同结论。提议两 Skill owner 统一枚举（改 Skill 契约，不改矩阵）。
5. **S072 §14 提议 1（S074 进入 W032）**：W032 复盘激活类指标时可经 trigger `definitionRef` 或 S072 `activationDefinitionRef` 引用 W031 已有定义，**不**提议加入 S074。
6. **看板写回**：vN+1 批准后同步到工作项（`packages/contracts/src/board.ts` 看板任务）需要 S142 或平台写回服务；W032 v1 不含该阶段，提议在 W030 而非 W032 承接。

## 16. 未决问题
- `metrics.read`、`notify.inapp`、`transcript.read` 等分类名待 ADR-120 分类表定稿（均为提案名）。
- `minReviewIntervalDays = 30` 是否作为组织级策略（可调大不可调小），需 D015 作者确认。
- S069/S072/S009/S008 尚未 PASS；它们定稿若改字段名，本文 §5 输入映射与 X1–X6 需同步修订。
- G2 第二签人缺省来源（产品线负责人 vs 组织管理员）在无组织结构数据时如何解析，待 ADR-118 人工门实现确定。
