/**
 * problem-to-prd-e2e.test.ts —— Phase 20 CT06（`05-content-lines.md` R3 步骤 6 / R4 E3；契约束 `work-content`
 * coverage V4、usecases「白名单外发起」、UC-WC-3、UC-WC-I5）。
 *
 * 真实 PostgreSQL + 真实 LangGraph PostgresSaver + 真实 Workflow Runtime（WF01–WF05）+ 回环模型（桩 Skill 执行器）：
 * - D003 发起 W029：依次 S064 问题定义 → S065 机会地图 → S068 优先级 → S067 PRD → S162 指标 → S067 修订，
 *   四道人工门（G1–G4）逐个批准后 persist 经 effect-gateway 发布 PRD 工件（恰好一次），`getInstanceOutput`
 *   返回过契约校验的 `PrdArtifact`（问题节逐字来自 S064 并带证据引用）。
 * - D011 发起 W030：`workflow_not_allowed` + `WorkflowNotAllowlistedHint{handoffCandidates:["D003"]}`，
 *   不创建任何实例、不改走其它 Workflow（不静默降级）；D011 发起其白名单内的 W029 照常启动。
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrdArtifact } from "@repo/contracts/work-content";
import type { ContentSkillInvocation } from "../../src/application/work-content/content-skill-runner";
import { getContentInstanceOutput } from "../../src/application/work-content/get-content-instance-output";
import {
  ContentWorkflowNotAllowlistedError,
  startContentWorkflow,
  type StartContentWorkflowDeps,
} from "../../src/application/work-content/start-content-workflow";
import type { EffectGateway } from "../../src/application/workflow/effect-gateway";
import { publishDefinitionVersion } from "../../src/application/workflow/publish-definition-version";
import type { WorkflowRuntimeService } from "../../src/application/workflow/workflow-runtime-service";
import { officialRoleWorkflowAllowlists } from "../../src/domain/agent/official-role-packs";
import { skillCatalogResolver, type CatalogSkillVersion } from "../../src/domain/work-content/content-workflow-registration";
import { PRODUCT_LINE_WORKFLOWS, toRuntimeDefinition } from "../../src/domain/work-content/product-workflow-definitions";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { createWorkflowRuntime, defaultWorkflowGraphs } from "../../src/infrastructure/workflow/create-workflow-runtime";
import { PgWorkflowAccess } from "../../src/infrastructure/workflow/pg-workflow-access";
import { PgWorkflowDefinitionRepository } from "../../src/infrastructure/workflow/pg-workflow-definition-repository";
import { PgWorkflowInstanceRepository } from "../../src/infrastructure/workflow/pg-workflow-instance-repository";
import { PgWorkflowStageOutputStore } from "../../src/infrastructure/workflow/pg-workflow-event-store";
import { problemToPrdGraph } from "../../src/infrastructure/workflow/problem-to-prd-graph";
import { WorkflowGraphRegistry } from "../../src/infrastructure/workflow/workflow-graph-registry";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs } from "../support/db";
import { WF03_ADMIN, seedWorkflowOrg } from "../workflow/wf03-fixtures";
import { setCapabilityGrant } from "../workflow/wf04-fixtures";

const ORG = "org-ct06-prd";
const PM = "u-ct06-pm";
const D003_AGENT = "agent-ct06-d003";
const D011_AGENT = "agent-ct06-d011";
const REPO = resolve(__dirname, "../../../..");

let seq = 0;
const rid = () => `req-ct06-${Date.now()}-${++seq}`;

function packSkills(pack: string): CatalogSkillVersion[] {
  const json = JSON.parse(readFileSync(resolve(REPO, `skills/starter-packs/${pack}/1.0.0.json`), "utf8")) as {
    skills: { name: string; semanticVersion: string }[];
  };
  return json.skills.map((s) => ({ stableId: s.name, semanticVersion: s.semanticVersion, passedGates: ["G0", "G1", "G2", "G3", "G4", "G5"] }));
}
const CATALOG = [...packSkills("work-product"), ...packSkills("work-research")];
const resolveSkill = skillCatalogResolver(CATALOG);
const skills = { resolve: async (_org: string, id: string, range: string) => resolveSkill(id, range) };

const W029 = PRODUCT_LINE_WORKFLOWS.find((w) => w.workflowId === "W029")!;
const W030 = PRODUCT_LINE_WORKFLOWS.find((w) => w.workflowId === "W030")!;
const ROLES = officialRoleWorkflowAllowlists();

/** 回环模型：按 Skill ID 给出确定性的结构化产出，并记录每次调用（含所见的前序产出）。 */
const skillCalls: ContentSkillInvocation[] = [];
async function loopbackSkill(call: ContentSkillInvocation): Promise<Record<string, unknown>> {
  skillCalls.push(call);
  const problem = String(call.input.problem ?? "");
  switch (call.skillId) {
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
      throw new Error(`unexpected skill ${call.skillId}`);
  }
}

