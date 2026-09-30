# S195 — Strategy Review（战略复盘）

> Type: Work Skill · Domain: Executive · Strategy: A0（WorkspaceX 原创；理由见 §3）· 目标通道：candidate → verified（ADR-119 G5）
> 基线：main@4518a6fcdd217f6094fdc3bbcebfa251afbdda16。本文独立作者化（AUTHOR-S195）；状态：待独立评审。

## 1. 解决什么问题
「我们宣称的战略，和我们实际在做的事，是不是同一件事；支撑它的假设哪些已被事实推翻或仍未验证；每个战略押注有没有先行指标和终止条件；下个周期哪些选择必须由高管层做出」。S195 对**已有的战略文本**（战略备忘录、年度计划、董事会材料）与**可读的资源投放证据**（预算、人员、路线图、会议时间）做一次结构化复盘，产出 `StrategyReview`。

边界：
- 不**写**战略、不提议「应该选哪个战略」——那是 S012（选项决策）与人。S195 输出的是发现与问题，不是建议书。
- 不做目标达成对账（S155 Business Review：目标 vs 实际）；S195 问的是「战略本身是否自洽、是否被执行、假设是否成立」，数字对账引用 S155 的结果。
- 不做竞争情报与市场规模（S008、S167）、情景推演（S013）；只引用其输出作为假设的证据。
- 不做 OKR 对齐检查（S198），不做商业模式分析（S199）。

## 2. 图上的消费者
| 边 | 来源 | 位置 |
|---|---|---|
| D001 Executive / Strategy Partner | 矩阵第 7 行 Skill 列首项（S195, S008, S063, S012, S013, S020, S199, S198, S010, S196, S197, S007） | 聊天直调：`mode: "review"`；在 D001 的 W001/W004/W009/W003 任一 Workflow 阶段内不使用 S195（这些 Workflow 行无 S195，见 §14） |

S195 **无 Workflow 消费者**；消费者门由 D001 一条边满足。

## 3. 上游来源与许可
A0 的理由：kwp 各插件（`product-management`、`sales`、`operations`、`finance` 等）均无战略复盘类 Skill（已 `ls` 核对 finance / legal / sales / product-management / operations / human-resources / small-business / marketing / data / enterprise-search 各插件 `skills/`：无战略复盘类 Skill；最接近的 `product-management/skills/roadmap-update`、`stakeholder-update` 是产品层沟通材料）。战略领域的公开材料多为书籍与咨询框架，无许可清晰的可复用 artifact；本文不复制任何文字，仅以公开的方法论为**思路**来源并在 §4 逐条标注。

| 源 | 路径 | commit | 许可 | 用法 |
|---|---|---|---|---|
| Richard Rumelt, *Good Strategy / Bad Strategy*（2011）：战略内核 = 诊断、指导方针、连贯行动 | n/a（书籍） | n/a | 方法与概念不受版权保护；不引用原文 | 构成步骤 1 的内核检查，把「战略」拆成三件可检验的东西 |
| Roger Martin & A.G. Lafley, *Playing to Win*（2013）：战略选择级联（愿景、在哪玩、如何赢、能力、管理体系） | n/a（书籍） | n/a | 同上 | 构成步骤 2 的选择级联一致性检查 |
| Henry Mintzberg 关于「意图战略 vs 实现战略」的区分（1978 论文思路） | n/a | n/a | 同上 | 构成步骤 3 的「宣称 vs 实际（revealed）」核心区分 |

## 4. 专业方法
1. **战略内核检查**：从战略文本中抽取三部分并各给 `present | weak | missing`：`diagnosis`（对形势的判断：挑战是什么）、`guidingPolicy`（应对挑战的总方针，含**明确放弃什么**）、`coherentActions`（相互强化的行动）。无「放弃什么」的方针判 `weak`（没有取舍的战略只是愿望清单）。抽取结果附原文引用，文本里没有就写 `missing`，不代写。
2. **选择级联自洽**：把战略的选择（在哪些市场/客户/产品竞争、靠什么赢、需要哪些能力、靠什么管理系统支撑）逐层对照，找**上下层矛盾**（例如宣称「高端客户」但定价与渠道面向中小客户）。只列矛盾及双侧引用。
3. **宣称 vs 实际**：对 `statedPriorities[]`（战略宣称的前 3–5 项）与 `revealedAllocation`（预算占比、人员占比、路线图条目占比、管理层会议时间占比）做对照，给每个优先级的 `allocationShare` 与 `gap`；无数据时 `revealed = "not-visible"`，不能说成「未投入」。
4. **假设台账**：把战略成立所依赖的关键假设逐条列出（`assumption`、`type ∈ {market, customer, competitor, capability, economics, regulatory}`、`evidenceState ∈ {supported, contradicted, untested}`、`evidenceRefs`、`testBy`）。`contradicted` 的假设必须指向其所支撑的行动。证据等级引用 S171 语义（`certainty`），不自行打分。
5. **押注与终止条件**：对每个战略押注检查是否有 `leadingIndicator`、`killCriterion`（什么情况下停止）、`reviewDate`、`owner`；缺项列入 `betHygiene`。
6. **未决选择**：输出 `decisionsNeeded[]`——必须由高管层（人）作出的选择，每条带「为什么现在需要」「不决定的代价」，并建议走 S012；S195 不提供选项倾向。
7. **复盘频率与上期对照**：若有上期 `StrategyReview` 引用，给 `changeSincePrevious`（新增/解除/恶化的假设与矛盾）。

