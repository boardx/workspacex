import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { extractReportEvidence, type ReportAudit } from "../../src/application/research/guided-report-evidence";
import type { ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
import { PersistedResearchRuntimeSchema, toPublicResearchRuntime } from "../../src/application/research/guided-runtime-persistence";
function fixture(): ResearchRuntime {
  const text = "The public report records a measurable cost reduction for this project.";
  return { sessionId: "s", version: 1, revision: 1, currentNode: "report", availableNodes: ["report"],
    brief: { topic: "Policy", goal: "Compare", timeRange: "2026", region: "EU", focus: "Grid" }, directions: [],
    outline: [{ id: "chapter", title: "Policy", order: 0, enabled: true, questions: ["What are the costs?"] }],
    tasks: [{ id: "t", sectionId: "chapter", query: "costs", status: "succeeded", attempts: 1, errorCode: null }],
    sources: [{ id: "source", taskId: "t", title: "Report", content: text, url: "https://example.com/report", retrievedAt: "2026-10-20", decision: "accepted",
      document: { text, url: "https://example.com/report", retrievedAt: "2026-10-20", contentKind: "text", truncated: false, contentHash: createHash("sha256").update(text).digest("hex"), summary: text } }],
    report: null, completed: false, busy: true, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [] };
}
const config = { provider: "test", id: "model" };
function audit(negative = false) {
  return vi.fn<ReportAudit>(async (input, validate) => {
    const c = JSON.parse(input.user);
    return validate(JSON.stringify({ evaluations: c.chunks.map((chunk: any) => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: negative,
      matches: negative ? [] : [{ questionId: c.questions[0].id, quoteRef: chunk.quoteOptions[0].quoteRef, insight: "Document reports costs.", relevance: "direct" }] })) }));
  });
}
it.each([false, true])("reuses complete validated evidence including negative outcomes (%s) across persistence", async negative => {
  const state = fixture(), model = audit(negative);
  const first = await extractReportEvidence(state, config, model, undefined, [], undefined, "adapter-a");
  const restored = PersistedResearchRuntimeSchema.parse(JSON.parse(JSON.stringify(state)));
  const second = await extractReportEvidence(restored, config, model, undefined, [], undefined, "adapter-a");
  expect(model).toHaveBeenCalledTimes(1);
  expect([...second.matches]).toEqual([...first.matches]);
  expect(JSON.stringify(toPublicResearchRuntime(restored))).not.toContain("privateReportEvidence");
});
it("does not infer complete extraction from positive ledger records", async () => {
  const state = fixture(), model = audit();
  await extractReportEvidence(state, config, model, undefined, [], undefined, "adapter-a");
  delete (state as any).privateReportEvidenceBatches;
  await extractReportEvidence(state, config, model, undefined, [], undefined, "adapter-a");
  expect(model).toHaveBeenCalledTimes(2);
});
it.each(["question", "body", "model", "adapter", "policy", "record"])("invalidates changed %s", async change => {
  const state = fixture(), model = audit();
  await extractReportEvidence(state, config, model, undefined, [], undefined, "adapter-a");
  if (change === "question") state.outline[0]!.questions[0] = "What are the operating costs?";
  if (change === "body") { state.sources[0]!.document!.text += " New material."; state.sources[0]!.document!.contentHash = createHash("sha256").update(state.sources[0]!.document!.text).digest("hex"); }
  if (change === "policy") state.brief.region = "USA";
  if (change === "record") state.privateLedger!.records[0]!.quote = "fabricated";
  await extractReportEvidence(state, change === "model" ? { ...config, id: "other" } : config, model, undefined, [], undefined, change === "adapter" ? "adapter-b" : "adapter-a");
  expect(model).toHaveBeenCalledTimes(2);
});
it("does not reuse across unknown adapter configurations", async () => {
  const state = fixture(), model = audit();
  await extractReportEvidence(state, config, model);
  await extractReportEvidence(state, config, model);
  expect(model).toHaveBeenCalledTimes(2);
});
it("retains completed batches after an interrupted extraction and retries only missing coverage", async () => {
  const state = fixture();
  const source = state.sources[0]!;
  state.sources = Array.from({ length: 9 }, (_, index) => ({ ...structuredClone(source), id: `s${index}`, url: `https://example.com/${index}` }));
  const healthy = audit(); let interrupted = true;
  let saved!: () => void; const checkpoint = new Promise<void>(resolve => { saved = resolve; });
  const model: ReportAudit = async (input, validate) => {
    const c = JSON.parse(input.user);
    if (interrupted && c.batchIndex === 1) { await checkpoint; throw new DOMException("Stopped", "AbortError"); }
    return healthy(input, validate);
  };
  await expect(extractReportEvidence(state, config, model, undefined, [], undefined, "same", { persist: async () => { saved(); } })).rejects.toMatchObject({ name: "AbortError" });
  expect(state.privateReportEvidenceBatches).toHaveLength(1);
  interrupted = false; healthy.mockClear();
  const restored = PersistedResearchRuntimeSchema.parse(JSON.parse(JSON.stringify(state)));
  const result = await extractReportEvidence(restored, config, model, undefined, [], undefined, "same");
  expect(healthy).toHaveBeenCalledTimes(1);
  expect([...result.matches.values()].flat()).toHaveLength(9);
});
it("drops excluded source facts instead of reviving them from cached coverage", async () => {
  const state = fixture(), model = audit();
  await extractReportEvidence(state, config, model, undefined, [], undefined, "same");
  state.sources[0]!.decision = "excluded";
  await expect(extractReportEvidence(state, config, model, undefined, [], undefined, "same")).rejects.toThrow("RESEARCH_SOURCES_REQUIRED");
});
it("never marks invalid responses as completed negative coverage", async () => {
  const state = fixture();
  const invalid: ReportAudit = async (_input, validate) => validate('{"evaluations":[]}');
  await expect(extractReportEvidence(state, config, invalid, undefined, [], undefined, "same")).rejects.toThrow();
  expect(state.privateReportEvidenceBatches).toBeUndefined();
  const valid = audit(true);
  await extractReportEvidence(state, config, valid, undefined, [], undefined, "same");
  expect(valid).toHaveBeenCalledTimes(1);
});

