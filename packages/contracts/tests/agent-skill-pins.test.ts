import { describe, expect, it } from "vitest";
import { operations } from "../src/agent-runtime";
describe("current model-A Agent pins (#3260)", () => {
  it("accepts an ordered current-head projection without exposing version internals", () => {
    const result = { agentId: "a", publishedVersionId: "v", pins: [{ skillId: "s2", versionId: "sv2" }, { skillId: "s1", versionId: "sv1" }] };
    expect(operations.getAgentSkillPins.out.parse(result)).toEqual(result);
    expect(operations.getAgentSkillPins.out.safeParse({ ...result, instructions: "private instructions" }).success).toBe(false);
  });
  it("supports empty restoration and retains whole-list CAS input", () => {
    expect(operations.setAgentSkillPins.in.parse({ agentId: "a", expectedVersion: "v", skillVersionIds: [] }).skillVersionIds).toEqual([]);
    expect(operations.setAgentSkillPins.in.safeParse({ agentId: "a", skillVersionIds: [] }).success).toBe(false);
  });
});
