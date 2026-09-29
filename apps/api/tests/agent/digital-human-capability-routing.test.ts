/**
 * 数字人能力（人类决策 B）：钉 dashscope / qwen-plus 的官方数字人形状 Agent，带 Workflow 白名单 ⇒
 * run 经 deep-agent 运行时执行（ModelCallInput.modelProvider = deep-agent，modelId 仍是钉住的 qwen-plus），
 * `start_workflow` 走既有网关：白名单内 ⇒ 建实例；白名单外 ⇒ 友好的 workflow_not_allowed。
 * 普通 Agent（无白名单、无 Skill）⇒ 路由不变。库里的钉住事实（model_provider）不改。
 * 真 PostgreSQL + 真 createApp() 的 WF03 运行时 + 真 executeQueuedRuns；唯一替身是模型端口。
 */
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ModelCallCompletion, ModelCallInput, ModelCallPort } from "../../src/application/agent-run/ports";
import { executeQueuedRuns, type ExecuteAgentRunDeps } from "../../src/application/agent-run/execute-run";
import { writeBackPendingRuns } from "../../src/application/agent-run/writeback";
import { publishDefinitionVersion } from "../../src/application/workflow/publish-definition-version";
import { WORKFLOW_RUNTIME_SERVICE, type WorkflowRuntimeService } from "../../src/application/workflow/workflow-runtime-service";
import { officialRoleWorkflowAllowlists } from "../../src/domain/agent/official-role-packs";
import { toOrgId } from "../../src/domain/org-id";
import { PRODUCT_LINE_WORKFLOWS, toRuntimeDefinition } from "../../src/domain/work-content/product-workflow-definitions";
import { PgRunRecovery } from "../../src/infrastructure/agent-run/pg-run-recovery";
import { PgAgentRunRepository } from "../../src/infrastructure/agent-run/pg-agent-run-repository";
import { defaultWorkflowGraphs } from "../../src/infrastructure/workflow/create-workflow-runtime";
import { PgSkillCatalogVersionResolver } from "../../src/infrastructure/workflow/pg-skill-catalog-version-resolver";
import { PgWorkflowDefinitionRepository } from "../../src/infrastructure/workflow/pg-workflow-definition-repository";
import { WorkflowGraphRegistry } from "../../src/infrastructure/workflow/workflow-graph-registry";
import { closeAppDeterministically } from "../support/close-app";
import { addChatMessage, addChatThread } from "../support/chat-db";
import { addProjectMember, asApp, asOwner, resetOrgs } from "../support/db";
import { WF03_ADMIN, seedWorkflowOrg } from "../workflow/wf03-fixtures";
import { as, startWorkflowApp, type Wf03App } from "../workflow/wf03-http";

const ORG = toOrgId("org-dh-capability");
const PROJECT = `proj-${ORG}`;
const REQUESTER = "u-dh-requester";
const D002 = "agent-dh-d002";
const D003 = "agent-dh-d003";
const PLAIN = "agent-dh-plain";
const ROLES = officialRoleWorkflowAllowlists();
const W027 = PRODUCT_LINE_WORKFLOWS.find((w) => w.workflowId === "W027")!;

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
  // 同 RoutingModelCallPort：内核 LLM 端点同样提供 dashscope。
  servesViaKernelRuntime: (p) => p === "dashscope",
};

const logs: unknown[] = [];
function deps(): ExecuteAgentRunDeps {
  let n = 0;
  return {
    runs, model, log: (msg: string, detail?: unknown) => { logs.push({ msg, detail }); }, workflowStarts: runtime,
    clock: { now: () => new Date().toISOString(), newStepId: () => `step-dh-${n++}` },
  } as unknown as ExecuteAgentRunDeps;
}