it.each([false, true])("reuses complete batches with repeated passages and context/direct replacement (%s)", async mixed => {
  const state = fixture();
  const passage = "Repeated policy evidence establishes a limited cost comparison. ";
  const chunk = passage + " ".repeat(6000 - passage.length);
  const text = chunk.repeat(9);
  state.sources[0]!.document!.text = text;
  state.sources[0]!.document!.contentHash = createHash("sha256").update(text).digest("hex");
  const model = vi.fn<ReportAudit>(async (input, validate) => {
    const c = JSON.parse(input.user);
    return validate(JSON.stringify({ evaluations: c.chunks.map((block: any) => ({ sourceId: block.sourceId, chunkId: block.chunkId, irrelevant: false,
      matches: [{ questionId: c.questions[0].id, quote: passage.trim(), insight: "A bounded cost comparison.", relevance: mixed && block.chunkId.endsWith(":0") ? "context" : "direct" }] })) }));
  });
  const first = await extractReportEvidence(state, config, model, undefined, [], undefined, "same");
  expect(model).toHaveBeenCalledTimes(3);
  model.mockClear();
  const restored = PersistedResearchRuntimeSchema.parse(JSON.parse(JSON.stringify(state)));
  const next = await extractReportEvidence(restored, config, model, undefined, [], undefined, "same");
  expect(model).not.toHaveBeenCalled();
  expect([...next.matches]).toEqual([...first.matches]);
});
it("prioritizes task-linked sources without filtering other canonical documents", async () => {
  const state = fixture(), original = state.sources[0]!;
  state.tasks.push({ ...state.tasks[0]!, id: "other-task", sectionId: "other-section" });
  state.sources = Array.from({ length: 9 }, (_, index) => ({ ...structuredClone(original), id: `s${index}`, taskId: index === 8 ? "t" : "other-task", url: `https://example.com/${index}` }));
  const order: string[] = [], healthy = audit();
  const model: ReportAudit = async (input, validate) => { order.push(...JSON.parse(input.user).chunks.map((chunk: any) => chunk.sourceId)); return healthy(input, validate); };
  const result = await extractReportEvidence(state, config, model, new Set(["chapter"]));
  expect(order[0]).toBe("s8"); expect(new Set(order).size).toBe(9);
  expect([...result.matches.values()].flat()).toHaveLength(9);
});
