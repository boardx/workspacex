import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { executeComposite, type CompositeSteps } from "../../src/application/research/guided-composite-execution";
import { extractReportEvidence, selectQuestionEvidence } from "../../src/application/research/guided-report-evidence";
import { canRecoverPartialReport } from "../../src/application/research/guided-partial-report-recovery";
import { ResearchRuntimeError, type ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
import type { RuntimePersistence } from "../../src/application/research/guided-report-stream";

function fixture() {
  const text = "Public permits require local verification.";
  const state = { sessionId: "partial", version: 2, revision: 1, currentNode: "outline", availableNodes: ["brief", "directions", "outline"],
    brief: { topic: "Policy", goal: "Compare", region: "EU", focus: "Permits", timeRange: "2026" }, directions: [],
    outline: [{ id: "s", title: "Policy", order: 0, enabled: true, questions: ["What permits?"] }],
    tasks: [{ id: "a", sectionId: "s", query: "permits", status: "succeeded", attempts: 1, errorCode: null },
      { id: "b", sectionId: "s", query: "limitations", status: "failed", attempts: 1, errorCode: "NO_RELEVANT_SOURCES", searchAttempts: [{ query: "limitations", status: "failed", errorCode: "NO_RELEVANT_SOURCES" }] }],
    sources: [{ id: "source", taskId: "a", title: "Public policy", url: "https://example.org/policy", content: text, decision: "accepted", retrievedAt: "2026-01-01",
      document: { text, contentHash: createHash("sha256").update(text).digest("hex"), contentKind: "text", truncated: false, url: "https://example.org/policy", retrievedAt: "2026-01-01" } }],
    report: null, completed: false, busy: true, leaseUntil: null, errorCode: null, generatedNodes: ["brief", "directions", "outline"], messages: [], proposal: null, modelCalls: [] } as ResearchRuntime;
  const failure = new ResearchRuntimeError("RESEARCH_SEARCH_PARTIAL_FAILURE");
  const steps: CompositeSteps = { save: vi.fn(), search: vi.fn(async () => { throw failure; }), generate: vi.fn(async () => { state.reportDraft = { title: "Draft" } as ResearchRuntime["reportDraft"]; }), completeReport: vi.fn(), validateOutline: vi.fn(), activity: vi.fn() };
  const persist = Object.assign(vi.fn(async () => {}), { observe: vi.fn(), requestId: "r" }) as RuntimePersistence;
  const run = () => executeComposite(state, { sessionId: "partial", requestId: "r", expectedVersion: 2, node: "outline", action: "generate_report" }, persist, steps);
  return { state, steps, run, failure };
}
describe("terminal partial search draft admission", () => {
  it("preserves failure and refuses completion even after generating a draft", async () => {
    const f = fixture(); await expect(f.run()).rejects.toMatchObject({ reasonCode: "RESEARCH_SEARCH_PARTIAL_FAILURE" });
    expect(f.steps.generate).toHaveBeenCalledWith("report", false); expect(f.steps.completeReport).not.toHaveBeenCalled();
    expect(f.state.tasks[1]!.status).toBe("failed"); expect(f.state.reportPartial).toBe(true); expect(f.state.completed).toBe(false);
  });
  it.each(["pending", "running"] as const)("refuses %s tasks", async status => {
    const f = fixture(); f.state.tasks[1]!.status = status;
    await expect(f.run()).rejects.toBe(f.failure); expect(f.steps.generate).not.toHaveBeenCalled();
  });
  it("refuses a running attempt even when its task is marked failed", async () => {
    const f = fixture(); f.state.tasks[1]!.searchAttempts![0]!.status = "running";
    await expect(f.run()).rejects.toBe(f.failure); expect(f.steps.generate).not.toHaveBeenCalled();
  });
  it.each(["excluded", "hash", "policy", "no-document"])("refuses unusable material: %s", async mode => {
    const f = fixture(), source = f.state.sources[0]!;
    if (mode === "excluded") source.decision = "excluded";
    if (mode === "hash") source.document!.text += " changed";
    if (mode === "policy") f.state.sourcePolicy = { revision: 1, mode: "restrict", domains: ["other.org"], internalSourceIds: [] };
    if (mode === "no-document") source.document = undefined;
    expect(canRecoverPartialReport(f.state)).toBe(false);
    await expect(f.run()).rejects.toBe(f.failure); expect(f.steps.generate).not.toHaveBeenCalled();
  });
  it("extracts current questions afresh and context never counts as direct coverage", async () => {
    const f = fixture();
    await extractReportEvidence(f.state, { provider: "controlled", id: "mock" }, async (input, validate) => {
      const context = JSON.parse(input.user);
      return validate(JSON.stringify({ evaluations: context.chunks.map((chunk: { sourceId: string; chunkId: string; quoteOptions: { quoteRef: string }[] }) => ({
        sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: false,
        matches: [{ questionId: context.questions[0].id, quoteRef: chunk.quoteOptions[0]!.quoteRef, insight: "Original question evidence", relevance: "direct" }],
      })) }));
    });
    expect(f.state.privateLedger?.records.some(record => record.relevance === "direct")).toBe(true);
    f.state.outline[0]!.questions = ["What new restrictions apply?", "What future costs?"];
    const calls: string[][] = [];
    const audit = await extractReportEvidence(f.state, { provider: "controlled", id: "mock" }, async (input, validate) => {
      const context = JSON.parse(input.user);
      calls.push(context.questions.map((question: { question: string }) => question.question));
      return validate(JSON.stringify({ evaluations: context.chunks.map((chunk: { sourceId: string; chunkId: string; quoteOptions: { quoteRef: string }[] }) => ({
        sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: false,
        matches: [{ questionId: context.questions[0].id, quoteRef: chunk.quoteOptions[0]!.quoteRef, insight: "Background only", relevance: "context" }],
      })) }));
    });
    expect(calls.flat()).toContain("What new restrictions apply?");
    const selected = selectQuestionEvidence(audit, f.state.outline[0]!);
    expect(selected.map(question => question.gap)).toEqual([true, true]);
    expect(f.state.privateLedger?.records.every(record => record.relevance === "context")).toBe(true);
    expect(selected[0]!.evidence[0]?.relevance).toBe("context"); expect(selected[1]!.evidence).toEqual([]);
  });
  it("never advances after a paused search", async () => {
    const f = fixture(), paused = new ResearchRuntimeError("RESEARCH_WORKFLOW_PAUSED");
    f.steps.search = vi.fn(async () => { throw paused; });
    await expect(f.run()).rejects.toBe(paused); expect(f.steps.generate).not.toHaveBeenCalled();
  });
  it("does not swallow pause or a persistence failure", async () => {
    const f = fixture(), failure = new Error("persistence"); f.steps.search = vi.fn(async () => { throw failure; });
    await expect(f.run()).rejects.toBe(failure); expect(f.steps.generate).not.toHaveBeenCalled();
  });
});
