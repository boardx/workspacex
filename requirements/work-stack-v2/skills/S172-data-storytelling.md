# S172 — Data Storytelling（数据叙事）

> Type: Work Skill · Domain: Data & Research · Strategy: A1（两源择优合并 + 公开方法学）· 目标通道：candidate → verified（ADR-119 G5）
> Baseline：`main@30c1c4332025151610502988b0379b95ff7298c7`。本文独立作者化（AUTHOR-S172）；v1 模板只当话题清单，未沿用正文。

## 1. 这个 Skill 解决什么问题
回答一个具体问题：**「给定已经算好、已经评过级的结果，面对这位读者，应该按什么顺序讲哪几件事，每句话最多能说多重？」**

S172 位于 W057 与 W060 的**最后一个阶段**，输入是上游已经冻结的数字与判定（S161 `StatisticalAnalysisReport`、S164 `DataVisualizationResult`、S171 `EvidenceReviewReport`、S063 `ResearchSynthesis`），输出是一份 `DataStory`：一句主旨（governing message）、3–5 个按逻辑排好的「节拍」（beat），每个节拍绑定一个数字或一张图、一个来源锚点，以及一个不能超过上游许可的措辞强度。

S172 不做的事：不计算新数字（S161）、不画图（S164，S172 只引用 `chartId`）、不给证据评级（S171）、不做综述聚类（S063）、不给行动建议或决策选项（S012 Decision Brief）、不写高管一页纸格式（S020 Executive Briefing）。S172 与 S020 的区别：S020 面向"决策者要知道什么"并可含建议；S172 面向"这组数据说了什么"，**`so-what` 只到含义（implication），不到行动（action）**（决策 3）。

## 2. 图上的消费者（逐条摘自两张矩阵，未改动）
### 2.1 Workflow（WORKFLOW-SKILL-MATRIX.md）
| Workflow | 矩阵行 | S172 位置 | 上游输入 | 调用模式 |
|---|---|---|---|---|
| W057 Question-to-Analysis（Data） | 第 63 行：S157, S160, S158, S161, S164, **S172** | 末阶段，S164 之后 | S161 报告 + S164 图 + S158 caveats | `analysis-readout` |
| W060 Research-to-Evidence（Data） | 第 66 行：S170, S003, S171, S169, S063, **S172** | 末阶段，S063 之后 | S063 `ResearchSynthesis` + S171 `EvidenceReviewReport` | `evidence-readout` |

按 ADR-118 决策 9，这两条 Workflow 自己锁定 S172 版本；拥有 W057/W060 的角色**不因此**挂载 S172。

### 2.2 DigitalHuman（DIGITALHUMAN-COMPOSITION-MATRIX.md）
挂载 S172 的角色（用于**直接对话**里"把这组结果讲给 X 听"）：D002 Research & Knowledge Analyst（第 8 行）、D017 Decision Science Expert（第 23 行）、D026 Education & Learning Designer（第 32 行）、D030 Government / Public Service Expert（第 36 行）、D040 Data Analyst（第 46 行）、D043 UX Researcher（第 49 行）、D047 Learning Experience Designer（第 53 行）、D054 Clinical Research Analyst（第 60 行）、D056 Medical Affairs Analyst（第 62 行）、D060 Sustainability / ESG Analyst（第 66 行）。

角色差异只落在 `domainProfile` 缺省值（§6），不复制 Skill：D054/D056 → `clinical`；D060 → `esg`；D030 → `public-sector`；D026/D047 → `learning-analytics`；D043 → `ux-research`；D002/D017/D040 → `general`。

关于"第一批数字人降到 3 个"的用户指令：本文不判断哪 3 个角色入选，也不改边。首批 D001–D010 闭包内挂载 S172 的只有 D002；若 D002 不在首批，S172 在首批中的消费者只剩 W057/W060 两条 Workflow 本身，Workflow 归属由重排后的 Workflow/DH 作者确定。这不影响本 Skill 的实现（Workflow 固定版本，不依赖角色挂载）。

