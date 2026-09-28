# W028 — Research-to-Insight（从一轮用户研究到经过复核的洞察与机会地图）

> 类型：Reference Workflow · 域：Product · 作者化任务：AUTHOR-W028 · 状态：待独立评审
> **代码基线**：`main@30c1c4332025151610502988b0379b95ff7298c7`。本文中关于现有 WorkspaceX 代码的陈述都在这个基线上用 `git show <sha>:<path>` 核对过；没有核对行为的标 **UNVERIFIED**，基线上不存在或没有接线的能力标 **proposed-unwired**。
> 权威来源：`requirements/work-stack-v2/`（ADR-116）。运行时：ADR-118（第 5 条实例固定版本，第 6 条 effect-gateway，第 9 条 Workflow 固定 Skill 版本、Agent 不需要挂载）。
> 对齐的已 PASS 契约（本文只引用，不修改）：`skills/S062-user-interview-planning.md`、`skills/S063-research-synthesis.md`、`skills/S169-knowledge-synthesis.md`、`skills/S171-evidence-review.md`、`skills/S065-opportunity-mapping.md`。`skills/S009-customer-research.md` 目前**没有** PASS 评审，本文对它的接口引用一律标 UNVERIFIED（草稿契约），它改动时本文需要跟着复核。

## 1. 边界：这个 Workflow 做什么、不做什么
W028 把**一个会被研究结果改变的产品（或学习设计）决定**，经过「规划真人访谈 → 人执行访谈 → 取回语料 → 综合 → 与组织既有知识对账 → 逐条主张复核 → 机会地图」，变成一份 **InsightReport**。报告里每一条洞察都能点回到访谈原话片段，措辞不超过 S171 给出的上限。如果证据足够，报告会给出一个**由人确认**的目标机会。

它和相邻 Workflow 的分界（这里只讲分界，不是依赖）：
- **W027 Discovery-to-Opportunity**（S061, S062, S009, S063, S064, S065）：没有 S171，产出始终是 `provisional`，并且由 S064 立根。W028 有 S171，所以能产出 `final` 证据；它没有 S064，所以根只能由发起人给出（决策 2）。
- **W029 Problem-to-PRD**：W028 的终点是「选定机会」，**不写 PRD**，也不自动启动 W029。W028 的 `handoff` 只是一个可以被 W029 引用的对象 id。
- **W001 Research-to-Brief**：研究的是组织已有资料，不做访谈。W001 §2.3 已经写明「W028 产品域用户研究不走 W001」。
- **W060 Research-to-Evidence**：在 W060 里 S169 位于 S171 `appraise` 之后，模式是 `structure-evidence`；在 W028 里 S169 位于 S171 `claim-audit` 之前，模式是 `integrate-findings`。同一个 Skill，两种位置，都以 S169 §2.1 为准。

W028 **不做**这些事：替人招募、发邀约、预约或录音；生成虚拟受访者；给出百分比或「大多数用户」；把洞察写回组织知识图谱；替人选择目标机会。

## 2. 组合图（精确 ID，逐字取自两张矩阵，不推导）

### 2.1 参与 Skill（`WORKFLOW-SKILL-MATRIX.md` 第 34 行：`W028 | Research-to-Insight | Product | S062, S009, S063, S169, S171, S065`）
| Skill | 名称 | 在 W028 中的唯一职责 | 调用模式 | 对方契约出处 |
|---|---|---|---|---|
| S062 | User Interview Planning | 定 RQ（`questionId` 全链主键）、分层、筛选题、同意计划、中立提纲、停止规则 | `evaluative` / `discovery` / `learning-needs` | S062 §2.1 W028 行、§6、决策 1/3/5 |
| S009 | Customer Research | 访谈结束后按同一组 `questions[]` 取回已同意的访谈片段 | `voice-corpus` | S009 §2 W028 行、§4 V1–V2、§8 G6（UNVERIFIED：S009 未 PASS） |
| S063 | Research Synthesis | 两层编码、主题、`prevalence`、负例搜寻；先产出 `provisional`，S171 之后由算法重算为 `final` | `qualitative-corpus` | S063 §4.4、§6、决策 6 |
| S169 | Knowledge Synthesis | 把本轮 Finding 与组织既有知识对账（`same-as-existing / extends / contradicts / novel`），导出 `claimsForAudit` | `integrate-findings` | S169 §2.1、§4 步骤 7/10、§6、I8 |
| S171 | Evidence Review | 审核 S169 导出的合并主张：relation、certainty、`allowedAssertion`、`overclaim` | `claim-audit`，`evidenceRegime: "qualitative"` | S171 §2.1 W028 行、§4、§6 |
| S065 | Opportunity Mapping | 以发起人的 `outcome` 为根、以 **final** synthesis 为证据建机会树并比较兄弟节点 | `build`（修订轮用 `revise`） | S065 §2.1 W028 行、§5 I1/I3、§6 不变式 5–9 |

Skill 版本由 `WorkflowDefinition(W028, v1).stages[*].skills[*] = {stableId, versionRange}` 在实例启动时解析并冻结（ADR-118 第 5 条）。发起 Agent 只需要在 `workflowAllowlist` 里被允许运行 W028 v1（ADR-118 第 9 条）。在基线的 `apps/api/src` 和 `packages/contracts/src` 里 grep `workflowAllowlist` 没有命中，所以这一项是 **proposed-unwired**。本文不提出任何 DigitalHuman 挂载边。

### 2.2 消费者（`DIGITALHUMAN-COMPOSITION-MATRIX.md` 中 Exact Workflows 含 W028 的行，共 5 个）
| DH | 矩阵行 | W028 触发时的缺省 profile（只作用于 trigger 字段，不复制 Skill） |
|---|---|---|
| D003 Product Manager | 第 9 行 | `domainProfile=product`，`studyMode` 缺省 `evaluative` |
| D011 Design Thinking Expert | 第 17 行 | `product`，缺省 `evaluative` |
| D026 Education & Learning Designer | 第 32 行 | `learning`，缺省 `learning-needs` |
| D043 UX Researcher | 第 49 行 | `product`，缺省 `evaluative` |
| D047 Learning Experience Designer | 第 53 行 | `learning`，缺省 `learning-needs` |

`learning-needs` 模式与 learning profile 的映射取自 S062 §4 P0 表和 S062 §2.2。D 行 Skill 列只表示「聊天中直接调用」（ADR-118 第 9 条），与能不能运行 W028 无关。

## 3. 实体特有决策

