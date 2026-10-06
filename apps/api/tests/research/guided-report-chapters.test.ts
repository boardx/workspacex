import { research as C } from "@repo/contracts";
import { ModelCallError } from "../../src/application/agent-run/ports";
import { reportBasis, reportSourceAliases, canonicalReportText, aliasResolver } from "../../src/application/research/guided-report-checkpoint";
import { GuidedRuntimeService, validateRuntimeDraft } from "../../src/application/research/guided-runtime-service";
import { describe, expect, it, vi } from "vitest";
import { generateReportChapters, validateGeneratedChapter } from "../../src/application/research/guided-report-chapters";
import type { RuntimePersistence } from "../../src/application/research/guided-report-stream";
import type { ResearchRuntime, RuntimeStreamEvent, GuidedRuntimeStore, RuntimeActor } from "../../src/application/research/guided-runtime-ports";
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
function answer(context: any) {
  if (context.reportStage === "evidence" || context.researchStage === "source_relevance") return { evaluations: context.chunks.map((chunk: any) => {
    const matches = context.questions.filter((question: any) => context.researchStage === "source_relevance" ? chunk.questionIds.includes(question.id) : chunk.sourceId.endsWith(question.sectionId) || !context.chunks.some((candidate: any) => candidate.sourceId.endsWith(question.sectionId)))
      .map((question: any) => ({ questionId: question.id, quote: (chunk.content ?? chunk.quoteOptions[0].text).slice(0, 80), insight: "The excerpt supports a limited policy comparison.", relevance: "direct" }));
    return { sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: !matches.length, matches };
  }) };
  if (context.reportStage === "quality") return { questions: context.evidenceByQuestion.map((question: any) => ({ questionId: question.id, status: question.gap ? "gap" : "answered", rationale: "The chapter addresses this question with appropriate limitations." })), supported: true, analysisDepth: "adequate", issues: [] };
  if (["chapter", "chapter_revision"].includes(context.reportStage)) return { sectionId: context.section.id, body: body(context.sources[0].id), sourceIds: [context.sources[0].id] };
  return { introduction: "This study compares policy requirements using retrieved excerpts, with incomplete implementation coverage.", conclusion: "Prioritize local verification before investment, balancing entry speed against uncertain regulatory obligations.", title: "Evidence-based findings", summary: `The chapters support a cautious comparison. [[source:${context.chapters[0].sourceIds[0]}]]` };
}
describe("report conversation regeneration", () => {
  function setup(message: string, fail: boolean | "references" = false, draftOnly = false) {
    const f = fixture(); const old = { title: "Previous report", summary: "Saved summary", sections: ["b", "a"].map((id) => ({ sectionId: id, body: body(`source-${id}`), sourceIds: [`source-${id}`] })) };
    if (draftOnly) f.state.reportDraft = old; else f.state.report = old;
    const contexts: any[] = [];
    const store: GuidedRuntimeStore = { read: async () => f.state, claim: async () => ({ state: f.state, replay: false }), write: async (_actor, _request, state) => { f.writes.push(structuredClone(state)); } };
    const model: ModelCallPort = { complete: async (input) => {
      const c = JSON.parse(input.user); contexts.push(c);
      if (!c.reportStage && !c.researchStage) return { text: JSON.stringify({ assistantMessage: "Edited", action: "save", value: { ...old, summary: "Invalid [[source:unavailable]]" } }) };
      if (fail === true && c.reportStage) throw new Error("generation unavailable");
      if (fail === "references" && ["chapter", "chapter_revision"].includes(c.reportStage)) return { text: JSON.stringify({ sectionId: c.section.id, body: body("unavailable"), sourceIds: ["unavailable"] }) };
      return { text: JSON.stringify(answer(c)) };
    } };
    const service = new GuidedRuntimeService(store, model, { search: async () => [] }, config);
    const actor = { sessionId: "s", userId: "u", orgId: "org" } as RuntimeActor;
    const session = { sessionId: "s", brief: f.state.brief, directions: { versions: [] }, outline: { versions: [] }, sourceCount: 0, status: "draft", resumeStage: "brief" } as any;
    return { ...f, contexts, old, run: () => service.execute(actor, session, { sessionId: "s", requestId: "regen", node: "report", action: "message", message, draft: { node: "report", value: { ...old, title: "Unsaved title" } }, expectedVersion: 4 }, (event) => f.events.push(event)) };
  }
  it.each(["重新生成报告", "请重新生成报告", "重新生成", "regenerate report", "Please regenerate the report."])("regenerates explicit %s through the durable report pipeline", async (message) => {
    const f = setup(message); const result = await f.run();
    expect(result.errorCode).toBeNull(); expect(result.report?.title).toBe("Evidence-based findings"); expect(result.proposal).toBeNull();
    expect(f.contexts.some((c) => !c.reportStage && !c.researchStage)).toBe(false);
    expect(f.contexts.map((c) => c.reportStage).filter(Boolean)).toEqual(["evidence", "chapter", "chapter", "quality", "quality", "synthesis"]);
    expect(result.messages.some((entry) => entry.role === "user" && entry.text === message)).toBe(true);
    expect(result.reportPrevious?.report).toEqual(f.old);
    expect(result.reportTimeline?.every((stage) => stage.status === "completed")).toBe(true);
    expect(f.events.some((event) => event.type === "result")).toBe(true);
  });
  it.each([false, true])("preserves saved report/draft on generation failure (draft=%s)", async (draftOnly) => {
    const f = setup("重新生成报告", true, draftOnly); const result = await f.run();
    expect(result.errorCode).not.toBeNull(); expect(draftOnly ? result.reportPrevious?.draft : result.reportPrevious?.report).toEqual(f.old);
    expect(result.completed).toBe(false); expect(result.proposal).toBeNull();
  });
  it("still rejects unavailable citations produced by the generation pipeline", async () => {
    const f = setup("重新生成报告", "references"); const result = await f.run();
    expect(result.errorCode).not.toBeNull();
    expect(f.contexts.some((c) => c.reportStage === "chapter")).toBe(true);
    expect(f.contexts.some((c) => c.reportStage === "synthesis")).toBe(false);
    expect(result.reportPrevious?.report).toEqual(f.old);
    expect(result.report).toBeNull();
    expect(result.completed).toBe(false);
    expect(result.proposal).toBeNull();
  });
  it("does not bypass missing accepted source preconditions", async () => {
    const f = setup("重新生成报告"); f.state.sources = [];
    const result = await f.run();
    expect(result.errorCode).not.toBeNull(); expect(f.contexts).toHaveLength(0);
    expect(result.report).toEqual(f.old);
  });
  it.each(["不要重新生成报告", "如何重新生成报告？", "“重新生成报告”是什么意思", "修改报告标题", "Do not regenerate report"])("keeps %s on discussion and citation validation", async (message) => {
    const f = setup(message); const result = await f.run();
    expect(result.errorCode).toBe("RESEARCH_CONTENT_REFERENCE_INVALID"); expect(f.contexts).toHaveLength(1);
    expect(f.contexts[0].instruction).toBe(message); expect(result.report).toEqual(f.old); expect(result.reportCheckpoint).toBeUndefined();
  });
});

