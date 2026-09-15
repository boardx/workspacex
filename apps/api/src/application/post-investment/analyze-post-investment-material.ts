/**
 * `/agent/team4` MVP —— 测试 A 的最小闭环：粘贴单份材料文本，抽取财务指标
 * + 显性风险清单。骨架照抄 `structure-feedback-draft.ts` 的既有先例（固定 prompt +
 * `Promise.race` 超时 + JSON 容错解析），因为这是同一类"元任务"调用：一次性、
 * 不需要工具循环、不需要接续会话。
 *
 * ad-hoc MVP，不是 phase feature —— 见
 * `docs/adhoc/team4-post-investment-agent-mvp-backlog.md`。
 */
import type { z } from "zod";
import { postInvestmentReport as C } from "@repo/contracts";
import type { ModelCallPort } from "../agent-run/ports";
import { ModelCallError } from "../agent-run/ports";
import { computeYoyPct } from "./derive-financial-metrics";

export type FinancialMetric = z.infer<typeof C.FinancialMetric>;
export type FinancialMetricKey = z.infer<typeof C.FinancialMetricKey>;
export type PostInvestmentRisk = z.infer<typeof C.PostInvestmentRisk>;

/** 同 `FeedbackStructureModelConfig` 既有先例——接口形状声明在这里，唯一实现由组合根注入。
 *  MVP 直接复用既有的 `FEEDBACK_STRUCTURE_MODEL_CONFIG` 绑定（见 controller 头注），
 *  这里只声明依赖形状，不新增第二套模型选型配置。 */
export interface PostInvestmentAnalysisModelConfig {
  readonly provider: string;
  readonly modelId: string;
}

export interface AnalyzePostInvestmentMaterialDeps {
  readonly model: ModelCallPort;
  readonly analysisModel: PostInvestmentAnalysisModelConfig;
  readonly log: (message: string, detail: Record<string, unknown>) => void;
}

export interface AnalyzePostInvestmentMaterialInput {
  readonly text: string;
}

export interface AnalyzePostInvestmentMaterialResult {
  readonly metrics: readonly FinancialMetric[];
  readonly risks: readonly PostInvestmentRisk[];
  readonly needsVerification: readonly string[];
}

/** 模型不可用 / 输出解析不出结构化 JSON。**不静默回退成空清单**——那等于让用户以为
 *  "分析完了、没发现问题"，比报错更危险（见契约头注 `ANALYSIS_FAILED`）。 */
export class PostInvestmentAnalysisFailedError extends Error {
  constructor(readonly detail: string) {
    super("post-investment material analysis failed");
  }
}

/** 同 `STRUCTURE_FEEDBACK_DRAFT_TIMEOUT_MS` 的取值理由：用户点击后等待的一次调用，
 *  抽取一整份季度简报的财务指标 + 风险，给比"整理一段口述"更宽的超时。 */
export const ANALYZE_POST_INVESTMENT_MATERIAL_TIMEOUT_MS = 90_000;

const METRIC_LABELS: Record<FinancialMetricKey, string> = {
  revenue: "营业收入",
  netProfit: "净利润",
  grossMarginPct: "毛利率",
  operatingCashFlow: "经营性现金流净额",
};

export const ANALYZE_POST_INVESTMENT_MATERIAL_SYSTEM_PROMPT =
  "你是投后管理分析助手。用户会给你一份被投企业的经营/财务材料原文（可能是季度简报、" +
  "财务报表摘要等）。请只做两件事，不要下投资结论、不要给「建议投/建议退出」之类的评级：" +
  "1) 抽取四项财务指标——营业收入(revenue)、净利润(netProfit)、毛利率(grossMarginPct)、" +
  "经营性现金流净额(operatingCashFlow)：本期数值(currentValue)、材料中提到的对比期数值" +
  "(priorValue，原文没提供就填 null，不要编造)、支撑这两个数值的原文片段(evidenceQuote，" +
  "尽量逐字引用)。2) 识别材料中明确写出来的异常/风险信号（不要推测材料没写的事），每条给：" +
  "问题是什么(issue)、为什么属于问题(reason，比如「增收不增利」「现金流与利润背离」" +
  "「资本化比例远超行业惯例」这类判断)、材料中如何体现(evidenceQuote，原文片段)。" +
  "3) 如果有你判断不了、需要人工核实的点（比如缺少对比期数据、口径不清楚），放进" +
  "needsVerification，不要放进风险清单，也不要为了凑数编一条。" +
  "只输出一个 JSON 对象，不要任何解释性文字、不要 markdown 代码块标记。JSON 形如：" +
  '{"metrics":[{"key":"revenue","currentValue":"4680万元","priorValue":null,' +
  '"evidenceQuote":"..."}],"risks":[{"issue":"...","reason":"...","evidenceQuote":"..."}],' +
  '"needsVerification":["..."]}。metrics 的 key 只能是 revenue/netProfit/grossMarginPct/' +
  "operatingCashFlow 四者之一；材料完全没提到某项指标就不要输出该项，不要编造数值。";

