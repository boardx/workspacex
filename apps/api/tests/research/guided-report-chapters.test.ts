import { validateRuntimeDraft } from "../../src/application/research/guided-runtime-service";
import { describe, expect, it, vi } from "vitest";
import { chapterEvidence, generateReportChapters, validateGeneratedChapter } from "../../src/application/research/guided-report-chapters";
import type { RuntimePersistence } from "../../src/application/research/guided-report-stream";
import type { ResearchRuntime, RuntimeStreamEvent } from "../../src/application/research/guided-runtime-ports";
import type { ModelCallPort } from "../../src/application/agent-run/ports";
const section = (id: string, title: string, order: number, enabled = true) => ({ id, title, order, enabled, questions: [`What does ${id} establish?`] });
const body = (id: string) => `### Evidence\n\nThe source describes a limited policy requirement, supporting this comparison while leaving implementation uncertain. [[source:${id}]]\n\n### Decision implications\n\nThe requirement may affect entry timing and verification effort; this is an inference, not proof of profitability.\n\n### Recommended next steps\n\nVerify the unanswered implementation questions with local primary sources before making an irreversible investment decision.`;
function fixture() {
  const state: ResearchRuntime = { sessionId: "s", version: 4, revision: 1, currentNode: "report", availableNodes: ["report"],
    brief: { topic: "Policy", goal: "Compare", timeRange: "2026", region: "EU", focus: "Grid" }, directions: [],
    outline: [section("b", "Second specified title", 0), section("disabled", "Excluded", 1, false), section("a", "First specified title", 2)],
    tasks: ["a", "b"].map((id) => ({ id: `task-${id}`, sectionId: id, query: `${id} policy`, status: "succeeded", attempts: 1, errorCode: null })),
    sources: ["a", "b"].map((id) => ({ id: `source-${id}`, taskId: `task-${id}`, title: id, content: `Evidence for ${id}`, url: `https://example.com/${id}`, retrievedAt: "2026-09-07", decision: "accepted" })), report: null,
    completed: false, busy: true, leaseUntil: null, errorCode: null, generatedNodes: [], messages: [], proposal: null, modelCalls: [] };
  const writes: ResearchRuntime[] = []; const events: RuntimeStreamEvent[] = [];
  const persist: RuntimePersistence = Object.assign(async () => { writes.push(structuredClone(state)); }, { requestId: "request", observe: (event: RuntimeStreamEvent) => { events.push(event); } });
  return { state, writes, events, persist };
}
const config = { provider: "test", id: "model" };
function answer(context: { reportStage: string; section?: { id: string }; sources?: { id: string }[] }) {
  return context.reportStage === "chapter" ? { sectionId: context.section!.id, body: body(context.sources![0]!.id), sourceIds: [context.sources![0]!.id] } : { title: "Evidence-based findings", summary: "The two chapters support a cautious comparison. [[source:source-b]]" };
}
describe("chapter-based report generation", () => {
  it("makes N chapter calls in exact enabled order then synthesizes, streaming actual deltas into one aggregate", async () => {
    const f = fixture(); const contexts: Record<string, any>[] = []; const inputs: string[] = [];
    const complete = vi.fn();
    const model: ModelCallPort = { complete, completeStream: async (input, delta) => {
      const context = JSON.parse(input.user); contexts.push(context); inputs.push(input.system);
      const text = JSON.stringify(answer(context)); await delta(text.slice(0, 24)); await delta(text.slice(24)); return { text };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(contexts.map((c) => c.reportStage)).toEqual(["chapter", "chapter", "synthesis"]);
    expect(contexts.slice(0, 2).map((c) => c.section.title)).toEqual(["Second specified title", "First specified title"]);
    expect(contexts[0]!.sources[0]).toMatchObject({ id: "source-b", evidenceScope: "chapter" });
    expect(contexts[0]!.section.questions).toEqual(["What does b establish?"]);
    expect(report.sections.map((s) => s.sectionId)).toEqual(["b", "a"]);
    expect(f.state.modelCalls.map((call) => call.status)).toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(JSON.parse(f.state.reportStream!.text)).toEqual(report);
    expect(f.events[0]?.type).toBe("snapshot"); expect(complete).not.toHaveBeenCalled();
    expect(inputs[0]).toContain("1400–2200"); expect(inputs[0]).toContain("Never invent facts");
  });
  it("keeps earlier chapters durably visible before a later chapter resolves and does not accept failed output", async () => {
    const f = fixture(); let release!: () => void; let started!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; }); const waiting = new Promise<void>((resolve) => { started = resolve; });
    let calls = 0;
    const model: ModelCallPort = { complete: vi.fn(), completeStream: async (input, delta) => {
      const context = JSON.parse(input.user); calls++;
      const text = JSON.stringify(answer(context)); await delta(text);
      if (calls === 2) { started(); await blocked; throw new Error("chapter provider failed"); }
      return { text };
    } };
    const generating = generateReportChapters(f.state, model, config, f.persist); const rejection = expect(generating).rejects.toThrow("chapter provider failed");
    await waiting;
    expect(f.writes.some((snapshot) => snapshot.reportStream?.text.includes('"sectionId":"b"'))).toBe(true);
    expect(f.state.report).toBeNull(); expect(f.state.modelCalls[0]?.status).toBe("succeeded");
    release(); await rejection;
    expect(calls).toBe(2); expect(f.state.reportStream?.status).toBe("failed"); expect(f.state.report).toBeNull();
  });
  it("rejects mismatched inline IDs, chapter IDs, superficial text, and invented synthesis sources", async () => {
    const f = fixture(); const chapter = { sectionId: "b", body: body("source-b"), sourceIds: ["source-b"] };
    expect(() => validateGeneratedChapter(chapter, f.state.outline[0]!, new Set(["source-b"]))).not.toThrow();
    for (const bad of [{ ...chapter, sectionId: "a" }, { ...chapter, sourceIds: ["source-a"] }, { ...chapter, body: "One sentence [[source:source-b]]" }]) {
      expect(() => validateGeneratedChapter(bad, f.state.outline[0]!, new Set(["source-b"])) ).toThrow();
    }
    const model: ModelCallPort = { complete: async (input) => { const c = JSON.parse(input.user); return { text: JSON.stringify(c.reportStage === "synthesis" ? { title: "Bad", summary: "Invented [[source:unknown]]" } : answer(c)) }; } };
    await expect(generateReportChapters(f.state, model, config, f.persist)).rejects.toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
    expect(f.state.report).toBeNull(); expect(f.state.modelCalls.at(-1)?.status).toBe("failed");
  });
  it("bounds source excerpts, excludes deleted evidence and labels shared evidence with explicit gaps", async () => {
    const f = fixture(); f.state.sources[1]!.decision = "excluded";
    f.state.sources[0]!.content = "x".repeat(30000); f.state.tasks[1]!.status = "failed"; f.state.reportPartial = true;
    const evidence = chapterEvidence(f.state, f.state.outline[0]!);
    expect(evidence).toHaveLength(1); expect(evidence[0]).toMatchObject({ id: "source-a", evidenceScope: "shared_context" }); expect(evidence[0]!.content).toHaveLength(4000);
    const contexts: any[] = [];
    const model: ModelCallPort = { complete: async (input) => { const c = JSON.parse(input.user); contexts.push(c); return { text: JSON.stringify(c.reportStage === "synthesis" ? { title: "Limited", summary: "Coverage is limited." } : answer(c)) }; } };
    await generateReportChapters(f.state, model, config, f.persist);
    expect(contexts[0].evidenceGaps).toEqual([{ query: "b policy", status: "failed", errorCode: null }]); expect(contexts[0].reportPartial).toBe(true);
  });
  it("degrades a zero-delta streaming adapter to honest loading without fabricating completed text", async () => {
    const f = fixture(); let calls = 0;
    const model: ModelCallPort = { complete: vi.fn(), completeStream: async (input, delta) => {
      const text = JSON.stringify(answer(JSON.parse(input.user))); calls++;
      if (calls !== 2) await delta(text);
      return { text };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(report.sections).toHaveLength(2); expect(calls).toBe(3);
    expect(f.state.reportStream?.text).toBe("");
    const reset = f.events.reduce((latest, event, index) => event.type === "snapshot" ? index : latest, -1);
    expect(reset).toBeGreaterThan(0); expect(f.events.slice(reset + 1).some((event) => event.type === "report_delta")).toBe(false);
  });
  it("applies citation and order guards to manual drafts while retaining readable legacy reports", () => {
    const f = fixture();
    const report = { title: "Report", summary: "Known evidence [[source:source-b]]", sections: [
      { sectionId: "b", body: body("source-b"), sourceIds: ["source-b"] },
      { sectionId: "a", body: body("source-a"), sourceIds: ["source-a"] },
    ] };
    expect(() => validateRuntimeDraft(f.state, { node: "report", value: report })).not.toThrow();
    for (const value of [
      { ...report, sections: [...report.sections].reverse() },
      { ...report, summary: "Invented [[source:unknown]]" },
      { ...report, sections: [{ ...report.sections[0]!, body: "Unknown [[source:unknown]]" }, report.sections[1]!] },
      { ...report, sections: [{ ...report.sections[0]!, body: "Broken [[source:source-b]" }, report.sections[1]!] },
    ]) expect(() => validateRuntimeDraft(f.state, { node: "report", value })).toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
    expect(() => validateRuntimeDraft(f.state, { node: "report", value: { ...report, summary: "Legacy", sections: report.sections.map((chapter) => ({ ...chapter, body: "Legacy content without inline citations" })) } })).not.toThrow();
    f.state.sources[1]!.decision = "excluded";
    expect(() => validateRuntimeDraft(f.state, { node: "report", value: report })).toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
  });

  it("caps synthesis body context at 60000 characters across thirty long chapters", async () => {
    const f = fixture(); f.state.outline = Array.from({ length: 30 }, (_, index) => section(`section-${index}`, `Chapter ${index}`, index));
    let synthesis: { chapters: { body: string; excerpted: boolean }[] } | undefined;
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user);
      if (context.reportStage === "synthesis") { synthesis = context; return { text: JSON.stringify({ title: "Bounded", summary: "Limited evidence." }) }; }
      const id = context.sources[0].id;
      return { text: JSON.stringify({ sectionId: context.section.id, body: `${body(id)}\n\n${"Controlled fixture content. ".repeat(500)}`, sourceIds: [id] }) };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(report.sections).toHaveLength(30); expect(f.state.modelCalls).toHaveLength(31);
    expect(synthesis!.chapters.reduce((total, chapter) => total + chapter.body.length, 0)).toBeLessThanOrEqual(60000);
    expect(synthesis!.chapters.every((chapter) => chapter.excerpted && chapter.body.length <= 2000)).toBe(true);
  });

});
