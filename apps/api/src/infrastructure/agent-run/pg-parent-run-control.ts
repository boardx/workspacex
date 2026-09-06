import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { parentCancelRequestId, type ParentCancellationReader } from "../../application/agent-run/parent-run-control";
import type { ToolAuthorityReader, ToolAuthoritySnapshot, ToolExecutionCheck } from "../../application/agent-run/tool-execution-authority";
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
  withSnapshot<T>(input: ToolExecutionCheck, check: (snapshot: ToolAuthoritySnapshot | null) => Promise<T>): Promise<T> {
    return this.db.withTenant(input.orgId, async session => {
      const { rows } = await session.query<{ active: boolean; cancel_requested: boolean; lease_valid: boolean; attempt_id: string | null; skill_version_ids: string[] }>(
        `SELECT r.status='running' AS active, r.cancel_requested_at IS NOT NULL AS cancel_requested,
           r.lease_epoch=$3 AND r.lease_expires_at>now() AS lease_valid, r.skill_version_ids,
           (SELECT r.id||':'||(s.seq-1)::text FROM agent_run_steps s
             WHERE s.org_id=r.org_id AND s.run_id=r.id AND s.kind='context_built'
               AND s.started_at>=r.started_at ORDER BY s.seq DESC LIMIT 1) AS attempt_id
         FROM agent_runs r WHERE r.org_id=$1 AND r.id=$2 FOR UPDATE OF r`,
        [input.orgId, input.parentRunId, input.leaseEpoch]);
      const row = rows[0];
      return check(row ? { active: row.active, cancelRequested: row.cancel_requested, leaseValid: row.lease_valid,
        attemptId: row.attempt_id, skillVersionIds: row.skill_version_ids } : null);
    });
  }
}
