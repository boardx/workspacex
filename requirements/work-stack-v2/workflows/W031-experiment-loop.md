# W031 — Experiment Loop（实验闭环）

> 类型：Reference Workflow · 域：Product · 作者化任务：AUTHOR-W031 · 状态：PASS
> **代码基线**：`main@30c1c4332025151610502988b0379b95ff7298c7`。凡涉及现有 WorkspaceX 代码的陈述均按此基线核对；没有读过实现的行为标 **UNVERIFIED**，基线上不存在或未接线的能力标 **proposed-unwired**。
> 权威：`requirements/work-stack-v2/`（ADR-116）；运行时：ADR-118（第 3–7 条，及补充决策第 9 条「Workflow 固定 Skill 版本，拥有它的 Agent 不另挂」）；工具分类：ADR-120；评测门：ADR-119。
> 对齐的已 PASS 契约（只引用，不修改）：`skills/S071-experiment-design.md`、`skills/S072-metrics-review.md`、`skills/S157-data-exploration.md`、`skills/S161-statistical-analysis.md`、`skills/S074-user-activation.md`。

## 1. 边界
W031 负责**一个**产品/体验/教学改动假设的完整流程：写下假设 → 核对指标能不能用 → 冻结设计并预注册 → 确认实验已在外部上线 → 盲化健康检查 → 数据锁定 → 解盲分析 → 按事先写好的规则给出建议，最后由人决定 ship / iterate / kill。
它的产物是一份不可变的 **`ExperimentLoopRecord`**：设计、预注册凭据、分析结果和决策都能逐项对账。

W031 **不做**：
- **不操作分流或功能开关。** 基线上没有实验分流平台：在 `apps/`、`packages/` 用 `git grep -i -E "featureflag|feature-flag|abtest"` 检索，结果为 0（本文复核；S071 §8 也这样记录）。上线和回滚都在 WorkspaceX 之外完成，W031 只接收人签署的上线声明（决策 2）。
- 不做指标体系设计（S162）、口径 SQL（S166）、数据校验（S158，只引用它的报告，见决策 3）、上线发布（S073 / W026）。
- 不负责开放式的数据分析问题，这类问题走 W057 Question-to-Analysis。W031 里的 S157 只用 `experiment-precheck` 模式。

## 2. 组合图（精确 ID，照抄两张矩阵）

### 2.1 参与 Skill（WORKFLOW-SKILL-MATRIX.md 第 37 行：`W031 | Experiment Loop | Product | S071, S072, S157, S161, S074`）
| Skill | 在 W031 中使用的模式 | 唯一职责 | 引用的对方契约 |
|---|---|---|---|
| S074 User Activation | `define`（条件）、`diagnose`（条件）、`readout`（条件） | 激活定义；漏斗卡点和 `hypotheses[]`；实验后判断激活提升有没有传导到留存 | S074 §4.2–4.4、§5、§6、决策 1/5 |
| S072 Metrics Review | `experiment-metric-audit` | 核对主指标和护栏的口径、单位是否匹配、基线与 sd，产出供 S071 `metricRef`/`baselineRef` 引用的报告 | S072 §4 D1、§5、§6 `experimentReadiness`、决策 5 |
| S071 Experiment Design | `online-ab` / `cluster` / `switchback` / `usability-comparison` | 产出冻结的 `ExperimentDesignSpec`、`designDigest`、`hypothesesDigest`、`precheckContract`、`analysisContract` | S071 §4 第 1–10 步、§6 输出不变式、决策 1–5 |
| S157 Data Exploration | `experiment-precheck` | 盲化检查：分配比、暴露覆盖率、实验前协变量、埋点断档。结果指标只输出合并画像 | S157 §4 第 8 步、§5 `experiment`、决策 3 |
| S161 Statistical Analysis | `experiment` | 先做 SRM 检验，再解盲比较；给出效应量、区间、`practicalReading`、`allowedAssertion` | S161 §4 第 2/4/8/10 步、§6、决策 1/6 |

Skill 版本由 `WorkflowDefinition(W031, v1).stages[*].skills[*] = {stableId, versionRange}` 在实例启动时解析并冻结（ADR-118 第 5 条）。一个实验会跑数周，其间 Skill 发布新版本**不影响**在跑的实例。这一点对 W031 特别重要：如果 S161 中途升级了检验选择树，预注册的分析方法就被悄悄换掉了。

### 2.2 消费者（DIGITALHUMAN-COMPOSITION-MATRIX.md 中 Exact Workflows 含 W031 的行，共 4 个）
| DigitalHuman | 矩阵行 | 该行 Skill 列里有哪些 W031 Skill | 缺省 `domainProfile`（取自 S071 §2.2） |
|---|---|---|---|
| D003 Product Manager | 第 9 行 | S071, S072, S074 | `product` |
| D011 Design Thinking Expert | 第 17 行 | S071 | `ux` |
| D043 UX Researcher | 第 49 行 | S071 | `ux` |
| D047 Learning Experience Designer | 第 53 行 | S071 | `learning` |

按 ADR-118 第 9 条，各行 Skill 列只表示在对话中直接调用。D011/D043/D047 没有挂 S072/S074/S157/S161，但在 W031 阶段内可以使用 W031 固定的版本。本文**不**提出任何挂载边。
这四个角色的差异只通过 trigger 传入：`domainProfile` 取上表缺省值；`learning` 缺省 `activationTrack=false`（S074 是产品激活口径，不适用于课堂实验），并强制填写 `participantsIncludeMinors`（S071 §5 不变式）。

### 2.3 相邻 Workflow（只划界，不构成依赖）
- **W057 Question-to-Analysis**：同样用 S157/S161，但走 `question-scan` → `confirmatory|exploratory-followup`。W031 的 S161 只用 `experiment` 模式，并要求有预注册凭据。W057 产出的 S158 报告可以作为 W031 数据锁定阶段的 `validationRef`（决策 3）。
- **W026 Launch Campaign**：其中 S073 在 D+7 读数不达标时，S073 §4 第 7 步写明「由 S071/W031 接手做实验」。W031 用 `trigger.origin.kind="s073-stall"` 承接，只记录来源引用，不读取 W026 的运行态。
- **W032 Roadmap Review**：S072 `outcome-review` 可以用 `experimentResultRef` 引用 W031 的 S161 报告。W031 不反向依赖 W032。

## 3. 实体特有决策

**决策 1 — 阶段顺序：S074(define/diagnose) → S072 → S071 → [预注册] → 上线声明 → S157 → S161 → S074(readout)。**
矩阵只给出集合，顺序由本文确定。依据：
- S071 §5/§7 要求主指标在 W031 内必须带 S072 的 `metricRef`，否则 spec 为 `needs-human`；`baselineRef` 取 S072 报告里的 `experimentReadiness.baseline/sd`。所以 **S072 在 S071 之前**。
- S072 的 `activationDefinitionRef` 引用 S074 `ActivationDefinition`（S072 §5）。S074 §14 提议 1 请求「S074 `define` 放在 S072 之前」，本文采纳。S074 `diagnose` 产出的 `hypotheses[]` 是 S071 `change.sourceHypothesisRef` 的来源（S071 §5），所以也在 S071 之前。
- S157 决策 3 和 S161 决策 6 都要求先盲化、先冻结。因此 **S157 在 S161 之前**，并且两者都在预注册之后。
- S074 `readout` 需要 S161 的检验结果（S074 §4.4 第 1 步），所以放在最后。
- S157 未决问题第 2 条问到护栏是否进入 `blindedMetrics`。本文确认：进入。S071 §6 输出不变式已经保证 `precheckContract.blindedMetrics ⊇ {primary} ∪ guardrails`，W031 原样透传，不另行拼装。

