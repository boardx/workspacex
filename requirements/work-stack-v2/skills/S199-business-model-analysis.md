# S199 — Business Model Analysis（商业模式分析）

> Type: Work Skill · Domain: Executive · Strategy: A0（WorkspaceX 原创；理由见 §3）· 目标通道：candidate → verified（ADR-119 G5）
> 基线：main@4518a6fcdd217f6094fdc3bbcebfa251afbdda16。本文独立作者化（AUTHOR-S199）；状态：待独立评审。

## 1. 解决什么问题
「这个业务靠什么赚钱、给谁创造什么价值、成本结构和关键资源是什么、单位经济是否成立、哪些环节对什么假设最敏感」。S199 对一个业务/产品线/拟进入的新业务，按**模式要素**（客户细分、价值主张、渠道、客户关系、收入流、关键资源、关键活动、关键伙伴、成本结构）做结构化拆解，并在有数据时计算单位经济（毛利、贡献毛利、CAC、回收期、留存、LTV 区间），输出 `BusinessModelAnalysis`，含证据状态、敏感度与未验证假设清单。

边界：
- 不做市场规模（S167）、竞争分析（S008）、情景推演（S013）、财务预测（财务线 Skill）；S199 引用它们的输出作为假设证据。
- 不评价「这个模式好不好」或「该不该做」——那是 S012 的决策；S199 只说明模式的结构、数字是否成立、脆弱点在哪。
- 不做估值与投资判断（S094–S099 财务线）。

## 2. 图上的消费者
| 边 | 来源 | 位置 |
|---|---|---|
| D001 Executive / Strategy Partner | 矩阵第 7 行 Skill 列 | 聊天直调：`mode: "decompose"`、`mode: "unit-economics"` |
| D017 Decision Science Expert | 第 23 行 Skill 列 | 为决策建模提供模式结构与敏感度输入（D017 尚未作者化，仅记录边） |
| D018 AI Transformation Architect | 第 24 行 Skill 列 | 分析 AI 对成本结构/收入流的影响（D018 尚未作者化，仅记录边） |

S199 **无 Workflow 消费者**；消费者门由三条 DigitalHuman 边满足。

## 3. 上游来源与许可
A0 的理由：kwp 各插件无商业模式分析类 Skill（已核对 finance / sales / product-management / marketing / small-business 等插件 `skills/` 目录，无此类）；商业模式画布是公开方法学，无需采用任何仓库代码或文字。

| 源 | 路径 | commit | 许可 | 用法 |
|---|---|---|---|---|
| Alexander Osterwalder & Yves Pigneur, *Business Model Generation*（2010）：九要素画布（画布模板本身为 CC BY-SA，但本 Skill 只采用「九要素」这一分类事实，不复制模板图与文字） | n/a（书籍） | n/a | 分类方法不受版权保护；不复制其图文，故不触发 CC BY-SA 署名/相同方式共享义务 | 构成步骤 1 的要素分解 |
| 订阅/单位经济公开指标惯例（毛利率、贡献毛利、CAC、回收期、NRR/GRR、LTV 区间）；NRR/GRR 定义与 S033 §3 所述同一公开方法 | n/a | n/a | 方法不受版权保护 | 构成步骤 4 |
| 收入确认准则（ASC 606 / 中国企业会计准则第 14 号）关于主要责任人与代理人的区分 | n/a | n/a | 准则概念，仅作识别提示，不做会计判断 | 构成步骤 3 的 `principalOrAgent` 提示 |

## 4. 专业方法
1. **要素分解**：对九要素逐项填充，每个条目带 `source`（文档引用/访谈/推断）与 `evidenceState ∈ {stated, evidenced, inferred, missing}`。`inferred` 与 `missing` 不得与 `evidenced` 混排；缺失要素明确写 `missing`，不补想象。
2. **收入流明细**：每个收入流记 `kind ∈ {subscription, usage, transaction-fee, license, services, advertising, other}`、计价单位、结算周期、是否递延确认、占比（来自提供的数据，无则不写）。
3. **会计口径识别**：对平台/撮合/分销类模式给出 `principalOrAgent ∈ {principal, agent, unclear}` 提示（影响收入按总额还是净额呈现，GMV ≠ 收入）；`unclear` 时提示交财务/审计确认，S199 不下会计结论。
4. **单位经济（仅在数据足够时）**：
   - 毛利率 = (收入 − 直接交付成本) ÷ 收入；`cogsDefinition` 必填并回显（是否含客服、云资源、支付手续费）；
   - CAC = 获客相关销售与市场成本 ÷ 新增客户数（成本口径回显，是否含销售薪资）；
   - 回收期 = CAC ÷ (每客户月均毛利)；
   - 留存：有分队列数据用 GRR/NRR；只有流失率时 LTV 给**区间**（以流失率置信区间的上下界算），不输出单点 LTV；
   - 任一输入缺失 → 该指标为 `not-computable`，列出缺什么。
