import { describe, expect, it } from "vitest";
import { canonicalEvidenceSources, extractReportEvidence, reportQuestions, selectQuestionEvidence, type ReportAudit } from "../../src/application/research/guided-report-evidence";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
function fixture(count = 16): ResearchRuntime {
  return { sessionId: "s", version: 1, revision: 1, currentNode: "report", availableNodes: ["report"],
    brief: { topic: "Policy", goal: "Compare", timeRange: "2026", region: "EU", focus: "Grid" }, directions: [],
    outline: [{ id: "chapter", title: "Policy decisions", order: 0, enabled: true, questions: ["What are the costs?", "What are the risks?"] }], tasks: [],
    sources: Array.from({ length: count }, (_, i) => ({ id: `s${i}`, taskId: `t${i}`, title: `Source ${i}`, content: `Verifiable source ${i} evidence.`, url: `https://example.com/${i}`, retrievedAt: "2026-09-07", decision: "accepted" })),
    report: null, completed: false, busy: true, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [] };
}
const config = { provider: "test", id: "model" };
function auditFor(make: (context: any) => unknown): ReportAudit {
  return async (input, validate) => validate(JSON.stringify(make(JSON.parse(input.user))));
}
const evaluate = (context: any) => ({ evaluations: context.chunks.map((chunk: any) => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: false,
  matches: context.questions.map((question: any) => ({ questionId: question.id, quote: chunk.content.slice(0, 80), insight: "Interpretation must be checked against the quote.", relevance: "direct" })) })) });
