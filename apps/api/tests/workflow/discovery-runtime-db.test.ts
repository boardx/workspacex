import pg from "pg";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asApp, asOwner, resetOrgs } from "../support/db";
import { as, startWorkflowApp, type Wf03App } from "../workflow/wf03-http";
import { seedWorkflowOrg, WF03_ADMIN } from "../workflow/wf03-fixtures";
import { closeAppDeterministically } from "../support/close-app";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { createWorkflowRuntime } from "../../src/infrastructure/workflow/create-workflow-runtime";
import { PgWorkflowAccess } from "../../src/infrastructure/workflow/pg-workflow-access";
import { PgContentSkillInstructions } from "../../src/infrastructure/work-content/pg-content-skill-instructions";
import { PgSkillCatalogVersionResolver } from "../../src/infrastructure/workflow/pg-skill-catalog-version-resolver";
import { ModelContentSkillRunner } from "../../src/application/work-content/content-skill-runner";
import type { ModelCallPort } from "../../src/application/agent-run/ports";
import type { WorkflowRuntimeService } from "../../src/application/workflow/workflow-runtime-service";
import { discoveryCriteriaDigest } from "../../src/domain/work-content/discovery-stage-validation";
import { discoveryExecutionDefinition } from "../../src/domain/work-content/discovery-execution-definition";
import { publishDefinitionVersion } from "../../src/application/workflow/publish-definition-version";
import { PgWorkflowDefinitionRepository } from "../../src/infrastructure/workflow/pg-workflow-definition-repository";
import { WorkflowGraphRegistry } from "../../src/infrastructure/workflow/workflow-graph-registry";
import { defaultWorkflowGraphs } from "../../src/infrastructure/workflow/create-workflow-runtime";

const ORG = "org-w027-execution-db";
const USER = "user-w027-owner";
const AGENT = "agent-w027-execution";
const definition = discoveryExecutionDefinition();
const input = { intent: "让管理员在首次协作时找到可以提供有效反馈的邀请对象", decision: "决定是否继续研究首次邀请流程" };

