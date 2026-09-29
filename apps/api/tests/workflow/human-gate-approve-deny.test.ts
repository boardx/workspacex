/**
 * WF05 —— 人工门 approve / deny（requirements 02 R3 第 6/7 步；R4 A4/A5/E4/E13；domain I-13/I-17；
 * 契约 UC-WR-11/12，coverage V6/V7/V9）。真实 PostgreSQL + 真实 LangGraph PostgresSaver。
 *
 * 载体：测试注册的两个图——`wf05-gate:1`（prepare → send[门，阶段内经 effect-gateway 调工具桩]）与
 * `wf05-fwd:1`（send[门，onDeny→fallback] → extra → fallback）；以及生产注册的 `demo-approval:1`（HTTP 面）。
 * 工具桩的调用计数是「有没有真的产生副作用」的唯一判据。
 */
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkflowErrorBody, WorkflowInstanceProjection, workflowRuntime } from "@repo/contracts/workflow-runtime";
import type { EffectGateway } from "../../src/application/workflow/effect-gateway";
import { publishDefinitionVersion } from "../../src/application/workflow/publish-definition-version";
import { WorkflowUseCaseError } from "../../src/application/workflow/workflow-errors";
import type { WorkflowRuntimeService } from "../../src/application/workflow/workflow-runtime-service";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { UNRESOLVED_SKILL_VERSIONS, createWorkflowRuntime, defaultWorkflowGraphs } from "../../src/infrastructure/workflow/create-workflow-runtime";
import { DEMO_APPROVAL_WORKFLOW_DEFINITION, DEMO_APPROVAL_WORKFLOW_KEY } from "../../src/infrastructure/workflow/demo-approval-workflow-graph";
import { PgWorkflowDefinitionRepository } from "../../src/infrastructure/workflow/pg-workflow-definition-repository";
import { WorkflowGraphRegistry, type LinearWorkflowGraph } from "../../src/infrastructure/workflow/workflow-graph-registry";
import { closeAppDeterministically } from "../support/close-app";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";
import { WF03_ADMIN, seedWorkflowOrg, waitFor } from "./wf03-fixtures";
import { as, startWorkflowApp, type Wf03App } from "./wf03-http";
import { setCapabilityGrant } from "./wf04-fixtures";

const ORG = "org-wf05-gate";
const INITIATOR = "u-wf05-initiator";
const APPROVER_A = "u-wf05-approver-a";
const APPROVER_B = "u-wf05-approver-b";
const OUTSIDER = "u-wf05-outsider";
const AGENT = "agent-wf05-gate";
const CATEGORY = "mail.send";

let seq = 0;
const rid = () => `req-wf05-${Date.now()}-${++seq}`;

const approverUserIds = [APPROVER_A, APPROVER_B, INITIATOR];
const GATE_DEF = {
  key: "wf05-gate",
  version: 1,
  graphRef: "wf05-gate:1",
  title: "wf05 gate",
  inputSchema: { type: "object", properties: { to: { type: "string" } } },
  stages: [
    { stageId: "prepare", title: "准备", skills: [], capabilityCategories: [], sideEffect: "none", humanGate: null, maxAttempts: 1 },
    {
      stageId: "send",
      title: "发送邮件",
      skills: [],
      capabilityCategories: [CATEGORY],
      sideEffect: "external_send",
      humanGate: { approverRoles: [], approverUserIds, allowSelfApproval: false, onDenyStageId: null },
      maxAttempts: 1,
    },
  ],
};
const FWD_DEF = {
  key: "wf05-fwd",
  version: 1,
  graphRef: "wf05-fwd:1",
  title: "wf05 forward deny",
  inputSchema: { type: "object" },
  stages: [
    {
      stageId: "send",
      title: "发送",
      skills: [],
      capabilityCategories: [CATEGORY],
      sideEffect: "external_send",
      humanGate: { approverRoles: [], approverUserIds, allowSelfApproval: false, onDenyStageId: "fallback" },
      maxAttempts: 1,
    },
    { stageId: "extra", title: "附加", skills: [], capabilityCategories: [], sideEffect: "none", humanGate: null, maxAttempts: 1 },
    { stageId: "fallback", title: "兜底", skills: [], capabilityCategories: [], sideEffect: "none", humanGate: null, maxAttempts: 1 },
  ],
};

