/**
 * AG06 —— `EscalationStore` 的 Postgres 实现（decideEscalation 的决策人解析）。
 *
 * 只读、只在调用方租户内（`withTenant`）。返回的是**判定据以做出的身份数据**（待决中断
 * 所在 run 的 policy / 请求人 / 项目，以及 target 展开后的用户 ID），不向任何人披露内容；
 * 谁能裁决由 `decideEscalation` 用这些事实经 decision-guard 判定（E6）。豁免条件见
 * `scripts/lint-permission-paths.mjs` 对应条目，由 tests/agent/escalate-decision-guard.test.ts 钉住。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import type { EscalationStore, PendingEscalationRow } from "../../application/agent-interrupts/decide-escalation";

export class PgEscalationStore implements EscalationStore {
  constructor(private readonly db: DatabasePort) {}

  async findPendingByInterruptId(orgId: OrgId, interruptId: string): Promise<PendingEscalationRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string; pending_tool_name: string | null; pending_args_summary: string | null;
        escalation_policy: unknown; author_id: string | null; project_id: string | null;
      }>(
        `SELECT r.id, r.pending_tool_name, r.pending_args_summary, v.escalation_policy, m.author_id, t.project_id
           FROM agent_runs r
           JOIN chat_threads t ON t.id = r.thread_id AND t.org_id = r.org_id
           LEFT JOIN agent_versions v ON v.id = r.agent_version_id AND v.org_id = r.org_id
           LEFT JOIN chat_messages m ON m.id = r.input_message_id AND m.org_id = r.org_id
          WHERE r.org_id = $1 AND r.status = 'awaiting_tool_permission'
            AND r.pending_permission_request_id::text = $2`,
        [orgId, interruptId],
      );
      const row = r.rows[0];
      if (!row || row.pending_tool_name === null) return null;
      return {
        runId: row.id, toolName: row.pending_tool_name, argsSummary: row.pending_args_summary,
        escalationPolicy: row.escalation_policy ?? null, requesterUserId: row.author_id, projectId: row.project_id,
      };
    });
  }

  async listTargetUserIds(
    orgId: OrgId, target: "requester" | "project_owner" | "org_admin",
    scope: { readonly requesterUserId: string | null; readonly projectId: string | null },
  ): Promise<readonly string[]> {
    if (target === "requester") return scope.requesterUserId ? [scope.requesterUserId] : [];
    return this.db.withTenant(orgId, async (s) => {
      if (target === "project_owner") {
        if (scope.projectId === null) return [];
        const r = await s.query<{ user_id: string }>(
          `SELECT user_id FROM project_memberships
            WHERE org_id = $1 AND project_id = $2 AND project_role = 'facilitator' AND is_host`,
          [orgId, scope.projectId],
        );
        return r.rows.map((x) => x.user_id);
      }
      const r = await s.query<{ user_id: string }>(
        `SELECT user_id FROM org_memberships WHERE org_id = $1 AND org_role = 'admin'`,
        [orgId],
      );
      return r.rows.map((x) => x.user_id);
    });
  }
}
