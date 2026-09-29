/**
 * problem-to-prd-e2e.test.ts —— Phase 20 CT06（`05-content-lines.md` R3 步骤 6 / R4 E3；契约束 `work-content`
 * coverage V4、usecases「白名单外发起」、UC-WC-3、UC-WC-I5）。
 *
 * 全程走生产合成：`createApp()`（kernel.module）+ 真实 HTTP 路由 + 真实 PostgreSQL + LangGraph PostgresSaver。
 * 唯一的替身是模型：`KERNEL_MODEL_BASE_URL` 指向本文件起的 OpenAI 兼容回环服务（UC-WC-I5「回环模型」）。
 * - Skill 目录经真实 starter-pack 导入（`POST /admin/skills/starter-pack-imports`，work-product 1.0.0），
 *   start 时由生产 `PgSkillCatalogVersionResolver` 解析固定版本；
 * - D003 经 `POST /workflows/:key/instances` 发起 W029：S064 → S065 → S068 → S067 → S162 → S067（修订），
 *   G1–G4 经 approve 路由逐个批准后 persist 经 effect-gateway（artifact.write）发布 PRD 工件（恰好一次），
 *   notify.inapp 给发起人发站内通知；`GET /workflow-instances/:id/output` 返回过契约校验的 PrdArtifact。
 * - D011 经同一 start 路由发起 W030：HTTP 403 `workflow_not_allowed` + `allowlistHint{handoffCandidates:["D003"]}`，
 *   不创建实例、不改走其它 Workflow；D011 发起其白名单内的 W029 照常 201。
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrdArtifact, WorkflowNotAllowedErrorBody, operations as wc } from "@repo/contracts/work-content";
import { WorkflowInstanceProjection, workflowRuntime as C } from "@repo/contracts/workflow-runtime";
import { publishDefinitionVersion } from "../../src/application/workflow/publish-definition-version";
import { officialRoleWorkflowAllowlists } from "../../src/domain/agent/official-role-packs";
import { PRODUCT_LINE_WORKFLOWS, toRuntimeDefinition } from "../../src/domain/work-content/product-workflow-definitions";
import { defaultWorkflowGraphs } from "../../src/infrastructure/workflow/create-workflow-runtime";
import { PgSkillCatalogVersionResolver } from "../../src/infrastructure/workflow/pg-skill-catalog-version-resolver";
import { PgWorkflowDefinitionRepository } from "../../src/infrastructure/workflow/pg-workflow-definition-repository";
import { WorkflowGraphRegistry } from "../../src/infrastructure/workflow/workflow-graph-registry";
import { closeAppDeterministically } from "../support/close-app";
import { asApp, asOwner, resetOrgs } from "../support/db";
import { WF03_ADMIN, seedWorkflowOrg, waitFor } from "../workflow/wf03-fixtures";
import { as, startWorkflowApp, type Wf03App } from "../workflow/wf03-http";
import { setCapabilityGrant } from "../workflow/wf04-fixtures";

const ORG = "org-ct06-prd";
const PM = "u-ct06-pm";
const PEER = "u-ct06-peer";
const D003_AGENT = "agent-ct06-d003";
const D011_AGENT = "agent-ct06-d011";
const LOOPBACK_PROVIDER = "ct06-loopback";

let seq = 0;
const rid = () => `req-ct06-${Date.now()}-${++seq}`;
const W029 = PRODUCT_LINE_WORKFLOWS.find((w) => w.workflowId === "W029")!;
const W030 = PRODUCT_LINE_WORKFLOWS.find((w) => w.workflowId === "W030")!;
const ROLES = officialRoleWorkflowAllowlists();
const startPath = (key: string) => C.startInstance.path.replace(":key", key);
const instancePath = (id: string) => C.getInstance.path.replace(":instanceId", id);
const outputPath = (id: string) => wc.getInstanceOutput.path.replace(":instanceId", id);

/** 回环模型：按请求里点名的 Skill 给出确定性的结构化产出，并记录每次调用（含所见的前序产出）。 */
interface LoopbackCall { stageId: string; skill: string; input: Record<string, any>; prior: Record<string, any> }
const modelCalls: LoopbackCall[] = [];
function loopbackOutput(call: LoopbackCall): Record<string, unknown> {
  const problem = String(call.input.problem ?? "");
  switch (call.skill.split("@")[0]) {
    case "S064":
      return { problemStatement: `新用户在首次导入时流失：${problem}`, evidenceRefs: ["kb:survey-2026-q3#12", "ticket:4411"], confidence: "medium" };
    case "S065":
      return { opportunities: [{ id: "OPP-1", text: "一键导入模板" }], solutionIds: ["SOL-1", "SOL-2"] };
    case "S068":
      return { ranking: [{ id: "REQ-1", priority: "must" }, { id: "REQ-2", priority: "should" }] };
    case "S067": {
      const frame = call.prior.frame as { problemStatement: string };
      const revised = call.stageId === "revise";
      return {
        title: `PRD：${frame.problemStatement.slice(0, 12)}${revised ? "（修订）" : ""}`,
        requirements: [
          { id: "REQ-1", text: "提供三种导入模板" },
          { id: "REQ-2", text: revised ? "导入失败时给出可操作的修复提示（绑定 KPI-1）" : "导入失败时给出修复提示" },
        ],
      };
    }
    case "S162":
      return { kpis: [{ name: "KPI-1 首次导入成功率", definition: "7 天内完成首次导入的新用户 / 新注册用户" }] };
    default:
      throw new Error(`unexpected skill ${call.skill}`);
  }
}