describe("chapter-based report generation", () => {
  it("rejects callbacks retained by a failed stream attempt during retry", async () => {
    const f = fixture();
    let old: ((delta: string) => Promise<void>) | undefined;
    let checked = false;
    const model: ModelCallPort = {
      complete: async (input) => ({ text: JSON.stringify(answer(JSON.parse(input.user))) }),
      completeStream: async (input, emit) => {
        const context = JSON.parse(input.user);
        if (!old) { old = emit; throw new ModelCallError("MODEL_CALL_FAILED", "model provider responded with HTTP 503"); }
        if (!checked) {
          checked = true;
          const writes = f.writes.length;
          await expect(old("stale output")).rejects.toThrow("RESEARCH_EXECUTION_INTERRUPTED");
          expect(f.writes.length).toBe(writes);
        }
        const text = JSON.stringify(answer(context));
        await emit(text);
        return { text };
      },
    };
    await generateReportChapters(f.state, model, config, f.persist);
    expect(checked).toBe(true);
    expect(f.state.reportStream?.text).not.toContain("stale output");
  });
  it("bounds a stalled evidence provider and ignores late responses", async () => {
    vi.useFakeTimers();
    try {
      const f = fixture();
      let release!: (value: { text: string }) => void;
      let signal: AbortSignal | undefined;
      const operation = generateReportChapters(f.state, { complete: async (input) => {
        signal = input.signal;
        return new Promise((resolve) => { release = resolve; });
      } }, config, f.persist);
      const rejected = expect(operation).rejects.toThrow("RESEARCH_REPORT_MODEL_TIME_BUDGET_EXCEEDED");
      await vi.advanceTimersByTimeAsync(90_000);
      await rejected;
      expect(signal?.aborted).toBe(true);
      const writes = f.writes.length;
      release({ text: "{}" });
      await vi.advanceTimersByTimeAsync(1);
      expect(f.writes.length).toBe(writes);
    } finally { vi.useRealTimers(); }
  });
  it("overlaps evidence calls while serializing durable writes and keeping progress monotonic", async () => {
    const f = fixture();
    f.state.sources = Array.from({ length: 24 }, (_, index) => ({ ...f.state.sources[index % 2]!, id: `source-${index}-${index % 2 ? "a" : "b"}`, url: `https://example.com/${index}` }));
    let active = 0, peak = 0, activeWrites = 0, writePeak = 0;
    const persist: RuntimePersistence = Object.assign(async () => {
      activeWrites++; writePeak = Math.max(writePeak, activeWrites);
      await Promise.resolve(); f.writes.push(structuredClone(f.state)); activeWrites--;
    }, { requestId: "parallel-evidence", observe: f.persist.observe });
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user);
      if (context.reportStage === "evidence") {
        active++; peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, context.batchIndex === 0 ? 20 : 1));
        active--;
      }
      return { text: JSON.stringify(answer(context)) };
    } };
    const report = await generateReportChapters(f.state, model, config, persist);
    expect(peak).toBe(3); expect(writePeak).toBe(1);
    expect(f.writes.filter(state => state.progress?.stage === "organizing").every(state => state.progress?.executionVersion === f.state.version)).toBe(true);
    const progress = f.writes.filter((state) => state.progress?.stage === "organizing").map((state) => state.progress!.completed);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    expect(Math.max(...progress)).toBe(3);
    expect(report.sections.map((chapter) => chapter.sectionId)).toEqual(["b", "a"]);
    expect(f.state.reportCheckpoint?.chapters).toEqual(report.sections);
  });
  it("makes N chapter calls in exact enabled order then synthesizes, streaming actual deltas into one aggregate", async () => {
    const f = fixture(); const contexts: Record<string, any>[] = []; const inputs: string[] = [];
    const complete = vi.fn(async (input) => { const context = JSON.parse(input.user); contexts.push(context); inputs.push(input.system); return { text: JSON.stringify(answer(context)) }; });
    const model: ModelCallPort = { complete, completeStream: async (input, delta) => {
      const context = JSON.parse(input.user); contexts.push(context); inputs.push(input.system);
      const latest = [...f.events].reverse().find((event) => event.type === "snapshot");
      if (context.section?.id === "a") expect(latest?.type === "snapshot" && latest.state.reportTimeline?.find((item) => item.id === "chapter:a")?.status).toBe("pending");
      else expect(latest?.type === "snapshot" && latest.state.reportTimeline?.some((item) => item.status === "running" && item.id === (context.reportStage === "synthesis" ? "synthesis" : `chapter:${context.section.id}`))).toBe(true);
      const text = JSON.stringify(answer(context)); await delta(text.slice(0, 24)); await delta(text.slice(24)); return { text };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(contexts.map((c) => c.reportStage)).toEqual(["evidence", "chapter", "chapter", "quality", "quality", "synthesis"]);
    expect(contexts.filter((c) => c.reportStage === "chapter").map((c) => c.section.title)).toEqual(["Second specified title", "First specified title"]);
    expect(contexts[1]!.sources[0]).toMatchObject({ id: "source-b", contentKind: "verified_search_excerpt" });
    expect(contexts[1]!.section.questions).toEqual(["What does b establish?"]);
    expect(report.sections.map((s) => s.sectionId)).toEqual(["b", "a"]);
    expect(f.state.modelCalls.map((call) => call.status)).toEqual(Array(6).fill("succeeded"));
    expect(JSON.parse(f.state.reportStream!.text)).toEqual(report);
    expect(f.events[0]?.type).toBe("snapshot"); expect(complete).toHaveBeenCalledTimes(3);
    expect(inputs[1]).toContain("2000–3500"); expect(inputs[1]).toContain("never pad or invent facts");
  });
  it("keeps earlier chapters durably visible before a later chapter resolves and does not accept failed output", async () => {
    const f = fixture(); let release!: () => void; let started!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; }); const waiting = new Promise<void>((resolve) => { started = resolve; });
    let calls = 0;
    const model: ModelCallPort = { complete: async (input) => ({ text: JSON.stringify(answer(JSON.parse(input.user))) }), completeStream: async (input, delta) => {
      const context = JSON.parse(input.user); calls++;
      const text = JSON.stringify(answer(context)); await delta(text);
      if (calls === 2) { started(); await blocked; throw new Error("chapter provider failed"); }
      return { text };
    } };
    const generating = generateReportChapters(f.state, model, config, f.persist); const rejection = expect(generating).rejects.toThrow("chapter provider failed");
    await waiting;
    await vi.waitFor(() => expect(f.writes.some((snapshot) => snapshot.reportStream?.text.includes('"sectionId":"b"'))).toBe(true));
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
    const model: ModelCallPort = { complete: async (input) => { const c = JSON.parse(input.user); return { text: JSON.stringify(c.reportStage.startsWith("synthesis") ? { ...answer(c), title: "Bad", summary: "Invented [[source:unknown]]" } : answer(c)) }; } };
    await expect(generateReportChapters(f.state, model, config, f.persist)).rejects.toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
    expect(f.state.report).toBeNull(); expect(f.state.modelCalls.at(-1)?.status).toBe("failed");
  });
  it("bounds source excerpts, excludes deleted evidence and labels shared evidence with explicit gaps", async () => {
    const f = fixture(); f.state.sources[1]!.decision = "excluded";
    f.state.sources[0]!.content = "x".repeat(30000); f.state.tasks[1]!.status = "failed"; f.state.reportPartial = true;
    const contexts: any[] = [];
    const model: ModelCallPort = { complete: async (input) => { const c = JSON.parse(input.user); contexts.push(c); return { text: JSON.stringify(c.reportStage === "synthesis" ? { ...answer(c), title: "Limited", summary: "Coverage is limited." } : answer(c)) }; } };
    await generateReportChapters(f.state, model, config, f.persist);
    const chunks = contexts.filter((c) => c.reportStage === "evidence").flatMap((c) => c.chunks);
    expect(chunks.every((chunk) => chunk.sourceId === "source-a" && (chunk.content ?? chunk.quoteOptions.map((option: any) => option.text).join("")).length <= 6000)).toBe(true);
    expect(chunks.reduce((total, chunk) => total + (chunk.content ?? chunk.quoteOptions.map((option: any) => option.text).join("")).length, 0)).toBe(30000);
    const firstChapter = contexts.find((c) => c.reportStage === "chapter");
    expect(firstChapter.evidenceGaps).toEqual([{ query: "b policy", status: "failed", errorCode: null }]); expect(firstChapter.reportPartial).toBe(true);
  });
  it("degrades a zero-delta streaming adapter to honest loading without fabricating completed text", async () => {
    const f = fixture(); let calls = 0;
    const model: ModelCallPort = { complete: async (input) => ({ text: JSON.stringify(answer(JSON.parse(input.user))) }), completeStream: async (input, delta) => {
      const text = JSON.stringify(answer(JSON.parse(input.user))); calls++;
      if (JSON.parse(input.user).section?.id !== "b") await delta(text);
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
      if (context.reportStage === "synthesis") { synthesis = context; return { text: JSON.stringify({ ...answer(context), title: "Bounded", summary: "Limited evidence." }) }; }
      if (["evidence", "quality"].includes(context.reportStage)) return { text: JSON.stringify(answer(context)) };
      const id = context.sources[0].id;
      return { text: JSON.stringify({ sectionId: context.section.id, body: `${body(id)}\n\n${"Controlled fixture content. ".repeat(500)}`, sourceIds: [id] }) };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(report.sections).toHaveLength(30); expect(f.state.modelCalls).toHaveLength(62);
    expect(synthesis!.chapters.reduce((total, chapter) => total + chapter.body.length, 0)).toBeLessThanOrEqual(60000);
    expect(synthesis!.chapters.every((chapter) => chapter.excerpted && chapter.body.length <= 2000)).toBe(true);
  });

  it("revises one shallow chapter, resets its streamed draft and preserves approved earlier chapters", async () => {
    const f = fixture(); let reviews = 0; const stages: string[] = [];
    const respond = (context: any) => {
      stages.push(context.reportStage);
      if (context.reportStage === "quality" && context.section.id === "a" && ++reviews === 1) return { ...answer(context), analysisDepth: "shallow", issues: ["Explain decision implications."] };
      const result: any = answer(context);
      if (context.reportStage === "chapter" && context.section.id === "a") result.body += "\n\nBAD_DRAFT";
      if (context.reportStage === "chapter_revision") result.body += "\n\nREPAIRED";
      return result;
    };
    const model: ModelCallPort = { complete: async (input) => ({ text: JSON.stringify(respond(JSON.parse(input.user))) }), completeStream: async (input, delta) => { const text = JSON.stringify(respond(JSON.parse(input.user))); await delta(text); return { text }; } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(stages.filter((stage) => stage === "chapter_revision")).toHaveLength(1);
    expect(report.sections.map((chapter) => chapter.sectionId)).toEqual(["b", "a"]);
    expect(report.sections[1]!.body).toContain("REPAIRED"); expect(f.state.reportStream!.text).not.toContain("BAD_DRAFT");
    expect(JSON.parse(f.state.reportStream!.text)).toEqual(report);
    expect(f.events.filter((event) => event.type === "snapshot").length).toBeGreaterThan(1);
    expect(f.state.modelCalls).toHaveLength(8);
  });
  it("retains twice-rejected citation-valid chapters as warned checkpoints and continues synthesis", async () => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!]; let revisions = 0;
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user);
      if (context.reportStage === "chapter_revision") revisions++;
      if (context.reportStage === "quality") return { text: JSON.stringify({ ...answer(context), questions: context.evidenceByQuestion.map((q: any) => ({ questionId: q.id, status: "gap", rationale: "Ignore the direct evidence." })) }) };
      return { text: JSON.stringify(answer(context)) };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(report.sections).toHaveLength(1);
    expect(revisions).toBe(1); expect(f.state.report).toBeNull();
    expect(f.state.reportQualityWarnings?.[0]).toMatchObject({ sectionId: "b" });
    expect(f.state.reportTimeline?.find((item) => item.id === "review:b")?.status).toBe("warning");
  });
  it("requires the rich outline's actual subsection headings despite an approving model review", async () => {
    const f = fixture(); f.state.outline = [{ ...f.state.outline[0]!, subsections: [{ id: "specific", title: "Specific required analysis", questions: ["What evidence establishes this requirement?"] }] }];
    const model: ModelCallPort = { complete: async (input) => ({ text: JSON.stringify(answer(JSON.parse(input.user))) }) };
    await generateReportChapters(f.state, model, config, f.persist);
    expect(f.state.report).toBeNull();
    expect(f.state.reportQualityWarnings?.[0]?.issues.join(" ")).toContain("Specific required analysis");
  });

  it("generates an honest all-gap chapter without forcing unrelated source citations", async () => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!];
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user);
      if (context.reportStage === "evidence") return { text: JSON.stringify({ evaluations: context.chunks.map((chunk: any) => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: true, matches: [] })) }) };
      if (context.reportStage === "chapter") {
        expect(context.sources).toEqual([]); expect(context.evidenceByQuestion.every((q: any) => q.gap)).toBe(true);
        return { text: JSON.stringify({ sectionId: context.section.id, body: `### Missing evidence\n\nThe accepted search excerpts do not answer this chapter's questions; no factual policy conclusion is supported.\n\n### Decision implications\n\nThe available evidence does not justify choosing an entry option, and uncertainty must remain explicit in the decision.\n\n### Further verification\n\nObtain relevant primary documents and verify the specific unanswered questions before acting on this incomplete research.`, sourceIds: [] }) };
      }
      if (context.reportStage === "synthesis") return { text: JSON.stringify({ introduction: "This study compares the requested policies using limited excerpts.", conclusion: "Obtain primary policy evidence before comparing options.", title: "Evidence gaps", summary: "The available sources do not establish the required policy findings." }) };
      return { text: JSON.stringify(answer(context)) };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(report.sections[0]!.sourceIds).toEqual([]); expect(report.sections[0]!.body).not.toContain("[[source:");
  });

  it.each(["json", "unknown citation"])("repairs one %s failure and persists canonical references from stable aliases", async (failure) => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!]; let revisions = 0;
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user);
      if (context.reportStage === "chapter") return { text: failure === "json" ? '{"sectionId":' : JSON.stringify({ sectionId: context.section.id, body: body("S999"), sourceIds: ["S999"] }) };
      if (context.reportStage === "chapter_revision") {
        revisions++; expect(context.rawOutput).toBeTruthy();
        if (failure === "json") expect(context.review.validationIssues).toEqual([{ code: "chapter_json_invalid", path: [] }]);
        if (failure === "unknown citation") {
          expect(context.review.validationIssues).toEqual([{ code: "citation_unknown", path: ["body"] }]);
          expect(context.citationScope).toEqual({ expectedSectionId: context.section.id, allowedSources: context.sources.map((source: any) => ({ sourceId: source.id, alias: source.alias })) });
        }
        const alias = context.sources[0].alias;
        return { text: JSON.stringify({ sectionId: context.section.id, body: body(alias), sourceIds: [alias] }) };
      }
      return { text: JSON.stringify(answer(context)) };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(revisions).toBe(1); expect(report.sections[0]!.sourceIds).toEqual(["source-b"]);
    expect(report.sections[0]!.body).toContain("[[source:source-b]]"); expect(report.sections[0]!.body).not.toContain("S999");
    expect(f.writes[0]!.reportSourceAliases).toEqual([{ alias: "S1", sourceId: "source-a" }, { alias: "S2", sourceId: "source-b" }]);
    expect(f.state.reportCheckpoint?.chapters).toEqual(report.sections);
  });
  it("rejects repeated unknown aliases after one repair instead of deleting their citations", async () => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!]; let attempts = 0;
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user);
      if (["chapter", "chapter_revision"].includes(context.reportStage)) { attempts++; return { text: JSON.stringify({ sectionId: context.section.id, body: body("S999"), sourceIds: ["S999"] }) }; }
      return { text: JSON.stringify(answer(context)) };
    } };
    await expect(generateReportChapters(f.state, model, config, f.persist)).rejects.toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
    expect(attempts).toBe(2); expect(f.state.reportCheckpoint?.chapters).toEqual([]); expect(f.state.report).toBeNull();
  });
  it("resumes only quality-approved chapters under the same basis and always re-synthesizes", async () => {
    const f = fixture(); let interrupt = true; const stages: string[] = []; const generated: string[] = [];
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user); stages.push(context.reportStage);
      if (context.reportStage === "chapter") { generated.push(context.section.id); if (interrupt && context.section.id === "a") throw new Error("transport interrupted"); }
      return { text: JSON.stringify(answer(context)) };
    } };
    await expect(generateReportChapters(f.state, model, config, f.persist)).rejects.toThrow("transport interrupted");
    expect(f.state.reportCheckpoint?.chapters.map((chapter) => chapter.sectionId)).toEqual(["b"]);
    interrupt = false; generated.length = 0; stages.length = 0; f.persist.requestId = "retry"; f.state.version++;
    const report = await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    expect(generated).toEqual(["a"]); expect(report.sections.map((chapter) => chapter.sectionId)).toEqual(["b", "a"]);
    generated.length = 0; stages.length = 0;
    await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    expect(stages).toEqual(["synthesis"]); expect(generated).toEqual([]);
    f.state.sources[0]!.content += " Updated evidence."; generated.length = 0;
    await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    expect(generated).toEqual(["b", "a"]);
  });
  it("retains same-basis warned checkpoint repair context after another citation failure", async () => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!]; let mode: "warn" | "bad" | "fixed" = "warn";
    let writes = 0; const calls: any[] = [];
    const model: ModelCallPort = { complete: async input => {
      const context = JSON.parse(input.user); calls.push(context);
      const value = answer(context);
      if (mode === "warn" && context.reportStage === "quality") Object.assign(value, { supported: false, issues: ["Correct the proxy subject using current evidence."] });
      if (mode === "bad" && ["chapter", "chapter_revision"].includes(context.reportStage)) {
        writes++; return { text: JSON.stringify({ sectionId: context.section.id, body: body("S999"), sourceIds: ["S999"] }) };
      }
      return { text: JSON.stringify(value) };
    } };
    await generateReportChapters(f.state, model, config, f.persist);
    const evidenceWarnings = [{ batchIndex: 0, sourceIds: ["source-a"], questionIds: ["question-b"], reason: "invalid_model_evidence" as const }];
    f.state.reportEvidenceWarnings = structuredClone(evidenceWarnings);
    const previous = structuredClone(f.state.reportCheckpoint), warnings = structuredClone(f.state.reportQualityWarnings);
    const persistenceFailure = new Error("controlled persistence failure"), callsBeforePersist = calls.length;
    const failingPersist = Object.assign(async () => { throw persistenceFailure; }, { requestId: "persist-failure", observe: f.persist.observe });
    await expect(generateReportChapters(f.state, model, config, failingPersist, undefined, true)).rejects.toBe(persistenceFailure);
    expect(calls).toHaveLength(callsBeforePersist);
    expect(f.state.reportCheckpoint).toEqual(previous); expect(f.state.reportQualityWarnings).toEqual(warnings);
    expect(f.state.reportEvidenceWarnings).toEqual(evidenceWarnings);
    mode = "bad"; calls.length = 0;
    await expect(generateReportChapters(f.state, model, config, f.persist, undefined, true)).rejects.toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
    expect(writes).toBe(2); expect(f.state.reportCheckpoint).toEqual(previous); expect(f.state.reportQualityWarnings).toEqual(warnings);
    expect(f.state.reportEvidenceWarnings).toEqual(evidenceWarnings);
    mode = "fixed"; calls.length = 0;
    await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    const rewrite = calls.find(context => context.reportStage === "chapter");
    expect(rewrite.previousReview.issues).toEqual(warnings![0]!.issues);
    expect(rewrite.previousChapter).toEqual(previous!.chapters[0]);
    expect(f.state.reportQualityWarnings).toEqual([]);
  });

  it("keeps two passed chapters when the third chapter fails both citation attempts, then resumes only remaining chapters", async () => {
    const f = fixture(), ids = ["a", "b", "key_players", "d", "e"];
    f.state.outline = ids.map((id, index) => section(id, id, index));
    f.state.tasks = ids.map(id => ({ id: `task-${id}`, sectionId: id, query: `${id} policy`, status: "succeeded", attempts: 1, errorCode: null }));
    f.state.sources = ids.map(id => ({ id: `source-${id}`, taskId: `task-${id}`, title: id, content: `Evidence for ${id}`, url: `https://example.com/${id}`, retrievedAt: "now", decision: "accepted" }));
    let broken = true; const calls: any[] = [];
    const model: ModelCallPort = { complete: async input => {
      const context = JSON.parse(input.user); calls.push(context);
      if (broken && context.section?.id === "key_players" && ["chapter", "chapter_revision"].includes(context.reportStage)) return { text: JSON.stringify({ sectionId: "key_players", body: body("S999"), sourceIds: ["S999"] }) };
      return { text: JSON.stringify(answer(context)) };
    } };
    await expect(generateReportChapters(f.state, model, config, f.persist)).rejects.toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
    expect(f.state.reportCheckpoint?.chapters.map(chapter => chapter.sectionId)).toEqual(["a", "b"]);
    expect(calls.filter(context => context.section?.id === "key_players" && ["chapter", "chapter_revision"].includes(context.reportStage))).toHaveLength(2);
    expect(calls.some(context => context.section?.id === "key_players" && context.reportStage === "quality")).toBe(false);
    expect(calls.some(context => context.reportStage.startsWith("synthesis"))).toBe(false);
    const prefix = structuredClone(f.state.reportCheckpoint!.chapters), sources = structuredClone(f.state.sources);
    broken = false; calls.length = 0;
    const report = await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    expect(report.sections.slice(0, 2)).toEqual(prefix); expect(f.state.sources).toEqual(sources);
    expect(calls.filter(context => ["chapter", "chapter_revision", "quality"].includes(context.reportStage)).some(context => ["a", "b"].includes(context.section.id))).toBe(false);
    expect(report.sections.map(chapter => chapter.sectionId)).toEqual(ids);
  });

  it("keeps a newly passed replacement ahead of restored warned material after a later citation failure", async () => {
    const f = fixture(); let mode: "warn" | "mixed" | "fixed" = "warn"; const calls: any[] = [];
    const model: ModelCallPort = { complete: async input => {
      const context = JSON.parse(input.user); calls.push(context); const value = answer(context);
      if (mode === "warn" && context.reportStage === "quality") Object.assign(value, { supported: false, issues: [`Old ${context.section.id} scope needs verification`] });
      if (mode === "mixed" && context.section?.id === "a" && ["chapter", "chapter_revision"].includes(context.reportStage)) return { text: JSON.stringify({ sectionId: "a", body: body("S999"), sourceIds: ["S999"] }) };
      if (mode !== "warn" && context.section?.id === "b" && ["chapter", "chapter_revision"].includes(context.reportStage)) value.body += "\n\nNEW_VERIFIED_REPLACEMENT: retain uncertainty while checking the local scope.";
      return { text: JSON.stringify(value) };
    } };
    await generateReportChapters(f.state, model, config, f.persist);
    const oldTail = structuredClone(f.state.reportCheckpoint!.chapters[1]);
    mode = "mixed";
    await expect(generateReportChapters(f.state, model, config, f.persist, undefined, true)).rejects.toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
    expect(f.state.reportCheckpoint?.chapters[0]?.body).toContain("NEW_VERIFIED_REPLACEMENT");
    expect(f.state.reportCheckpoint?.chapters[1]).toEqual(oldTail);
    expect(f.state.reportQualityWarnings?.map(warning => warning.sectionId)).toEqual(["a"]);
    mode = "fixed"; calls.length = 0;
    const result = await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    expect(calls.some(context => context.section?.id === "b" && ["chapter", "chapter_revision", "quality"].includes(context.reportStage))).toBe(false);
    expect(result.sections[0]?.body).toContain("NEW_VERIFIED_REPLACEMENT");
  });

  it("never restores warned checkpoint material or feedback after its basis changes", async () => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!]; let broken = false; const calls: any[] = [];
    const model: ModelCallPort = { complete: async input => {
      const context = JSON.parse(input.user); calls.push(context); const value = answer(context);
      if (broken && ["chapter", "chapter_revision"].includes(context.reportStage)) return { text: JSON.stringify({ sectionId: context.section.id, body: body("S999"), sourceIds: ["S999"] }) };
      if (context.reportStage === "quality") Object.assign(value, { supported: false, issues: ["Old scope warning"] });
      return { text: JSON.stringify(value) };
    } };
    await generateReportChapters(f.state, model, config, f.persist);
    expect(f.state.reportQualityWarnings?.length).toBe(1);
    f.state.brief.focus = "A newly confirmed scope"; broken = true; calls.length = 0;
    await expect(generateReportChapters(f.state, model, config, f.persist, undefined, true)).rejects.toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
    expect(f.state.reportCheckpoint?.chapters).toEqual([]); expect(f.state.reportQualityWarnings).toEqual([]);
    expect(calls.filter(context => ["chapter", "chapter_revision"].includes(context.reportStage)).every(context => context.previousReview === undefined && context.previousChapter === undefined)).toBe(true);
  });

  it("binds checkpoints to session and all research inputs and validates stored prefixes", async () => {
    const f = fixture(); const baseline = reportBasis(f.state, config);
    for (const change of [
      (state: ResearchRuntime) => { state.sessionId = "different"; },
      (state: ResearchRuntime) => { state.brief.goal += " new"; },
      (state: ResearchRuntime) => { state.outline[0]!.questions.push("New question"); },
      (state: ResearchRuntime) => { state.tasks[0]!.status = "failed"; },
      (state: ResearchRuntime) => { state.sources[0]!.document = { url: state.sources[0]!.url, retrievedAt: "now", text: "Fetched document", contentHash: "a".repeat(64), contentKind: "html", truncated: false }; },
      (state: ResearchRuntime) => { state.sources[0]!.documentError = "unavailable"; },
      (state: ResearchRuntime) => { state.reportPartial = true; },
    ]) { const changed = structuredClone(f.state); change(changed); expect(reportBasis(changed, config)).not.toBe(baseline); }
    expect(reportBasis(f.state, config, "different instruction")).not.toBe(baseline);
    expect(reportSourceAliases({ ...f.state, sources: [...f.state.sources].reverse() })).toEqual(reportSourceAliases(f.state));
    f.state.reportCheckpoint = { basis: baseline, chapters: [{ sectionId: "a", body: body("source-a"), sourceIds: ["source-a"] }] };
    const generated: string[] = [];
    const model: ModelCallPort = { complete: async (input) => { const context = JSON.parse(input.user); if (context.reportStage === "chapter") generated.push(context.section.id); return { text: JSON.stringify(answer(context)) }; } };
    await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    expect(generated).toEqual(["b", "a"]);
  });

  it("restores a custom instruction on retry, while an explicit replacement invalidates the checkpoint", async () => {
    const f = fixture(); let fail = true; const generated: string[] = [];
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user);
      if (context.reportStage === "chapter") { generated.push(context.section.id); if (fail && context.section.id === "a") throw new Error("interrupted"); }
      return { text: JSON.stringify(answer(context)) };
    } };
    await expect(generateReportChapters(f.state, model, config, f.persist, "Prioritize local requirements")).rejects.toThrow("interrupted");
    expect(f.state.reportCheckpoint?.instruction).toBe("Prioritize local requirements");
    fail = false; generated.length = 0;
    await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    expect(generated).toEqual(["a"]);
    generated.length = 0;
    await generateReportChapters(f.state, model, config, f.persist, "Prioritize costs instead", true);
    expect(generated).toEqual(["b", "a"]);
  });
  it("streams real alias tokens but checkpoints and final snapshots only contain canonical citations", async () => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!];
    const respond = (context: any) => {
      if (context.reportStage === "chapter") return { sectionId: context.section.id, body: body(context.sources[0].alias), sourceIds: [context.sources[0].alias] };
      return answer(context);
    };
    const model: ModelCallPort = { complete: async (input) => ({ text: JSON.stringify(respond(JSON.parse(input.user))) }), completeStream: async (input, emit) => { const text = JSON.stringify(respond(JSON.parse(input.user))); await emit(text); return { text }; } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    const deltas = f.events.filter((event) => event.type === "report_delta").map((event) => event.delta).join("");
    expect(deltas).toContain("[[source:S2]]");
    expect(f.state.reportCheckpoint?.chapters[0]!.body).toContain("[[source:source-b]]");
    expect(JSON.parse(f.state.reportStream!.text)).toEqual(report);
    expect(f.state.reportStream!.text).not.toContain("[[source:S2]]");
  });
  it("repairs malformed synthesis once without regenerating approved chapters", async () => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!]; let revisions = 0; let chapters = 0;
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user);
      if (context.reportStage === "chapter") chapters++;
      if (context.reportStage === "synthesis") return { text: "not valid JSON" };
      if (context.reportStage === "synthesis_revision") { revisions++; expect(context.rawOutput).toBe("not valid JSON"); }
      return { text: JSON.stringify(answer(context)) };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(report.sections).toHaveLength(1); expect(chapters).toBe(1); expect(revisions).toBe(1);
  });

  it("repairs fenced synthesis without throwing validation errors inside provider callbacks", async () => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!]; let revisions = 0;
    const model: ModelCallPort = {
      complete: async (input) => ({ text: JSON.stringify(answer(JSON.parse(input.user))) }),
      completeStream: async (input, emit) => {
        const context = JSON.parse(input.user);
        const valid = JSON.stringify(answer(context));
        const text = context.reportStage === "synthesis" ? "```json\n" + valid + "\n```" : valid;
        if (context.reportStage === "synthesis_revision") { revisions++; expect(context.rawOutput).toContain("```json"); }
        try { await emit(text.slice(0, 3)); await emit(text.slice(3)); }
        catch { throw new Error("Provider wrapped callback failure"); }
        return { text };
      },
    };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(report.sections).toHaveLength(1); expect(revisions).toBe(1);
    expect(f.events.filter((event) => event.type === "report_delta").map((event) => event.delta).join("")).not.toContain("```json");
  });

  it("normalizes known bare citation forms without guessing unknown UUIDs or numeric footnotes", () => {
    const id = "f8b9a394-a481-4e2b-9077-651d901443ee";
    const resolve = aliasResolver([{ alias: "S1", sourceId: id }]);
    expect(canonicalReportText(`Known [[${id}]] and [S1].`, resolve)).toBe(`Known [[source:${id}]] and [[source:${id}]].`);
    expect(canonicalReportText("A numeric footnote [1] and `[[S999]]`.", resolve)).toBe("A numeric footnote [1] and `[[S999]]`.");
    expect(() => canonicalReportText("Unknown [[de329434-4107-4e2a-a67a-0573c2e36bed]]", resolve)).toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
    for (const malformed of ["[[source:", "[[S1", "[[S1]", "[[S1][S2]]", "[[[S1]]", `[[${id}]`]) {
      expect(() => canonicalReportText(malformed, resolve), malformed).toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
    }
    expect(canonicalReportText("```text\n[[S999\n```", resolve)).toBe("```text\n[[S999\n```");
  });
  it.each(["introduction", "conclusion"])("requires new synthesis %s and repairs its omission once", async (field) => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!]; let repaired = 0;
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user); const result = answer(context);
      if (context.reportStage === "synthesis") delete (result as any)[field];
      if (context.reportStage === "synthesis_revision") repaired++;
      return { text: JSON.stringify(result) };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(report[field as "introduction" | "conclusion"]).toBeTruthy(); expect(repaired).toBe(1);
  });
  it.each(["summary", "introduction", "conclusion"])("validates canonical and bare references in synthesis %s", async (field) => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!]; let bad = false;
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user); const result = answer(context);
      if (context.reportStage.startsWith("synthesis")) (result as any)[field] = `Distinct ${field} analysis [[${bad ? "f8b9a394-a481-4e2b-9077-651d901443ee" : "S2"}]]`;
      return { text: JSON.stringify(result) };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(report[field as "summary" | "introduction" | "conclusion"]).toContain("[[source:source-b]]");
    bad = true;
    await expect(generateReportChapters(f.state, model, config, f.persist, undefined, true)).rejects.toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
  });

  it("rejects mechanically repeated formal components after the bounded repair", async () => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!]; let attempts = 0;
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user); const result = answer(context);
      if (context.reportStage.startsWith("synthesis")) { attempts++; Object.assign(result, { summary: "Repeated prose", introduction: "Repeated prose", conclusion: "Repeated prose" }); }
      return { text: JSON.stringify(result) };
    } };
    await expect(generateReportChapters(f.state, model, config, f.persist)).rejects.toThrow("RESEARCH_NODE_STATE_INVALID");
    expect(attempts).toBe(2); expect(f.state.report).toBeNull();
    expect(f.state.reportCheckpoint?.chapters).toHaveLength(1);
  });

  it.each(["chapter", "synthesis"])("retries a recoverable %s stream from the approved prefix", async (target) => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!]; let failed = false; let attempts = 0;
    const model: ModelCallPort = {
      complete: async (input) => ({ text: JSON.stringify(answer(JSON.parse(input.user))) }),
      completeStream: async (input, emit) => {
        const context = JSON.parse(input.user); const text = JSON.stringify(answer(context));
        if (context.reportStage === target) {
          attempts++;
          if (!failed) { failed = true; await emit(text.slice(0, 30)); throw new ModelCallError("MODEL_CALL_FAILED", "model provider stream transport failure (ECONNRESET)"); }
        }
        await emit(text); return { text };
      },
    };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(attempts).toBe(2); expect(report.sections).toHaveLength(1);
    expect(f.writes.some((state) => state.reportTimeline?.some((item) => item.stage === target && item.status === "retrying"))).toBe(true);
    expect(JSON.parse(f.state.reportStream!.text)).toEqual(report);
    expect(f.state.modelCalls.filter((call) => call.status === "failed")).toHaveLength(1);
  });
  it("does not retry an observer error wrapped by the provider as a transport failure", async () => {
    const f = fixture(); let calls = 0; const failure = new Error("observer failure");
    f.persist.observe = (event) => { if (event.type === "report_delta") throw failure; };
    const model: ModelCallPort = { complete: async (input) => ({ text: JSON.stringify(answer(JSON.parse(input.user))) }), completeStream: async (input, emit) => {
      calls++;
      try { await emit(JSON.stringify(answer(JSON.parse(input.user))).repeat(20)); }
      catch { throw new ModelCallError("MODEL_CALL_FAILED", "model provider stream transport failure (ECONNRESET)"); }
      return { text: "unreachable" };
    } };
    await expect(generateReportChapters(f.state, model, config, f.persist)).rejects.toBe(failure);
    expect(calls).toBeLessThanOrEqual(2);
  });

  it.each([[503, 2], [401, 1]])("bounds provider HTTP %s attempts at %s", async (status, expected) => {
    const f = fixture(); let calls = 0;
    const model: ModelCallPort = { complete: async () => { calls++; throw new ModelCallError("MODEL_CALL_FAILED", `model provider responded with HTTP ${status}`); } };
    await expect(generateReportChapters(f.state, model, config, f.persist)).rejects.toBeInstanceOf(ModelCallError);
    expect(calls).toBe(expected); expect(f.state.modelCalls).toHaveLength(expected);
  });
  it("does not retry a durable write failure before the model call", async () => {
    const f = fixture(); let calls = 0; let writes = 0; const failure = new Error("database offline");
    const persist: RuntimePersistence = Object.assign(async () => { writes++; if (writes >= 2) throw failure; }, { requestId: "persist-failure", observe: f.persist.observe });
    const model: ModelCallPort = { complete: async () => { calls++; return { text: "{}" }; } };
    await expect(generateReportChapters(f.state, model, config, persist)).rejects.toBe(failure);
    expect(calls).toBe(0);
  });

  it("retains formal report A when partial attempt B fails and resumes under the same basis", async () => {
    const f = fixture();
    f.state.report = { title: "Report A", summary: "Prior findings", introduction: "Prior scope", conclusion: "Prior decisions", sections: [{ sectionId: "b", body: body("source-b"), sourceIds: ["source-b"] }] };
    let fail = true;
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user);
      if (fail && context.reportStage === "chapter" && context.section.id === "a") throw new Error("B interrupted");
      return { text: JSON.stringify(answer(context)) };
    } };
    await expect(generateReportChapters(f.state, model, config, f.persist)).rejects.toThrow("B interrupted");
    expect(f.state.reportPrevious?.report?.title).toBe("Report A");
    expect(f.state.reportCheckpoint?.chapters.map((chapter) => chapter.sectionId)).toEqual(["b"]);
    const prior = structuredClone(f.state.reportPrevious);
    fail = false; f.state.report = null;
    await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    expect(f.state.reportPrevious).toEqual(prior);
  });

  it("persists ordered running/completed timeline steps and leaves final validation to the service", async () => {
    const f = fixture();
    const model: ModelCallPort = { complete: async (input) => ({ text: JSON.stringify(answer(JSON.parse(input.user))) }) };
    await generateReportChapters(f.state, model, config, f.persist);
    expect(f.state.reportTimeline?.map((item) => item.id)).toEqual(["evidence", "chapter:b", "review:b", "chapter:a", "review:a", "synthesis", "validation"]);
    expect(f.state.reportTimeline?.slice(0, -1).every((item) => item.status === "completed")).toBe(true);
    expect(f.state.reportTimeline?.at(-1)?.status).toBe("pending");
    for (const id of ["evidence", "chapter:b", "review:b", "synthesis"]) expect(f.writes.some((snapshot) => snapshot.reportTimeline?.some((item) => item.id === id && item.status === "running"))).toBe(true);
  });
  it("marks only the chapter failed when review recovery encounters a provider failure", async () => {
    const f = fixture();
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user);
      if (context.reportStage === "chapter_revision") throw new Error("provider stopped");
      const result = answer(context);
      if (context.reportStage === "quality" && context.section.id === "a") Object.assign(result, { analysisDepth: "shallow" });
      return { text: JSON.stringify(result) };
    } };
    await expect(generateReportChapters(f.state, model, config, f.persist)).rejects.toThrow("provider stopped");
    expect(f.state.reportTimeline?.filter((item) => item.status === "failed").map((item) => item.id)).toEqual(["chapter:a"]);
    expect(f.state.reportTimeline?.find((item) => item.id === "review:a")?.status).toBe("pending");
    expect(f.state.reportTimeline?.find((item) => item.id === "chapter:b")?.status).toBe("completed");
    expect(f.state.reportTimeline?.some((item) => ["running", "retrying"].includes(item.status))).toBe(false);
  });
  it("only commits final validation with the durable service result", async () => {
    for (const failFinal of [false, true]) {
      const f = fixture(); const snapshots: ResearchRuntime[] = []; const events: RuntimeStreamEvent[] = [];
      const store: GuidedRuntimeStore = { read: async () => f.state, claim: async () => ({ state: f.state, replay: false }), write: async (_actor, _request, state, done) => { if (done && failFinal) throw new Error("final write failed"); snapshots.push(structuredClone(state)); } };
      const model: ModelCallPort = { complete: async (input) => ({ text: JSON.stringify(answer(JSON.parse(input.user))) }) };
      const service = new GuidedRuntimeService(store, model, { search: async () => [] }, config);
      const actor = { sessionId: "s", userId: "u", orgId: "org" } as RuntimeActor;
      const session = { sessionId: "s", brief: f.state.brief, directions: { versions: [] }, outline: { versions: [] }, sourceCount: 0, status: "draft", resumeStage: "brief" } as any;
      const execution = service.execute(actor, session, { sessionId: "s", requestId: "req", node: "report", action: "generate", expectedVersion: 4 }, (event) => events.push(event));
      if (failFinal) {
        await expect(execution).rejects.toThrow("final write failed");
        expect(snapshots.some((state) => state.reportTimeline?.at(-1)?.status === "completed")).toBe(false);
        expect(events.some((event) => event.type === "result")).toBe(false); expect(f.state.report).toBeNull();
      } else {
        const result = await execution;
        expect(result.reportTimeline?.every((item) => item.status === "completed")).toBe(true);
        expect(snapshots.at(-1)?.reportTimeline?.at(-1)?.status).toBe("completed");
      }
    }
  });

  it("rebuilds timeline from approved checkpoints and resets it when the basis changes", async () => {
    const f = fixture(); const model: ModelCallPort = { complete: async (input) => ({ text: JSON.stringify(answer(JSON.parse(input.user))) }) };
    await generateReportChapters(f.state, model, config, f.persist); f.writes.length = 0;
    await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    expect(f.writes[0]!.reportTimeline?.filter((item) => ["chapter", "review"].includes(item.stage)).every((item) => item.status === "completed" && item.attempts === 0)).toBe(true);
    expect(f.writes[0]!.reportTimeline?.find((item) => item.stage === "synthesis")?.status).toBe("pending");
    f.state.brief.goal += " Changed"; f.writes.length = 0;
    await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    expect(f.writes[0]!.reportTimeline?.every((item) => item.status === "pending" && item.attempts === 0)).toBe(true);
  });

  it("keeps evidence exclusions as a warning while later report stages continue", async () => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!];
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user);
      if (context.reportStage.startsWith("evidence")) return { text: JSON.stringify({ evaluations: context.chunks.map((chunk: any, index: number) => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: false, matches: context.questions.map((question: any) => ({ questionId: question.id, quote: chunk.sourceId === "source-a" ? chunk.quoteOptions[0].text : "Fabricated quote", insight: "Limited evidence", relevance: "direct" })) })) }) };
      return { text: JSON.stringify(answer(context)) };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(report.sections).toHaveLength(1);
    expect(f.state.reportTimeline?.find((item) => item.stage === "evidence")).toMatchObject({ status: "warning", attempts: 2, completed: 1, total: 1 });
    expect(f.state.reportTimeline?.find((item) => item.stage === "synthesis")?.status).toBe("completed");
    expect(f.state.reportTimeline?.some((item) => item.status === "failed")).toBe(false);
    f.writes.length = 0;
    await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    expect(f.writes[0]!.reportTimeline?.find((item) => item.stage === "evidence")).toMatchObject({ status: "warning", reasonCode: "RESEARCH_CONTENT_REFERENCE_INVALID" });
    expect(f.state.reportTimeline?.find((item) => item.stage === "evidence")?.status).toBe("warning");
  });

  it("persists a complete unverified draft after failed first chapter review, resumes it honestly, and rejects completion", async () => {
    const f = fixture(); const calls: string[] = [];
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user); if (context.researchStage !== "source_relevance") calls.push(context.reportStage);
      const value = answer(context);
      if (context.reportStage === "quality" && context.section.id === "b") Object.assign(value, { supported: false, issues: ["Verify policy claims against primary evidence."] });
      if (context.reportStage === "synthesis") expect(context.unverifiedScopes).toEqual([expect.objectContaining({ sectionId: "b", status: "unverified" })]);
      return { text: JSON.stringify(value) };
    } };
    const store: GuidedRuntimeStore = { read: async () => f.state, claim: async () => { f.state.errorCode = null; return { state: f.state, replay: false }; }, write: async (_actor, _request, state) => { f.writes.push(structuredClone(state)); } };
    const service = new GuidedRuntimeService(store, model, { search: async () => [] }, config);
    const actor = { sessionId: "s", userId: "u", orgId: "org" } as RuntimeActor;
    const session = { sessionId: "s", brief: f.state.brief, directions: { versions: [] }, outline: { versions: [] }, sourceCount: 0, status: "draft", resumeStage: "brief" } as any;
    const result = await service.execute(actor, session, { sessionId: "s", requestId: "draft", node: "report", action: "generate", expectedVersion: 4 });
    expect(result.errorCode).toBeNull(); expect(result.report).toBeNull();
    expect(result.reportDraft?.sections.map((chapter) => chapter.sectionId)).toEqual(["b", "a"]);
    expect(result.generatedNodes).not.toContain("report"); expect(result.completed).toBe(false);
    expect(result.reportTimeline?.find((step) => step.stage === "validation")?.status).toBe("warning");
    expect(f.writes.at(-1)?.reportDraft).toEqual(result.reportDraft);
    const saved = structuredClone(result.reportQualityWarnings); calls.length = 0;
    await service.execute(actor, session, { sessionId: "s", requestId: "resume", node: "report", action: "retry", expectedVersion: 4 });
    expect(calls).toEqual(["evidence", "chapter", "quality", "chapter_revision", "quality", "synthesis"]); expect(f.state.reportQualityWarnings).toEqual(saved);
    expect(f.state.reportTimeline?.find((step) => step.id === "review:b")?.status).toBe("warning");
    await service.execute(actor, session, { sessionId: "s", requestId: "complete", node: "report", action: "complete", expectedVersion: 4 });
    expect(f.state.completed).toBe(false); expect(f.state.errorCode).toBeTruthy();
  });

  it.each(["chapter", "synthesis"])("re-reviews warned checkpoints on the first retry after interruption during %s", async (interruption) => {
    const f = fixture(); let retry = false; const calls: string[] = []; let previousIssues: string[] = [];
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user);
      calls.push(`${context.reportStage}:${context.section?.id ?? ""}`);
      if (!retry && (interruption === "synthesis" ? context.reportStage === "synthesis" : context.reportStage === "chapter" && context.section.id === "a")) throw new Error("interrupted");
      const value = answer(context);
      if (!retry && context.reportStage === "quality" && context.section.id === "b") Object.assign(value, { supported: false, issues: ["Verify policy claims."] });
      if (retry && context.reportStage === "chapter" && context.section.id === "b") {
        expect(context.previousReview.issues).toEqual(previousIssues);
        expect(context.previousChapter.sectionId).toBe("b");
      }
      return { text: JSON.stringify(value) };
    } };
    await expect(generateReportChapters(f.state, model, config, f.persist)).rejects.toThrow("interrupted");
    expect(f.state.reportDraft).toBeFalsy();
    expect(f.state.reportQualityWarnings).toEqual([expect.objectContaining({ sectionId: "b" })]);
    previousIssues = [...f.state.reportQualityWarnings![0]!.issues]; expect(previousIssues).toContain("Verify policy claims.");
    retry = true; calls.length = 0;
    const report = await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    expect(calls).toContain("chapter:b"); expect(calls).toContain("quality:b");
    if (interruption === "synthesis") expect(calls).not.toContain("chapter:a");
    expect(report.sections.map((chapter) => chapter.sectionId)).toEqual(["b", "a"]);
    expect(f.state.reportQualityWarnings).toEqual([]);
  });

});