**决策 2 — W031 不写任何分流配置，上线由人签署「上线声明」；v1 没有 high-impact 阶段。**
基线没有分流/功能开关平台（§1）。如果 W031 声称「已启动实验」，那就是把计划写成了事实。因此阶段 7 `launch_attest` 由发起人（或其指定的工程负责人）以 G2 签署以下内容：`actualStartAt`、外部配置引用（`externalConfigRef`，自由文本，例如开关键名或发布单号）、`assignmentSaltMatches: boolean`（外部分流是否使用了 S071 `assignment.salt`）、`trafficFractionActual`。
- `actualStartAt` 与 `schedule.plannedStartAt` 相差超过 24h → 走 S071 的修订路径：新 `designVersion`，`amendments[].afterUnblinding=false`，重算 `endAt`（S071 §5 末段）。只要 `hypothesesDigest` 不变，G1 就降为 `ask`。
- `assignmentSaltMatches=false`，或 `trafficFractionActual` 与设计值相差超过 20%（相对）→ 不进入 `running`，回到 `design`，按实际流量重算时长（S071 §4 第 6 步）。
- 因为 W031 不执行 ship/rollback，阶段 14 只**记录**决策并通知；真正全量或回滚仍在外部完成。W031 v1 因此没有 `high-impact` 阶段。如果将来接入分流平台，「按决策改开关」应作为新阶段加入，并使用 multi-gate（见 §13 提议 3）。

**决策 3 — 解盲前必须引用一份覆盖锁定快照的 S158 校验报告；W031 不在自己内部伪造校验。**
S161 §5 不变式规定：`mode="experiment"` ⇒ `validationRef` 必填；§7 规定 gate 由服务端按 reportId 取回，调用方不能内联。S158 **不在** W031 的矩阵行里。本文不假设图会改，所以阶段 9 `data_lock` 要求在 trigger 或 G3 上提供外部产生的 `validationRef = {reportId, ruleSetDigest}`（来源：W057 实例，或 D040 等角色在对话中直接调用 S158）。服务端核对三点：S158 报告 `snapshots[]`（S158 §6，按数据集的数组）中 `datasetId` 对应锁定快照数据集的那一条，其 `sha256` 等于锁定快照的 `inputSnapshotSha256`（S161 字段名），找不到对应条目视为不满足；`gate ≠ "block"`；报告与本实例属于同一 org。三点任一不满足 → 停在 `awaiting_validation`，**不调用 S161**。等待 14 天 → 终态 `expired_no_validation`。把 S158 纳入 W031 的提议见 §13 提议 1。

**决策 4 — 解盲只发生在预先声明的看数点，数据快照「一看一锁」。**
- `stopping.kind="fixed-horizon"`：只有一个看数点，`lookIndex=final`，时间为 `endAt`。
- `stopping.kind="group-sequential"`：看数点是 S071 `stopping.looks` 次，按信息比例均分（`startAt + k·days/looks`）。每个看数点运行一次 S157 → S161。是否停止**由平台脚本判定**：比较 S161 主假设结果的 `statistic`（`two-proportion-z` 下是 z 值）与 S071 `boundariesZ[k]`。S161 在中期看数点给出的 `significantAfterCorrection` 按名义 α 计算，W031 **不使用**它，也不把它写进记录（S161 没有序贯边界输入，见 §13 提议 2）。S161 的 method 不是 z 类检验时（例如 `welch-t` 被降级为 `not-run: capability-denied`，见 S161 决策 5），中期看数点只评估 `harmStops`，不做提前停止的有效性判定。
- **一看一锁**：每个 `lookIndex` 绑定唯一的数据快照 `(fileId, versionId)`。同一个看数点换快照重跑会被拒绝（`LOOK_ALREADY_ANALYZED`），防止挑一份对自己有利的数据。发起人随时要求「看一下现在的结果」→ 拒绝，只能提供 S157 盲化健康检查。

**决策 5 — 规则给出建议，人做决定；偏离规则要写理由并由第二人签署。**
阶段 12 在 S071 `decisionRules` 中查 `(S161 主假设 practicalReading, 护栏状态)`。护栏状态的判定：任一 `family="guardrail"` 的结果 `practicalReading="harmful"` → `harmful`，否则为 `ok`（S071 §4 第 4 步）。查表得到 `ruleAction`。G4 上人可以选择与 `ruleAction` 不同的动作，但必须填写 `overrideReason`，G4 同时升级为 multi-gate（发起人 + 第二签人）。以下情况 W031 **强制**在 G4 前插入额外的复核：
- 主指标相对提升 > S071 `twymanThreshold` 且 `ruleAction="ship"` → 先进入 `twyman_recheck`，人需上传埋点复核证据（`artifactRef`）后，G4 才允许选 `ship`（S071 §4 第 9 步）；
- S161 结果的 `allowedAssertion ∉ {establishes}` 时，`ship` 选项旁固定显示「证据不足以确立效应」，记录里 `evidenceLevel` 原样保留 S161 的值。

**决策 6 — 激活轨道（`activationTrack=true`）要等留存观察期走完，才算闭环。**
S074 §4.4 第 3 条规定：`retentionMatured=false` 时 readout 只能是 `pending-retention`。W031 计算 `retentionMatureAt = endAt + retention.horizonDays`。
- 在 `endAt` 已经可以对主指标（激活）做分析和 G4 决策，但记录里 `activationCausalUpgrade` 必须保持 `pending`；
- 实例进入 `awaiting_retention_maturity`，由持久定时器唤醒，对同一批已分配单元的留存数据再做一次 **data_lock → S157 → S161(仅留存假设) → S074 readout**；
- 只有 readout 为 `activation-transfers`，`ActivationDefinition.causalStatus` 才会升级为 `experiment-supported`（S074 决策 1）；readout 为 `activation-harms-retention` → `escalate=true`，重新打开 G4（即使之前已选 ship），并通知发起人与第二签人；
- 留存假设必须**已经**在预注册里：S071 冻结时，留存作为护栏写进 `hypotheses[]`（S074 `hypotheses[].guardrail` 就是留存定义）。事后新加的留存检验会使 S161 报 `PreregistrationMismatch`。

**决策 7 — 一个实例只做一个主假设；iterate 生成一个新实例。**
S071 规定 `family="primary"` 恰好 1 条。如果在同一实例里换假设重跑，就是换主指标（S071 §11「事后换主指标」）。G4 选 `iterate` → 平台用 `trigger.origin={kind:"iterate", parentInstanceId}` 创建一个**新**实例（需要发起人确认），新实例从阶段 2 开始。父实例的 S072 报告只要在 30 天内，可以作为 `baselineRef` 复用。父实例以 `decided_iterate` 结束，不回到 `design`。

