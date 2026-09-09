import { describe, expect, it } from "vitest";
import { advanceImportBatch, makeImportBatch, makeImportPreview } from "../../components/ai-capability-studio/import-preview-data";
import { summarizeImportBatch } from "@repo/contracts/skill-development";

describe("contract-backed import preview transitions", () => {
  const preview = makeImportPreview({ kind: "zip", uploadId: "demo-upload" });
  it("single-file sources do not invent sibling candidates", () => {
    const single = makeImportPreview({ kind: "https-file", url: "https://example.test/SKILL.md", authConnectionId: null });
    expect(single.candidates.map(candidate => candidate.candidateId)).toEqual(["research-brief"]);
  });
  it("only retries failed items while preserving successful drafts and immutable source pins", () => {
    const queued = makeImportBatch(preview, preview.candidates.map(candidate => candidate.candidateId));
    const partial = advanceImportBatch(queued, preview, "partial");
    expect(summarizeImportBatch(partial)).toBe("partial");
    const retried = advanceImportBatch(partial, preview, "retry");
    expect(retried.items[0]).toEqual(partial.items[0]);
    expect(retried.items[1]!.attempt).toBe(2);
    expect(retried.items[1]!.sourceDigest).toBe(queued.items[1]!.sourceDigest);
    expect(retried.items[1]!.previousAttemptJobId).toBe(partial.items[1]!.jobId);
    const complete = advanceImportBatch(retried, preview, "success");
    expect(summarizeImportBatch(complete)).toBe("succeeded");
    expect(complete.items[0]).toEqual(partial.items[0]);
  });
  it("cancellation preserves already completed items and cannot implicitly restart cancelled jobs", () => {
    const partial = advanceImportBatch(makeImportBatch(preview, preview.candidates.map(candidate => candidate.candidateId)), preview, "partial");
    const retried = advanceImportBatch(partial, preview, "retry");
    const cancelled = advanceImportBatch(retried, preview, "cancel");
    expect(cancelled.items[0]).toEqual(partial.items[0]);
    expect(cancelled.items[1]!.status).toBe("cancelled");
    expect(advanceImportBatch(cancelled, preview, "retry")).toEqual(cancelled);
  });
  it("rejects unselected, empty, duplicate, and foreign candidate sets", () => {
    expect(() => makeImportBatch(preview, [])).toThrow();
    expect(() => makeImportBatch(preview, ["foreign"])).toThrow();
    expect(() => makeImportBatch(preview, ["research-brief", "research-brief"])).toThrow();
  });
});