**决策 1 — 访谈执行（fieldwork）是 Workflow 内的一个长等待阶段。只有人能关闭它，Agent 没有任何推进手段。**
矩阵把 S062（规划）和 S009（取语料）排成相邻两步，但两者之间实际隔着招募、邀约、访谈和转录，这些要花几天到几周。W028 把这段时间建模成状态 `awaiting_fieldwork`，并按下面的规则处理：
- 大纲导入之后的确认走基线现有的 `confirmOutline`（`apps/api/src/application/interview/confirm-outline.ts`，已核实导出 `confirmOutline(deps, input)`）；导入适配器 `importPlanAsOutline` 是 S062 决策 1 中暂定的名字，**proposed-unwired**。
- 邀约外发只能由人完成：基线 `send-booking-invite.ts` 文件头写明「只能由人类主体触发」，`canSendBookingInvite(cmd.actorKind)` 不通过时抛 `OutboundRequiresHumanError`（已核实第 4–8、44 行）。W028 不包装、不代发这条路径。
- RQ 覆盖状态也只能由人写：`set-rq-coverage-status.ts` 在 `viewerActorKind === "agent"` 时恒拒绝（已核实第 60 行）。W028 读取覆盖状态（读路径的具体端口 UNVERIFIED），不写。
- 关闭 fieldwork 的是人工门 **G3**（required）。关门时人要确认三件事：`interviewSourceIds[]`、每位参与者属于哪个 `stratumId`、试访场次的 id（S062 规定 `pilotExcludedFromCorpus: true`）。
- 最长等待 60 天，到期终态为 `fieldwork_abandoned`。等待期间 Workflow 不消耗模型调用，只保留 lease 心跳。

**决策 2 — 根 outcome 在 trigger 里必填；W028 不自己推断根，也不借用 S064。**
S065 §14 提议 2 指出：W028 这一行没有 S064，根只能来自调用方的 `outcome`，所以很容易落到 `unanchored`。W028 的处理是：`outcome = {actor, behavior, direction}` 在 trigger 中**必填**，并在进入 S062 **之前**先按 S065 §4 A1 的三项检查（有行为主体、有可观察行为、有方向）做一次确定性预检，不通过就拒绝启动（`W028_OUTCOME_UNANCHORED`）。理由：跑完几周访谈之后才发现根立不住，所有研究投入只能换回一份「候选列表」。这里没有采纳「在 S171 之后加 S064」，因为那需要改矩阵，只作为提议写进 §13。

**决策 3 — S171 审的是 S169 合并后的主张。审核结果再按确定的映射表回灌到 S063 的各个 Finding，并由算法重算（不再调用模型）后把状态转为 `final`。**
几份已 PASS 契约之间有一个接缝：S171 在 W028 中审核的是 S169 的 `claimsForAudit`（S169 §4 步骤 10），而 S063 决策 6 的重算要求「以原 Finding 的 claim 作为锚点」，S065 I3 又只接受 S063 synthesis 作为证据。W028 这样接：
1. S169 的输入 `items[]` 逐条来自 S063 Finding：`itemId = findingId`，`origin = "finding"`，`text = claim`，`quote` 取该 Finding `quotes[]` 的逐字文本拼接（≤2000 字，超出时按 segmentId 拆成多个 item，`itemId = findingId#k`），`upstreamRef = {skill:"S063", refId: findingId}`。
2. S169 输出之后，Workflow 由 `units[].provenance[].itemId` 构建映射表 `auditMap: claimId → findingId[]`，并做确定性校验：每个非 `outOfScope` 的 findingId **至少**被一条 `claimsForAudit` 覆盖。有遗漏就判 S169 输出不合规，按 §8 做结构化重试。
3. S171 的 `evidence[]` 只取 S009 片段：`evidenceId = segmentId`（和 S063 `qualitative-corpus` 的命名空间一致，S063 §4.1 P3），`quote = segment.text`，`sourceKind = "interview-transcript"`。
4. 每个 Finding 取 `auditMap` 反查得到的所有 S171 主张，交给 S063 决策 6 的三步重算（用 `scripts/confidence.mjs`，**proposed-unwired**）。一个 Finding 被多条合并主张覆盖时，按**最严**的一条取值：`allowedAssertion` 取最低档，并剔除任一主张判为 `irrelevant` 的片段。
5. 重算后的 synthesis 以**新的 `synthesisId`** 落为业务行，`status = final`。S065 只拿到这个新 id。provisional 版本仍然保留，用于审计，但不会交给 S065。

**决策 4 — `evidenceRegime` 在 W028 里固定为 `qualitative`，不随发起 DH 走缺省映射。**
S171 §2.2 只给 D043 映射了 `qualitative`，D003、D011、D026、D047 都不是 S171 的挂载者，走缺省会落到 `general`。在 `general` 阶梯下，访谈原话算 E-C，起点是 `moderate`，也就不会看「受访者数、行为观察还是自述、是否诱导提问」这些维度（S171 §4 步骤 3）。W028 的证据**全部**是访谈，所以阶梯由 Workflow 决定，而不是由角色决定。

**决策 5 — S169 的 `contradicts-existing` 只呈现、不回写。W028 没有写知识图谱的阶段。**
S169 决策 3 规定与既有知识冲突时一律交给人工，S169 §7 规定回写必须经人确认后走 `applyOntologyBatch`（基线文件 `apps/api/src/application/knowledge-graph/apply-ontology-batch.ts` 存在，已核实导出 `applyOntologyBatch`；从 S169 输出到它的调用路径是 **proposed-unwired**）。W028 的处理：`humanReviewItems[]` 原样进入 InsightReport 的 `knowledgeConflicts` 段，在 G4 上展示给人看，但 W028 **不**触发回写。原因有两个：一次 8–15 人的研究不应顺带修改组织级权威知识；把回写放进 W028，会让 W028 的终态同时承担「研究结论」和「知识治理」两种责任，崩溃恢复时很难说清哪一个已经生效。回写的归属在 §13 提议 3 里另外提出。

**决策 6 — 同意是逐阶段的时点事实。撤回同意会让下游阶段失效，已发布的报告做就地脱敏，不整份撤回。**
同意项的唯一事实源是 `packages/contracts/src/consent-item.ts`（基线存在，已核实；S062 §4 P5 说其取值为 `record / transcript / ai_analysis / attribution`）。W028 在四个点重查同意（C1–C4，见 §5 说明），并规定：
- 在 S063 之前撤回 → 该参与者的片段不进入 corpus（S009 G6 的职责；S009 未 PASS，UNVERIFIED）。
- 在 S063 之后、发布之前撤回 → 从 S063 起所有阶段标为 stale 并重跑；S169 的 unit id 由内容哈希生成（S169 决策 5），重跑后没有变化的单元 id 保持不变。
- 发布之后撤回 → 报告里该参与者的引文替换为「[已撤回]」，所有 `prevalence` 分子分母按剔除后的数据重算，并写一条 `consent_redaction` 事件；重算后如果目标机会的 `evidenceStrength` 下降，就给目标确认人发站内通知，**不自动撤销**人已经确认过的目标。
- `attribution = false` 的参与者在报告中只显示 `participantAlias`（P1、P2……）和 `stratumId`，不显示职务、公司或学校。