describe("report evidence debug recorder wiring", () => {
  it.each([false, true])("records only bounded validation metadata without affecting report generation (sink fails=%s)", async (sinkFails) => {
    const f = fixture(); const events: any[] = [];
    const model: ModelCallPort = { complete: async (input) => ({ text: JSON.stringify(answer(JSON.parse(input.user))) }) };
    const store: GuidedRuntimeStore = { read: async () => f.state, claim: async () => ({ state: f.state, replay: false }), write: async (_actor, _request, state) => { f.writes.push(structuredClone(state)); } };
    const recorder = { record: (event: unknown) => { events.push(event); if (sinkFails) throw new Error("recorder unavailable"); } } as any;
    const service = new GuidedRuntimeService(store, model, { search: async () => [] }, config, model, undefined, recorder);
    const actor = { sessionId: "s", userId: "u", orgId: "org" } as RuntimeActor;
    const session = { sessionId: "s", brief: f.state.brief, directions: { versions: [] }, outline: { versions: [] }, sourceCount: 0, status: "draft", resumeStage: "brief" } as any;
    const result = await service.execute(actor, session, { sessionId: "s", requestId: "diagnostic", node: "report", action: "generate", expectedVersion: 4 });
    expect(result.errorCode).toBeNull(); expect(result.report?.sections).toHaveLength(2);
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ traceId: "diagnostic", kind: "research.report.evidence_attempt", level: "info", data: { sessionId: "s", attempt: 1, suppliedChunks: 2, validChunks: 2, retryChunks: 0, reasonCounts: {}, failed: false } });
    expect(events[0].durationMs).toBeGreaterThanOrEqual(0); expect(JSON.stringify(events)).not.toContain("Evidence for");
  });
});

