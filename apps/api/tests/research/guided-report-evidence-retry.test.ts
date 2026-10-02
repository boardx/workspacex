import { describe, expect, it } from "vitest";
import { extractReportEvidence, type ReportAudit } from "../../src/application/research/guided-report-evidence";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
function fixture(count = 3): ResearchRuntime {
  return { sessionId: "s", version: 1, revision: 1, currentNode: "report", availableNodes: ["report"], brief: { topic: "Policy", goal: "Compare", timeRange: "2026", region: "EU", focus: "Grid" }, directions: [],
    outline: [{ id: "chapter", title: "Policy", order: 0, enabled: true, questions: ["What is supported?"] }], tasks: [], sources: Array.from({ length: count }, (_, index) => ({ id: `s${index}`, taskId: `t${index}`, title: `Source ${index}`, content: `Verbatim evidence for source ${index}.`, url: `https://example.com/${index}`, retrievedAt: "2026-09-07", decision: "accepted" })), report: null, completed: false, busy: true, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [] };
}
const config = { provider: "fixture", id: "fixture" };
const evaluate = (c: any) => ({ evaluations: c.chunks.map((chunk: any) => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: false, matches: [{ questionId: c.questions[0].id, quote: chunk.content, insight: "Supported fact.", relevance: "direct" }] })) });
function setup(make: (c: any, index: number) => unknown) {
  const calls: any[] = []; const diagnostics: any[] = [];
  const audit: ReportAudit = async (input, validate) => { const c = JSON.parse(input.user); calls.push(c); const value = make(c, calls.length - 1); return validate(typeof value === "string" ? value : JSON.stringify(value)); };
  return { calls, diagnostics, run: (state = fixture()) => extractReportEvidence(state, config, audit, undefined, [], (event: any) => diagnostics.push(event)) };
}
describe("atomic chunk evidence repair", () => {
  it("retains valid chunks and repairs only the non-verbatim chunk with cause and duration diagnostics", async () => {
    const f = setup((c, index) => { const result = evaluate(c); if (!index) result.evaluations[1].matches[0].quote = "fabricated"; return result; });
    const result = await f.run();
    expect(f.calls.map((c) => c.chunks.length)).toEqual([3, 1]); expect(f.calls[1].chunks[0].sourceId).toBe("s1");
    expect([...result.matches.values()].flat().map((e) => e.sourceId)).toEqual(["s0", "s1", "s2"]);
    expect(f.diagnostics[0]).toMatchObject({ suppliedChunks: 3, validChunks: 2, retryChunks: 1, reasonCounts: { non_verbatim_quote: 1 } });
    expect(f.diagnostics.every((e) => e.durationMs >= 0)).toBe(true);
    expect(JSON.stringify(f.diagnostics)).not.toContain("Verbatim evidence");
  });
  it("preserves first-attempt valid evidence when the failed chunk repairs as irrelevant", async () => {
    const f = setup((c, index) => { const result = evaluate(c); if (!index) result.evaluations[1].matches[0].quote = "fabricated"; else result.evaluations.forEach((e: any) => { e.irrelevant = true; e.matches = []; }); return result; });
    expect([...((await f.run()).matches.values())].flat().map((e) => e.sourceId)).toEqual(["s0", "s2"]);
  });
  it("never retains a valid match from a chunk that also contains an invalid match", async () => {
    const state = fixture(2); const f = setup((c, index) => { const result = evaluate(c); if (!index) result.evaluations[0].matches.push({ ...result.evaluations[0].matches[0], quote: "fabricated" }); else result.evaluations.forEach((e: any) => { e.irrelevant = true; e.matches = []; }); return result; });
    expect([...((await f.run(state)).matches.values())].flat().map((e) => e.sourceId)).toEqual(["s1"]);
  });
  it("repairs missing chunks only and classifies missing evaluations", async () => {
    const f = setup((c, index) => { const result = evaluate(c); if (!index) result.evaluations.splice(1, 1); return result; });
    await f.run(); expect(f.calls.map((c) => c.chunks.length)).toEqual([3, 1]); expect(f.diagnostics[0].reasonCounts.missing_chunk).toBe(1);
  });
  it("keeps full batch recovery for invalid JSON with no attributable chunks", async () => {
    const f = setup((c, index) => index ? evaluate(c) : "invalid JSON"); await f.run();
    expect(f.calls.map((c) => c.chunks.length)).toEqual([3, 3]); expect(f.diagnostics[0].reasonCounts.invalid_json).toBe(1);
  });
  it("fails closed when no fully valid chunk survives two repairs", async () => {
    const state = fixture(1); const f = setup((c) => { const result = evaluate(c); result.evaluations[0].matches.push({ ...result.evaluations[0].matches[0], quote: "fabricated" }); return result; });
    await expect(f.run(state)).rejects.toThrow("RESEARCH_CONTENT_REFERENCE_INVALID"); expect(f.calls).toHaveLength(2);
  });
});

