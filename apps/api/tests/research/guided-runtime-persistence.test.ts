import { GUIDED_RUNTIME_SERVICE } from "../../src/application/research/guided-runtime-ports";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { research as C } from "@repo/contracts";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgGuidedResearchSessionRepository } from "../../src/infrastructure/research/pg-guided-research-session-repository";
import { PgGuidedRuntimeStore } from "../../src/infrastructure/research/pg-guided-runtime-store";
import { GuidedRuntimeService, initialRuntime } from "../../src/application/research/guided-runtime-service";
import type { ModelCallPort } from "../../src/application/agent-run/ports";
import type { RuntimeActor, RuntimeCommand, ResearchRuntime } from "../../src/application/research/guided-runtime-ports";
const orgId = toOrgId("org-research-runtime-2775");
const userId = "research-owner";
const brief = { topic: "Storage policy", goal: "Compare entry options", region: "EU", focus: "Grid", timeRange: "2026" };
let db: PgDatabase;
let app: NestExpressApplication;
let base: string;
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
let session: CSession;
type CSession = import("zod").z.infer<typeof C.GuidedResearchSession>;
let actor: RuntimeActor;
let service: GuidedRuntimeService;
let state: ResearchRuntime;
let calls: string[];
let seenBriefs: unknown[];
let failSearch: boolean;
let badCitation: boolean;
let searchCalls: number;
let proposedAction: "save" | "start" | "confirm" | "complete";
let releaseModel: (() => void) | undefined;
let blockModel: boolean;
let failModelNode: string | undefined;
const model: ModelCallPort = { complete: async (input) => {
  if (blockModel) { blockModel = false; await new Promise<void>((resolve) => { releaseModel = resolve; }); }
  const context = JSON.parse(input.user);
  const node = input.system.includes('Create a concrete web research plan') ? "research" : /Generate the (\w+) step/.exec(input.system)?.[1] ?? context.targetNode;
  calls.push(node);
  if (node === failModelNode) throw new Error("model unavailable");
  seenBriefs.push(context.brief);
  let value: unknown = brief;
  if (node === "directions") value = [{ id: "d1", title: "Policy", description: "Grid rules", enabled: true, order: 0 }];
  if (node === "outline") value = [{ id: "o1", title: "Policy findings", questions: ["What rules apply?"], enabled: true, order: 0 }];
  if (node === "research") value = { tasks: [{ sectionId: "o1", query: "European grid storage policy official" }] };
  if (node === "report") value = { title: "Findings", summary: "Limited to the available source", sections: [{ sectionId: "o1", body: "The retrieved policy explains the grid rules.", sourceIds: [badCitation ? "fabricated" : context.sources[0].id] }] };
  if (context.targetNode) value = { assistantMessage: "Proposed revision", value: node === "research" ? context.sources.map((source: {id: string;decision: string}) => ({ id: source.id, decision: proposedAction === "complete" ? "accepted" : source.decision })) : value, action: proposedAction };
  return { text: JSON.stringify(value) };
} };
const search = { search: async () => { searchCalls++; if (failSearch) throw new Error("provider unavailable"); return [{ title: "Official policy", url: "https://energy.ec.europa.eu/topics/energy-storage_en", content: "A policy source returned by the controlled search test double." }]; } };
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); db = new PgDatabase(appConfig());
  const { createApp } = await import("../../src/main"); app = await createApp(); await app.listen(0); base = await app.getUrl();
}, 120000);
afterAll(async () => { await app?.close(); await resetOrgs(orgId); await db?.close(); });
beforeEach(async () => {
  await resetOrgs(orgId);
  const fixture = await seedOrg({ orgId, projectId: "project-runtime-2775" });
  await addOrgMember(orgId, userId, "consultant", fixture.teams.energy!);
  const repo = new PgGuidedResearchSessionRepository(db);
  await repo.create({ orgId, ownerUserId: userId, title: brief.topic, tags: [], idempotencyKey: randomUUID(), collaboratorUserIds: [], brief });
  const result = await db.withTenant(orgId, (tx) => tx.query<{ id: string }>("SELECT id FROM guided_research_sessions WHERE org_id=$1", [orgId]));
  const sessionId = result.rows[0]!.id;
  session = C.GuidedResearchSession.parse({ sessionId, title: brief.topic, brief, stage: "brief", resumeStage: "brief", status: "active", progress: 0, sourceCount: 0, reportId: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  actor = { orgId, userId, sessionId };
  service = new GuidedRuntimeService(new PgGuidedRuntimeStore(db), model, search, { provider: "test", id: "test-model" });
  state = await service.get(actor, session); calls = []; seenBriefs = []; failSearch = false; badCitation = false; searchCalls = 0; blockModel = false; proposedAction = "save"; releaseModel = undefined; failModelNode = undefined;
});
async function run(action: RuntimeCommand["action"], extra: Partial<RuntimeCommand> = {}) {
  state = await service.execute(actor, session, { sessionId: session.sessionId, node: state.currentNode, expectedVersion: state.version, requestId: randomUUID(), action, ...extra });
  return state;
}
async function reachResearch() { for (const node of ["brief", "directions", "outline"] as const) { expect(state.currentNode).toBe(node); await run("confirm"); expect(state.errorCode).toBeNull(); } }
describe("durable research runtime with real PostgreSQL and controlled provider doubles", () => {
  it("imports old checkpoints without erasing their drafts or completed record", () => {
    const date = new Date().toISOString();
    const legacy = C.GuidedResearchSession.parse({ ...session, stage: "report", resumeStage: "report", status: "completed", reportId: "old-report",
      directions: { candidateVersion: 2, confirmedVersion: 2, versions: [{ version: 2, createdAt: date, confirmedAt: date, items: [{ id: "old-d", title: "Saved direction", description: "Saved scope", enabled: true, order: 0 }] }] },
      outline: { candidateVersion: 3, confirmedVersion: 3, versions: [{ version: 3, createdAt: date, confirmedAt: date, items: [{ id: "old-o", title: "Saved outline", questions: ["Saved question?"], enabled: true, order: 0 }] }] },
    });
    const migrated = initialRuntime(legacy);
    expect(migrated.currentNode).toBe("research"); expect(migrated.directions[0]?.title).toBe("Saved direction");
    expect(migrated.outline[0]?.title).toBe("Saved outline"); expect(migrated.legacyCheckpoint).toEqual(legacy);
    expect(migrated.sources).toEqual([]); expect(migrated.report).toBeNull(); expect(migrated.generatedNodes).toEqual([]);
  });
  it("uses and persists unsaved editor changes before calling the model", async () => {
    const edited = { ...brief, topic: "New research topic" };
    await run("generate", { draft: { node: "brief", value: edited } });
    expect(seenBriefs[0]).toEqual(edited);
  });
  it("serves authorized runtime commands over HTTP and rejects cross-step payloads", async () => {
    const path = `${base}/research/guided-sessions/${actor.sessionId}/runtime`;
    const headers = { "content-type": "application/json", "x-kernel-test-principal": `${userId}:${orgId}` };
    const loaded = await fetch(path, { headers }); expect(loaded.status).toBe(200);
    expect(C.GuidedResearchRuntime.parse(await loaded.json()).sessionId).toBe(actor.sessionId);
    const denied = await fetch(path, { headers: { ...headers, "x-kernel-test-principal": `outsider:${orgId}` } }); expect(denied.status).toBe(404);
    const command = { sessionId: actor.sessionId, node: "brief", action: "save", expectedVersion: state.version, requestId: randomUUID(), draft: { node: "brief", value: brief } };
    const saved = await fetch(`${path}/commands`, { method: "POST", headers, body: JSON.stringify(command) }); expect(saved.status).toBe(201);
    expect(C.GuidedResearchRuntime.parse(await saved.json()).version).toBe(state.version + 1);
    const invalid = await fetch(`${path}/commands`, { method: "POST", headers, body: JSON.stringify({ ...command, node: "report" }) }); expect(invalid.status).toBe(400);
  });
  it("fences an expired writer after a new command claims the session", async () => {
    const store = new PgGuidedRuntimeStore(db);
    const firstCommand: RuntimeCommand = { sessionId: actor.sessionId, node: "brief", action: "generate", expectedVersion: state.version, requestId: "expired" };
    const first = await store.claim(actor, firstCommand, "first");
    await db.withTenant(orgId, (tx) => tx.query(`UPDATE guided_research_runtime SET state=jsonb_set(state,'{leaseUntil}','"2000-01-01T00:00:00Z"') WHERE org_id=$1 AND session_id=$2`, [orgId,actor.sessionId]));
    const second = await store.claim(actor, { ...firstCommand, requestId: "replacement", expectedVersion: first.state.version }, "second");
    await expect(store.write(actor, firstCommand.requestId, first.state, true)).rejects.toMatchObject({ reasonCode: "RESEARCH_GRAPH_VERSION_CONFLICT" });
    expect((await service.get(actor, session)).version).toBe(second.state.version);
  });
  it("calls a model for every step, persists sources and reports, and recovers in another service instance", async () => {
    await reachResearch();
    expect(state.tasks[0]?.status).toBe("succeeded");
    const sourceId = state.sources[0]!.id;
    await run("complete", { draft: { node: "research", value: [{ id: sourceId, decision: "accepted" }] } });
    const reviewed = { ...state.report!, summary: "Reviewed evidence summary" };
    await run("complete", { draft: { node: "report", value: reviewed } });
    expect(state.report).toEqual(reviewed);
    expect(state.errorCode).toBeNull(); expect(state.completed).toBe(true); expect(calls).toEqual(C.ResearchNode.options);
    const restored = await new GuidedRuntimeService(new PgGuidedRuntimeStore(db), model, search).get(actor, session);
    expect(restored).toEqual(state); expect(restored.report!.sections[0]!.sourceIds).toEqual([sourceId]);
  });
  it("reconfirms a historical edited draft and regenerates downstream results", async () => {
    await reachResearch();
    const edited = { ...brief, topic: "Revised scope" };
    await run("confirm", { node: "brief", draft: { node: "brief", value: edited } });
    expect(state.errorCode).toBeNull(); expect(state.currentNode).toBe("directions");
    expect(seenBriefs.at(-1)).toEqual(edited);
    expect(state.outline).toEqual([]); expect(state.sources).toEqual([]); expect(state.tasks).toEqual([]);
    expect(state.generatedNodes).toEqual(["brief", "directions"]);
    await run("confirm", { node: "brief" });
    expect(state.errorCode).toBe("RESEARCH_NODE_MISMATCH");
  });
  it("persists the next step before generation and retries a failed model without reconfirming", async () => {
    failModelNode = "directions";
    const command: RuntimeCommand = { sessionId: actor.sessionId, node: "brief", action: "confirm", expectedVersion: state.version, requestId: randomUUID() };
    state = await service.execute(actor, session, command);
    expect(state.currentNode).toBe("directions"); expect(state.errorCode).toBe("RESEARCH_WORKFLOW_UNAVAILABLE");
    expect((await service.get(actor, session)).currentNode).toBe("directions");
    await service.execute(actor, session, command);
    expect(calls).toEqual(["brief", "directions"]);
    failModelNode = undefined; await run("retry");
    expect(state.currentNode).toBe("directions"); expect(state.errorCode).toBeNull();
    expect(calls).toEqual(["brief", "directions", "directions"]);
  });
  it("exposes the destination loading state while the confirmation model request is pending", async () => {
    await run("generate"); blockModel = true;
    const pending = run("confirm");
    await expect.poll(() => Boolean(releaseModel)).toBe(true);
    try {
      const loading = await service.get(actor, session);
      expect(loading.currentNode).toBe("directions"); expect(loading.busy).toBe(true);
      expect(loading.availableNodes).toEqual(["brief", "directions"]);
    } finally { releaseModel!(); await pending; }
    expect(state.currentNode).toBe("directions"); expect(state.busy).toBe(false);
  });
  it("does not confirm research without completed searches and included sources", async () => {
    await reachResearch();
    await run("remove_source", { sourceId: state.sources[0]!.id });
    await run("complete"); expect(state.errorCode).toBe("RESEARCH_SOURCES_REQUIRED");
    expect(state.currentNode).toBe("research"); expect(calls).not.toContain("report");
    await run("generate");
    await run("complete"); expect(state.errorCode).toBe("RESEARCH_TASKS_INCOMPLETE");
  });
  it("includes new and legacy pending evidence without accepting excluded sources", async () => {
    await reachResearch();
    expect(state.sources[0]!.decision).toBe("accepted");
    await run("save", { draft: { node: "research", value: [{ id: state.sources[0]!.id, decision: "pending" }] } });
    await run("complete");
    expect(state.errorCode).toBeNull(); expect(state.currentNode).toBe("report");
    expect(state.sources[0]!.decision).toBe("accepted");
    await run("remove_source", { node: "research", sourceId: state.sources[0]!.id });
    expect(state.report).toBeNull(); expect(state.currentNode).toBe("research");
    await run("complete", { draft: { node: "research", value: [{ id: state.sources[0]!.id, decision: "pending" }] } });
    expect(state.errorCode).toBe("RESEARCH_SOURCES_REQUIRED"); expect(state.sources[0]!.decision).toBe("excluded");
  });
  it("persists removals across retries and restores an explicitly re-added URL without duplicate evidence", async () => {
    await reachResearch();
    const source = state.sources[0]!;
    await run("remove_source", { sourceId: source.id });
    // A previously failed task returning the same URL must not resurrect the removal.
    await db.withTenant(orgId, (tx) => tx.query(`UPDATE guided_research_runtime SET state=jsonb_set(state,'{tasks,0,status}','"failed"') WHERE org_id=$1 AND session_id=$2`, [orgId, actor.sessionId]));
    await run("retry");
    expect(state.sources).toHaveLength(1); expect(state.sources[0]!.decision).toBe("excluded");
    const before = searchCalls;
    await run("add_source", { sourceUrl: source.url + "#section" });
    expect(state.sources).toHaveLength(1); expect(state.sources[0]!.decision).toBe("accepted"); expect(searchCalls).toBe(before);
    await run("add_source", { sourceUrl: source.url });
    expect(state.sources).toHaveLength(1); expect(state.tasks).toHaveLength(1);
    expect((await service.get(actor, session)).sources).toEqual(state.sources);
  });
  it("adds only matching retrieved URL evidence with succeeded provenance and idempotent replay", async () => {
    await reachResearch(); await run("complete");
    const url = "https://example.org/additional-policy";
    let additions = 0;
    service = new GuidedRuntimeService(new PgGuidedRuntimeStore(db), model, { search: async (query) => {
      additions++; expect(query).toBe(url);
      return [{ title: "Additional policy", url: url + "#findings", content: "Retrieved evidence from the search boundary." }];
    } });
    const command: RuntimeCommand = { sessionId: actor.sessionId, node: "research", action: "add_source", sourceUrl: url, expectedVersion: state.version, requestId: randomUUID() };
    state = await service.execute(actor, session, command);
    expect(state.errorCode).toBeNull(); expect(state.report).toBeNull(); expect(state.currentNode).toBe("research");
    const added = state.sources.find((item) => item.url === url)!;
    expect(added.decision).toBe("accepted");
    expect(state.tasks.find((task) => task.id === added.taskId)).toMatchObject({ status: "succeeded", sectionId: "o1", attempts: 1 });
    expect(await service.execute(actor, session, command)).toEqual(state); expect(additions).toBe(1);
    await expect(service.execute(actor, session, { ...command, requestId: randomUUID() })).rejects.toMatchObject({ reasonCode: "RESEARCH_GRAPH_VERSION_CONFLICT" });
  });
  it("does not let manually added evidence bypass incomplete planned searches", async () => {
    await run("confirm"); await run("confirm"); failSearch = true; await run("confirm");
    expect(state.tasks[0]!.status).toBe("failed");
    const url = "https://example.org/manual-evidence";
    service = new GuidedRuntimeService(new PgGuidedRuntimeStore(db), model, { search: async () => [{ title: "Evidence", url, content: "Retrieved manual source." }] });
    await run("add_source", { sourceUrl: url });
    expect(state.errorCode).toBeNull(); expect(state.sources[0]!.decision).toBe("accepted");
    await run("complete");
    expect(state.errorCode).toBe("RESEARCH_TASKS_INCOMPLETE"); expect(state.report).toBeNull();
  });
  it.each(["unmatched", "empty", "unavailable"])("keeps report and task state intact after %s additions", async (failure) => {
    await reachResearch(); await run("complete");
    const before = structuredClone(state);
    service = new GuidedRuntimeService(new PgGuidedRuntimeStore(db), model, { search: async () => {
      if (failure === "unavailable") throw new Error("provider failed");
      return [{ title: "Result", url: failure === "unmatched" ? "https://example.org/other" : "https://example.org/policy", content: failure === "empty" ? "  " : "Evidence" }];
    } });
    await run("add_source", { node: "research", sourceUrl: "https://example.org/policy" });
    expect(state.errorCode).toBe(failure === "unavailable" ? "RESEARCH_SEARCH_UNAVAILABLE" : "RESEARCH_SOURCE_NOT_FOUND");
    expect(state.tasks).toEqual(before.tasks); expect(state.sources).toEqual(before.sources); expect(state.report).toEqual(before.report); expect(state.currentNode).toBe("report");
  });
  it("persists model messages and rejects stale proposals", async () => {
    await run("message", { message: "Narrow the brief" });
    expect(state.messages.map((item) => item.role)).toEqual(["user", "assistant"]);
    const proposal = state.proposal!;
    await run("save", { draft: { node: "brief", value: brief } });
    await run("apply", { proposalId: proposal.id });
    expect(state.errorCode).toBe("RESEARCH_GRAPH_VERSION_CONFLICT");
    expect((await service.get(actor, session)).messages).toHaveLength(2);
  });
  it("proposes real research through conversation but executes only after approval", async () => {
    await reachResearch(); await run("generate"); searchCalls = 0; proposedAction = "start";
    await run("message", { message: "Start researching this outline" });
    expect(state.proposal?.action).toBe("start"); expect(searchCalls).toBe(0); expect(state.tasks[0]?.status).toBe("pending");
    await run("apply", { proposalId: state.proposal!.id });
    expect(state.errorCode).toBeNull(); expect(searchCalls).toBe(1); expect(state.tasks[0]?.status).toBe("succeeded");
  });
  it("advances all five steps through model-backed conversation and approved commands", async () => {
    for (const node of ["brief", "directions", "outline"] as const) {
      expect(state.currentNode).toBe(node); proposedAction = "confirm";
      await run("message", { message: "Generate this step and propose continuing" });
      expect(state.currentNode).toBe(node);
      await run("apply", { proposalId: state.proposal!.id }); expect(state.errorCode).toBeNull();
    }
    proposedAction = "start"; await run("message", { message: "Start the research" });
    await run("apply", { proposalId: state.proposal!.id });
    proposedAction = "complete"; await run("message", { message: "Accept the retrieved source and continue" });
    await run("apply", { proposalId: state.proposal!.id }); expect(state.currentNode).toBe("report");
    await run("message", { message: "Write the report and complete the research" });
    await run("apply", { proposalId: state.proposal!.id });
    expect(state.errorCode).toBeNull(); expect(state.completed).toBe(true);
    expect(new Set(calls)).toEqual(new Set(C.ResearchNode.options));
    expect((await service.get(actor, session)).messages).toHaveLength(12);
  });
  it("persists failed searches and retries without fabricating sources", async () => {
    failSearch = true; await run("confirm"); await run("confirm"); await run("confirm");
    expect(state.errorCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE"); expect(state.sources).toEqual([]); expect(state.tasks[0]?.status).toBe("failed");
    failSearch = false; await run("retry"); expect(state.errorCode).toBeNull(); expect(state.tasks[0]?.attempts).toBe(2); expect(searchCalls).toBe(2);
  });
  it("rejects nonexistent sources, unknown citations and cross-node drafts", async () => {
    await reachResearch(); await run("start");
    await run("save", { draft: { node: "research", value: [{ id: "foreign", decision: "accepted" }] } });
    expect(state.errorCode).toBe("RESEARCH_CONTENT_REFERENCE_INVALID");
    await run("save", { draft: { node: "research", value: [{ id: state.sources[0]!.id, decision: "accepted" }] } });
    badCitation = true; await run("complete");
    expect(state.errorCode).toBe("RESEARCH_CONTENT_REFERENCE_INVALID"); expect(state.report).toBeNull();
    expect(C.GuidedResearchRuntimeCommand.safeParse({ sessionId: actor.sessionId, node: "brief", action: "save", requestId: "cross", expectedVersion: 0, draft: { node: "report", value: {} } }).success).toBe(false);
  });
  it("denies another user before any model call and serializes concurrent requests", async () => {
    await expect(service.get({ ...actor, userId: "not-a-collaborator" }, session)).rejects.toMatchObject({ reasonCode: "RESEARCH_NOT_FOUND" });
    expect(calls).toEqual([]);
    blockModel = true;
    const command: RuntimeCommand = { sessionId: actor.sessionId, node: "brief", action: "confirm", requestId: randomUUID(), expectedVersion: state.version };
    const first = service.execute(actor, session, command);
    await expect.poll(() => Boolean(releaseModel)).toBe(true);
    await expect(service.execute(actor, session, { ...command, requestId: randomUUID() })).rejects.toMatchObject({ reasonCode: "RESEARCH_WORKFLOW_BUSY" });
    releaseModel!(); state = await first;
    const replay = await service.execute(actor, session, command);
    expect(replay.version).toBe(state.version); expect(calls).toEqual(["brief", "directions"]);
    await expect(service.execute(actor, session, { ...command, requestId: randomUUID() })).rejects.toMatchObject({ reasonCode: "RESEARCH_GRAPH_VERSION_CONFLICT" });
    expect(calls).toEqual(["brief", "directions"]);
    await expect(service.execute(actor, session, { ...command, message: "different input" })).rejects.toMatchObject({ reasonCode: "RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH" });
  });
});

describe("report streaming and explicit partial evidence", () => {
  it("persists the first provider delta before completion and survives observer disconnect/replay", async () => {
    await reachResearch();
    let release!: () => void;
    let started!: () => void;
    const first = new Promise<void>((resolve) => { started = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let streamCalls = 0;
    const streamed: ModelCallPort = { complete: model.complete, completeStream: async (input, delta) => {
      streamCalls++;
      const answer = await model.complete(input);
      await delta(answer.text.slice(0, 35)); started(); await blocked;
      await delta(answer.text.slice(35)); return answer;
    } };
    const runtime = new GuidedRuntimeService(new PgGuidedRuntimeStore(db), model, search, { provider: "test", id: "test-model" }, streamed);
    const command: RuntimeCommand = { sessionId: actor.sessionId, node: "research", action: "complete", expectedVersion: state.version, requestId: randomUUID() };
    const events: string[] = [];
    const execution = runtime.execute(actor, session, command, (event) => { events.push(event.type); if (event.type === "report_delta") throw new Error("socket closed"); });
    try {
      await first;
      const snapshot = await runtime.get(actor, session);
      expect(snapshot.currentNode).toBe("report"); expect(snapshot.busy).toBe(true);
      expect(snapshot.report).toBeNull(); expect(snapshot.reportStream?.text).toHaveLength(35);
      expect(snapshot.reportStream?.sequence).toBe(1);
      expect(await runtime.execute(actor, session, command)).toEqual(snapshot);
      expect(streamCalls).toBe(1);
    } finally { release(); }
    state = await execution;
    expect(state.errorCode).toBeNull(); expect(state.report?.title).toBe("Findings");
    expect(state.reportStream).toBeNull(); expect(events[0]).toBe("snapshot"); expect(events.at(-1)).toBe("result");
  });
  it("serves an authorized SSE observer and keeps generating after the socket closes", async () => {
    await reachResearch();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const streamed: ModelCallPort = { complete: model.complete, completeStream: async (input, delta) => {
      const answer = await model.complete(input); await delta(answer.text.slice(0, 35)); await blocked;
      await delta(answer.text.slice(35)); return answer;
    } };
    const runtime = new GuidedRuntimeService(new PgGuidedRuntimeStore(db), model, search, { provider: "test", id: "test-model" }, streamed);
    const routeService = app.get<GuidedRuntimeService>(GUIDED_RUNTIME_SERVICE);
    const spy = vi.spyOn(routeService, "execute").mockImplementation((...args) => runtime.execute(...args));
    const path = `${base}/research/guided-sessions/${actor.sessionId}/runtime/commands/stream`;
    const command = { sessionId: actor.sessionId, node: "research", action: "complete", expectedVersion: state.version, requestId: randomUUID() };
    const headers = { "content-type": "application/json", "x-kernel-test-principal": `${userId}:${orgId}` };
    try {
      const denied = await fetch(path, { method: "POST", headers: { ...headers, "x-kernel-test-principal": `outsider:${orgId}` }, body: JSON.stringify(command) });
      expect(denied.status).toBe(404); expect(spy).not.toHaveBeenCalled();
      const response = await fetch(path, { method: "POST", headers, body: JSON.stringify(command) });
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      const reader = response.body!.getReader(); const decoder = new TextDecoder(); let frames = "";
      while (!frames.includes('"type":"report_delta"')) {
        const item = await reader.read(); if (item.done) throw new Error("stream ended before delta"); frames += decoder.decode(item.value);
      }
      expect((await runtime.get(actor, session)).report).toBeNull();
      await reader.cancel(); release();
      await expect.poll(async () => (await runtime.get(actor, session)).busy, { timeout: 10000 }).toBe(false);
      expect((await runtime.get(actor, session)).report?.title).toBe("Findings");
    } finally { release(); spy.mockRestore(); }
  });
  it.each(["transport", "citation"])("keeps incomplete report text without accepting a %s failure", async (failure) => {
    await reachResearch();
    badCitation = failure === "citation";
    const streamed: ModelCallPort = { complete: model.complete, completeStream: async (input, delta) => {
      const answer = await model.complete(input); await delta(answer.text);
      if (failure === "transport") throw new Error("disconnected upstream");
      return answer;
    } };
    const runtime = new GuidedRuntimeService(new PgGuidedRuntimeStore(db), model, search, { provider: "test", id: "test-model" }, streamed);
    const result = await runtime.execute(actor, session, { sessionId: actor.sessionId, node: "research", action: "complete", expectedVersion: state.version, requestId: randomUUID() });
    expect(result.errorCode).toBe(failure === "citation" ? "RESEARCH_CONTENT_REFERENCE_INVALID" : "RESEARCH_WORKFLOW_UNAVAILABLE");
    expect(result.report).toBeNull(); expect(result.completed).toBe(false); expect(result.generatedNodes).not.toContain("report");
    expect(result.reportStream?.status).toBe("failed"); expect(result.reportStream?.text).toContain("Findings");
    expect((await runtime.get(actor, session)).reportStream).toEqual(result.reportStream);
  });
  it("requires an explicit partial choice and retains evidence gaps through report completion", async () => {
    await reachResearch();
    await db.withTenant(orgId, (tx) => tx.query(`UPDATE guided_research_runtime SET state=jsonb_set(state,'{tasks}',(state->'tasks') || $3::jsonb) WHERE org_id=$1 AND session_id=$2`, [orgId,actor.sessionId,JSON.stringify([{ id: "failed-query", sectionId: "o1", query: "Missing source", status: "failed", attempts: 1, errorCode: "RESEARCH_SEARCH_UNAVAILABLE" }])]));
    state = await service.get(actor, session);
    await run("complete"); expect(state.errorCode).toBe("RESEARCH_TASKS_INCOMPLETE");
    await run("complete", { allowPartialResearch: true });
    expect(state.errorCode).toBeNull(); expect(state.currentNode).toBe("report"); expect(state.reportPartial).toBe(true);
    expect(state.tasks.some((task) => task.status === "failed")).toBe(true);
    await run("complete"); expect(state.completed).toBe(true); expect(state.reportPartial).toBe(true);
  });
  it.each(["pending", "running"])("never bypasses %s tasks with the partial option", async (status) => {
    await reachResearch();
    await db.withTenant(orgId, (tx) => tx.query(`UPDATE guided_research_runtime SET state=jsonb_set(state,'{tasks,0,status}',$3::jsonb) WHERE org_id=$1 AND session_id=$2`, [orgId,actor.sessionId,JSON.stringify(status)]));
    state = await service.get(actor, session);
    await run("complete", { allowPartialResearch: true });
    expect(state.errorCode).toBe("RESEARCH_TASKS_INCOMPLETE"); expect(state.report).toBeNull();
  });
});