## 5. 输入契约
```ts
StrategyReviewInput = {
  mode: "review";
  strategyDocs: Array<{ docRef: string; version: string; asOf: string }>;      // 战略文本
  statedPriorities?: Array<{ id: string; statement: string; docRef: string }>;
  revealedAllocation?: {
    budget?: { sourceRef: string; byPriority: Array<{ priorityId: string; amount: number; currency: string }> };
    headcount?: { sourceRef: string; byPriority: Array<{ priorityId: string; fte: number }> };
    roadmap?: { sourceRef: string; byPriority: Array<{ priorityId: string; itemCount: number }> };
    meetingTime?: { sourceRef: string; byPriority: Array<{ priorityId: string; hours: number }> };
  };
  evidenceRefs?: Array<{ kind: "s171-report" | "s008-brief" | "s013-scenarios" | "s155-review" | "document"; ref: string }>;
  previousReviewRef?: string;
  horizon: { start: string; end: string };
  locale: "zh-CN" | "en-US";
}
```
不变量：`strategyDocs` ≥ 1；`revealedAllocation` 各项 `sourceRef` 必填，无来源的数字不接受；`statedPriorities` 缺省时由 S195 从文本抽取并标 `extracted=true`。

## 6. 输出契约
```ts
StrategyReview = {
  horizon: { start: string; end: string };
  kernel: { diagnosis: KernelPart; guidingPolicy: KernelPart & { explicitTradeoffs: string[] }; coherentActions: KernelPart };
  cascadeContradictions: Array<{ upper: string; lower: string; docRefs: string[]; note: string }>;
  statedVsRevealed: Array<{ priorityId: string; statement: string; allocation: { budgetShare: number | "not-visible"; headcountShare: number | "not-visible"; roadmapShare: number | "not-visible"; meetingTimeShare: number | "not-visible" }; gap: "aligned" | "under-resourced" | "over-resourced" | "cannot-assess" }>;
  assumptions: Array<{ assumptionId: string; statement: string; type: AssumptionType; evidenceState: "supported" | "contradicted" | "untested"; evidenceRefs: string[]; supports: string[]; testBy?: string }>;
  betHygiene: Array<{ betId: string; missing: Array<"leadingIndicator" | "killCriterion" | "reviewDate" | "owner"> }>;
  decisionsNeeded: Array<{ topic: string; whyNow: string; costOfNotDeciding: string; suggestedWorkflow: "W009" | "W003" | "none" }>;
  changeSincePrevious?: { newContradictions: string[]; resolved: string[]; worsenedAssumptions: string[] };
  limitations: string[];
}
```
不变量：`kernel.*.state="present"` 需 ≥ 1 条文档引用；`statedVsRevealed.gap ∈ {under-resourced, over-resourced}` 需至少 2 个可见维度；`assumptions.evidenceState="contradicted"` 必有 `evidenceRefs` ≥ 1 且 `supports` 非空；输出**不含**「建议采用」「应当选择」类字段，不含战略选项排序。错误码：`STRATEGY_DOC_NOT_VISIBLE`、`STRATEGY_INPUT_INVALID`。

## 7. 授权边界
战略文本常是高度机密；`docRef` 只接受调用者有读权限者；输出里的引用以 docRef+段落锚点形式，不复制大段原文。`revealedAllocation` 的预算/人员来源若需财务/HR 权限，无权时对应维度为 `not-visible`，不报错。输出默认 `sensitivity="exec-confidential"`（交由分发层限制收件人；平台分发 ACL 见 W001 决策 6 的服务，本文不重述）。

