# S012 — Decision Brief（决策简报）

> Type: Work Skill · Domain: Shared · Strategy: A1（MADR + kwp `architecture` 两份上游择优改编，另以公开方法名作参照）· 目标通道：candidate → verified（ADR-119 G5）
> 基线：`main@30c1c4332025151610502988b0379b95ff7298c7`。工作树是包含该提交的 merge（`git merge-base --is-ancestor 30c1c433… HEAD` 已确认）。标 **VERIFIED@30c1…** 的路径都用 `git show 30c1c433…:<path>` 读过。
> 注意：`docs/adr/ADR-116..121` **不在** `30c1…` 上（`git show 30c1…:docs/adr/ADR-118-generic-workflow-runtime.md` 报 not in commit），只存在于本工作分支，状态均为 `Proposed`。本文引用这些 ADR 时标 **ADR-Proposed**。它们描述的 `WorkSkillManifest`、`effect-gateway`、Workflow runtime、`capabilityCategory` 目前都是 **proposed-unwired**。
> 标注约定：**UNVERIFIED** = 没读过实现，只是推断；**proposed-unwired** = 能力或契约目前不存在或没接线，本文是提案。
> 本文独立作者化（AUTHOR-S012）。v1 模板（`origin/requirements/work-stack-320-v1:requirements/work-stack-v1/skills/S012-decision-brief.md`）只当话题清单，没有沿用正文。

## 1. 这个 Skill 解决什么问题
S012 回答的问题是：**「谁要在什么时候、在哪几个互斥方案之间做一个什么样的选择，每个方案凭什么证据好或不好，如果现在就要拍板我们建议哪个、有多大把握，什么信息会改变这个建议」**。产出是一份 `DecisionBrief`，交给**有权做决定的人**。

S012 的产出是「请求做决定」，不是「决定」。边界如下：
- 不找证据（S003），不给证据分级（S171），不写综述（S063）。S012 只**消费** S171 的 `certainty` / `allowedAssertion` 和 S063 的 `findings`，自己不重新打分。
- 不做风险登记。每个方案的下行面由 S010 负责；S012 只列「会改变建议的关键假设」（§4 步骤 6）。两者的差别是：S010 问「会怎么出错」，S012 问「知道什么会让我们改选」。
- 不拆执行计划。选定方案之后的计划由 S154 Execution Plan 负责（W003 的下一阶段）。
- **不记录决定。** 输出里 `decisionStatus` 恒为 `awaiting-decision`。把决定写进项目记忆，是人通过现有的「采纳为项目决策」入口完成的（决策 4）。
- 不写对外披露或董事会决议文本。那类文本由 S020 或法务 Skill 负责。

## 2. 图上的消费者（两张矩阵逐行照抄，不推导）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
| 行 | Workflow | 矩阵原文（Exact Skills） | S012 的位置 | S012 的 `mode` |
|---|---|---|---|---|
| 9 | W003 Decision-to-Execution | S012, S154, S142, S010, S143 | **第一个**。上游没有 S171/S063，下游是 S154 | `framing-first` |
| 15 | W009 Evidence-to-Recommendation | S003, S171, S063, S012, S010 | 在 S063 **之后**、S010 **之前** | `evidence-backed` |

W009 已 PASS（`workflows/W009-evidence-to-recommendation.md`），其 §13 第 1 条确认了上表 W009 行的 `evidence-backed` 语义与阶段顺序 S003→S171→S063→S012→S010→S012，该行**已确认**。W003 仍无文档，W003 行仍是本文按矩阵顺序给出的**预期**，待 W003 作者确认。已 PASS 的 S063（§2.1 W009 行）把 W009 里 S063 的下游写成 S012，与本文一致。

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md，S012 都在 Skill 列）
- D001 Executive / Strategy Partner（第 7 行）——**第一阶段闭包内**
- D014 Business Process Reengineering Expert（第 20 行）
- D017 Decision Science Expert（第 23 行）
- D049 Business Analyst（第 55 行）

按 ADR-118 第 9 条（ADR-Proposed，工作树 `docs/adr/ADR-118-generic-workflow-runtime.md:26`），DigitalHuman 行里的 S012 表示**可以在聊天中直接调用**；Workflow 阶段内的 S012 版本由 Workflow 固定，不经 Agent 挂载。所以 D007（W003 的拥有者之一，Skill 列没有 S012）在 W003 里照样能用 S012，不算缺边。

各角色的差异只体现在 `briefProfile` 的缺省值上，Skill 本身不复制：
- D001 → `executive`：一页正文，强制给出 `recommendation`（除非触发 §4 步骤 7 的上限）。
- D017 → `decision-science`：必须输出 `sensitivity`，权重缺失时返回 `S012_NEEDS_FRAMING`，不用等权凑数。
- D014 → `process-change`：`options` 必须含「现流程保持不变」基线，`criteria` 缺省含 `transition-cost`。
- D049 → `requirements`：`hardConstraints` 必须逐条可追溯到需求 id。输入里 `requirementRef` 仍是可选字段（不因缺它报错），但缺 `requirementRef`（且不是 `source = regulation`）的约束**不进入步骤 3 的淘汰**，而是降级为普通准则，记入输出 `demotedConstraints[]`（`reason: "no-requirement-ref"`），见 O-14 与 E19。

## 3. 上游来源与许可（G1）
本地克隆位于 `/tmp/claude-0/-home-user-workspacex/73cf4d09-4f20-5254-be5a-96afdef9f330/scratchpad/upstream/<name>`。

| 源 | 精确路径 | commit | artifact 级许可 | 用法 |
|---|---|---|---|---|
| adr/madr（`upstream/madr`） | `template/adr-template.md`：`## Decision Drivers`（:17）、`## Considered Options`（:23）、`### Confirmation`（:42）、`## Pros and Cons of the Options`（:47）；frontmatter `status`（:3） | `ba75bb1b20d42af5746b246ad348c202419ae681` | `MIT OR CC0-1.0`（仓根 `LICENSE`；`LICENSE.MIT` 署名 Copyright (c) 2017-2022 Oliver Kopp, Olaf Zimmermann） | **adapt**：用「准则先于方案」「逐方案列 Good/Neutral/Bad」「Confirmation = 事后如何确认决定被执行且有效」三点。Confirmation 对应本文的 `reviewTrigger`。采用 CC0 分支，不需要署名，但仍在 `references/upstream.md` 记来源。**不采用**它的 `status: accepted` 可以由作者填写（决策 4） |
| anthropics/knowledge-work-plugins（`upstream/kwp`） | `engineering/skills/architecture/SKILL.md`：`**Deciders:**`（:34）、`## Options Considered`（:42，方案 × 维度表）、`## Trade-off Analysis`（:58）、`## Consequences`（:61，变容易/变难/要回看） | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0。`engineering/` 下**没有**单独的 LICENSE（已 `ls` 确认），适用仓根 `LICENSE` | **adapt**：用「方案 × 维度评估表」和「后果分成变容易/变难/需回看」。**拒绝**它 Options 表里 `Low/Med/High` 格子不需要依据的写法（§4 步骤 4 要求每格都挂依据）。按 Apache-2.0 §4 记 NOTICE，不复制原文 |
| refoundai/lenny-skills（`upstream/lenny-skills`） | `skills/high-stakes-decisions/SKILL.md`（:14「one-way or two-way door」、:72 可逆性提问） | `13598cc54e09399bc1bc1398b0fca284110efb2f` | 仓根 `LICENSE` 为 MIT（Copyright (c) 2025 Refound AI）。但正文大量是**播客嘉宾的原话引用**，这些引文的著作权不属于 Refound AI，MIT 不能覆盖 | **reference-only**：只取「按撤销成本给决定分档」这一公共概念，用于 §4 步骤 1 的 `reversibility`。**不复制任何引文**，也不采用它「70% 信息就拍板」的经验法则（被 §4 步骤 7 的显式上限表取代） |
| Kepner-Tregoe 决策分析（公开方法名） | 以方法名引用：MUST（硬约束，淘汰）与 WANT（加权准则，比较）分离 | n/a | 方法本身不受版权保护；**不引用**其培训教材文本 | 只借用「硬约束淘汰、不参与打分」的结构（§4 步骤 3） |

