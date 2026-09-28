/**
 * WF06 —— pg-boss 泛化与 webhook 触发（真实 HTTP 面 + 真实 PostgreSQL + 进程内 worker）。
 * requirements 02 R2；contracts usecases.md UC-WR-13 / UC-WR-I4；domain I-6/I-15。
 *
 * 覆盖：
 *  E7 webhook 签名/窗口错 → 401 不建实例；同 Idempotency-Key 不同 payload → 409 idempotency_key_reused；
 *      并发同 key 只建 1 个实例并重放首个响应（A1，沿用 startInstanceFromTrigger 的幂等外壳）。
 *  E8 pg-boss `{kind:'workflow',triggerId}` 作业以作业 id 作 requestId：重复投递只建 1 个实例；
 *      原 agent-run payload（无 `kind` 字段）路由不受影响（router 纯函数单测）。
 */
import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkflowErrorBody, WorkflowInstanceProjection, WORKFLOW_WEBHOOK_HEADERS } from "@repo/contracts/workflow-runtime";
import { DEMO_WORKFLOW_KEY } from "../../src/infrastructure/workflow/demo-workflow-graph";
import { WORKFLOW_RUNTIME_SERVICE, type WorkflowRuntimeService } from "../../src/application/workflow/workflow-runtime-service";
import { createGeneralizedScheduleHandler } from "../../src/infrastructure/workflow/workflow-scheduled-job-router";
import { closeAppDeterministically } from "../support/close-app";
import { asApp, resetOrgs } from "../support/db";
import { publishDemoWorkflow, seedWorkflowOrg, waitFor, WF03_ADMIN } from "./wf03-fixtures";
import { seedScheduleTrigger, seedWebhookTrigger } from "./wf06-fixtures";
import { as, startWorkflowApp, type Wf03App } from "./wf03-http";

const ORG = "org-wf06-trigger";
const AGENT = "agent-wf06-trigger";
const WEBHOOK = (id: string) => `/workflow-triggers/${id}/webhook`;

function sign(secret: string, timestamp: number, idempotencyKey: string, payload: unknown): string {
  return createHmac("sha256", secret).update(`${timestamp}.${idempotencyKey}.${JSON.stringify(payload)}`).digest("hex");
}