**决策 7 — 覆盖不足按分层判定，不按总人数。不足时照常出报告，但把能说的话压到「部分受访者提到」。**
S062 决策 3 规定每层 ≥3，想做普遍性表述的层要 ≥ `generalizationClaimMinIndependentSubjects`（`packages/contracts/src/thresholds.ts:270`，已核实存在，运行时读取，本文不抄数值）。在 S009 之后，W028 按 G3 确认的参与者→分层映射计算 `stratumCoverage[]`：
- 有分层实际人数 < 3 → 该层服务的 RQ 在报告里标 `coverage = thin`，并作为 limitation 交给 S063。
- `isNonCompleterStratum = true` 的层人数为 0 → 该层服务的每个 RQ 都进入 `unansweredQuestions(why=insufficient)`。这是 W028 专门防的「幸存者洞察」：只访谈了成功用户，却得出流失原因。
- 全部分层人数为 0 → 终态 `no_corpus`。

## 4. Trigger schema
```ts
// packages/contracts/src/workflow-definition.ts 中 W028 的 trigger 输入（ADR-118 新建；proposed-unwired，基线不存在）
const W028Trigger = z.object({
  kind: z.enum(["manual", "agent_request"]),        // 不支持 schedule / webhook：每轮研究需要有人对决定负责
  requestId: z.string().uuid(),
  orgId: OrgId,
  initiatorUserId: UserId,                          // 权限主体；agent_request 时仍然是背后的人
  initiatorAgentVersionId: z.string().nullable(),   // 必须在该 Agent 的 workflowAllowlist 内（proposed-unwired）
  studyProjectId: z.string(),                       // 访谈与报告所在项目；S009 claimedScope 只收窄到它
  decision: z.string().min(12).max(300),            // 透传 S062 P1；只是话题时 S062 返回 needs-clarification
  outcome: z.object({                               // 决策 2：必填，进入 S062 前先预检
    actor: z.string().min(2).max(60),
    behavior: z.string().min(4).max(120),
    direction: z.enum(["increase", "decrease"]),
    window: z.string().max(40).optional(),
  }),
  studyMode: z.enum(["evaluative", "discovery", "learning-needs"]).optional(), // 缺省按 §2.2
  domainProfile: z.enum(["product", "learning"]).optional(),                   // 缺省按 §2.2
  concept: z.object({ conceptRef: z.string(), description: z.string().max(800) }).optional(), // evaluative 必填（S062 IN1）
  hypotheses: z.array(z.object({ hypothesisId: z.string(), text: z.string().max(200) })).max(8).default([]),
  targetPopulation: z.string().max(300),
  constraints: z.object({                           // 原样透传 S062 constraints，W028 只加一条：jurisdiction 必须明确
    plannedMinutes: z.number().int().min(15).max(120),
    maxSessions: z.number().int().min(1).max(60),
    channels: z.array(S062Channel).min(1),
    modality: z.array(z.enum(["remote-video", "remote-audio", "in-person"])).min(1),
    incentive: S062Incentive.optional(),
    languages: z.array(z.enum(["zh-CN", "en-US"])).min(1),
    jurisdiction: z.enum(["CN", "US", "CN+US"]),
  }),
  extraSourceKinds: z.array(z.enum(["survey-open", "ticket"])).max(2).default([]), // 在 interview 之外，S009 可以额外读取的开放文本
  priorSynthesisIds: z.array(z.string()).max(5).default([]),  // 已有 S063 synthesis，交给 S062 作为 priorEvidence
  seedOpportunities: z.array(z.string().max(120)).max(15).default([]),   // 透传 S065
  constraintsForOpportunities: z.array(z.object({ text: z.string(), kind: z.enum(["hard", "soft"]) })).max(20).default([]),
  locale: z.enum(["zh-CN", "en-US"]),
  reportAudience: z.array(z.object({ userId: UserId })).max(30).default([]),  // 仅站内通知，见阶段 13
});
```
启动前做的确定性校验（全部失败即拒绝，不创建实例）：
- `W028_OUTCOME_UNANCHORED`：`outcome.actor` 是泛称（「用户」「大家」「users」），或者 `behavior` 里没有动词短语。
- `W028_PII_IN_TRIGGER`：`targetPopulation` 或 `decision` 中出现手机号、邮箱或微信号的模式（与 S062 IN6 同一个判据，W028 在入口处先拦一次，避免它们进入 checkpoint）。
- `W028_PROFILE_MISMATCH`：`studyMode = "learning-needs"` 但 `domainProfile ≠ "learning"`，或 channels 含 `own-students` / `school-partner` 但 profile 是 product（S062 IN4）。
- `W028_PROJECT_NOT_WRITABLE`：发起人对 `studyProjectId` 没有写权限。后面导入大纲和发布报告都需要写权限，与其跑到后面才失败，不如在入口就拒绝。

## 5. 阶段表
状态机主干：
`requested → planning → [G1 plan] → C1/P1 → importing_outline → [G2 confirmOutline] → awaiting_fieldwork → [G3 fieldwork close] → C2/P2 → collecting → coverage_check → synthesizing → integrating → auditing → recomputing → mapping → [G4 insight review] → C3/P3 → publishing → published → C4/P4 → notifying → closed`