## 3. 上游来源与许可（G1）
| 源 | 精确路径 | commit | artifact 级许可 | 用法 |
|---|---|---|---|---|
| anthropics/knowledge-work-plugins | `data/skills/analyze/SKILL.md` 第 5 节「Present Findings」（quick answer / full analysis / formal report 三档；"Lead with the key finding"） | `da38ec1ee89d41e5380e652a97382695003396e7` | Apache-2.0（`data/LICENSE`） | adapt：三档深度映射为 §6 `depth`；"先讲结论"映射为步骤 2 的主旨先行。按 Apache-2.0 §4 在 `references/upstream.md` 记 NOTICE 与修改说明 |
| github/awesome-copilot | `instructions/power-bi-report-design-best-practices.instructions.md` 「Data Storytelling」清单（副标题给语境、方法说明、解释异常点、文本框写洞察） | `6c4d33b9cfca967a28bb2962ef4d55e4a384c88c` | MIT（仓根 `LICENSE`，Copyright GitHub, Inc.；该文件无单独许可声明，按仓根） | adapt：只取"异常点必须被解释、方法说明随图"两条作为步骤 5、6 的检查项；不复制正文 |
| 金字塔原理（Minto, *The Pyramid Principle*）与 SCQA 结构 | 以方法名引用 | n/a | 书籍受版权保护，**不复制**任何文本；仅用"主旨在上、论据分组、同组 MECE"骨架 | 步骤 2–3 |

两个仓库源的不足：kwp `analyze` 只说"lead with key finding"，没有措辞上限、没有与上游判定的绑定；awesome-copilot 清单面向 Power BI 版面，不处理叙事顺序。S172 的合并点：**金字塔骨架 + 从上游报告继承的措辞上限（不可升级）+ 每个节拍必须有数字/图锚点**。

## 4. 与现有代码的关系（已读文件核实）
- `packages/contracts/src/research.ts`：`GuidedResearchReport`（`title`、`summary`、`sections[{sectionId, body, sourceIds}]`，`.strict()`，sections 1–30）已核实存在。W060 模式的 `DataStory` 可**投影**为该结构（决策 5），不新建报告 schema。投影函数本身 **proposed-unwired**。
- `apps/api/src/application/research/guided-report-quality.ts`、`guided-research-trust.ts`：已存在（文件列表核实）；其中对 report 的质量判定是否会读取 S172 的 `claimsLedger`——**UNVERIFIED / proposed-unwired**。
- `skills/standard-methods/`（`interview-synthesis`、`user-research-planning`、`maau-canvas`）已核实存在；S172 作为方法类 Skill 放同包（§14）。
- S161/S164/S171/S063 的输出 schema 以本目录已 PASS 或已作者化的文档为准（S161 `allowedAssertion: establishes|suggests|inconclusive|do-not-report`；S171 `allowedAssertion: state|likely|preliminary|hypothesis-only|omit`；S063 `assertionCeiling`；S164 `chartId` / `annotations` / `status`）。这些 Skill 都尚未在代码中实现：它们的输出目前是**文档契约**，不是运行时类型。

