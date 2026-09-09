import { describe, expect, it } from "vitest";
import { operations, SkillPatchJob } from "../src/skill-development";

const digest = "a".repeat(64);
const baseline = { skillId: "skill-1", draftId: "draft-1", expectedRevision: 2, expectedSnapshotDigest: digest };
const now = "2026-09-09T00:00:00Z";
const proposal = { proposalId: "proposal-1", baseline, mutations: [{ kind: "put", path: "SKILL.md", contentBase64: "YWJj" }], summary: "Improve instructions", createdAt: now, expiresAt: "2026-09-10T00:00:00Z" };

describe("AI patch proposal draft contracts", () => {
  it("requires an exact generation baseline and explicitly selected valid context paths", () => {
    const request = { ...baseline, instruction: "Improve clarity", contextPaths: ["SKILL.md"], model: { mode: "configured" }, idempotencyKey: "request-1" };
    expect(operations.proposeSkillDraftPatch.in.safeParse(request).success).toBe(true);
    for (const patch of [{ expectedRevision: undefined }, { instruction: " " }, { contextPaths: [] }, { contextPaths: ["../secret"] }, { contextPaths: ["SKILL.md", "SKILL.md"] }]) {
      expect(operations.proposeSkillDraftPatch.in.safeParse({ ...request, ...patch }).success).toBe(false);
    }
  });
  it("cannot change the baseline between a generation job and its returned proposal", () => {
    const job = { jobId: "job-1", baseline, submittedAt: now, idempotencyKey: "request-1", status: "succeeded", completedAt: now, proposal };
    expect(SkillPatchJob.safeParse(job).success).toBe(true);
    for (const patch of [{ skillId: "other" }, { draftId: "other" }, { expectedRevision: 3 }, { expectedSnapshotDigest: "b".repeat(64) }]) {
      expect(SkillPatchJob.safeParse({ ...job, proposal: { ...proposal, baseline: { ...baseline, ...patch } } }).success).toBe(false);
    }
  });
  it("accepts a server proposal reference, never a caller-provided approved patch", () => {
    const request = { ...baseline, proposalId: "proposal-1", idempotencyKey: "request-1" };
    expect(operations.applySkillDraftPatchProposal.in.safeParse(request).success).toBe(true);
    expect(operations.applySkillDraftPatchProposal.in.safeParse({ ...request, mutations: proposal.mutations }).success).toBe(false);
    expect(operations.applySkillDraftPatchProposal.in.safeParse({ ...request, reviewed: true }).success).toBe(false);
    expect(operations.applySkillDraftPatchProposal.in.safeParse({ ...request, proposalId: undefined }).success).toBe(false);
  });
  it("new blank draft creation cannot smuggle publishing or Agent binding", () => {
    const request = { name: "Research", description: "", idempotencyKey: "request-1" };
    expect(operations.createSkillDraft.in.safeParse(request).success).toBe(true);
    expect(operations.createSkillDraft.in.safeParse({ ...request, publish: true, agentId: "agent-1" }).success).toBe(false);
  });
});
