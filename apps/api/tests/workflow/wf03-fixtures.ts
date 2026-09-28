/** WF03 测试夹具：组织 + 成员 + 已发布 Agent + 已发布演示 Workflow（只做 setup，不做断言）。 */
import type { DatabasePort } from "../../src/application/ports/database.port";
import { publishDefinitionVersion } from "../../src/application/workflow/publish-definition-version";
import { DEMO_WORKFLOW_DEFINITION, DEMO_WORKFLOW_KEY } from "../../src/infrastructure/workflow/demo-workflow-graph";
import { PgWorkflowDefinitionRepository } from "../../src/infrastructure/workflow/pg-workflow-definition-repository";
import { UNRESOLVED_SKILL_VERSIONS, defaultWorkflowGraphs } from "../../src/infrastructure/workflow/create-workflow-runtime";
import { WorkflowGraphRegistry } from "../../src/infrastructure/workflow/workflow-graph-registry";
import { addOrgMember, asApp, asOwner, seedOrg } from "../support/db";

export const WF03_ADMIN = "u-wf03-admin";

export async function seedWorkflowOrg(orgId: string, members: { userId: string; role?: "admin" | "member" }[], agentId: string): Promise<void> {
  await seedOrg({ orgId, projectId: `proj-${orgId}` });
  await addOrgMember(orgId, WF03_ADMIN, "admin", null);
  for (const m of members) await addOrgMember(orgId, m.userId, m.role === "admin" ? "admin" : "consultant", null);
  const version = `${agentId}-v1`;
  await asApp(orgId, async (c) => {
    await c.query(
      `INSERT INTO agents (id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
       VALUES ($1,$2,$1,$1,'enabled',$3,now(),now())`,
      [agentId, orgId, WF03_ADMIN],
    );
    await c.query(
      `INSERT INTO agent_versions
        (id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
         model_provider,model_id,tool_policy,creator_id,created_at,published_at)
       VALUES ($1,$2,$3,'v1',$4,'演示','{}'::text[],'chat','loopback','[]'::jsonb,$5,now(),now())`,
      [version, orgId, agentId, "d".repeat(64), WF03_ADMIN],
    );
    await c.query("UPDATE agents SET published_version_id=$1 WHERE id=$2 AND org_id=$3", [version, agentId, orgId]);
  });
  await asOwner((c) =>
    c.query("INSERT INTO workflow_definitions (org_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [orgId, DEMO_WORKFLOW_KEY]),
  );
}

/** 经 WF01 发布用例（管理员、图工厂注册表校验）发布演示 Workflow v1。 */
export async function publishDemoWorkflow(db: DatabasePort, orgId: string): Promise<void> {
  await publishDefinitionVersion(
    {
      definitions: new PgWorkflowDefinitionRepository(db),
      graphs: new WorkflowGraphRegistry(defaultWorkflowGraphs()),
      skills: UNRESOLVED_SKILL_VERSIONS,
      clock: { nowIso: () => new Date().toISOString() },
    },
    { orgId, actor: { userId: WF03_ADMIN, orgRole: "admin" }, pathKey: DEMO_WORKFLOW_KEY, body: structuredClone(DEMO_WORKFLOW_DEFINITION) },
  );
}

export async function eventSeqs(orgId: string, instanceId: string): Promise<{ seq: number; type: string; state_version: number; stage_id: string | null }[]> {
  const r = await asApp(orgId, (c) =>
    c.query<{ seq: string; type: string; state_version: number; stage_id: string | null }>(
      "SELECT seq, type, state_version, stage_id FROM workflow_events WHERE instance_id = $1 ORDER BY seq",
      [instanceId],
    ),
  );
  return r.rows.map((x) => ({ ...x, seq: Number(x.seq) }));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(probe: () => Promise<T>, done: (v: T) => boolean, timeoutMs = 20_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await probe();
    if (done(v)) return v;
    if (Date.now() > deadline) throw new Error(`waitFor timed out; last value: ${JSON.stringify(v)}`);
    await sleep(100);
  }
}