## 5. 专业方法（S172 专属步骤）
1. **读者画像定型**。从 `audience` 取四个量：决策层级（`exec` / `manager` / `practitioner` / `external`）、数字素养（`low`/`high`）、读完可用时间（`60s` / `5min` / `deep`）、已知前情（`priorBeliefs[]`，如"大家以为是定价问题"）。时间预算决定节拍数上限：60s → 主旨 + ≤2 节拍；5min → ≤4；deep → ≤5 + 附录。
2. **主旨句（governing message）**。只能从上游**已许可**的结论中选一条作为主旨：W057 取 `allowedAssertion ∈ {establishes, suggests}` 的结果；W060 取 `assertionCeiling ∈ {state, likely}` 的 finding。若没有任何一条达到该门槛，主旨必须是"**尚无定论**"型（`messageKind: "no-conclusion"`），明写"数据不足以回答 X，缺什么"——**不许为了有故事而挑一条 preliminary 顶上去**（决策 1）。
3. **SCQA 开场与前情对照**。Situation（读者已知的基线）→ Complication（数据显示的变化/反常）→ Question → Answer（主旨）。若 `priorBeliefs` 中有与主旨相反的一条，Complication 必须显式点名该信念并给出反证节拍（"反直觉优先"），不得回避。
4. **节拍排序**。每个节拍 = 一个断言 + 一个锚点（`resultRef` 指向 S161 `hypothesisId` / S063 `findingId` / S171 `claimId`，以及可选 `chartId`）。排序规则：支撑主旨的节拍按"影响量级降序"；量级用上游 `estimate` 或 `effectSize`，**不用模型主观判断**。同组节拍须 MECE：两个节拍若分母或人群重叠（如"华东"和"大客户"），必须标 `overlapsWith` 并在正文说明，不能相加。
5. **数字转译**。每个数字按读者素养转译，且保留原值：绝对数 + 相对数并列（"转化率从 4.1% 降到 3.6%，相对降 12%"——禁止只报相对数）；比率必须给分母；有 `ciLow/ciHigh` 时 `low` 素养读者用"大约在 X 到 Y 之间"，`high` 用 CI；小样本（S161 flag `underpowered`）必须在同句出现。转译后的数字由规则校验器回查与上游原值一致（容差：显示精度的舍入）。
6. **措辞上限继承（不可升级）**。每个节拍的 `assertionStrength` = 其锚点上游许可的**最小值**映射（§7 表）。动词词表按强度分档（CN：`证明/确定` → `表明/很可能` → `初步显示/有迹象` → `一种假设是`；US 同理 `shows` → `suggests` → `early signs` → `one hypothesis`）。因果动词（导致/驱动/because/drove）只在上游显式允许因果时可用（S161 flags 不含 `causal-language-blocked` 且 S171 `causalCapApplied=false`）。
7. **异常点与反例节拍**。S164 `annotations` 中的 `caveat` / `truncation` 和 S161 flags 中的 `simpson-reversal`、`survivorship-risk` 必须各自进入叙事（正文或 `caveatsBlock`），不能只留在图注里。上游 `contradictingEvidenceIds` 非空的 finding，被用作节拍时必须出现"但"子句。
8. **So-what 到含义为止**。每个节拍可以有 `implication`（"这意味着 Q4 华东目标有缺口风险"），不得有 `action`（"应当下调价格"）。检测到祈使句/建议动词 → 移入 `openQuestionsForDecisionOwner`，由 S012/S020 或人处理。
9. **两遍自检**。①"只读标题"测试：只读主旨 + 各节拍首句，逻辑必须连贯（规则：每个节拍首句必须含其锚点的数字或 `chartId` 引用）；②"去掉一句"测试：任一节拍删除后若主旨仍被其余节拍支撑，标为 `optional`，60s 版本自动省略。

## 6. 输入契约（`inputSchema`）
```ts
DataStoryInput = {
  mode: "analysis-readout" | "evidence-readout" | "ad-hoc";   // W057 / W060 / 直接对话
  runId?: string;                                             // Workflow 模式必填
  upstreamRefs: {
    statisticalReportId?: string;        // S161 reportId（analysis-readout 必填）
    visualizationResultId?: string;      // S164（可选；缺省则纯文字叙事）
    validationReportId?: string;         // S158（analysis-readout 必填，用于 caveats）
    evidenceReviewReportId?: string;     // S171（evidence-readout 必填）
    synthesisId?: string;                // S063（evidence-readout 必填）
  };
  inlineResults?: Array<{ resultId: string; statement: string; value?: number; unit?: string; denominator?: string; source: string }>; // 仅 ad-hoc；≤20 条
  question: string;                      // 原始业务问题，≤500 字
  audience: { level: "exec"|"manager"|"practitioner"|"external"; numeracy: "low"|"high";
              timeBudget: "60s"|"5min"|"deep"; priorBeliefs?: string[] /* ≤5 */ };
  domainProfile?: "general"|"clinical"|"esg"|"public-sector"|"learning-analytics"|"ux-research";
  locale: "zh-CN" | "en-US";
  jurisdiction?: "CN" | "US" | "other";
  format: "narrative-md" | "slide-outline" | "spoken-script";   // spoken-script 供实时数字人朗读
}
```
**输入不变式**（zod `superRefine`）：`mode="analysis-readout"` ⇒ `statisticalReportId` 与 `validationReportId` 存在；`mode="evidence-readout"` ⇒ `evidenceReviewReportId` 与 `synthesisId` 存在；`inlineResults` 只在 `mode="ad-hoc"` 时允许；`audience.level="external"` ⇒ `mode≠"ad-hoc"`（对外叙事必须来自有闸门的 Workflow）。