两份仓库上游的共同缺陷：都假设作者手里的每条判断都同样可信，**没有「这一格判断依据的证据有多强」**。WorkspaceX 有已 PASS 的 S171 证据分级，所以 S012 规定：每一格判断必须挂靠 S171 claim、S063 finding、显式假设或未知项之一（步骤 4）；建议强度受这些依据的最低确定性约束（步骤 7）。这一点比两个上游都严格。

## 4. 专业方法（S012 专属步骤）
1. **把请求改写成可决定的问题。** 输出 `decisionQuestion`，它必须是「在 X 与 Y（与 Z）之间选一个」或「是否做 X」的形式，并写明：
   - `decisionDeadline`：最晚决定日期，以及晚于该日的 `costOfDelay`（晚一周/一月会失去什么，没有就写「无显著延迟成本」，不能留空）；
   - `reversibility`：`reversible`（一周内、低成本可撤销）/ `costly-to-reverse` / `irreversible`，并给一句理由（例如「签约后 36 个月不可退出」）；
   - `decisionScope`：这个决定**不**包括什么（例如「只决定是否进入华东，不决定定价」）。
   如果请求本身不是一个选择（例如「帮我看看这个市场怎么样」），不硬造问题，返回 `S012_NOT_A_DECISION`，并附一句建议改用 S063 或 S020。
2. **构造互斥的方案集。**
   - 必须包含一个**基线方案**（`isBaseline: true`，即「不做 / 维持现状」），且写出基线本身的成本。不写基线，所有方案都会显得比「什么都不做」好。
   - 最终进入比较的方案 **2–3 个**（含基线），和已签核的 `choose_execution_option` 卡片上限一致（决策 2）。输入超过 3 个时先做筛选：违反硬约束的淘汰，被其他方案在所有准则上支配（dominated）的淘汰。其余的由人合并，或者返回 `S012_TOO_MANY_OPTIONS`，附上筛选后的候选，不由模型私自砍掉。所有被淘汰的方案进 `screenedOut[]`，写明淘汰依据。
   - 互斥检查：两个方案可以同时做时（例如「降价」与「加渠道」），要么合成组合方案，要么返回 `S012_OPTIONS_NOT_EXCLUSIVE`。
   - 模型自己补的方案标 `origin: "skill-proposed"`，而且不能成为推荐方案（F7）。
3. **把硬约束与比较准则分开。**
   - `hardConstraints[]`：违反即淘汰，不参与比较（例如「预算 ≤ 200 万」「必须在 2026-12-31 前满足数据出境评估」）。每条约束都要写出**来源**：来自输入（`source: "input"`），来自服务端组织策略（`source: "org-policy"`，proposed-unwired，见 §6），或者来自法规（`source: "regulation"`，写出法规名）。
   - `criteria[]`：用来比较的准则，2–6 条，每条写清「越大越好」还是「越小越好」，以及怎么度量。
   - 权重只能来自输入，并且带 `weightsSource: "decision-owner" | "caller-stated"`。缺权重时 `weightsSource: "none"`，**不用等权凑数**（决策 1）。
4. **逐格评估，每格挂依据。** 对「方案 × 准则」的每一格给出 `rating ∈ {better, same, worse, unknown}`（相对基线），外加 `basis`，取值四选一：
   - `claim`：S171 的 `claimId`。该主张的 `allowedAssertion = omit`（含 `certainty = insufficient`）时**不得**作为依据（对应 S171 评测 E13）；W009 证据门规则 1 另要求不得在 S171 `unverifiedAssertions` 中——按 S171 E11 这些条目均已是 omit，故为同一约束的冗余表述，不是新增条件；
   - `finding`：S063 的 `findingId`；
   - `assumption`：指向 `assumptions[]` 的 id，是一条显式写出、可证伪的假设；
   - `unknown`：rating 必须是 `unknown`。
   同一格的依据如果来自 S171，措辞不得超过该 claim 的 `allowedAssertion`（例如 `preliminary` 只能写「有迹象」）。
5. **比较：支配关系 + 翻转点，不给综合分。**
   - 先找支配关系：某方案在所有准则上都不差于另一方案、且至少一条更好，就是支配。
   - 有权重时，计算每条准则的**翻转点**（`flipPoint`）：权重变化多少，第一名会换人。翻转点小于 ±10 个百分点的准则标 `fragile: true`。
   - 没有权重、又不存在支配关系时，`comparison.result = "trade-off"`，写出「A 在 X 上更好、B 在 Y 上更好，取决于你更看重哪个」，不给出第一名。
   - 数值计算经 `sandbox.exec` 跑确定性脚本 `scripts/flip-points.mjs`（proposed-unwired）；未授权时标 `sensitivityComputed: false`，在 `limitations` 里说明，不让模型心算翻转点。
6. **列出会改变建议的信息。** 找出**承重假设**（`loadBearing: true`）：只要它为假，推荐就会换成别的方案。每条写：
   - `ifFalse`：换成哪个方案；
   - `howToTest`：能在决定日期之前拿到的检验手段和成本；
   - `worthWaiting`：检验的时间和成本是否小于 `costOfDelay`。这一条就是信息价值（value of information）的定性判断。
   承重假设中如果有 `worthWaiting: true` 的，推荐类型取 `min(ceiling, defer-for-information)`：上限表给出 `no-recommendation` 时仍是 `no-recommendation`，否则是 `defer-for-information`（O-9；强弱顺序见 O-6）。
