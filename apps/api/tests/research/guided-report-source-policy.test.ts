import { validateRuntimeDraft } from "../../src/application/research/guided-runtime-service";
import { describe, expect, it } from "vitest";
import { canonicalEvidenceSources, extractReportEvidence } from "../../src/application/research/guided-report-evidence";
import { reportBasis } from "../../src/application/research/guided-report-checkpoint";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
const config = { provider: "test", id: "model" };
function fixture(urls: string[]): ResearchRuntime {
  return { sessionId: "s", version: 1, revision: 1, currentNode: "report", availableNodes: ["report"],
    brief: { topic: "Public standard", goal: "Official evidence", timeRange: "", region: "", focus: "" }, directions: [],
    outline: [{ id: "chapter", title: "Requirements", order: 0, enabled: true, questions: ["What is required?"] }], tasks: [],
    sources: urls.map((url, i) => ({ id: `s${i}`, taskId: "t", title: "Evidence", content: "Verbatim public evidence.", url, retrievedAt: "now", decision: "accepted" })),
    report: null, completed: false, busy: true, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [],
    sourcePolicy: { mode: "restrict", domains: ["https://www.w3.org/TR/"], internalSourceIds: [], revision: 1 } };
}
describe("report evidence respects confirmed source scope", () => {
  it("filters existing and manually added outside sources without changing history", () => {
    const state = fixture(["https://www.w3.org/TR/WCAG22/", "https://w3.org/other", "https://sub.w3.org/page", "https://w3.org.evil.example/page", "https://other.example/page"]);
    state.sources[4]!.addedByUser = true;
    const before = structuredClone(state.sources);
    expect(canonicalEvidenceSources(state).map(s => s.id)).toEqual(["s0", "s1", "s2"]);
    expect(state.sources).toEqual(before);
  });
  it.each(["open", "prioritize"] as const)("preserves %s policy semantics", (mode) => {
    const state = fixture(["https://w3.org/a", "https://other.example/a"]); state.sourcePolicy!.mode = mode;
    expect(canonicalEvidenceSources(state)).toHaveLength(2);
    delete state.sourcePolicy; expect(canonicalEvidenceSources(state)).toHaveLength(2);
  });
  it("does not let an out-of-scope fetched document suppress allowed excerpts", () => {
    const state = fixture(["https://w3.org/a", "https://other.example/a"]);
    const source = state.sources[1]!;
    source.document = { url: source.url, text: source.content, contentHash: "a".repeat(64), contentKind: "html", truncated: false, retrievedAt: "now" };
    expect(canonicalEvidenceSources(state).map(s => s.id)).toEqual(["s0"]);
  });
  it("keeps only explicitly authorized internal references", () => {
    const state = fixture(["https://internal.workspacex.local/artifacts/allowed", "https://internal.workspacex.local/artifacts/denied", "https://other.example/allowed"]);
    state.sources[0]!.id = "internal:allowed"; state.sources[1]!.id = "internal:denied"; state.sources[2]!.id = "internal:allowed";
    state.sourcePolicy!.internalSourceIds = ["allowed"];
    expect(canonicalEvidenceSources(state).map(s => s.url)).toEqual([state.sources[0]!.url]);
  });
  it("fails before model invocation when every source is outside the restricted scope", async () => {
    const state = fixture(["https://other.example/a"]); let calls = 0;
    await expect(extractReportEvidence(state, config, async () => { calls++; return {}; })).rejects.toThrow("RESEARCH_SOURCES_REQUIRED");
    expect(calls).toBe(0);
  });
  it("binds report recovery to the confirmed policy and its revision", () => {
    const state = fixture(["https://w3.org/a"]); const basis = reportBasis(state, config);
    state.sourcePolicy!.revision++; expect(reportBasis(state, config)).not.toBe(basis);
    state.sourcePolicy!.revision--; state.sourcePolicy!.mode = "open"; expect(reportBasis(state, config)).not.toBe(basis);
  });
  it("does not send outside source text to the evidence model", async () => {
    const state = fixture(["https://w3.org/a", "https://other.example/a"]);
    state.sources[1]!.content = "FORBIDDEN OUTSIDE CONTENT";
    const visited: string[] = [];
    await extractReportEvidence(state, config, async (input, validate) => {
      expect(input.user).not.toContain("FORBIDDEN OUTSIDE CONTENT");
      const context = JSON.parse(input.user);
      return validate(JSON.stringify({ evaluations: context.chunks.map((chunk: { sourceId: string; chunkId: string }) => {
        visited.push(chunk.sourceId);
        return { sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: true, matches: [] };
      }) }));
    });
    expect(visited).toEqual(["s0"]);
  });
  it("rejects edited report citations outside the confirmed policy", () => {
    const state = fixture(["https://w3.org/a", "https://other.example/a"]);
    const draft = { node: "report" as const, value: { title: "Report", summary: "Summary", sections: [
      { sectionId: "chapter", body: "Verified statement [[source:s1]]", sourceIds: ["s1"] },
    ] } };
    expect(() => validateRuntimeDraft(state, draft)).toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
    draft.value.sections[0]!.body = "Verified statement [[source:s0]]";
    draft.value.sections[0]!.sourceIds = ["s0"];
    expect(() => validateRuntimeDraft(state, draft)).not.toThrow();
  });

});
