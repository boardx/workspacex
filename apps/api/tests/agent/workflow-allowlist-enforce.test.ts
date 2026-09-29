/**
 * AG05 —— Workflow 白名单执行校验（03-agent-role.md R3 / E3；契约束 agent-role UC-5 / I-9 / V6；ADR-118 #9）。
 *
 * 全部走生产路径，唯一的替身是 Agent 的模型（脚本化的 `ModelCallPort`，同 AG06 测试的做法）：
 *   真 PostgreSQL + 真 `createApp()`（kernel.module 合成）里的 **WF03 运行时单例**（`WORKFLOW_RUNTIME_SERVICE`）
 *   + 真 `executeQueuedRuns` + 真 `PgAgentRunRepository`。
 * 链路：Agent 调 `start_workflow` ⇒ 内核中断 ⇒ `tool-permission-gate` ⇒ `request-agent-workflow-start`
 *   （读 run 钉住的版本快照 workflowAllowlist）⇒ `WorkflowRuntimeService.start`（runStartCore 的全部准入）
 *   ⇒ 结果以 edit resume 交回同一个工具调用 ⇒ run 跑完。
 *
 * 覆盖：命中 → 建实例且实例真的在跑（W027 首阶段执行完、停在人工门）；E3 白名单外（D002→W027）拒绝、
 * 不建实例、不改走其它 Workflow、聊天文案 + 审计；钉住快照而非头版本；Runtime 已发布白名单同样把关；
 * 未发布；请求人无权限；参数无效（含想借非内容线 key 绕过白名单）；同一次工具调用重放只建 1 个实例；
 * 运行时未接线时如实拒绝；生产合成确实把运行时单例接进了 Agent 执行器。
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENT_RUN_EXECUTOR, type ModelCallCompletion, type ModelCallInput, type ModelCallPort } from "../../src/application/agent-run/ports";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import { RunNotAwaitingToolPermissionError, decideToolPermission } from "../../src/application/agent-run/decide-tool-permission";
import { AgentRunNotAwaitingToolPermissionError, decideAgentRun } from "../../src/application/agent-run/decide-agent-run";
import type { ReconciledRemoteRun } from "../../src/application/agent-run/run-recovery";
import { PgRunRecovery } from "../../src/infrastructure/agent-run/pg-run-recovery";
import { PgChatRepository } from "../../src/infrastructure/chat/pg-chat-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { publishDefinitionVersion } from "../../src/application/workflow/publish-definition-version";
import { WORKFLOW_RUNTIME_SERVICE, type WorkflowRuntimeService } from "../../src/application/workflow/workflow-runtime-service";
import { officialRoleWorkflowAllowlists } from "../../src/domain/agent/official-role-packs";
import { toOrgId } from "../../src/domain/org-id";
import { PRODUCT_LINE_WORKFLOWS, toRuntimeDefinition } from "../../src/domain/work-content/product-workflow-definitions";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { defaultWorkflowGraphs } from "../../src/infrastructure/workflow/create-workflow-runtime";
import { PgSkillCatalogVersionResolver } from "../../src/infrastructure/workflow/pg-skill-catalog-version-resolver";
import { PgWorkflowDefinitionRepository } from "../../src/infrastructure/workflow/pg-workflow-definition-repository";
import { WorkflowGraphRegistry } from "../../src/infrastructure/workflow/workflow-graph-registry";
import { closeAppDeterministically } from "../support/close-app";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addOrgMember, addProjectMember, asApp, asOwner, resetOrgs } from "../support/db";
import { WF03_ADMIN, seedWorkflowOrg, waitFor } from "../workflow/wf03-fixtures";
import { as, startWorkflowApp, type Wf03App } from "../workflow/wf03-http";

const ORG = toOrgId("org-ag05-allowlist");
const PROJECT = `proj-${ORG}`;
const REQUESTER = "u-ag05-requester";
const OUTSIDER = "u-ag05-outsider";
const D002 = "agent-ag05-d002";
const D003 = "agent-ag05-d003";
const DRIFT = "agent-ag05-drift"; // 钉住 v1 与头版本 v2 白名单不同
const ROLES = officialRoleWorkflowAllowlists();
const W027 = PRODUCT_LINE_WORKFLOWS.find((w) => w.workflowId === "W027")!;
const W028 = PRODUCT_LINE_WORKFLOWS.find((w) => w.workflowId === "W028")!;

let e: Wf03App;
let runtime: WorkflowRuntimeService;
let runs: PgAgentRunRepository;
const calls: ModelCallInput[] = [];
let script: ModelCallCompletion[] = [];
const model: ModelCallPort = {
  async complete(input) {
    calls.push(input);
    const next = script.shift();
    if (!next) throw new Error("unexpected model call");
    return next;
  },
};

function deps(workflowStarts: ExecuteAgentRunDeps["workflowStarts"]): ExecuteAgentRunDeps {
  let n = 0;
  return {
    runs, model, log: () => {}, workflowStarts,
    clock: { now: () => new Date().toISOString(), newStepId: () => `step-ag05-${n++}` },
  } as unknown as ExecuteAgentRunDeps;
}

async function insertAgentVersion(agentId: string, versionId: string, allowlist: readonly string[], publish: boolean): Promise<void> {
  await asApp(ORG, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$1,$1,'enabled',$3,now(),now()) ON CONFLICT DO NOTHING`,
      [agentId, ORG, WF03_ADMIN],
    );
    await c.query(
      `INSERT INTO agent_versions
        (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
         model_provider,model_id,tool_policy,creator_id,created_at,published_at,catalog_source,workflow_allowlist)
       VALUES ($1,$2,$3,$1,$4,'角色','{}'::text[],'deep-agent','deep-agent','[]'::jsonb,$5,now(),now(),'official',$6)`,
      [versionId, ORG, agentId, "d".repeat(64), WF03_ADMIN, [...allowlist]],
    );
    if (publish) await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [versionId, agentId, ORG]);
  });
}

/** 一条 queued run：钉住 `versionId`，触发消息作者 = `author`；每条 run 独立线程。 */
async function seedQueuedRun(id: string, agentId: string, versionId: string, author = REQUESTER): Promise<void> {
  const thread = `thread-${id}`;
  await addChatThread({ orgId: ORG, id: thread, projectId: PROJECT, visibilityScope: "plenary", createdBy: author });
  await addChatMessage({ orgId: ORG, id: `${id}-in`, threadId: thread, body: "帮我发起流程", authorId: author });
  await asApp(ORG, (c) => c.query(
    `INSERT INTO agent_runs (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
       skill_version_ids, model_provider, model_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,'[]'::jsonb,'deep-agent','deep-agent','queued')`,
    [id, ORG, thread, `${id}-in`, agentId, versionId]));
}

