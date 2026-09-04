import { describe, expect, it } from "vitest";
import { normalizeSkillProposalPatch } from "../../src/infrastructure/interview/workflow/langgraph-digital-interview-runtime";

describe("digital interview Skill expert patches", () => {
  const current = ["generated-a", "generated-b"];
  const available = ["generated-a", "generated-b", "mock-persona:new"];

  it("keeps every current expert when an additive request returns only the new expert", () => {
    expect(normalizeSkillProposalPatch({
      completionText: JSON.stringify({ expertIds: ["mock-persona:new"] }),
      step: "experts",
      requestText: "添加一个用户",
      currentExpertIds: current,
      availableExpertIds: available,
    })).toEqual({ expertIds: ["generated-a", "generated-b", "mock-persona:new"] });
  });

  it("deduplicates additive patches and rejects unknown expert ids", () => {
    expect(normalizeSkillProposalPatch({
      completionText: JSON.stringify({ expertIds: ["generated-b", "mock-persona:new", "mock-persona:new"] }),
      step: "experts",
      requestText: "再补充一位专家",
      currentExpertIds: current,
      availableExpertIds: available,
    })).toEqual({ expertIds: ["generated-a", "generated-b", "mock-persona:new"] });

    expect(() => normalizeSkillProposalPatch({
      completionText: JSON.stringify({ expertIds: ["invented-id"] }),
      step: "experts",
      requestText: "添加一个用户",
      currentExpertIds: current,
      availableExpertIds: available,
    })).toThrow("DEPENDENCY_UNAVAILABLE");

    expect(() => normalizeSkillProposalPatch({
      completionText: JSON.stringify({ expertIds: ["generated-a"] }),
      step: "experts",
      requestText: "添加一个用户",
      currentExpertIds: current,
      availableExpertIds: available,
    })).toThrow("DEPENDENCY_UNAVAILABLE");
  });
});
