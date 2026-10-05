import { PersistedResearchRuntimeSchema } from "../../src/application/research/guided-runtime-persistence";
import { describe, expect, it, vi } from "vitest";
import { research as C } from "@repo/contracts";
import { createHash } from "node:crypto";
import { GuidedRuntimeService, initialRuntime } from "../../src/application/research/guided-runtime-service";
import { ResearchRuntimeError, type GuidedRuntimeStore, type ResearchRuntime, type RuntimeCommand } from "../../src/application/research/guided-runtime-ports";
import { guidedResearchReply } from "../../scripts/loopback-guided-research";
import { toOrgId } from "../../src/domain/org-id";

function fixture() {
  const session = C.GuidedResearchSession.parse({ sessionId: "three-step", title: "Research", brief: { topic: "Grid policy", goal: "Compare entry requirements", region: "EU", focus: "Evidence", timeRange: "2026" }, stage: "brief", resumeStage: "brief", status: "active", progress: 0, sourceCount: 0, reportId: null, createdAt: "now", updatedAt: "now" });
  let state = initialRuntime(session);
  const writes: ResearchRuntime[] = [];
  const requests = new Map<string, string>();
  const claim = vi.fn(async (_actor, command: RuntimeCommand, hash: string) => {
    if (requests.has(command.requestId)) {
      if (requests.get(command.requestId) !== hash) throw new ResearchRuntimeError("RESEARCH_GRAPH_VERSION_CONFLICT");
      return { state: structuredClone(state), replay: true };
    }
    requests.set(command.requestId, hash); state.version++; state.busy = true; state.errorCode = null;
    return { state: structuredClone(state), replay: false };
  });
  const write = vi.fn(async (_actor, _request, next: ResearchRuntime) => { state = PersistedResearchRuntimeSchema.parse(structuredClone(next)); writes.push(structuredClone(state)); });
  const store: GuidedRuntimeStore = { read: async () => structuredClone(state), claim, write };
  const model = { complete: vi.fn(async (input: { system: string; user: string }) => ({ text: guidedResearchReply(input.system, input.user)! })) };
  const search = vi.fn(async (query: string) => [{ title: "Official policy", url: `https://example.org/${createHash("sha256").update(query).digest("hex")}`, content: "Grid policy requires documented permits and local verification." }]);
  const read = vi.fn(async () => ({ text: "Grid policy requires documented permits and local verification.", contentKind: "text" as const, truncated: false }));
  const actor = { orgId: toOrgId("org"), userId: "owner", sessionId: session.sessionId };
  const service = new GuidedRuntimeService(store, model, { search, read }, { provider: "controlled", id: "mock" });
  const run = (action: string, node = "brief", extra: Record<string, unknown> = {}, requestId = `${action}-${state.version}`) => service.execute(actor, session,
    C.GuidedResearchRuntimeCommand.parse({ sessionId: session.sessionId, requestId, expectedVersion: state.version, node, action, ...extra }));
  return { run, model, search, read, writes, claim, write, service, session, actor, latest: () => state, set: (next: ResearchRuntime) => { state = next; } };
}