const startCall = (args: Record<string, unknown>, toolCallId = `call-${randomUUID()}`): ModelCallCompletion => ({
  text: "",
  interrupted: { toolName: "start_workflow", toolCallId, argsSummary: JSON.stringify(args) },
});

interface Outcome { status: "started" | "refused"; code?: string; instanceId?: string; workflowId: string | null; handoffCandidates?: string[]; message: string }

/** 跑一轮：Agent 调 start_workflow → 网关判定 → edit resume → Agent 回复。返回交回工具的 outcome。 */
async function agentRequests(runId: string, args: Record<string, unknown>, opts: { toolCallId?: string; unwired?: boolean } = {}): Promise<Outcome> {
  calls.length = 0;
  script = [startCall(args, opts.toolCallId), { text: "好的。" }];
  const d = deps(opts.unwired ? undefined : runtime);
  await executeQueuedRuns(d, { orgId: ORG });
  if ((await runRow(runId)).status === "queued") await executeQueuedRuns(d, { orgId: ORG });
  expect(calls, "中断 + edit resume 共两次模型调用").toHaveLength(2);
  const resume = calls[1]!.resume as { decision: string; editedAction: { name: string; argsJson: string } };
  expect(resume.decision).toBe("edit");
  expect(resume.editedAction.name).toBe("start_workflow");
  expect((await runRow(runId)).status, "resume 之后 run 跑完进入写回").toBe("writeback_pending");
  return (JSON.parse(resume.editedAction.argsJson) as { outcome: Outcome }).outcome;
}