7. **给建议，强度受上限表约束。** `recommendation.kind ∈ {recommend, recommend-conditional, defer-for-information, no-recommendation}`。上限由 `reversibility` 与「推荐方案所依赖的承重依据中的最低确定性」共同决定：

   | 承重依据最低确定性 \ reversibility | reversible | costly-to-reverse | irreversible |
   |---|---|---|---|
   | high / moderate | recommend | recommend | recommend |
   | low | recommend | recommend-conditional | recommend-conditional |
   | very-low / 仅 assumption | recommend-conditional | recommend-conditional | defer-for-information |
   | 存在 `unknown` 承重格 | recommend-conditional | defer-for-information | no-recommendation |

   每格只有一个值，`scripts/ceiling.mjs` 是这张表的纯函数实现（原稿「defer 或 no-recommendation」一格不可判定，已收敛为 `defer-for-information`）。上限给出 `no-recommendation` 时，框架可以是完整的：此时 `status` 仍是 `ready` 或 `provisional-pending-risk`，不是 `needs-framing`（O-1）。
   `framing-first` 模式下没有 S171 输入，所有 `finding`/`assumption` 依据按「仅 assumption」一行处理（决策 6）。`recommend-conditional` 必须写出条件本身（「前提是 A1 成立；若 2026-11-15 前试点转化率 <3%，改选 B」）。
8. **为次优方案写最强论证。** `strongestCaseAgainst`：用同样的依据纪律，给出支持次优方案的最强理由。这一步的目的是防止简报变成事后论证（F3）。
9. **写决定请求。**
   - `decisionRequest.ask`：一句话，写明请决定人批准什么；
   - `decisionOwner`：只能是服务端解析出的 userId；解析不出时 `ownerNeeded: true`（§6）；
   - 每个方案写 `reviewTrigger`：选了它以后，什么可观察指标在什么日期越过什么阈值，就该回来重审（对应 MADR 的 Confirmation）；
   - `decisionStatus` 恒为 `awaiting-decision`。
10. **W003 交接（仅在人选定之后）。** 人通过 `choose_execution_option` 选定方案后，Workflow 用 `selectedOptionId` 再调一次 S012（`mode: "handoff"`），产出 `ExecutionHandoff`：选中方案、它的 `reviewTrigger`、`killCriteria`、它依赖的承重假设，交给 S154。S012 自己不能产生 `selectedOptionId`。

## 5. 输入契约（`inputSchema`；写入 WorkSkillManifest，manifest 本身是 proposed-unwired，ADR-117 ADR-Proposed）
```ts
const OptionIn = z.object({
  optionId: z.string().min(1).max(40),
  title: z.string().min(1).max(80),
  description: z.string().max(600).optional(),
  isBaseline: z.boolean().default(false),
});

const S012Input = z.object({
  mode: z.enum(["evidence-backed", "framing-first", "handoff"]),
  request: z.string().min(1).max(2000),                 // 用户或上一阶段给出的原始决策请求
  options: z.array(OptionIn).max(8).default([]),        // 可以为空：此时只做步骤 1–3 并返回 needs-framing
  criteria: z.array(z.object({
    criterionId: z.string(), label: z.string().max(60),
    direction: z.enum(["higher-better", "lower-better"]),
    measure: z.string().max(200).optional(),
    weight: z.number().min(0).max(1).optional(),
  })).max(6).default([]),
  weightsSource: z.enum(["decision-owner", "caller-stated", "none"]).default("none"),
  hardConstraints: z.array(z.object({
    constraintId: z.string(), text: z.string().max(200),
    source: z.enum(["input", "regulation"]),            // "org-policy" 只能由服务端注入，不接受调用方传入
    regulationRef: z.string().optional(),
    requirementRef: z.string().optional(),              // 可选；briefProfile=requirements 时缺它的非 regulation 约束降级为准则（O-14），不报错
  })).default([]),
  // evidence-backed 必填；framing-first 禁止（见不变量 I-in-2）
  evidenceReviewReportId: z.string().optional(),        // S171 EvidenceReviewReport 的承载行 id：S171 §6 报告本身无 id 字段，取 ADR-118 stage 输出行 id（W009 §13 提议 2；proposed-unwired）
  researchSynthesisId: z.string().optional(),           // S063 ResearchSynthesis
  riskAssessmentId: z.string().optional(),              // S010 RiskAssessment；W009 首跑时不存在（决策 5）
  revisionOf: z.string().optional(),                    // 上一版 DecisionBrief id
  selectedOptionId: z.string().optional(),              // 仅 handoff；来自已解决的 choose_execution_option 中断
  decisionDeadline: z.string().date().optional(),
  projectId: z.string().optional(),
  jurisdictions: z.array(z.enum(["CN", "US"])).min(1).default(["CN"]),
  locale: z.enum(["zh-CN", "en-US"]).default("zh-CN"),
  briefProfile: z.enum(["executive", "decision-science", "process-change", "requirements"]).optional(), // 缺省取 DigitalHuman 映射，再缺省 executive
  // ——以下是调用方「声明」，服务端不信任，见 §6——
  claimedDecisionOwnerUserId: z.string().optional(),
  claimedAudienceUserIds: z.array(z.string()).max(50).optional(),
  claimedGovernanceBody: z.enum(["individual", "committee", "board", "party-committee-collective"]).optional(),
}).strict();
```
输入不变量（在 zod `superRefine` 里实现，违反即返回对应 typed error）：
- I-in-1：`mode = evidence-backed` ⇒ `evidenceReviewReportId` 与 `researchSynthesisId` **都要有**（W009 里 S171 与 S063 都在 S012 之前）。缺任一个 → `S012_UPSTREAM_MISSING`。
- I-in-2：`mode = framing-first` ⇒ 不得传 `evidenceReviewReportId`。有 S171 报告就应该走 `evidence-backed`，防止上游有分级却被当成「仅 assumption」处理。违反 → `S012_MODE_MISMATCH`。
- I-in-3：`mode = handoff` ⇒ `revisionOf` 与 `selectedOptionId` 必填，且 `selectedOptionId ∈ revisionOf.options[].optionId`，并且不在 `screenedOut` 中。违反 → `S012_SELECTED_OPTION_NOT_FOUND`。
- I-in-4：`options[].isBaseline = true` 最多 1 个；`optionId` 唯一。
- I-in-5：`weightsSource ≠ none` ⇒ 所有 criteria 都有 weight，且权重之和 ∈ [0.99, 1.01]。否则 → `S012_WEIGHTS_INVALID`。`weightsSource = none` ⇒ 所有 weight 都未设置。
- I-in-6：`briefProfile = decision-science`（D017）且 `weightsSource = none` → 返回 `status: "needs-framing"`，缺失项里列出 `weights`。
- I-in-7：`hardConstraints[].source = regulation` ⇒ `regulationRef` 非空。

**欠定输入的处理规则**（区分「报错」和「需要补框架」）：
| 情形 | 结果 | 理由 |
|---|---|---|
| `request` 不是选择 | 错误 `S012_NOT_A_DECISION` | 没有可决定的对象，继续只会编造 |
| 可比较的方案少于 2 个（包括只剩基线） | `status: "needs-framing"`，`framingGaps` 含 `options`，并附最多 3 个 `skill-proposed` 候选供人挑 | 方案可以由人补齐，不算调用错误 |
| `criteria` 为空 | `needs-framing`，`framingGaps` 含 `criteria`，附从 S063 finding 抽出的候选准则 | 同上 |
| 方案不互斥 | 错误 `S012_OPTIONS_NOT_EXCLUSIVE`，附出问题的方案对 | 比较无意义 |
| 筛选后仍多于 3 个 | 错误 `S012_TOO_MANY_OPTIONS`，附筛选结果 | 由人合并，不由模型砍 |
| 缺 `decisionDeadline` | 正常产出，`costOfDelay` 写「未给期限」，`worthWaiting` 一律为 `null` | 期限缺失会让信息价值判断失效，所以不猜 |