describe("WF05 human gate approve/deny (runtime)", () => {
  let db: PgDatabase;
  let pool: pg.Pool;
  let service: WorkflowRuntimeService;
  let gateway: EffectGateway;
  const toolCalls: Array<{ instanceId: string; args: Record<string, unknown> }> = [];
  const workLog: string[] = [];
  const runErrors: unknown[] = [];

  const sendWork = (stageId: string): LinearWorkflowGraph["stages"][number]["work"] => async (exec) => {
    workLog.push(`${exec.instanceId}:${stageId}`);
    const out = await gateway.execute(
      exec.lease,
      {
        orgId: ORG,
        instanceId: exec.instanceId,
        stageId,
        workflowKey: "wf05",
        effectKey: "mail-1",
        capabilityCategory: CATEGORY,
        sideEffect: "external_send",
        initiatorUserId: INITIATOR,
        agentId: AGENT,
        agentVersionId: `${AGENT}-v1`,
        fingerprint: "fp-mail-1",
        args: { to: "x@example.com" },
        approvalRequestId: exec.approval?.gateId ?? null,
      },
      async (args) => {
        toolCalls.push({ instanceId: exec.instanceId, args });
        return { messageId: "m-1" };
      },
    );
    return { label: "sent", content: { ...out.result } };
  };
  const plain = (stageId: string): LinearWorkflowGraph["stages"][number]["work"] => async (exec) => {
    workLog.push(`${exec.instanceId}:${stageId}`);
    return { label: stageId, content: { ok: true } };
  };
  const graphs: LinearWorkflowGraph[] = [
    { graphRef: "wf05-gate:1", stages: [{ stageId: "prepare", work: plain("prepare") }, { stageId: "send", work: sendWork("send") }] },
    {
      graphRef: "wf05-fwd:1",
      stages: [
        { stageId: "send", work: sendWork("send") },
        { stageId: "extra", work: plain("extra") },
        { stageId: "fallback", work: plain("fallback") },
      ],
    },
  ];

  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    db = new PgDatabase(appConfig());
    pool = new pg.Pool({ ...appConfig(), max: 3 });
    const rt = createWorkflowRuntime(db, pool, { graphs, holder: "wf05-worker", leaseTtlMs: 30_000, onRunError: (_i, e) => runErrors.push(e) });
    service = rt.service;
    gateway = rt.effectGateway;
  }, 60_000);
  afterAll(async () => {
    await service?.drain();
    await resetOrgs(ORG);
    await pool?.end();
    await db?.close();
  });
  beforeEach(async () => {
    toolCalls.length = 0;
    workLog.length = 0;
    runErrors.length = 0;
    await resetOrgs(ORG);
    await seedWorkflowOrg(ORG, [{ userId: INITIATOR }, { userId: APPROVER_A }, { userId: APPROVER_B }, { userId: OUTSIDER }], AGENT);
    await setCapabilityGrant(ORG, CATEGORY, { sideEffectCap: "external_send" });
    const deps = {
      definitions: new PgWorkflowDefinitionRepository(db),
      graphs: new WorkflowGraphRegistry(graphs),
      skills: UNRESOLVED_SKILL_VERSIONS,
      clock: { nowIso: () => new Date().toISOString() },
    };
    for (const def of [GATE_DEF, FWD_DEF]) {
      await asOwner((c) => c.query("INSERT INTO workflow_definitions (org_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [ORG, def.key]));
      await publishDefinitionVersion(deps, { orgId: ORG, actor: { userId: WF03_ADMIN, orgRole: "admin" }, pathKey: def.key, body: structuredClone(def) });
    }
  });

  async function startAwaiting(key = "wf05-gate") {
    const started = await service.start(ORG, INITIATOR, key, { agentId: AGENT, requestId: rid(), input: {} });
    await service.drain();
    const p = await service.get(ORG, INITIATOR, started.instanceId);
    expect(p.status).toBe("awaiting_gate_decision");
    return p;
  }

  async function reject(p: Promise<unknown>): Promise<WorkflowUseCaseError> {
    const e = await p.then(() => null, (x: unknown) => x);
    expect(e).toBeInstanceOf(WorkflowUseCaseError);
    return e as WorkflowUseCaseError;
  }

  async function effectReceipts(instanceId: string) {
    const r = await asApp(ORG, (c) =>
      c.query<{ request_key: string; status: string; stable_response: any }>(
        "SELECT request_key, status, stable_response FROM workflow_receipts WHERE scope = 'effect' AND instance_id = $1",
        [instanceId],
      ),
    );
    return r.rows;
  }

  async function events(instanceId: string) {
    const r = await asApp(ORG, (c) =>
      c.query<{ seq: string; type: string; stage_id: string | null; reason_code: string | null; data: any }>(
        "SELECT seq, type, stage_id, reason_code, data FROM workflow_events WHERE instance_id = $1 ORDER BY seq",
        [instanceId],
      ),
    );
    return r.rows;
  }

  it("gate opens before the gated stage: awaiting_gate_decision, gate_opened with effect preview, lease released, no tool call", async () => {
    const p = await startAwaiting();
    expect(p.stages.map((s) => [s.stageId, s.status])).toEqual([["prepare", "succeeded"], ["send", "awaiting_gate_decision"]]);
    expect(p.openGate).toMatchObject({
      stageId: "send",
      decision: null,
      decidedBy: null,
      effectPreview: { capabilityCategory: CATEGORY, targetSystem: "mail", summary: "发送邮件" },
      viewerCanDecide: false, // 发起人默认不能自批
    });
    expect(p.viewerCapabilities.canResume).toBe(false);
    const ev = await events(p.instanceId);
    const opened = ev.filter((e) => e.type === "gate_opened");
    expect(opened).toHaveLength(1);
    expect(opened[0]!.data.effectPreview.capabilityCategory).toBe(CATEGORY);
    expect(workLog).toEqual([`${p.instanceId}:prepare`]);
    expect(toolCalls).toHaveLength(0);
    expect(await effectReceipts(p.instanceId)).toHaveLength(0);
    const lease = await asApp(ORG, (c) =>
      c.query<{ live: boolean }>("SELECT expires_at > now() AS live FROM workflow_leases WHERE instance_id = $1", [p.instanceId]),
    );
    expect(lease.rows[0]?.live).toBe(false);
    // 指定审批人可见实例且可决定；非指定成员看不到（404）。
    const asApprover = await service.get(ORG, APPROVER_A, p.instanceId);
    expect(asApprover.openGate?.viewerCanDecide).toBe(true);
    expect(asApprover.viewerCapabilities).toEqual({ canCancel: false, canRetryStage: false, canResume: false });
    expect((await reject(service.get(ORG, OUTSIDER, p.instanceId))).code).toBe("workflow_not_found");
    // 挂起期间 resume 不会绕过门：worker 重进后再次挂起、不重开门、不调用工具。
    await service.resume(ORG, INITIATOR, p.instanceId, { expectedStateVersion: p.stateVersion, requestId: rid() });
    await service.drain();
    expect((await service.get(ORG, INITIATOR, p.instanceId)).status).toBe("awaiting_gate_decision");
    expect((await events(p.instanceId)).filter((e) => e.type === "gate_opened")).toHaveLength(1);
    expect(toolCalls).toHaveLength(0);
  });

  it("E13: non-designated → 403 not_designated_approver; initiator → 403 self_approval_forbidden; non-member → 404; stale version → 409 with latestProjection", async () => {
    const p = await startAwaiting();
    const gateId = p.openGate!.gateId;
    const body = () => ({ expectedStateVersion: p.stateVersion, requestId: rid() });
    expect((await reject(service.approveGate(ORG, OUTSIDER, p.instanceId, gateId, body()))).code).toBe("not_designated_approver");
    expect((await reject(service.approveGate(ORG, INITIATOR, p.instanceId, gateId, body()))).code).toBe("self_approval_forbidden");
    expect((await reject(service.denyGate(ORG, INITIATOR, p.instanceId, gateId, { ...body(), reason: "no" }))).code).toBe("self_approval_forbidden");
    expect((await reject(service.approveGate(ORG, "u-wf05-stranger", p.instanceId, gateId, body()))).code).toBe("workflow_not_found");
    const stale = await reject(service.approveGate(ORG, APPROVER_A, p.instanceId, gateId, { expectedStateVersion: p.stateVersion - 1, requestId: rid() }));
    expect(stale.code).toBe("state_version_conflict");
    expect(stale.details.latestProjection?.status).toBe("awaiting_gate_decision");
    expect((await reject(service.approveGate(ORG, APPROVER_A, p.instanceId, "nope-gate-1", body()))).code).toBe("gate_not_open");
    expect(toolCalls).toHaveLength(0);
    expect((await service.get(ORG, INITIATOR, p.instanceId)).openGate?.decision).toBeNull();
  });

  it("approve resumes execution: effect executes once through effect-gateway with approval provenance; instance succeeds", async () => {
    const p = await startAwaiting();
    const gateId = p.openGate!.gateId;
    const requestId = rid();
    const r = await service.approveGate(ORG, APPROVER_A, p.instanceId, gateId, { expectedStateVersion: p.stateVersion, requestId });
    const out = workflowRuntime.approveGate.out.parse(r);
    expect(out.gate).toMatchObject({ gateId, decision: "approved", decidedBy: APPROVER_A, reason: null, viewerCanDecide: false });
    expect(out.status).toBe("running");
    expect(out.stateVersion).toBe(p.stateVersion + 1);
    await service.drain();
    const done = await service.get(ORG, INITIATOR, p.instanceId);
    expect(done.status).toBe("succeeded");
    expect(done.stages.map((s) => s.status)).toEqual(["succeeded", "succeeded"]);
    expect(done.openGate).toBeNull();
    expect(toolCalls).toHaveLength(1);
    const receipts = await effectReceipts(p.instanceId);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.status).toBe("finalized");
    expect(receipts[0]!.stable_response.provenance).toMatchObject({ initiatorUserId: INITIATOR, approvalRequestId: gateId });
    const decided = (await events(p.instanceId)).filter((e) => e.type === "gate_decided");
    expect(decided).toHaveLength(1);
    expect(decided[0]!.data).toMatchObject({ gateId, decision: "approved", decidedBy: APPROVER_A });
    // 同 requestId 重试：得到首次稳定响应，不重复决定。
    const again = await service.approveGate(ORG, APPROVER_A, p.instanceId, gateId, { expectedStateVersion: p.stateVersion, requestId });
    expect(again).toEqual(r);
    expect(runErrors).toEqual([]);
  });

  it("A5: two approvers at once → exactly one wins, the other gets 409 gate_already_decided with decidedGate", async () => {
    const p = await startAwaiting();
    const gateId = p.openGate!.gateId;
    const [a, b] = await Promise.allSettled([
      service.approveGate(ORG, APPROVER_A, p.instanceId, gateId, { expectedStateVersion: p.stateVersion, requestId: rid() }),
      service.denyGate(ORG, APPROVER_B, p.instanceId, gateId, { expectedStateVersion: p.stateVersion, requestId: rid(), reason: "不同意" }),
    ]);
    const won = [a, b].filter((x) => x.status === "fulfilled");
    const lost = [a, b].filter((x): x is PromiseRejectedResult => x.status === "rejected");
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const err = lost[0]!.reason as WorkflowUseCaseError;
    expect(err).toBeInstanceOf(WorkflowUseCaseError);
    expect(err.code).toBe("gate_already_decided");
    expect(err.details.decidedGate?.gateId).toBe(gateId);
    expect(err.details.decidedGate?.decision).not.toBeNull();
    await service.drain();
    expect((await events(p.instanceId)).filter((e) => e.type === "gate_decided")).toHaveLength(1);
    // 之后的决定一律 gate_already_decided（门决定不可撤销，I-17）。
    const late = await reject(service.approveGate(ORG, APPROVER_A, p.instanceId, gateId, { expectedStateVersion: 999, requestId: rid() }));
    expect(late.code).toBe("gate_already_decided");
    // 库内兜底：直接插第二个决定也写不进去。
    const direct = await asOwner((c) =>
      c.query(
        `INSERT INTO workflow_events (instance_id, org_id, seq, type, state_version, stage_id, data)
         SELECT $1, $2, max(seq) + 1, 'gate_decided', 99, 'send', jsonb_build_object('gateId', $3::text) FROM workflow_events WHERE instance_id = $1`,
        [p.instanceId, ORG, gateId],
      ),
    ).then(() => null, (e: { code?: string }) => e.code);
    expect(direct).toBe("23505");
  });

  it("A4 deny: reason required; no effect receipt; reason in event log; onDeny null → instance rejected", async () => {
    const p = await startAwaiting();
    const gateId = p.openGate!.gateId;
    for (const reason of [undefined, "", "   "]) {
      const e = await reject(service.denyGate(ORG, APPROVER_A, p.instanceId, gateId, { expectedStateVersion: p.stateVersion, requestId: rid(), reason }));
      expect(e.code).toBe("deny_reason_required");
    }
    const r = workflowRuntime.denyGate.out.parse(
      await service.denyGate(ORG, APPROVER_B, p.instanceId, gateId, { expectedStateVersion: p.stateVersion, requestId: rid(), reason: "收件人不对" }),
    );
    expect(r.status).toBe("rejected");
    expect(r.gate).toMatchObject({ decision: "denied", decidedBy: APPROVER_B, reason: "收件人不对" });
    await service.drain();
    const done = await service.get(ORG, INITIATOR, p.instanceId);
    expect(done.status).toBe("rejected");
    expect(done.reasonCode).toBe("gate_denied");
    expect(done.stages.find((s) => s.stageId === "send")).toMatchObject({ status: "rejected", reasonCode: "gate_denied" });
    expect(toolCalls).toHaveLength(0);
    expect(workLog).toEqual([`${p.instanceId}:prepare`]);
    expect(await effectReceipts(p.instanceId)).toHaveLength(0);
    const decided = (await events(p.instanceId)).filter((e) => e.type === "gate_decided");
    expect(decided).toHaveLength(1);
    expect(decided[0]).toMatchObject({ reason_code: "gate_denied" });
    expect(decided[0]!.data).toMatchObject({ decision: "denied", reason: "收件人不对", decidedBy: APPROVER_B });
    expect((await reject(service.approveGate(ORG, APPROVER_A, p.instanceId, gateId, { expectedStateVersion: done.stateVersion, requestId: rid() }))).code).toBe(
      "gate_already_decided",
    );
  });

  it("A4 deny with forward onDenyStageId: gated stage rejected, stages in between skipped, fallback runs; no effect", async () => {
    const p = await startAwaiting("wf05-fwd");
    expect(p.stages.map((s) => s.status)).toEqual(["awaiting_gate_decision", "pending", "pending"]);
    const r = await service.denyGate(ORG, APPROVER_A, p.instanceId, p.openGate!.gateId, {
      expectedStateVersion: p.stateVersion,
      requestId: rid(),
      reason: "改走兜底",
    });
    expect(r.status).toBe("running");
    await service.drain();
    const done = await service.get(ORG, INITIATOR, p.instanceId);
    expect(done.status).toBe("succeeded");
    expect(done.stages.map((s) => [s.stageId, s.status])).toEqual([["send", "skipped"], ["extra", "skipped"], ["fallback", "succeeded"]]);
    expect(workLog).toEqual([`${p.instanceId}:fallback`]);
    expect(toolCalls).toHaveLength(0);
    expect(await effectReceipts(p.instanceId)).toHaveLength(0);
  });

  it("E4/V7: approve, then permission recheck fails at the effect → blocked_permission with reasonCode, tool never called", async () => {
    const p = await startAwaiting();
    await setCapabilityGrant(ORG, CATEGORY, { authorized: false });
    await service.approveGate(ORG, APPROVER_A, p.instanceId, p.openGate!.gateId, { expectedStateVersion: p.stateVersion, requestId: rid() });
    await service.drain();
    const done = await service.get(ORG, INITIATOR, p.instanceId);
    expect(done.status).toBe("blocked_permission");
    expect(done.reasonCode).toBe("tool_authorization_revoked");
    expect(done.stages.find((s) => s.stageId === "send")?.status).toBe("blocked_permission");
    expect(toolCalls).toHaveLength(0);
    expect(await effectReceipts(p.instanceId)).toHaveLength(0);
    expect(runErrors).toEqual([]);
  });
});