async function runRow(id: string) {
  return asApp(ORG, async (c) => (await c.query<{ status: string }>("SELECT status FROM agent_runs WHERE id=$1", [id])).rows[0]!);
}

async function auditNotes(runId: string): Promise<string[]> {
  const r = await asApp(ORG, (c) => c.query<{ planning_note: string | null }>(
    "SELECT planning_note FROM agent_run_steps WHERE run_id=$1 AND planning_note LIKE 'Agent 发起 Workflow%' ORDER BY seq", [runId]));
  return r.rows.map((x) => x.planning_note!);
}

/** 本组织全部实例 id（状态会随后台推进变化，比较「有没有新实例」只看 id）。 */
async function instanceIds(): Promise<string[]> {
  return (await instances()).map((x) => x.id);
}

async function instances(): Promise<{ id: string; key: string; agent_id: string; initiator_user_id: string; status: string }[]> {
  const r = await asApp(ORG, (c) => c.query<{ id: string; key: string; agent_id: string; initiator_user_id: string; status: string }>(
    "SELECT id, workflow_key AS key, agent_id, initiator_user_id, status FROM workflow_instances WHERE org_id=$1 ORDER BY created_at, id", [ORG]));
  return r.rows;
}

beforeAll(async () => {
  e = await startWorkflowApp({ SKILL_STARTER_PACK_ROOT: resolve(__dirname, "../../../../skills/starter-packs") });
  runtime = e.app.get<WorkflowRuntimeService>(WORKFLOW_RUNTIME_SERVICE);
  runs = new PgAgentRunRepository(e.db);
  await resetOrgs(ORG);
  await seedWorkflowOrg(ORG, [{ userId: REQUESTER }, { userId: OUTSIDER }], "agent-ag05-plain");
  await addProjectMember(ORG, PROJECT, REQUESTER, "member", null);
  await addProjectMember(ORG, PROJECT, OUTSIDER, "member", null);
  // 官方角色白名单逐字取自官方角色包（同一份种子），不在测试里另抄。
  await insertAgentVersion(D002, `${D002}-v1`, ROLES.D002!, true);
  await insertAgentVersion(D003, `${D003}-v1`, ROLES.D003!, true);
  // DRIFT：v1（钉给旧 run）不含 W027，头版本 v2 含 W027。
  await insertAgentVersion(DRIFT, `${DRIFT}-v1`, ["W028"], false);
  await insertAgentVersion(DRIFT, `${DRIFT}-v2`, ["W027", "W028"], true);

  // Skill 目录：真实 starter-pack 导入；W027 经 UC-WR-1 发布；W028 只有 Definition 行、没有已发布版本。
  const imported = await as(e, WF03_ADMIN, ORG).post("/admin/skills/starter-pack-imports", { packId: "work-product", packVersion: "1.0.0", idempotencyKey: randomUUID() });
  expect(imported.status).toBe(201);
  for (const def of [W027, W028]) {
    await asOwner((c) => c.query("INSERT INTO workflow_definitions (org_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [ORG, def.key]));
  }
  await publishDefinitionVersion(
    {
      definitions: new PgWorkflowDefinitionRepository(e.db),
      graphs: new WorkflowGraphRegistry(defaultWorkflowGraphs()),
      skills: new PgSkillCatalogVersionResolver(e.db),
      clock: { nowIso: () => new Date().toISOString() },
    },
    { orgId: ORG, actor: { userId: WF03_ADMIN, orgRole: "admin" }, pathKey: W027.key, body: toRuntimeDefinition(W027) },
  );
}, 180_000);

afterAll(async () => {
  await runtime?.drain();
  await resetOrgs(ORG);
  await closeAppDeterministically(e?.app);
});

describe("AG05 · Agent 经 start_workflow 发起 Workflow（真 WF03 运行时）", () => {
  it("生产合成：Agent 执行器拿到的就是 WF03 运行时单例（不是替身、不是缺省）", () => {
    const executor = e.app.get(AGENT_RUN_EXECUTOR) as unknown as { workflowStarts?: unknown };
    expect(executor.workflowStarts).toBe(runtime);
  });

  it("命中白名单（D003→W027）：以请求人 + 该 Agent 建实例，Skill 版本由 Workflow 固定，实例真的在跑", async () => {
    const before = (await instances()).length;
    await seedQueuedRun("run-ag05-hit", D003, `${D003}-v1`);
    const outcome = await agentRequests("run-ag05-hit", { workflowId: "W027", input: { topic: "新用户流失" } });
    expect(outcome).toMatchObject({ status: "started", workflowId: "W027" });
    expect(outcome.message).toContain("已发起流程 W027");

    const created = (await instances()).slice(before);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ id: outcome.instanceId, key: W027.key, agent_id: D003, initiator_user_id: REQUESTER });

    // 真的在跑：首阶段执行完、停在人工门 G1（W027 §5 阶段表），经 WF03 读侧投影可见。
    const p = await waitFor(() => runtime.get(ORG, REQUESTER, outcome.instanceId!), (x) => x.status === "awaiting_gate_decision", 30_000);
    const first = p.stages.find((s) => s.stageId === "hypothesize")!;
    expect(first.status).toBe("awaiting_gate_decision");
    expect(p.openGate?.stageId).toBe("hypothesize");
    const events = await asApp(ORG, (c) => c.query<{ type: string }>("SELECT type FROM workflow_events WHERE instance_id=$1 ORDER BY seq", [outcome.instanceId]));
    expect(events.rows.map((x) => x.type)).toEqual(expect.arrayContaining(["instance_started", "gate_opened"]));
    const pins = await asApp(ORG, (c) => c.query<{ pinned_skills: { stableId: string; version: string }[] }>(
      "SELECT pinned_skills FROM workflow_instances WHERE id=$1", [outcome.instanceId]));
    expect(pins.rows[0]!.pinned_skills.map((x) => `${x.stableId}@${x.version}`)).toContain("S061@1.0.0");

    expect(await auditNotes("run-ag05-hit")).toEqual([`Agent 发起 Workflow W027：已创建实例 ${outcome.instanceId}`]);
  });

  it("E3：D002 请求 W027（白名单外）⇒ workflow_not_allowed，不建实例、不改走其它 Workflow，聊天文案 + 审计", async () => {
    const before = await instanceIds();
    await seedQueuedRun("run-ag05-deny", D002, `${D002}-v1`);
    const outcome = await agentRequests("run-ag05-deny", { workflowId: "W027", input: {} });
    expect(outcome).toMatchObject({ status: "refused", code: "workflow_not_allowed", workflowId: "W027" });
    expect(outcome.handoffCandidates).toEqual(["D003", "D011"]);
    expect(outcome.message).toContain("该角色不能发起此流程");
    expect(outcome.message).not.toMatch(/workflow_not_allowed/);
    expect(await instanceIds(), "任何 Workflow 都没有新实例").toEqual(before);
    const notes = await auditNotes("run-ag05-deny");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("W027 被拒绝");
    expect(notes[0]).toContain("该角色不能发起此流程");
  });

  it("E3：D002 请求白名单内的 W001 ⇒ 通过白名单，交给 WF03 运行时判定（本组织无该 Definition ⇒ 如实 not_found，不建实例）", async () => {
    const before = await instanceIds();
    await seedQueuedRun("run-ag05-w001", D002, `${D002}-v1`);
    const outcome = await agentRequests("run-ag05-w001", { workflowId: "W001", input: {} });
    expect(outcome).toMatchObject({ status: "refused", code: "workflow_not_found", workflowId: "W001" });
    expect(await instanceIds()).toEqual(before);
  });

  it("读 run 钉住的版本快照，不读头版本：钉 v1（无 W027）而头版本 v2 含 W027 ⇒ 仍拒绝", async () => {
    const before = await instanceIds();
    await seedQueuedRun("run-ag05-pinned", DRIFT, `${DRIFT}-v1`);
    const outcome = await agentRequests("run-ag05-pinned", { workflowId: "W027", input: {} });
    expect(outcome).toMatchObject({ status: "refused", code: "workflow_not_allowed" });
    expect(await instanceIds()).toEqual(before);
  });

  it("WF03 同样把关：钉住快照含 W027、但 Agent 已发布版本不含 ⇒ Runtime 以 workflow_not_allowed 拒绝", async () => {
    const before = await instanceIds();
    await insertAgentVersion("agent-ag05-narrowed", "agent-ag05-narrowed-v1", ["W027"], false);
    await insertAgentVersion("agent-ag05-narrowed", "agent-ag05-narrowed-v2", ["W028"], true);
    await seedQueuedRun("run-ag05-narrowed", "agent-ag05-narrowed", "agent-ag05-narrowed-v1");
    const outcome = await agentRequests("run-ag05-narrowed", { workflowId: "W027", input: {} });
    expect(outcome).toMatchObject({ status: "refused", code: "workflow_not_allowed", workflowId: "W027" });
    expect(await instanceIds()).toEqual(before);
  });

  it("未发布：白名单内的 W028 只有 Definition、没有已发布版本 ⇒ workflow_version_not_published，不建实例", async () => {
    const before = await instanceIds();
    await seedQueuedRun("run-ag05-unpublished", D003, `${D003}-v1`);
    const outcome = await agentRequests("run-ag05-unpublished", { workflowId: "W028", input: {} });
    expect(outcome).toMatchObject({ status: "refused", code: "workflow_version_not_published", workflowId: "W028" });
    expect(outcome.message).toContain("尚未发布");
    expect(await instanceIds()).toEqual(before);
  });

  it("无权限：请求人已不是本组织成员 ⇒ WF03 准入拒绝，不建实例", async () => {
    const before = await instanceIds();
    await seedQueuedRun("run-ag05-outsider", D003, `${D003}-v1`, OUTSIDER);
    await asOwner((c) => c.query("DELETE FROM org_memberships WHERE org_id=$1 AND user_id=$2", [ORG, OUTSIDER]));
    try {
      const outcome = await agentRequests("run-ag05-outsider", { workflowId: "W027", input: {} });
      expect(outcome.status).toBe("refused");
      expect(["workflow_not_found", "workflow_not_allowed"]).toContain(outcome.code);
      expect(await instanceIds()).toEqual(before);
    } finally {
      await addOrgMember(ORG, OUTSIDER, "consultant", null);
    }
  });

  it("无权限：Agent 已停用 ⇒ WF03 runnableAgentVersion 拒绝（workflow_not_allowed），不建实例", async () => {
    const before = await instanceIds();
    await seedQueuedRun("run-ag05-disabled", D003, `${D003}-v1`);
    await asApp(ORG, (c) => c.query("UPDATE agents SET status='disabled' WHERE id=$1 AND org_id=$2", [D003, ORG]));
    try {
      const outcome = await agentRequests("run-ag05-disabled", { workflowId: "W027", input: {} });
      expect(outcome).toMatchObject({ status: "refused", code: "workflow_not_allowed" });
      expect(await instanceIds()).toEqual(before);
    } finally {
      await asApp(ORG, (c) => c.query("UPDATE agents SET status='enabled' WHERE id=$1 AND org_id=$2", [D003, ORG]));
    }
  });

  it("参数无效 / 想用非内容线 key 绕过白名单（demo-brief）⇒ trigger_input_invalid，不建实例", async () => {
    const before = await instanceIds();
    await seedQueuedRun("run-ag05-badargs", D003, `${D003}-v1`);
    const outcome = await agentRequests("run-ag05-badargs", { workflowId: "demo-brief", input: {} });
    expect(outcome).toMatchObject({ status: "refused", code: "trigger_input_invalid", workflowId: null });
    await seedQueuedRun("run-ag05-badinput", D003, `${D003}-v1`);
    const second = await agentRequests("run-ag05-badinput", { workflowId: "W027", input: ["not", "an", "object"] });
    expect(second).toMatchObject({ status: "refused", code: "trigger_input_invalid" });
    expect(await instanceIds()).toEqual(before);
  });

  it("同一次工具调用重放（同 run + 同 toolCallId）命中 WF03 幂等：只有 1 个实例", async () => {
    await seedQueuedRun("run-ag05-replay-a", D003, `${D003}-v1`);
    const first = await agentRequests("run-ag05-replay-a", { workflowId: "W027", input: { topic: "x" } }, { toolCallId: "call-fixed" });
    const count = (await instances()).length;
    // 直接重放同一个用例（崩溃恢复后同一个中断再被判定一次）。
    const { requestAgentWorkflowStart } = await import("../../src/application/agent/request-agent-workflow-start");
    const replay = await requestAgentWorkflowStart({ runs, workflows: runtime }, {
      orgId: ORG, runId: "run-ag05-replay-a", toolCallId: "call-fixed", argsJson: JSON.stringify({ workflowId: "W027", input: { topic: "x" } }),
    });
    expect(replay).toMatchObject({ status: "started", instanceId: first.instanceId });
    expect((await instances()).length).toBe(count);
  });

  it("缺工具调用 id ⇒ 无法保证幂等键唯一，如实拒绝不发起", async () => {
    const before = await instanceIds();
    const { requestAgentWorkflowStart } = await import("../../src/application/agent/request-agent-workflow-start");
    await seedQueuedRun("run-ag05-noid", D003, `${D003}-v1`);
    const out = await requestAgentWorkflowStart({ runs, workflows: runtime }, { orgId: ORG, runId: "run-ag05-noid", argsJson: JSON.stringify({ workflowId: "W027", input: {} }) });
    expect(out).toMatchObject({ status: "refused", code: "workflow_runtime_unavailable" });
    await runs.failRun(ORG, "run-ag05-noid", "MODEL_CALL_FAILED"); // 不留给后续用例的执行器领走
    expect(await instanceIds()).toEqual(before);
  });

  it("状态机：running → queued(edit) 只放行 start_workflow，其它工具名被 DB 拒绝", async () => {
    await seedQueuedRun("run-ag05-edge", D003, `${D003}-v1`);
    await asApp(ORG, (c) => c.query("UPDATE agent_runs SET status='running', started_at=now() WHERE org_id=$1 AND id=$2", [ORG, "run-ag05-edge"]));
    await expect(runs.requeueToolCallWithResult(ORG, "run-ag05-edge", { toolName: "execute", argsSummary: null }, "{}")).rejects.toThrow(/may not move/);
    expect(await runs.requeueToolCallWithResult(ORG, "run-ag05-edge", { toolName: "start_workflow", argsSummary: null }, "{}")).toBe(true);
    await runs.failRun(ORG, "run-ag05-edge", "MODEL_CALL_FAILED"); // 不留给后续用例的执行器领走
  });

  it("运行时未接线 ⇒ 如实拒绝（不假装发起），不建实例", async () => {
    const before = await instanceIds();
    await seedQueuedRun("run-ag05-unwired", D003, `${D003}-v1`);
    const outcome = await agentRequests("run-ag05-unwired", { workflowId: "W027", input: {} }, { unwired: true });
    expect(outcome).toMatchObject({ status: "refused", code: "workflow_runtime_unavailable" });
    expect(await instanceIds()).toEqual(before);
  });
});