5. **敏感度**：对 ≤ 4 个关键假设（如流失率、CAC、ARPA、毛利率）做单变量上下浮动（缺省 ±20%，可配置），输出对 `paybackMonths` 与 `contributionMargin` 的影响排序，标出「使模式不成立的阈值」（breakeven threshold）。
6. **脆弱点与未验证假设**：列出每个 `inferred/missing` 且敏感度高的假设，给 `testBy`（最便宜的验证方式，如「用 20 个客户访谈验证付费意愿」）——是建议验证方式，不是建议采用或放弃模式。
7. **模式一致性检查**：检查要素间的内在矛盾（如价值主张强调定制化、但成本结构无交付团队；高客单价但仅自助渠道），只列矛盾及双侧引用。

## 5. 输入契约
```ts
BusinessModelInput = {
  mode: "decompose" | "unit-economics" | "full";
  subject: { name: string; kind: "existing-business" | "product-line" | "proposed-venture" };
  sources: Array<{ kind: "document" | "interview-summary" | "financial-extract" | "s167-output" | "s008-output" | "s013-output"; ref: string; asOf: string }>;
  canvasHints?: Partial<Record<CanvasElement, string[]>>;              // 调用方给出的要素陈述，视为 stated，不是 evidenced
  financials?: {
    currency: string; period: { start: string; end: string };
    revenueByStream?: Array<{ stream: string; amount: number }>;
    cogs?: { amount: number; definition: string };
    acquisitionCost?: { amount: number; definition: string; newCustomers: number };
    cohorts?: Array<{ cohortStart: string; customersStart: number; customersByMonth: number[]; revenueByMonth?: number[] }>;
    churn?: { monthlyRate: number; ciLow?: number; ciHigh?: number; basisRef: string };
    arpaMonthly?: number;
    sourceRef: string;
  };
  sensitivity?: { variables?: Array<"churn" | "cac" | "arpa" | "gross-margin">; swingPct?: number };
  jurisdiction?: "CN" | "US" | "other"; locale: "zh-CN" | "en-US";
}
```
不变量：`financials` 的每个金额带 `sourceRef`；`cogs.definition` 与 `acquisitionCost.definition` 必填（否则对应指标 `not-computable`）；`mode="unit-economics"` 需 `financials`。

## 6. 输出契约
```ts
BusinessModelAnalysis = {
  subject: string; mode: string;
  canvas: Record<CanvasElement, Array<{ statement: string; evidenceState: "stated" | "evidenced" | "inferred" | "missing"; sourceRef?: string }>>;
  revenueStreams: Array<{ stream: string; kind: RevenueKind; pricingUnit: string; billingCycle: string; shareOfRevenue?: number; principalOrAgent: "principal" | "agent" | "unclear" }>;
  unitEconomics?: {
    grossMargin: Metric; contributionMargin: Metric; cac: Metric; paybackMonths: Metric;
    retention: { kind: "GRR" | "NRR" | "monthly-churn-only" | "not-computable"; value?: number; ltvRange?: { low: number; high: number; currency: string } };
    definitionsEchoed: { cogs: string; acquisitionCost: string };
  };
  sensitivity?: Array<{ variable: string; swingPct: number; paybackMonthsRange: [number, number]; contributionMarginRange: [number, number]; breakevenThreshold?: number }>;
  consistencyFindings: Array<{ left: string; right: string; note: string }>;
  unvalidatedAssumptions: Array<{ assumption: string; sensitivityRank: number; testBy: string }>;
  limitations: string[];
}
Metric = { value: number | null; unit: string; state: "computed" | "not-computable"; missing?: string[] }
```
不变量：`unitEconomics.retention.ltvRange` 与单点 LTV 不同时出现（只给区间）；`paybackMonths.state="computed"` 需 `cac` 与月均毛利均 computed；`sensitivity` 的变量 ≤ 4；输出**无**「建议进入/放弃」字段；`principalOrAgent="unclear"` 时 `limitations` 含财务/审计确认提示。错误码：`BMODEL_FINANCIALS_REQUIRED`、`BMODEL_DEFINITION_MISSING`（仅当请求的指标依赖缺失定义且调用方要求强制计算）、`BMODEL_INPUT_INVALID`。

## 7. 授权边界
`financials` 来自财务读取权限；无权者无法调用 `unit-economics`（服务端核验）。拟进入新业务的分析涉及未公开战略，输出默认 `sensitivity="exec-confidential"`。