**决策 8 — 上线后 D+3 做一次盲化健康检查（S157），不解盲也能叫停。**
SRM 检验属于 S161（S157 §4 第 8 步只报告偏差）。但暴露日志缺失、某一臂埋点断档这类问题，不必等到解盲才发现。`running` 期间在 `min(actualStartAt+3d, 第一个看数点−1d)` 运行一次 S157 `experiment-precheck`，然后用确定性阈值判定：
- `exposureCoverage < 0.95`，或 `loggingGaps` 中任一区间超过 6h 且带 `arm` 字段（只影响一臂）→ 触发 G-health（ask）：继续 / 修复后修订设计（修订时 `afterUnblinding=false`）/ 中止（终态 `aborted_health`）；
- 任一臂 `|observed − designed| / designed > 0.05` → 同样触发 G-health，附注「正式 SRM 检验将在看数点由 S161 执行」。W031 **不**自行计算卡方。

## 4. Trigger schema
```ts
// packages/contracts/src/workflow-definition.ts 中 W031 的 trigger 输入（该文件由 ADR-118 新建，**proposed-unwired**，基线不存在）
const W031Trigger = z.object({
  kind: z.enum(["manual", "agent_request"]),                  // 没有 schedule / webhook：实验必须由人提出假设
  requestId: z.string().uuid(),
  orgId: OrgId,
  initiatorUserId: UserId,                                    // 权限主体、实验 owner；agent_request 时是背后的人
  initiatorAgentVersionId: z.string().nullable(),             // 必须在该 Agent 的 workflowAllowlist 内（ADR-118 第 9 条；基线无该字段，proposed-unwired）
  origin: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("new") }),
    z.object({ kind: z.literal("iterate"), parentInstanceId: z.string() }),           // 决策 7
    z.object({ kind: z.literal("s073-stall"), launchReadoutRef: z.string(), stallLayer: z.string() }), // 只记录来源，见 §2.3
  ]),
  domainProfile: z.enum(["product", "ux", "learning"]).optional(),   // 缺省按 §2.2 映射
  activationTrack: z.boolean().optional(),                    // 主指标是否为 S074 激活定义；learning 缺省 false，其余缺省 true
  hypothesis: z.discriminatedUnion("source", [
    z.object({ source: z.literal("s074-diagnose"),            // 走阶段 3，由人在 G0 选一条
               funnelSteps: z.array(z.object({ stepId: z.string(), event: z.string() })).min(2),
               segmentKeys: z.array(z.string()).max(3).optional() }),
    z.object({ source: z.literal("provided"),                 // 发起人直接给出，跳过阶段 3
               statement: z.string().min(20).max(1000),        // 「若把 X 改成 Y，则 M 上升，因为…」
               sourceRef: z.string().optional() }),
  ]),
  change: z.object({                                          // 原样透传 S071 §5 change（sourceHypothesisRef 由阶段 3 填）
    summary: z.string().max(1000),
    changeRisk: z.enum(["reversible-low", "reversible-high", "irreversible"]),
    touchesPricing: z.boolean(),                              // S071 §7：服务端只允许往高风险方向改写
    isEstablishedPractice: z.boolean(),
  }),
  analytics: z.object({
    datasetRef: z.string(),                                   // S074 / S072 的服务端数据集句柄
    retention: z.object({ event: z.string(), horizonDays: z.number().int().min(1).max(180),
                          activeRule: z.union([z.literal("any"), z.object({ minCount: z.number().int().min(1) })]) }).optional(),
                                                              // activationTrack=true 时必填（S074 P2）
    activationDefinitionRef: z.string().optional(),           // 已有定义则跳过 S074 define
  }),
  metrics: z.object({                                         // 交给 S072 审核，再交给 S071
    primary: MetricCandidate, guardrails: z.array(MetricCandidate).min(1).max(5),
    secondary: z.array(MetricCandidate).max(10).default([]),
  }),
  units: z.object({ randomizationUnit: RandUnit, analysisUnit: AnalysisUnit, exposureTrigger: z.string(),
                    triggerRate: z.number().gt(0).lte(1).optional(), meanClusterSize: z.number().optional(), icc: z.number().optional() }),
  interference: z.object({ sharedSupply: z.boolean(), socialOrCollab: z.boolean(), sharedInstructor: z.boolean(),
                           carryoverWashoutMinutes: z.number().min(0).optional() }),
  dataBinding: z.object({ unitKey: z.string(), armColumn: z.string() }),
  traffic: z.object({ eligibleUnitsPerDay: z.number().positive(), trafficFraction: z.number().gt(0).lte(1),
                      maxDurationDays: z.number().int().min(7).max(180) }),
  arms: z.array(z.object({ armId: z.string(), isControl: z.boolean(), weight: z.number() })).min(2).max(6),
  plannedStartAt: z.string().datetime({ offset: true }),
  requestedPeeking: z.boolean().default(false),               // 透传 S071，触发改写为 group-sequential
  jurisdiction: z.enum(["CN", "US", "other"]),
  participantsIncludeMinors: z.boolean().optional(),          // learning 必填（S071 §5）
  fundingSource: z.enum(["us-federal", "other", "none", "unknown"]).optional(),
  validationRef: z.object({ reportId: z.string(), ruleSetDigest: z.string() }).optional(), // 也可以在 G3 补交（决策 3）
  watchers: z.array(z.object({ userId: UserId })).max(20).default([]),   // 阶段 14 的通知对象
  secondSignerUserId: UserId.optional(),                      // multi-gate 使用；缺省见 §5 说明
});
// MetricCandidate = S072 metrics[] 元素（metricId, kpiRef?, definitionRef? | activationDefinitionRef?, aggregation, dataSourceRef）
//   再加上 S071 MetricInput（S071 §5）中 S072 不产出的字段：column, unit, kind, practicalThreshold, direction,
//   numerator/denominator（kind="ratio" 时必填）, nonInferiorityMargin?（护栏必填）；这些字段由阶段 3 的作者补齐，
//   补齐后须按 S071 §5 MetricInput 校验，不合法则不进入 S071
```
trigger 校验时（阶段 1）先执行的确定性规则：
- `activationTrack=true` ⇒ `analytics.retention` 必填；并且 `metrics.primary` 要么带 `activationDefinitionRef`，要么等待阶段 2 由 S074 define 填入；
- `domainProfile="learning"` ⇒ `participantsIncludeMinors` 必填；
- `change.summary` 命中价格、资费、折扣、合同、费率等关键词 ⇒ `touchesPricing=true`（与 S071 §7 同一词表，**引用**该词表，不另存一份）；
- 所有 `userId` 必须是本 org 的成员。

## 5. 阶段表
状态机主干：
`requested → validated → [S074 define] → [S074 diagnose → G0] → metrics_audited → design_frozen → [G1 预注册] → P1 → preregistered → [G2 上线声明] → P2 → running →（D+3 健康检查 → G-health?）→（每个看数点：[G3 数据锁定] → P3 → prechecked → analyzed）→ readout_ready →（[twyman_recheck]）→ [G4 决策] → P4 → recorded →（activationTrack：awaiting_retention_maturity → … → readout_final）→ 终态`

