/**
 * WF03 / WF05 / WF08 读侧路由的真实 HTTP 面（kernel.module 合成、真实 PostgreSQL、进程内 worker）：
 * UC-WR-1 publish、UC-WR-2 runnable-workflows、UC-WR-5 GET /workflow-instances、UC-WR-9 retry、
 * UC-WR-10 GET /workflow-approvals。回归：这几条契约路由曾经没有实现（生产构建下 404「Cannot GET」）。
 * 可见性：成员只看到自己发起的实例；管理员看到本组织全部；待我审批只列本人是指定审批人的门。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { WorkflowErrorBody, WorkflowInstanceProjection, workflowRuntime } from "@repo/contracts/workflow-runtime";
import { publishBuiltInWorkflowDefinitions } from "../../src/application/workflow/publish-built-in-definitions";
import { builtInWorkflowDefinitions, defaultWorkflowGraphs, UNRESOLVED_SKILL_VERSIONS } from "../../src/infrastructure/workflow/create-workflow-runtime";
import { DEMO_APPROVAL_WORKFLOW_KEY } from "../../src/infrastructure/workflow/demo-approval-workflow-graph";
import { DEMO_WORKFLOW_DEFINITION, DEMO_WORKFLOW_KEY } from "../../src/infrastructure/workflow/demo-workflow-graph";
import { PgWorkflowDefinitionRepository } from "../../src/infrastructure/workflow/pg-workflow-definition-repository";
import { WorkflowGraphRegistry } from "../../src/infrastructure/workflow/workflow-graph-registry";
import { closeAppDeterministically } from "../support/close-app";
import { resetOrgs } from "../support/db";
import { seedWorkflowOrg, waitFor, WF03_ADMIN } from "./wf03-fixtures";
import { as, startWorkflowApp, type Wf03App } from "./wf03-http";

const ORG = "org-wf-list-api";
const OTHER_ORG = "org-wf-list-api-other";
const ALICE = "u-wf-list-alice";
const BOB = "u-wf-list-bob";
const AGENT = "agent-wf-list";
const C = workflowRuntime;

let seq = 0;
const rid = () => `req-wf-list-${Date.now()}-${++seq}`;

describe("workflow runtime list / runnable / publish / retry routes (HTTP)", () => {
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
    const definitions = new PgWorkflowDefinitionRepository(e.db);
    await publishBuiltInWorkflowDefinitions(
      { definitions, catalog: definitions, graphs: new WorkflowGraphRegistry(defaultWorkflowGraphs()), skills: UNRESOLVED_SKILL_VERSIONS, clock: { nowIso: () => new Date().toISOString() } },
      { orgId: ORG, actor: { userId: WF03_ADMIN, orgRole: "admin" }, definitions: builtInWorkflowDefinitions() },
    );
  });

  const alice = () => as(e, ALICE, ORG);
  const bob = () => as(e, BOB, ORG);
  const admin = () => as(e, WF03_ADMIN, ORG);
  const start = async (key: string, who = alice()) => {
    const r = await who.post(`/workflows/${key}/instances`, { agentId: AGENT, requestId: rid(), input: { topic: "列表" } });
    expect(r.status).toBe(201);
    return r.body.instanceId as string;
  };

  it("GET /workflow-instances: empty list is 200; members see only their own runs, admins see the org's; other orgs never leak", async () => {
    const empty = await alice().get("/workflow-instances");
    expect(empty.status).toBe(200);
    expect(C.listMyInstances.out.parse(empty.body)).toEqual({ items: [], nextCursor: null });

    const a1 = await start(DEMO_WORKFLOW_KEY);
    const a2 = await start(DEMO_WORKFLOW_KEY);
    const b1 = await start(DEMO_WORKFLOW_KEY, bob());

    const mine = C.listMyInstances.out.parse((await alice().get("/workflow-instances")).body);
    expect(mine.items.map((i) => i.instanceId).sort()).toEqual([a1, a2].sort());
    const bobs = C.listMyInstances.out.parse((await bob().get("/workflow-instances")).body);
    expect(bobs.items.map((i) => i.instanceId)).toEqual([b1]);
    const all = C.listMyInstances.out.parse((await admin().get("/workflow-instances")).body);
    expect(all.items.map((i) => i.instanceId).sort()).toEqual([a1, a2, b1].sort());
    // 同一个用户在另一个组织：看不到本组织的实例
    const other = C.listMyInstances.out.parse((await as(e, ALICE, OTHER_ORG).get("/workflow-instances")).body);
    expect(other.items).toEqual([]);

    // 先等运行落定（运行中 updated_at 会变，分页断言要在稳定数据上做）
    await waitFor(() => alice().get<WorkflowInstanceProjection>(`/workflow-instances/${a1}`), (r) => r.body.status === "succeeded");
    await waitFor(() => alice().get<WorkflowInstanceProjection>(`/workflow-instances/${a2}`), (r) => r.body.status === "succeeded");
    await waitFor(() => bob().get<WorkflowInstanceProjection>(`/workflow-instances/${b1}`), (r) => r.body.status === "succeeded");
    // 分页：limit=1 逐页取完，不重不漏
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const q: string = `/workflow-instances?limit=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page = C.listMyInstances.out.parse((await alice().get(q)).body);
      seen.push(...page.items.map((i) => i.instanceId));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen.sort()).toEqual([a1, a2].sort());

    // 状态筛选（逗号串，与 web 客户端同一编码）
    const succeeded = C.listMyInstances.out.parse((await alice().get("/workflow-instances?status=succeeded,failed")).body);
    expect(succeeded.items.map((i) => i.instanceId).sort()).toEqual([a1, a2].sort());
    const cancelled = C.listMyInstances.out.parse((await alice().get("/workflow-instances?status=cancelled")).body);
    expect(cancelled.items).toEqual([]);

    const bad = await alice().get("/workflow-instances?status=nope");
    expect(bad.status).toBe(400);
  }, 60_000);

  it("GET /workflow-approvals: the pending gate is listed for the designated approver only; includeDecided shows it after approval", async () => {
    expect((await admin().get("/workflow-approvals")).body).toEqual({ items: [] });
    const id = await start(DEMO_APPROVAL_WORKFLOW_KEY);
    await waitFor(() => alice().get<WorkflowInstanceProjection>(`/workflow-instances/${id}`), (r) => r.body.status === "awaiting_gate_decision");

    const forAdmin = await admin().get("/workflow-approvals");
    expect(forAdmin.status).toBe(200);
    const items = C.listMyApprovals.out.parse(forAdmin.body).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ instanceId: id, workflowKey: DEMO_APPROVAL_WORKFLOW_KEY, initiatorUserId: ALICE, agentId: AGENT });
    expect(items[0]!.gate).toMatchObject({ stageId: "publish", decision: null, viewerCanDecide: true });

    // 发起人（成员、非指定审批人）与无关成员都看不到这个门
    expect(C.listMyApprovals.out.parse((await alice().get("/workflow-approvals")).body).items).toEqual([]);
    expect(C.listMyApprovals.out.parse((await bob().get("/workflow-approvals")).body).items).toEqual([]);
    // 实例也不出现在无关成员的「我的运行」里
    expect(C.listMyInstances.out.parse((await bob().get("/workflow-instances")).body).items).toEqual([]);

    const p = WorkflowInstanceProjection.parse((await admin().get(`/workflow-instances/${id}`)).body);
    const ok = await admin().post(`/workflow-instances/${id}/gates/${p.openGate!.gateId}/approve`, { expectedStateVersion: p.stateVersion, requestId: rid() });
    expect(ok.status).toBe(200);
    expect(C.listMyApprovals.out.parse((await admin().get("/workflow-approvals")).body).items).toEqual([]);
    const decided = C.listMyApprovals.out.parse((await admin().get("/workflow-approvals?includeDecided=true")).body).items;
    expect(decided.map((i) => [i.instanceId, i.gate.decision])).toEqual([[id, "approved"]]);
  }, 60_000);

  it("GET /agents/:agentId/runnable-workflows lists the published built-ins for a runnable agent; unknown agent → 404", async () => {
    const r = await alice().get(`/agents/${AGENT}/runnable-workflows`);
    expect(r.status).toBe(200);
    const keys = C.listRunnableWorkflows.out.parse(r.body).items.map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining([DEMO_WORKFLOW_KEY, DEMO_APPROVAL_WORKFLOW_KEY]));
    const missing = await alice().get(`/agents/agent-does-not-exist/runnable-workflows`);
    expect(missing.status).toBe(404);
    expect(WorkflowErrorBody.parse(missing.body).code).toBe("workflow_not_found");
  });

  it("POST /workflows/:key/versions: admin publishes v2 (201, idempotent replay); members get 404", async () => {
    const v2 = { ...structuredClone(DEMO_WORKFLOW_DEFINITION), version: 2 };
    // graphRef 必须等于 key:version，而代码注册表只有 demo-brief:1 → definition_invalid（发布校验照常）
    const invalid = await admin().post(`/workflows/${DEMO_WORKFLOW_KEY}/versions`, { ...v2, graphRef: `${DEMO_WORKFLOW_KEY}:2` });
    expect(invalid.status).toBe(422);
    expect(WorkflowErrorBody.parse(invalid.body).code).toBe("definition_invalid");
    const replay = await admin().post(`/workflows/${DEMO_WORKFLOW_KEY}/versions`, structuredClone(DEMO_WORKFLOW_DEFINITION));
    expect(replay.status).toBe(201);
    expect(C.publishDefinitionVersion.out.parse(replay.body)).toMatchObject({ key: DEMO_WORKFLOW_KEY, version: 1, status: "published" });
    const member = await alice().post(`/workflows/${DEMO_WORKFLOW_KEY}/versions`, structuredClone(DEMO_WORKFLOW_DEFINITION));
    expect(member.status).toBe(404);
  });

  it("POST retry: invisible → 404, stale version → 409 with latestProjection, terminal → instance_terminal (canRetryStage is false everywhere)", async () => {
    const id = await start(DEMO_WORKFLOW_KEY);
    const p = WorkflowInstanceProjection.parse(
      (await waitFor(() => alice().get<WorkflowInstanceProjection>(`/workflow-instances/${id}`), (r) => r.body.status === "succeeded")).body,
    );
    expect(p.viewerCapabilities.canRetryStage).toBe(false);
    const path = `/workflow-instances/${id}/stages/draft/retry`;
    expect((await bob().post(path, { expectedStateVersion: p.stateVersion, requestId: rid() })).status).toBe(404);
    const stale = await alice().post(path, { expectedStateVersion: p.stateVersion + 7, requestId: rid() });
    expect(stale.status).toBe(409);
    expect(WorkflowErrorBody.parse(stale.body).latestProjection?.instanceId).toBe(id);
    const r = await alice().post(path, { expectedStateVersion: p.stateVersion, requestId: rid() });
    expect(r.status).toBe(409);
    expect(WorkflowErrorBody.parse(r.body).code).toBe("instance_terminal");
  }, 60_000);
});