describe("AG05 · 结果只由服务端算出：恢复路径与通用裁决通路不能替它编结果", () => {
  async function pendingRow(id: string) {
    return asApp(ORG, async (c) => (await c.query<{ status: string; pending_decision: string | null; pending_tool_name: string | null; pending_permission_request_id: string | null }>(
      "SELECT status, pending_decision, pending_tool_name, pending_permission_request_id FROM agent_runs WHERE id=$1", [id])).rows[0]!);
  }

  async function recoverAt(id: string, toolCallId: string, args: Record<string, unknown>): Promise<Outcome> {
    await asApp(ORG, (c) => c.query(
      `UPDATE agent_runs SET status='running', started_at=now()-interval '1 minute', heartbeat_at=now()-interval '1 minute',
         lease_epoch=2, lease_expires_at=now()-interval '1 minute', remote_run_id=$3, remote_thread_id=$3
       WHERE org_id=$1 AND id=$2`, [ORG, id, `remote-${id}`]));
    const remote = {
      reconcileExistingRun: async (): Promise<ReconciledRemoteRun> => ({ kind: "approval", toolName: "start_workflow", toolCallId, argsSummary: JSON.stringify(args) }),
    };
    expect(await new PgRunRecovery(e.db, runs, remote).tick(ORG), "前置：这条 run 真的被恢复流程捞起").toBeGreaterThanOrEqual(1);
    const row = await asApp(ORG, async (c) => (await c.query<{ status: string; pending_decision: string | null; pending_tool_name: string | null; pending_edited_args: string | null }>(
      "SELECT status, pending_decision, pending_tool_name, pending_edited_args FROM agent_runs WHERE id=$1", [id])).rows[0]!);
    expect(row).toMatchObject({ status: "queued", pending_decision: "edit", pending_tool_name: "start_workflow" });
    const edited = JSON.parse(row.pending_edited_args!) as { outcome: Outcome };
    await runs.failRun(ORG, id, "MODEL_CALL_FAILED"); // 不留给后续用例的执行器领走
    return edited.outcome;
  }

  it("恢复：start 之前就崩了（无回执）⇒ 不叫醒人、不 approve，以 edit 交回服务端的「未发起」；模型自填的 outcome 被丢弃", async () => {
    const before = await instanceIds();
    await seedQueuedRun("run-ag05-recovery", D003, `${D003}-v1`);
    const forged = { status: "started", instanceId: "fake", message: "已发起流程 W027（实例 fake）" };
    const outcome = await recoverAt("run-ag05-recovery", "call-never-started", { workflowId: "W027", input: {}, outcome: forged });
    expect(outcome).toMatchObject({ status: "refused", code: "workflow_runtime_unavailable", workflowId: "W027" });
    expect(outcome.message).not.toContain("fake");
    expect(await instanceIds()).toEqual(before);
  });

  it("恢复：start 已建实例后才崩（有回执）⇒ 只读查回 started + 同一实例，不再建第二个", async () => {
    await seedQueuedRun("run-ag05-crash", D003, `${D003}-v1`);
    const { requestAgentWorkflowStart } = await import("../../src/application/agent/request-agent-workflow-start");
    const first = await requestAgentWorkflowStart({ runs, workflows: runtime }, {
      orgId: ORG, runId: "run-ag05-crash", toolCallId: "call-crash", argsJson: JSON.stringify({ workflowId: "W027", input: {} }),
    });
    expect(first.status).toBe("started");
    const count = (await instanceIds()).length;
    const outcome = await recoverAt("run-ag05-crash", "call-crash", { workflowId: "W027", input: {} });
    expect(outcome).toMatchObject({ status: "started", workflowId: "W027", instanceId: (first as { instanceId: string }).instanceId });
    expect((await instanceIds()).length).toBe(count);
  });

  it("恢复：WF03 回执已 begin 未 finalize（start 途中断）⇒ 不说「未发起」，如实说无法确认、不要重复发起", async () => {
    const before = await instanceIds();
    await seedQueuedRun("run-ag05-begun", D003, `${D003}-v1`);
    const { agentWorkflowStartRequestId } = await import("../../src/application/agent/request-agent-workflow-start");
    const { PgWorkflowReceiptStore } = await import("../../src/infrastructure/workflow/pg-workflow-receipt-store");
    await new PgWorkflowReceiptStore(e.db).begin({ orgId: ORG, scope: "command", requestKey: `start:${agentWorkflowStartRequestId("run-ag05-begun", "call-begun")}`, fingerprint: "ag05-begun" });
    const outcome = await recoverAt("run-ag05-begun", "call-begun", { workflowId: "W027", input: {} });
    expect(outcome).toMatchObject({ status: "refused", code: "workflow_start_unconfirmed", workflowId: "W027" });
    expect(outcome.message).toContain("无法确认");
    expect(await instanceIds()).toEqual(before);
  });

  it("存储不支持把结果交回内核 ⇒ 在 WF03 start 之前就按 KERNEL_UNAVAILABLE 失败，不先建实例", async () => {
    const before = await instanceIds();
    const id = "run-ag05-no-requeue";
    await seedQueuedRun(id, D003, `${D003}-v1`);
    calls.length = 0;
    script = [startCall({ workflowId: "W027", input: {} }, "call-no-requeue"), { text: "好的。" }];
    const noRequeue = new Proxy(runs, { get: (t, k) => (k === "requeueToolCallWithResult" ? undefined : Reflect.get(t, k, t)) });
    await executeQueuedRuns({ ...deps(runtime), runs: noRequeue } as ExecuteAgentRunDeps, { orgId: ORG });
    const row = await asApp(ORG, async (c) => (await c.query<{ status: string; error_code: string | null }>(
      "SELECT status, error_code FROM agent_runs WHERE id=$1", [id])).rows[0]!);
    expect(row).toEqual({ status: "failed", error_code: "KERNEL_UNAVAILABLE" });
    expect(await instanceIds()).toEqual(before);
  });

  it("通用裁决通路对待决的 start_workflow 拒绝 edit 与 approve、工具授权通路拒绝放行（结果只由服务端算出），run 原样不动", async () => {
    const id = "run-ag05-generic-edit";
    await seedQueuedRun(id, D003, `${D003}-v1`);
    await asApp(ORG, (c) => c.query("UPDATE agent_runs SET status='running', started_at=now() WHERE org_id=$1 AND id=$2", [ORG, id]));
    await runs.markAwaitingToolPermission(ORG, id, { toolName: "start_workflow", argsSummary: JSON.stringify({ workflowId: "W027", input: {} }), interrupt: null });
    const pending = await pendingRow(id);
    const forged = { workflowId: "W027", input: {}, outcome: { status: "started", instanceId: "fake", message: "已发起流程 W027（实例 fake）" } };
    const approveErr = await decideAgentRun(
      { repo: new PgIdentityRepository(e.db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(e.db), runs, kick: () => {} },
      { userId: REQUESTER, orgId: ORG, runId: id, permissionRequestId: pending.pending_permission_request_id!, decision: "approve" },
    ).catch((x: unknown) => x);
    expect((approveErr as AgentRunNotAwaitingToolPermissionError).status).toBe("workflow_start_outcome_is_server_computed");
    for (const decision of ["once", "run", "forever"] as const) {
      const grantErr = await decideToolPermission(
        { repo: new PgIdentityRepository(e.db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(e.db), runs, kick: () => {} },
        { userId: REQUESTER, orgId: ORG, runId: id, permissionRequestId: pending.pending_permission_request_id!, decision },
      ).catch((x: unknown) => x);
      expect((grantErr as RunNotAwaitingToolPermissionError).status, `工具授权通路 ${decision} 同样被拒`).toBe("workflow_start_outcome_is_server_computed");
    }
    const err = await decideAgentRun(
      { repo: new PgIdentityRepository(e.db), ids: new CountingDecisionIdFactory(), chat: new PgChatRepository(e.db), runs, kick: () => {} },
      { userId: REQUESTER, orgId: ORG, runId: id, permissionRequestId: pending.pending_permission_request_id!, decision: "edit", editedArgs: forged },
    ).catch((x: unknown) => x);
    expect(err).toBeInstanceOf(AgentRunNotAwaitingToolPermissionError);
    expect((err as AgentRunNotAwaitingToolPermissionError).status).toBe("workflow_start_outcome_is_server_computed");
    expect(await pendingRow(id)).toEqual(pending);
  });
});