function startLoopbackModel(): Promise<Server> {
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const body = JSON.parse(raw) as { model: string; messages: { role: string; content: string }[] };
      const user = JSON.parse(body.messages.at(-1)!.content) as LoopbackCall;
      const call = { stageId: user.stageId, skill: user.skill, input: user.input, prior: user.prior };
      modelCalls.push(call);
      const content = "```json\n" + JSON.stringify(loopbackOutput(call)) + "\n```";
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: randomUUID(), object: "chat.completion", model: body.model, choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] }));
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok(server)));
}

describe("CT06 · 产品线端到端（生产合成 + HTTP）：问题到 PRD（W029）与白名单外发起（W030）", () => {
  let e: Wf03App;
  let model: Server;
  const pm = () => as(e, PM, ORG);

  beforeAll(async () => {
    model = await startLoopbackModel();
    e = await startWorkflowApp({
      KERNEL_MODEL_PROVIDER: LOOPBACK_PROVIDER,
      KERNEL_MODEL_BASE_URL: `http://127.0.0.1:${(model.address() as AddressInfo).port}`,
      KERNEL_MODEL_API_KEY: "ct06-loopback-key",
      SKILL_STARTER_PACK_ROOT: resolve(__dirname, "../../../../skills/starter-packs"),
    });
    await resetOrgs(ORG);
    await seedWorkflowOrg(ORG, [{ userId: PM }, { userId: PEER }], "agent-ct06-plain");
    // D003 / D011：已发布版本冻结各自官方角色的 workflowAllowlist（官方角色包同一份种子），模型指向回环 provider。
    for (const [agentId, role] of [[D003_AGENT, "D003"], [D011_AGENT, "D011"]] as const) {
      await asApp(ORG, async (c) => {
        await c.query(
          `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
           VALUES ($1,$2,$1,$1,'enabled',$3,now(),now())`,
          [agentId, ORG, WF03_ADMIN],
        );
        await c.query(
          `INSERT INTO agent_versions
            (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
             model_provider,model_id,tool_policy,creator_id,created_at,published_at,catalog_source,workflow_allowlist)
           VALUES ($1,$2,$3,'v1',$4,'角色','{}'::text[],$5,'loopback-1','[]'::jsonb,$6,now(),now(),'official',$7)`,
          [`${agentId}-v1`, ORG, agentId, "d".repeat(64), LOOPBACK_PROVIDER, WF03_ADMIN, [...ROLES[role]!]],
        );
        await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [`${agentId}-v1`, agentId, ORG]);
      });
    }
    for (const cat of ["artifact.write", "notify.inapp"]) await setCapabilityGrant(ORG, cat, { sideEffectCap: "write" });

    // Skill 目录：真实 starter-pack 导入（UC-WC-I2），不手写目录行。
    const imported = await as(e, WF03_ADMIN, ORG).post("/admin/skills/starter-pack-imports", { packId: "work-product", packVersion: "1.0.0", idempotencyKey: randomUUID() });
    expect(imported.status).toBe(201);

    const deps = {
      definitions: new PgWorkflowDefinitionRepository(e.db),
      graphs: new WorkflowGraphRegistry(defaultWorkflowGraphs()),
      skills: new PgSkillCatalogVersionResolver(e.db),
      clock: { nowIso: () => new Date().toISOString() },
    };
    for (const def of [W029, W030]) {
      await asOwner((c) => c.query("INSERT INTO workflow_definitions (org_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [ORG, def.key]));
      await publishDefinitionVersion(deps, { orgId: ORG, actor: { userId: WF03_ADMIN, orgRole: "admin" }, pathKey: def.key, body: toRuntimeDefinition(def) });
    }
  }, 180_000);

  afterAll(async () => {
    await resetOrgs(ORG);
    await closeAppDeterministically(e?.app);
    await new Promise((ok) => model?.close(ok));
  });

  const settled = (id: string) =>
    waitFor(
      () => pm().get<WorkflowInstanceProjection>(instancePath(id)),
      (r) => r.status === 200 && r.body.status !== "running" && r.body.status !== "cancelling",
      60_000,
    );

  it("V4：D003 经 HTTP 发起 W029 → S064→S065→S068→S067→S162→S067 → G1–G4 批准 → PRD 工件恰好发布一次 + 通知发起人", async () => {
    modelCalls.length = 0;
    const r = await pm().post(startPath(W029.key), { agentId: D003_AGENT, requestId: rid(), input: { problem: "客户反馈导入太难" } });
    expect(r.status).toBe(201);
    const started = C.startInstance.out.parse(r.body);
    expect(started.pinnedSkills.map((p) => `${p.stableId}@${p.version}`)).toContain("S064@1.0.0");

    const approvedGates: string[] = [];
    let p = WorkflowInstanceProjection.parse((await settled(started.instanceId)).body);
    for (let i = 0; i < 10 && p.status === "awaiting_gate_decision"; i++) {
      expect(p.openGate?.viewerCanDecide).toBe(true);
      // 门之前不得发布：persist 还没跑，UC-WC-3 不返回半成品。
      const early = await pm().get(outputPath(started.instanceId));
      expect(early.status).toBe(200);
      expect(early.body).toMatchObject({ output: null, outcome: "with_holds" });
      approvedGates.push(p.openGate!.stageId);
      const a = await pm().post(
        C.approveGate.path.replace(":instanceId", started.instanceId).replace(":gateId", p.openGate!.gateId),
        { expectedStateVersion: p.stateVersion, requestId: rid() },
      );
      expect(a.status).toBe(200);
      p = WorkflowInstanceProjection.parse((await settled(started.instanceId)).body);
    }
    expect(approvedGates).toEqual(["frame_gate", "target_gate", "solution_gate", "prd_gate"]);
    expect(p.status).toBe("succeeded");
    expect(p.stages.every((s) => s.status === "succeeded")).toBe(true);

    // Skill 调用顺序与版本固定（ADR-118 #9：来自实例冻结的 pinnedSkills），经生产 ModelCallPort 到回环模型。
    expect(modelCalls.map((c) => `${c.stageId}:${c.skill}`)).toEqual([
      "frame:S064@1.0.0",
      "map:S065@1.0.0",
      "solutions_fill:S065@1.0.0",
      "prioritize:S068@1.0.0",
      "draft:S067@1.0.0",
      "kpi:S162@1.0.0",
      "revise:S067@1.0.0",
    ]);
    expect(Object.keys(modelCalls.at(-1)!.prior)).toEqual(["frame", "map", "solutions_fill", "prioritize", "draft", "kpi"]);

    // 恰好一次发布 + 一次通知，均经 effect-gateway（receipt finalized，provenance 为发起人/Agent）。
    const receipts = await asApp(ORG, (c) =>
      c.query<{ status: string; stable_response: any }>("SELECT status, stable_response FROM workflow_receipts WHERE scope = 'effect' AND instance_id = $1", [
        started.instanceId,
      ]),
    );
    expect(receipts.rows.map((x) => x.status)).toEqual(["finalized", "finalized"]);
    for (const x of receipts.rows) expect(x.stable_response.provenance).toMatchObject({ initiatorUserId: PM, agentId: D003_AGENT });
    const notes = await asApp(ORG, (c) =>
      c.query<{ user_id: string; body: string }>("SELECT user_id, body FROM user_notifications WHERE source_key = $1", [
        `workflow:${started.instanceId}:prd-published`,
      ]),
    );
    expect(notes.rows).toHaveLength(1);
    expect(notes.rows[0]!.user_id).toBe(PM);
    expect(notes.rows[0]!.body).toContain(outputPath(started.instanceId));

    // UC-WC-3（HTTP）：产出是过契约校验的 PrdArtifact；问题节逐字来自 S064 并带证据，优先级来自 S068，指标来自 S162。
    const out = await pm().get(outputPath(started.instanceId));
    expect(out.status).toBe(200);
    const body = wc.getInstanceOutput.out.parse(out.body);
    expect(body.outcome).toBe("complete");
    const prd = PrdArtifact.parse(body.output);
    expect(prd.problem.text).toBe("新用户在首次导入时流失：客户反馈导入太难");
    expect(prd.problem.evidenceRefs).toEqual(["kb:survey-2026-q3#12", "ticket:4411"]);
    expect(prd.title).toContain("（修订）");
    expect(prd.requirements).toEqual([
      { id: "REQ-1", text: "提供三种导入模板", priority: "must" },
      { id: "REQ-2", text: "导入失败时给出可操作的修复提示（绑定 KPI-1）", priority: "should" },
    ]);
    expect(prd.metrics.map((m) => m.name)).toEqual(["KPI-1 首次导入成功率"]);

    // 可见性同 getInstance：同组织非发起人、非管理员看不到 = 404。
    expect((await as(e, PEER, ORG).get(outputPath(started.instanceId))).status).toBe(404);
  }, 180_000);

  it("E3：D011 经 startInstance 发起 W030 → 403 workflow_not_allowed + allowlistHint(D003)，不创建实例；白名单内的 W029 照常 201", async () => {
    const count = async () => Number((await asApp(ORG, (c) => c.query<{ n: string }>("SELECT count(*) AS n FROM workflow_instances"))).rows[0]!.n);
    const before = await count();
    const r = await pm().post(startPath(W030.key), { agentId: D011_AGENT, requestId: rid(), input: {} });
    expect(r.status).toBe(403);
    const body = WorkflowNotAllowedErrorBody.parse(r.body);
    expect(body.code).toBe("workflow_not_allowed");
    expect(body.allowlistHint).toEqual({ code: "workflow_not_allowlisted", requestedWorkflowId: "W030", handoffCandidates: ["D003"] });
    expect(await count()).toBe(before);

    // 同一 D011 发起其白名单内的 W029 照常启动（判定来自已发布版本的冻结白名单，不是一刀切拒绝）。
    const ok = await pm().post(startPath(W029.key), { agentId: D011_AGENT, requestId: rid(), input: { problem: "y" } });
    expect(ok.status).toBe(201);
    const p = WorkflowInstanceProjection.parse((await settled(ok.body.instanceId)).body);
    expect(p.status).toBe("awaiting_gate_decision");
    const c = await pm().post(C.cancelInstance.path.replace(":instanceId", ok.body.instanceId), { expectedStateVersion: p.stateVersion, requestId: rid() });
    expect(c.status).toBe(200);
    await settled(ok.body.instanceId);
  }, 120_000);
});
