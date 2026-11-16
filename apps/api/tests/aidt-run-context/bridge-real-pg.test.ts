import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AIDT_STAGE_IDENTITIES, AIDT_SUMMARY_STABLE_NAME, AidtContextReceipt, aidtContextSelectorJson, type AidtContextSelector } from "@repo/contracts/aidt-run-context";
import { executeQueuedRuns } from "../../src/application/agent-run/execute-run";
import type { ModelCallInput, ModelCallPort } from "../../src/application/agent-run/ports";
import type { AidtMessageAcceptancePort } from "../../src/application/aidt-run-context/ports";
import type { DatabasePort } from "../../src/application/ports/database.port";
import { removeNonWorkshopMember } from "../../src/application/project/remove-non-workshop-member";
import { authorize } from "../../src/application/identity/authorize";
import { discloseDecided, isDisclosed } from "../../src/application/security/permission-filter";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { DeepAgentModelProvider } from "../../src/infrastructure/agent-run/deep-agent-model-provider";
import { PgAidtRunContextStore } from "../../src/infrastructure/aidt-run-context/pg-aidt-run-context-store";
import { PgAidtRunContextProvider } from "../../src/infrastructure/aidt-run-context/pg-aidt-run-context-provider";
import { FileSkillStarterPackSource, REPO_SKILL_STARTER_PACK_ROOT } from "../../src/infrastructure/skill/file-skill-starter-pack-source";
import { PgChatMessageCommandRepository } from "../../src/infrastructure/chat/pg-chat-message-command-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgNonWorkshopMemberRepository } from "../../src/infrastructure/project/pg-non-workshop-member-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { asApp, ensureDatabase, migrateOnce } from "../support/db";
import { startAidtRecordingNative } from "../support/aidt-recording-native";
import { createBridgePgFixture } from "./support/real-pg-fixture";

/** Real PG + actual Deep adapter HTTP serialization. The loopback is not a model supplier. */
let db: PgDatabase, fixture: Awaited<ReturnType<typeof createBridgePgFixture>>;
let recorder: Awaited<ReturnType<typeof startAidtRecordingNative>>;
let store: PgAidtRunContextStore, contexts: PgAidtRunContextProvider, commands: PgChatMessageCommandRepository, runs: PgAgentRunRepository;
let pinned: Awaited<ReturnType<typeof fixture.mountApprovedSkill>>, agent: Awaited<ReturnType<typeof fixture.publishAgent>>;
const modelInputs: ModelCallInput[] = [], evidence: { name: string; facts: unknown }[] = [];
const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const humanText = "  合成学生原文，不是访谈。\n请追问一个问题：‘为什么？’ & <保留符号>  ";

beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); db = new PgDatabase(appConfig());
  recorder = await startAidtRecordingNative();
});
beforeEach(async () => {
  fixture = await createBridgePgFixture(db);
  pinned = await fixture.mountApprovedSkill("aidt-methods", "1.3.0", AIDT_STAGE_IDENTITIES[1].skill);
  agent = await fixture.publishAgent([pinned.versionId]);
  store = new PgAidtRunContextStore(db);
  contexts = new PgAidtRunContextProvider(db, new FileSkillStarterPackSource(REPO_SKILL_STARTER_PACK_ROOT), store, () => true);
  commands = new PgChatMessageCommandRepository(db, undefined, contexts);
  runs = new PgAgentRunRepository(db, null, store);
  modelInputs.length = 0; recorder.requests.length = 0; recorder.submissions.length = 0; recorder.resetControls();
});
afterEach(async () => { await fixture?.cleanup(); });
afterAll(async () => {
  await recorder?.close(); await db?.close();
  const output = process.env.AIDT_CONTEXT_EVIDENCE_FILE;
  if (output) {
    if (!isAbsolute(output)) throw new Error("ABSOLUTE_CONTEXT_EVIDENCE_PATH_REQUIRED");
    writeFileSync(output, JSON.stringify({ kind: "real-pg-actual-adapter-recording-transport", supplierCalls: 0, realSupplierE2E: false, evidence }, null, 2));
  }
});

