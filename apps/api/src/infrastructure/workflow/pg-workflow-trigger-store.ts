/**
 * WF06 —— `WorkflowTriggerStore` 的 PostgreSQL 适配器（`workflow_triggers` + `workflow_trigger_lookup`）。
 *
 * 两步读,原因见迁移文件头注（与 `org_invite_link_tokens` 同一形状）：
 *   ① 无租户上下文查 `workflow_trigger_lookup` 拿 org_id_hint（+ webhook 的 secret_ref）；
 *   ② 用该 org_id 重开租户会话查 `workflow_triggers`（FORCE RLS）拿业务字段。
 * ②查不到（数据不一致 / 竞态删除）按「触发器不存在」处理,不向上抛出更具体的错误。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type { WorkflowTriggerRecord, WorkflowTriggerStore } from "../../application/workflow/workflow-trigger-ports";

interface LookupRow {
  org_id_hint: string;
  secret_ref: string | null;
}

interface TriggerRow {
  kind: "schedule" | "webhook";
  workflow_key: string;
  version: number | null;
  owner_user_id: string;
  agent_id: string;
  default_input: Record<string, unknown>;
}

export class PgWorkflowTriggerStore implements WorkflowTriggerStore {
  constructor(private readonly db: DatabasePort) {}

  async find(triggerId: string): Promise<WorkflowTriggerRecord | null> {
    const lookup = await this.db.withoutTenant((s) =>
      s.query<LookupRow>(`SELECT org_id_hint, secret_ref FROM workflow_trigger_lookup WHERE id = $1`, [triggerId]),
    );
    const hint = lookup.rows[0];
    if (!hint) return null;

    const orgId = toOrgId(hint.org_id_hint);
    const trigger = await this.db.withTenant(orgId, (s) =>
      s.query<TriggerRow>(
        `SELECT kind, workflow_key, version, owner_user_id, agent_id, default_input
           FROM workflow_triggers WHERE org_id = $1 AND id = $2`,
        [orgId, triggerId],
      ),
    );
    const row = trigger.rows[0];
    if (!row) return null;

    return {
      triggerId,
      orgId,
      kind: row.kind,
      workflowKey: row.workflow_key,
      version: row.version,
      ownerUserId: row.owner_user_id,
      agentId: row.agent_id,
      secretRef: hint.secret_ref,
      defaultInput: row.default_input,
    };
  }
}