| # | stage | Skill IDs | 工具能力分类（ADR-120；均为提案名） | 状态转移 | sideEffect | humanGate |
|---|---|---|---|---|---|---|
| 1 | intake | —（平台校验 §4 规则） | `org.membership.read` | requested → validated ｜ → `failed(invalid_trigger)` | read | none |
| 2 | activation_define | S074 `define`（条件：`activationTrack=true` 且无 `activationDefinitionRef`） | `analytics.read`、`sandbox.exec` | validated → activation_defined ｜ → `blocked_metrics`（`ALL_CANDIDATES_CENSORED` / `INSUFFICIENT_COHORT`） | read | none |
| 3 | diagnose | S074 `diagnose`（条件：`hypothesis.source="s074-diagnose"`） | `analytics.read`、`sandbox.exec` | → hypotheses_proposed → hypothesis_selected ｜ `hypotheses=[]` → `not_run(no_hypothesis)` | read | **G0**：ask，人从 `hypotheses[]` 中选恰好 1 条（决策 7） |
| 4 | metric_audit | S072 `experiment-metric-audit` | `analytics.read`（S072 `dataSourceRef` 取数，proposed-unwired）、`sandbox.exec`（`noise-band.mjs`） | → metrics_audited ｜ primary `experimentReady=false` → `blocked_metrics` | read | none |
| 5 | design | S071（`mode` 由 trigger 和 S071 第 3 步决定） | `sandbox.exec`（`design-calc.mjs`）、`report.read`（取回 S072 报告） | → design_frozen ｜ `not-run` → awaiting_not_run_confirm ｜ `infeasible` → awaiting_infeasible_confirm ｜ `needs-human` → awaiting_design_fix | read | none |
| 6 | preregister | —（平台写预注册记录） | `workflow.record.write`（平台内部写） | design_frozen → awaiting_design_approval → preregistered ｜ reject → `design_rejected` | write | **G1**：required；`complianceFlags` 非空或 `touchesPricing=true` 时为 multi-gate。批准后执行 **P1** |
| 7 | launch_attest | — | `workflow.record.write` | preregistered → awaiting_launch → running ｜ 偏差 → design（决策 2） ｜ 30 天未声明 → `cancelled(not_launched)` | write | **G2**：required（签署人 = 发起人或其指定的工程负责人）。写入前执行 **P2** |
| 8 | health_check | S157 `experiment-precheck`（盲化） | `data.read`（快照）、`sandbox.exec` | running → running ｜ 命中阈值 → awaiting_health_decision → running / design / `aborted_health` | read | **G-health**：仅在决策 8 的阈值命中时触发，ask |
| 9 | data_lock | —（平台：绑定快照 + 核对 S158 报告） | `data.read`、`report.read` | running（看数点到达）→ awaiting_data_lock → locked ｜ → awaiting_validation → `expired_no_validation` | read | **G3**：ask（确认快照与 `validationRef`）。锁定前执行 **P3** |
| 10 | precheck | S157 `experiment-precheck`（锁定快照） | `data.read`、`sandbox.exec` | locked → prechecked ｜ 结构性问题 → awaiting_health_decision | read | none |
| 11 | analyze | S161 `experiment` | `data.read`、`sandbox.exec` | prechecked → analyzed ｜ `srm.detected` → awaiting_srm_decision → `invalid_design` / design（重新设计，新实例） ｜ `PreregistrationMismatch` → `failed(prereg_mismatch)`（S161 §7 所说的「人工闸门」在 W031 中定义为直接失败，见 §7） ｜ 中期看数点未越界 → running | read | 仅 SRM 分支：ask |
| 12 | readout | S074 `readout`（条件：`activationTrack=true`）；平台 `decisionRules` 查表 | `sandbox.exec` | analyzed → readout_ready ｜ 越过 harmStop → awaiting_harm_decision → `aborted_harm` | none | harmStop 分支：required |
| 13 | decide | —（包括 `twyman_recheck` 子步骤） | — | readout_ready →（twyman_recheck）→ awaiting_decision → decided | none | **G4**：required；偏离 `ruleAction`、`ruleAction="escalate"` 或 S074 `escalate=true` 时为 multi-gate |
| 14 | record | — | `artifact.write`（平台内部写）、`notify.inapp` | decided → recorded → 终态 ｜ activationTrack 且 readout=`pending-retention` → awaiting_retention_maturity | write | none（G4 已覆盖）。每次写入前执行 **P4**，每位通知对象发送前执行 **P5** |
| 15 | retention_followup | S157 → S161（只做留存假设）→ S074 `readout` | 同阶段 9–12 | awaiting_retention_maturity →（G3）→ readout_final → recorded ｜ `activation-harms-retention` → 重新打开 G4 | read / write | 复用 G3、G4 |

说明：
- **第二签人**（G1/G4 multi-gate）：`secondSignerUserId`；未给时取发起人所在项目的 owner，官方 Agent 发起且没有项目 owner 时取组织管理员。第二签人不得与发起人为同一人。multi-gate 能力 **proposed-unwired**（基线的 HITL 支不支持多签 UNVERIFIED）。
- **阶段 4→5 的字段映射**：S071 `metrics.*.metricRef = {skill:"S072", reportId}`；`traffic.baselineRef = {skill:"S072", reportId}`；S071 以服务端报告的 `experimentReadiness[].baseline/sd` 覆盖调用方的值（S071 §7）。S072 报告中 primary 的 `baselineSource="caller-declared"` 时，W031 不阻断流程，但 `ExperimentLoopRecord.baselineConfidence="low"`（S072 决策 2）。
- **阶段 5 的非冻结分支**：`not-run`（`ship-without-test` / `underpowered-alternative` / `human-decision`）进入人工确认，人确认后终态 `not_run`，记录 S071 `worthRunning.reasons` 与 `postLaunchGuardrails`；`infeasible` 由人确认后终态 `infeasible`，记录 `achievableMdeAtMax`；`needs-human` 由人补齐输入后回到阶段 4 或 5，这是 S071 的 `BaselineUnverified` 分支。
- **阶段 8/10 传给 S157 的输入**：`experiment = S071.precheckContract`（逐字段透传，W031 不增删字段）；阶段 8 传入 `datasets[].role ∈ {assignment, exposure}`，不传 `outcome`，这样健康检查从物理上拿不到结果列。
- **阶段 11 传给 S161 的输入**：`hypotheses = S071.analysisContract.hypotheses`，`experimentDesign = S071.analysisContract.experimentDesign`，`validationRef` 来自阶段 9，`dataset.fileRef` 为锁定快照，`upstreamExploration` **不传**（预注册假设不是探索产生的，不吃 S157 的 `searchSpace` 预算）。
- **阶段 12 传给 S074 readout 的输入**：S074 的 `experimentResult` 是暂定字段（S074 §5 末段）。在 S074 改为直接消费 S161 类型之前，由确定性适配器 `w031-readout-adapter.mjs`（**proposed-unwired**）从锁定快照计算每臂的 `n/activated/retained`；`activationTest`/`retentionTest` 从 S161 对应 `hypothesisId` 的结果取值：`pValue=pAdjusted`、`ciLow/ciHigh`、`alpha`。`retentionMatured = now ≥ retentionMatureAt`。这个适配器只做字段搬运和计数，不做任何检验。

