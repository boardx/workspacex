import { describe, expect, it } from "vitest";
import { operations, SkillSourceAssessment, skillAdaptationExchange, sourceAssessmentExchanges } from "../src/skill-source-assessment";
const digest = "a".repeat(64);
const pin = { source: { kind: "github", repositoryUrl: "https://github.com/example/tool", selection: "repository-root", path: null, requestedRef: "main", resolvedCommit: "b".repeat(40), authConnectionId: null }, sourceDigest: digest };
const file = { path: "README.md", digest, sizeBytes: 100 };
const assessment = { assessmentId: "assessment-1", assessmentDigest: digest, pin, expiresAt: "2026-09-11T00:00:00Z", compatibility: "needs-adaptation", inventory: { files: [file], license: { expression: null, path: null }, dependencies: ["Python runtime requires review"], scriptPaths: [] }, missingRequirements: ["No SKILL.md"] };
const request = { assessmentId: "assessment-1", expectedAssessmentDigest: digest, name: "Adapted tool", selectedPaths: ["README.md"], idempotencyKey: "adaptation-request-1" };
const response = { assessmentId: "assessment-1", assessmentDigest: digest, draft: { skillId: "adapted-1", draftId: "draft-1", revision: 1, snapshotDigest: digest, manifestPath: "SKILL.md", files: [{ path: "SKILL.md", digest: "c".repeat(64), sizeBytes: 80 }, { ...file, path: "references/imported/README.md" }], sourcePin: pin, basedOnPublishedVersionId: null, updatedAt: "2026-09-10T00:00:00Z" }, attachments: [{ sourcePath: "README.md", draftPath: "references/imported/README.md", digest }], manifestProvenance: { kind: "generated-template", templateId: "skill-adaptation-v1", contentDigest: "c".repeat(64) }, remainingWork: ["Write instructions and test before publishing"] };

describe("ordinary source assessment and adaptation", () => {
  it("rejects source changes on first assessment and wrong assessment reads", () => {
    const { resolvedCommit: _, ...source } = pin.source;
    const exchange = { request: { source }, response: assessment };
    expect(sourceAssessmentExchanges.assessSkillImportSource.safeParse(exchange).success).toBe(true);
    for (const patch of [{ repositoryUrl: "https://github.com/other/repo" }, { requestedRef: "other" }, { authConnectionId: "other-connection" }, { selection: "subdirectory", path: "other" }]) expect(sourceAssessmentExchanges.assessSkillImportSource.safeParse({ ...exchange, response: { ...assessment, pin: { ...pin, source: { ...pin.source, ...patch } } } }).success).toBe(false);
    expect(sourceAssessmentExchanges.getSkillSourceAssessment.safeParse({ request: { assessmentId: "other" }, response: assessment }).success).toBe(false);
  });
  it("rejects copied source bytes as manifest and unselected license attachments", () => {
    expect(skillAdaptationExchange.safeParse({ assessment, request, response: { ...response, manifestProvenance: { ...response.manifestProvenance, contentDigest: digest }, draft: { ...response.draft, files: response.draft.files.map(file => ({ ...file, digest })) } } }).success).toBe(false);
    const licensed = { ...assessment, inventory: { ...assessment.inventory, files: [...assessment.inventory.files, { ...file, path: "LICENSE" }], license: { expression: "MIT", path: "LICENSE" } } };
    const added = { ...response, attachments: [...response.attachments, { sourcePath: "LICENSE", draftPath: "references/imported/LICENSE", digest }], draft: { ...response.draft, files: [...response.draft.files, { ...file, path: "references/imported/LICENSE" }] } };
    expect(skillAdaptationExchange.safeParse({ assessment: licensed, request, response: added }).success).toBe(false);
    expect(skillAdaptationExchange.safeParse({ assessment: licensed, request: { ...request, selectedPaths: ["README.md", "LICENSE"] }, response: added }).success).toBe(true);
  });
  it("accepts a source without a Skill candidate as needing adaptation, not runnable", () => {
    expect(SkillSourceAssessment.safeParse(assessment).success).toBe(true);
    expect(SkillSourceAssessment.safeParse({ ...assessment, compatibility: "compatible" }).success).toBe(false);
    expect(operations.createSkillAdaptationDraft.in.safeParse({ ...request, scriptExecutionAllowed: true }).success).toBe(false);
  });
  it("keeps unsupported sources outside the draft creation path", () => {
    const unsupported = { assessmentId: "assessment-1", assessmentDigest: digest, pin, expiresAt: assessment.expiresAt, compatibility: "unsupported", reasons: ["Unsupported deployment runtime"] };
    expect(SkillSourceAssessment.safeParse(unsupported).success).toBe(true);
    expect(skillAdaptationExchange.safeParse({ assessment: unsupported, request, response }).success).toBe(false);
  });
  it("requires a captured file for license and script evidence", () => {
    expect(SkillSourceAssessment.safeParse({ ...assessment, inventory: { ...assessment.inventory, scriptPaths: ["outside.py"] } }).success).toBe(false);
    expect(SkillSourceAssessment.safeParse({ ...assessment, inventory: { ...assessment.inventory, license: { expression: "MIT", path: "LICENSE" } } }).success).toBe(false);
  });
  it("creates only a new source-pinned draft with inert exact reference attachments", () => {
    const exchange = { assessment, request, response };
    expect(skillAdaptationExchange.safeParse(exchange).success).toBe(true);
    for (const patch of [{ revision: 8 }, { sourcePin: null }, { manifestPath: "run.py" }, { basedOnPublishedVersionId: "published-1" }]) expect(skillAdaptationExchange.safeParse({ ...exchange, response: { ...response, draft: { ...response.draft, ...patch } } }).success).toBe(false);
    expect(skillAdaptationExchange.safeParse({ ...exchange, request: { ...request, selectedPaths: ["outside.py"] } }).success).toBe(false);
    expect(skillAdaptationExchange.safeParse({ ...exchange, response: { ...response, assessmentDigest: "c".repeat(64) } }).success).toBe(false);
    expect(skillAdaptationExchange.safeParse({ ...exchange, response: { ...response, attachments: [{ ...response.attachments[0], draftPath: "scripts/README.md" }] } }).success).toBe(false);
    expect(skillAdaptationExchange.safeParse({ ...exchange, response: { ...response, draft: { ...response.draft, files: [...response.draft.files, { ...file, path: "scripts/hidden.py" }] } } }).success).toBe(false);
  });
});