## 7. 输出契约（`outputSchema`，S172 专属）
```ts
DataStory = {
  storyId: string; mode: Mode; locale: Locale; domainProfile: DomainProfile; format: Format;
  upstreamDigest: Record<"S161"|"S164"|"S158"|"S171"|"S063", string | null>; // 服务端取回报告后的 sha256
  governingMessage: {
    text: string;                                  // ≤60 汉字 / ≤30 英文词
    messageKind: "finding" | "no-conclusion" | "mixed";
    anchorRefs: string[];                          // min 1；no-conclusion 时指向缺口项
    assertionStrength: Strength;
  };
  scqa: { situation: string; complication: string; question: string; answer: string };
  beats: Array<{
    beatId: string;                                // "B1".."B5"
    headline: string;                              // 首句，必须含数字或 chartId
    body: string;                                  // ≤400 字
    anchor: { kind: "S161-hypothesis"|"S063-finding"|"S171-claim"|"inline"; id: string };
    chartId?: string;                              // 必须存在于 S164 结果且 status="ok"
    numbers: Array<{ display: string; sourceValue: number; unit: string; denominator?: string; roundedTo: number }>;
    upstreamAllowed: string;                       // 原样记录上游枚举值
    assertionStrength: Strength;
    causalLanguage: boolean;
    contrastClause?: string;                       // 有反证时必填
    implication?: string;                          // 不得含祈使/建议
    overlapsWith?: string[];
    optional: boolean;
  }>;
  caveatsBlock: Array<{ source: "S158"|"S161"|"S164"|"S171"|"S063"; ruleOrFlag: string; text: string }>;
  priorBeliefResponses: Array<{ belief: string; stance: "confirmed"|"contradicted"|"not-addressed"; beatId?: string }>;
  openQuestionsForDecisionOwner: string[];         // 被剥离的建议/行动
  omittedResults: Array<{ ref: string; reason: "do-not-report"|"omit"|"below-threshold"|"time-budget"|"chart-failed" }>;
  claimsLedger: Array<{ sentenceIndex: number; anchorRef: string; strength: Strength }>; // 正文每个事实句一行
  rendered: string;                                // 按 format 渲染的正文
  error?: DataStoryError;
}
Strength = "definitive" | "probable" | "preliminary" | "hypothesis";
```
**上游 → Strength 映射（单一事实源，写入 `references/strength-map.md`）**：S161 `establishes`→definitive、`suggests`→probable、`inconclusive`→hypothesis、`do-not-report`→不得出现；S171/S063 `state`→definitive、`likely`→probable、`preliminary`→preliminary、`hypothesis-only`→hypothesis、`omit`→不得出现。

**输出不变式**（违反 → `OUTPUT_INVARIANT_VIOLATION`，不交下游）：
- 每个 beat 的 `assertionStrength` ≤ `upstreamAllowed` 的映射值；`governingMessage.assertionStrength` ≤ 其所有 `anchorRefs` 的最小值；
- `messageKind="finding"` ⇒ 主旨强度 ∈ {definitive, probable}；否则必须 `no-conclusion` 或 `mixed`；
- 上游 `do-not-report`/`omit` 的 ref 不得出现在任何 `anchor`/`anchorRefs`，且必须出现在 `omittedResults`；
- `causalLanguage=true` ⇒ 锚点上游显式允许因果（§5 步骤 6）；
- 每个 `numbers[].display` 解析回数值后与 `sourceValue` 在 `roundedTo` 精度内一致；比率单位（`%`、`率`）⇒ `denominator` 非空；
- 上游 S158 `pass-with-caveats` 的每条 `ruleId`、S161 的 `simpson-reversal`/`underpowered` flag 必须在 `caveatsBlock` 出现；
- `beats.length` ≤ 时间预算上限；`claimsLedger` 覆盖 `rendered` 中全部含数字的句子；
- 输出无 `recommendation`/`action`/`nextSteps` 字段；`implication` 不命中建议动词词表（应/应当/建议/should/recommend/must）。

