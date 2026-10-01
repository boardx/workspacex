/** WF04 测试夹具：effect-gateway 用的实例 + 能力授权配置（只做 setup，不做断言）。 */
import { asApp, asOwner } from "../support/db";

export async function seedWf04Instance(
  orgId: string,
  instanceId: string,
  opts: { key?: string; version?: number; initiatorUserId: string; agentId: string; agentVersionId: string },
): Promise<void> {
  const key = opts.key ?? "wf04-demo";
  const version = opts.version ?? 1;
  await asOwner(async (c) => {
    await c.query("INSERT INTO workflow_definitions (org_id, key) VALUES ($1, $2) ON CONFLICT DO NOTHING", [orgId, key]);
    await c.query(
      `INSERT INTO workflow_definition_versions (org_id, key, version, graph_ref, title, status, stages, input_schema, published_at)
       VALUES ($1, $2, $3, $4, 'wf04 demo', 'published', '[]'::jsonb, '{}'::jsonb, now()) ON CONFLICT DO NOTHING`,
      [orgId, key, version, `${key}:${version}`],
    );
    await c.query(
      `INSERT INTO workflow_instances (id, org_id, workflow_key, definition_version, graph_ref, pinned_skills, agent_id,
         agent_version_id, initiator_user_id, trigger_kind, status, state_version)
       VALUES ($1, $2, $3, $4, $5, '[]'::jsonb, $6, $7, $8, 'manual', 'running', 1)`,
      [instanceId, orgId, key, version, `${key}:${version}`, opts.agentId, opts.agentVersionId, opts.initiatorUserId],
    );
  });
}

export async function setCapabilityGrant(
  orgId: string,
  capabilityCategory: string,
  patch: { authorized?: boolean; sideEffectCap?: "none" | "read" | "write" | "external_send" },
): Promise<void> {
  await asOwner((c) =>
    c.query(
      `INSERT INTO workflow_capability_grants (org_id, capability_category, authorized, side_effect_cap)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (org_id, capability_category) DO UPDATE
         SET authorized = EXCLUDED.authorized, side_effect_cap = EXCLUDED.side_effect_cap, updated_at = now()`,
      [orgId, capabilityCategory, patch.authorized ?? true, patch.sideEffectCap ?? "external_send"],
    ),
  );
}

/**
 * 直接改实例状态，模拟 cancelInstance 已落的 `cancelling`，或绕过它直接落终态做竞态复现。
 * `wf_instance_state_machine` 触发器要求 status 变化必须伴随 state_version +1（I-12），所以这里
 * 一并推进它，而不是单独 UPDATE status。
 */
export async function setInstanceStatus(orgId: string, instanceId: string, status: string): Promise<void> {
  await asOwner((c) =>
    c.query("UPDATE workflow_instances SET status = $1, state_version = state_version + 1 WHERE org_id = $2 AND id = $3", [
      status,
      orgId,
      instanceId,
    ]),
  );
}

export async function instanceRow(orgId: string, instanceId: string): Promise<{ status: string; reason_code: string | null } | null> {
  const r = await asApp(orgId, (c) =>
    c.query<{ status: string; reason_code: string | null }>("SELECT status, reason_code FROM workflow_instances WHERE id = $1", [instanceId]),
  );
  return r.rows[0] ?? null;
}