| # | stage | Skill IDs | 工具能力分类（ADR-120，均为提案名） | 状态转移 | sideEffect | humanGate |
|---|---|---|---|---|---|---|
| 0 | intake | — | — | requested → validated ｜ 拒绝启动（§4 四个错误码） | none | none |
| 1 | plan | S062（`studyMode`） | optional `knowledge.read`（只用于 `priorSynthesisIds` 的服务端读取） | validated → planning → planned ｜ → awaiting_clarification（`needs-clarification`，7 天没补齐 → `clarification_expired`）｜ → plan_blocked（`blocked` 且修订 2 轮后仍 blocked） | read | none |
| 2 | review_plan | — | — | planned → awaiting_plan_review → plan_approved ｜ revise → planning（最多 2 次）｜ reject → `plan_rejected` | none | **G1**：required。批准后执行 **C1/P1** |
| 3 | import_outline | —（平台：`importPlanAsOutline`，proposed-unwired） | `interview.outline.write`（平台内部写） | plan_approved → importing_outline → outline_drafted | write | **G2**：required。由人调用现有 `confirmOutline` 完成确认；Workflow 只等待 `outline_confirmed` 事件 |
| 4 | fieldwork | —（Workflow 外由人执行：招募、`send-booking-invite`、访谈、转录） | —（Workflow 在这个阶段不调用任何工具） | outline_confirmed → awaiting_fieldwork → fieldwork_closed ｜ 超过 60 天 → `fieldwork_abandoned` | none（Workflow 视角） | **G3**：required。确认 `interviewSourceIds`、参与者→分层映射、试访 id（决策 1）。关门后执行 **C2/P2** |
| 5 | collect | S009（`voice-corpus`） | `transcript.read`、`knowledge.read`；条件：`survey.read`、`ticket.read`（按 `extraSourceKinds`） | fieldwork_closed → collecting → collected ｜ `status=degraded-consent` 且 segments 为空 → `no_corpus` | read | none |
| 6 | coverage_check | —（平台确定性计算，决策 7） | — | collected → coverage_checked ｜ 全部分层为 0 → `no_corpus` | none | none |
| 7 | synthesize | S063（`qualitative-corpus`） | conditional `knowledge.read`（只读 corpus 列出的 `sourceVersionId`） | coverage_checked → synthesizing → synthesized_provisional ｜ findings 为空 → `insufficient_evidence` | read | none |
| 8 | integrate | S169（`integrate-findings`） | `knowledge.read`（`existingKnowledgeRefs` 由服务端注入，S169 §7） | synthesized_provisional → integrating → integrated | read | none |
| 9 | audit | S171（`claim-audit`，`qualitative`） | optional `knowledge.read`（只核对 quote 是否存在，S171 §7） | integrated → auditing → audited ｜ 所有主张的 `allowedAssertion ∈ {hypothesis-only, omit}` → `insufficient_evidence` | read | none |
| 10 | recompute | —（平台：S063 决策 6 的 `confidence.mjs`，零模型调用） | `sandbox.exec`（proposed-unwired） | audited → recomputing → synthesized_final | none | none |
| 11 | map | S065（`build`；G4 选择「修订」时用 `revise`） | — | synthesized_final → mapping → mapped | none | none |
| 12 | review_insight | — | — | mapped → awaiting_insight_review → insight_approved（带 `targetDecision`）｜ revise → mapping（最多 2 次）｜ reject → `rejected` | none | **G4**：required。对 S065 的 `decision` 做 accept / choose-from-frontier / decline-target。批准后执行 **C3/P3** |
| 13 | publish | — | `artifact.write`（平台内部写） | insight_approved → publishing → published | write | none（G4 已覆盖；C3/P3 在此之前执行） |
| 14 | notify | — | `notify.inapp` | published → notifying → closed（`reportAudience` 为空时直接 closed） | write | none；每个收件人发送前执行 **C4/P4** |

说明：
- **阶段 1 输入映射**：`mode = studyMode`，`decision`、`concept`、`hypotheses`、`targetPopulation`、`constraints`、`locale` 原样透传；`priorEvidence` 来自服务端按 `priorSynthesisIds` 读取的 Finding 摘要（`evidenceRef = synthesisId#findingId`）。S062 的 `researchQuestions[].questionId` 从这一步起就是全链主键，之后任何阶段**不得重新编号**（S062 决策 5）。
- **阶段 2（G1）的门面内容**：`researchQuestions`、`strata`（标出反幸存者层）、`screener`、`recruitmentBias`、`consentPlan` 四条、`sensitiveQuestions`、`qualityFindings`（warning 级）、`notAnswerableByInterview`。人在这一步可以编辑 RQ，编辑后回到阶段 1 重跑 S062 体检，不允许跳过 P7 直接批准。
- **阶段 5 输入映射**（S009 草稿契约，UNVERIFIED）：`questions = plan.researchQuestions.{questionId,text}`；`subject = {kind:"segment", frame}`，其中 `frame.definition` 取 S062 `targetPopulation` 与 `strata[].criterion` 的拼接，`filters` 只填 S009 `SamplingFrame` 能表达的字段，其余行为判别条件写进 `limitations`（S062 §14 提议 1 所说的接缝，本文不假定它已解决）；`claimedScope.projectIds = [studyProjectId]`；`sourceKinds = ["interview", ...extraSourceKinds]`；`window` = G1 批准时间到 G3 关门时间。G3 标出的试访 id 在 S009 调用**之前**从 `interviewSourceIds` 中剔除。
- **阶段 7**：S063 的 `questions` 与阶段 5 相同；`corpus = pack.corpus`；`domainProfile` 的映射是 `product → "product"`、`learning → "general"`（S063 没有 learning profile，见 §13 提议 2）。`limitations` 追加阶段 6 的 thin 层与 S009 的 `limitations`。
- **阶段 8**：见决策 3 第 1 步；`scope.topic = decision`，`domainProfile` 取 `product → general`、`learning → learning`（S169 的枚举中有 learning）。
- **阶段 9 输入**：`claims = S169.claimsForAudit`；`evidence` 见决策 3 第 3 步；`draftText` = 按 findingId 顺序拼接的 S063 provisional 各 Finding 的 claim，用来比对 `overclaim`；`jurisdiction` 在 `CN+US` 时传 `other`，否则原样。
- **阶段 11 输入**：`mode = "build"`；`outcome = trigger.outcome`（没有 `frameRef`，S065 I1 靠 outcome 满足）；`synthesisRefs = [{skill:"S063", synthesisId: <阶段 10 的 final id>}, ...priorSynthesisIds 中状态为 final 的部分]`；`seedOpportunities`、`constraints` 原样透传；`market` 取 `jurisdiction`（`CN+US` → `global`）。
- **G4 的三个选项**与 S065 §8 对齐：S065 输出里不能出现 `accepted`，只有 G4 的 receipt 可以写 `targetDecision.status = accepted`，并记录确认人 userId。`choose-from-frontier` 只允许从 `comparisons[].frontier` 里选；从 frontier 之外选，门会拒绝，理由写「被支配节点」。
- **G1–G4 的审批人**：G1、G4 由发起人审批。`domainProfile = learning` 并且 channels 含 `own-students` 时，G1 需要第二位审批人（项目 owner，且不能与发起人是同一人），因为这种情况下研究者同时也是学生的授课者（S062 P3 的关系偏差）。G1 multi-gate 为 **proposed-unwired**。