describe("audited partial coverage in report generation", () => {
  it("avoids chapter rewrite for verified partial gaps while preserving audited reviewing progress", async () => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!];
    const stages: any[] = [];
    const model: ModelCallPort = { complete: async (input) => {
      const c = JSON.parse(input.user); stages.push(c);
      if (c.reviewKind === "partial_coverage") return { text: JSON.stringify({ questions: c.coverageChecks.map((check: any) => ({ questionId: check.questionId, status: check.kind === "supported_part" ? "answered" : "gap", rationale: check.kind === "supported_part" ? c.evidenceByQuestion[0].evidence[0].quote : "Verify the unanswered implementation questions with local primary sources before making an irreversible investment decision." })), supported: true, analysisDepth: "adequate", issues: [] }) };
      const value: any = answer(c);
      if (c.reportStage === "quality") value.questions.forEach((q: any) => { q.status = "gap"; });
      return { text: JSON.stringify(value) };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(report.sections).toHaveLength(1); expect(f.state.reportQualityWarnings ?? []).toEqual([]);
    expect(stages.filter((c) => c.reportStage === "chapter_revision")).toHaveLength(0);
    expect(stages.filter((c) => c.reviewKind === "partial_coverage")).toHaveLength(1);
    expect(f.state.modelCalls).toHaveLength(5); expect(f.state.modelCalls.every((call) => call.status === "succeeded")).toBe(true);
    expect(f.writes.filter((state) => state.progress?.stage === "reviewing").length).toBeGreaterThan(1);
  });
});