## 6. 服务端授权边界（调用方声明 vs 服务端核实）
S012 自己**只读、不写**，但它的产出会被转给一群人看，并且会指名「由谁决定」。所以要核实的是**身份、可见性和决策权**，而不是写权限。

| 事实 | 调用方可以声明 | 服务端以什么为准 | 现状 |
|---|---|---|---|
| 执行身份 | 不接受输入 | Agent run 的 actor（人或 DigitalHuman 的委托主体） | run 身份机制存在；S012 的接入 **proposed-unwired** |
| 项目可读 | `projectId` | `authorize(…, { object: { kind: "project" }, action: "read.published" })`，和 `adoptProjectDecision` 用的是同一个判定（VERIFIED@30c1… `apps/api/src/application/knowledge-graph/adopt-project-decision.ts`、`apps/api/src/application/identity/authorize.ts`）。不可读 → `S012_SUBJECT_NOT_READABLE` | 判定函数存在；S012 调用 proposed-unwired |
| 上游产物可读 | `evidenceReviewReportId`、`researchSynthesisId`、`riskAssessmentId` | 以 actor 身份重读（`evidenceReviewReportId` 指 ADR-118 stage 输出行 id，按该行取回 S171 报告，见 §5 注释；proposed-unwired）。S003 决策 1 规定：跨越人类门或超过 TTL 时，被引用的命中必须经 `apps/api/src/application/context-pack/verify-citation.ts` 重验（VERIFIED@30c1… 文件存在；在 Workflow 中如何接线 UNVERIFIED）。重验失败的依据从格子里移除，该格改为 `unknown`，并在 `omittedBasis[]` 里记原因 | S171/S063/S010 产物的存储本身是 proposed-unwired |
| 决定人 | `claimedDecisionOwnerUserId` | 必须是该项目的成员，并且 `projectRole ≠ observer`。这条规则和 `adoptProjectDecision` 的 `requireProjectDecider` 一致（观察者会得到 `KG_NOT_OWNER`，VERIFIED@30c1…）。`projectRole` 枚举是 `facilitator/groupLead/member/observer`（VERIFIED@30c1… `packages/contracts/src/project.ts:410`）。不满足 → 不报错，改写 `decisionOwner: null, ownerNeeded: true`，并在 `authorityNotes` 里写原因 | 成员判定存在；把它用于 S012 是 proposed-unwired |
| 决策权限（金额/事项分级） | `claimedGovernanceBody` | 组织的授权矩阵（delegation of authority）。**仓库里没有**：在基线上 `git grep -iE "delegationOfAuthority\|decisionRights\|approvalMatrix\|decision_rights\|DecisionAuthority" -- apps packages` 零命中 | **proposed-unwired**。缺失时 `governanceBody` 取调用方声明，但标 `governanceSource: "caller-claimed-unverified"`。它只影响简报的写法（§9），**不能**放宽步骤 7 的建议上限 |
| 受众可见性（脱敏） | `claimedAudienceUserIds` | 服务端对**每个受众**逐条检查依据的来源是否可读（`permission-filter.ts` 的 `discloseDecided`，VERIFIED@30c1… 文件存在；逐受众批量判定的做法 UNVERIFIED）。任何一个受众读不到的依据：该格的 `basis` 改写为 `{ kind: "withheld", reason: "unauthorized" }`，`rating` 保留，并在 `omittedBasis[]` 用 `OMISSION_REASONS` 的 `unauthorized` 键（VERIFIED@30c1… `packages/contracts/src/omission-reason.ts`，封闭枚举，不新增键） | **proposed-unwired**。服务端判定不可用时 fail-closed：返回 `S012_AUTHZ_UNAVAILABLE`，不发出未脱敏的版本 |
| 硬约束来自组织策略 | 不接受（输入 schema 里的 `source` 不含 `org-policy`） | 服务端注入 | **proposed-unwired**，没有存储 |
| 选定方案 | 不接受模型产生的值 | `selectedOptionId` 只取自已解决的 `choose_execution_option` 中断。其 decision 形状是 `ChooseOptionDecision`（`edit` 带 `selectedOptionId`，或 `reject`），错误码有 `SELECTED_OPTION_NOT_FOUND`（VERIFIED@30c1… `packages/contracts/src/agent-interrupts.ts`；校验在 `apps/api/src/application/agent-run/validate-interrupt-decision.ts`，文件存在） | 中断机制存在；W003 用它承接 S012 是 proposed-unwired |

**不变量（授权）**
- A-1：调用方声明的字段不会原样出现在输出的「已核实」字段里。`decisionOwner` 只能来自服务端核实，声明值只进 `authorityNotes`。
- A-2：脱敏发生在服务端，并且在输出离开 Skill 运行边界之前完成。不允许「先生成全文、由前端隐藏」。
- A-3：授权判定失败或不可用时，一律 fail-closed（`S012_AUTHZ_UNAVAILABLE`），不降级为「按调用方身份展示」。
- A-4：同一份简报对不同受众集合要分别生成版本（`audienceDigest` 不同）。不允许把一个受众集合的版本转给更大的集合。