### 5.1 效果点前的重查（每一个效果点都有，全部写入事件）
| 编号 | 位置 | 权限重查（P） | 同意重查（C） | 不通过时 |
|---|---|---|---|---|
| P1/C1 | G1 批准后、阶段 3 写大纲前 | 发起人对 `studyProjectId` 的写权限；`priorSynthesisIds` 仍然可读 | 不适用（这时还没有受访者） | 写权限被撤 → `failed(PROJECT_WRITE_REVOKED)`；某个 prior synthesis 不可读 → 从 `priorEvidence` 删除，然后**重新跑阶段 1 并重走 G1**（RQ 的 `priorEvidence` 已经变了） |
| P2/C2 | G3 关门后、阶段 5 取数前 | 发起人对每个 `interviewSourceIds` 的读权限（按 S009 §8 G4 的 `disclose` 判定；`permission-filter.ts` 的存在性由 S009 草稿声称已核实，本文 UNVERIFIED） | 每位参与者最新的同意提交记录（S009 G5，UNVERIFIED） | 不可读或未同意 `ai_analysis` 的，从 corpus 剔除并写进 `limitations`；剔除后进入阶段 6 重新判断 |
| C2′ | 任何从 checkpoint 恢复的实例，在阶段 7–12 之间 | 同 P2 | 同 C2 | 按决策 6 让下游失效后重跑 |
| P3/C3 | G4 批准后、阶段 13 写报告前 | 发起人对 `studyProjectId` 的写权限；报告引用的每个 `sourceVersionId` 仍然可读 | 报告中每条引文所属参与者：`ai_analysis` 仍为同意；显示身份时 `attribution` 仍为同意 | 引文不再可用 → 删除该引文，重算 `prevalence`（算法）。如果某条洞察因此失去全部引文 → 回到阶段 10 并**重走 G4**（内容已经变了，原来的批准不再覆盖它） |
| P4/C4 | 阶段 14 每个收件人发送前（经 effect-gateway，**proposed-unwired**） | 收件人对 `studyProjectId` 的读权限 | 无（报告已经按 C3 脱敏） | 该收件人跳过，记入 `notifySkipped`；**不**把报告正文放进通知里，只放报告链接（决策 6，防止通知成为绕过 ACL 的通道） |

## 6. 产出 schema
```ts
// W028 只定义自己的投影。各 Skill 的原生类型直接引用，不复制它们的枚举。
const InsightItem = z.object({
  insightId: z.string(),                         // "I1"..，按 findingId 稳定派生：I<n> ↔ F<n>
  findingId: z.string(),                         // 阶段 10 final synthesis 中的 findingId
  questionId: z.string(),                        // S062 RQ id，原样
  observation: z.string().max(280),              // = S063 finding.observation
  interpretation: z.object({ text: z.string().max(280), dependsOn: z.array(z.string()).min(1) }).nullable(),
  assertion: z.enum(["state", "likely", "preliminary"]),  // = min(S063 final assertionCeiling, 映射到的 S171 allowedAssertion)
  prevalence: z.object({ participants: z.number().int(), experienceParticipants: z.number().int(),
                         of: z.number().int() }),         // 只有分数，没有百分比
  byStratum: z.array(z.object({ stratumId: z.string(), participants: z.number().int(), of: z.number().int() })),
  quotes: z.array(z.object({ segmentId: z.string(), participantAlias: z.string(), stratumId: z.string(),
                             text: z.string().max(400),
                             utteranceKind: z.enum(["experience", "wish", "opinion"]) })).min(1),
  counterEvidence: z.array(z.string()),          // = negativeCaseSearch.counterSegmentIds；空数组也要保留
  auditClaimIds: z.array(z.string()).min(1),     // auditMap 的反查结果（决策 3）
  knowledgeRelation: z.enum(["same-as-existing", "extends-existing", "contradicts-existing", "novel"]),
});

const InsightReport = z.object({
  reportId: z.string(), reportVersion: z.number().int(),
  workflowInstanceId: z.string(), definitionVersion: z.string(),
  locale: z.enum(["zh-CN", "en-US"]), domainProfile: z.enum(["product", "learning"]),
  decision: z.string(),
  outcome: z.object({ actor: z.string(), behavior: z.string(), direction: z.enum(["increase", "decrease"]) }),
  planRef: z.object({ planId: z.string(), approvedBy: UserId, approvedAt: z.string().datetime() }),
  sample: z.object({
    planned: z.array(z.object({ stratumId: z.string(), plannedPerStratum: z.number().int(), isNonCompleterStratum: z.boolean() })),
    actual: z.array(z.object({ stratumId: z.string(), participants: z.number().int(),
                               coverage: z.enum(["ok", "thin", "empty"]) })),
    excluded: z.object({ pilot: z.number().int(), consentAiDeclined: z.number().int(),
                         notVisible: z.number().int(), revokedAfterPublish: z.number().int() }),
  }),
  insights: z.array(InsightItem).max(12),
  unanswered: z.array(z.object({ questionId: z.string(),
    why: z.enum(["no_source", "access_denied", "conflicting", "all_irrelevant", "insufficient", "non_completer_stratum_empty"]) })),
  knowledgeConflicts: z.array(z.object({ unitId: z.string(), existingUnitId: z.string(), reason: z.string() })), // = S169 humanReviewItems 原样
  audit: z.object({ verdict: z.enum(["ready", "ready-with-caveats", "needs-more-evidence"]),
                    requiredCaveats: z.array(z.string()), overclaimsFixed: z.number().int() }),
  opportunityMapRef: z.object({ mapId: z.string(), version: z.number().int() }),
  targetDecision: z.object({
    status: z.enum(["accepted", "declined", "not-offered"]),
    oppId: z.string().nullable(),
    decidedBy: UserId.nullable(), decidedAt: z.string().datetime().nullable(),
    s065Status: z.enum(["proposed", "needs-choice", "insufficient-evidence"]),
    rootStatus: z.enum(["anchored", "unanchored"]),
  }),
  limitations: z.array(z.string()).min(1),       // 至少包含抽样渠道和分层覆盖情况
  status: z.enum(["draft", "approved", "published"]),
});
```

