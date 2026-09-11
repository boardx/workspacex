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
      .map((question: any) => ({ questionId: question.id, quote: chunk.content.slice(0, 80), insight: "The excerpt supports a limited policy comparison.", relevance: "direct" }));
    return { sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: !matches.length, matches };
  }) };
  if (context.reportStage === "quality") return { questions: context.evidenceByQuestion.map((question: any) => ({ questionId: question.id, status: question.gap ? "gap" : "answered", rationale: "The chapter addresses this question with appropriate limitations." })), supported: true, analysisDepth: "adequate", issues: [] };
  if (["chapter", "chapter_revision"].includes(context.reportStage)) return { sectionId: context.section.id, body: body(context.sources[0].id), sourceIds: [context.sources[0].id] };
  return { introduction: "This study compares policy requirements using retrieved excerpts, with incomplete implementation coverage.", conclusion: "Prioritize local verification before investment, balancing entry speed against uncertain regulatory obligations.", title: "Evidence-based findings", summary: `The chapters support a cautious comparison. [[source:${context.chapters[0].sourceIds[0]}]]` };
}
describe("chapter-based report generation", () => {
  it("makes N chapter calls in exact enabled order then synthesizes, streaming actual deltas into one aggregate", async () => {
    const f = fixture(); const contexts: Record<string, any>[] = []; const inputs: string[] = [];
    const complete = vi.fn(async (input) => { const context = JSON.parse(input.user); contexts.push(context); inputs.push(input.system); return { text: JSON.stringify(answer(context)) }; });
    const model: ModelCallPort = { complete, completeStream: async (input, delta) => {
      const context = JSON.parse(input.user); contexts.push(context); inputs.push(input.system);
      const text = JSON.stringify(answer(context)); await delta(text.slice(0, 24)); await delta(text.slice(24)); return { text };
    } };
    const report = await generateReportChapters(f.state, model, config, f.persist);
    expect(contexts.map((c) => c.reportStage)).toEqual(["evidence", "chapter", "quality", "chapter", "quality", "synthesis"]);
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
    expect(chunks.every((chunk) => chunk.sourceId === "source-a" && chunk.content.length <= 6000)).toBe(true);
    expect(chunks.reduce((total, chunk) => total + chunk.content.length, 0)).toBe(30000);
    const firstChapter = contexts.find((c) => c.reportStage === "chapter");
    expect(firstChapter.evidenceGaps).toEqual([{ query: "b policy", status: "failed", errorCode: null }]); expect(firstChapter.reportPartial).toBe(true);
  });
  it("degrades a zero-delta streaming adapter to honest loading without fabricating completed text", async () => {
    const f = fixture(); let calls = 0;
    const model: ModelCallPort = { complete: async (input) => ({ text: JSON.stringify(answer(JSON.parse(input.user))) }), completeStream: async (input, delta) => {
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
  it("binds checkpoints to session and all research inputs and validates stored prefixes", async () => {
    const f = fixture(); const baseline = reportBasis(f.state, config);
    for (const change of [
      (state: ResearchRuntime) => { state.sessionId = "different"; },
      (state: ResearchRuntime) => { state.brief.goal += " new"; },
      (state: ResearchRuntime) => { state.outline[0]!.questions.push("New question"); },
      (state: ResearchRuntime) => { state.tasks[0]!.status = "failed"; },
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
    expect(calls).toBe(1);
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
      if (context.reportStage.startsWith("evidence")) return { text: JSON.stringify({ evaluations: context.chunks.map((chunk: any, index: number) => ({ sourceId: chunk.sourceId, chunkId: chunk.chunkId, irrelevant: false, matches: context.questions.map((question: any) => ({ questionId: question.id, quote: index === 0 ? chunk.content : "Fabricated quote", insight: "Limited evidence", relevance: "direct" })) })) }) };
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
      if (context.reportStage === "synthesis") expect(context.qualityWarnings).toEqual([expect.objectContaining({ sectionId: "b" })]);
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
    const f = fixture(); let retry = false; const calls: string[] = [];
    const model: ModelCallPort = { complete: async (input) => {
      const context = JSON.parse(input.user);
      calls.push(`${context.reportStage}:${context.section?.id ?? ""}`);
      if (!retry && (interruption === "synthesis" ? context.reportStage === "synthesis" : context.reportStage === "chapter" && context.section.id === "a")) throw new Error("interrupted");
      const value = answer(context);
      if (!retry && context.reportStage === "quality" && context.section.id === "b") Object.assign(value, { supported: false, issues: ["Verify policy claims."] });
      return { text: JSON.stringify(value) };
    } };
    await expect(generateReportChapters(f.state, model, config, f.persist)).rejects.toThrow("interrupted");
    expect(f.state.reportDraft).toBeFalsy();
    expect(f.state.reportQualityWarnings).toEqual([expect.objectContaining({ sectionId: "b" })]);
    retry = true; calls.length = 0;
    const report = await generateReportChapters(f.state, model, config, f.persist, undefined, true);
    expect(calls).toContain("chapter:b"); expect(calls).toContain("quality:b");
    if (interruption === "synthesis") expect(calls).not.toContain("chapter:a");
    expect(report.sections.map((chapter) => chapter.sectionId)).toEqual(["b", "a"]);
    expect(f.state.reportQualityWarnings).toEqual([]);
  });

});
