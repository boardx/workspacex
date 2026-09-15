/**
 * `/agent/team4` 投后管理报告 AI 生成单元 —— ad-hoc MVP 契约束。
 *
 * ## 这是 ad-hoc，不是 phase feature（读这段再改）
 *
 * 人类明确要求这是一个**临时 agent，后面要删**：走
 * `.harness/instructions/ad-hoc-fix-pr-sop.md`，不进任何 `feature_list.json`。
 * 完整需求（八类材料/十二个财务指标/五类风险判据/报告模板）见
 * `phases/phase-17-post-investment-report-agent/requirements/`，那份是**参考材料**，
 * 本契约只落地其中"测试 A：单份材料显性风险识别"这一小片可验收范围——
 * 详见 `docs/adhoc/team4-post-investment-agent-mvp-backlog.md` 的边界声明。
 *
 * ## 范围：单份文本，同步返回，不落库
 *
 * 输入是**已经是文本**的材料（MVP 不做文件解析，前端是一个粘贴框）；输出**不持久化**——
 * 这个 Agent 本身就要被删，没有"报告归档"的必要。
 *
 * ## 派生数值算在哪
 *
 * `metrics[].yoyPct` 由服务端纯函数算（见 `derive-financial-metrics.ts`），模型只负责
 * 抽取原始数值与定性判断风险——这样"同一段材料跑三次，数值一致"才有保证，不依赖模型
 * 每次心算都对。
 */
import { z } from "zod";

/** 财务指标集的 MVP 子集：测试 A 只需要这四项（营收/净利润/毛利率/经营性现金流）。 */
export const FinancialMetricKey = z.enum(["revenue", "netProfit", "grossMarginPct", "operatingCashFlow"]);

export const FinancialMetric = z
  .object({
    key: FinancialMetricKey,
    label: z.string(),
    /** 本期数值（原始单位，如"万元"/"%"），保留材料原文写法，不做单位换算。 */
    currentValue: z.string(),
    /** 对比期数值；材料未提供同比基期时为 null（不得由模型编造）。 */
    priorValue: z.string().nullable(),
    /** 同比/环比变动百分比，服务端算出；两值均无法转成数字时为 null。 */
    yoyPct: z.number().nullable(),
    /** 支撑该数值的原文片段（MVP：整段引用，不是页码/bbox 级定位）。 */
    evidenceQuote: z.string(),
  })
  .strict();

export const RiskKind = z.enum(["显性", "隐性", "跨文件关联"]);

/** 风险清单固定四列 + 类型，对齐
 * `phases/phase-17-post-investment-report-agent/requirements/03-analysis-standard-and-evidence.md` C 节。
 * MVP 只产出 `显性`（跨文件关联/隐性需要多文件材料包，测试 B/C 才需要，本轮不做）。 */
export const PostInvestmentRisk = z
  .object({
    id: z.string(),
    issue: z.string(),
    reason: z.string(),
    evidenceQuote: z.string(),
    kind: RiskKind,
  })
  .strict();

export const operations = {
  /**
   * 测试 A 的最小闭环：粘贴单份材料文本 → 财务指标抽取 + 显性风险清单。
   *
   * 鉴权：任何登录用户可用（同 `submitFeedback` 的宽松先例）——这个 Agent 不做
   * 组织级持久化，未登录调用直接 401，不做单独的"游客只读落地页"产品化设计。
   *
   * 失败：模型不可用或输出解析不出结构化 JSON ⇒ `ANALYSIS_FAILED`——不静默回退成
   * 空清单（那等于让用户以为"分析完了、没发现问题"，比报错更危险）。
   */
  analyzePostInvestmentMaterial: {
    method: "POST",
    path: "/post-investment/analyze",
    in: z.object({ text: z.string().min(1).max(50_000) }).strict(),
    out: z
      .object({
        metrics: z.array(FinancialMetric),
        risks: z.array(PostInvestmentRisk),
        /** 模型认为材料信息不足以判断、需要人核实的点（不进风险清单，避免与"矛盾"混为一类）。 */
        needsVerification: z.array(z.string()),
      })
      .strict(),
    err: ["ANALYSIS_FAILED", "DEPENDENCY_UNAVAILABLE"] as const,
  },
} as const;