Schema 不变量（由 `evals/work-stack/W028/report-check.mjs` 机械校验；该脚本 **proposed-unwired**）：
- R1 每个 `insights[].quotes[].segmentId` 都属于本实例 S009 pack，并且该片段所属参与者在 C3 时点 `ai_analysis = 同意`。
- R2 `insights[].assertion` 不高于 `auditClaimIds` 中任何一条 S171 主张的 `allowedAssertion`，也不高于 S063 final 的 `assertionCeiling`。
- R3 全文不出现 `%`、「百分之」、「大多数」、「普遍」、"most users"、"majority"（与 S065 不变式 8 同一张词表）。
- R4 `targetDecision.status = accepted` ⇒ `decidedBy ≠ null`，`oppId` 属于 `opportunityMapRef` 对应地图的某个 `comparisons[].frontier`，并且存在对应的 G4 receipt。
- R5 `targetDecision.status = not-offered` ⇔ `s065Status ≠ "proposed"` 且 G4 上人没有从 frontier 中做选择。
- R6 `sample.actual` 中存在 `isNonCompleterStratum = true` 且 `coverage = empty` 的层时，这一层服务的每个 RQ 都出现在 `unanswered(why=non_completer_stratum_empty)` 中，并且没有任何 insight 的 `questionId` 指向这些 RQ。
- R7 `audit.verdict = ready-with-caveats` ⇒ `requiredCaveats` 中的每一条都逐字出现在 `limitations` 里。
- R8 `knowledgeConflicts` 与 S169 的 `humanReviewItems` 集合相等（S169 I8 在 Workflow 层的延伸）。

## 7. 终态及其与副作用的对应
| 终态 | 条件 | 必须存在的效果 receipt | 必须**不**存在的效果 |
|---|---|---|---|
| `closed`（`targetDecision.status=accepted`） | G4 接受目标并发布，通知完成 | outline 导入、G1–G4 receipt、`artifact.write`（报告）、每个收件人的 notify receipt 或 skip 记录 | — |
| `closed`（`declined` / `not-offered`） | 报告已发布，但没有选定目标 | 同上，G4 receipt 中 `targetDecision.status ≠ accepted` | 任何 `handoff` 对象 |
| `insufficient_evidence` | S063 没有产出 Finding，或 S171 把全部主张判为 `hypothesis-only` / `omit` | outline 导入、G1–G3 receipt | 报告的 `artifact.write`；产出物只是「研究缺口说明」（RQ × 分层 × S171 `evidenceNeededToUpgrade`），作为实例业务行保存 |
| `no_corpus` | 可用片段为 0 | outline 导入、G1–G3 receipt | 任何 S063 及之后阶段的 receipt |
| `fieldwork_abandoned` | G3 在 60 天内没有关门 | outline 导入、G1、G2 receipt | S009 调用 |
| `plan_rejected` / `plan_blocked` / `clarification_expired` | 见阶段 1–2 | 最多只有 S062 调用 receipt | 任何 write |
| `rejected` | G4 拒绝 | G1–G4 receipt | 报告的 `artifact.write`；草稿保留 30 天用于评测 |
| `cancelled` | 发起人在任一非终态取消 | 取消之前已产生的 receipt 保持不变 | 取消之后不再有新的 write；已经导入的大纲**不回滚**（它属于访谈模块，由人自行处理） |
| `failed` | 不可重试的错误（Skill 版本被撤销且没有兼容版本、项目写权限被撤、组织撤销 W028 授权） | 失败原因码 | — |

不变量 T1：只有 `closed` 可以拥有报告的 `artifact.write` receipt。T2：`closed` 且 `accepted` ⇔ 恰好有一条 G4 receipt 带 `targetDecision.status = accepted`。T3：任何终态下，S065 输出里都不包含 `accepted`（S065 §8）。

## 8. Receipts、幂等与崩溃恢复
统一 receipt 沿用 ADR-118 的形状，也就是现有 `apps/api/src/application/research/guided-workflow-receipt-ports.ts` 的 `begin` / `finalize` 加 `payloadFingerprint`（已核实第 8、19、28 行）。W028 特有的规则：
- **实例幂等键**：`(orgId, initiatorUserId, requestId)`。同一个键但 fingerprint 不同时返回 `IDEMPOTENCY_KEY_REUSED`，不覆盖原实例。
- **大纲导入（阶段 3）**：receipt 键 = `hash(instanceId, planId, planVersion)`。崩溃发生在导入调用和 finalize 之间时，先按 `planId` 查询访谈模块里是否已有带 `sourcePlanId` 的大纲（这个查询字段 **proposed-unwired**），有就补 finalize，没有才重新导入。不允许盲目重复导入，否则会得到两份大纲，人可能确认了错的那份。
- **fieldwork 长等待**：实例只保留 lease 和 G3 截止时间，不持有模型会话。`outline_confirmed` 和 `fieldwork_closed` 是外部事件，按事件 id 去重，同一事件投递两次不会推进两次。
- **S009 pack 复用**：阶段 5 的 receipt 键 = `hash(instanceId, sortedInterviewSourceIds, window)`。崩溃后复用已经 finalize 的 pack，**不重新取数**；同意和权限的变化由 C2′ 处理，而不是靠重新检索。
- **S063 → S169 → S171 链**：每一阶段的输出都以 `instanceId + stageId + attempt` 写进 `workflow_stage_outputs`（ADR-118 通用表，**proposed-unwired**）。S169 的 `unitId` 由内容哈希生成（S169 决策 5），所以只有 S063 的输入变了，S169 的下游引用才会失效。
- **阶段 10 重算**：纯函数，输入是 provisional synthesis 加 S171 报告加 `auditMap`，receipt 里记录模型调用次数必须为 0（与 S063 E16 一致）。重跑得到的结果必须与原结果逐字节相同，否则判为实现错误，不是重试条件。
- **失效传播顺序**：先做 C2′ 重查 → 把受影响的最早阶段标为 stale → 从这一阶段重跑到 12，并**重新走 G4**；G1–G3 不受影响。
- **报告与通知**：`artifact.write` 的键 = `hash(reportId, reportVersion)`；每个收件人的通知键 = `hash(reportId, reportVersion, recipientUserId)`。
- **重试预算**：S062 修订 ≤2 轮；每个 Skill 的结构化输出失败 ≤3 次，次数写在业务行里，崩溃后不清零；S065 在 G4 上 `revise` ≤2 次。
- 能力被拒之后，不得换用同一分类下的其他供应商（例如 `ticket.read` 被拒不能改读另一个工单连接器，这与 S009 E6 同一原则）。