function extractJsonObject(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("no JSON object found in model output");
  }
  return JSON.parse(text.slice(start, end + 1));
}

function toTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

const METRIC_KEYS: readonly FinancialMetricKey[] = ["revenue", "netProfit", "grossMarginPct", "operatingCashFlow"];

function parseMetrics(raw: unknown): FinancialMetric[] {
  if (!Array.isArray(raw)) return [];
  const out: FinancialMetric[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const key = METRIC_KEYS.find((k) => k === obj.key);
    const currentValue = toTrimmedString(obj.currentValue);
    const evidenceQuote = toTrimmedString(obj.evidenceQuote);
    if (!key || !currentValue || !evidenceQuote) continue;
    const priorValue = toTrimmedString(obj.priorValue);
    out.push({
      key,
      label: METRIC_LABELS[key],
      currentValue,
      priorValue,
      yoyPct: computeYoyPct(currentValue, priorValue),
      evidenceQuote,
    });
  }
  return out;
}

function parseRisks(raw: unknown): PostInvestmentRisk[] {
  if (!Array.isArray(raw)) return [];
  const out: PostInvestmentRisk[] = [];
  let seq = 0;
  for (const item of raw) {
    if (item === null || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const issue = toTrimmedString(obj.issue);
    const reason = toTrimmedString(obj.reason);
    const evidenceQuote = toTrimmedString(obj.evidenceQuote);
    if (!issue || !reason || !evidenceQuote) continue;
    seq += 1;
    // MVP 只处理单份材料，判不出跨文件关联/隐性所需的"行业常识对照"，一律标显性
    // ——测试 B/C 才需要另外两类，见 backlog 边界声明。
    out.push({ id: `R${seq}`, issue, reason, evidenceQuote, kind: "显性" });
  }
  return out;
}

function parseNeedsVerification(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((v): v is string => typeof v === "string" && v.trim() !== "").map((v) => v.trim());
}

export async function analyzePostInvestmentMaterial(
  deps: AnalyzePostInvestmentMaterialDeps,
  input: AnalyzePostInvestmentMaterialInput,
): Promise<AnalyzePostInvestmentMaterialResult> {
  let completion: { readonly text: string };
  try {
    completion = await Promise.race([
      deps.model.complete({
        modelProvider: deps.analysisModel.provider,
        modelId: deps.analysisModel.modelId,
        // 不传 threadId：一次性元任务，不是要接续的会话（同 structureFeedbackDraft 先例）。
        system: ANALYZE_POST_INVESTMENT_MATERIAL_SYSTEM_PROMPT,
        user: input.text,
      }),
      new Promise<never>((_resolve, reject) => {
        setTimeout(
          () => reject(new Error("post-investment analysis model call timed out")),
          ANALYZE_POST_INVESTMENT_MATERIAL_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (e) {
    const detail = e instanceof ModelCallError
      ? e.detail
      : e instanceof Error ? e.message : "unexpected model call failure";
    deps.log("post-investment material analysis model call failed", {
      modelProvider: deps.analysisModel.provider,
      modelId: deps.analysisModel.modelId,
      code: e instanceof ModelCallError ? e.code : "MODEL_CALL_FAILED",
      detail,
    });
    throw new PostInvestmentAnalysisFailedError(detail);
  }

  let parsed: unknown;
  try {
    parsed = extractJsonObject(completion.text);
  } catch (e) {
    const detail = e instanceof Error ? e.message : "unparseable model output";
    deps.log("post-investment material analysis: model output was not parseable JSON", { detail });
    throw new PostInvestmentAnalysisFailedError(detail);
  }

  const obj = parsed as Record<string, unknown>;
  return {
    metrics: parseMetrics(obj.metrics),
    risks: parseRisks(obj.risks),
    needsVerification: parseNeedsVerification(obj.needsVerification),
  };
}