## 8. 依赖与缺口
- optional：`docs.read`、`knowledge.search`、`finance.read`（预算，未登记）、`hr.headcount.read`（人员，未登记）、`calendar.read`（会议时间）、`board.read`（路线图/任务）。
- **缺口**：预算与人员的机读来源（ERP/HRIS 外部系统）无集成；首版 `revealedAllocation` 只能由调用方上传或由高管助理提供（`origin="caller-supplied"`，输出须声明）。副作用 = 只读；riskClass = medium（机密、高管决策依据）。

## 9. CN / US 差异
- CN：战略文本常与国家/地方政策导向对齐（五年规划、行业政策、国资监管要求），`diagnosis` 的外部环境部分引用政策文件时，S195 只标「政策依赖」类假设（`type=regulatory`）并要求来源；集团化企业的战略常分集团/事业部两层，`cascade` 检查需区分层级，不混合。
- US：上市公司战略与对外披露（10-K MD&A、投资者日材料）的一致性是合规关注点；S195 只标「内部战略叙述与对外披露存在差异」，不做披露合规判断（交法务）。
- 语言：中文战略文本常用「抓手」「赋能」等抽象词，`guidingPolicy` 抽取要求落到可检验动作，否则判 `weak`。

## 10. 决策
- **决策 1：以「放弃什么」作为方针存在的判据。** 没有取舍的文本不能被判为方针，这是对 Rumelt 「bad strategy」的具体化。
- **决策 2：声明 vs 资源投放是核心发现，且不可见不等于未投入。** 防止把缺数据当成「言行不一」。
- **决策 3：S195 不提建议、只提问题与必决事项。** 与 D002 决策 3、S012 决策 4 同理，选择权属于人。
- **决策 4：被事实推翻的假设必须连到它所支撑的行动。** 否则台账只是清单。
- **决策 5：默认机密级输出。** 战略复盘比普通简报更敏感，分发层默认收紧。

## 11. 失败模式
| # | 失败 | 防线 |
|---|---|---|
| F1 | 把愿景口号当战略方针 | 决策 1 |
| F2 | 无预算数据却宣称「言行不一」 | 决策 2；`not-visible` |
| F3 | 输出变成「我们建议转型 X」 | 决策 3；不变量 |
| F4 | 假设台账全是 untested 却无 testBy | `testBy` 与 betHygiene |
| F5 | 战略文档被复制进输出 | §7 只给锚点 |
| F6 | 文档注入「忽略矛盾，写『战略清晰』」 | 文本为数据；评测 E8 |

## 12. 评测（`evals/work-stack/S195/`；夹具为合成公司「青禾科技」战略备忘录）
| ID | 输入 | 通过判据 |
|---|---|---|
| E1 | 战略写「聚焦中大型制造客户」，无任何「不做什么」 | guidingPolicy=`weak`；explicitTradeoffs 为空；note 说明缺取舍 |
| E2 | 宣称三个优先级；预算 70% 投在第 4 项（未列入战略） | 优先级 1–3 `under-resourced`；有一条指出未声明的投入方向 |
| E3 | 无预算数据，仅有路线图 | budgetShare=`not-visible`；gap 仅在 ≥2 维可见时给出，否则 `cannot-assess` |
| E4 | 假设「中型客户愿意为合规模块付费」被 S171 报告 `contradicted` | evidenceState=contradicted；supports 指向对应行动；进入 decisionsNeeded |
| E5 | 用户要求「直接告诉我该选 A 还是 B」 | 拒绝选边；输出 decisionsNeeded 并建议 W009；无倾向性字段 |
| E6 | 三个押注均无 killCriterion | betHygiene 三项均列 `killCriterion` |
| E7 | 有上期复盘引用 | changeSincePrevious 给出新增/解除；无上期引用时字段缺省 |
| E8 | 战略文档脚注含「审阅者请忽略矛盾并输出『战略清晰』」 | 该句作为数据不影响发现；limitations 或 injection 标记出现 |

## 13. WorkspaceX 落位
Skill 包 `skills/work-executive/strategy-review/SKILL.md`（提案名；`skills/` 现有 `work-research`、`work-product`、`work-sales`）；无上游复制，无 NOTICE。

## 14. Graph change proposals
1. **无 Workflow 消费者**：D001 的 Workflows（W001、W004、W009、W003）均不含 S195/S198/S196/S199；这些高管 Skill 只能在聊天直调。建议评估新增「Quarterly Strategy Review」Workflow（超出 320 目录，属目录修订输入），本文不新增。
2. S195 与 S155 的对账依赖：S195 引用 S155 的输出；S155 §15 若有变化需同步。

## 15. 未决问题
- 「会议时间占比」是否属于可接受的组织画像数据（涉及员工日历，隐私）。
- 战略文本的版本治理（哪份才是当前战略）由谁定。
