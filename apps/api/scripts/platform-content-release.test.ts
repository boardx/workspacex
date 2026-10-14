import { describe, expect, it } from "vitest";
import { buildOfficialAgentRolePack } from "../src/domain/agent/official-role-packs";
import { AGENT_ROLE_COLUMN_OF } from "../src/infrastructure/agent/agent-version-insert";
import { canonical, checkLegacy, sha, verifyInputs, type ReleaseRequest } from "./platform-content-release-core";

const pack = buildOfficialAgentRolePack();
function request(): ReleaseRequest { return { schemaVersion: 1, releaseId: "unit-content-release", sourceRevision: "a".repeat(40),
  targetOrgId: "org-platform", acceptanceScope: "mvp-non-model", expectedDatabase: "wsx_content_release_test",
  packRefs: [], officialRolePackDigest: pack.packDigest, workflows: [], beforeStateSha256: "b".repeat(64),
  skippedTests: ["real-model", "ai-output-quality"], notApplicableContents: ["future-catalog-v2"] }; }
function row() {
  const target = pack.agents[0]!;
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(AGENT_ROLE_COLUMN_OF).map(([key, col]) => [col, key === "catalogSource" ? "official" : target.role[key as keyof typeof target.role]]));
  return { id: "test-agent", stable_name: target.stableName, published_version_id: "test-version",
    draft: { ...fields, name: target.name, role_label: target.roleLabel } as Record<string, unknown>,
    published: { ...fields, instructions: target.instructions, instruction_digest: target.instructionDigest,
      semantic_label: target.semanticVersion, model_provider: target.modelProvider, model_id: target.modelId,
      tool_policy: target.toolPolicy, skill_version_ids: [] } };
}
describe("content release admission", () => {
  it("admits pinned shipped role content without a model invocation", () => {
    const input = verifyInputs(request(), "c".repeat(64), () => { throw new Error("unexpected pack load"); });
    expect(input.request.officialRolePackDigest).toBe(pack.packDigest);
  });
  it("rejects unshipped workflows before touching a database", () => {
    const r = request(); r.workflows = [{ key: "future-workflow", version: 1, contentDigest: "d".repeat(64) }];
    expect(() => verifyInputs(r, "c".repeat(64), () => Buffer.alloc(0))).toThrow("WORKFLOW_NOT_SHIPPED_OR_CHANGED");
  });
  it("rejects moving source names and missing explicit MVP exclusions", () => {
    const r = request(); r.sourceRevision = "main";
    expect(() => verifyInputs(r, "c".repeat(64), () => Buffer.alloc(0))).toThrow("SOURCE_IDENTITY");
    r.sourceRevision = "a".repeat(40); r.notApplicableContents = [];
    expect(() => verifyInputs(r, "c".repeat(64), () => Buffer.alloc(0))).toThrow("FUTURE_SCOPE_REQUIRED");
  });
  it("accepts unchanged official current content", () => {
    expect(() => checkLegacy(row(), pack.agents[0]!)).not.toThrow();
  });
  it("never adopts a custom role", () => {
    const r = row(); r.draft.catalog_source = "org";
    expect(() => checkLegacy(r, pack.agents[0]!)).toThrow("CUSTOM_ROLE_CONFLICT");
  });
  it("never publishes an edited draft through compatibility adoption", () => {
    const r = row(); r.draft.tags = ["edited"];
    expect(() => checkLegacy(r, pack.agents[0]!)).toThrow("ROLE_DRAFT_CHANGED");
  });
  it("rejects corrupt published instruction bytes", () => {
    const r = row(); r.published.instructions += "changed";
    expect(() => checkLegacy(r, pack.agents[0]!)).toThrow("ROLE_INSTRUCTION_CORRUPT");
  });
  it("rejects an official-looking unknown legacy version", () => {
    const r = row(); r.published.semantic_label = "0.0.1";
    expect(() => checkLegacy(r, pack.agents[0]!)).toThrow("ROLE_LEGACY_NOT_RECOGNIZED");
  });
  it("canonical digest ignores JSON object ordering but preserves array order", () => {
    expect(sha(canonical({ a: 1, b: { c: 2, d: 3 } }))).toBe(sha(canonical({ b: { d: 3, c: 2 }, a: 1 })));
    expect(sha(canonical([1, 2]))).not.toBe(sha(canonical([2, 1])));
  });
});
