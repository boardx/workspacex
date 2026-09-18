import { describe, expect, it, vi } from "vitest";
import type { ModelCallPort } from "../../src/application/agent-run/ports";
import { completeInterviewSkill } from "../../src/infrastructure/interview/workflow/interview-skill-completion";

const input = { modelProvider: "test", modelId: "test", system: "JSON only", user: "current context" };
const context = { step: "topic", request: "关于江西足球生成主题", topic: "江西足球" };
function model(...topics: string[]) {
  const complete = vi.fn<ModelCallPort["complete"]>();
  for (const topic of topics) complete.mockResolvedValueOnce({ text: JSON.stringify({ topic }) });
  return { complete };
}
describe("interview topic refinement", () => {
  it("repairs an echoed topic once and preserves the model's substantive revision", async () => {
    const refined = "江西校园足球参与：学生、教练与家长如何看待参与障碍及训练支持需求？";
    const provider = model("江西足球", refined);
    const result = await completeInterviewSkill(provider, input, context);
    expect(JSON.parse(result.text).topic).toBe(refined);
    expect(provider.complete).toHaveBeenCalledTimes(2);
    expect(provider.complete.mock.calls[1]![0].user).toBe(input.user);
  });
  it("fails closed after repeated echoes, including punctuation-only changes", async () => {
    const provider = model("江西足球", "江西足球。 ");
    await expect(completeInterviewSkill(provider, input, context)).rejects.toThrow("DEPENDENCY_UNAVAILABLE");
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });
  it("repairs keyword extraction when the user changes the research direction", async () => {
    const refined = "江西足球青训参与者的经历、阻碍与支持需求";
    const provider = model("江西足球", refined);
    const result = await completeInterviewSkill(provider, input, { ...context, topic: "欧洲贸易" });
    expect(JSON.parse(result.text).topic).toBe(refined);
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });
  it("accepts a new topic immediately", async () => {
    const provider = model("江西足球青训参与者的经历、阻碍与支持需求");
    await completeInterviewSkill(provider, input, context);
    expect(provider.complete).toHaveBeenCalledTimes(1);
  });
  it("does not reinterpret an explicit rename or another step as topic refinement", async () => {
    for (const ctx of [{ ...context, request: "主题改为江西足球" }, { ...context, step: "experts" }]) {
      const provider = model("江西足球");
      await completeInterviewSkill(provider, input, ctx);
      expect(provider.complete).toHaveBeenCalledTimes(1);
    }
  });
  it("does not retry provider failures", async () => {
    const complete = vi.fn<ModelCallPort["complete"]>().mockRejectedValue(new Error("provider unavailable"));
    await expect(completeInterviewSkill({ complete }, input, context)).rejects.toThrow("provider unavailable");
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