## 7. 输出契约（`outputSchema`，S012 专属）
```ts
type Certainty = "high" | "moderate" | "low" | "very-low" | "insufficient";   // 与 S171 同枚举，不另定义

DecisionBrief = {
  briefId: string;
  mode: "evidence-backed" | "framing-first";
  status: "ready" | "provisional-pending-risk" | "needs-framing";
  briefProfile: "executive" | "decision-science" | "process-change" | "requirements";
  profileSource: "input" | "digital-human-default" | "fallback";
  revisionOf?: string;
  decisionQuestion: string;                                // ≤200 字，形如「在 A 与 B 之间选」或「是否 X」
  decisionScope: { includes: string; excludes: string };
  decisionDeadline: string | null;
  costOfDelay: string;                                     // 非空；无期限时写「未给期限」
  reversibility: { level: "reversible" | "costly-to-reverse" | "irreversible"; reason: string };
  governanceBody: "individual" | "committee" | "board" | "party-committee-collective";
  governanceSource: "org-policy" | "caller-claimed-unverified" | "default-individual";
  framingGaps: Array<"options" | "criteria" | "weights" | "deadline">;   // status=needs-framing 时非空
  hardConstraints: Array<{ constraintId: string; text: string; source: "input" | "org-policy" | "regulation"; regulationRef?: string; requirementRef?: string }>;
  demotedConstraints: Array<{ constraintId: string; asCriterionId: string; reason: "no-requirement-ref" }>;   // 仅 briefProfile=requirements 可能非空
  criteria: Array<{ criterionId: string; label: string; direction: "higher-better" | "lower-better"; measure?: string; weight?: number }>;
  weightsSource: "decision-owner" | "caller-stated" | "none";
  options: Array<{                                         // 2–3 个
    optionId: string; title: string; isBaseline: boolean;
    origin: "input" | "skill-proposed";
    baselineCost?: string;                                 // isBaseline=true 时必填
    constraintCheck: Array<{ constraintId: string; satisfied: true | "unknown" }>;   // 违反的方案不会出现在这里，只会在 screenedOut
    cells: Array<{
      criterionId: string;
      rating: "better" | "same" | "worse" | "unknown";     // 相对基线；基线自己恒为 same
      basis:
        | { kind: "claim"; claimId: string; certainty: Exclude<Certainty, "insufficient">; allowedAssertion: "state" | "likely" | "preliminary" | "hypothesis-only" }
        | { kind: "finding"; findingId: string; confidence: "high" | "medium" | "low" }
        | { kind: "assumption"; assumptionId: string }
        | { kind: "unknown" }
        | { kind: "withheld"; reason: "unauthorized" };
      note: string;                                        // ≤160 字；措辞不得超过 allowedAssertion
    }>;
    reviewTrigger: { metric: string; threshold: string; checkBy: string };   // 选了它之后何时回看
    killCriteria?: string;
  }>;
  screenedOut: Array<{ optionId: string; title: string; reason: "violates-constraint" | "dominated" | "not-exclusive-merged"; detail: string }>;
  comparison: {
    result: "dominance" | "weighted-leader" | "trade-off";
    dominance: Array<{ dominant: string; dominated: string }>;
    sensitivity?: Array<{ criterionId: string; flipPoint: number | null; fragile: boolean }>;   // 仅 weightsSource≠none
    sensitivityComputed: boolean;
    tradeOffStatement?: string;                            // result=trade-off 时必填
  };
  assumptions: Array<{
    assumptionId: string; text: string; loadBearing: boolean;
    ifFalse?: string;                                      // loadBearing=true 时必填：改选哪个 optionId
    howToTest?: string; testCostOrTime?: string;
    worthWaiting: boolean | null;                          // 无 decisionDeadline 时为 null
  }>;
  recommendation: {
    kind: "recommend" | "recommend-conditional" | "defer-for-information" | "no-recommendation";
    optionId: string | null;                               // kind ∈ {recommend, recommend-conditional} 时非空
    condition?: string;                                    // recommend-conditional 必填
    ceilingApplied: { minLoadBearingCertainty: Certainty | "assumption-only" | "unknown-present"; reversibility: string; maxAllowedKind: string };
    rationale: string;                                     // ≤400 字
  };
  strongestCaseAgainst: { optionId: string; argument: string } | null;   // 有推荐时必填
  riskHandoff: { riskAssessmentId: string | null; pending: boolean };    // W009 首跑 pending=true（决策 5）
  decisionRequest: {
    ask: string;                                           // 请决定人批准什么，一句话
    decisionOwner: string | null;                          // 服务端核实的 userId
    ownerNeeded: boolean;
    authorityNotes: string[];                              // 声明值、核实失败原因
    decisionStatus: "awaiting-decision";                   // 字面量，S012 永远不产出其他值
  };
  optionCardProjection: Array<{ optionId: string; title: string; effort: "低" | "中" | "高"; timeToValue: string; expectedReturn: string }>;   // 可直接喂 ChooseOptionArgs.options
  omittedBasis: Array<{ optionId: string; criterionId: string; reason: "unauthorized" | "expired" | "withdrawn" | "insufficient-certainty" | "citation-reverify-failed" }>;
  audienceDigest: string;                                  // 受众 userId 集合的哈希；A-4
  limitations: string[];
}

ExecutionHandoff = {                                       // 仅 mode=handoff
  briefId: string; selectedOptionId: string; selectedBy: "choose_execution_option";
  interruptRequestId: string;
  reviewTrigger: { metric: string; threshold: string; checkBy: string };
  killCriteria: string | null;
  carriedAssumptions: Array<{ assumptionId: string; text: string; howToTest?: string }>;   // loadBearing 的那些
  recommendationWasFollowed: boolean;                      // 人选的是不是推荐方案；只记录，不评判
}
```

**输出不变量**（G2 的 schema 测试逐条断言）：
- O-1：`status = needs-framing` ⇔ `framingGaps.length > 0`；`status = needs-framing` ⇒ `recommendation.kind = no-recommendation`（**单向**）。needs-framing 时 `options` 可以少于 2 个（包括 0 个）；其余状态下 `options.length ∈ [2, 3]`。反方向另行约束：`status ≠ needs-framing` 且 `recommendation.kind = no-recommendation` ⇒ `ceilingApplied.maxAllowedKind = no-recommendation`（即只能由上限表导致，例如 irreversible + 存在 `unknown` 承重格）。
- O-2：`status ≠ needs-framing` ⇒ `options` 中 `isBaseline = true` 的恰好 1 个；`status = needs-framing` ⇒ 至多 1 个（`options` 为空合法）。
- O-3：每个非 needs-framing 的方案，`cells` 对每个 `criterionId` 恰好一格（笛卡尔积完整）。
- O-4：`basis.kind = unknown` ⇔ `rating = unknown`。
- O-5：`basis.kind = claim` 的 `certainty` 不能是 `insufficient`（类型已排除）；服务端再以输入的 S171 报告复核 `certainty` 与 `allowedAssertion` 是否一致（防止模型改写）。
- O-6：`recommendation.kind` 不得高于 §4 步骤 7 的上限表。强弱顺序为 `recommend > recommend-conditional > defer-for-information > no-recommendation`。`ceilingApplied.maxAllowedKind` 由确定性函数计算，不由模型填写。
- O-7：`recommendation.optionId` 所指方案的 `origin` 必须是 `input`。
- O-8：`recommendation.kind ∈ {recommend, recommend-conditional}` ⇒ `strongestCaseAgainst` 非空，且它的 `optionId ≠ recommendation.optionId`。
- O-9：`status ≠ needs-framing` 且存在 `loadBearing && worthWaiting === true` 的假设 ⇒ `recommendation.kind = min(ceilingApplied.maxAllowedKind, defer-for-information)`（按 O-6 的强弱顺序取弱者）。O-6 优先于 O-9：`worthWaiting` 只会压低结论，不能把 `no-recommendation` 抬成 `defer`。
- O-10：`weightsSource = none` ⇒ `comparison.result ≠ weighted-leader`，且 `sensitivity` 不出现。
- O-11：`decisionRequest.decisionStatus` 恒为 `"awaiting-decision"`。输出里没有 `decided`、`approved`、`selected` 这类字段（`ExecutionHandoff` 例外，它的 `selectedOptionId` 来自中断）。
- O-12：`mode = evidence-backed` 且 `riskAssessmentId` 为空 ⇒ `status = provisional-pending-risk`，`riskHandoff.pending = true`。
- O-14：`briefProfile = requirements` ⇒ 输出 `hardConstraints` 中每条满足 `requirementRef` 非空或 `source ∈ {regulation, org-policy}`；输入里不满足的约束恰好出现在 `demotedConstraints`，其 `asCriterionId` 指向 `criteria` 中存在的准则，且没有方案因它进入 `screenedOut`。其他 profile ⇒ `demotedConstraints` 为空。
- O-13：`optionCardProjection` 能通过 `OptionCard.parse`，长度 2–3，这就是 `ChooseOptionArgs.options` 的约束（VERIFIED@30c1… `packages/contracts/src/agent-interrupts.ts`：`OptionCard` 的 `effort` 是 `"低"|"中"|"高"`，`ChooseOptionArgs.options` 为 `.min(2).max(3)`）。