describe("WF05 human gate approve/deny (HTTP, demo-approval:1)", () => {
  const HORG = "org-wf05-http";
  const ALICE = "u-wf05-alice";
  const HAGENT = "agent-wf05-http";
  let e: Wf03App;

  beforeAll(async () => {
    e = await startWorkflowApp();
  }, 120_000);
  afterAll(async () => {
    await resetOrgs(HORG);
    await closeAppDeterministically(e?.app);
  });
  beforeEach(async () => {
    await resetOrgs(HORG);
    await seedWorkflowOrg(HORG, [{ userId: ALICE }], HAGENT);
    await setCapabilityGrant(HORG, CATEGORY, { sideEffectCap: "external_send" });
    await asOwner((c) => c.query("INSERT INTO workflow_definitions (org_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [HORG, DEMO_APPROVAL_WORKFLOW_KEY]));
    await publishDefinitionVersion(
      {
        definitions: new PgWorkflowDefinitionRepository(e.db),
        graphs: new WorkflowGraphRegistry(defaultWorkflowGraphs()),
        skills: UNRESOLVED_SKILL_VERSIONS,
        clock: { nowIso: () => new Date().toISOString() },
      },
      { orgId: HORG, actor: { userId: WF03_ADMIN, orgRole: "admin" }, pathKey: DEMO_APPROVAL_WORKFLOW_KEY, body: structuredClone(DEMO_APPROVAL_WORKFLOW_DEFINITION) },
    );
  });

  it("POST approve/deny: 403/422/200/409 with contract bodies; approved instance succeeds", async () => {
    const alice = as(e, ALICE, HORG);
    const admin = as(e, WF03_ADMIN, HORG);
    const s = await alice.post(`/workflows/${DEMO_APPROVAL_WORKFLOW_KEY}/instances`, { agentId: HAGENT, requestId: rid(), input: { topic: "发布会" } });
    expect(s.status).toBe(201);
    const id = s.body.instanceId as string;
    const waiting = await waitFor(
      () => alice.get<WorkflowInstanceProjection>(`/workflow-instances/${id}`),
      (r) => r.status === 200 && r.body.status === "awaiting_gate_decision",
    );
    const p = WorkflowInstanceProjection.parse(waiting.body);
    expect(p.openGate?.effectPreview).toEqual({ capabilityCategory: "mail.send", targetSystem: "mail", summary: "发布关于「发布会」的公告", payloadPreview: { topic: "发布会" } });
    const gatePath = (op: string) => `/workflow-instances/${id}/gates/${p.openGate!.gateId}/${op}`;

    const forbidden = await alice.post(gatePath("approve"), { expectedStateVersion: p.stateVersion, requestId: rid() });
    expect(forbidden.status).toBe(403);
    expect(WorkflowErrorBody.parse(forbidden.body).code).toBe("not_designated_approver");

    const noReason = await admin.post(gatePath("deny"), { expectedStateVersion: p.stateVersion, requestId: rid() });
    expect(noReason.status).toBe(422);
    expect(WorkflowErrorBody.parse(noReason.body).code).toBe("deny_reason_required");

    const ok = await admin.post(gatePath("approve"), { expectedStateVersion: p.stateVersion, requestId: rid() });
    expect(ok.status).toBe(200);
    expect(workflowRuntime.approveGate.out.parse(ok.body).gate.decision).toBe("approved");

    const second = await admin.post(gatePath("deny"), { expectedStateVersion: p.stateVersion, requestId: rid(), reason: "晚了" });
    expect(second.status).toBe(409);
    const body = WorkflowErrorBody.parse(second.body);
    expect(body.code).toBe("gate_already_decided");
    expect(body.decidedGate).toMatchObject({ decision: "approved", decidedBy: WF03_ADMIN });

    const done = await waitFor(() => alice.get<WorkflowInstanceProjection>(`/workflow-instances/${id}`), (r) => r.status === 200 && r.body.status === "succeeded");
    expect(done.body.stages.map((x: { status: string }) => x.status)).toEqual(["succeeded", "succeeded"]);
  });
});
