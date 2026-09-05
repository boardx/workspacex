import { describe, expect, it, vi } from "vitest";
import type { ModelCallPort } from "../../src/application/agent-run/ports";
import {
  GuidedResearchSkillError,
  ModelGuidedResearchSkill,
} from "../../src/application/research/guided-research-skill";

const input = {
  requestId: "turn-1",
  message: "把目标聚焦到进入策略",
  draft: {
    node: "brief" as const,
    value: {
      topic: "欧洲储能",
      goal: "判断市场",
      timeRange: "2024-2027",
      region: "欧盟",
      focus: "政策和并网",
    },
  },
};

describe("model-backed guided research skill", () => {
  it("calls qwen3.7-plus and returns a strictly validated same-step proposal", async () => {
    const complete = vi.fn(async () => ({
      text: JSON.stringify({
        assistantMessage: "我把研究目标收窄到可执行的市场进入决策。",
        proposal: { ...input.draft, value: { ...input.draft.value, goal: "选择优先市场与进入模式" } },
      }),
    }));
    const skill = new ModelGuidedResearchSkill({ complete } as unknown as ModelCallPort, "qwen");

    const result = await skill.turn(input);

    expect(complete).toHaveBeenCalledOnce();
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ modelProvider: "qwen", modelId: "qwen3.7-plus" }));
    expect(result.proposal.node).toBe("brief");
    expect(result.modelInvocationId).toBe("turn-1:qwen3.7-plus");
  });

  it("fails closed instead of substituting a mock when model output targets another step", async () => {
    const model = {
      complete: vi.fn(async () => ({
        text: JSON.stringify({ assistantMessage: "错误步骤", proposal: { node: "report", value: { reportSummary: "x" } } }),
      })),
    } as unknown as ModelCallPort;
    const skill = new ModelGuidedResearchSkill(model, "qwen");

    await expect(skill.turn(input)).rejects.toEqual(expect.objectContaining<Partial<GuidedResearchSkillError>>({
      reasonCode: "RESEARCH_NODE_STATE_INVALID",
    }));
  });
});
