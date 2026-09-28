/** WF02 测试夹具：造一个已发布版本 + 一个实例（owner 身份，只做 setup，不做断言）。 */
import { asOwner } from "../support/db";

export async function seedWorkflowInstance(orgId: string, instanceId: string, key = "lease-demo", version = 1): Promise<void> {
  await asOwner(async (c) => {
    await c.query("INSERT INTO workflow_definitions (org_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [orgId, key]);
    await c.query(
      `INSERT INTO workflow_definition_versions (org_id, key, version, graph_ref, title, status, stages, input_schema, published_at)
       VALUES ($1, $2, $3, $4, 'demo', 'published', '[]'::jsonb, '{}'::jsonb, now()) ON CONFLICT DO NOTHING`,
      [orgId, key, version, `${key}:${version}`],
    );
    await c.query(
      `INSERT INTO workflow_instances (id, org_id, workflow_key, definition_version, graph_ref, pinned_skills, agent_id,
         agent_version_id, initiator_user_id, trigger_kind, status, state_version)
       VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, 'a1', 'av1', 'u1', 'manual', 'running', 1)`,
      [instanceId, orgId, key, version, `${key}:${version}`],
    );
  });
}