## 9. 失败模式（W028 特有）
| # | 失败 | 发生在哪 | 防线 |
|---|---|---|---|
| F1 | 幸存者洞察：只访谈了完成者，却得出「流失原因」 | S062 → 实际招募 | S062 OUT7 在计划阶段拦截；决策 7 与 R6 在执行后再拦一次 |
| F2 | 试访被计入样本 | G3 → S009 | G3 必须标出试访 id，并在 S009 之前剔除（决策 1） |
| F3 | 拿 provisional 的洞察去排机会 | S063 → S065 | S065 只拿到阶段 10 的 final id（决策 3 第 5 步）；E3 验证 |
| F4 | S169 合并掉矛盾，S171 看不到分歧 | S169 | S169 F1 防线，加上 `auditMap` 覆盖校验（决策 3 第 2 步） |
| F5 | 研究者向自己的学生访谈，结论被关系偏差放大 | learning profile | S062 `recruitmentBias`，加上 G1 第二审批人 |
| F6 | 等待几周期间同意被撤回，却仍被引用 | fieldwork → 发布 | C2、C2′、C3，决策 6 的就地脱敏 |
| F7 | 根立不住，几周研究只换回候选列表 | 入口 | 决策 2 预检 |
| F8 | 站内通知把引文带给无权读项目的人 | 阶段 14 | P4，通知里只放链接 |
| F9 | 一次研究顺手改写了组织权威知识 | S169 | 决策 5：W028 没有回写阶段 |
| F10 | 虚拟访谈或模拟专家回答混进语料 | S009 | S062 决策 4 `evidenceMode = participant`；S009 `excluded.virtualInterview`（UNVERIFIED） |

## 10. CN / US 差异（只列实质性的）
- **录音、转录与 AI 分析的同意**：两地都走同一套四项同意（`consent-item.ts`）。CN 部署下访谈录音和转录属于个人信息处理，G1 的 `consentPlan` 必须写明处理目的与保存期限。语料跨境（例如 `CN+US` 研究由 US 团队分析 CN 受访者）时，G1 需要额外确认数据出境依据；这一项在 W028 里只作为 G1 必填勾选项，具体合规判定不在 Workflow 内完成（**proposed-unwired**：G1 表单字段）。US 部署没有统一的联邦要求，但部分州对录音要求双方同意，所以 `record` 项的 `ifDeclined` 必须给出不录音的继续方式（笔记访谈）。
- **learning profile 下的未成年人**：CN 中小学场景、US K-12 场景的受访者可能是未成年人。W028 规定：`domainProfile = learning` 并且 `targetPopulation` 涉及学生时，G1 必须勾选「监护人同意已单独取得」；W028 不采集和存储监护人信息。US 场景下学生教育记录受 FERPA 约束，S009 读取 `survey-open` 时不得读取成绩字段（本文把它写成 W028 对 `extraSourceKinds` 的限制：learning profile 下禁止 `ticket`，允许 `survey-open`）。
- **激励方式**：CN 常见的是现金红包或购物卡，US 常见的是礼品卡。激励金额和发放记录不进入 W028 的任何业务行（避免把受访者身份与金额关联起来），只在报告的 `limitations` 里写「有 / 无激励」。
- **语言**：`CN+US` 研究的引文保留原语言，报告在 `locale` 语言下附模型译文，并标注「模型翻译」；S063 的编码按原语言进行，不先翻译再编码（避免把同义表达折叠进错误的代码）。

## 11. WorkspaceX 落点（基线 `30c1c4332025151610502988b0379b95ff7298c7`）
已核实存在（`git ls-tree` / `git show`）：
- 访谈执行面：`apps/api/src/application/interview/confirm-outline.ts`（导出 `confirmOutline`）、`draft-booking-invite.ts`、`send-booking-invite.ts`（只允许人类主体，第 4–8、44 行）、`set-rq-coverage-status.ts`（agent 恒拒绝，第 60 行）。
- 同意与阈值：`packages/contracts/src/consent-item.ts`、`packages/contracts/src/thresholds.ts`（第 270 行 `generalizationClaimMinIndependentSubjects`）。
- Receipt 形状：`apps/api/src/application/research/guided-workflow-receipt-ports.ts`。
- 引用校验：`apps/api/src/application/context-pack/verify-citation.ts`（`verifyCitation` 以 `runId` 取 pack，第 41–53 行；绑定 run、不做权限重查。按 workflow stage 取 pack 需要泛化，**proposed-unwired**）。
- 知识图谱：`apps/api/src/application/knowledge-graph/detect-conflicts.ts`、`apply-ontology-batch.ts`（W028 不调用后者，决策 5）。

proposed-unwired 汇总：`apps/api/src/{domain,application,infrastructure}/workflow/`、`workflow-definition.ts`、`workflowAllowlist`、`workflow_stage_outputs`、effect-gateway、`importPlanAsOutline` 与 `sourcePlanId` 查询、`fieldwork_closed` 事件与 G3 表单、G1 multi-gate、`scripts/confidence.mjs`、`report-check.mjs`、`evals/work-stack/W028/`。
UNVERIFIED：RQ 覆盖状态的读端口；S009 中 `permission-filter.ts` 的 `disclose` 与同意派生逻辑（来自未 PASS 的 S009 草稿）。

## 12. 外部参考与溯源（A3：只取控制流模式，不复制文本）
| 来源 | 路径 | commit | 许可证（artifact 级） | 取用 / 不取用 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `design/skills/research-synthesis/SKILL.md`（Output 模板，第 28–72 行）；`design/skills/user-research/SKILL.md` | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（仓库根 `LICENSE`；插件目录下没有单独的 LICENSE） | **反面参照**：该模板在一次综合里同时产出主题、「Insights → Opportunities」的 Impact/Effort 表和「Rough %」的分群规模。W028 把这几步拆开：综合 → 复核 → 机会，并禁止百分比（R3）。reference-only |
| refoundai/lenny-skills | `skills/continuous-discovery/SKILL.md`（「Distinguish needs from solutions」一节，第 21–24 行） | `13598cc54e09399bc1bc1398b0fca284110efb2f` | MIT（仓库根 `LICENSE`，Copyright 2025 Refound AI）；文中引用的第三方访谈言论版权不在此许可内 | 只取原则：机会必须是需求而不是解法，与 S065 B1 一致；W028 本身不重复实现。reference-only，不复制引文 |

两个克隆都位于会话 scratchpad 的 `upstream/` 下，不入库，也不进入 `provenance[].copied`。

## 13. 评测（`evals/work-stack/W028/`，proposed-unwired；夹具均为合成数据，确定性 case 跑回环模型）
基线（ADR-119 G5）：把同一个 decision 加访谈转录直接交给一个只挂 S063 的通用 Agent，一次性产出洞察。