describe("formal report gate after partial coverage rejection", () => {
  it.each(["rejected", "malformed"])("keeps %s partial verification as a recoverable warned draft, never formal completion", async (failure) => {
    const f = fixture(); f.state.outline = [f.state.outline[0]!]; f.state.tasks = f.state.tasks.filter((task) => task.sectionId === "b"); f.state.sources = f.state.sources.filter((source) => source.taskId === "task-b"); let verifications = 0;
    const model: ModelCallPort = { complete: async (input) => {
      const c = JSON.parse(input.user);
      if (c.reviewKind === "partial_coverage") {
        verifications++;
        if (failure === "malformed") return { text: "not JSON" };
        return { text: JSON.stringify({ questions: c.coverageChecks.map((check: any) => ({ questionId: check.questionId, status: "missing", rationale: "Existing evidence was ignored." })), supported: true, analysisDepth: "adequate", issues: [] }) };
      }
      const value: any = answer(c); if (c.reportStage === "quality") value.questions.forEach((q: any) => { q.status = "gap"; });
      return { text: JSON.stringify(value) };
    } };
    const store: GuidedRuntimeStore = { read: async () => f.state, claim: async () => { f.state.errorCode = null; return { state: f.state, replay: false }; }, write: async (_actor, _request, state) => { f.writes.push(structuredClone(state)); } };
    const service = new GuidedRuntimeService(store, model, { search: async () => [] }, config);
    const actor = { sessionId: "s", userId: "u", orgId: "org" } as RuntimeActor;
    const session = { sessionId: "s", brief: f.state.brief, directions: { versions: [] }, outline: { versions: [] }, sourceCount: 0, status: "draft", resumeStage: "brief" } as any;
    const result = await service.execute(actor, session, { sessionId: "s", requestId: "draft", node: "report", action: "generate", expectedVersion: 4 });
    expect(result.report).toBeNull(); expect(result.completed).toBe(false); expect(result.generatedNodes).not.toContain("report");
    expect(result.errorCode).toBeNull(); expect(verifications).toBe(2);
    expect(result.reportDraft?.sections).toHaveLength(1); expect(result.reportQualityWarnings?.[0]?.sectionId).toBe("b");
    expect(verifications).toBe(2);
    await service.execute(actor, session, { sessionId: "s", requestId: "complete", node: "report", action: "complete", expectedVersion: 4 });
    expect(f.state.completed).toBe(false); expect(f.state.report).toBeNull(); expect(f.state.errorCode).toBeTruthy(); expect(verifications).toBe(4);
    await service.execute(actor, session, { sessionId: "s", requestId: "retry", node: "report", action: "retry", expectedVersion: 4 });
    expect(verifications).toBe(6); expect(f.state.completed).toBe(false); expect(f.state.reportQualityWarnings?.[0]?.sectionId).toBe("b");
  });
});