describe("verified report evidence coverage", () => {
  it("evaluates all sources including later results and distributes relevant evidence across questions", async () => {
    const state = fixture(); const visited: string[] = [];
    const result = await extractReportEvidence(state, config, auditFor((context) => {
      visited.push(...context.chunks.map((chunk: any) => chunk.sourceId));
      const response = evaluate(context);
      for (const evaluation of response.evaluations) {
        evaluation.matches = evaluation.matches.filter((match: any) => match.questionId.endsWith("1") ? Number(evaluation.sourceId.slice(1)) >= 12 : Number(evaluation.sourceId.slice(1)) < 12);
        evaluation.irrelevant = evaluation.matches.length === 0;
      }
      return response;
    }));
    expect(visited).toEqual(state.sources.map((source) => source.id));
    const selected = selectQuestionEvidence(result, state.outline[0]!);
    expect(selected[1]!.evidence.some((item) => Number(item.sourceId.slice(1)) >= 12)).toBe(true);
    expect(new Set(selected.flatMap((question) => question.evidence.map((item) => item.sourceId))).size).toBeGreaterThan(4);
    expect(selected.every((question) => question.evidence.length <= 4 && !question.gap)).toBe(true);
  });
  it.each(["unknown source", "unknown question", "fabricated quote", "missing chunk", "duplicate chunk"])("isolates %s extraction after one repair instead of trusting model metadata", async (fault) => {
    const state = fixture(3);
    const audit = auditFor((context) => {
      const response = evaluate(context); const first = response.evaluations[0];
      if (fault === "unknown source") first.sourceId = "invented";
      if (fault === "unknown question") first.matches[0].questionId = "invented";
      if (fault === "fabricated quote") first.matches[0].quote = "This was not present in the source.";
      if (fault === "missing chunk") response.evaluations.pop();
      if (fault === "duplicate chunk") response.evaluations[1] = first;
      return response;
    });
    const extracted = await extractReportEvidence(state, config, audit);
    expect(state.reportEvidenceWarnings).toHaveLength(1);
    expect([...extracted.matches.values()].flat().some((item) => item.quote.includes("not present"))).toBe(false);
    expect([...extracted.matches.values()].flat().length).toBeGreaterThan(0);
  });
  it("reads complete bounded chunks, deduplicates URL aliases and excludes deleted sources", async () => {
    const state = fixture(2); state.sources[0]!.content = "A".repeat(30000); state.sources[1]!.decision = "excluded";
    state.sources.push({ ...state.sources[0]!, id: "alias", url: state.sources[0]!.url + "#fragment", content: "Shorter copy" });
    expect(canonicalEvidenceSources(state).map((source) => source.id)).toEqual(["s0"]);
    const batches: any[] = [];
    await extractReportEvidence(state, config, auditFor((context) => { batches.push(context); return evaluate(context); }));
    expect(batches.flatMap((batch) => batch.chunks).reduce((sum, chunk) => sum + chunk.content.length, 0)).toBe(30000);
    expect(batches.every((batch) => batch.chunks.length <= 8 && batch.chunks.reduce((sum: number, chunk: any) => sum + chunk.content.length, 0) <= 24000)).toBe(true);
    expect(batches.flatMap((batch) => batch.chunks).every((chunk) => chunk.contentKind === "search_excerpt")).toBe(true);
  });
  it("does not present context-only snippets as direct answers", async () => {
    const state = fixture(2);
    const extracted = await extractReportEvidence(state, config, auditFor((context) => {
      const response = evaluate(context); for (const evaluation of response.evaluations) for (const match of evaluation.matches) match.relevance = "context"; return response;
    }));
    expect(selectQuestionEvidence(extracted, state.outline[0]!).every((question) => question.gap && question.evidence.length > 0)).toBe(true);
  });
  it("rejects an oversized evidence job before model calls rather than silently truncating sources", async () => {
    const state = fixture(104); for (const source of state.sources) source.content = "X".repeat(30000);
    let calls = 0;
    await expect(extractReportEvidence(state, config, auditFor((context) => { calls++; return evaluate(context); }))).rejects.toThrow("RESEARCH_EVIDENCE_BUDGET_EXCEEDED");
    expect(calls).toBe(0);
    const tooManyQuestions = [{ ...state.outline[0]!, questions: Array.from({ length: 65 }, (_, i) => `Question ${i}`) }];
    expect(() => reportQuestions(tooManyQuestions)).toThrow("RESEARCH_EVIDENCE_BUDGET_EXCEEDED");
  });
  it("repairs invalid JSON once before committing evidence", async () => {
    const state = fixture(1); const stages: string[] = [];
    const audit: ReportAudit = async (input, validate) => {
      const context = JSON.parse(input.user); stages.push(context.reportStage);
      return validate(context.reportStage === "evidence" ? "invalid JSON" : JSON.stringify(evaluate(context)));
    };
    const result = await extractReportEvidence(state, config, audit);
    expect(stages).toEqual(["evidence", "evidence_revision"]);
    expect(result.matches.values().next().value).toHaveLength(1);
    expect(state.reportEvidenceWarnings ?? []).toEqual([]);
  });
  it("does not leak earlier invalid attempt evidence into a repaired response", async () => {
    const state = fixture(2); let calls = 0;
    const result = await extractReportEvidence(state, config, auditFor((context) => {
      calls++; const output = evaluate(context);
      if (calls === 1) output.evaluations[1].matches[0].quote = "fabricated";
      else for (const evaluation of output.evaluations) { evaluation.matches = []; evaluation.irrelevant = true; }
      return output;
    }));
    expect(calls).toBe(2); expect([...result.matches.values()].flat()).toEqual([]);
  });
  it("fails honestly when repair leaves no verified evidence", async () => {
    const state = fixture(1); let calls = 0;
    const audit: ReportAudit = async (_input, validate) => { calls++; return validate("invalid JSON"); };
    await expect(extractReportEvidence(state, config, audit)).rejects.toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
    expect(calls).toBe(2); expect(state.reportEvidenceWarnings).toHaveLength(1);
  });
  it("does not recover persistence or authentication errors as evidence failures", async () => {
    const state = fixture(1); let calls = 0; const error = new Error("persist failed");
    await expect(extractReportEvidence(state, config, async () => { calls++; throw error; })).rejects.toBe(error);
    expect(calls).toBe(1);
  });

});