## 6. 产出 schema
```ts
// W031 只定义自己的投影；设计、检验和读数都通过 id + digest 引用各 Skill 的原生报告，不复制它们的数值字段
const ExperimentLoopRecord = z.object({
  recordId: z.string(), workflowInstanceId: z.string(), definitionVersion: z.string(),
  orgId: OrgId, ownerUserId: UserId, domainProfile: z.enum(["product", "ux", "learning"]),
  origin: TriggerOrigin, parentInstanceId: z.string().nullable(),
  hypothesis: z.object({ statement: z.string(), sourceRef: z.string().nullable(),
                         s074HypothesisId: z.string().nullable() }),
  activationDefinition: z.object({ definitionId: z.string(),
                                   causalStatusBefore: z.enum(["correlational", "experiment-supported"]),
                                   causalStatusAfter: z.enum(["correlational", "experiment-supported"]) }).nullable(),
  metricsAudit: z.object({ reportId: z.string(), reportDigest: z.string() }).nullable(),       // S072
  baselineConfidence: z.enum(["server", "low"]).nullable(),
  design: z.object({ designId: z.string(), designVersion: z.number().int(),
                     designDigest: z.string(), hypothesesDigest: z.string(),
                     status: z.enum(["frozen", "not-run", "infeasible", "needs-human"]),
                     amendments: z.array(z.object({ fromVersion: z.number(), reason: z.string(), afterUnblinding: z.boolean() })) }).nullable(),
  preregistration: z.object({ hypothesesDigest: z.string(), designDigest: z.string(),
                              approvedAt: z.string().datetime(), approverUserIds: z.array(UserId).min(1) }).nullable(),
  launch: z.object({ actualStartAt: z.string().datetime(), externalConfigRef: z.string(),
                     assignmentSaltMatches: z.literal(true), trafficFractionActual: z.number(),
                     attestedBy: UserId, attestedAt: z.string().datetime() }).nullable(),
  looks: z.array(z.object({
    lookIndex: z.union([z.number().int().min(1), z.literal("final"), z.literal("retention")]),
    snapshot: z.object({ fileId: z.string(), versionId: z.string(), inputSnapshotSha256: z.string() }),
    validationRef: z.object({ reportId: z.string(), ruleSetDigest: z.string() }),
    precheckReportRef: z.string(),                                   // S157
    analysisReportId: z.string(),                                    // S161
    specDigest: z.string(),                                          // S161 回显值，必须等于 hypothesesDigest
    srmDetected: z.boolean(),
    boundaryCrossed: z.enum(["efficacy", "harm", "none", "not-evaluated"]),
  })),
  healthChecks: z.array(z.object({ at: z.string().datetime(), precheckReportRef: z.string(),
                                   triggered: z.array(z.enum(["exposure-coverage", "arm-logging-gap", "allocation-drift"])),
                                   humanChoice: z.enum(["continue", "amend", "abort"]).nullable() })),
  readout: z.object({
    primaryPracticalReading: z.enum(["meaningful", "negligible", "inconclusive", "harmful"]),
    guardrailState: z.enum(["ok", "harmful"]),
    evidenceLevel: z.enum(["establishes", "suggests", "inconclusive", "do-not-report"]),   // = S161 主假设 allowedAssertion
    ruleAction: z.enum(["ship", "iterate", "kill", "escalate"]),     // S071 decisionRules 查表结果
    twymanTriggered: z.boolean(), twymanEvidenceRef: z.string().nullable(),
    activationReadout: z.enum(["activation-transfers", "activation-only", "activation-harms-retention",
                               "no-activation-effect", "pending-retention"]).nullable(),      // S074
    activationReportId: z.string().nullable(),
  }).nullable(),
  decision: z.object({
    action: z.enum(["ship", "iterate", "kill"]),                     // escalate 只能是 ruleAction，人必须落到三者之一
    followsRule: z.boolean(), overrideReason: z.string().max(600).nullable(),
    deciderUserIds: z.array(UserId).min(1), decidedAt: z.string().datetime(),
    activationCausalUpgrade: z.enum(["upgraded", "not-upgraded", "pending"]),
    rolloutNote: z.literal("rollout-executed-outside-workspacex"),   // 决策 2
  }).nullable(),
  terminalState: TerminalState,
  receipts: z.array(z.object({ key: z.string(), stage: z.string(), kind: z.enum(["skill", "effect", "gate"]),
                               payloadFingerprint: z.string(), finalizedAt: z.string().datetime() })),
});
```

### 6.1 Schema 不变式：终态与副作用的对应（`check-w031-record.mjs`，proposed-unwired）
1. `terminalState ∈ {decided_ship, decided_iterate, decided_kill}` ⇒ `preregistration ≠ null` ∧ `launch ≠ null` ∧ `looks` 中存在 `lookIndex ∈ {"final", k}`，且其 `srmDetected=false` ∧ `readout ≠ null` ∧ `decision ≠ null`；所有 `looks[].specDigest === preregistration.hypothesesDigest`。
2. `decision.followsRule=false` ⇒ `overrideReason ≠ null` ∧ `deciderUserIds.length ≥ 2`；`readout.ruleAction="escalate"` ⇒ `deciderUserIds.length ≥ 2`。
3. `decision.action="ship"` ⇒ `readout.guardrailState="ok"` 或 `followsRule=false`；并且 `readout.twymanTriggered=true` ⇒ `twymanEvidenceRef ≠ null`。
4. `terminalState ∈ {not_run, infeasible, design_rejected, blocked_metrics}` ⇒ `preregistration = null` ∧ `launch = null` ∧ `looks = []` ∧ 实例中不存在 S157/S161 的 receipt。
5. `launch = null` ⇒ `looks = []` ∧ `healthChecks = []`（没有上线声明就不读实验数据）。
6. `terminalState = invalid_design` ⇒ 最后一个 look `srmDetected=true`，并且记录和通知中不含主指标按臂拆分的数值（S161 在 SRM 时本来就 `not-run`）。
7. `terminalState = aborted_harm` ⇒ 某个 look `boundaryCrossed="harm"` ∧ `decision.action="kill"` ∧ `activationCausalUpgrade ≠ "upgraded"`。
8. `activationDefinition.causalStatusAfter="experiment-supported"` ⇔ `readout.activationReadout="activation-transfers"` ∧ `terminalState ∈ {decided_ship, decided_iterate, decided_kill}` ∧ 存在 `lookIndex="retention"` 或 final look 时 `retentionMatured=true`。
9. `design.amendments` 中任一 `afterUnblinding=true` ⇒ `terminalState ∉ {decided_ship}`，除非 `deciderUserIds.length ≥ 2`（S071 在这种情况下已置 `needs-human`）。
10. 同一 `lookIndex` 在 `looks` 中至多出现一次（决策 4 一看一锁）。