describe("retry provenance and diagnostics safety", () => {
  it.each(["duplicate", "unknown_question", "invalid_evaluation", "inconsistent_irrelevance"])("repairs the attributable %s chunk and retains other whole chunks", async (fault) => {
    const f = setup((c, index) => { const r = evaluate(c); if (!index) {
      if (fault === "duplicate") r.evaluations.push({ ...r.evaluations[1] });
      if (fault === "unknown_question") r.evaluations[1].matches[0].questionId = "unknown";
      if (fault === "invalid_evaluation") (r.evaluations[1] as any).extra = true;
      if (fault === "inconsistent_irrelevance") r.evaluations[1].irrelevant = true;
    } return r; });
    const result = await f.run(); expect(f.calls[1].chunks.map((c: any) => c.sourceId)).toEqual(["s1"]);
    expect([...result.matches.values()].flat()).toHaveLength(3);
    expect(f.diagnostics[0].reasonCounts[fault === "duplicate" ? "duplicate_chunk" : fault]).toBe(1);
  });
  it.each(["unknown_source", "unknown_chunk", "extra_envelope", "oversized"])("recovers whole batch for untrustworthy attribution %s", async (fault) => {
    const f = setup((c, index) => { const r: any = evaluate(c); if (!index) {
      if (fault === "unknown_source") r.evaluations[1].sourceId = "invented";
      if (fault === "unknown_chunk") r.evaluations[1].chunkId = "invented";
      if (fault === "extra_envelope") r.extra = true;
      if (fault === "oversized") r.evaluations = Array.from({ length: 9 }, () => r.evaluations[0]);
    } return r; });
    await f.run(); expect(f.calls.map((c) => c.chunks.length)).toEqual([3, 3]);
  });
  it("does not permit a repair response to overwrite an already validated chunk", async () => {
    const f = setup((c, index) => { const r = evaluate(c); if (!index) r.evaluations[1].matches[0].quote = "fabricated";
      else r.evaluations.push({ sourceId: "s0", chunkId: "source:s0/chunk:0", irrelevant: true, matches: [] }); return r; });
    const state = fixture(); const result = await f.run(state);
    expect([...result.matches.values()].flat().map((e) => e.sourceId)).toEqual(["s0", "s1", "s2"]);
    expect(state.reportEvidenceWarnings).toHaveLength(1);
  });
  it("retains validated chunks if the final repair is malformed, with explicit exclusions", async () => {
    const f = setup((c, index) => { if (index) return "invalid JSON"; const r = evaluate(c); r.evaluations[1].matches[0].quote = "fabricated"; return r; });
    const state = fixture(); const result = await f.run(state);
    expect([...result.matches.values()].flat().map((e) => e.sourceId)).toEqual(["s0", "s2"]); expect(state.reportEvidenceWarnings).toHaveLength(1);
  });
  it("does not classify provider or post-validation persistence errors as evidence retries", async () => {
    const diagnostics: any[] = []; let calls = 0; const error = new Error("audit unavailable");
    await expect(extractReportEvidence(fixture(), config, async (_input, validate) => { calls++; validate(JSON.stringify(evaluate(JSON.parse(_input.user)))); throw error; }, undefined, [], (event) => diagnostics.push(event))).rejects.toBe(error);
    expect(calls).toBe(1); expect(diagnostics[0]).toMatchObject({ failed: true, reasonCounts: { audit_error: 1 } });
  });
  it("does not let diagnostic sink errors break generation", async () => {
    const result = await extractReportEvidence(fixture(), config, async (input, validate) => validate(JSON.stringify(evaluate(JSON.parse(input.user)))), undefined, [], () => { throw new Error("recorder unavailable"); });
    expect([...result.matches.values()].flat()).toHaveLength(3);
  });
  it("sends only failed raw evaluations in a attributable repair input", async () => {
    const f = setup((c, index) => { const r = evaluate(c); if (!index) r.evaluations[1].matches[0].quote = "fabricated"; return r; }); await f.run();
    expect(f.calls[1].rawOutput).not.toContain("Verbatim evidence for source 0"); expect(f.calls[1].rawOutput).not.toContain("Verbatim evidence for source 2");
  });
});

describe("unattributable identity conflicts", () => {
  it.each(["unknown_after", "unknown_before", "missing_after", "missing_before", "alias_after", "alias_before"])("rejects all evidence for a claimed chunk despite other correct entries: %s", async (fault) => {
    const f = setup((c) => { const r: any = evaluate(c); const bad = { ...r.evaluations[0], sourceId: fault.startsWith("alias") ? "S-unknown" : "invented" }; if (fault.startsWith("missing")) delete bad.sourceId;
      if (fault.endsWith("before")) r.evaluations.unshift(bad); else r.evaluations.push(bad); return r; });
    await expect(f.run(fixture(1))).rejects.toThrow("RESEARCH_CONTENT_REFERENCE_INVALID"); expect(f.calls).toHaveLength(2);
  });
  it("retains other fully valid chunks after quarantining a conflicting claimed identity", async () => {
    const f = setup((c) => { const r: any = evaluate(c); r.evaluations.push({ ...r.evaluations[0], sourceId: "invented" }); return r; });
    const state = fixture(2); const result = await f.run(state);
    expect([...result.matches.values()].flat().map((e) => e.sourceId)).toEqual(["s1"]); expect(state.reportEvidenceWarnings).toHaveLength(1);
  });
});
