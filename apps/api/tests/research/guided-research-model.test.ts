import { describe, expect, it } from "vitest";
import { GUIDED_RESEARCH_REPORTED_MODEL_ID, guidedResearchInvocationModelId } from "../../src/application/research/guided-research-model";

describe("guidedResearchInvocationModelId", () => {
  it("defaults to the contract-pinned cloud id", () => {
    expect(guidedResearchInvocationModelId({} as NodeJS.ProcessEnv)).toBe(GUIDED_RESEARCH_REPORTED_MODEL_ID);
  });
  it("uses the local override for the call only (WorkspaceX Local has no qwen3.7-plus)", () => {
    expect(guidedResearchInvocationModelId({ KERNEL_GUIDED_RESEARCH_MODEL_ID: "qwen3.5:4b" } as NodeJS.ProcessEnv)).toBe("qwen3.5:4b");
    expect(guidedResearchInvocationModelId({ KERNEL_GUIDED_RESEARCH_MODEL_ID: "  " } as NodeJS.ProcessEnv)).toBe(GUIDED_RESEARCH_REPORTED_MODEL_ID);
  });
});