## 7. 终态
| 终态 | 条件 | 产物 |
|---|---|---|
| `decided_ship` / `decided_iterate` / `decided_kill` | G4 已签；不变式 1–3 成立 | 完整记录；iterate 附带新实例 id（发起人确认后才创建） |
| `not_run` | S071 `worthRunning ≠ run-experiment` 且人确认；或阶段 3 无假设 | 记录 `worthRunning.reasons`、`postLaunchGuardrails` |
| `infeasible` | S071 `status="infeasible"` 且人确认不改参数 | `achievableMdeAtMax` |
| `blocked_metrics` | S072 判主指标 `experimentReady=false`（例如 `unitMismatch`），或 S074 define 无可用定义 | S072 `blockers[]` 或 S074 `gaps` |
| `design_rejected` | G1 被拒 | 冻结的 spec 保留，供评测 |
| `aborted_health` | G-health 选择中止 | 健康检查报告；没有任何解盲数据 |
| `aborted_harm` | 越过 harmStop，人确认停止 | 越界的 look、harm 护栏 id |
| `invalid_design` | S161 `srm.detected` 且人选择结束 | SRM 统计量、可能原因清单 |
| `expired_no_validation` | 看数点之后 14 天仍无合格 `validationRef` | 锁定快照 id |
| `cancelled` | 发起人取消；或上线声明 30 天未签 | 已产生的报告保留 |
| `failed` | `PreregistrationMismatch`、`invalid_trigger`、Skill 版本被撤销且无兼容版本、组织撤销 W031 授权 | 原因码 |

`PreregistrationMismatch` 归入 `failed` 而不是回到设计阶段：此时已经解盲，没有合法的重新设计路径（S071 `AmendAfterUnblinding`）。S161 §7 对该码的处置是「人工闸门（W031 作者定义），S161 不替换 spec」；W031 在此明确声明：该闸门定义为**直接失败、无人工分支**，人不能改 spec 后重跑，只能以新实例重新设计。

## 8. 每个副作用点的权限复查
实验会持续数周，期间 owner 可能离职或调岗，数据集授权也可能被收回。以下每个点都以 `ownerUserId` 的身份实时复查，结果落事件；复查端口 **proposed-unwired**（基线 `apps/api/src/application/agent-run/tool-permission-gate.ts` 存在，其判定细节 UNVERIFIED，不能假设它支持以用户身份复查数据集授权）。
- **P1（G1 批准后、写预注册记录前）**：owner 仍是 org 成员；owner 与第二签人对 `analytics.datasetRef` 仍有读权限；W031 仍在发起 Agent 的 `workflowAllowlist` 中。任一失败 → 不写记录，回到 awaiting_design_approval 并标明原因。
- **P2（G2 签署时、写上线声明前）**：签署人是 owner 或 owner 在 G2 中指定的人，并且仍是 org 成员。
- **P3（每次数据锁定前）**：owner 对快照 `fileId` 有读权限；`validationRef` 报告属于同一 org 且 owner 可读。失败 → `awaiting_validation`；**不得**改用其他数据源（ADR-120 第 3 条；S074 §7 同样要求）。
- **P4（写 `ExperimentLoopRecord` 前）**：owner 对目标项目有写权限。
- **P5（每位 watcher 收到通知前）**：通知只包含 `terminalState`、`decision.action`、`ruleAction` 和记录链接，**不含**数值。watcher 打开记录时，按其自身对 `datasetRef` 的读权限决定是否能看到 S161 的数值；无权限的 watcher 只能看到决策摘要。收件人的数据集权限差集服务 **proposed-unwired**。
- **P6（从 checkpoint 恢复后）**：先重做 P1 所列的成员与数据集权限检查，再继续。owner 已不是 org 成员 → 实例进入 `awaiting_owner`（不属于终态），由组织管理员重新指定 owner 后继续；30 天无人接手 → `cancelled(owner_lost)`。

## 9. Receipts、幂等与崩溃恢复
沿用 ADR-118 第 3 条的统一 receipt（形状与基线 `apps/api/src/application/research/guided-workflow-receipt-ports.ts` 的 begin/finalize + payloadFingerprint 相同；本文核对了文件存在，receipt 的实现细节 UNVERIFIED）。W031 特有的键：
| 对象 | 幂等键 | 冲突行为 |
|---|---|---|
| 实例 | `(orgId, initiatorUserId, requestId)` | 同键、不同 fingerprint → `IDEMPOTENCY_KEY_REUSED` |
| S072 审核 | `hash(instanceId, metricsInputDigest)` | 崩溃后复用已 finalize 的报告 |
| S071 设计 | `hash(instanceId, designVersion)` | 同一 designVersion 不重算；修订必须 +1 |
| 预注册记录 | `hash(instanceId, hypothesesDigest)` | **只写一次**；同一 digest 再次写入返回原记录；另一个 digest 需要新的 designVersion 和新的 G1 |
| 上线声明 | `hash(instanceId, designVersion, "launch")` | 只写一次 |
| S157 预检 / S161 分析 | `hash(instanceId, lookIndex, snapshotVersionId, hypothesesDigest)` | 同 look、另一个快照 → `LOOK_ALREADY_ANALYZED`（决策 4） |
| 记录 / 通知 | `hash(recordId, terminalState)`；通知为 `hash(recordId, recipientUserId, "inapp")` | 不重复通知 |

- **持久定时器**：看数点、D+3 健康检查、`retentionMatureAt`、各类等待超时（G2 30 天、validation 14 天、owner 30 天）都用持久作业调度。ADR-118 第 7 条规定由 pg-boss 泛化。基线 `apps/api/package.json` 已依赖 pg-boss（已核对）；用它启动或唤醒 workflow 实例 **proposed-unwired**。定时器的触发键为 `hash(instanceId, timerKind, lookIndex)`，重复触发没有影响。
- **崩溃恢复顺序**：P6 → 读业务行（checkpoint 只记指针，ADR-118 第 4 条）→ 如果崩溃发生在 S161 已 finalize、阶段 12 之前，直接复用 S161 报告，**绝不重跑 S161**（重跑本身不改变数字，但会产生第二个 receipt，破坏不变式 10 的审计）→ 从第一个未 finalize 的阶段继续。
- **业务行**：各阶段产物写入 ADR-118 的通用阶段输出表（`workflow_stage_outputs`，**proposed-unwired**）。W031 只需要一张额外的投影 `ExperimentLoopRecord`，不另建检验结果表。
- **重试预算**：Skill 输出结构校验失败 ≤ 3 次，计数写在业务行里，崩溃后不清零。`SnapshotDrift`（S161）可重试一次，重试时**必须**用原来的 `snapshotVersionId`；如果原版本已经不可读，按 P3 失败处理，不能换新版本。`AccessDenied`、`InvalidInput`、`PreregistrationMismatch` 不重试。