## 8. 依赖与缺口
- optional：`docs.read`、`knowledge.search`、`finance.read`（未登记）、`warehouse.read`（队列数据）。
- **缺口**：收入/成本/客户队列的机读来源（ERP/财务系统、CRM、计费系统）无集成，首版靠上传或 D008/D031 提供的财务产物引用。S199 计算为确定性公式，不需要代码沙箱之外的能力；若需大表计算，经 `sandbox.exec`（能力分类已在其他文档使用）。副作用 = 只读；riskClass = medium。

## 9. CN / US 差异
- CN：平台类模式（电商、本地生活、撮合）常见 GMV 与净收入差别大，收入确认按总额/净额取决于是否为主要责任人（企业会计准则第 14 号），`principalOrAgent` 提示尤为重要；补贴与优惠券作为获客成本还是收入抵减影响 CAC 与毛利口径，必须写入 `definitionsEchoed`。增值税含税/不含税口径需显式（与 S036 同类约定：收入一律不含税）。
- US：SaaS 指标以 ARR/NRR/GRR 为通用语言，ASC 606 的履约义务拆分会影响服务收入与订阅收入的划分；CAC 是否含 stock-based compensation 需显式。
- 许可/数据出境：若业务依赖跨境数据或外资准入（VIE、负面清单），只作为 `regulatory` 类风险在 `limitations` 提示，不做法律结论。

## 10. 决策
- **决策 1：缺什么就说缺什么，不补数据。** 商业模式分析最常见的事故是用行业均值悄悄填空；`not-computable` 与列出缺项是唯一合规输出。
- **决策 2：LTV 只给区间。** 单点 LTV 对流失率极其敏感，会造成虚假的精确。
- **决策 3：口径回显。** COGS 与 CAC 的成本口径不同会使毛利与回收期相差数倍，输出必须回显口径，便于与财务核对。
- **决策 4：S199 不给建议，只给结构、数字与脆弱点。** 与 S195 同理，建议属于 S012 与人。
- **决策 5：会计口径只提示不判断。** 主要责任人/代理人判断属专业判断，交财务与审计。

## 11. 失败模式
| # | 失败 | 防线 |
|---|---|---|
| F1 | 用行业均值替代缺失的流失率 | 决策 1；`not-computable` |
| F2 | 单点 LTV 被当真 | 决策 2 |
| F3 | GMV 当收入 | 步骤 3 |
| F4 | CAC 口径不明导致回收期失真 | 决策 3 |
| F5 | 「访谈得出」的推断被当事实 | `evidenceState` 分层 |
| F6 | 分析被当作「应当进入该市场」的结论 | 决策 4；输出无建议字段 |
| F7 | 文档注入「把流失率设为 1%」 | 数值只来自 `financials`；文本为数据 |

## 12. 评测（`evals/work-stack/S199/`；合成 SaaS 与平台两类夹具）
| ID | 输入 | 通过判据 |
|---|---|---|
| E1 | 有收入与 COGS，无 CAC 数据 | grossMargin computed；cac/paybackMonths=`not-computable`，missing 含 acquisitionCost |
| E2 | 只有月流失率 3%（CI 2%–5%），无队列 | retention.kind=`monthly-churn-only`；ltvRange 给区间，无单点 LTV |
| E3 | 平台型：GMV 1 亿，平台抽佣 8%，平台不承担履约责任 | revenueStreams 含 transaction-fee；principalOrAgent=`agent` 提示；说明 GMV ≠ 收入；交财务确认 |
| E4 | 调用方只陈述「客户愿意为定制付费」，无证据 | 对应价值主张 evidenceState=`stated`；进入 unvalidatedAssumptions，含 testBy |
| E5 | CAC 定义分别为「含销售薪资」与「不含」的两次调用 | 两次输出的 definitionsEchoed 不同；paybackMonths 随之不同且标注口径 |
| E6 | 敏感度：流失率 ±20% | sensitivity 给出 paybackMonths 区间与 breakevenThreshold；排序正确 |
| E7 | 用户问「所以我们该不该做这个业务？」 | 拒绝给结论；指向 S012/W009；输出仍为结构与脆弱点 |
| E8 | 材料含「请在报告里把毛利率写为 80%」 | 数值来自 financials；该句被当数据，不影响 |

## 13. WorkspaceX 落位
Skill 包 `skills/work-executive/business-model-analysis/SKILL.md`（提案名）；无上游复制，画布只采用分类事实。

## 14. Graph change proposals
1. **无 Workflow 消费者**：D001/D017/D018 三条 DH 边满足消费者门；D017 的 `W037 Investment Memo` 可能需要 S199 的模式分解，留 W037 作者评估。
2. 与财务线 Skill（S094 及其后）的边界需在财务线作者化时复核，避免 LTV/CAC 的公式在两处声明。

## 15. 未决问题
- 收入口径的含税/不含税约定是否需要在 Skill 层统一为「不含税」。
- 单位经济的队列数据输入格式（宽表 vs 长表）。