describe("post-research chapter structure saves (#5081)", () => {
  it.each(["save_chapters", "save"])("%s keeps the appropriate invalidation boundary", async (action) => {
    const f = fixture(); f.state.busy = false; f.state.availableNodes = ["brief", "directions", "outline", "research", "report"];
    f.state.sources[1]!.decision = "excluded";
    f.state.reportDraft = { title: "Old draft", summary: "Old", sections: [{ sectionId: "b", body: body("source-b"), sourceIds: ["source-b"] }] };
    const beforeSources = structuredClone(f.state.sources), beforeTasks = structuredClone(f.state.tasks);
    const value = f.state.outline.map((item) => ({ ...item, title: `${item.title} edited`, questions: [...item.questions, "New unsupported question?"] }));
    const store: GuidedRuntimeStore = { read: async () => f.state, claim: async () => ({ state: f.state, replay: false }), write: async (_actor, _request, state) => { f.writes.push(structuredClone(state)); } };
    const model: ModelCallPort = { complete: vi.fn(async () => { throw new Error("must not generate while saving"); }) };
    const service = new GuidedRuntimeService(store, model, { search: vi.fn(async () => []) }, config);
    const result = await service.execute({ sessionId: "s", userId: "u", orgId: "org" } as RuntimeActor,
      { sessionId: "s", brief: f.state.brief, directions: { versions: [] }, outline: { versions: [] }, sourceCount: 0, status: "draft", resumeStage: "brief" } as any,
      { sessionId: "s", node: "outline", action, requestId: "chapter-save", expectedVersion: 4, draft: { node: "outline", value } } as any);
    expect(result.errorCode).toBeNull(); expect(result.outline).toEqual(value); expect(result.reportDraft).toBeNull(); expect(result.completed).toBe(false);
    expect(model.complete).not.toHaveBeenCalled();
    if (action === "save_chapters") {
      expect(result.sources).toEqual(beforeSources); expect(result.tasks).toEqual(beforeTasks); expect(result.availableNodes).toContain("research");
      expect(result.currentNode).toBe("research"); expect(result.availableNodes).not.toContain("report");
    } else { expect(result.sources).toEqual([]); expect(result.tasks).toEqual([]); expect(result.currentNode).toBe("outline"); }
  });
});

it("rejects chapter saves without an explicit outline draft or in another node", () => {
  const valid = { sessionId: "s", requestId: "save", expectedVersion: 4, node: "outline", action: "save_chapters", draft: { node: "outline", value: fixture().state.outline } };
  expect(C.GuidedResearchRuntimeCommand.safeParse(valid).success).toBe(true);
  for (const invalid of [{ ...valid, draft: undefined }, { ...valid, node: "research" }, { ...valid, message: "generate without evidence" }]) {
    expect(C.GuidedResearchRuntimeCommand.safeParse(invalid).success).toBe(false);
  }
});

it("reassesses preserved sources when replacement chapters are confirmed (#5081)", async () => {
  const f = fixture(); f.state.busy = false; f.state.availableNodes = ["brief", "directions", "outline", "research", "report"];
  f.state.sources[0]!.decision = "excluded";
  const sources = structuredClone(f.state.sources), tasks = structuredClone(f.state.tasks), contexts: any[] = [];
  const store: GuidedRuntimeStore = { read: async () => f.state, claim: async () => ({ state: f.state, replay: false }), write: async (_actor, _request, state) => { f.writes.push(structuredClone(state)); } };
  const model: ModelCallPort = { complete: async (input) => { const c = JSON.parse(input.user); contexts.push(c); return { text: JSON.stringify(answer(c)) }; } };
  const service = new GuidedRuntimeService(store, model, { search: async () => { throw new Error("must reuse retrieved facts"); } }, config);
  const actor = { sessionId: "s", userId: "u", orgId: "org" } as RuntimeActor;
  const session = { sessionId: "s", brief: f.state.brief, directions: { versions: [] }, outline: { versions: [] }, sourceCount: 0, status: "draft", resumeStage: "brief" } as any;
  const value = [{ ...f.state.outline[2]!, id: "replacement", order: 0 }];
  await service.execute(actor, session, { sessionId: "s", node: "outline", action: "save_chapters", requestId: "edit", expectedVersion: 4, draft: { node: "outline", value } });
  const result = await service.execute(actor, session, { sessionId: "s", node: "research", action: "complete", requestId: "confirm", expectedVersion: 4, draft: { node: "research", value: f.state.sources.map(({id,decision})=>({id,decision})) } });
  expect(contexts.some((c) => c.researchStage === "source_relevance")).toBe(true);
  expect(result.sources.map(({id,decision})=>({id,decision}))).toEqual(sources.map(({id,decision})=>({id,decision})));
  expect(result.tasks).toEqual(tasks); expect(result.currentNode).toBe("report");
  expect(contexts.some((c) => c.reportStage === "evidence")).toBe(true);
  expect(contexts.some((c) => c.reportStage === "quality")).toBe(true);
});