## 10. 失败模式（W031 特有）
| # | 失败 | 表现 | 防线 |
|---|---|---|---|
| F1 | 预注册形同虚设 | 设计冻结后，运行态悄悄改了 α 或主指标，S161 仍然照跑 | 预注册记录只写一次；S161 `specDigest` 与 `hypothesesDigest` 比对；不一致 → `failed` |
| F2 | 挑数据 | 第一次锁的快照结果不好，换一个时间截止点重跑 | 决策 4 一看一锁，`LOOK_ALREADY_ANALYZED` |
| F3 | 把计划当成已上线 | 流程显示「运行中」，但外部根本没有开分流 | 决策 2 上线声明，未签署则 `looks=[]`（不变式 5） |
| F4 | 分流盐不一致 | 外部用了另一套分桶，设计的分配和实际不符 | `assignmentSaltMatches=true` 是 schema 字面量；D+3 健康检查报告偏差 |
| F5 | 中期看到名义显著就停 | 第 1 个看数点 p=0.03 就宣布胜利 | 只按 `boundariesZ` 判定，不用 S161 的名义显著（决策 4） |
| F6 | 无校验就解盲 | 缺少 S158 报告，直接对有重复行的数据做检验 | 决策 3，`awaiting_validation` |
| F7 | 激活涨了就当成功 | 激活 +6pp、留存持平，激活定义却被升级为因果 | 决策 6，不变式 8 |
| F8 | 规则被人工悄悄推翻 | 护栏 harmful 仍然 ship | 不变式 2/3：必须写理由并由第二人签署 |
| F9 | 数值通过通知泄露 | watcher 无权读数据集，却在通知里看到各臂转化率 | P5：通知不含数值 |
| F10 | owner 离开后实例还在跑 | 离职员工名下的实验继续读数据 | P6 `awaiting_owner` |

## 11. CN / US 差异（仅列实质性差异，只触发门控，不构成法律意见）
| 场景 | CN | US | W031 的处理 |
|---|---|---|---|
| 价格/资费实验 | S071 标记 `cn-pricing-discrimination-review`（《个人信息保护法》第 24 条，交易条件不得有不合理的差别待遇），`worthRunning` 被强制为 `human-decision` | `us-price-disclosure-review` | 两地都会把 G1 升为 multi-gate；CN 下 `ship` 还要求在 G4 附上合规复核的 `artifactRef` |
| 个性化推荐/排序实验 | `cn-algorithm-opt-out`：关闭个性化的用户必须排除在实验外或进入固定对照组 | 无对应联邦要求 | CN 下 D+3 健康检查额外核对：opt-out 用户在处理组中的占比为 0（通过 S157 `preperiodBalance` 的 covariate `personalization_opt_out`；如果数据集没有这一列 → G-health） |
| 未成年人学习实验（D047） | `cn-minor-guardian-consent` | `us-ferpa-review`；联邦资助时加 `us-irb-review` | 这些标记出现时 G1 为 multi-gate，并要求附上同意书或 IRB 批件引用；缺少则不能进入 P1 |
| 分析数据 | S074 要求 `subjectIdKind="pseudonymous"`，服务端做扫描（两地相同） | 同左 | W031 的记录和通知都不含单元级 id；S157/S161 的小格抑制（`<10` / `<5`）原样保留 |

## 12. WorkspaceX 落点（基线 `30c1c4332025151610502988b0379b95ff7298c7`）
已核对存在的文件：
- `apps/api/src/application/research/guided-workflow-receipt-ports.ts`（receipt 形状样板；W031 与它的对应关系 UNVERIFIED）。
- `apps/api/src/application/agent-run/run-skill-script.ts`、`apps/api/src/application/agent-run/tool-permission-gate.ts`（Skill 脚本执行与权限门；具体行为 UNVERIFIED）。
- `packages/contracts/src/agent-runtime.ts:87`：`ToolSideEffect = ["只读","对外发送","写入外部"]`。W031 的映射：read → 只读；`workflow.record.write`/`artifact.write` 按本文设计属于平台内部写，不经过 MCP（基线写路径是否经 MCP，UNVERIFIED）；W031 v1 没有「对外发送」和「写入外部」。
- `apps/api/package.json` 依赖 pg-boss。
- 基线上没有分流/功能开关代码（本文 `git grep` 复核）；`workflowAllowlist` 在 `apps/`、`packages/` 中无命中（本文 `git grep` 复核）。

**proposed-unwired**：`apps/api/src/{domain,application,infrastructure}/workflow/`、`packages/contracts/src/workflow-definition.ts`、`workflow_stage_outputs`、`workflowAllowlist`、multi-gate HITL、以用户身份复查数据集读权限的端口、watcher 数据集权限差集、`w031-readout-adapter.mjs`、`check-w031-record.mjs`、看数点边界比较脚本（复用 S071 `design-calc.mjs` 输出的 `boundariesZ`，不重算）、各 Skill 的脚本（`design-calc.mjs`、`noise-band.mjs`、`activation-metrics.mjs`，见各自文档）、`evals/work-stack/W031/`。

## 13. 外部参考与溯源（A3：只取流程模式，不复制正文）
| 来源 | 路径 | commit | 许可（artifact 级） | 取用 |
|---|---|---|---|---|
| RefoundAI/lenny-skills | `skills/growth-experimentation/SKILL.md` | `13598cc54e09399bc1bc1398b0fca284110efb2f` | 仓库根目录 `LICENSE` 为 MIT；**工件 frontmatter 没有 license 字段**，正文引用了播客嘉宾的原话，这部分版权不属于该仓库 → **reference-only** | 只取话题：「反事实（对照组）优先」「小改进的复利 → 迭代应当生成新实验而不是改旧实验」对应决策 7。不复制任何句子 |
| RefoundAI/lenny-skills | `skills/product-experiments/SKILL.md` | 同上 | 同上，reference-only（S071 §3 已这样处理） | 话题：SRM 是首要的有效性检查、Twyman 定律 → 阶段 11 的 SRM 分支、决策 5 的 `twyman_recheck` |
| K-Dense-AI/claude-scientific-skills | `skills/experimental-design/SKILL.md`（frontmatter `license: MIT license`） | `49c6e97775eaa18ba791bebe23162a70ae601c18` | MIT（仓库根目录 `LICENSE.md`） | 模式：「先记录/预注册，再执行，最后按设计分析」→ 预注册只写一次（阶段 6）。不复制正文和脚本 |

克隆位于会话 scratchpad（`scratchpad/upstream/lenny-skills`、`scratchpad/upstream/kdense`），不入库；以上均为行为层面的重建，不进入 `provenance[].copied`。

## 14. 评测（`evals/work-stack/W031/`，**proposed-unwired**；合成夹具，回环模型）
基线对照（ADR-119 G5）：同一请求交给一个挂载了 S071/S161 但没有 W031 的 Agent，让它在对话中完成。

