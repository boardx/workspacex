/**
 * UC-17.8 B5.1 —— `ModelDraftRefiner`：走 `ModelCallPort.complete` 的三次调用（澄清问题 / 回复 /
 * 摘要）的正反例。fake port，不打真网络。断言的是**性质**：prompt 里带 kind/字段/正文/历史；
 * 失败与不可解析退回固定回执并如实标 `fallback`；摘要按 kind 严格解析、覆盖同名保留其余。
 */
import { describe, expect, it, vi } from "vitest";
import { ModelCallError } from "../../src/application/agent-run/ports";
import {
  DRAFT_REFINE_CHAT_SYSTEM_PROMPT,
  DRAFT_REFINE_SUMMARY_SYSTEM_PROMPT,
  ModelDraftRefiner,
  REFINE_ACK,
  REFINE_SEED_QUESTION,
  type DraftRefineContext,
} from "../../src/application/feedback/drafts/draft-refine-model";

const CTX: DraftRefineContext = {
  kind: "缺陷",
  detail: "导出 PDF 会卡住",
  structured: { reproSteps: "1. 点导出" },
  chat: [
    { role: "ai", kind: "message", text: "只在 PDF 吗？", at: "2026-09-05T00:00:00.000Z", source: "model" },
    { role: "user", kind: "edit", text: "导出 PDF 会卡住", at: "2026-09-05T00:00:01.000Z" },
    { role: "user", kind: "message", text: "只有 PDF，Chrome 每次都卡", at: "2026-09-05T00:00:02.000Z" },
  ],
};

function refiner(complete: (input: { system: string; user: string; modelProvider: string; modelId: string }) => Promise<{ text: string }>) {
  const log = vi.fn();
  const model = { complete: vi.fn(complete) };
  const r = new ModelDraftRefiner({ model: model as never, structureModel: { provider: "openai-compatible", modelId: "m-1" }, log });
  return { r, model, log };
}

describe("B5.1 ModelDraftRefiner", () => {
  it("澄清问题 / 回复：prompt 带 kind、已填字段、正文、按序的对话历史（不含 edit 记录）；固定 provider/model；成功 ⇒ source=model", async () => {
    const { r, model } = refiner(async () => ({ text: "  除了 PDF，导出 Excel 也会吗？  " }));
    const seed = await r.seedQuestion(CTX);
    expect(seed).toEqual({ text: "除了 PDF，导出 Excel 也会吗？", source: "model" });
    const input = model.complete.mock.calls[0]?.[0];
    expect(input).toMatchObject({ modelProvider: "openai-compatible", modelId: "m-1", system: DRAFT_REFINE_CHAT_SYSTEM_PROMPT });
    expect(input?.user).toContain("类型：缺陷");
    expect(input?.user).toContain("导出 PDF 会卡住");
    expect(input?.user).toContain('"reproSteps":"1. 点导出"');
    expect(input?.user).toContain("助手：只在 PDF 吗？");
    expect(input?.user).toContain("提交人：只有 PDF，Chrome 每次都卡");
    expect(input?.user).not.toContain("提交人：导出 PDF 会卡住"); // edit 记录不是对话
    expect(input?.user.indexOf("助手：只在 PDF 吗？")).toBeLessThan(input?.user.indexOf("提交人：只有 PDF") ?? -1);
    // 不传 threadId——同 structureFeedbackDraft 的纪律
    expect(input).not.toHaveProperty("threadId");

    const reply = await r.reply(CTX);
    expect(reply.source).toBe("model");
  });

  it("模型抛错 / 输出为空 ⇒ 退回固定回执，source=fallback，记日志，不抛", async () => {
    const failing = refiner(async () => { throw new ModelCallError("MODEL_PROVIDER_NOT_CONFIGURED", "no provider"); });
    expect(await failing.r.seedQuestion(CTX)).toEqual({ text: REFINE_SEED_QUESTION, source: "fallback" });
    expect(await failing.r.reply(CTX)).toEqual({ text: REFINE_ACK, source: "fallback" });
    expect(failing.log).toHaveBeenCalledWith(expect.stringContaining("falling back"), expect.objectContaining({ code: "MODEL_PROVIDER_NOT_CONFIGURED" }));

    const empty = refiner(async () => ({ text: "   " }));
    expect(await empty.r.reply(CTX)).toEqual({ text: REFINE_ACK, source: "fallback" });
  });

  it("摘要：按 kind 严格解析；摘出来的覆盖同名、没摘的保留原值；接受包在 structured 键下的形状", async () => {
    const { r, model } = refiner(async () =>
      ({ text: '好的：{"structured":{"reproFrequencyEnv":"每次 · Chrome","reproSteps":"1. 打开导出\\n2. 选 PDF","useScenario":"不该在缺陷里"}}' }),
    );
    const out = await r.summarize(CTX);
    expect(out.source).toBe("model");
    expect(out.structured).toEqual({ reproFrequencyEnv: "每次 · Chrome", reproSteps: "1. 打开导出\n2. 选 PDF" });
    expect(model.complete.mock.calls[0]?.[0]).toMatchObject({ system: DRAFT_REFINE_SUMMARY_SYSTEM_PROMPT });
    expect(model.complete.mock.calls[0]?.[0].user).toContain("提交人：只有 PDF，Chrome 每次都卡");
  });

  it("摘要：直接给字段（不包 structured）也认；保留原值中模型没提的键", async () => {
    const { r } = refiner(async () => ({ text: '{"expectedResult":"导出完成"}' }));
    const out = await r.summarize(CTX);
    expect(out).toEqual({ structured: { reproSteps: "1. 点导出", expectedResult: "导出完成" }, source: "model" });
  });

  it("摘要：不可解析 / 只有别的 kind 的键 / 模型抛错 ⇒ 保留原值，source=fallback", async () => {
    const garbage = refiner(async () => ({ text: "我不知道" }));
    expect(await garbage.r.summarize(CTX)).toEqual({ structured: CTX.structured, source: "fallback" });
    const wrongKind = refiner(async () => ({ text: '{"useScenario":"x"}' }));
    expect(await wrongKind.r.summarize(CTX)).toEqual({ structured: CTX.structured, source: "fallback" });
    const failing = refiner(async () => { throw new Error("timeout"); });
    expect(await failing.r.summarize(CTX)).toEqual({ structured: CTX.structured, source: "fallback" });
  });
});