describe("three visible stages with durable composite execution", () => {
  it("accepts only well-positioned composite commands without a partial-research escape hatch", () => {
    const base = { sessionId: "s", requestId: "r", expectedVersion: 0 };
    expect(C.GuidedResearchRuntimeCommand.safeParse({ ...base, node: "brief", action: "prepare_plan" }).success).toBe(true);
    expect(C.GuidedResearchRuntimeCommand.safeParse({ ...base, node: "outline", action: "generate_report" }).success).toBe(true);
    for (const command of [
      { node: "report", action: "prepare_plan" }, { node: "brief", action: "generate_report" },
      { node: "outline", action: "generate_report", allowPartialResearch: true },
      { node: "brief", action: "prepare_plan", message: "Unapproved instruction" },
      { node: "research", action: "generate_report", draft: { node: "research", value: [] } },
      { node: "outline", action: "generate_report", proposalId: "unapproved" },
    ]) expect(C.GuidedResearchRuntimeCommand.safeParse({ ...base, ...command }).success).toBe(false);
  });
  it("prepares brief, directions and outline in one claim, stops at editable plan and never searches on replay or refresh", async () => {
    const f = fixture(); const result = await f.run("prepare_plan", "brief", {}, "same-plan");
    expect(result.errorCode).toBeNull(); expect(result.currentNode).toBe("outline"); expect(result.executionGoal).toBe("plan");
    expect(result.generatedNodes).toEqual(["brief", "directions", "outline"]);
    expect(result.outline.length).toBeGreaterThan(0); expect(result.completed).toBe(false); expect(f.claim).toHaveBeenCalledTimes(1);
    expect(f.search).not.toHaveBeenCalled(); expect(f.model.complete).toHaveBeenCalledTimes(3);
    expect(f.writes[0]?.executionGoal).toBe("plan");
    const calls = f.model.complete.mock.calls.length;
    await f.run("prepare_plan", "brief", { expectedVersion: 0 }, "same-plan"); await f.service.get(f.actor, f.session); await f.run("retry", "outline");
    expect(f.model.complete).toHaveBeenCalledTimes(calls); expect(f.search).not.toHaveBeenCalled();
  });
  it("does not generate an outline after a direction failure and retries only the unfinished plan", async () => {
    const f = fixture(); const complete = f.model.complete.getMockImplementation()!; let fail = true;
    f.model.complete.mockImplementation(async input => { if (fail && input.system.includes("Generate the directions step")) throw new Error("controlled failure"); return complete(input); });
    const failed = await f.run("prepare_plan");
    expect(failed.executionGoal).toBe("plan"); expect(failed.currentNode).toBe("directions"); expect(failed.errorCode).not.toBeNull();
    expect(failed.outline).toEqual([]); expect(f.search).not.toHaveBeenCalled();
    fail = false; const result = await f.run("retry", "directions"); expect(result.currentNode).toBe("outline"); expect(result.errorCode).toBeNull();
    expect(f.model.complete.mock.calls.filter(([input]) => input.system.includes("Generate the brief step"))).toHaveLength(1);
  });
  it("runs confirmed plan through source preparation and existing report completion with one claim", async () => {
    const f = fixture(); await f.run("prepare_plan"); f.claim.mockClear();
    const result = await f.run("generate_report", "outline");
    expect(f.claim).toHaveBeenCalledTimes(1); expect(result.executionGoal).toBe("report");
    expect(result.errorCode).toBeNull(); expect(result.currentNode).toBe("report"); expect(result.report).not.toBeNull(); expect(result.completed).toBe(true);
    expect(result.sources.some(source => source.document)).toBe(true);
    expect(result.reportTimeline?.every(step => step.status === "completed")).toBe(true);
    const searchCalls = f.search.mock.calls.length, modelCalls = f.model.complete.mock.calls.length;
    await f.service.get(f.actor, f.session); await f.run("retry", "report");
    expect(f.search).toHaveBeenCalledTimes(searchCalls); expect(f.model.complete).toHaveBeenCalledTimes(modelCalls);
  });
  it("does not advance to report when all searches fail and retains the goal for an explicit retry", async () => {
    const f = fixture(); await f.run("prepare_plan"); f.search.mockRejectedValue(new Error("unavailable"));
    const result = await f.run("generate_report", "outline");
    expect(result.errorCode).not.toBeNull(); expect(result.currentNode).toBe("research"); expect(result.executionGoal).toBe("report");
    expect(result.report).toBeNull(); expect(result.completed).toBe(false);
    expect(f.model.complete.mock.calls.some(([input]) => JSON.parse(input.user).reportStage)).toBe(false);
  });
  it("clears execution intent on a manually saved plan so a retry cannot silently run its old report chain", async () => {
    const f = fixture(); await f.run("prepare_plan");
    const result = await f.run("save", "outline", { draft: { node: "outline", value: f.latest().outline } });
    expect(result.executionGoal).toBeUndefined(); expect(f.search).not.toHaveBeenCalled();
  });
  it("keeps a paused report goal without issuing searches or models", async () => {
    const f = fixture(); await f.run("prepare_plan"); f.set({ ...f.latest(), controlStatus: "paused" });
    const calls = f.model.complete.mock.calls.length;
    const result = await f.run("generate_report", "outline");
    expect(result.errorCode).toBeNull(); expect(result.controlStatus).toBe("paused"); expect(result.executionGoal).toBe("report"); expect(result.completed).toBe(false); expect(f.search).not.toHaveBeenCalled();
    expect(f.model.complete).toHaveBeenCalledTimes(calls);
  });
  it("retains successful search tasks on a partial failure and resumes the report chain only on explicit retry", async () => {
    const f = fixture(); await f.run("prepare_plan");
    const search = f.search.getMockImplementation()!; let failed = false;
    f.search.mockImplementation(async query => { if (!failed) { failed = true; throw new Error("one task unavailable"); } return search(query); });
    const partial = await f.run("generate_report", "outline");
    expect(partial.errorCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE"); expect(partial.currentNode).toBe("research"); expect(partial.completed).toBe(false);
    expect(partial.report).toBeNull(); expect(partial.reportPartial).toBe(false);
    const succeeded = partial.tasks.filter(task => task.status === "succeeded"); expect(succeeded.length).toBeGreaterThan(0);
    const ids = partial.sources.map(source => source.id), queries = succeeded.map(task => task.query);
    f.search.mockClear(); f.search.mockImplementation(search);
    const result = await f.run("retry", "research");
    expect(result.errorCode).toBeNull(); expect(result.completed).toBe(true);
    expect(f.search.mock.calls.some(([query]) => queries.includes(query))).toBe(false);
    expect(ids.every(id => result.sources.some(source => source.id === id))).toBe(true);
  });
  it("does not promote quality-warned drafts or automatically restart their report generation", async () => {
    const f = fixture(); await f.run("prepare_plan");
    const complete = f.model.complete.getMockImplementation()!;
    f.model.complete.mockImplementation(async input => {
      const result = await complete(input), context = JSON.parse(input.user);
      if (context.reportStage === "quality") {
        const value = JSON.parse(result.text); value.supported = false; value.analysisDepth = "shallow"; value.issues = ["Controlled unresolved support"];
        return { text: JSON.stringify(value) };
      }
      return result;
    });
    const result = await f.run("generate_report", "outline");
    expect(result.errorCode).toBe("RESEARCH_REPORT_QUALITY_INSUFFICIENT"); expect(result.completed).toBe(false); expect(result.report).toBeNull();
    expect(result.reportDraft).toBeTruthy(); expect(result.reportQualityWarnings?.length).toBeGreaterThan(0);
    const calls = f.model.complete.mock.calls.map(([input]) => JSON.parse(input.user));
    expect(calls.filter(context => ["chapter", "chapter_revision"].includes(context.reportStage))).toHaveLength(result.outline.filter(section => section.enabled).length * 2);
  });
  it("resumes persisted quality-passed chapters after synthesis failure without repeating search or chapter computation", async () => {
    const f = fixture(); await f.run("prepare_plan");
    const complete = f.model.complete.getMockImplementation()!; let fail = true;
    f.model.complete.mockImplementation(async input => {
      if (fail && JSON.parse(input.user).reportStage === "synthesis") throw new Error("controlled synthesis failure");
      return complete(input);
    });
    const failed = await f.run("generate_report", "outline");
    expect(failed.errorCode).not.toBeNull(); expect(failed.completed).toBe(false); expect(failed.reportCheckpoint?.chapters.length).toBeGreaterThan(0);
    const chapters = f.model.complete.mock.calls.filter(([input]) => ["chapter", "chapter_revision"].includes(JSON.parse(input.user).reportStage)).length;
    const searches = f.search.mock.calls.length, sources = failed.sources.map(source => source.id);
    fail = false; const result = await f.run("retry", "report");
    expect(result.completed).toBe(true); expect(result.errorCode).toBeNull(); expect(f.search).toHaveBeenCalledTimes(searches);
    expect(result.sources.map(source => source.id)).toEqual(sources);
    expect(f.model.complete.mock.calls.filter(([input]) => ["chapter", "chapter_revision"].includes(JSON.parse(input.user).reportStage))).toHaveLength(chapters);
  });

  it("resumes a paused durable report goal only after explicit resume and retry, keeping its original source/checkpoint intent", async () => {
    const f = fixture(); await f.run("prepare_plan"); f.set({ ...f.latest(), controlStatus: "paused" });
    await f.run("generate_report", "outline");
    const calls = f.model.complete.mock.calls.length;
    const resumed = await f.run("resume", "research", { expectedRevision: 0, idempotencyKey: "resume-goal" });
    expect(resumed.controlStatus).toBe("running"); expect(resumed.executionGoal).toBe("report");
    expect(f.model.complete).toHaveBeenCalledTimes(calls); expect(f.search).not.toHaveBeenCalled();
    expect((await f.run("retry", "outline")).completed).toBe(true);
  });
  it("rejects a draft-bearing goal retry rather than promoting manually replaced report text without another quality audit", async () => {
    const f = fixture(); await f.run("prepare_plan"); await f.run("generate_report", "outline");
    const report = f.latest().report!, calls = f.model.complete.mock.calls.length;
    const result = await f.run("retry", "report", { draft: { node: "report", value: { ...report, summary: "Unverified replacement" } } });
    expect(result.errorCode).toBe("RESEARCH_NODE_STATE_INVALID"); expect(result.report?.summary).toBe(report.summary);
    expect(f.model.complete).toHaveBeenCalledTimes(calls);
  });

  it("clears report execution intent after a saved chapter edit while preserving its sources", async () => {
    const f = fixture(); await f.run("prepare_plan"); await f.run("generate_report", "outline");
    const before = f.latest().sources;
    const result = await f.run("save_chapters", "outline", { draft: { node: "outline", value: f.latest().outline } });
    expect(result.executionGoal).toBeUndefined(); expect(result.sources).toEqual(before); expect(result.completed).toBe(false);
  });
  it("does not keep the previous execution goal when a human applies an editing proposal", async () => {
    const f = fixture(); await f.run("prepare_plan");
    f.set({ ...f.latest(), proposal: { id: "edit", version: f.latest().version, action: "save", draft: { node: "outline", value: f.latest().outline } } });
    const result = await f.run("apply", "outline", { proposalId: "edit" });
    expect(result.executionGoal).toBeUndefined(); expect(f.search).not.toHaveBeenCalled();
  });
  it("publishes real persisted stage snapshots without a second claim", async () => {
    const f = fixture(), events: ResearchRuntime[] = [];
    const result = await f.service.execute(f.actor, f.session, C.GuidedResearchRuntimeCommand.parse({ sessionId: f.session.sessionId, requestId: "stream-plan", expectedVersion: 0, node: "brief", action: "prepare_plan" }), event => {
      if (event.type === "snapshot" || event.type === "result") events.push(structuredClone(event.state));
    });
    expect(f.claim).toHaveBeenCalledTimes(1);
    expect(new Set(events.map(event => event.version))).toEqual(new Set([result.version]));
    for (const event of events.filter(event => event.busy)) expect(f.writes.some(write => write.version === event.version && write.revision === event.revision && write.currentNode === event.currentNode && write.executionGoal === event.executionGoal)).toBe(true);
    expect(events.some(event => event.currentNode === "directions" && !event.generatedNodes.includes("directions"))).toBe(true);
    expect(events.at(-1)?.busy).toBe(false); expect(events.at(-1)?.currentNode).toBe("outline");
    expect(result.activity?.some(event => event.stage === "planning" && event.status === "succeeded")).toBe(true);
  });

  it.each([false, true])("does not complete failed tasks from retained sources or a legacy partial report (partial=%s)", async partial => {
    const f = fixture(); await f.run("prepare_plan"); await f.run("generate_report", "outline");
    const saved = f.latest(), ids = saved.sources.map(source => source.id);
    f.set({ ...saved, tasks: saved.tasks.map(task => ({ ...task, status: "failed" as const, errorCode: "RESEARCH_SEARCH_UNAVAILABLE" })), completed: partial, reportPartial: partial, report: partial ? saved.report : null });
    f.search.mockRejectedValue(new Error("controlled unavailable search"));
    const calls = f.model.complete.mock.calls.length;
    const result = await f.run("retry", "report");
    expect(result.errorCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE"); expect(result.completed).toBe(false);
    expect(result.currentNode).toBe("research"); expect(result.sources.map(source => source.id)).toEqual(ids);
    expect(f.model.complete).toHaveBeenCalledTimes(calls);
    if (partial) { expect(result.report).toBeNull(); expect(result.reportPrevious?.partial).toBe(true); expect(result.reportPrevious?.report).toEqual(saved.report); }
  });

  it("archives the old report and clears its completed timeline before fresh source preparation publishes", async () => {
    const f = fixture(); await f.run("prepare_plan"); await f.run("generate_report", "outline");
    const previous = f.latest(); expect(previous.reportTimeline?.every(step => step.status === "completed")).toBe(true);
    let unblock!: () => void, reached!: () => void;
    const blocked = new Promise<void>(resolve => { unblock = resolve; });
    const entered = new Promise<void>(resolve => { reached = resolve; });
    const complete = f.model.complete.getMockImplementation()!;
    f.model.complete.mockImplementation(async input => { reached(); await blocked; return complete(input); });
    const offset = f.writes.length, pending = f.run("generate_report", "report");
    try {
      await entered;
      const fresh = f.writes.slice(offset); expect(fresh.length).toBeGreaterThan(0);
      expect(fresh.every(state => !state.reportTimeline?.some(step => step.status === "completed"))).toBe(true);
      expect(fresh[0]?.completed).toBe(false);
      expect(fresh[0]?.reportPrevious?.report).toEqual(previous.report);
      expect(fresh[0]?.sources).toEqual(previous.sources);
    } finally { unblock(); await pending; }
  });

});