| # | 输入（fixture） | 通过判据（规则 grader） |
|---|---|---|
| E1 | D003，`activationTrack=true`，无 `activationDefinitionRef`，`s074-diagnose`，两臂 50/50，`fixed-horizon` | 阶段顺序：S074 define → S074 diagnose → G0 → S072 → S071；S071 输入中 `sourceHypothesisRef.skill="S074"`，`metricRef.skill="S072"`；G1 前不存在任何 S157/S161 receipt |
| E2 | 预注册后，运行态把主假设 `alpha` 改为 0.1 再送入 S161 | S161 报 `PreregistrationMismatch`；终态 `failed(prereg_mismatch)`；记录里没有 `decision` |
| E3 | G1 已批准，G2 未签，30 天后 | 终态 `cancelled(not_launched)`；`launch=null`，`looks=[]`；没有数据读取 receipt |
| E4 | 上线声明 `actualStartAt` 比计划晚 5 天，假设不变 | S071 新 designVersion，`amendments[0].afterUnblinding=false`，`endAt` 顺延 5 天；G1 以 ask 形式出现；`hypothesesDigest` 不变 |
| E5 | D+3 健康检查：处理组暴露日志覆盖 0.81，对照组 0.99 | G-health 被触发；S157 输出中没有按臂拆分的结果指标；选择「中止」→ `aborted_health`，`looks=[]` |
| E6 | 看数点到达，无 `validationRef`；14 天后仍无 | 状态 `awaiting_validation`，S161 调用次数为 0；最终 `expired_no_validation` |
| E7 | 提供 `validationRef`，但其快照 sha256 ≠ 锁定快照 | 不进入 S157/S161；G3 显示快照不匹配 |
| E8 | 锁定快照 v1 分析完后，请求对 `lookIndex=final` 用快照 v2 重跑 | `LOOK_ALREADY_ANALYZED`；`looks` 中 final 只出现一次 |
| E9 | 观测分配 52.4/47.6（n=40,000），设计 50/50 | S161 `srm.detected=true`；W031 进入 SRM 分支；终态 `invalid_design` 时通知与记录中没有按臂拆分的主指标数值 |
| E10 | `group-sequential(looks=3)`，第 1 个看数点 z=2.6（名义 p≈0.009，低于边界约 3.47） | 不停止，回到 `running`；记录 `boundaryCrossed="none"`；记录中不出现「显著」 |
| E11 | 护栏「退款率」在第 2 个看数点越过 harmStop | 进入 awaiting_harm_decision（required）；确认后 `aborted_harm`，`decision.action="kill"` |
| E12 | 主指标 `meaningful`，护栏 `harmful`，G4 由发起人单人选择 ship | 被拒（`ruleAction=escalate` 需要 multi-gate）；填写 `overrideReason` 并由第二签人签署后才允许 `decided_ship`，`followsRule=false` |
| E13 | 主指标相对提升 +45%，`twymanThreshold` 对应 +30%，`ruleAction=ship` | 先进入 `twyman_recheck`；没有 `twymanEvidenceRef` 时 G4 不提供 ship 选项 |
| E14 | activationTrack，激活 +6pp 显著，`retention.horizonDays=35`，`endAt` 时留存未到期 | G4 可以决定；`activationCausalUpgrade="pending"`；实例进入 `awaiting_retention_maturity`；定时器在 `endAt+35d` 唤醒；readout 为 `activation-only` → `causalStatusAfter="correlational"` |
| E15 | 同 E14，到期后留存 −2pp 显著，之前 G4 选的是 ship | S074 `activation-harms-retention`，`escalate=true`；G4 重新打开且为 multi-gate；owner 与第二签人都收到通知 |
| E16 | CN，`change.summary`「新用户首单减 10 元」，trigger 声明 `touchesPricing=false` | 阶段 1 改写为 `touchesPricing=true`；S071 `cn-pricing-discrimination-review`；终态为 `not_run(human-decision)` 或 G1 multi-gate，不存在单签通过的路径 |
| E17 | D047 learning，`participantsIncludeMinors=true`，US，`fundingSource="us-federal"`，按班级随机 | S071 `design="cluster"`；`us-ferpa-review`、`us-irb-review`；没有 IRB 批件引用时 P1 不通过 |
| E18 | 运行第 3 周 owner 离开 org，随后看数点定时器触发 | P6 → `awaiting_owner`；锁定前 0 次数据读取；管理员重新指定 owner 后继续 |
| E19 | watcher U2 对 `datasetRef` 无读权限 | U2 收到的通知只含 `terminalState` 与 action；打开记录看不到 S161 数值 |
| E20 | S071 输出 `worthRunning=ship-without-test`（文案微调） | 人确认后终态 `not_run`；不变式 4 成立（没有预注册，也没有 S157/S161 receipt） |
| E21 | S161 已 finalize，崩溃发生在阶段 12 之前 | 恢复后 S161 receipt 数量不变；readout 使用原 `analysisReportId` |
| E22 | G4 选 iterate | 父实例终态 `decided_iterate`；新实例 `origin.kind="iterate"`，`parentInstanceId` 正确；新实例在发起人确认前不创建 |

G5 对比判据：基线 Agent 在 E2/E6/E8/E10/E12/E14 中至少失败 3 条，而 W031 全部通过，才能标为 verified。S071 E13、S157 E4、S161 E1 作为跨阶段断言并入本套件（S071 §12、S157 §11 已声明），不计入各自 Skill 的 G5。

## 15. Graph change proposals（只提议，不修改矩阵，本文也不假设会被采纳）
1. **把 S158 Data Validation 加入 W031。** S161 `mode="experiment"` 硬性要求 `validationRef`（S161 §5）。目前 W031 只能引用外部产生的 S158 报告（决策 3），实践中会经常停在 `awaiting_validation`。建议评审把 S158 加入 WORKFLOW-SKILL-MATRIX 第 37 行，放在阶段 9 与阶段 10 之间。在被采纳之前，本文的阶段表保持现状。
2. **S161 增加序贯看数输入（接口提议，不涉及边）。** 建议 S161 接受 `sequential?: { lookIndex; looks; boundariesZ }`，在中期看数点直接按边界给出 `significantAfterCorrection` 和 `allowedAssertion`。在此之前，W031 用平台脚本比较 `statistic` 与边界（决策 4），并且不使用 S161 的名义显著判定。
3. **分流/功能开关能力缺口。** 基线没有这种能力，W031 v1 以上线声明代替（决策 2）。如果将来建设，它应当是一个 ADR-120 工具分类（例如 `experiment.assignment.write`，high-impact，走 effect-gateway），**不是** Skill。本文不提议新增 Skill。
4. **接口对齐（同意并呼应已有提议，不改边）**：S161 §7 的预注册核对来源改为「W031 运行记录中 S071 的 `hypothesesDigest`」（与 S071 §13 提议 1、决策 1 一致）。注意上游本身不一致：S072 §14 提议 3 写的是改为 S071 `designDigest`，不是 `hypothesesDigest`；W031 采用 `hypothesesDigest`，并提请 S071/S072 在该字段上统一；W031 的预注册记录（阶段 6）就是这条运行记录。S074 `experimentResult` 改为直接引用 S161 结果（S074 §14 提议 2、S071 §13 提议 2）。采纳后可以删掉 `w031-readout-adapter.mjs` 中的检验字段搬运，只保留每臂计数。

## 16. 未决问题
- D+3 健康检查的阈值（暴露覆盖 0.95、单臂断档 6h、分配偏差 5%）是本文设定的，需要用真实的历史实验回放来校准。
- G2 上线声明 30 天、validation 14 天、owner 30 天这三个超时是否应该作为组织级可配置项（只允许调短），需要与 ADR-118 的实现对齐。
- 本文引用的 ADR-120 第 3 条条款号尚未逐字复核；ADR-118 第 3–7、9 条已读过，与本文一致。
- `learning` profile 下，课堂实验的「上线」往往是按学期排课，上线声明的字段（`externalConfigRef`）是否足以表达排课安排，需要 D047 的使用方确认。