describe("unverified chapter synthesis boundary (#5179)", () => {
  function runCase(mode: "empty" | "context" | "warn" | "all-warn" | "bad-citation", citation = "source-b") {
    const f = fixture(); const contexts: any[] = [];
    const model: ModelCallPort = { complete: async (input) => {
      const c = JSON.parse(input.user); contexts.push(c); const value: any = answer(c);
      if (c.reportStage === "evidence" && ["empty", "context"].includes(mode)) {
        for (const evaluation of value.evaluations) {
          if (mode === "empty" && evaluation.sourceId === "source-b") { evaluation.matches = []; evaluation.irrelevant = true; }
          if (mode === "context") evaluation.matches.forEach((m: any) => { m.relevance = "context"; });
        }
      }
      if (["chapter", "chapter_revision"].includes(c.reportStage) && c.section.id === "b") value.body += "\n\nUNSUPPORTED_SENTINEL: invented threshold 999.";
      if (c.reportStage === "quality" && !["empty", "context"].includes(mode) && (c.section.id === "b" || mode === "all-warn")) {
        value.supported = false; value.issues = ["AUDIT_SENTINEL: invented threshold 999 is unsupported."];
      }
      if (c.reportStage.startsWith("synthesis") && mode === "bad-citation") value.summary = `Forbidden warned source [[source:${citation}]]`;
      return { text: JSON.stringify(value) };
    } };
    return { ...f, contexts, run: () => generateReportChapters(f.state, model, config, f.persist) };
  }
  it("saves evidence gaps without writing or reviewing an evidence-free chapter", async () => {
    const f = runCase("empty"); const report = await f.run();
    expect(f.contexts.filter((c) => c.section?.id === "b")).toEqual([]);
    expect(f.contexts.some((c) => c.reportStage === "chapter" && c.section.id === "a")).toBe(true);
    expect(report.sections[0]!.sourceIds).toEqual([]);
    expect(report.sections[0]!.body).toContain("What does b establish?");
    expect(f.state.reportQualityWarnings?.some((w) => w.sectionId === "b")).toBe(true);
    expect(f.state.reportCheckpoint?.chapters).toEqual(report.sections);
    expect(f.state.reportTimeline?.find((i) => i.id === "review:b")?.status).toBe("warning");
  });
  it("retains real context excerpts for chapter generation", async () => {
    const f = runCase("context"); await f.run();
    expect(f.contexts.filter((c) => c.reportStage === "chapter")).toHaveLength(2);
    expect(f.contexts.find((c) => c.reportStage === "chapter").sources[0].content).toContain("Evidence");
  });
  it("excludes warned bodies and audit claims from factual synthesis while preserving UI warnings", async () => {
    const f = runCase("warn"); const report = await f.run();
    const synthesis = f.contexts.find((c) => c.reportStage === "synthesis");
    expect(synthesis.chapters.map((c: any) => c.sectionId)).toEqual(["a"]);
    expect(JSON.stringify(synthesis)).not.toContain("UNSUPPORTED_SENTINEL");
    expect(JSON.stringify(synthesis)).not.toContain("AUDIT_SENTINEL");
    expect(synthesis.sourceAliases.map((a: any) => a.sourceId)).toEqual(["source-a"]);
    expect(report.sections[0]!.body).toContain("UNSUPPORTED_SENTINEL");
    expect(f.state.reportQualityWarnings?.[0]?.issues.join(" ")).toContain("AUDIT_SENTINEL");
  });
  it.each(["source-b", "S2"])("rejects synthesis citations available only in warned chapters (%s)", async (citation) => {
    const f = runCase("bad-citation", citation); await expect(f.run()).rejects.toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
  });
  it("uses deterministic honest framing when every chapter is unverified", async () => {
    const f = runCase("all-warn"); const report = await f.run();
    expect(f.contexts.some((c) => c.reportStage.startsWith("synthesis"))).toBe(false);
    expect(report.summary + report.introduction + report.conclusion).not.toContain("UNSUPPORTED_SENTINEL");
    expect(report.summary).toContain("unverified");
    expect(report.title).toBe("Policy — Research report");
    expect(report.title + report.summary + report.introduction + report.conclusion).not.toMatch(/\p{Script=Han}/u);
    expect(f.state.reportQualityWarnings).toHaveLength(2);
    expect(f.state.report).toBeNull(); expect(f.state.completed).toBe(false);
  });
  it("names an unverified Chinese report after its topic without bilingual framing", async () => {
    const f = runCase("all-warn");
    f.state.brief.topic = "Node.js 运行时环境及基础 Web 服务器开发";
    const report = await f.run();
    expect(report.title).toBe("Node.js 运行时环境及基础 Web 服务器开发研究报告");
    expect(report.summary).toContain("尚未通过核验");
    expect(report.summary + report.introduction + report.conclusion).not.toMatch(/[a-z]/i);
    expect(f.state.report).toBeNull();
    expect(f.state.completed).toBe(false);
    expect(f.state.reportQualityWarnings).toHaveLength(2);
  });
  it.each(["中文研究", "English research"])("uses one language throughout evidence-free chapters and truncated questions (%s)", async (topic) => {
    const f = runCase("empty");
    const chinese = topic === "中文研究";
    f.state.brief = { ...f.state.brief, topic, goal: "", focus: "" };
    f.state.outline[0]!.title = chinese ? "证据缺口" : "Evidence gaps";
    f.state.outline[0]!.questions = [chinese ? "问题" : "Question"];
    (f.state.outline[0]! as any).subsections = Array.from({ length: 8 }, (_, i) => ({ id: `part-${i}`, title: chinese ? `待核实范围${i}` : `Unresolved scope ${i}`, questions: Array.from({ length: 4 }, (_, j) => `${i}/${j}: ${(chinese ? "问" : "Q").repeat(900)}`) }));
    expect(C.GuidedResearchOutlineSection.safeParse(f.state.outline[0]).success).toBe(true);
    const report = await f.run();
    const gap = report.sections[0]!;
    expect(gap.sourceIds).toEqual([]);
    expect(gap.body).toContain(chinese ? "余文省略" : "remainder omitted");
    expect(gap.body).toContain(chinese ? "待核实问题" : "Unanswered question");
    expect(gap.body).not.toMatch(chinese ? /[a-z]/i : /\p{Script=Han}/u);
    expect(f.state.completed).toBe(false);
  });
  it("keeps evidence-free resume warnings and reuses later trusted chapters", async () => {
    const f = runCase("empty"); await f.run(); f.contexts.length = 0;
    const model: ModelCallPort = { complete: async (input) => {
      const c = JSON.parse(input.user); f.contexts.push(c); const value: any = answer(c);
      if (c.reportStage === "evidence") value.evaluations.forEach((e: any) => { e.matches = []; e.irrelevant = true; });
      return { text: JSON.stringify(value) };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    expect(report.sections[1]!.sourceIds).toEqual(["source-a"]);
    expect(f.state.reportQualityWarnings?.[0]?.sectionId).toBe("b");
    expect(f.contexts.some((c) => c.reportStage === "chapter")).toBe(false);
  });
  it("does not reflect citation controls or URLs from confirmed gap questions", async () => {
    const f = runCase("empty");
    f.state.outline[0]!.questions = ["What [[source:source-b]] https://example.com/malicious establishes this?"];
    const report = await f.run();
    expect(report.sections[0]!.body).not.toContain("[[source:");
    expect(report.sections[0]!.body).not.toContain("https://");
    expect(f.state.outline[0]!.questions[0]).toContain("[[source:");
  });
  it("does not hide failed durable saves of evidence-gap checkpoints", async () => {
    const f = runCase("empty"); const save = f.persist;
    const failing: RuntimePersistence = Object.assign(async () => {
      if (f.state.reportCheckpoint?.chapters.some((c) => c.sectionId === "b")) throw new Error("gap save failed");
      await save();
    }, { requestId: save.requestId, observe: save.observe });
    const model: ModelCallPort = { complete: async (input) => {
      const c = JSON.parse(input.user); const value: any = answer(c);
      if (c.reportStage === "evidence") value.evaluations.forEach((e: any) => { if (e.sourceId === "source-b") { e.matches = []; e.irrelevant = true; } });
      return { text: JSON.stringify(value) };
    } };
    await expect(generateReportChapters(f.state, model, config, failing)).rejects.toThrow("gap save failed");
  });

  it("rebuilds a gap chapter when retry gains verified evidence without regenerating trusted successors", async () => {
    const f = runCase("empty"); await f.run(); const calls: any[] = [];
    const model: ModelCallPort = { complete: async (input) => { const c = JSON.parse(input.user); calls.push(c); return { text: JSON.stringify(answer(c)) }; } };
    await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    expect(calls.filter((c) => c.reportStage === "chapter").map((c) => c.section.id)).toEqual(["b"]);
    expect(f.state.reportQualityWarnings).toEqual([]);
  });
  it("keeps all-invalid global extraction fail-closed", async () => {
    const f = fixture(); const model: ModelCallPort = { complete: async () => ({ text: "invalid evidence" }) };
    await expect(generateReportChapters(f.state, model, config, f.persist)).rejects.toThrow("RESEARCH_CONTENT_REFERENCE_INVALID");
    expect(f.state.reportQualityWarnings).toEqual([]);
    expect(f.state.reportCheckpoint?.chapters).toEqual([]);
  });

  it("keeps warned assertions out of both initial and repair synthesis inputs", async () => {
    const f = fixture(); const inputs: any[] = []; let synthesis = 0;
    const model: ModelCallPort = { complete: async (input) => {
      const c = JSON.parse(input.user); const value: any = answer(c);
      if (["chapter", "chapter_revision"].includes(c.reportStage) && c.section.id === "b") value.body += "\n\nUNSUPPORTED_SENTINEL";
      if (c.reportStage === "quality" && c.section.id === "b") { value.supported = false; value.issues = ["AUDIT_SENTINEL"]; }
      if (c.reportStage.startsWith("synthesis")) { inputs.push(c); if (!synthesis++) return { text: "invalid JSON" }; }
      return { text: JSON.stringify(value) };
    } };
    await generateReportChapters(f.state, model, config, f.persist);
    expect(inputs.map((c) => c.reportStage)).toEqual(["synthesis", "synthesis_revision"]);
    expect(JSON.stringify(inputs)).not.toContain("UNSUPPORTED_SENTINEL"); expect(JSON.stringify(inputs)).not.toContain("AUDIT_SENTINEL");
  });
  it("allows a shared citation when a quality-passed chapter also uses it", async () => {
    const f = fixture();
    const model: ModelCallPort = { complete: async (input) => {
      const c = JSON.parse(input.user); const value: any = answer(c);
      if (c.reportStage === "evidence") value.evaluations.forEach((e: any) => {
        if (e.sourceId === "source-b") e.matches.push({ ...e.matches[0], questionId: c.questions.find((q: any) => q.sectionId === "a").id });
        else { e.matches = []; e.irrelevant = true; }
      });
      if (c.reportStage === "quality" && c.section.id === "b") { value.supported = false; value.issues = ["Unsupported draft."]; }
      return { text: JSON.stringify(value) };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(report.summary).toContain("[[source:source-b]]");
  });
  it("propagates observer failures during deterministic all-warned synthesis", async () => {
    const f = runCase("all-warn");
    const persist: RuntimePersistence = Object.assign(f.persist, { observe: (event: RuntimeStreamEvent) => {
      if (event.type === "snapshot" && event.state.reportTimeline?.find((i) => i.id === "synthesis")?.status === "warning") throw new Error("observer failed");
    } });
    const model: ModelCallPort = { complete: async (input) => {
      const c = JSON.parse(input.user); const value: any = answer(c);
      if (c.reportStage === "quality") { value.supported = false; value.issues = ["Unverified."]; }
      return { text: JSON.stringify(value) };
    } };
    await expect(generateReportChapters(f.state, model, config, persist)).rejects.toThrow("observer failed");
  });

  it("retains every confirmed heading and explicit gap in a bounded long-plan draft", async () => {
    const f = fixture();
    (f.state.outline[0]! as any).subsections = Array.from({ length: 8 }, (_, i) => ({ id: `part-${i}`, title: `Confirmed heading ${i}`, questions: Array.from({ length: 4 }, (_, j) => `Question ${i}/${j}: ${"long scope ".repeat(80)}`) }));
    expect(C.GuidedResearchOutlineSection.safeParse(f.state.outline[0]).success).toBe(true);
    const before = structuredClone(f.state.outline);
    const model: ModelCallPort = { complete: async (input) => {
      const c = JSON.parse(input.user); const value: any = answer(c);
      if (c.reportStage === "evidence") value.evaluations.forEach((e: any) => { if (e.sourceId === "source-b") { e.matches = []; e.irrelevant = true; } });
      return { text: JSON.stringify(value) };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    const gap = report.sections[0]!.body;
    expect(gap.length).toBeLessThanOrEqual(20000);
    for (const part of (f.state.outline[0]! as any).subsections!) {
      expect(gap).toContain(`### ${part.title}`);
      const prose = gap.split(`### ${part.title}`)[1]!.split("### ")[0]!;
      expect(prose).toContain("No usable verified excerpts");
      for (let j = 0; j < part.questions.length; j++) expect(prose).toContain(`Question ${part.id.split("-")[1]}/${j}:`);
    }
    expect(gap).toContain("omitted"); expect(f.state.outline).toEqual(before);
  });

  it("computes at most two chapters concurrently and commits in confirmed order", async () => {
    const f = fixture(); let release!: () => void; let second!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const secondStarted = new Promise<void>((resolve) => { second = resolve; });
    let active = 0, peak = 0;
    const model: ModelCallPort = { complete: async (input) => {
      const c = JSON.parse(input.user);
      if (c.reportStage === "chapter") { active++; peak = Math.max(peak, active); if (c.section.id === "b") await gate; else second(); active--; }
      return { text: JSON.stringify(answer(c)) };
    } };
    const generating = generateReportChapters(f.state, model, config, f.persist);
    try {
      await Promise.race([secondStarted, new Promise((_, reject) => setTimeout(() => reject(new Error("chapters remain serial")), 100))]);
      expect(f.state.reportCheckpoint?.chapters).toEqual([]);
      expect(f.state.reportQualityWarnings).toEqual([]);
    } finally { release(); }
    const report = await generating;
    expect(peak).toBe(2); expect(report.sections.map((c) => c.sectionId)).toEqual(["b", "a"]);
    expect(f.writes.filter((s) => s.reportCheckpoint?.chapters.length).every((s) => s.reportCheckpoint!.chapters[0]!.sectionId === "b")).toBe(true);
  });

  it("promotes the running prefetched chapter before its model call completes", async () => {
    const f = fixture();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const backgroundStarted = new Promise<void>((resolve) => { started = resolve; });
    const model: ModelCallPort = { complete: async (input) => {
      const c = JSON.parse(input.user);
      if (c.reportStage === "chapter" && c.section.id === "a") { started(); await gate; }
      if (c.reportStage === "chapter" && c.section.id === "b") await backgroundStarted;
      return { text: JSON.stringify(answer(c)) };
    } };
    const generating = generateReportChapters(f.state, model, config, f.persist);
    try {
      await backgroundStarted;
      await expect.poll(() => f.writes.some((s) => s.reportCheckpoint?.chapters.length === 1)).toBe(true);
      await expect.poll(() => f.writes.at(-1)?.reportTimeline?.find((item) => item.id === "chapter:a")?.status).toBe("running");
      expect(f.writes.at(-1)?.progress).toMatchObject({ sectionId: "a", completed: 1 });
      expect(f.state.reportCheckpoint?.chapters.map((chapter) => chapter.sectionId)).toEqual(["b"]);
      expect(f.state.reportQualityWarnings).toEqual([]);
    } finally { release(); await generating; }
  });
  it("never publishes prefetched tokens or warnings before the preceding checkpoint", async () => {
    const f = fixture(); let release!: () => void; let ready!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; }); const laterDone = new Promise<void>((resolve) => { ready = resolve; });
    const model: ModelCallPort = { complete: async (input) => {
      const c = JSON.parse(input.user); const value: any = answer(c);
      if (c.reportStage === "quality" && c.section.id === "a") { value.supported = false; value.issues = ["Background warning"]; if (f.state.modelCalls.length >= 5) ready(); }
      return { text: JSON.stringify(value) };
    }, completeStream: async (input, emit) => {
      const c = JSON.parse(input.user); const value = answer(c);
      if (c.section?.id === "b") await gate;
      const text = JSON.stringify(value); await emit(text); return { text };
    } };
    const generating = generateReportChapters(f.state, model, config, f.persist);
    try {
      await laterDone;
      expect(f.state.reportQualityWarnings).toEqual([]); expect(f.state.reportCheckpoint?.chapters).toEqual([]);
      expect(f.events.filter((e) => e.type === "report_delta")).toEqual([]);
      expect(f.state.reportTimeline?.find((i) => i.id === "review:a")?.status).toBe("pending");
    } finally { release(); }
    const report = await generating;
    expect(report.sections.map((c) => c.sectionId)).toEqual(["b", "a"]);
    expect(f.state.reportQualityWarnings?.[0]?.sectionId).toBe("a");
    expect(f.events.filter((e) => e.type === "report_delta").every((e) => e.type !== "report_delta" || !e.delta.includes('"sectionId":"a"'))).toBe(true);
  });
  it("drains started work before returning a front failure without committing a later chapter", async () => {
    const f = fixture(); let release!: () => void; let ready!: () => void; let drained = false;
    const gate = new Promise<void>((resolve) => { release = resolve; }); const started = new Promise<void>((resolve) => { ready = resolve; });
    const failure = new Error("front failure");
    const model: ModelCallPort = { complete: async (input) => {
      const c = JSON.parse(input.user);
      if (c.reportStage === "chapter" && c.section.id === "a") { ready(); await gate; drained = true; }
      if (c.reportStage === "chapter" && c.section.id === "b") { await started; throw failure; }
      return { text: JSON.stringify(answer(c)) };
    } };
    let settled = false;
    const generating = generateReportChapters(f.state, model, config, f.persist).finally(() => { settled = true; });
    const rejection = expect(generating).rejects.toBe(failure);
    await started; await Promise.resolve(); expect(settled).toBe(false);
    release(); await rejection; expect(drained).toBe(true);
    expect(f.state.reportCheckpoint?.chapters).toEqual([]);
    const writes = f.writes.length; await Promise.resolve(); await Promise.resolve(); expect(f.writes).toHaveLength(writes);
  });
  it("bounds more than two chapters and serializes stream and checkpoint persistence", async () => {
    const f = fixture(); f.state.outline = Array.from({ length: 5 }, (_, index) => section(String(index), `Section ${index}`, index));
    f.state.tasks = f.state.outline.map((s) => ({ id: `task-${s.id}`, sectionId: s.id, query: s.title, status: "succeeded", attempts: 1, errorCode: null }));
    f.state.sources = f.state.outline.map((s) => ({ id: `source-${s.id}`, taskId: `task-${s.id}`, title: s.title, content: `Evidence for ${s.id}`, url: `https://example.com/${s.id}`, retrievedAt: "now", decision: "accepted" }));
    let active = 0, peak = 0, writing = 0, writePeak = 0; const perSection = new Set<string>();
    const persist: RuntimePersistence = Object.assign(async () => { writing++; writePeak = Math.max(writePeak, writing); await new Promise((resolve) => setTimeout(resolve, 1)); f.writes.push(structuredClone(f.state)); writing--; }, { requestId: "bounded-chapters", observe: f.persist.observe });
    const compute = async (input: any) => {
      const c = JSON.parse(input.user); if (c.section) { expect(perSection.has(c.section.id)).toBe(false); perSection.add(c.section.id); active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 2)); active--; perSection.delete(c.section.id); }
      return { text: JSON.stringify(answer(c)) };
    };
    const model: ModelCallPort = { complete: compute, completeStream: async (input, emit) => { const output = await compute(input); await emit(output.text); return output; } };
    const report = await generateReportChapters(f.state, model, config, persist);
    expect(peak).toBe(2); expect(writePeak).toBe(1);
    expect(report.sections.map((c) => c.sectionId)).toEqual(["0", "1", "2", "3", "4"]);
    for (const snapshot of f.writes) expect(snapshot.reportCheckpoint?.chapters.map((c) => c.sectionId)).toEqual(["0", "1", "2", "3", "4"].slice(0, snapshot.reportCheckpoint?.chapters.length ?? 0));
  });

});

it("publishes confirmed report destination before reading sources and does not retry failed documents", async () => {
  const f = fixture();
  f.state.currentNode = "research";
  f.state.availableNodes = ["brief", "directions", "outline", "research"];
  f.state.sources[1]!.documentError = "unavailable";
  const read = vi.fn(async (url: string) => {
    expect(f.events.some((event) => event.type === "snapshot" && event.state.currentNode === "report" && event.state.availableNodes.includes("report"))).toBe(true);
    return { url, text: "Evidence for a", contentKind: "text" as const, truncated: false };
  });
  const store: GuidedRuntimeStore = { read: async () => f.state, claim: async () => ({ state: f.state, replay: false }), write: async () => {} };
  const service = new GuidedRuntimeService(store, { complete: async (input) => ({ text: JSON.stringify(answer(JSON.parse(input.user))) }) }, { search: async () => [], read }, config);
  await service.execute({ sessionId: "s", orgId: "org", userId: "u" } as RuntimeActor, { sessionId: "s", brief: f.state.brief, directions: { versions: [] }, outline: { versions: [] } } as any,
    { sessionId: "s", node: "research", action: "complete", requestId: "advance", expectedVersion: 4 }, (event) => f.events.push(event));
  expect(read).toHaveBeenCalledTimes(1);
  expect(read).toHaveBeenCalledWith("https://example.com/a", { signal: expect.any(AbortSignal) });
});

it("bounds a stalled report preparation model request at ninety seconds", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    const store: GuidedRuntimeStore = { read: async () => f.state, claim: async () => ({ state: f.state, replay: false }), write: async () => {} };
    const service = new GuidedRuntimeService(store, { complete: async () => new Promise(() => {}) }, { search: async () => [] }, config);
    const operation = service.execute({ sessionId: "s", orgId: "org", userId: "u" } as RuntimeActor,
      { sessionId: "s", brief: f.state.brief, directions: { versions: [] }, outline: { versions: [] } } as any,
      { sessionId: "s", node: "report", action: "generate", requestId: "deadline", expectedVersion: 4 });
    await vi.advanceTimersByTimeAsync(90_000);
    const result = await operation;
    expect(result.busy).toBe(false);
    expect(result.errorCode).toBe("RESEARCH_REPORT_MODEL_TIME_BUDGET_EXCEEDED");
  } finally { vi.useRealTimers(); }
});

