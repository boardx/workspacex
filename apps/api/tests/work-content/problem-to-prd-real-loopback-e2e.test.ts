/**
 * W029 × **真实回环模型脚本**（`scripts/loopback-model-provider.ts`，原生 loopback 栈同一进程形态）：
 * 实测 frame 阶段 failureKind `unknown` 的根因是脚本对 Skill 阶段请求回通用回显 `[loopback] <user JSON>`，
 * runner 拒收（skill_output_not_json_object）。本用例起真脚本子进程，Agent 固定 `dashscope`
 * （KERNEL_LOOPBACK_PROVIDER_ALIASES=dashscope，与实测栈一致），经 HTTP 发起 W029 并逐门批准到 succeeded。
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PrdArtifact, operations as wc } from "@repo/contracts/work-content";
import type { ModelCallPort } from "../../src/application/agent-run/ports";
import { ModelContentSkillRunner } from "../../src/application/work-content/content-skill-runner";
import { PgContentSkillInstructions } from "../../src/infrastructure/work-content/pg-content-skill-instructions";
import { PgWorkflowAccess } from "../../src/infrastructure/workflow/pg-workflow-access";
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

const ORG = "org-w029-real-loopback";
const PM = "u-w029rl-pm";
const PEER = "u-w029rl-peer";
const D003_AGENT = "agent-w029rl-d003";
const LOOPBACK_PROVIDER = "w029rl-loopback";
const PINNED_PROVIDER = "dashscope";
const W029 = PRODUCT_LINE_WORKFLOWS.find((w) => w.workflowId === "W029")!;
const ROLES = officialRoleWorkflowAllowlists();
let seq = 0;
const rid = () => `req-w029rl-${Date.now()}-${++seq}`;

function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const s = createServer();
    s.once("error", fail);
    s.listen(0, "127.0.0.1", () => { const p = (s.address() as { port: number }).port; s.close(() => ok(p)); });
  });
}

async function startLoopbackScript(port: number): Promise<ChildProcess> {
  const child = spawn(resolve(__dirname, "../../node_modules/.bin/tsx"), [resolve(__dirname, "../../scripts/loopback-model-provider.ts")], {
    env: { ...process.env, LOOPBACK_MODEL_PROVIDER_PORT: String(port), LOOPBACK_MODEL_REPLY_PREFIX: "[loopback]" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  await new Promise<void>((ok, fail) => {
    const t = setTimeout(() => fail(new Error("loopback script did not start")), 30_000);
    child.stdout!.on("data", (b: Buffer) => { if (b.toString().includes("listening")) { clearTimeout(t); ok(); } });
    child.once("exit", (code) => { clearTimeout(t); fail(new Error(`loopback script exited ${code}`)); });
  });
  return child;
}

describe("W029 end-to-end on the real loopback model script (dashscope alias)", () => {
  let e: Wf03App;
  let model: ChildProcess;
  const pm = () => as(e, PM, ORG);

  beforeAll(async () => {
    const port = await freePort();
    model = await startLoopbackScript(port);
    e = await startWorkflowApp({
      KERNEL_MODEL_PROVIDER: LOOPBACK_PROVIDER,
      KERNEL_MODEL_BASE_URL: `http://127.0.0.1:${port}`,
      KERNEL_MODEL_API_KEY: "w029rl-loopback-key",
      KERNEL_LOOPBACK_PROVIDER_ALIASES: PINNED_PROVIDER,
      SKILL_STARTER_PACK_ROOT: resolve(__dirname, "../../../../skills/starter-packs"),
    });
    await resetOrgs(ORG);
    await seedWorkflowOrg(ORG, [{ userId: PM }, { userId: PEER }], "agent-ct06-plain");
    // D003 / D011：已发布版本冻结各自官方角色的 workflowAllowlist（官方角色包同一份种子），模型指向回环 provider。
    for (const [agentId, role] of [[D003_AGENT, "D003"]] as const) {
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
          [`${agentId}-v1`, ORG, agentId, "d".repeat(64), PINNED_PROVIDER, WF03_ADMIN, [...ROLES[role]!]],
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
    for (const def of [W029]) {
      await asOwner((c) => c.query("INSERT INTO workflow_definitions (org_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [ORG, def.key]));
      await publishDefinitionVersion(deps, { orgId: ORG, actor: { userId: WF03_ADMIN, orgRole: "admin" }, pathKey: def.key, body: toRuntimeDefinition(def) });
    }
  }, 180_000);

  afterAll(async () => {
    await resetOrgs(ORG);
    await closeAppDeterministically(e?.app);
    model?.kill("SIGTERM");
  });

  const settled = (id: string) =>
    waitFor(
      () => pm().get<WorkflowInstanceProjection>(C.getInstance.path.replace(":instanceId", id)),
      (r) => r.status === 200 && r.body.status !== "running" && r.body.status !== "cancelling",
      60_000,
    );

  it("reads the imported pinned procedure, keeps it after a newer version exists, and isolates organizations", async () => {
    const instructions = new PgContentSkillInstructions(e.db);
    const pinned = await instructions.skillInstructions(ORG, "S064", "1.0.0");
    expect(pinned).toContain("# 问题框定（S064）");
    await asApp(ORG, async (c) => {
      await c.query(
        `INSERT INTO skill_versions (id,org_id,skill_id,semantic_label,content_digest,manifest,creator_id,created_at,published)
         SELECT $2,org_id,skill_id,'2.0.0',content_digest,manifest,creator_id,now(),false
           FROM skill_versions WHERE org_id=$1 AND skill_id=(SELECT skill_id FROM skill_catalog_entries WHERE org_id=$1 AND stable_id='S064') AND semantic_label='1.0.0'`,
        [ORG, "skill-w029rl-s064-v2"],
      );
      await c.query(
        `INSERT INTO skill_version_files (org_id,version_id,path,content,media_type,digest)
         VALUES ($1,$2,'SKILL.md',$3,'text/markdown',$4)`,
        [ORG, "skill-w029rl-s064-v2", Buffer.from("# New procedure"), "b".repeat(64)],
      );
      await c.query("SELECT wave2_publish_skill_version($1,$2)", [ORG, "skill-w029rl-s064-v2"]);
    });
    expect(await instructions.skillInstructions(ORG, "S064", "1.0.0")).toBe(pinned);
    expect(await instructions.skillInstructions(ORG, "S064", "2.0.0")).toBe("# New procedure");
    expect(await instructions.skillInstructions("org-w029rl-other", "S064", "1.0.0")).toBeNull();
    let modelCalls = 0;
    const model = { complete: async ({ system }: { system: string }) => {
      modelCalls++;
      return { text: JSON.stringify({ authoredProcedureUsed: system.includes(pinned!) }) };
    } } as unknown as ModelCallPort;
    const runner = new ModelContentSkillRunner(model, new PgWorkflowAccess(e.db), instructions);
    const call = { orgId: ORG, instanceId: "w029rl-pinned-procedure", agentVersionId: `${D003_AGENT}-v1`,
      workflowId: "W029", stageId: "frame", skillId: "S064", skillVersion: "1.0.0", input: {}, prior: {} };
    expect(await runner.run(call)).toEqual({ authoredProcedureUsed: true });
    await expect(runner.run({ ...call, skillVersion: "9.9.9" })).rejects.toMatchObject({ code: "CONTENT_SKILL_INSTRUCTIONS_MISSING" });
    expect(modelCalls).toBe(1);
  });

  it("frame (and every later Skill stage) completes; gates approve through to a published PrdArtifact", async () => {
    const r = await pm().post(C.startInstance.path.replace(":key", W029.key), { agentId: D003_AGENT, requestId: rid(), version: 1, input: { problem: "客户反馈导入太难" } });
    expect(r.status).toBe(201);
    const started = C.startInstance.out.parse(r.body);
    let p = WorkflowInstanceProjection.parse((await settled(started.instanceId)).body);
    expect(p.stages.find((s) => s.stageId === "frame")?.status).toBe("succeeded");
    for (let i = 0; i < 10 && p.status === "awaiting_gate_decision"; i++) {
      const a = await pm().post(
        C.approveGate.path.replace(":instanceId", started.instanceId).replace(":gateId", p.openGate!.gateId),
        { expectedStateVersion: p.stateVersion, requestId: rid() },
      );
      expect(a.status).toBe(200);
      p = WorkflowInstanceProjection.parse((await settled(started.instanceId)).body);
    }
    expect(p.status).toBe("succeeded");
    const out = await pm().get<{ output: unknown }>(wc.getInstanceOutput.path.replace(":instanceId", started.instanceId));
    expect(out.status).toBe(200);
    const prd = PrdArtifact.parse(out.body.output);
    expect(prd.problem.evidenceRefs).toEqual(["loopback:frame"]);
  }, 120_000);
});
