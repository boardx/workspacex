import { ModelGuidedResearchCheckpointGenerator } from "../../src/application/research/model-guided-checkpoint-generator";
import { describe, expect, it, vi } from "vitest";
import { withGuidedThinkingPolicy } from "../../src/application/research/guided-thinking-policy";
import type { ModelCallInput } from "../../src/application/agent-run/ports";

describe("guided research thinking decisions", () => {
  it.each(["plan", "source_relevance", "evidence", "chapter", "quality", "synthesis"])("disables hidden thinking for grounded %s work without changing content or cancellation", async (stage) => {
    const complete = vi.fn().mockResolvedValue({ text: "{}" });
    const completeStream = vi.fn(async (_input: ModelCallInput, emit: (text: string) => Promise<void>) => { await emit("正文"); return { text: "正文" }; });
    const policy = withGuidedThinkingPolicy({ complete, completeStream });
    const input = { modelProvider: "p", modelId: "m", system: "quality gates intact", user: JSON.stringify({ reportStage: stage }), signal: new AbortController().signal };
    await policy.complete(input);
    const emit = vi.fn().mockResolvedValue(undefined);
    await policy.completeStream!(input, emit);
    expect(complete).toHaveBeenCalledWith({ ...input, thinkingMode: "off" });
    expect(completeStream).toHaveBeenCalledWith({ ...input, thinkingMode: "off" }, emit);
    expect(emit).toHaveBeenCalledWith("正文");
    expect(input).not.toHaveProperty("thinkingMode");
  });
  it("applies the decision through compatibility direction and outline endpoints", async () => {
    const complete = vi.fn().mockResolvedValueOnce({ text: JSON.stringify([{ id: "d1", title: "方向", description: "研究目标", enabled: true, order: 0 }]) }).mockResolvedValueOnce({ text: JSON.stringify([{ id: "o1", title: "章节", questions: ["问题"], enabled: true, order: 0 }]) });
    const generator = new ModelGuidedResearchCheckpointGenerator({ complete });
    const directions = await generator.generateDirections({ topic: "主题", goal: "目标", timeRange: "", region: "", focus: "" });
    await generator.generateOutline(directions);
    expect(complete).toHaveBeenCalledTimes(2);
    for (const [input] of complete.mock.calls) expect(input.thinkingMode).toBe("off");
  });
  it("does not invent streaming capability for a non-streaming adapter", () => {
    expect(withGuidedThinkingPolicy({ complete: vi.fn() }).completeStream).toBeUndefined();
  });
});