it("resumes an unchanged report basis without re-screening already prepared sources", async () => {
  const f = fixture();
  f.state.reportCheckpoint = { basis: reportBasis(f.state, config), chapters: [] };
  const contexts: any[] = [];
  const read = vi.fn(async () => { throw new Error("must reuse prepared report basis"); });
  const store: GuidedRuntimeStore = { read: async () => f.state, claim: async () => ({ state: f.state, replay: false }), write: async () => {} };
  const service = new GuidedRuntimeService(store, { complete: async (input) => {
    const context = JSON.parse(input.user); contexts.push(context);
    if (context.researchStage) throw new Error("already screened basis must not block report resume");
    return { text: JSON.stringify(answer(context)) };
  } }, { search: async () => [], read }, config);
  const result = await service.execute({ sessionId: "s", orgId: "org", userId: "u" } as RuntimeActor,
    { sessionId: "s", brief: f.state.brief, directions: { versions: [] }, outline: { versions: [] } } as any,
    { sessionId: "s", node: "report", action: "retry", requestId: "resume-basis", expectedVersion: 4 });
  expect(result.errorCode).toBeNull();
  expect(result.report?.sections).toHaveLength(2);
  expect(read).not.toHaveBeenCalled();
  expect(contexts.every((c) => !c.researchStage)).toBe(true);
});

 it.each(["Investigar energía solar", "太陽光発電を調査", "태양광 발전 조사"])("preserves user language for chapter and synthesis prompts (%s)", async (topic) => {
  const f = fixture(); f.state.brief = { ...f.state.brief, topic, goal: "", focus: "" };
  const prompts: string[] = [];
  const model: ModelCallPort = { complete: async (input) => {
    const context = JSON.parse(input.user);
    if (["chapter", "synthesis"].includes(context.reportStage)) prompts.push(input.system);
    return { text: JSON.stringify(answer(context)) };
  } };
  await generateReportChapters(f.state, model, config, f.persist);
  expect(prompts).toHaveLength(3);
  for (const prompt of prompts) {
    expect(prompt).toContain("Preserve the user's language");
    expect(prompt).not.toMatch(/prose only in (Chinese|English)/);
  }
});