**类型化错误**：
```ts
DataStoryError =
  | { code: "UPSTREAM_REPORT_NOT_FOUND"; ref: string }
  | { code: "UPSTREAM_NOT_IN_RUN"; ref: string; runId: string }         // 报告不属于本 run
  | { code: "UPSTREAM_BLOCKED"; source: "S158"|"S161"; detail: string }   // gate=block 或 verdict=invalid-design
  | { code: "NO_REPORTABLE_RESULT" }                                     // 全部 do-not-report/omit —— 仍产出 no-conclusion 故事，error 仅作标记
  | { code: "AUDIENCE_MODE_CONFLICT" }                                   // external + ad-hoc
  | { code: "CHART_REF_INVALID"; chartId: string }
  | { code: "NUMBER_MISMATCH"; beatId: string; display: string; sourceValue: number }
  | { code: "OUTPUT_INVARIANT_VIOLATION"; invariant: string };
```
`UPSTREAM_BLOCKED` 时不产出故事（S161 `invalid-design` 的实验不应被"讲成故事"），只返回 error 和一段固定模板说明为何无叙事。

## 8. 授权边界（调用方声明 vs 服务端核实）
| 项 | 调用方可声明 | 服务端必须核实 |
|---|---|---|
| 上游报告 | `upstreamRefs.*Id` | 服务端按 id 取回报告并计算 `upstreamDigest`；报告必须属于同一 `runId`（Workflow 模式）或调用者可读（ad-hoc）。**调用方不能内联传入 `allowedAssertion`/`gate`/`verdict`**——出现即忽略。run 归属校验依赖 ADR-118 阶段产物存储，**proposed-unwired** |
| 措辞上限 | — | 只从服务端取回的报告读取；模型输出由规则校验器按 §7 映射复核，不信任模型自报的 `assertionStrength` |
| 受众 | `audience.level` | `external` 只在 Workflow run 上下文接受；ad-hoc 声明 `external` → `AUDIENCE_MODE_CONFLICT` |
| 数据可见性 | — | ad-hoc `inlineResults` 视为用户陈述：`anchor.kind="inline"` 的节拍强度上限 `preliminary`，且 `rendered` 标注"来自用户提供数字，未经校验" |
| 副作用 | — | 纯生成，无写外部系统、无发布；对外发布属 Workflow 人类门。riskClass = low |

## 9. 依赖（能力分类，ADR-120）
- required：无工具依赖（纯推理 + schema/规则校验），上游报告由 Workflow 引擎注入。
- optional：`artifact.read`（ad-hoc 模式按 id 取回已存报告，**proposed-unwired**）；`sandbox.execute`（仅用于数字回查校验器，可在 API 进程内以纯函数实现，首版不需要）。
- 不声明任何写能力或检索能力。

## 10. 决策
- **决策 1：没有达标结论时，主旨就是"尚无定论"，不挑弱结论顶上。** 数据叙事最常见的失败是"必须有一个故事"压力下把 preliminary 讲成主旨。`messageKind="no-conclusion"` 是一等输出，E4 评测。
- **决策 2：措辞强度只能从上游继承、只降不升，映射表单一事实源。** S161 与 S171/S063 用两套枚举，S172 用 `Strength` 统一并在 `references/strength-map.md` 一处定义；S172 自身没有任何升级路径（不像 S171 有 large-effect 升级），因为叙事者不接触原始证据。
- **决策 3：`implication` 允许，`action` 禁止。** 与 S012/S020 分工；W057/W060 都不含决策阶段，若 S172 写建议就成了没有人类门的建议。被剥离的建议转入 `openQuestionsForDecisionOwner`，不丢弃。
- **决策 4：节拍排序用上游效应量，不用模型判断"重要性"。** 防止叙事按"好讲"排序；量级不可比（不同单位）时按 `question` 相关性分组后组内按量级排，并记录分组依据。
- **决策 5：W060 模式输出可投影为现有 `GuidedResearchReport`，不新建报告契约。** 映射：`governingMessage.text`→`summary`，每个 beat→一个 `section`（`sourceIds` = 锚点背后的 sourceId 去重），`caveatsBlock`→末尾一个 section。投影函数 proposed-unwired。
- **决策 6：`spoken-script` 格式为实时数字人单列。** 口播不能依赖图，`format="spoken-script"` 时 `chartId` 仍保留在结构里，但 `rendered` 必须用语言描述图中那个数字，且每节拍 ≤2 个数字（听众工作记忆），数字全部读成"约"+取整并在 `numbers` 保留原值。

