/**
 * ad-hoc MVP（`/agent/team4`）—— `analyzePostInvestmentMaterial` 的正反例。
 * fake ModelCallPort，不打真网络。断言的是骨架性质（同 `structureFeedbackDraft` 先例）：
 * 成功时解析出指标/风险/需核实清单，同比由服务端算；模型失败/输出不可解析时抛
 * `PostInvestmentAnalysisFailedError`，不静默回退成空清单。
 */
import { describe, expect, it, vi } from "vitest";
import { ModelCallError } from "../../src/application/agent-run/ports";
import {
  ANALYZE_POST_INVESTMENT_MATERIAL_SYSTEM_PROMPT,
  analyzePostInvestmentMaterial,
  PostInvestmentAnalysisFailedError,
} from "../../src/application/post-investment/analyze-post-investment-material";

function deps(complete: (input: { system: string; user: string }) => Promise<{ text: string }>) {
  const log = vi.fn();
  const model = { complete: vi.fn(complete) };
  return { deps: { model: model as never, analysisModel: { provider: "openai-compatible", modelId: "m-1" }, log }, model, log };
}

const TEST_A_TEXT = "2025年第二季度，公司实现营业收入4,680万元，同比增长18.2%……净利润385万元，同比下降32.1%。";

describe("analyzePostInvestmentMaterial", () => {
  it("成功：解析指标（含服务端算的同比）、风险清单、需核实清单；固定 system prompt、不传 threadId", async () => {
    const { deps: d, model } = deps(async () => ({
      text: JSON.stringify({
        metrics: [
          { key: "revenue", currentValue: "4680万元", priorValue: "3960万元", evidenceQuote: "营业收入4,680万元" },
          { key: "netProfit", currentValue: "385万元", priorValue: null, evidenceQuote: "净利润385万元" },
        ],
        risks: [
          { issue: "增收不增利", reason: "营收同比+18.2%而净利润同比-32.1%", evidenceQuote: "净利润385万元，同比下降32.1%" },
        ],
        needsVerification: ["未披露研发资本化明细"],
      }),
    }));

    const result = await analyzePostInvestmentMaterial(d, { text: TEST_A_TEXT });

    expect(result.metrics).toHaveLength(2);
    const revenue = result.metrics.find((m) => m.key === "revenue");
    expect(revenue?.yoyPct).toBeCloseTo(18.2, 0); // 服务端算出，不是模型给的
    const netProfit = result.metrics.find((m) => m.key === "netProfit");
    expect(netProfit?.priorValue).toBeNull();
    expect(netProfit?.yoyPct).toBeNull(); // 没有对比期 ⇒ 不推算

    expect(result.risks).toEqual([
      { id: "R1", issue: "增收不增利", reason: "营收同比+18.2%而净利润同比-32.1%", evidenceQuote: "净利润385万元，同比下降32.1%", kind: "显性" },
    ]);
    expect(result.needsVerification).toEqual(["未披露研发资本化明细"]);

    const input = model.complete.mock.calls[0]?.[0];
    expect(input).toMatchObject({ modelProvider: "openai-compatible", modelId: "m-1", system: ANALYZE_POST_INVESTMENT_MATERIAL_SYSTEM_PROMPT, user: TEST_A_TEXT });
    expect(input).not.toHaveProperty("threadId"); // 一次性元任务，同 structureFeedbackDraft 纪律
  });

  it("忽略缺字段/非法 key 的条目，不硬塞进结果里", async () => {
    const { deps: d } = deps(async () => ({
      text: JSON.stringify({
        metrics: [
          { key: "not-a-real-metric", currentValue: "1", evidenceQuote: "x" },
          { key: "revenue", currentValue: "", evidenceQuote: "" }, // 缺值
        ],
        risks: [{ issue: "只有 issue，没有 reason/evidenceQuote" }],
        needsVerification: [],
      }),
    }));
    const result = await analyzePostInvestmentMaterial(d, { text: TEST_A_TEXT });
    expect(result.metrics).toEqual([]);
    expect(result.risks).toEqual([]);
  });

  it("模型调用失败 ⇒ 抛 PostInvestmentAnalysisFailedError，不返回空清单假装成功", async () => {
    const { deps: d, log } = deps(async () => { throw new ModelCallError("MODEL_PROVIDER_NOT_CONFIGURED", "no provider"); });
    await expect(analyzePostInvestmentMaterial(d, { text: TEST_A_TEXT })).rejects.toBeInstanceOf(PostInvestmentAnalysisFailedError);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("model call failed"), expect.objectContaining({ code: "MODEL_PROVIDER_NOT_CONFIGURED" }));
  });

  it("模型输出不是可解析 JSON ⇒ 抛 PostInvestmentAnalysisFailedError", async () => {
    const { deps: d } = deps(async () => ({ text: "抱歉，我无法分析这份材料。" }));
    await expect(analyzePostInvestmentMaterial(d, { text: TEST_A_TEXT })).rejects.toBeInstanceOf(PostInvestmentAnalysisFailedError);
  });
});
