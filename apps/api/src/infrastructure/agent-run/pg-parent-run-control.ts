import { toolArgumentsDigest } from "../../application/agent-run/tool-arguments-digest";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { parentCancelRequestId, type ParentCancellationReader } from "../../application/agent-run/parent-run-control";
import type { ToolAuthorityReader, ToolAuthoritySnapshot, ExecutionAuthorityContext } from "../../application/agent-run/tool-execution-authority";
export class PgParentRunControlReader implements ParentCancellationReader, ToolAuthorityReader {
  constructor(private readonly db: DatabasePort) {}
  async readCancellation(orgId: OrgId, parentRunId: string) {
    return this.db.withTenant(orgId, async session => {
      const { rows } = await session.query<{ id: string; org_id: OrgId; cancel_requested_at: Date | string }>(
        "SELECT id,org_id,cancel_requested_at FROM agent_runs WHERE org_id=$1 AND id=$2 AND cancel_requested_at IS NOT NULL", [orgId, parentRunId]);
      const row = rows[0];
      return row ? { orgId: row.org_id, parentRunId: row.id, requestId: parentCancelRequestId(row.org_id, row.id, row.cancel_requested_at) } : null;
    });
  }
  withSnapshot<T>(input: ExecutionAuthorityContext, check: (snapshot: ToolAuthoritySnapshot | null) => Promise<T>): Promise<T> {
    return this.db.withTenant(input.orgId, async session => {
      const { rows } = await session.query<{ active: boolean; cancel_requested: boolean; lease_valid: boolean; attempt_id: string | null; skill_version_ids: string[]; pending_permission_request_id: string | null; pending_tool_call_id: string | null; pending_tool_name: string | null; pending_tool_args_digest: string | null; pending_decision: string | null; pending_edited_args: string | null; pending_tool_authorized_attempt: string | null }>(
        `SELECT r.status='running' AS active, r.cancel_requested_at IS NOT NULL AS cancel_requested,
           r.lease_epoch=$3 AND r.lease_expires_at>now() AS lease_valid, r.skill_version_ids, r.pending_permission_request_id, r.pending_tool_call_id, r.pending_tool_name,
           r.pending_tool_args_digest, r.pending_decision, r.pending_edited_args, r.pending_tool_authorized_attempt,
           (SELECT r.id||':'||(s.seq-1)::text FROM agent_run_steps s
             WHERE s.org_id=r.org_id AND s.run_id=r.id AND s.kind='context_built'
               AND s.started_at>=r.started_at ORDER BY s.seq DESC LIMIT 1) AS attempt_id
         FROM agent_runs r WHERE r.org_id=$1 AND r.id=$2 FOR UPDATE OF r`,
        [input.orgId, input.parentRunId, input.leaseEpoch]);
      const row = rows[0];
      return check(row ? { active: row.active, cancelRequested: row.cancel_requested, leaseValid: row.lease_valid,
        attemptId: row.attempt_id, skillVersionIds: row.skill_version_ids,
        explicitlyDenied: Boolean(input.toolCallId && input.toolCallId === row.pending_tool_call_id && ["deny", "reject"].includes(row.pending_decision ?? "")),
        authorizeOnce: async () => {
          if (!input.permissionRequestId || !input.toolCallId || input.toolArgs === undefined
            || row.pending_permission_request_id !== input.permissionRequestId || row.pending_tool_call_id !== input.toolCallId
            || row.pending_tool_name !== input.toolName || !["approve", "edit"].includes(row.pending_decision ?? "")) return false;
          let expected = row.pending_tool_args_digest;
          if (row.pending_decision === "edit") {
            try { expected = toolArgumentsDigest(JSON.parse(row.pending_edited_args ?? "")); } catch { return false; }
          }
          if (!expected || toolArgumentsDigest(input.toolArgs) !== expected) return false;
          if (row.pending_tool_authorized_attempt) return row.pending_tool_authorized_attempt === input.attemptId;
          const consumed = await session.query(`UPDATE agent_runs SET pending_tool_authorized_attempt=$3
            WHERE org_id=$1 AND id=$2 AND pending_tool_authorized_attempt IS NULL RETURNING id`,
            [input.orgId, input.parentRunId, input.attemptId]);
          return consumed.rows.length === 1;
        } } : null);
    });
  }
}