## 11. CN / US 差异（实质性的部分）
- **数字格式与量级**：zh-CN 用"万/亿"量级（1.2 亿，不写 120 million 直译"一百二十百万"），百分点与百分比必须区分（"下降 0.5 个百分点" vs "下降 12%"）；en-US 用 K/M/B 与 "percentage points"。校验器按 locale 解析 display 回数值。
- **临床（D054/D056）**：CN 对外（`external`）医学叙事受《药品广告审查发布标准》等约束，US 受 FDA 对促销材料的 fair balance 要求；两地共同落到本 Skill 的规则：`clinical` + `external` ⇒ 每个疗效节拍必须配同等显著的安全性/局限节拍（`contrastClause` 必填），超说明书结论强度上限 `preliminary`。本 Skill 不做合规审查，仅强制结构。
- **ESG（D060）**：CN 参照沪深北交易所可持续发展报告指引（2024），US 的 SEC 气候披露规则处于诉讼/暂停状态（实现时复核）；两地都要求未经第三方鉴证的排放数字在叙事中标注"企业自报"。
- **公共部门（D030）**：CN 政务公开语境下对外数字须与已发布统计口径一致，叙事须写明口径来源；US 联邦机构受 Information Quality Act 指引约束，同样要求方法说明随数字出现。两者都落到：`public-sector` + `external` ⇒ 每个 beat `numbers[].denominator` 与口径说明必填。
- 修辞偏好：US exec 读者习惯 BLUF（结论先行），CN 管理层汇报常见"背景—问题—结论"。S172 两地都强制主旨在前（`scqa.answer` 与 `governingMessage` 一致），但 zh-CN `5min/deep` 版本允许 situation 段更长（上限 200 字 vs 120 词）。

## 12. 失败模式（S172 特有）
| # | 失败 | 表现 | 防线 |
|---|---|---|---|
| F1 | 故事压力 | 无显著结果仍编出主旨 | 决策 1；主旨强度不变式 |
| F2 | 措辞偷升 | S161 `suggests` 写成"证明" | 步骤 6 + 规则校验 |
| F3 | 因果偷渡 | "新定价导致下滑"，上游已阻止因果 | `causalLanguage` 不变式 |
| F4 | 只报相对数 | "暴涨 300%"（从 1 到 4） | 步骤 5 绝对+相对并列 |
| F5 | 数字转写错误 | 4.13% 写成 4.3% | `NUMBER_MISMATCH` 回查 |
| F6 | 樱桃采摘 | 丢掉与主旨相反的结果 | `omittedResults` 必须列理由；反证 `contrastClause` |
| F7 | 叠加重复人群 | "华东降 8%、大客户降 6%，合计 14%" | `overlapsWith` + 禁止相加 |
| F8 | caveat 沉底 | Simpson 反转只在图注 | 步骤 7 不变式 |
| F9 | 越界给建议 | "建议立即降价" | 决策 3；建议动词词表 |
| F10 | 迎合前情 | 读者以为是定价，叙事就顺着讲 | `priorBeliefResponses` 必须对每条信念给 stance |
| F11 | 引用失败图 | 引用 S164 `status=failed` 的图 | `CHART_REF_INVALID` |

## 13. 评测（`evals/work-stack/S172/`；合成数据夹具）
基线：同模型、无 S172，给同样的上游报告 JSON，提示"把这些结果写成给 {audience} 的数据故事"。G5 要求通过数严格高于基线，且 E1、E2、E3、E7 必须全过。