function selector(): AidtContextSelector { return { schemaVersion: 1, purpose: "stage", projectId: fixture.projectId, stageId: 2, stageRevisions: [{ stageId: 1, revision: 1 }, { stageId: 2, revision: 1 }] }; }
function input(aidtContext: AidtContextSelector | undefined = selector()) { return { projectId: fixture.projectId, threadId: fixture.threadId, actorId: fixture.studentId,
  clientMessageId: randomUUID(), text: humanText, selectedAgentId: agent.agentId, messageId: `${fixture.prefix}-message-${randomUUID()}`, runId: `${fixture.prefix}-run-${randomUUID()}`, snapshot: agent,
  ...(aidtContext ? { aidtContext } : {}) }; }
async function acceptValue(repo: PgChatMessageCommandRepository, request: Parameters<PgChatMessageCommandRepository["accept"]>[1]) {
  const decision = await authorize({ repo: new PgIdentityRepository(db), ids: { next: randomUUID } }, { orgId: fixture.orgId, projectId: fixture.projectId, userId: fixture.studentId, object: { kind: "project", id: fixture.projectId }, action: "content.renameFile" });
  expect(decision.allowed).toBe(true);
  const disclosed = discloseDecided(await repo.accept(fixture.orgId, request), decision);
  if (!isDisclosed(disclosed)) throw new Error("AUTHORIZED_ACCEPTANCE_OUTCOME_REQUIRED");
  return disclosed.payload;
}
async function countRows() { return asApp(fixture.orgId, async s => {
  const result = await s.query<{ messages: string; runs: string; snapshots: string }>("SELECT (SELECT count(*) FROM chat_messages WHERE org_id=$1 AND author_kind='human') AS messages,(SELECT count(*) FROM agent_runs WHERE org_id=$1) AS runs,(SELECT count(*) FROM aidt_run_context_snapshots WHERE org_id=$1) AS snapshots", [fixture.orgId]);
  return result.rows[0];
}); }
async function execute(progress = false) {
  const deep = new DeepAgentModelProvider({ baseUrl: recorder.baseUrl, timeoutMs: 5000, pollIntervalMs: 5 });
  const model: ModelCallPort = { complete: async value => { modelInputs.push(value); return deep.complete(value); }, checkKernelHealth: () => deep.checkKernelHealth() };
  if (progress) model.completeWithProgress = async (value, onProgress, onDelta) => { modelInputs.push(value); return deep.completeWithProgress(value, onProgress, onDelta); };
  return executeQueuedRuns({ runs, model, aidtContexts: contexts, clock: { now: () => new Date().toISOString(), newStepId: randomUUID }, log: () => undefined }, { orgId: fixture.orgId });
}
async function receipt(runId: string) { return AidtContextReceipt.parse(await contexts.receipt({ orgId: fixture.orgId, userId: fixture.studentId }, runId)); }
async function revokeStudent() { return removeNonWorkshopMember({ identity: new PgIdentityRepository(db), ids: { next: randomUUID }, members: new PgNonWorkshopMemberRepository(db), provenance: new PgProvenanceRepository(db) }, { orgId: fixture.orgId, projectId: fixture.projectId, actorId: fixture.ownerId, userId: fixture.studentId }); }