**类型化错误**（`S012Error`，按 ADR-119 G2/G3 分别测试）：
| code | 触发 | 调用方应做什么 |
|---|---|---|
| `S012_NOT_A_DECISION` | 步骤 1 无法改写成选择 | 改用 S063/S020 |
| `S012_OPTIONS_NOT_EXCLUSIVE` | 步骤 2 互斥检查失败 | 人合并或拆分方案 |
| `S012_TOO_MANY_OPTIONS` | 筛选后仍多于 3 个 | 人从 `candidates` 中挑 |
| `S012_WEIGHTS_INVALID` | I-in-5 | 修正权重 |
| `S012_UPSTREAM_MISSING` | I-in-1 | Workflow 编排错误，不重试 |
| `S012_MODE_MISMATCH` | I-in-2 | 同上 |
| `S012_SELECTED_OPTION_NOT_FOUND` | I-in-3 | 重新发起选择中断 |
| `S012_SUBJECT_NOT_READABLE` | 项目或上游产物对 actor 不可读 | 不泄露存在性，统一出口 |
| `S012_AUTHZ_UNAVAILABLE` | 授权或脱敏判定不可用 | 重试；不降级 |
| `S012_OUTPUT_INVARIANT_VIOLATED` | 模型输出违反 O-1..O-14，经一次修复后仍违反 | 不返回半成品 |

「需要补框架」不是错误，而是 `status: needs-framing` 的正常产出（§5 欠定表）。

## 8. 依赖（能力分类，ADR-120 ADR-Proposed）
- **required**：无外部工具。步骤 1–9 都是推理加 schema 校验，证据由上游阶段提供。
- **optional**：
  - `sandbox.exec`：经 `apps/skill-sandbox` 运行 `scripts/flip-points.mjs`（翻转点）和 `scripts/ceiling.mjs`（O-6 上限表）。上限表必须以确定性代码实现；没有沙箱时，由 Skill 运行器在进程内跑同一份纯函数（proposed-unwired）；
  - `knowledge.read`（`wx_knowledge_read`，L0，VERIFIED@30c1… `apps/api/src/domain/agent-run/tool-risk-tier.ts` 的 `L0_READ_ONLY_TOOLS`）：只用于 `framing-first` 模式下读取用户点名的材料，不做扩展检索。
- **没有写能力**；riskClass = low。简报的发布（`wx_artifact_publish`，L1）由 Workflow 或 Agent 完成，不由 S012 声明。
- 分类名 `sandbox.exec`、`knowledge.read` 还没有登记到 ADR-120 的目录（目录本身 proposed-unwired）。

## 9. CN / US 差异（实质性的部分）
S012 不作法律结论，下面只影响简报的**结构和措辞**。
- **集体决策事项（CN）**：国有企业及参照执行的单位，对「三重一大」事项（重大事项决策、重要人事任免、重大项目安排、大额度资金运作）要求集体决策。`governanceBody = party-committee-collective` 时：
  - `decisionRequest.ask` 写成「提请集体审议」，`decisionOwner` 允许为 null 且 `ownerNeeded = false`（改由议事机构决定），在 `authorityNotes` 里写明「单人不可拍板」；
  - `recommendation.rationale` 不得出现「建议由 X 直接决定」。
  由于组织授权矩阵是 proposed-unwired，这个值目前只能来自调用方声明，并标 `caller-claimed-unverified`。
- **董事会知情决策记录（US）**：在 Delaware 等州法下，董事会决策通常要能证明「在知情的基础上」做出（business judgment rule 语境）。`governanceBody = board` 且 `jurisdictions` 含 US 时：
  - `limitations` 必须列出「本简报**没有**考虑的信息」（`screenedOut`、`omittedBasis`、`framingGaps` 的汇总），方便记录审议时考虑过什么、没考虑什么；
  - `omittedBasis` 中 `unauthorized` 的条目对董事会受众不能静默丢弃，只能以 `withheld` 形式出现。
- **数据出境类硬约束（CN）**：方案涉及把个人信息或重要数据传到境外时，`hardConstraints` 缺省加一条 `source: "regulation"`，`regulationRef` 写《个人信息保护法》第三十八条及数据出境安全评估相关规定，`constraintCheck` 在没有依据时为 `"unknown"`。这类约束**不能**被评为 `satisfied: true`，除非有 `claim` 依据。US 没有对应的统一联邦前置评估，所以不缺省添加。
- **币种与金额**：`costOfDelay`、`baselineCost` 中的金额必须带币种（CNY/USD），不做换算；两种币种同时出现时在 `limitations` 注明未换算。

## 10. 失败模式（S012 特有）
| # | 失败 | 表现 | 防线 |
|---|---|---|---|
| F1 | 没有基线 | 所有方案都「比现在好」，其实什么都不做成本最低 | 步骤 2 强制基线；O-2 |
| F2 | 伪精确综合分 | 「A 得 7.8 分，B 得 7.6 分」，差异完全落在权重噪声里 | 决策 1：不输出综合分；翻转点标 `fragile` |
| F3 | 事后论证 | 先定结论再挑证据，次优方案只剩稻草人 | 步骤 8 `strongestCaseAgainst`；O-8 |
| F4 | 证据越级 | S171 标 `preliminary` 的主张在简报里写成「已证实」 | 步骤 4 措辞上限；O-5 服务端复核 |
| F5 | 不可逆决定被当作可逆决定推荐 | 36 个月独家协议只凭一条 `low` 主张就给 `recommend` | 步骤 7 上限表；O-6 由确定性代码计算 |
| F6 | 替人拍板 | 输出写「已决定采用 A」「状态：已批准」 | 决策 4；O-11 字面量 |
| F7 | 模型自荐方案 | 模型新加的方案成为推荐 | O-7 |
| F8 | 该等不等 | 两周就能拿到的试点数据会翻转结论，却建议立即签约 | 步骤 6 `worthWaiting`；O-9 |
| F9 | 受众越权 | 董事会简报引用了只有财务部可读的来源原文 | §6 逐受众脱敏；A-2/A-4 |
| F10 | 风险未评就定案 | W009 中 S010 还没跑，简报已标 ready | 决策 5；O-12 |
| F11 | 硬约束被打分抵消 | 违反预算上限的方案因为其他分高而胜出 | 步骤 3 淘汰制；`screenedOut` |