describe("CT06 · 产品线端到端：问题到 PRD（W029）与白名单外发起（W030）", () => {
  let db: PgDatabase;
  let pool: pg.Pool;
  let service: WorkflowRuntimeService;
  let gateway: EffectGateway;
  let start: StartContentWorkflowDeps;
  const outputs = () => new PgWorkflowStageOutputStore(db);
  const published: Array<{ instanceId: string; prd: Record<string, unknown> }> = [];
  const notified: string[] = [];
  const runErrors: unknown[] = [];

  beforeAll(async () => {
    ensureDatabase();
    await migrateOnce();
    db = new PgDatabase(appConfig());
    pool = new pg.Pool({ ...appConfig(), max: 3 });
    const prdGraph = problemToPrdGraph({
      skills: { run: loopbackSkill },
      outputs: new PgWorkflowStageOutputStore(db),
      instances: new PgWorkflowInstanceRepository(db),
      effects: () => gateway,
      publishArtifact: async ({ instanceId, prd }) => {
        published.push({ instanceId, prd });
        return { artifactRef: `artifact:prd:${instanceId}` };
      },
      notify: async ({ artifactRef }) => {
        notified.push(artifactRef);
        return { notificationId: `n-${notified.length}` };
      },
    });
    const graphs = [...defaultWorkflowGraphs().filter((g) => g.graphRef !== prdGraph.graphRef), prdGraph];
    const rt = createWorkflowRuntime(db, pool, { graphs, skills, holder: "ct06-worker", leaseTtlMs: 30_000, onRunError: (_i, e) => runErrors.push(e) });
    service = rt.service;
    gateway = rt.effectGateway;
    start = { definitions: PRODUCT_LINE_WORKFLOWS, agents: new PgWorkflowAccess(db), officialRoleAllowlists: ROLES, runtime: service };

    await resetOrgs(ORG);
    await seedWorkflowOrg(ORG, [{ userId: PM }], "agent-ct06-plain");
    // D003 / D011：已发布版本冻结各自官方角色的 workflowAllowlist（官方角色包同一份种子）。
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
           VALUES ($1,$2,$3,'v1',$4,'角色','{}'::text[],'chat','loopback','[]'::jsonb,$5,now(),now(),'official',$6)`,
          [`${agentId}-v1`, ORG, agentId, "d".repeat(64), WF03_ADMIN, [...ROLES[role]!]],
        );
        await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [`${agentId}-v1`, agentId, ORG]);
      });
    }
    for (const cat of ["artifact.write", "notify.inapp"]) await setCapabilityGrant(ORG, cat, { sideEffectCap: "write" });
    const deps = {
      definitions: new PgWorkflowDefinitionRepository(db),
      graphs: new WorkflowGraphRegistry(graphs),
      skills,
      clock: { nowIso: () => new Date().toISOString() },
    };
    for (const def of [W029, W030]) {
      await asOwner((c) => c.query("INSERT INTO workflow_definitions (org_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [ORG, def.key]));
      await publishDefinitionVersion(deps, { orgId: ORG, actor: { userId: WF03_ADMIN, orgRole: "admin" }, pathKey: def.key, body: toRuntimeDefinition(def) });
    }
  }, 120_000);

  afterAll(async () => {
    await service?.drain();
    await resetOrgs(ORG);
    await pool?.end();
    await db?.close();
  });

  beforeEach(() => {
    skillCalls.length = 0;
    published.length = 0;
    notified.length = 0;
    runErrors.length = 0;
  });

  async function events(instanceId: string) {
    const r = await asApp(ORG, (c) =>
      c.query<{ type: string; stage_id: string | null; data: any }>("SELECT type, stage_id, data FROM workflow_events WHERE instance_id = $1 ORDER BY seq", [instanceId]),
    );
    return r.rows;
  }

  it("V4：D003 发起 W029 → S064→S065→S068→S067→S162→S067 → G1–G4 批准 → PRD 工件恰好发布一次", async () => {
    const started = await startContentWorkflow(start, {
      orgId: ORG,
      userId: PM,
      agentId: D003_AGENT,
      workflowId: "W029",
      requestId: rid(),
      input: { problem: "客户反馈导入太难" },
    });
    await service.drain();

    const approvedGates: string[] = [];
    for (let i = 0; i < 10; i++) {
      const p = await service.get(ORG, PM, started.instanceId);
      if (p.status !== "awaiting_gate_decision") break;
      expect(p.openGate?.viewerCanDecide).toBe(true);
      // 门之前不得发布：persist 还没跑。
      expect(published).toHaveLength(0);
      approvedGates.push(p.openGate!.stageId);
      await service.approveGate(ORG, PM, started.instanceId, p.openGate!.gateId, { expectedStateVersion: p.stateVersion, requestId: rid() });
      await service.drain();
    }
    expect(runErrors).toEqual([]);
    expect(approvedGates).toEqual(["frame_gate", "target_gate", "solution_gate", "prd_gate"]);

    const done = await service.get(ORG, PM, started.instanceId);
    expect(done.status).toBe("succeeded");
    expect(done.stages.every((s) => s.status === "succeeded")).toBe(true);

    // Skill 调用顺序与版本固定（ADR-118 #9：来自实例冻结的 pinnedSkills）。
    expect(skillCalls.map((c) => `${c.stageId}:${c.skillId}@${c.skillVersion}`)).toEqual([
      "frame:S064@1.0.0",
      "map:S065@1.0.0",
      "solutions_fill:S065@1.0.0",
      "prioritize:S068@1.0.0",
      "draft:S067@1.0.0",
      "kpi:S162@1.0.0",
      "revise:S067@1.0.0",
    ]);
    expect(Object.keys(skillCalls.at(-1)!.prior)).toEqual(["frame", "map", "solutions_fill", "prioritize", "draft", "kpi"]);

    // 恰好一次发布 + 一次通知，均经 effect-gateway（receipt finalized，provenance 为发起人/Agent）。
    expect(published).toHaveLength(1);
    expect(notified).toEqual([`artifact:prd:${started.instanceId}`]);
    const receipts = await asApp(ORG, (c) =>
      c.query<{ status: string; stable_response: any }>("SELECT status, stable_response FROM workflow_receipts WHERE scope = 'effect' AND instance_id = $1", [
        started.instanceId,
      ]),
    );
    expect(receipts.rows.map((r) => r.status)).toEqual(["finalized", "finalized"]);
    for (const r of receipts.rows) expect(r.stable_response.provenance).toMatchObject({ initiatorUserId: PM, agentId: D003_AGENT });
    const ev = await events(started.instanceId);
    expect(ev.filter((e) => e.type === "gate_decided").map((e) => e.data.decision)).toEqual(["approved", "approved", "approved", "approved"]);
    expect(ev.filter((e) => e.type === "effect_finalized")).toHaveLength(2);

    // UC-WC-3：产出是过契约校验的 PrdArtifact；问题节逐字来自 S064 并带证据，优先级来自 S068，指标来自 S162。
    const out = await getContentInstanceOutput({ runtime: service, outputs: outputs() }, ORG, PM, started.instanceId);
    expect(out.outcome).toBe("complete");
    const prd = PrdArtifact.parse(out.output);
    expect(prd.problem.text).toBe("新用户在首次导入时流失：客户反馈导入太难");
    expect(prd.problem.evidenceRefs).toEqual(["kb:survey-2026-q3#12", "ticket:4411"]);
    expect(prd.title).toContain("（修订）");
    expect(prd.requirements).toEqual([
      { id: "REQ-1", text: "提供三种导入模板", priority: "must" },
      { id: "REQ-2", text: "导入失败时给出可操作的修复提示（绑定 KPI-1）", priority: "should" },
    ]);
    expect(prd.metrics.map((m) => m.name)).toEqual(["KPI-1 首次导入成功率"]);
    expect(published[0]!.prd).toEqual(prd);
  }, 120_000);

  it("PRD 门未批准前 getInstanceOutput 不返回半成品", async () => {
    const started = await startContentWorkflow(start, { orgId: ORG, userId: PM, agentId: D003_AGENT, workflowId: "W029", requestId: rid(), input: { problem: "x" } });
    await service.drain();
    const p = await service.get(ORG, PM, started.instanceId);
    expect(p.status).toBe("awaiting_gate_decision");
    const out = await getContentInstanceOutput({ runtime: service, outputs: outputs() }, ORG, PM, started.instanceId);
    expect(out.output).toBeNull();
    expect(published).toHaveLength(0);
    await service.cancel(ORG, PM, started.instanceId, { expectedStateVersion: p.stateVersion, requestId: rid() });
    await service.drain();
  }, 60_000);

  it("E3：D011 发起 W030 → workflow_not_allowed + 提示可转交 D003，不创建实例、不静默降级", async () => {
    const before = await asApp(ORG, (c) => c.query<{ n: string }>("SELECT count(*) AS n FROM workflow_instances"));
    const err = await startContentWorkflow(start, {
      orgId: ORG,
      userId: PM,
      agentId: D011_AGENT,
      workflowId: "W030",
      requestId: rid(),
      input: {},
    }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ContentWorkflowNotAllowlistedError);
    const e = err as ContentWorkflowNotAllowlistedError;
    expect(e.code).toBe("workflow_not_allowed");
    expect(e.hint).toEqual({ code: "workflow_not_allowlisted", requestedWorkflowId: "W030", handoffCandidates: ["D003"] });
    const after = await asApp(ORG, (c) => c.query<{ n: string }>("SELECT count(*) AS n FROM workflow_instances"));
    expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
    expect(skillCalls).toHaveLength(0);

    // 同一 D011 发起其白名单内的 W029 照常启动（判定来自已发布版本的冻结白名单，不是一刀切拒绝）。
    const ok = await startContentWorkflow(start, { orgId: ORG, userId: PM, agentId: D011_AGENT, workflowId: "W029", requestId: rid(), input: { problem: "y" } });
    await service.drain();
    const p = await service.get(ORG, PM, ok.instanceId);
    expect(p.status).toBe("awaiting_gate_decision");
    await service.cancel(ORG, PM, ok.instanceId, { expectedStateVersion: p.stateVersion, requestId: rid() });
    await service.drain();
  }, 60_000);
});
