import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addOrgMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-workbench-journal";
const OTHER_ORG = "org-workbench-journal-other";
const PROJECT = "proj-workbench-journal";
const THREAD = "thread-workbench-journal";
const ACTOR = "u-workbench-journal-actor";
const RUN = "run-workbench-journal";

let db: PgDatabase;
let repo: PgAgentRunRepository;

async function seedMinimalRun(): Promise<void> {
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await seedOrg({ orgId: OTHER_ORG, projectId: `${PROJECT}-other` });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addChatThread({
    orgId: ORG, id: THREAD, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR,
  });
  const inputMessageId = `${RUN}-input`;
  await addChatMessage({
    orgId: ORG, id: inputMessageId, threadId: THREAD, body: "hello", authorId: ACTOR,
  });
  await asApp(ORG, (c) =>
    c.query(
      `INSERT INTO agent_runs
         (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
          skill_version_ids, model_provider, model_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,$7,$8,'running')`,
      [RUN, ORG, THREAD, inputMessageId, "agent-i654", "agent-version-i654", "test-provider", "test-model"],
    ),
  );
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgAgentRunRepository(db);
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  await seedMinimalRun();
});

afterAll(async () => {
  await db.close();
});

describe("durable execution journal", () => {
  it("binds grants to the current permission identity and rejects stale or duplicate decisions", async () => {
    const org = toOrgId(ORG);
    const pendingId = async () => (await asApp(ORG, (c) => c.query(
      `SELECT pending_permission_request_id AS id FROM agent_runs WHERE id=$1`, [RUN]))).rows[0].id as string;
    await repo.markAwaitingToolPermission(org, RUN, { toolName: "call_skill", argsSummary: "safe summary" });
    const first = await pendingId();
    await repo.markAwaitingToolPermission(org, RUN, { toolName: "ignored", argsSummary: null });
    expect(await pendingId()).toBe(first);
    expect(await repo.decidePermissionRequest(org, RUN, first, "once", ACTOR)).toBe(true);
    expect(await repo.decidePermissionRequest(org, RUN, first, "forever", ACTOR)).toBe(false);
    await asApp(ORG, (c) => c.query(`UPDATE agent_runs SET status='running' WHERE id=$1`, [RUN]));
    await repo.markAwaitingToolPermission(org, RUN, { toolName: "call_skill", argsSummary: "second" });
    const second = await pendingId();
    expect(second).not.toBe(first);
    expect(await repo.decidePermissionRequest(org, RUN, first, "forever", ACTOR)).toBe(false);
    const grants = await asApp(ORG, (c) => c.query(`SELECT id FROM tool_permission_grants WHERE org_id=$1`, [ORG]));
    expect(grants.rows).toHaveLength(0);
    expect(await repo.decidePermissionRequest(org, RUN, second, "run", ACTOR)).toBe(true);
    const current = await asApp(ORG, (c) => c.query(`SELECT scope FROM tool_permission_grants WHERE org_id=$1`, [ORG]));
    expect(current.rows).toEqual([{ scope: "run" }]);
  });
  it("serializes concurrent writers and replays the exact cursor suffix across repository instances", async () => {
    const orgId = toOrgId(ORG);
    await Promise.all(Array.from({ length: 12 }, (_, index) => repo.appendExecutionEvent(orgId, RUN,
      { kind: "text_delta", attemptId: "attempt-1", messageId: "message", delta: String(index) })));
    const restarted = new PgAgentRunRepository(db);
    const all = await restarted.readExecutionEvents(orgId, RUN, -1);
    expect(all.map((event) => event.seq)).toEqual(Array.from({ length: 12 }, (_, index) => index));
    expect(new Set(all.filter((event) => event.kind === "text_delta").map((event) => event.delta)).size).toBe(12);
    expect(await restarted.readExecutionEvents(orgId, RUN, 6)).toEqual(all.slice(7));
  });
  it("rejects cross-org writes and hides another org's events", async () => {
    await repo.appendExecutionEvent(toOrgId(ORG), RUN, { kind: "status", status: "running" });
    expect(await repo.readExecutionEvents(toOrgId(OTHER_ORG), RUN, -1)).toEqual([]);
    await expect(repo.appendExecutionEvent(toOrgId(OTHER_ORG), RUN, { kind: "status", status: "running" })).rejects.toThrow();
  });
  it("retains distinct attempts for repeated kernel tool identifiers", async () => {
    for (const attemptId of ["attempt-1", "attempt-2"]) {
      await repo.appendExecutionEvent(toOrgId(ORG), RUN,
        { kind: "tool_start", attemptId, toolCallId: `${attemptId}:call-1`, toolName: "call_skill", args: { name: "research" } });
    }
    const events = await repo.readExecutionEvents(toOrgId(ORG), RUN, -1);
    expect(events.map((event) => event.attemptId)).toEqual(["attempt-1", "attempt-2"]);
    expect(events.map((event) => event.seq)).toEqual([0, 1]);
  });
  it("journals early failures atomically even without any model callback", async () => {
    await repo.failRun(toOrgId(ORG), RUN, "MODEL_CALL_FAILED");
    const events = await repo.readExecutionEvents(toOrgId(ORG), RUN, -1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "status", status: "failed", attemptId: `${RUN}:1` });
  });
  it("journals watchdog failures and does not fabricate a successful pause after settlement", async () => {
    await asApp(ORG, (client) => client.query("UPDATE agent_runs SET started_at=now()-interval '1 hour' WHERE id=$1", [RUN]));
    expect(await repo.reclaimStaleRunning(toOrgId(ORG), 1)).toBe(1);
    await repo.pauseAtCheckpoint(toOrgId(ORG), RUN);
    const events = await repo.readExecutionEvents(toOrgId(ORG), RUN, -1);
    expect(events.map((event) => event.kind === "status" ? event.status : event.kind)).toEqual(["failed"]);
  });
  it("rolls back status events when an illegal state transition is rejected", async () => {
    await expect(asApp(ORG, (client) => client.query("UPDATE agent_runs SET status='succeeded' WHERE id=$1", [RUN]))).rejects.toThrow();
    expect(await repo.readExecutionEvents(toOrgId(ORG), RUN, -1)).toEqual([]);
  });
  it("keeps cancellation pending while work runs, then confirms at a boundary and cannot reopen", async () => {
    expect(await repo.cancelAtCheckpoint(toOrgId(ORG), RUN)).toBe(false);
    expect(await repo.requestCancellation(toOrgId(ORG), RUN)).toBe("cancel_requested");
    expect(await repo.requestCancellation(toOrgId(ORG), RUN)).toBe("cancel_requested");
    expect(await repo.readExecutionEvents(toOrgId(ORG), RUN, -1)).toEqual([]);
    expect(await repo.cancelAtCheckpoint(toOrgId(ORG), RUN)).toBe(true);
    expect(await repo.requestCancellation(toOrgId(ORG), RUN)).toBe("cancelled");
    expect(await repo.resumeCheckpoint(toOrgId(ORG), RUN)).toBe(false);
    await repo.failRun(toOrgId(ORG), RUN, "MODEL_CALL_FAILED");
    const events = await repo.readExecutionEvents(toOrgId(ORG), RUN, -1);
    expect(events.map((event) => event.kind === "status" ? event.status : event.kind)).toEqual(["cancelled"]);
  });
  it("settles a late accepted cancellation atomically before writeback and rejects requests after that boundary", async () => {
    expect(await repo.requestCancellation(toOrgId(ORG), RUN)).toBe("cancel_requested");
    await repo.storeOutputAwaitingWriteback(toOrgId(ORG), RUN, { text: "done", finalStepSeq: 1 });
    const cancelled = await asApp(ORG, (client) => client.query("SELECT status FROM agent_runs WHERE id=$1", [RUN]));
    expect(cancelled.rows[0].status).toBe("cancelled");
    expect((await repo.readExecutionEvents(toOrgId(ORG), RUN, -1)).at(-1)).toMatchObject({ kind: "status", status: "cancelled" });
  });
  it("rejects cancellation after the writeback transaction boundary", async () => {
    await repo.storeOutputAwaitingWriteback(toOrgId(ORG), RUN, { text: "done", finalStepSeq: 1 });
    expect(await repo.requestCancellation(toOrgId(ORG), RUN)).toBe(null);
  });
  it("only resumes a settled pause once and atomically clears its request marker", async () => {
    expect(await repo.resumeCheckpoint(toOrgId(ORG), RUN)).toBe(false);
    await repo.pauseAtCheckpoint(toOrgId(ORG), RUN);
    const results = await Promise.all([repo.resumeCheckpoint(toOrgId(ORG), RUN), repo.resumeCheckpoint(toOrgId(ORG), RUN)]);
    expect(results.sort()).toEqual([false, true]);
    expect(await repo.isPausedAtCheckpoint(toOrgId(ORG), RUN)).toBe(false);
    const row = await asApp(ORG, (client) => client.query(
      "SELECT status,checkpoint_resume,pause_requested_at FROM agent_runs WHERE id=$1", [RUN]));
    expect(row.rows[0]).toMatchObject({ status: "queued", checkpoint_resume: true, pause_requested_at: null });
  });
});
