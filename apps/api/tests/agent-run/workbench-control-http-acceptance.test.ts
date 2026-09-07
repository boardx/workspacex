/** S2 HTTP acceptance: real Nest authorization, PostgreSQL state and supported CAS.
 * No model/tool is dispatched: the fixture is an already paused run. */
import { randomUUID } from "node:crypto";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { ingestEnginePlanSnapshot } from "../../src/application/plan-control/ingest-engine-plan-snapshot";
import { PLAN_LEDGER_REPOSITORY, type PlanLedgerRepository } from "../../src/application/plan-control/ports";
import { toOrgId } from "../../src/domain/org-id";
import { addOrgMember, addProjectMember, asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addChatThread, addChatMessage } from "../support/chat-db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";
const ORG = "org-s2-http", OTHER = "org-s2-http-other", PROJECT = "project-s2-http";
const ACTOR = "actor-s2-http", OBSERVER = "observer-s2-http";
let app: NestExpressApplication, base: string, thread: string, run: string;
let ledger: PlanLedgerRepository;
const headers = (actor = ACTOR, org = ORG) => ({ "x-kernel-test-principal": `${actor}:${org}`, "content-type": "application/json" });
const request = (path: string, method = "GET", actor = ACTOR, org = ORG, body?: unknown) =>
  fetch(`${base}${path}`, { method, headers: headers(actor, org), ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

beforeAll(async () => {
  ensureDatabase(); await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp(); await app.listen(0);
  const address = app.getHttpServer().address();
  base = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
  ledger = app.get(PLAN_LEDGER_REPOSITORY);
}, 180_000);
afterAll(async () => { await app?.close(); });
beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  await seedOrg({ orgId: OTHER, projectId: `${PROJECT}-other` });
  await addOrgMember(ORG, ACTOR, "consultant", null);
  await addProjectMember(ORG, PROJECT, ACTOR, "facilitator", null);
  await addOrgMember(ORG, OBSERVER, "consultant", null);
  await addProjectMember(ORG, PROJECT, OBSERVER, "observer", null);
  await addOrgMember(OTHER, ACTOR, "consultant", null);
  thread = `thread-${randomUUID()}`; run = `run-${randomUUID()}`;
  const message = `message-${randomUUID()}`;
  await addChatThread({ orgId: ORG, id: thread, projectId: PROJECT, visibilityScope: "plenary", createdBy: ACTOR });
  await addChatMessage({ orgId: ORG, id: message, threadId: thread, body: "S2 control acceptance", authorId: ACTOR });
  await asApp(ORG, c => c.query(`INSERT INTO agent_runs
    (id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,paused_at)
    VALUES ($1,$2,$3,$4,'s2-agent','s2-version','[]','deep-agent','deep-agent','paused',now())`, [run, ORG, thread, message]));
});

describe("S2 supported HTTP identity / authorization / idempotency / revision matrix", () => {
  it("unknown and cross-tenant run/queue reads and cancellation fail without an existence oracle", async () => {
    for (const [id, org] of [[`missing-${randomUUID()}`, ORG], [run, OTHER]]) {
      for (const suffix of ["", "/execution-events", "/interjections"]) {
        expect((await request(`/agent-runs/${id}${suffix}`, "GET", ACTOR, org)).status).toBe(404);
      }
      expect((await request(`/agent-runs/${id}/cancel`, "POST", ACTOR, org)).status).toBe(404);
    }
    expect((await request(`/chat/threads/${thread}/queued-messages`, "GET", ACTOR, OTHER)).status).toBe(404);
    expect((await request(`/chat/threads/missing/queued-messages`)).status).toBe(404);
  });

  it("observer may read a plenary journal but cannot cancel or enqueue", async () => {
    expect((await request(`/agent-runs/${run}/execution-events`, "GET", OBSERVER)).status).toBe(200);
    expect((await request(`/agent-runs/${run}/cancel`, "POST", OBSERVER)).status).toBe(403);
    const response = await request(`/chat/threads/${thread}/queued-messages`, "POST", OBSERVER, ORG,
      { clientRequestId: randomUUID(), text: "must not enqueue", agentId: null });
    expect(response.status).toBe(404); // Queue intentionally hides non-writable scopes.
    const rows = await asApp(ORG, c => c.query("SELECT status,cancel_requested_at FROM agent_runs WHERE org_id=$1 AND id=$2", [ORG, run]));
    expect(rows.rows[0]).toMatchObject({ status: "paused", cancel_requested_at: null });
  });

  it("repeated cancel is idempotent and emits only one durable cancelled transition", async () => {
    for (let i = 0; i < 2; i++) {
      const response = await request(`/agent-runs/${run}/cancel`, "POST");
      expect(response.status).toBe(202);
      expect(await response.json()).toMatchObject({ runId: run, status: "cancelled" });
    }
    const response = await request(`/agent-runs/${run}/execution-events`);
    expect(response.status).toBe(200);
    const page = await response.json() as { events: { kind: string; status?: string }[] };
    expect(page.events.filter((event: { kind: string; status?: string }) => event.kind === "status" && event.status === "cancelled")).toHaveLength(1);
  });

  it("plan revision CAS rejects stale writes without changing the committed plan", async () => {
    const created = await ingestEnginePlanSnapshot(ledger, { orgId: toOrgId(ORG), threadId: thread,
      todos: [{ content: "first", status: "pending" }, { content: "second", status: "pending" }] });
    const before = (await ledger.getLatest(toOrgId(ORG), thread))!;
    // Existing plan-edit routes require the actual project scope in their query.
    const path = `/plan-control/threads/${thread}/steps/reorder?projectId=${encodeURIComponent(PROJECT)}`;
    const stale = await request(path, "POST", ACTOR, ORG,
      { basedOnRevision: created.revision + 1, planStepId: before.steps[0]!.planStepId, toIndex: 1 });
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ reasonCode: "PLAN_REVISION_CHANGED" });
    expect(await ledger.getLatest(toOrgId(ORG), thread)).toEqual(before);
    const accepted = await request(path, "POST", ACTOR, ORG,
      { basedOnRevision: created.revision, planStepId: before.steps[0]!.planStepId, toIndex: 1 });
    expect(accepted.status).toBe(201);
    expect((await ledger.getLatest(toOrgId(ORG), thread))!.steps[1]!.planStepId).toBe(before.steps[0]!.planStepId);
  });
});
