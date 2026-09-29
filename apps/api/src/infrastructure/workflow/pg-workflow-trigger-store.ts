/**
 * WF06 —— `WorkflowTriggerStore` 的 PostgreSQL 适配器（`workflow_triggers` + `workflow_trigger_lookup`）。
 *
 * 两步读,原因见迁移文件头注（与 `org_invite_link_tokens` 同一形状）：
 *   ① 无租户上下文查 `workflow_trigger_lookup` 拿 org_id_hint；webhook 密钥只经 SECURITY DEFINER
 *     函数 `workflow_trigger_webhook_secrets(id)` 按单个 id 取（app_rw 对密钥列没有列级 SELECT）；
 *   ② 用该 org_id 重开租户会话查 `workflow_triggers`（FORCE RLS）拿业务字段。
 * ②查不到（数据不一致 / 竞态删除）按「触发器不存在」处理,不向上抛出更具体的错误。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import { toOrgId } from "../../domain/org-id";
import type { WorkflowTriggerRecord, WorkflowTriggerStore } from "../../application/workflow/workflow-trigger-ports";

interface LookupRow {
  org_id_hint: string;
}

interface SecretRow {
  webhook_secret: string | null;
  webhook_secret_previous: string | null;
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
      s.query<LookupRow>(`SELECT org_id_hint FROM workflow_trigger_lookup WHERE id = $1`, [triggerId]),
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
    // 密钥只对 webhook 触发器取；经 SECURITY DEFINER 函数（workflow_trigger_lookup 的密钥列对 app_rw 无列级 SELECT）。
    let secrets: SecretRow | undefined;
    if (row.kind === "webhook") {
      const sec = await this.db.withoutTenant((s) =>
        s.query<SecretRow>(`SELECT webhook_secret, webhook_secret_previous FROM workflow_trigger_webhook_secrets($1)`, [triggerId]),
      );
      secrets = sec.rows[0];
    }

    return {
      triggerId,
      orgId,
      kind: row.kind,
      workflowKey: row.workflow_key,
      version: row.version,
      ownerUserId: row.owner_user_id,
      agentId: row.agent_id,
      webhookSecrets: [secrets?.webhook_secret, secrets?.webhook_secret_previous].filter((v): v is string => typeof v === "string" && v.length > 0),
      defaultInput: row.default_input,
    };
  }
}