async function postWebhook(e: Wf03App, triggerId: string, opts: { secret: string; timestamp?: number; idempotencyKey?: string; payload?: Record<string, unknown>; badSignature?: boolean }) {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const idempotencyKey = opts.idempotencyKey ?? `wh-${randomUUID()}`;
  const payload = opts.payload ?? { topic: "webhook 触发" };
  const signature = opts.badSignature ? "0".repeat(64) : sign(opts.secret, timestamp, idempotencyKey, payload);
  const res = await fetch(`${e.base}${WEBHOOK(triggerId)}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [WORKFLOW_WEBHOOK_HEADERS.signature]: signature,
      [WORKFLOW_WEBHOOK_HEADERS.timestamp]: String(timestamp),
      [WORKFLOW_WEBHOOK_HEADERS.idempotencyKey]: idempotencyKey,
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, body: (text.length > 0 ? JSON.parse(text) : null) as any, idempotencyKey };
}

const instanceCount = () => asApp(ORG, (c) => c.query<{ n: string }>("SELECT count(*) AS n FROM workflow_instances")).then((r) => Number(r.rows[0]!.n));

describe("WF06 pg-boss generalization + webhook trigger", () => {
  let e: Wf03App;
  beforeAll(async () => {
    e = await startWorkflowApp();
  }, 120_000);
  afterAll(async () => {
    await resetOrgs(ORG);
    await closeAppDeterministically(e?.app);
  });
  beforeEach(async () => {
    await resetOrgs(ORG);
    await seedWorkflowOrg(ORG, [], AGENT);
    await publishDemoWorkflow(e.db, ORG);
  });

  it("correct signature within the 5-minute window creates exactly one instance that runs to completion", async () => {
    const trigger = await seedWebhookTrigger({ orgId: ORG, workflowKey: DEMO_WORKFLOW_KEY, ownerUserId: WF03_ADMIN, agentId: AGENT });
    const r = await postWebhook(e, trigger.triggerId, { secret: trigger.secret, payload: { topic: "webhook 起跑" } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "running" });
    expect(await instanceCount()).toBe(1);

    const done = await waitFor(
      () => as(e, WF03_ADMIN, ORG).get<WorkflowInstanceProjection>(`/workflow-instances/${r.body.instanceId}`),
      (res) => res.status === 200 && res.body.status !== "running" && res.body.status !== "cancelling",
    );
    const p = WorkflowInstanceProjection.parse(done.body);
    expect(p.status).toBe("succeeded");
    expect(p.triggerKind).toBe("webhook");
    expect(p.initiatorUserId).toBe(WF03_ADMIN);
  }, 60_000);

  it("E7: an invalid signature is 401 webhook_signature_invalid and never creates a receipt or instance", async () => {
    const trigger = await seedWebhookTrigger({ orgId: ORG, workflowKey: DEMO_WORKFLOW_KEY, ownerUserId: WF03_ADMIN, agentId: AGENT });
    const r = await postWebhook(e, trigger.triggerId, { secret: trigger.secret, badSignature: true });
    expect(r.status).toBe(401);
    expect(WorkflowErrorBody.parse(r.body).code).toBe("webhook_signature_invalid");
    expect(await instanceCount()).toBe(0);
    const receipts = await asApp(ORG, (c) => c.query("SELECT * FROM workflow_receipts"));
    expect(receipts.rows).toHaveLength(0);
  });

  it("E7: a timestamp outside the 5-minute window is 401, even with an otherwise-correct signature", async () => {
    const trigger = await seedWebhookTrigger({ orgId: ORG, workflowKey: DEMO_WORKFLOW_KEY, ownerUserId: WF03_ADMIN, agentId: AGENT });
    const staleTimestamp = Math.floor(Date.now() / 1000) - 301;
    const r = await postWebhook(e, trigger.triggerId, { secret: trigger.secret, timestamp: staleTimestamp });
    expect(r.status).toBe(401);
    expect(WorkflowErrorBody.parse(r.body).code).toBe("webhook_signature_invalid");
    expect(await instanceCount()).toBe(0);
  });

  it("E7: same Idempotency-Key with a different payload is 409 idempotency_key_reused; same key + same payload replays and creates exactly one instance", async () => {
    const trigger = await seedWebhookTrigger({ orgId: ORG, workflowKey: DEMO_WORKFLOW_KEY, ownerUserId: WF03_ADMIN, agentId: AGENT });
    const idempotencyKey = `wh-${randomUUID()}`;
    const payload = { topic: "幂等 webhook" };
    const [a, b] = await Promise.all([
      postWebhook(e, trigger.triggerId, { secret: trigger.secret, idempotencyKey, payload }),
      postWebhook(e, trigger.triggerId, { secret: trigger.secret, idempotencyKey, payload }),
    ]);
    expect(a.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(await instanceCount()).toBe(1);

    const reused = await postWebhook(e, trigger.triggerId, { secret: trigger.secret, idempotencyKey, payload: { topic: "另一个 payload" } });
    expect(reused.status).toBe(409);
    expect(WorkflowErrorBody.parse(reused.body).code).toBe("idempotency_key_reused");
    expect(await instanceCount()).toBe(1);
  }, 30_000);

  it("the same Idempotency-Key value reused across two different webhook triggers does not collide: each starts its own instance", async () => {
    const triggerA = await seedWebhookTrigger({ orgId: ORG, workflowKey: DEMO_WORKFLOW_KEY, ownerUserId: WF03_ADMIN, agentId: AGENT });
    const triggerB = await seedWebhookTrigger({ orgId: ORG, workflowKey: DEMO_WORKFLOW_KEY, ownerUserId: WF03_ADMIN, agentId: AGENT });
    const sharedIdempotencyKey = `wh-shared-${randomUUID()}`;

    const a = await postWebhook(e, triggerA.triggerId, { secret: triggerA.secret, idempotencyKey: sharedIdempotencyKey, payload: { topic: "triggerA 的请求" } });
    const b = await postWebhook(e, triggerB.triggerId, { secret: triggerB.secret, idempotencyKey: sharedIdempotencyKey, payload: { topic: "triggerB 的请求" } });

    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(b.body.instanceId).not.toBe(a.body.instanceId);
    expect(await instanceCount()).toBe(2);
  }, 30_000);

  it("an unknown triggerId, or a trigger that is not a webhook kind, is workflow_not_found", async () => {
    const missing = await postWebhook(e, `wt-${randomUUID()}`, { secret: "whatever" });
    expect(missing.status).toBe(404);
    expect(WorkflowErrorBody.parse(missing.body).code).toBe("workflow_not_found");

    const schedule = await seedScheduleTrigger({ orgId: ORG, workflowKey: DEMO_WORKFLOW_KEY, ownerUserId: WF03_ADMIN, agentId: AGENT });
    const wrongKind = await postWebhook(e, schedule.triggerId, { secret: "whatever" });
    expect(wrongKind.status).toBe(404);
    expect(WorkflowErrorBody.parse(wrongKind.body).code).toBe("workflow_not_found");
  });

  it("E8: a pg-boss {kind:'workflow',triggerId} job wakes the schedule trigger; the job id is the requestId, so redelivery creates exactly one instance", async () => {
    const trigger = await seedScheduleTrigger({ orgId: ORG, workflowKey: DEMO_WORKFLOW_KEY, ownerUserId: WF03_ADMIN, agentId: AGENT, defaultInput: { topic: "定时唤醒" } });
    const runtime = e.app.get<WorkflowRuntimeService>(WORKFLOW_RUNTIME_SERVICE);
    const jobId = `job-${randomUUID()}`;
    const job = { id: jobId, data: { kind: "workflow" as const, triggerId: trigger.triggerId } };

    await runtime.deliverScheduledTrigger(job);
    await runtime.deliverScheduledTrigger(job); // at-least-once redelivery, same job id
    expect(await instanceCount()).toBe(1);

    const row = (await asApp(ORG, (c) => c.query<{ id: string; trigger_kind: string; agent_id: string }>("SELECT id, trigger_kind, agent_id FROM workflow_instances"))).rows[0]!;
    expect(row.trigger_kind).toBe("schedule");
    expect(row.agent_id).toBe(AGENT);

    const done = await waitFor(
      () => as(e, WF03_ADMIN, ORG).get<WorkflowInstanceProjection>(`/workflow-instances/${row.id}`),
      (res) => res.status === 200 && res.body.status !== "running" && res.body.status !== "cancelling",
    );
    expect(WorkflowInstanceProjection.parse(done.body).status).toBe("succeeded");
  }, 60_000);

  it("a scheduled job for a triggerId that no longer resolves to a schedule trigger is a quiet no-op (no instance, no throw)", async () => {
    const runtime = e.app.get<WorkflowRuntimeService>(WORKFLOW_RUNTIME_SERVICE);
    await expect(runtime.deliverScheduledTrigger({ id: `job-${randomUUID()}`, data: { kind: "workflow", triggerId: `wt-${randomUUID()}` } })).resolves.toBeUndefined();
    expect(await instanceCount()).toBe(0);
  });
});

describe("WF06 generalized pg-boss handler routing (pure)", () => {
  it("routes {kind:'workflow',triggerId} payloads to the workflow handler and leaves legacy payloads (no `kind`) to the agent-run handler", async () => {
    const seen: string[] = [];
    const handler = createGeneralizedScheduleHandler<{ orgId: string; scheduleId: string }>(
      async (job) => { seen.push(`legacy:${job.id}:${job.data.scheduleId}`); },
      async (job) => { seen.push(`workflow:${job.id}:${job.data.triggerId}`); },
    );
    await handler({ id: "j1", data: { orgId: "org-1", scheduleId: "sched-1" } } as any);
    await handler({ id: "j2", data: { kind: "workflow", triggerId: "wt-1" } } as any);
    expect(seen).toEqual(["legacy:j1:sched-1", "workflow:j2:wt-1"]);
  });

  it("does not misroute a legacy payload that happens to carry an unrelated `kind` field", async () => {
    const seen: string[] = [];
    const handler = createGeneralizedScheduleHandler<{ orgId: string; scheduleId: string; kind?: string }>(
      async (job) => { seen.push(`legacy:${job.id}`); },
      async () => { seen.push("workflow"); },
    );
    await handler({ id: "j3", data: { orgId: "org-1", scheduleId: "sched-1", kind: "not-workflow" } } as any);
    expect(seen).toEqual(["legacy:j3"]);
  });
});