| # | 输入（fixture） | 通过判据 |
|---|---|---|
| E1 | D043 发起，decision「是否把报表导出改为异步邮件交付」，outcome `{actor:"团队管理员", behavior:"每周导出一次报表", direction:"increase"}`；10 场访谈，其中 2 场是试访 | S009 pack 中没有 G3 标出的 2 个试访 id；`sample.excluded.pilot = 2`；所有 insight 的 `prevalence.of ≤ 8` |
| E2 | S062 计划含反幸存者层 S2「尝试过但未完成导出」，实际招到 0 人 | `sample.actual` 中 S2 为 `empty`；S2 服务的 RQ 全部出现在 `unanswered(why=non_completer_stratum_empty)`；没有 insight 指向这些 RQ（R6） |
| E3 | S063 输出某主题 confidence=medium、`status=provisional`；在 S065 调用参数上打桩 | S065 收到的 `synthesisRefs` 只包含阶段 10 的新 id，并且该 synthesis 的 `status=final`；provisional id 不出现在任何 S065 输入中 |
| E4 | S169 把 F2「导出太慢」与 F5「导出很快但格式错」合并成一条主张 | `auditMap` 覆盖校验通过的前提是两者没有被合并到同一个 proposition 下（S169 步骤 4：结论不同必须拆开）；如果桩注入了错误的合并，W028 判 S169 输出不合规并重试；3 次后 `failed` |
| E5 | 同一个 Finding 被两条合并主张覆盖，S171 分别给 `likely` 和 `preliminary` | 对应 insight 的 `assertion = preliminary`（决策 3 第 4 步，取最严）；阶段 10 的模型调用次数为 0 |
| E6 | 发布前 C3：参与者 P4 撤回 `ai_analysis`；P4 是 I3 唯一一条引文的来源 | I3 失去全部引文 → 回到阶段 10 并重走 G4；未经重新批准的报告不会被发布 |
| E7 | 发布后参与者 P1 撤回同意 | 报告中 P1 的引文替换为「[已撤回]」，`prevalence` 重算，`sample.excluded.revokedAfterPublish = 1`；写入 `consent_redaction` 事件；已接受的 `targetDecision` 保持不变，但确认人收到站内通知 |
| E8 | trigger `outcome = {actor:"用户", behavior:"更好", direction:"increase"}` | 拒绝启动，返回 `W028_OUTCOME_UNANCHORED`；没有 S062 调用 receipt |
| E9 | D047 发起，`domainProfile=learning`，channels 含 `own-students` | G1 需要两位审批人，发起人自己审批两次被拒；S062 输出 `recruitmentBias` 非空；learning profile 下请求 `extraSourceKinds=["ticket"]` 被拒 |
| E10 | S169 输出一条 `contradicts-existing`（新发现「管理员不在乎格式」与组织知识单元 K12「格式是首要诉求」冲突） | 报告 `knowledgeConflicts` 含该条（R8）；本实例没有任何 `applyOntologyBatch` 调用；K12 的状态不变 |
| E11 | S065 返回 `needs-choice`，frontier = {O2, O4}；人在 G4 选 O3（被 O2 支配） | 门拒绝，理由为「被支配节点」；人改选 O4 → `targetDecision = {status:"accepted", oppId:"O4", decidedBy:<人>}`（R4） |
| E12 | 崩溃注入：阶段 3 导入调用已经返回，但 finalize 之前进程被杀 | 恢复后按 `sourcePlanId` 查到已有大纲，补 finalize；访谈模块里只有 1 份大纲 |
| E13 | G3 在 60 天内没有关门 | 终态 `fieldwork_abandoned`；没有 S009 调用；没有报告 write |
| E14 | `reportAudience=[U2, U3]`，U3 对 `studyProjectId` 没有读权限 | U2 收到的通知只含报告链接、不含任何引文；U3 记入 `notifySkipped`；终态仍然是 `closed` |
| E15 | S063 的草稿 claim 写「管理员都讨厌同步导出」，S171 给 `overclaim.allowed = preliminary` | 报告里对应 insight `assertion = preliminary`；全文不含「都」「大多数」「%」（R3）；`audit.overclaimsFixed ≥ 1` |
| E16 | `CN+US` 研究，引文里有中文和英文 | 引文保留原文，附模型译文并标注；S171 收到的 `jurisdiction = other` |
| E17 | 同一 requestId、同一 payload 重放；再用同一 requestId 改 decision 重放 | 前者返回同一个实例、没有新增 receipt；后者返回 `IDEMPOTENCY_KEY_REUSED` |

G5 对比判据：在 E2、E3、E5、E10、E15 上，基线至少失败 3 条而 W028 全部通过，W028 才能标 verified。

## 14. Graph change proposals（只提议，不改矩阵，不假定采纳）
1. **W028 缺 S064**（回应 S065 §14 提议 2）：本文用「trigger 必填 outcome + 入口预检」处理（决策 2），矩阵不动。可以考虑的替代方案是在 S171 之后、S065 之前加入 S064。加入后根可以由证据支撑的问题框定产生，而不是由发起人一句话给出，代价是 W028 与 W029 的职责边界会变模糊。交矩阵 owner 裁决。
2. **learning profile 与 S063 / S065 的适配**：S063 没有 `learning` domainProfile（W028 暂时映射到 `general`），S065 的机会树面向产品 outcome。D026 和 D047 通过 W028 使用这条链时，报告会用产品化的语言描述学习问题。这里呼应 S062 §14 提议 2：是否需要一条学习设计专用的研究 Workflow，或者给 S063 加 `learning` profile，由 D026/D047 作者与矩阵 owner 评估。
3. **研究结论回写组织知识的归属**（决策 5）：S169 的 `humanReviewItems` 经人确认后如何走 `applyOntologyBatch`，目前没有任何 Workflow 承担。建议由 W006 Knowledge Capture Loop 的作者评估是否接收 W028 报告中的 `knowledgeConflicts` 作为输入。
4. **S062 → S009 抽样口径接缝**（S062 §14 提议 1）：W028 暂时把 S009 无法表达的行为判别条件写进 `limitations`，并由 G3 的人工分层映射兜底。S009 通过评审后，本文阶段 5 的映射需要重新核对。

## 15. 未决问题
- S009 还没有 PASS，阶段 5、C2 和 E1 中对 S009 字段的引用都依赖草稿，S009 定稿后需要重新核对。
- `fieldwork` 60 天上限、S062 修订 2 轮、G4 revise 2 次这三个数值还没有经过历史研究回测。
- 能力分类名（`transcript.read`、`interview.outline.write`、`notify.inapp` 等）要等 ADR-120 分类表定稿。
- 发布后撤回同意时，已经进入 W029 PRD 的引用如何处理，不在 W028 范围内，需要 W029 作者声明。