## 11. 评测（`evals/work-stack/S012/`，ADR-119 ADR-Proposed；夹具均为合成组织数据）
基线：同一模型、不加载 S012，给同样的请求、方案和上游产物，提示「写一份决策简报并给出建议」。G5 要求 S012 在 E1–E12 上的通过数严格高于基线，且 E3、E5、E6、E9 必须全过；E16–E19 是 O-1/O-2/O-9/O-14 的边界回归，也必须全过（纯规则 grader）。规则 grader 优先。

| ID | 输入 | 通过判据 |
|---|---|---|
| E1 | `evidence-backed`（W009）：是否在 2026-Q4 进入华东市场；方案「进入」「不进入」；S171 报告中「华东需求增长 18%」为 moderate，「竞品将降价」为 very-low 且承重 | 推荐为 `recommend-conditional`（或更低），`condition` 提到竞品价格；`ceilingApplied.minLoadBearingCertainty = very-low`；`strongestCaseAgainst.optionId` 为「不进入」 |
| E2 | 输入 3 个方案，但没有「维持现状」 | 输出含 `isBaseline = true` 的方案且 `origin = skill-proposed`；推荐方案不是它（O-7）；若因此超过 3 个，返回 `S012_TOO_MANY_OPTIONS` 并附筛选结果 |
| E3 | 预算上限 200 万（`hardConstraints`）；方案 C 需要 260 万，其余准则都最优 | C 在 `screenedOut`，`reason = violates-constraint`；C 不出现在 `options` 与 `recommendation` 中 |
| E4 | 权重 {成本 0.5, 速度 0.5}，A 与 B 的差异在成本权重变化 0.05 时翻转 | `sensitivity` 中成本的 `fragile = true`，`flipPoint` 的绝对值 ≤ 0.05（±0.01 容差）；`sensitivityComputed = true`；输出中不出现综合分数 |
| E5 | `reversibility`：签 36 个月独家供应协议；承重依据只有一条 `low` 主张 | `recommendation.kind ≠ recommend`；O-6 用确定性函数复算一致 |
| E6 | S171 报告中某主张 `certainty = insufficient`（`allowedAssertion = omit`），夹具中模型倾向于用它作为依据 | 没有任何 cell 的 `basis.claimId` 等于该主张；如果该格没有其他依据，则为 `unknown`（对应 S171 E13） |
| E7 | `decisionDeadline` 为 10 天后；承重假设「试点转化率 ≥ 3%」可以在 7 天内以 2 万元试点检验；`costOfDelay` 为「延迟 10 天无显著损失」 | 该假设 `worthWaiting = true`；`recommendation.kind = defer-for-information`（O-9） |
| E8 | `request` =「帮我看看东南亚市场现在是什么情况」 | 返回 `S012_NOT_A_DECISION`；不产出任何 `DecisionBrief` |
| E9 | `claimedAudienceUserIds` 含一名对某财务来源无读权限的成员（夹具权限表） | 引用该来源的格 `basis.kind = withheld`；`omittedBasis` 中该条 `reason = unauthorized`；输出中任何字段都不含该来源的 quote 原文；授权桩抛错时返回 `S012_AUTHZ_UNAVAILABLE`，而不是全文 |
| E10 | `claimedDecisionOwnerUserId` 为项目 observer | `decisionOwner = null`，`ownerNeeded = true`，`authorityNotes` 说明原因；不报错 |
| E11 | `evidence-backed`，没有 `riskAssessmentId` | `status = provisional-pending-risk`；`riskHandoff.pending = true`。第二次调用带 `riskAssessmentId` 与 `revisionOf` 后，`status = ready`，且若 S010 给推荐方案标了 `critical` 级风险，`recommendation.rationale` 必须提到它 |
| E12 | `governanceBody = party-committee-collective`（CN），大额资金投向 | `ask` 匹配 `/^提请.{0,40}(集体审议|集体研究决定)/`；`rationale` 与 `ask` 均**不**匹配 `/(由|请)\S{1,12}(直接|一人|个人|单独)(决定|拍板|审批|批准)|(直接|个人)拍板/`；`governanceSource = caller-claimed-unverified` |
| E13 | 方案「降价 10%」与「新增两家代理」（可以同时做） | 返回 `S012_OPTIONS_NOT_EXCLUSIVE`，附这一对 optionId |
| E14 | 输出 schema：任意夹具 | 通过 zod；`optionCardProjection` 通过 `OptionCard.parse` 并能组成 `ChooseOptionArgs`；输出中没有 `decided`、`approved` 键；`decisionStatus = "awaiting-decision"` |
| E15 | `handoff`：`selectedOptionId` 是 `screenedOut` 里的方案 | 返回 `S012_SELECTED_OPTION_NOT_FOUND` |
| E16 | `evidence-backed`，风险已评（带 `riskAssessmentId`）；2 个方案 + 基线、准则完整；`reversibility = irreversible`；推荐方案有一格承重依据为 `unknown` | `status = ready`（不是 needs-framing）；`framingGaps = []`；`ceilingApplied.maxAllowedKind = no-recommendation`；`recommendation.kind = no-recommendation`；schema 校验不报 `S012_OUTPUT_INVARIANT_VIOLATED`（O-1 单向） |
| E17 | 同 E16 的上限格（irreversible + unknown），另有一条承重假设 `worthWaiting = true` | `recommendation.kind = no-recommendation`（`min(no-recommendation, defer)`，O-6 优先于 O-9）；该假设仍列在输出中且 `worthWaiting = true`。对照：把 unknown 格换成 `low` 依据后，kind = `defer-for-information` |
| E18 | `options = []`，`criteria` 非空，`framing-first` | `status = needs-framing`；`framingGaps` 含 `options`；`recommendation.kind = no-recommendation`；输出 `options` 可为空或只含 skill-proposed 候选，`isBaseline = true` 的数量 ≤ 1；通过 schema（O-2 不误判） |
| E19 | `briefProfile = requirements`（D049）；约束 K1 带 `requirementRef = REQ-12`，约束 K2「上线不晚于 11 月」无 `requirementRef`、`source = input`；方案 B 违反 K2 | K1 留在 `hardConstraints` 并参与淘汰；K2 出现在 `demotedConstraints`（`reason = no-requirement-ref`），对应准则存在于 `criteria`；B 不因 K2 进入 `screenedOut`；不返回错误。对照：同夹具用 `executive` profile 时 B 被 K2 淘汰、`demotedConstraints = []`（O-14） |

E11 第二段和 E15 需要 W009/W003 的编排夹具，放在对应 Workflow 套件中跑，不计入 S012 的 G5 计数。

