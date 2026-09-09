import { describe, expect, it } from "vitest";
import { operations, skillTrialReadExchange } from "../src/skill-trial-read-deltas";
const stored = { trialRunId: "trial-1", versionId: "version-1", input: "original input" };
const request = { trialRunId: stored.trialRunId };
const failure = { code: "MODEL_UNAVAILABLE", stderr: "", attempts: 0 };
const base = { ...stored, status: "queued", trialRun: null, failure: null };
const valid = (response: unknown) => skillTrialReadExchange.safeParse({ request, stored, response }).success;
describe("published trial read recovery proposal", () => {
  it("preserves original input and version before completion and after failure", () => {
    expect(valid(base)).toBe(true);
    expect(valid({ ...base, status: "running" })).toBe(true);
    expect(valid({ ...base, status: "failed", failure })).toBe(true);
    expect(valid({ ...base, status: "failed", failure, input: "new input" })).toBe(false);
    expect(valid({ ...base, versionId: "current-version" })).toBe(false);
    expect(valid({ ...base, trialRunId: "other-trial" })).toBe(false);
    expect(operations.getTrialRun.in.safeParse({ ...request, stored }).success).toBe(false);
  });
  it("rejects contradictory lifecycle outcomes and swapped success results", () => {
    const trialRun = { ...stored, output: "result", durationMs: 1, tokens: 1, hitDataScope: [], artifacts: [], attempts: 0 };
    expect(valid({ ...base, status: "succeeded", trialRun })).toBe(true);
    for (const response of [{ ...base, status: "succeeded" }, { ...base, status: "failed" },
      { ...base, failure }, { ...base, trialRun }, { ...base, status: "succeeded", trialRun, failure },
      { ...base, status: "succeeded", trialRun: { ...trialRun, versionId: "other" } }]) expect(valid(response)).toBe(false);
  });
  it("does not turn a published-version trial into a draft trial or accept additional authority", () => {
    expect(valid({ ...base, draftId: "draft-1" })).toBe(false);
    expect(operations.getTrialRun.in.safeParse({ ...request, actorId: "someone" }).success).toBe(false);
    expect(operations.getTrialRun.path).toBe("/skill-trial-runs/:trialRunId");
  });
});
