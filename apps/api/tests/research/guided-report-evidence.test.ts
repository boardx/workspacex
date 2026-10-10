import { describe, expect, it } from "vitest";
import { canonicalEvidenceSources, extractReportEvidence, reportQuestions, selectQuestionEvidence, type ReportAudit } from "../../src/application/research/guided-report-evidence";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
import { ModelCallError } from "../../src/application/agent-run/ports";
import { prepareGeometry } from "./full-source-geometry-fixture";
import geometry from "../../../../docs/evidence/research-organizing-5546/original-geometry.json";
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
  matches: context.questions.map((question: any) => ({ questionId: question.id, quote: (chunk.content ?? chunk.quoteOptions[0].text).slice(0, 80), insight: "Interpretation must be checked against the quote.", relevance: "direct" })) })) });
describe("verified report evidence coverage", () => {
  it("keeps healthy chunks of a partially rejected source in the original 23-batch geometry", async () => {
    const state = prepareGeometry(fixture());
    const originalSources = structuredClone(state.sources);
    const calls: number[] = [];
    const run = () => extractReportEvidence(state, config, async (input, validate) => {
      const context = JSON.parse(input.user);
      calls.push(context.batchIndex);
      if (context.batchIndex === 15) throw new ModelCallError("MODEL_CALL_FAILED", "HTTP 400", undefined, undefined, "content-policy");
      return validate(JSON.stringify({ evaluations: context.chunks.map((chunk: any) => ({ sourceId: chunk.sourceId,
        chunkId: chunk.chunkId, irrelevant: false, matches: [{ questionId: context.questions[0].id,
          quoteRef: chunk.quoteOptions[0].quoteRef, insight: "Controlled geometry match, not a semantic acceptance claim.", relevance: "context" }] })) }));
    }, undefined, [], undefined, "controlled-config");
    const result = await run();
    expect(calls.sort((a, b) => a - b)).toEqual(geometry.batches.map(batch => batch.batchIndex));
    expect(result.sources).toHaveLength(22);
    expect(state.sources).toEqual(originalSources);
    const rejected = state.reportEvidenceWarnings?.find(warning => warning.reason === "batch_provider_content_rejected");
    expect(rejected).toMatchObject({ batchIndex: 15, chunks: geometry.batches[15]!.chunks.map(({ sourceId, chunkId }) => ({ sourceId, chunkId })) });
    const partialSource = geometry.sources[15]!.id;
    const retained = state.privateLedger?.records.filter(record => record.sourceId === partialSource) ?? [];
    expect(retained.map(record => record.chunkId).sort()).toEqual(Array.from({ length: 8 }, (_, index) => `source:${partialSource}/chunk:${index + 2}`).sort());
    expect([...result.matches.values()].flat().some(match => match.sourceId === partialSource)).toBe(true);
    calls.length = 0;
    await run();
    expect(calls).toHaveLength(22);
    expect(calls).not.toContain(15);
    expect(state.sources).toEqual(originalSources);
  });
  it("excludes a provider-rejected batch without replaying it and keeps healthy verified evidence", async () => {
    const state = fixture(16); const calls: number[] = [];
    const result = await extractReportEvidence(state, config, async (input, validate) => {
      const context = JSON.parse(input.user); calls.push(context.batchIndex);
      if (context.batchIndex === 0) throw new ModelCallError("MODEL_CALL_FAILED", "model provider responded with HTTP 400", undefined, undefined, "content-policy");
      return validate(JSON.stringify(evaluate(context)));
    });
    expect(calls.sort()).toEqual([0, 1]);
    expect([...result.matches.values()].flat().every(item => Number(item.sourceId.slice(1)) >= 8)).toBe(true);
    expect([...result.matches.values()].flat()).toHaveLength(state.sources.slice(8).length * state.outline[0]!.questions.length);
    expect(state.reportEvidenceWarnings?.[0]).toMatchObject({ reason: "batch_provider_content_rejected", sourceIds: state.sources.slice(0, 8).map(s => s.id) });
  });
  it.each([undefined, "rate-limited", "temporarily-unavailable"] as const)("does not swallow an unclassified provider error (%s)", async disposition => {
    const error = new ModelCallError("MODEL_CALL_FAILED", "model provider responded with HTTP 400", undefined, disposition);
    await expect(extractReportEvidence(fixture(16), config, async () => { throw error; })).rejects.toBe(error);
  });
  it("fails when every batch is rejected instead of publishing an empty report", async () => {
    const state = fixture(16);
    await expect(extractReportEvidence(state, config, async () => { throw new ModelCallError("MODEL_CALL_FAILED", "model provider responded with HTTP 400", undefined, undefined, "content-policy"); })).rejects.toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
    expect(state.reportEvidenceWarnings?.every(w => w.reason === "batch_provider_content_rejected")).toBe(true);
  });
  it("reuses only an identical full rejected request within the same adapter configuration", async () => {
    const state = fixture(16); let rejectedCalls = 0;
    const audit: ReportAudit = async(input,validate)=>{
      const context=JSON.parse(input.user);
      if(context.batchIndex===0){rejectedCalls++;throw new ModelCallError("MODEL_CALL_FAILED","HTTP 400",undefined,undefined,"content-policy");}
      return validate(JSON.stringify(evaluate(context)));
    };
    const run=(identity="same")=>extractReportEvidence(state,config,audit,undefined,[],undefined,identity);
    await run(); await run(); expect(rejectedCalls).toBe(1);
    state.outline[0]!.questions[0]="A changed question";
    await run(); expect(rejectedCalls).toBe(2);
    await run("new configuration"); expect(rejectedCalls).toBe(3);
    state.sources[0]!.content+=" Changed original content.";
    await run("new configuration"); expect(rejectedCalls).toBe(4);
    expect(state.reportEvidenceWarnings).toHaveLength(1);
    expect(state.reportEvidenceWarnings![0]).toHaveProperty("chunks.0.contentHash");
  });
  it("propagates cancellation rather than treating it as a rejected batch", async () => {
    const error=new DOMException("Stopped","AbortError");
    await expect(extractReportEvidence(fixture(16),config,async()=>{throw error;})).rejects.toBe(error);
  });
  it("fingerprints the actual rejected repair request and retains already verified chunks", async()=>{
    const state=fixture(2);let calls=0;
    const audit:ReportAudit=async(input,validate)=>{
      calls++;const context=JSON.parse(input.user);
      if(context.reportStage==="evidence_revision") throw new ModelCallError("MODEL_CALL_FAILED","HTTP 400",undefined,undefined,"content-policy");
      const output=evaluate(context);output.evaluations[1].matches[0].quote="fabricated";
      return validate(JSON.stringify(output));
    };
    const result=await extractReportEvidence(state,config,audit,undefined,[],undefined,"same");
    expect([...result.matches.values()].flat().every(match=>match.sourceId==="s0")).toBe(true);
    expect(state.reportEvidenceWarnings?.[0]?.sourceIds).toEqual(["s1"]);
    await extractReportEvidence(state,config,audit,undefined,[],undefined,"same");
    expect(calls).toBe(3); // Initial request still runs; the identical refused repair does not.
  });
  it("extracts independent batches with a bound and preserves deterministic evidence order", async () => {
    const state = fixture(40);
    let active = 0, peak = 0;
    let release!: () => void;
    const slow = new Promise<void>((resolve) => { release = resolve; });
    let thirdStarted!: () => void;
    const third = new Promise<void>((resolve) => { thirdStarted = resolve; });
    const operation = extractReportEvidence(state, config, async (input, validate) => {
      const context = JSON.parse(input.user);
      active++; peak = Math.max(peak, active);
      if (context.batchIndex === 3) thirdStarted();
      if (context.batchIndex < 4) await slow;
      active--;
      return validate(JSON.stringify(evaluate(context)));
    });
    try {
      await Promise.race([third, new Promise((_, reject) => setTimeout(() => reject(new Error("serial evidence extraction")), 1000))]);
      expect(peak).toBe(4);
    } finally { release(); }
    const result = await operation;
    expect(result.matches.values().next().value?.map((item) => item.sourceId)).toEqual(state.sources.map((source) => source.id));
  });
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
    expect(batches.flatMap((batch) => batch.chunks).reduce((sum, chunk) => sum + (chunk.content ?? chunk.quoteOptions.map((option: any) => option.text).join("")).length, 0)).toBe(30000);
    expect(batches.every((batch) => batch.chunks.length <= 8 && batch.chunks.reduce((sum: number, chunk: any) => sum + (chunk.content ?? chunk.quoteOptions.map((option: any) => option.text).join("")).length, 0) <= 24000)).toBe(true);
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
  it("retains only wholly valid chunks from the first attempt when failed chunks repair as irrelevant", async () => {
    const state = fixture(2); let calls = 0;
    const result = await extractReportEvidence(state, config, auditFor((context) => {
      calls++; const output = evaluate(context);
      if (calls === 1) output.evaluations[1].matches[0].quote = "fabricated";
      else for (const evaluation of output.evaluations) { evaluation.matches = []; evaluation.irrelevant = true; }
      return output;
    }));
    expect(calls).toBe(2); expect([...result.matches.values()].flat()).toHaveLength(2);
    expect([...result.matches.values()].flat().every((item) => item.sourceId === "s0" && !item.quote.includes("fabricated"))).toBe(true);
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