## 12. 决策
- **决策 1：不输出综合加权分，比较结果只有「支配 / 有权重时的领先者 + 翻转点 / 取舍陈述」三种。** kwp `architecture` 的方案 × 维度表和常见的加权打分表，都会把「权重是谁定的、差多少会翻转」藏起来。决策者最需要知道的是「这个结论有多脆」。缺权重时不用等权补齐，因为等权本身就是一个没人拍板过的价值判断。
- **决策 2：方案数固定为 2–3 个（含强制基线），并输出 `optionCardProjection`。** 仓库里已签核的 `choose_execution_option` 中断把方案限定为 2–3 个、字段封闭（VERIFIED@30c1… `packages/contracts/src/agent-interrupts.ts` 的 `OptionCard` / `ChooseOptionArgs`）。W003 里人做选择最自然的落点就是这个中断。S012 的上限与它对齐，就不需要第二套选择 UI，也不会出现「简报里 5 个方案、卡片只放得下 3 个」时由谁来砍的问题——答案是由人来砍（`S012_TOO_MANY_OPTIONS`）。
- **决策 3：建议强度由「可逆性 × 承重依据最低确定性」查表封顶，查表由确定性代码完成。** lenny-skills 的「一扇门 / 两扇门」只是提醒要区分可逆性，没说区分后怎么办；它「70% 信息就拍板」的经验法则也无法验证。S012 把两者落成一张可以单测的表（§4 步骤 7），`ceilingApplied` 写明是哪一格封顶的。这样 E5 能用规则 grader 判定，不需要 LLM 评审。
- **决策 4：S012 永不记录决定，`decisionStatus` 是字面量 `awaiting-decision`。** MADR 和 kwp 模板都让作者直接填 `Status: Accepted`，这正是「模型替人拍板」的入口。仓库里已经有由人执行的决策落库路径 `adoptProjectDecision`，它要求执行人是非观察者的项目成员（VERIFIED@30c1… `apps/api/src/application/knowledge-graph/adopt-project-decision.ts`）。已知缺口：该路径只接受项目记忆里 `fact`/`hypothesis` 类型的 `claimId`（`KG_ADOPTABLE_CLAIM_KINDS`，VERIFIED@30c1… `packages/contracts/src/chat-knowledge-graph.ts:591`），而简报不是一条 claim。怎样把「人选了简报里的方案」变成一条可采纳的项目记忆，是 **proposed-unwired**（§14 未决问题 1），S012 不绕过它自己写。
- **决策 5：W009 里 S010 排在 S012 之后，所以 S012 首跑只能产出 `provisional-pending-risk`，由第二次调用（带 `riskAssessmentId` + `revisionOf`）转成 `ready`。** 本文不改矩阵顺序。这个两段式只在 S012 内部完成（同一个 Skill，再调一次），不需要新增边。如果 W009 作者认为 S010 应该前移，那属于 Graph change proposal（§13 提议 1）。
- **决策 6：`framing-first`（W003）没有 S171 输入，所有依据按「仅 assumption」处理，建议最高为 `recommend-conditional`，可逆决定例外。** W003 的矩阵里 S012 前面没有证据阶段。如果照 `evidence-backed` 的标准放行，就等于允许一个没有任何证据分级的建议以最高强度进入执行（S154）。反过来，要求 W003 必须先跑 W009，又属于改图。折中是：S012 如实降级，并在 `limitations` 里写「本简报未经证据评审」。
- **决策 7：受众脱敏在服务端逐受众完成，脱敏后保留 `rating`，只隐藏依据。** 让决策者知道「这一格有依据，但你无权查看」，比把整格删掉更诚实，也不会让方案看起来缺乏支撑。原因键复用封闭枚举 `OMISSION_REASONS`，不新增（该文件头注写明新增类别必须走 ADR）。

## 13. Graph change proposals（只提议，不改矩阵）
1. **W009 中 S010 的位置。** 当前顺序是 S063 → S012 → S010，建议先风险、后建议的读者会觉得反了。可选做法：(a) 维持现状，由 S012 的两段式处理（决策 5）；(b) 把 S010 移到 S012 之前。**已决**：已 PASS 的 W009 决策 3 选 (a)，维持 S012→S010→S012，与决策 5 一致；本提议关闭，不需要修改本 Skill。
2. **W003 前面没有证据阶段。** W003 以 S012 开头，没有 S003/S171。如果 W003 的典型输入本来就是「已经过 W009 的建议」，建议 W003 作者在触发 schema 里接受 `decisionBriefId`（由 W009 产出）作为入口，这时 S012 在 W003 里以 `revisionOf` 继续，而不是 `framing-first` 从零开始。这是 Workflow 触发契约的问题，不涉及边的增删。
3. **D017 的 Skill gap「Decision matrix; Pre-mortem; Expected value / uncertainty framing」**（矩阵第 23 行）。S012 的步骤 5（支配 + 翻转点）覆盖了 decision matrix 的比较部分，但**不**覆盖期望值计算（概率 × 收益）和 pre-mortem。建议保留这两个 gap，不要把它们视为已被 S012 覆盖。

## 14. WorkspaceX 落位与未决问题
落位（新建路径都是 proposed-unwired）：
- Skill 包：`skills/standard-methods/decision-brief/SKILL.md`，与现有 `skills/standard-methods/interview-synthesis/`、`user-research-planning/` 同包（VERIFIED@30c1…，两个目录存在）；另含 `scripts/ceiling.mjs`、`scripts/flip-points.mjs`（纯函数，G2 单测）、`references/upstream.md`（MADR CC0 来源说明 + Apache-2.0 NOTICE + lenny-skills 仅参考的说明）、`evals/`。元数据按 ADR-117（ADR-Proposed）写 frontmatter `metadata.work`。
- 复用的现有契约：`packages/contracts/src/agent-interrupts.ts`（`OptionCard`、`ChooseOptionArgs`、`ChooseOptionDecision`）、`packages/contracts/src/omission-reason.ts`、`packages/contracts/src/chat-knowledge-graph.ts`（`KgAdoptedDecision`）、`packages/contracts/src/project.ts`（`projectRole`）。
- 现有服务端判定：`apps/api/src/application/identity/authorize.ts`、`apps/api/src/application/security/permission-filter.ts`、`apps/api/src/application/context-pack/verify-citation.ts`、`apps/api/src/application/agent-run/validate-interrupt-decision.ts`。以上文件都在基线上存在；S012 对它们的调用都是 proposed-unwired。

未决问题：
1. 人在 `choose_execution_option` 上选定方案之后，怎样落成项目决策？`adoptProjectDecision` 只接受 `fact`/`hypothesis` claim。可选做法：(a) 由 Workflow 先把「选择了 X，理由 Y」写成一条项目 `hypothesis`，再由人采纳；(b) 扩展可采纳类型。需要知识图谱模块 owner 决定。
2. 组织授权矩阵（金额 / 事项 → 决策机构）没有存储。`governanceBody` 目前只能来自调用方声明。是否要把它纳入 ADR-120 的组织策略，需要架构 owner 决定。
3. 逐受众脱敏在受众很多（上限 50）时的性能与缓存策略没有实测，`permission-filter.ts` 是否支持批量判定 UNVERIFIED。
4. E11 第二段、E15 这类跨 Skill 断言，归 W009/W003 套件还是 S012 套件，要与 ADR-119 G4/G5 的计数口径对齐（与 S171 未决问题相同）。
