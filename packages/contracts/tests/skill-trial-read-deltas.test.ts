import { describe, expect, it } from "vitest";
import { operations, skillTrialReadExchange } from "../src/skill-trial-read-deltas";
import { projectSkillTrialArtifact } from "../src/skill-trial-artifact-download";
const subject = { trialRunId: "trial-1", versionId: "version-1", input: "original input" };
const stored = { ...subject, artifacts: [] };
const request = { trialRunId: stored.trialRunId };
const failure = { code: "MODEL_UNAVAILABLE", stderr: "", attempts: 0 };
const base = { ...subject, status: "queued", trialRun: null, failure: null };
const valid = (response: unknown, storedValue: unknown = stored) => skillTrialReadExchange.safeParse({ request, stored: storedValue, response }).success;
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
    const trialRun = { ...subject, output: "result", durationMs: 1, tokens: 1, hitDataScope: [], artifacts: [], attempts: 0 };
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
  it("projects public artifact availability without exposing object-store keys", () => {
    const artifact = { availability: "downloadable", artifactId: "artifact-1", sha256: "a".repeat(64), name: "result.txt", mime: "text/plain", sizeBytes: 1 };
    const trialRun = { ...subject, output: "result", durationMs: 1, tokens: 1, hitDataScope: [], artifacts: [artifact], attempts: 0 };
    const record = { ...stored, artifacts: [{ artifactId: artifact.artifactId, sha256: artifact.sha256, name: artifact.name, mime: artifact.mime, sizeBytes: artifact.sizeBytes, objectKey: "private/key" }] };
    expect(valid({ ...base, status: "succeeded", trialRun }, record)).toBe(true);
    expect(valid({ ...base, status: "succeeded", trialRun: { ...trialRun, artifacts: [{ ...artifact, objectKey: "private/key" }] } })).toBe(false);
    const legacy = { availability: "unavailable", reason: "legacy-metadata-missing", name: artifact.name, mime: artifact.mime, sizeBytes: artifact.sizeBytes };
    const legacyRecord = { ...record, artifacts: [{ name: artifact.name, mime: artifact.mime, sizeBytes: artifact.sizeBytes, objectKey: "private/key" }] };
    expect(valid({ ...base, status: "succeeded", trialRun: { ...trialRun, artifacts: [legacy] } }, legacyRecord)).toBe(true);
    expect(valid({ ...base, status: "succeeded", trialRun }, legacyRecord)).toBe(false);
    for (const patch of [{ artifactId: "other" }, { sha256: "b".repeat(64) }, { sizeBytes: 2 }, { name: "other" }, { mime: "other" }]) {
      expect(valid({ ...base, status: "succeeded", trialRun: { ...trialRun, artifacts: [{ ...artifact, ...patch }] } }, record)).toBe(false);
    }
    for (const artifacts of [[], [artifact, artifact], [legacy]]) {
      expect(valid({ ...base, status: "succeeded", trialRun: { ...trialRun, artifacts } }, record)).toBe(false);
    }
  });

  it("rejects duplicate known artifact identities even when the response matches their projection", () => {
    const first = { artifactId: "artifact-1", sha256: "a".repeat(64), name: "one.txt", mime: "text/plain", sizeBytes: 1, objectKey: "private/one" };
    const artifacts = [first, { ...first, name: "two.txt", sha256: "b".repeat(64), objectKey: "private/two" }];
    const trialRun = { ...subject, output: "result", durationMs: 1, tokens: 1, hitDataScope: [], artifacts: artifacts.map(projectSkillTrialArtifact), attempts: 0 };
    expect(valid({ ...base, status: "succeeded", trialRun }, { ...stored, artifacts })).toBe(false);
    const legacy = artifacts.map(({ artifactId: _artifactId, sha256: _sha256, ...row }) => row);
    expect(valid({ ...base, status: "succeeded", trialRun: { ...trialRun, artifacts: legacy.map(projectSkillTrialArtifact) } }, { ...stored, artifacts: legacy })).toBe(true);
  });

});
