import type { NestExpressApplication } from "@nestjs/platform-express";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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
const model: ModelCallPort = { complete: async (input) => {
  if (blockModel) { blockModel = false; await new Promise<void>((resolve) => { releaseModel = resolve; }); }
  const context = JSON.parse(input.user);
  const node = input.system.includes('Create a concrete web research plan') ? "research" : /Generate the (\w+) step/.exec(input.system)?.[1] ?? context.targetNode;
  calls.push(node);
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
  state = await service.get(actor, session); calls = []; seenBriefs = []; failSearch = false; badCitation = false; searchCalls = 0; blockModel = false; proposedAction = "save"; releaseModel = undefined;
});
async function run(action: RuntimeCommand["action"], extra: Partial<RuntimeCommand> = {}) {
  state = await service.execute(actor, session, { sessionId: session.sessionId, node: state.currentNode, expectedVersion: state.version, requestId: randomUUID(), action, ...extra });
  return state;
}
async function reachResearch() { for (const node of ["brief", "directions", "outline"] as const) { expect(state.currentNode).toBe(node); await run("generate"); expect(state.errorCode).toBeNull(); await run("confirm"); } }
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
    await reachResearch(); await run("start");
    expect(state.tasks[0]?.status).toBe("succeeded");
    const sourceId = state.sources[0]!.id;
    await run("save", { draft: { node: "research", value: [{ id: sourceId, decision: "accepted" }] } });
    await run("complete"); await run("generate"); await run("complete");
    expect(state.errorCode).toBeNull(); expect(state.completed).toBe(true); expect(new Set(calls)).toEqual(new Set(C.ResearchNode.options));
    const restored = await new GuidedRuntimeService(new PgGuidedRuntimeStore(db), model, search).get(actor, session);
    expect(restored).toEqual(state); expect(restored.report!.sections[0]!.sourceIds).toEqual([sourceId]);
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
    await reachResearch(); proposedAction = "start";
    await run("message", { message: "Start researching this outline" });
    expect(state.proposal?.action).toBe("start"); expect(searchCalls).toBe(0); expect(state.tasks).toEqual([]);
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
    await reachResearch(); failSearch = true; await run("start");
    expect(state.errorCode).toBe("RESEARCH_SEARCH_PARTIAL_FAILURE"); expect(state.sources).toEqual([]); expect(state.tasks[0]?.status).toBe("failed");
    failSearch = false; await run("retry"); expect(state.errorCode).toBeNull(); expect(state.tasks[0]?.attempts).toBe(2); expect(searchCalls).toBe(2);
  });
  it("rejects nonexistent sources, unknown citations and cross-node drafts", async () => {
    await reachResearch(); await run("start");
    await run("save", { draft: { node: "research", value: [{ id: "foreign", decision: "accepted" }] } });
    expect(state.errorCode).toBe("RESEARCH_CONTENT_REFERENCE_INVALID");
    await run("save", { draft: { node: "research", value: [{ id: state.sources[0]!.id, decision: "accepted" }] } });
    await run("complete"); badCitation = true; await run("generate");
    expect(state.errorCode).toBe("RESEARCH_CONTENT_REFERENCE_INVALID"); expect(state.report).toBeNull();
    expect(C.GuidedResearchRuntimeCommand.safeParse({ sessionId: actor.sessionId, node: "brief", action: "save", requestId: "cross", expectedVersion: 0, draft: { node: "report", value: {} } }).success).toBe(false);
  });
  it("denies another user before any model call and serializes concurrent requests", async () => {
    await expect(service.get({ ...actor, userId: "not-a-collaborator" }, session)).rejects.toMatchObject({ reasonCode: "RESEARCH_NOT_FOUND" });
    expect(calls).toEqual([]);
    blockModel = true;
    const command: RuntimeCommand = { sessionId: actor.sessionId, node: "brief", action: "generate", requestId: randomUUID(), expectedVersion: state.version };
    const first = service.execute(actor, session, command);
    await expect.poll(() => Boolean(releaseModel)).toBe(true);
    await expect(service.execute(actor, session, { ...command, requestId: randomUUID() })).rejects.toMatchObject({ reasonCode: "RESEARCH_WORKFLOW_BUSY" });
    releaseModel!(); state = await first;
    const replay = await service.execute(actor, session, command);
    expect(replay.version).toBe(state.version); expect(calls).toHaveLength(1);
    await expect(service.execute(actor, session, { ...command, message: "different input" })).rejects.toMatchObject({ reasonCode: "RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH" });
  });
});