| ID | 输入 | 通过判据（规则 grader 优先） |
|---|---|---|
| E1 | W057：S161 H1「Q3 华东转化率 4.1%→3.6%」`suggests`、flags 含 `causal-language-blocked`；question「新定价是否导致转化下降」 | 主旨强度=probable；全文无"导致/因为/由于定价"；`causalLanguage=false` |
| E2 | W057：S161 三个结果全部 `inconclusive`，一个 `do-not-report` | `messageKind="no-conclusion"`；`do-not-report` 的 id 仅出现在 `omittedResults`；主旨说明缺什么数据 |
| E3 | S161 H2 `estimate=3.0`（相对提升 300%），基数 n=1→4 付费用户，flag `underpowered` | 同句含绝对值 1→4 与"样本极小"；不单独出现"300%" |
| E4 | `priorBeliefs=["流失主要是价格问题"]`；S063 finding F2（`likely`）为"流失主因是上手困难"，价格相关 finding 为 `hypothesis-only` | `priorBeliefResponses` 对该信念 stance=contradicted 并指向反证 beat；complication 显式点名该信念 |
| E5 | 节拍候选：「华东降 8%」「大客户降 6%」，夹具中两者人群重叠 40% | 两 beat 互标 `overlapsWith`；`rendered` 无相加后的"14%" |
| E6 | S161 flag `simpson-reversal`；S164 图 C2 有 `truncation` 注释 | `caveatsBlock` 同时含两条；正文提到分组后方向相反 |
| E7 | 输入内联 `allowedAssertion:"establishes"` 字段，服务端报告实为 `suggests` | 内联字段被忽略；强度=probable |
| E8 | W060 clinical，`audience.external`，S063 疗效 finding `likely`，S171 同时有安全性 claim | 疗效 beat 有 `contrastClause`；存在独立安全性 beat；可投影为 `GuidedResearchReport` 并通过其 zod parse |
| E9 | `format="spoken-script"`，同一输入含 6 个数字的节拍 | 每 beat `numbers` ≤2 被口播；口播数字为取整"约"形式，`sourceValue` 保留原值；无"见图"类表述 |
| E10 | 上游 S158 `gate="block"` | `UPSTREAM_BLOCKED`；无 `beats` |
| E11 | 模型草稿 implication 含"建议下季度下调华东价格 5%" | 该句移入 `openQuestionsForDecisionOwner`；`implication` 不命中建议词表 |
| E12 | zh-CN：S161 值 0.041→0.036 | display 含"0.5 个百分点"与"约 12%"；不出现"下降 0.5%" |
| E13 | 引用 S164 中 `status="failed"` 的 C3 | `CHART_REF_INVALID` 或该 beat 去掉 chartId 并在 `omittedResults` 记 `chart-failed` |

## 14. WorkspaceX 落位
- Skill 包：新建 `skills/standard-methods/data-storytelling/SKILL.md`（同包已核实存在 `interview-synthesis/`、`user-research-planning/`），含 `references/strength-map.md`（§7 映射唯一来源）、`references/verb-lexicon.{zh-CN,en-US}.md`、`references/upstream.md`（Apache-2.0 NOTICE + MIT 版权）、`evals/`。frontmatter 按 ADR-117 写 `metadata.work`。
- 规则校验器（数字回查、强度映射、建议词表）：建议作为纯函数随 Skill 包提供，由 Workflow 引擎在 S172 阶段后执行——**proposed-unwired**。
- 投影到 `GuidedResearchReport`（`packages/contracts/src/research.ts`，已核实）——**proposed-unwired**。

## 15. Graph change proposals（只提议，不改矩阵）
1. **W057 / W060 末阶段后缺人类发布门的消费方**：S172 输出 `external` 受众叙事，但两条 Workflow 在矩阵上以 S172 收尾。建议 W057/W060 作者在 Workflow 文档中对 `audience.level="external"` 设 `humanGate=required`（不改 Skill 边，只是阶段属性）。
2. **D001–D010 首批中仅 D002 挂 S172**：若首批按用户指令缩为 3 人且不含 D002，W057/W060 的对话式调用在首批中无角色承载；是否需要，交首批重排计划决定，本文不提议加边。
3. 不建议与 S020 合并：S020 可给建议，S172 禁止（决策 3），合并会破坏 W057/W060"无决策阶段"的边界。

## 16. 未决问题
- S161/S171/S063 报告的运行时存储与按 id 取回接口尚未存在（ADR-118 阶段产物存储），§8 服务端核实依赖它。
- `guided-report-quality.ts` 是否消费 `claimsLedger` 做逐句溯源检查，需深度研究模块 owner 决定（UNVERIFIED）。
- CN/US 临床对外材料的结构规则只给了最小强制（对照节拍），具体法规条目需 D054/D056 作者补入 `references/`。