async function insertDashscopeAgent(agentId: string, allowlist: readonly string[]): Promise<void> {
  const versionId = `${agentId}-v1`;
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
       VALUES ($1,$2,$3,$1,$4,'角色','{}'::text[],'dashscope','qwen-plus','[]'::jsonb,$5,now(),now(),'official',$6)`,
      [versionId, ORG, agentId, "d".repeat(64), WF03_ADMIN, [...allowlist]],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [versionId, agentId, ORG]);
  });
}

async function seedQueuedRun(id: string, agentId: string, runSkillVersionIds: readonly string[] = []): Promise<void> {
  const thread = `thread-${id}`;
  await addChatThread({ orgId: ORG, id: thread, projectId: PROJECT, visibilityScope: "plenary", createdBy: REQUESTER });
  await addChatMessage({ orgId: ORG, id: `${id}-in`, threadId: thread, body: "帮我发起流程", authorId: REQUESTER });
  await asApp(ORG, (c) => c.query(
    `INSERT INTO agent_runs (id, org_id, thread_id, input_message_id, agent_id, agent_version_id,
       skill_version_ids, model_provider, model_id, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,'dashscope','qwen-plus','queued')`,
    [id, ORG, thread, `${id}-in`, agentId, `${agentId}-v1`, JSON.stringify(runSkillVersionIds)]));
}

async function runRow(id: string) {
  return asApp(ORG, async (c) => (await c.query<{ status: string; model_provider: string; model_id: string; error_code?: string | null }>(
    "SELECT status, model_provider, model_id, error_code FROM agent_runs WHERE id=$1", [id])).rows[0]!);
}

async function instanceIds(): Promise<string[]> {
  const r = await asApp(ORG, (c) => c.query<{ id: string }>("SELECT id FROM workflow_instances WHERE org_id=$1 ORDER BY id", [ORG]));
  return r.rows.map((x) => x.id);
}

interface Outcome { status: string; code?: string; instanceId?: string; workflowId: string | null; message: string }

async function agentRequestsWorkflow(runId: string, workflowId: string): Promise<Outcome> {
  calls.length = 0;
  script = [
    { text: "", interrupted: { toolName: "start_workflow", toolCallId: `call-${randomUUID()}`, argsSummary: JSON.stringify({ workflowId, input: { topic: "新用户流失" } }) } },
    { text: "好的。" },
  ];
  await executeQueuedRuns(deps(), { orgId: ORG });
  if ((await runRow(runId)).status === "queued") await executeQueuedRuns(deps(), { orgId: ORG });
  expect({ n: calls.length, row: await runRow(runId) }, JSON.stringify({ row: await runRow(runId), logs })).toMatchObject({ n: 2 });
  for (const c of calls) expect({ p: c.modelProvider, m: c.modelId }, "经 deep-agent 运行时、模型仍是钉住的 qwen-plus").toEqual({ p: "deep-agent", m: "qwen-plus" });
  const resume = calls[1]!.resume as { decision: string; editedAction: { name: string; argsJson: string } };
  expect(resume).toMatchObject({ decision: "edit", editedAction: { name: "start_workflow" } });
  const row = await runRow(runId);
  expect(row).toMatchObject({ status: "writeback_pending", model_provider: "dashscope", model_id: "qwen-plus" });
  return (JSON.parse(resume.editedAction.argsJson) as { outcome: Outcome }).outcome;
}

beforeAll(async () => {
  e = await startWorkflowApp({ SKILL_STARTER_PACK_ROOT: resolve(__dirname, "../../../../skills/starter-packs") });
  runtime = e.app.get<WorkflowRuntimeService>(WORKFLOW_RUNTIME_SERVICE);
  runs = new PgAgentRunRepository(e.db);
  await resetOrgs(ORG);
  await seedWorkflowOrg(ORG, [{ userId: REQUESTER }], "agent-dh-seed");
  await addProjectMember(ORG, PROJECT, REQUESTER, "member", null);
  await insertDashscopeAgent(D002, ROLES.D002!);
  await insertDashscopeAgent(D003, ROLES.D003!);
  await insertDashscopeAgent(PLAIN, []);
  const imported = await as(e, WF03_ADMIN, ORG).post("/admin/skills/starter-pack-imports", { packId: "work-product", packVersion: "1.0.0", idempotencyKey: randomUUID() });
  expect(imported.status).toBe(201);
  await asOwner((c) => c.query("INSERT INTO workflow_definitions (org_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [ORG, W027.key]));
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

describe("数字人能力（决策 B）：dashscope 钉住 + 白名单 ⇒ deep-agent 运行时", () => {
  it("白名单内（D003→W027）：经 deep-agent 运行时、模型 qwen-plus，建出实例", async () => {
    const before = await instanceIds();
    await seedQueuedRun("run-dh-hit", D003);
    const outcome = await agentRequestsWorkflow("run-dh-hit", "W027");
    expect(outcome).toMatchObject({ status: "started", workflowId: "W027" });
    const after = await instanceIds();
    expect(after.filter((x) => !before.includes(x))).toEqual([outcome.instanceId]);
  });

  it("白名单外（D002→W027）：友好的 workflow_not_allowed，不建实例", async () => {
    const before = await instanceIds();
    await seedQueuedRun("run-dh-deny", D002);
    const outcome = await agentRequestsWorkflow("run-dh-deny", "W027");
    expect(outcome).toMatchObject({ status: "refused", code: "workflow_not_allowed" });
    expect(outcome.message).toContain("该角色不能发起此流程");
    expect(outcome.message).not.toMatch(/workflow_not_allowed/);
    expect(await instanceIds()).toEqual(before);
  });

  it("普通 Agent（无白名单、无 Skill）：路由不变，仍以 dashscope / qwen-plus 调用", async () => {
    calls.length = 0;
    script = [{ text: "你好。" }];
    await seedQueuedRun("run-dh-plain", PLAIN);
    await executeQueuedRuns(deps(), { orgId: ORG });
    expect(calls).toHaveLength(1);
    expect({ p: calls[0]!.modelProvider, m: calls[0]!.modelId }).toEqual({ p: "dashscope", m: "qwen-plus" });
  });

  it("回归（core-loop 8b）：普通 Agent 的 run 并入了组织已启用 Skill ⇒ 仍不改道；写回后线程里恰好 human + agent 各一条", async () => {
    // 组织里有已启用 Skill 时，未钉 Skill 的 Agent 的 run.skill_version_ids 会并入它们
    // （message-roundtrip.ts resolveRunSkillVersionIds）。那不是这个 Agent 的工具型能力。
    const enabled = await asApp(ORG, async (c) => (await c.query<{ id: string }>(
      "SELECT id FROM skill_versions WHERE org_id=$1 ORDER BY id LIMIT 1", [ORG])).rows.map((r) => r.id));
    expect(enabled, "starter pack 导入后组织里应有可钉的 skill 版本").toHaveLength(1);
    calls.length = 0;
    script = [{ text: "[plain] 你好。" }];
    await seedQueuedRun("run-dh-orgskill", PLAIN, enabled);
    await executeQueuedRuns(deps(), { orgId: ORG });
    await writeBackPendingRuns(deps() as never, { orgId: ORG });
    expect(calls).toHaveLength(1);
    expect({ p: calls[0]!.modelProvider, m: calls[0]!.modelId }).toEqual({ p: "dashscope", m: "qwen-plus" });
    expect((await runRow("run-dh-orgskill")).status).toBe("succeeded");
    const msgs = await asApp(ORG, async (c) => (await c.query<{ author_kind: string; body: string }>(
      "SELECT author_kind, body FROM chat_messages WHERE org_id=$1 AND thread_id=$2 ORDER BY created_at, id", [ORG, "thread-run-dh-orgskill"])).rows);
    expect(msgs.map((m) => m.author_kind).sort()).toEqual(["agent", "human"]);
    expect(msgs.find((m) => m.author_kind === "agent")!.body).toContain("[plain]");
  });

  it("恢复：经 deep-agent 运行时执行的 dashscope run（有白名单）按 deep-agent 读远端；普通 Agent 仍判 uncertain、不读远端", async () => {
    const seen: string[] = [];
    const remote = { reconcileExistingRun: async (_t: string, _r: string, runId: string) => { seen.push(runId); return { kind: "running" as const }; } };
    for (const [id, agent] of [["run-dh-rec", D003], ["run-dh-rec-plain", PLAIN]] as const) {
      await seedQueuedRun(id, agent);
      await asApp(ORG, (c) => c.query(
        "UPDATE agent_runs SET status='running', started_at=now()-interval '2 hours', remote_run_id=$2 WHERE id=$1", [id, `remote-${id}`]));
    }
    const served = new Set(["dashscope"]);
    await new PgRunRecovery(e.db, runs, remote, undefined, undefined, undefined, served).tick(ORG);
    expect(seen).toContain("run-dh-rec");
    expect(seen).not.toContain("run-dh-rec-plain");
    // 未声明内核可服务集合（deep-agent 端口不可用）⇒ 与此前一致：不读远端。
    seen.length = 0;
    await asApp(ORG, (c) => c.query("UPDATE agent_runs SET lease_expires_at=now()-interval '1 hour' WHERE id IN ('run-dh-rec','run-dh-rec-plain')"));
    await new PgRunRecovery(e.db, runs, remote).tick(ORG);
    expect(seen).toEqual([]);
    await asApp(ORG, (c) => c.query("UPDATE agent_runs SET status='failed', error_code='RUN_INTERRUPTED' WHERE id IN ('run-dh-rec','run-dh-rec-plain')"));
  });
});
