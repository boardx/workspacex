/**
 * WF03 —— start / get / cancel / resume 的真实 HTTP 面（kernel.module 合成、真实 PostgreSQL、进程内 worker 跑演示 Workflow）。
 * requirements 02 R3 第 2/4/8/9/10 步；R4 A1/E2/E3/E6；R5 可见性；domain I-10/I-12。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkflowErrorBody, WorkflowInstanceProjection, workflowRuntime } from "@repo/contracts/workflow-runtime";
import { DEMO_WORKFLOW_KEY } from "../../src/infrastructure/workflow/demo-workflow-graph";
import { closeAppDeterministically } from "../support/close-app";
import { asApp, resetOrgs } from "../support/db";
import { eventSeqs, publishDemoWorkflow, seedWorkflowOrg, waitFor } from "./wf03-fixtures";
import { as, startWorkflowApp, type Wf03App } from "./wf03-http";

const ORG = "org-wf03-api";
const OTHER_ORG = "org-wf03-api-other";
const ALICE = "u-wf03-alice";
const BOB = "u-wf03-bob";
const AGENT = "agent-wf03-api";
const START = `/workflows/${DEMO_WORKFLOW_KEY}/instances`;

let seq = 0;
const rid = () => `req-wf03-api-${Date.now()}-${++seq}`;

describe("WF03 instance lifecycle API", () => {
  let e: Wf03App;
  beforeAll(async () => {
    e = await startWorkflowApp();
  }, 120_000);
  afterAll(async () => {
    await resetOrgs(ORG, OTHER_ORG);
    await closeAppDeterministically(e?.app);
  });
  beforeEach(async () => {
    await resetOrgs(ORG, OTHER_ORG);
    await seedWorkflowOrg(ORG, [{ userId: ALICE }, { userId: BOB }], AGENT);
    await seedWorkflowOrg(OTHER_ORG, [{ userId: ALICE }], `${AGENT}-other`);
    await publishDemoWorkflow(e.db, ORG);
  });

  const alice = () => as(e, ALICE, ORG);
  const settled = (id: string) =>
    waitFor(() => alice().get<WorkflowInstanceProjection>(`/workflow-instances/${id}`), (r) => r.status === 200 && r.body.status !== "running" && r.body.status !== "cancelling");

  it("POST start → 201 with the pinned version set; stages write business rows, events are 1..N, instance succeeds", async () => {
    const r = await alice().post(START, { agentId: AGENT, requestId: rid(), input: { topic: "季度复盘" } });
    expect(r.status).toBe(201);
    const body = workflowRuntime.startInstance.out.parse(r.body);
    expect(body).toMatchObject({ status: "running", stateVersion: 1, definitionVersion: 1, pinnedSkills: [] });

    const done = await settled(body.instanceId);
    const p = WorkflowInstanceProjection.parse(done.body);
    expect(p.status).toBe("succeeded");
    expect(p.definitionVersion).toBe(1);
    expect(p.initiatorUserId).toBe(ALICE);
    expect(p.stages.map((s) => [s.stageId, s.status])).toEqual([["collect", "succeeded"], ["draft", "succeeded"], ["finalize", "succeeded"]]);
    for (const s of p.stages) expect(s.outputs).toHaveLength(1);

    const outputs = await asApp(ORG, (c) => c.query("SELECT stage_id FROM workflow_stage_outputs WHERE instance_id = $1", [body.instanceId]));
    expect(outputs.rows).toHaveLength(3);
    const events = await eventSeqs(ORG, body.instanceId);
    expect(events.map((x) => x.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events[0]).toMatchObject({ seq: 1, type: "instance_started", state_version: 1 });
    // I-12：每次状态变化 stateVersion 严格 +1；projection 的 stateVersion / lastSeq 与日志一致
    expect(events.map((x) => x.state_version)).toEqual(events.map((_, i) => i + 1));
    expect(p.stateVersion).toBe(events.at(-1)!.state_version);
    expect(p.lastSeq).toBe(events.length);
  }, 60_000);

  it("A1: the same requestId (concurrent and repeated) creates exactly one instance and replays the first response; a different payload is idempotency_key_reused", async () => {
    const requestId = rid();
    const payload = { agentId: AGENT, requestId, input: { topic: "幂等" } };
    const [a, b] = await Promise.all([alice().post(START, payload), alice().post(START, payload)]);
    const c = await alice().post(START, payload);
    for (const r of [a, b, c]) expect(r.status).toBe(201);
    expect(b.body).toEqual(a.body);
    expect(c.body).toEqual(a.body);
    const count = await asApp(ORG, (x) => x.query<{ n: string }>("SELECT count(*) AS n FROM workflow_instances"));
    expect(Number(count.rows[0]!.n)).toBe(1);

    const reused = await alice().post(START, { ...payload, input: { topic: "另一个" } });
    expect(reused.status).toBe(409);
    expect(WorkflowErrorBody.parse(reused.body).code).toBe("idempotency_key_reused");
    await settled(a.body.instanceId);
  }, 60_000);

  it("E3: cancel with a stale expectedStateVersion → 409 state_version_conflict carrying the latest projection; a current one cancels at the next stage boundary", async () => {
    const started = await alice().post(START, { agentId: AGENT, requestId: rid(), input: { topic: "取消", stageDelayMs: 500 } });
    const id = started.body.instanceId as string;
    await waitFor(() => alice().get(`/workflow-instances/${id}`), (r) => r.body.stateVersion > 1);

    const stale = await alice().post(`/workflow-instances/${id}/cancel`, { expectedStateVersion: 1, requestId: rid() });
    expect(stale.status).toBe(409);
    const err = WorkflowErrorBody.parse(stale.body);
    expect(err.code).toBe("state_version_conflict");
    expect(err.latestProjection!.instanceId).toBe(id);
    expect(err.latestProjection!.stateVersion).toBeGreaterThan(1);

    // 用最新版本号取消（worker 在推进，版本可能又变：按 409 带回的 projection 重试）
    let version = err.latestProjection!.stateVersion;
    let cancelled: { status: number; body: any } | null = null;
    for (let i = 0; i < 20 && !cancelled; i++) {
      const r = await alice().post(`/workflow-instances/${id}/cancel`, { expectedStateVersion: version, requestId: rid() });
      if (r.status === 200) cancelled = r;
      else version = WorkflowErrorBody.parse(r.body).latestProjection!.stateVersion;
    }
    expect(cancelled).not.toBeNull();
    expect(workflowRuntime.cancelInstance.out.parse(cancelled!.body)).toMatchObject({ instanceId: id, status: "cancelling", stateVersion: version + 1 });

    const final = await settled(id);
    expect(final.body.status).toBe("cancelled");
    expect(final.body.reasonCode).toBe("cancel_requested");
    expect(final.body.stages.some((s: { status: string }) => s.status !== "succeeded")).toBe(true);
    const events = await eventSeqs(ORG, id);
    expect(events.map((x) => x.type)).toContain("cancel_requested");
    expect(events.at(-1)).toMatchObject({ type: "status_changed" });

    // 终态：版本对了也不能再取消
    const again = await alice().post(`/workflow-instances/${id}/cancel`, { expectedStateVersion: final.body.stateVersion, requestId: rid() });
    expect(again.status).toBe(409);
    expect(WorkflowErrorBody.parse(again.body)).toMatchObject({ code: "instance_terminal", latestProjection: { status: "cancelled" } });
  }, 60_000);

  it("E2 at the API: resume while the running worker holds the lease → 409 lease_conflict", async () => {
    const started = await alice().post(START, { agentId: AGENT, requestId: rid(), input: { topic: "续跑", stageDelayMs: 400 } });
    const id = started.body.instanceId as string;
    let conflict = null as null | { status: number; body: any };
    for (let i = 0; i < 20 && !conflict; i++) {
      const cur = await alice().get(`/workflow-instances/${id}`);
      const r = await alice().post(`/workflow-instances/${id}/resume`, { expectedStateVersion: cur.body.stateVersion, requestId: rid() });
      if (r.status === 409 && r.body.code === "lease_conflict") conflict = r;
    }
    expect(conflict).not.toBeNull();
    await settled(id);
  }, 60_000);

  it("R5/E6: other members and other orgs get 404; a non-runnable agent is 403; invalid trigger input is 422", async () => {
    const started = await alice().post(START, { agentId: AGENT, requestId: rid(), input: { topic: "可见性" } });
    const id = started.body.instanceId as string;
    const bob = await as(e, BOB, ORG).get(`/workflow-instances/${id}`);
    expect(bob.status).toBe(404);
    expect(WorkflowErrorBody.parse(bob.body).code).toBe("workflow_not_found");
    const foreign = await as(e, ALICE, OTHER_ORG).get(`/workflow-instances/${id}`);
    expect(foreign.status).toBe(404);
    const bobCancel = await as(e, BOB, ORG).post(`/workflow-instances/${id}/cancel`, { expectedStateVersion: 1, requestId: rid() });
    expect(bobCancel.status).toBe(404);
    const admin = await as(e, "u-wf03-admin", ORG).get(`/workflow-instances/${id}`);
    expect(admin.status).toBe(200);

    const notAllowed = await alice().post(START, { agentId: "agent-does-not-exist", requestId: rid(), input: { topic: "x" } });
    expect(notAllowed.status).toBe(403);
    expect(notAllowed.body.code).toBe("workflow_not_allowed");
    const badInput = await alice().post(START, { agentId: AGENT, requestId: rid(), input: { topic: 42 } });
    expect(badInput.status).toBe(422);
    expect(badInput.body.code).toBe("trigger_input_invalid");
    const unknown = await alice().post(`/workflows/no-such-flow/instances`, { agentId: AGENT, requestId: rid(), input: {} });
    expect(unknown.status).toBe(404);
    await settled(id);
  }, 60_000);
});