describe("approved AIDT bridge: real database to actual adapter without supplier fees", () => {
  it("CTX-P01/N01/I03: atomic source snapshot reaches exact actual HTTP history slot; human remains exact", async () => {
    const request = { ...input(), context: { forged: fixture.markers.forged }, state: { teacherComment: fixture.markers.forged } };
    expect((await acceptValue(commands, request)).kind).toBe("created");
    const prepared = await receipt(request.runId);
    expect(prepared.application.state).toBe("prepared");
    expect(prepared.skillVersionId).toBe(pinned.versionId);
    await execute();
    expect(modelInputs).toHaveLength(1); expect(recorder.submissions).toHaveLength(1);
    const call = modelInputs[0]!, observer = call.referenceDispatchObserver!;
    expect(call.user).toBe(humanText);
    const material = call.history![observer.historyIndex]!;
    expect(material.content).toContain(fixture.markers.s1); expect(material.content).toContain(fixture.markers.s2);
    expect(material.content).not.toContain(fixture.markers.private); expect(material.content).not.toContain(fixture.markers.forged);
    const body = recorder.submissions[0]!.body as { input: { messages: { role: string; content: string }[] } };
    const actual = body.input.messages[(call.system.trim() ? 1 : 0) + observer.historyIndex]!;
    expect(actual).toMatchObject({ role: "user", content: material.content });
    expect(body.input.messages.at(-1)?.content).toBe(humanText);
    const applied = await receipt(request.runId);
    expect(applied.snapshotHash).toBe(prepared.snapshotHash);
    expect(applied.application.state).toBe("message-dispatch-observed");
    expect(applied.application.assembledContextHash).toBe(digest(actual.content));
    const row = await asApp(fixture.orgId, s => s.query<{ body: string }>("SELECT body FROM chat_messages WHERE org_id=$1 AND id=$2", [fixture.orgId, request.messageId]));
    expect(row.rows[0]?.body).toBe(humanText);
    evidence.push({ name: "CTX-P01/N01/I03", facts: { sourceRevisions: applied.stageRevisions, snapshotHash: applied.snapshotHash, actualMessageHash: digest(actual.content), sourceMarkerInActualSlot: true, forgedAndPrivateExcluded: true, humanExact: true, transportSubmissions: 1, ownTenantApprovedPackImport: pinned.ownTenantImport, platformLineageClaimed: false } });
  });

  it.each(["project", "org", "member", "admin-not-group-member", "revision", "stage", "pin", "pin-missing", "archived"] as const)("CTX-N02/N03/N04: %s rejection rolls back human/run/snapshot before any ModelCall", async problem => {
    const before = await countRows(), request = input();
    let orgId = fixture.orgId;
    if (problem === "project") request.aidtContext = { ...selector(), projectId: fixture.privateProjectId };
    if (problem === "org") orgId = fixture.otherOrgId;
    if (problem === "member") request.actorId = fixture.outsiderId;
    if (problem === "admin-not-group-member") request.actorId = fixture.importerId;
    if (problem === "revision") request.aidtContext = { ...selector(), stageRevisions: [{ stageId: 1, revision: 999999 }] };
    if (problem === "stage") request.aidtContext = { schemaVersion: 1, purpose: "stage", projectId: fixture.projectId, stageId: 1, stageRevisions: [{ stageId: 1, revision: 1 }] };
    if (problem === "pin") request.snapshot = { ...agent, skillVersionIds: [`${fixture.prefix}-unknown-pin`] };
    if (problem === "pin-missing") request.snapshot = { ...agent, skillVersionIds: [] };
    if (problem === "archived") await asApp(fixture.orgId, s => s.query("UPDATE projects SET status='archived' WHERE org_id=$1 AND id=$2", [fixture.orgId, fixture.projectId]));
    await expect(commands.accept(orgId, request)).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_NOT_AVAILABLE" });
    expect(await countRows()).toEqual(before); expect(modelInputs).toHaveLength(0); expect(recorder.submissions).toHaveLength(0);
    evidence.push({ name: `CTX-reject-${problem}`, facts: { humanRunSnapshotRowsUnchanged: true, modelCalls: 0, transportSubmissions: 0 } });
  });

  it("CTX-I01/I02: same selector replays frozen snapshot; same id changed selector conflicts without new rows", async () => {
    const request = input(); await commands.accept(fixture.orgId, request);
    const original = await receipt(request.runId), before = await countRows();
    await fixture.save(1, { initial: fixture.markers.next });
    expect((await acceptValue(commands, request)).kind).toBe("replay");
    expect(await receipt(request.runId)).toEqual(original);
    await expect(acceptValue(commands, { ...request, aidtContext: { ...selector(), stageRevisions: [{ stageId: 1, revision: 2 }, { stageId: 2, revision: 1 }] } })).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_CONFLICT" });
    expect(await countRows()).toEqual(before); expect(await receipt(request.runId)).toEqual(original);
    expect(recorder.submissions).toHaveLength(0);
    evidence.push({ name: "CTX-I01/I02", facts: { sameSnapshotReplayed: true, changedSourceConflict: true, additionalRows: 0, modelCalls: 0 } });
  });

  it("CTX-atomic: abort after actual snapshot insert rolls back the human, run marker and snapshot together", async () => {
    const before = await countRows();
    const aborting: AidtMessageAcceptancePort = { prepareIn: (...args) => contexts.prepareIn(...args), revalidateAcceptedIn: (...args) => contexts.revalidateAcceptedIn(...args), persistIn: async (...args) => { await contexts.persistIn(...args); throw new Error("OWNED_SYNTHETIC_ACCEPTANCE_ABORT"); } };
    await expect(new PgChatMessageCommandRepository(db, undefined, aborting).accept(fixture.orgId, input())).rejects.toThrow("OWNED_SYNTHETIC_ACCEPTANCE_ABORT");
    expect(await countRows()).toEqual(before); expect(recorder.submissions).toHaveLength(0);
    evidence.push({ name: "CTX-atomic-rollback", facts: { actualSnapshotInsertThenAbort: true, humanRunSnapshotRolledBackTogether: true, modelCalls: 0, sharedGrantsOrTriggersChanged: false } });
  });

  it("CTX-N05: real owner revocation after accepted snapshot blocks dispatch instead of using the old authorization", async () => {
    const request = input(); await commands.accept(fixture.orgId, request);
    expect((await revokeStudent()).removed).toBe(true);
    await execute();
    expect(modelInputs).toHaveLength(0); expect(recorder.submissions).toHaveLength(0);
    await expect(commands.accept(fixture.orgId, request)).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_NOT_AVAILABLE" });
    evidence.push({ name: "CTX-N05", facts: { realOwnerRemovalUsecase: true, oldAcceptanceCannotAuthorizeDispatch: true, modelCalls: 0 } });
  });

  it("CTX-N05 race: actual membership delete waits for atomic acceptance, then fresh dispatch authorization denies", async () => {
    let release!: () => void, prepared!: () => void, deletionStarted!: (pid: number) => void;
    const gate = new Promise<void>(resolve => { release = resolve; }), ready = new Promise<void>(resolve => { prepared = resolve; }), deletingPid = new Promise<number>(resolve => { deletionStarted = resolve; });
    const paused: AidtMessageAcceptancePort = { prepareIn: async (...args) => { const result = await contexts.prepareIn(...args); prepared(); await gate; return result; }, persistIn: (...args) => contexts.persistIn(...args), revalidateAcceptedIn: (...args) => contexts.revalidateAcceptedIn(...args) };
    const request = input(), accepting = new PgChatMessageCommandRepository(db, undefined, paused).accept(fixture.orgId, request);
    await Promise.race([ready, accepting.then(() => { throw new Error("EXPECTED_PREPARE_BARRIER"); })]);
    const ownerDb: DatabasePort = { async withTenant(orgId, work) { return db.withTenant(orgId, s => work({ async query<R>(sql: string, params?: readonly unknown[]) {
      if (/DELETE FROM general_project_members/u.test(sql)) {
        const pid = (await s.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0]!.pid;
        const result = s.query<R>(sql, params); deletionStarted(pid); return result;
      }
      return s.query<R>(sql, params);
    } })); }, async withoutTenant() { throw new Error("NO_GLOBAL_TEST_DATA_ACCESS"); }, async close() {} };
    const removing = removeNonWorkshopMember({ identity: new PgIdentityRepository(db), ids: { next: randomUUID }, members: new PgNonWorkshopMemberRepository(ownerDb), provenance: new PgProvenanceRepository(db) }, { orgId: fixture.orgId, projectId: fixture.projectId, actorId: fixture.ownerId, userId: fixture.studentId });
    let raceAssertion: unknown;
    try {
      const pid = await deletingPid;
      await expect.poll(async () => db.withTenant(fixture.orgId, async s => (await s.query<{ blocked: boolean }>("SELECT cardinality(pg_blocking_pids($1))>0 AS blocked", [pid])).rows[0]!.blocked)).toBe(true);
    } catch (error) { raceAssertion = error; } finally { release(); }
    const finished = await Promise.allSettled([accepting, removing]);
    if (raceAssertion) throw raceAssertion;
    for (const result of finished) if (result.status === "rejected") throw result.reason;
    expect((await removing).removed).toBe(true);
    await execute(); expect(modelInputs).toHaveLength(0); expect(recorder.submissions).toHaveLength(0);
    evidence.push({ name: "CTX-N05-real-lock-race", facts: { actualDeleteObservedBlockedOnAcceptedSourceLock: true, revocationThenCommitted: true, freshDispatchDenied: true, modelCalls: 0, noSharedGrantMutation: true } });
  });

  it("CTX-N03: matching stableName with different package bytes is rejected in a separate real tenant", async () => {
    const untrusted = await createBridgePgFixture(db);
    try {
      const pin = await untrusted.mountUntrustedSkill(AIDT_STAGE_IDENTITIES[1].skill);
      const wrongAgent = await untrusted.publishAgent([pin.versionId]);
      await expect(commands.accept(untrusted.orgId, { ...input(), projectId: untrusted.projectId, threadId: untrusted.threadId, actorId: untrusted.studentId,
        selectedAgentId: wrongAgent.agentId, snapshot: wrongAgent, aidtContext: { schemaVersion: 1, purpose: "stage", projectId: untrusted.projectId, stageId: 2, stageRevisions: [{ stageId: 2, revision: 1 }] } })).rejects.toMatchObject({ reasonCode: "AIDT_CONTEXT_NOT_AVAILABLE" });
      const rows = await asApp(untrusted.orgId, s => s.query<{ count: string }>("SELECT count(*) AS count FROM agent_runs WHERE org_id=$1", [untrusted.orgId]));
      expect(rows.rows[0]?.count).toBe("0"); expect(recorder.submissions).toHaveLength(0);
      evidence.push({ name: "CTX-untrusted-same-name", facts: { matchingStableNameInsufficient: true, actualPackageBytesRejected: true, acceptedRuns: 0, modelCalls: 0 } });
    } finally { await untrusted.cleanup(); }
  });

  it.each(["missing", "bad-hash"] as const)("CTX-fail-closed: marked run with %s snapshot cannot reach ModelCall", async anomaly => {
    const request = input();
    await db.withTenant(fixture.orgId, async s => {
      const prepared = await contexts.prepareIn(s, fixture.actor, selector(), { runId: request.runId, inputMessageId: request.messageId, skillVersionIds: agent.skillVersionIds, skillScope: agent.skillScope });
      await s.query("INSERT INTO chat_messages(id,org_id,thread_id,author_kind,author_id,body,client_message_id,requested_agent_id) VALUES($1,$2,$3,'human',$4,$5,$6::uuid,$7)", [request.messageId, fixture.orgId, fixture.threadId, fixture.studentId, humanText, request.clientMessageId, agent.agentId]);
      await s.query("INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,skill_scope,aidt_selector_hash) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'deep-agent','synthetic-recording-only','queued','general',$8)", [request.runId, fixture.orgId, fixture.threadId, request.messageId, agent.agentId, agent.agentVersionId, JSON.stringify([prepared.focusSkillVersionId]), prepared.selectorHash]);
      if (anomaly === "bad-hash") await s.query("INSERT INTO aidt_run_context_snapshots(org_id,run_id,project_id,thread_id,input_message_id,requested_by,selector_json,selector_hash,snapshot_json,snapshot_hash) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10)", [fixture.orgId, request.runId, fixture.projectId, fixture.threadId, request.messageId, fixture.studentId, aidtContextSelectorJson(prepared.snapshot.selector), prepared.selectorHash, JSON.stringify(prepared.snapshot), digest("deliberately invalid snapshot hash, fixture only")]);
    });
    await execute();
    expect(modelInputs).toHaveLength(0); expect(recorder.submissions).toHaveLength(0);
    const row = await asApp(fixture.orgId, s => s.query<{ status: string }>("SELECT status FROM agent_runs WHERE org_id=$1 AND id=$2", [fixture.orgId, request.runId]));
    expect(row.rows[0]?.status).toBe("failed");
    evidence.push({ name: `CTX-snapshot-${anomaly}`, facts: { malformedFixtureInsertedWithoutUpdatingImmutableRows: true, terminalFailed: true, modelCalls: 0, transportSubmissions: 0 } });
  });

  it("CTX-R01/R02: durable permission requeue retains accepted V1 when head changes, with no new human/run", async () => {
    const request = input(); await commands.accept(fixture.orgId, request);
    const original = await receipt(request.runId), before = await countRows();
    const first = await runs.claimQueued(fixture.orgId, 1); expect(first[0]?.kind).toBe("executable");
    await runs.markAwaitingToolPermission(fixture.orgId, request.runId, { toolName: "confirm_task_intent", argsSummary: "Synthetic current-task review" });
    const pending = await asApp(fixture.orgId, s => s.query<{ id: string }>("SELECT pending_permission_request_id::text AS id FROM agent_runs WHERE org_id=$1 AND id=$2", [fixture.orgId, request.runId]));
    await fixture.save(1, { initial: fixture.markers.next });
    expect(await runs.decidePermissionRequest(fixture.orgId, request.runId, pending.rows[0]!.id, "once", fixture.studentId)).toBe(true);
    const recovered = await new PgAgentRunRepository(db, null, new PgAidtRunContextStore(db)).claimQueued(fixture.orgId, 1);
    expect(recovered[0]?.kind).toBe("executable");
    if (recovered[0]?.kind !== "executable" || !recovered[0].run.aidtContext) throw new Error("EXPECTED_RESTORED_CLAIM");
    const recoveredContext = await contexts.resolve(fixture.orgId, { userId: fixture.studentId, projectId: fixture.projectId, threadId: fixture.threadId }, recovered[0].run.aidtContext);
    expect(recoveredContext.snapshotHash).toBe(original.snapshotHash);
    expect(recoveredContext.snapshot.modelReferenceBlock).toContain(fixture.markers.s1);
    expect(recoveredContext.snapshot.modelReferenceBlock).not.toContain(fixture.markers.next);
    expect(await countRows()).toEqual(before); expect(recorder.submissions).toHaveLength(0);
    evidence.push({ name: "CTX-R01/R02-PG-layer", facts: { acceptedSnapshotHash: original.snapshotHash, oldRevisionRetainedOnNewRepository: true, newHumanOrRun: false, realBrowserResumeTested: false, modelCalls: 0 } });
  });

  it("CTX-receipt: actual command-only same-run resume stays current when an earlier real dispatch fact arrives late", async () => {
    const request = input(); await commands.accept(fixture.orgId, request);
    recorder.interruptNextRun(); await execute(true);
    expect(recorder.submissions).toHaveLength(1);
    const first = await receipt(request.runId);
    expect(first.application.state).toBe("message-dispatch-observed");
    const events = await db.withTenant(fixture.orgId, s => store.eventsIn(s, fixture.orgId, request.runId));
    const oldDispatch = events.find(row => row.event.kind === "message-dispatch-observed")!;
    expect(oldDispatch).toBeTruthy();
    const pending = await asApp(fixture.orgId, s => s.query<{ status: string; id: string }>("SELECT status,pending_permission_request_id::text AS id FROM agent_runs WHERE org_id=$1 AND id=$2", [fixture.orgId, request.runId]));
    expect(pending.rows[0]?.status).toBe("awaiting_tool_permission");
    await fixture.save(1, { initial: fixture.markers.next });
    expect(await runs.decidePermissionRequest(fixture.orgId, request.runId, pending.rows[0]!.id, "once", fixture.studentId)).toBe(true);
    await execute(true);
    expect(recorder.submissions).toHaveLength(2); expect(modelInputs).toHaveLength(2);
    expect(recorder.submissions[1]!.threadId).toBe(recorder.submissions[0]!.threadId);
    const resumeBody = recorder.submissions[1]!.body as Record<string, unknown>;
    expect(resumeBody).toHaveProperty("command"); expect(resumeBody).not.toHaveProperty("input");
    const resumed = await receipt(request.runId);
    expect(resumed.snapshotHash).toBe(first.snapshotHash); expect(resumed.application.state).toBe("checkpoint-resume-observed");
    expect(resumed.application.inheritedMessageDispatchAttemptId).toBe(first.application.attemptId);
    expect(resumed.application.assembledContextHash).toBe(first.application.assembledContextHash);
    // This is a delayed duplicate of an observation that really occurred above, not a fabricated new dispatch.
    await contexts.append(fixture.orgId, request.runId, oldDispatch.event);
    expect(await receipt(request.runId)).toEqual(resumed);
    const call = modelInputs[1]!, block = call.history![call.referenceDispatchObserver!.historyIndex]!.content;
    expect(block).toContain(fixture.markers.s1); expect(block).not.toContain(fixture.markers.next);
    expect(await countRows()).toEqual({ messages: "1", runs: "1", snapshots: "1" });
    evidence.push({ name: "CTX-late-original-dispatch-after-actual-resume", facts: { oldActualDispatchAttempt: first.application.attemptId, actualResumeAttempt: resumed.application.attemptId, finalReceiptStillResume: true, inheritedOriginalHash: resumed.application.assembledContextHash, oldSnapshotUsed: true, remoteThreadUnchanged: true, resumeCommandWithoutNewInput: true, actualTransportSubmissions: 2, realSupplierOrBrowserResumeClaimed: false } });
  });

  it("CTX-S01: summary uses independent approved pin, exact selected history and explicit unsourced teacher/missing-stage gaps", async () => {
    const summary = await fixture.mountApprovedSkill("aidt-project-summary", "1.0.0", AIDT_SUMMARY_STABLE_NAME, fixture.summaryThreadId);
    const summaryAgent = await fixture.publishAgent([summary.versionId]);
    await fixture.save(1, { initial: fixture.markers.next });
    const selected: AidtContextSelector = { schemaVersion: 1, purpose: "summary", projectId: fixture.projectId, stageRevisions: [{ stageId: 1, revision: 2 }, { stageId: 2, revision: 1 }], historyRevisions: [{ stageId: 1, revision: 1 }] };
    const request = { ...input(selected), threadId: fixture.summaryThreadId, snapshot: summaryAgent, selectedAgentId: summaryAgent.agentId };
    await commands.accept(fixture.orgId, request); await execute();
    const call = modelInputs[0]!, block = call.history![call.referenceDispatchObserver!.historyIndex]!.content;
    expect(block).toContain(fixture.markers.s1); expect(block).toContain(fixture.markers.next); expect(block).not.toContain(fixture.markers.private);
    const applied = await receipt(request.runId);
    expect(applied.skillVersionId).toBe(summary.versionId); expect(applied.historyRevisions).toEqual([{ stageId: 1, revision: 1 }]);
    expect(applied.omissions).toEqual(expect.arrayContaining([{ kind: "teacher-comments-no-source" }, { kind: "missing", stageId: 3 }]));
    const stageMounts = await asApp(fixture.orgId, s => s.query<{ version_id: string }>("SELECT version_id FROM thread_skill_mounts WHERE org_id=$1 AND thread_id=$2 AND removed_at IS NULL", [fixture.orgId, fixture.threadId]));
    expect(stageMounts.rows.map(row => row.version_id)).toEqual([pinned.versionId]);
    evidence.push({ name: "CTX-S01", facts: { exactSummarySkillVersionId: summary.versionId, oldAndCurrentSelectedSourcesPresent: true, stagePinUnchanged: true, teacherCommentSourceAbsent: true, missingStagesExplicit: true, transportSubmissions: recorder.submissions.length } });
  });

  it("CTX-R03: S6 explicitly selected old S5 V2 remains the source when S5 head is V3", async () => {
    await fixture.save(5, { verificationQuestion: "Synthetic earlier question" });
    const old = await fixture.save(5, { verificationQuestion: `OLD_QUESTION_${fixture.prefix}`, beforeTestBelief: "Synthetic old belief", version: "Synthetic P1 text; not generated" });
    const questionSnapshot = JSON.stringify({ schemaVersion: 1, question: old.content.draft.fields.verificationQuestion, beforeTestBelief: "Synthetic old belief", verificationBasis: "Synthetic unverified observation", verificationLimits: "No real test", prototypeRef: "Synthetic P1 text; not generated", sourceStageRevision: old.revision });
    const sixth = await fixture.save(6, { questionSnapshot, version: "Synthetic P1 text; not generated", understandingChangeStatus: "insufficient", returnStep: "1", returnReason: "Synthetic uncertainty requires reviewing source", nextAction: "Student may choose a new observation" }, [{ stageId: 5, revision: old.revision }]);
    const head = await fixture.save(5, { verificationQuestion: `NEW_QUESTION_${fixture.prefix}`, version: "Synthetic P2 text; not generated" });
    const iterate = await fixture.mountApprovedSkill("aidt-methods", "1.3.0", AIDT_STAGE_IDENTITIES[5].skill, fixture.summaryThreadId);
    const iterateAgent = await fixture.publishAgent([iterate.versionId]);
    const selected: AidtContextSelector = { schemaVersion: 1, purpose: "stage", projectId: fixture.projectId, stageId: 6, stageRevisions: [{ stageId: 5, revision: old.revision }, { stageId: 6, revision: sixth.revision }] };
    const request = { ...input(selected), threadId: fixture.summaryThreadId, snapshot: iterateAgent, selectedAgentId: iterateAgent.agentId };
    await commands.accept(fixture.orgId, request); await execute();
    expect(modelInputs).toHaveLength(1);
    const call = modelInputs[0]!, block = call.history![call.referenceDispatchObserver!.historyIndex]!.content;
    expect(block).toContain(old.content.draft.fields.verificationQuestion); expect(block).toContain("Synthetic P1 text; not generated");
    expect(block).not.toContain(head.content.draft.fields.verificationQuestion); expect(block).not.toContain("Synthetic P2 text; not generated");
    expect((await receipt(request.runId)).stageRevisions).toEqual(selected.stageRevisions);
    expect((await fixture.stages.get(fixture.actor, 5)).stage).toEqual(head);
    expect((await fixture.stages.get(fixture.actor, 6)).stage).toEqual(sixth);
    evidence.push({ name: "CTX-R03", facts: { selectedS5Revision: old.revision, currentS5Revision: head.revision, oldQuestionAndLegacyPrototypeTextOnly: true, currentHeadExcludedFromActualModelSlot: true, sharedDraftsUnchanged: true, generatedPrototypeOrRealTestClaimed: false } });
  });

  it("ordinary Chat has no AIDT prepare/persist/revalidation, snapshot or receipt side effect", async () => {
    let aidtCalls = 0;
    const observed: AidtMessageAcceptancePort = { prepareIn: async (...args) => { aidtCalls++; return contexts.prepareIn(...args); }, persistIn: async (...args) => { aidtCalls++; return contexts.persistIn(...args); }, revalidateAcceptedIn: async (...args) => { aidtCalls++; return contexts.revalidateAcceptedIn(...args); } };
    const ordinary = new PgChatMessageCommandRepository(db, undefined, observed), request = input(undefined);
    delete request.aidtContext;
    await ordinary.accept(fixture.orgId, request); expect((await acceptValue(ordinary, request)).kind).toBe("replay");
    await execute();
    expect(aidtCalls).toBe(0); expect(modelInputs).toHaveLength(1); expect(modelInputs[0]!.referenceDispatchObserver).toBeUndefined();
    const rows = await asApp(fixture.orgId, s => s.query<{ marker: string | null; snapshots: string; applications: string }>("SELECT aidt_selector_hash AS marker,(SELECT count(*) FROM aidt_run_context_snapshots WHERE org_id=$1) AS snapshots,(SELECT count(*) FROM aidt_run_context_applications WHERE org_id=$1) AS applications FROM agent_runs WHERE org_id=$1 AND id=$2", [fixture.orgId, request.runId]));
    expect(rows.rows[0]).toEqual({ marker: null, snapshots: "0", applications: "0" });
    expect(JSON.stringify(recorder.submissions)).not.toContain("AIDT SAVED STUDENT REFERENCE");
    evidence.push({ name: "ordinary-chat", facts: { aidtPortCalls: 0, snapshotRows: 0, applicationRows: 0, ordinaryTransportStillWorks: true } });
  });
});