/** Real PostgreSQL, published fixed Skill files, and LangGraph checkpoints; model reply is deterministic. */
describe("W027 durable generation/review boundary", () => {
  let app: Wf03App; let pool: pg.Pool; let runtime: WorkflowRuntimeService;
  const calls: string[] = [];
  beforeAll(async () => {
    app = await startWorkflowApp();
    await resetOrgs(ORG);
    await seedWorkflowOrg(ORG, [{ userId: USER }], `${AGENT}-plain`);
    await asApp(ORG, async c => {
      await c.query(`INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
        VALUES($1,$2,$1,$1,'enabled',$3,now(),now())`, [AGENT, ORG, WF03_ADMIN]);
      await c.query(`INSERT INTO agent_versions
        (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
         model_provider,model_id,tool_policy,creator_id,created_at,published_at,catalog_source,workflow_allowlist)
        VALUES($1,$2,$3,'v1',$4,'D003 workflow fixture','{}'::text[],'chat','loopback','[]'::jsonb,$5,now(),now(),'official',ARRAY['W027'])`,
        [`${AGENT}-v1`, ORG, AGENT, 'd'.repeat(64), WF03_ADMIN]);
      await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [`${AGENT}-v1`, AGENT, ORG]);
    });
    const imported = await as(app, WF03_ADMIN, ORG).post("/admin/skills/starter-pack-imports", {
      packId: "work-discovery-execution", packVersion: "1.2.0", idempotencyKey: randomUUID(),
    });
    expect(imported.status).toBe(201);
    const resolver = new PgSkillCatalogVersionResolver(app.db);
    await asOwner(c => c.query("INSERT INTO workflow_definitions (org_id,key) VALUES($1,$2) ON CONFLICT DO NOTHING", [ORG, definition.key]));
    await publishDefinitionVersion({ definitions: new PgWorkflowDefinitionRepository(app.db),
      graphs: new WorkflowGraphRegistry(defaultWorkflowGraphs()), skills: resolver,
      clock: { nowIso: () => new Date().toISOString() } }, {
      orgId: ORG, actor: { userId: WF03_ADMIN, orgRole: "admin" }, pathKey: definition.key, body: definition,
    });
    const model = { complete: async (request: { system: string; user: string }) => {
      const invocation = JSON.parse(request.user) as { stageId: string; input: Record<string, unknown> };
      calls.push(invocation.stageId);
      expect(invocation.input).toEqual(input);
      if (invocation.stageId === "plan_interviews") return { text: JSON.stringify({
        planId: "interview-plan-db", status: "ready-for-review",
        researchQuestions: [{ questionId: "RQ1", text: "回忆首次选择邀请对象的过程" }],
      }) };
      expect(request.system).toContain("P6 登记冻结");
      const tests = [{ testId: "T1", assumptionId: "A1", targetRung: "reported-behavior",
        pass: { metric: "accounts", op: ">=", numerator: 3, denominator: 5 },
        fail: { metric: "accounts", op: "<=", numerator: 1, denominator: 5 },
        minSample: { unit: "accounts", n: 5 }, evidenceOwner: "S009" }];
      return { text: JSON.stringify({ planId: "plan-db", planVersion: 1, criteriaDigest: discoveryCriteriaDigest(tests),
        outcome: { status: "anchored", actor: "管理员", behavior: "首次邀请" },
        assumptions: [{ assumptionId: "A1", text: "管理员不确定首次邀请对象", selected: true }], tests }) };
    } } as unknown as ModelCallPort;
    pool = new pg.Pool({ ...appConfig(), max: 3 });
    runtime = createWorkflowRuntime(app.db, pool, { skills: resolver, holder: "w027-owned-test-runtime",
      content: { skills: new ModelContentSkillRunner(model, new PgWorkflowAccess(app.db), new PgContentSkillInstructions(app.db)),
        notifications: { publish: async () => {}, supersede: async () => {} } },
    }).service;
  }, 120_000);
  afterAll(async () => {
    await runtime?.drain(); await pool?.end();
    await resetOrgs(ORG); await closeAppDeterministically(app?.app);
  });
  const start = async () => {
    const created = await runtime.start(ORG, USER, definition.key, { requestId: randomUUID(), agentId: AGENT, input });
    await runtime.drain(); return runtime.get(ORG, USER, created.instanceId);
  };
  it("commits substantive output before the gate, resumes without duplicate model work, then reviews the interview plan", async () => {
    calls.length = 0;
    const initial = await start();
    expect(initial.status).toBe("awaiting_gate_decision");
    expect(initial.openGate?.stageId).toBe("review_hypothesize");
    expect(initial.openGate?.effectPreview.payloadPreview.output).toMatchObject({ planId: "plan-db" });
    expect(calls).toEqual(["hypothesize"]);
    await runtime.resume(ORG, USER, initial.instanceId, { expectedStateVersion: initial.stateVersion, requestId: randomUUID() });
    await runtime.drain();
    const waiting = await runtime.get(ORG, USER, initial.instanceId);
    expect(calls).toEqual(["hypothesize"]);
    await runtime.approveGate(ORG, USER, waiting.instanceId, waiting.openGate!.gateId, {
      expectedStateVersion: waiting.stateVersion, requestId: randomUUID(),
    });
    await runtime.drain();
    const next = await runtime.get(ORG, USER, initial.instanceId);
    expect(next.openGate?.stageId).toBe("review_plan_interviews");
    expect(next.openGate?.effectPreview.payloadPreview.output).toMatchObject({ planId: "interview-plan-db" });
    expect(calls).toEqual(["hypothesize", "plan_interviews"]);
  });
  it("denial ends the instance before interviews, imports or artifact writes", async () => {
    calls.length = 0; const initial = await start();
    await runtime.denyGate(ORG, USER, initial.instanceId, initial.openGate!.gateId, {
      expectedStateVersion: initial.stateVersion, requestId: randomUUID(), reason: "本轮方向不成立",
    });
    await runtime.drain();
    expect((await runtime.get(ORG, USER, initial.instanceId)).status).toBe("rejected");
    expect(calls).toEqual(["hypothesize"]);
    const effects = await asApp(ORG, c => c.query("SELECT request_key FROM workflow_receipts WHERE org_id=$1 AND instance_id=$2 AND scope='effect'", [ORG, initial.instanceId]));
    expect(effects.rows).toEqual([]);
  });
});
