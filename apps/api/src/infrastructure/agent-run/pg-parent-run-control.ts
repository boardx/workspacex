import {NATIVE_ARTIFACT_TOOL} from '@repo/contracts/native-artifact-publish';
import { toolArgumentsDigest } from "../../application/agent-run/tool-arguments-digest";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { parentCancelRequestId, type ParentCancellationReader } from "../../application/agent-run/parent-run-control";
import type { ToolAuthorityReader, ToolAuthoritySnapshot, ExecutionAuthorityContext } from "../../application/agent-run/tool-execution-authority";
/** A new call ID cannot turn the same explicitly rejected arguments into consent.
 * A distinct call with distinct arguments may still use an existing scoped grant. */
export function matchesDeniedTool(input: ExecutionAuthorityContext, pending: {
  pending_decision: string | null; pending_tool_call_id: string | null;
  pending_tool_name: string | null; pending_tool_args_digest: string | null;
}): boolean {
  if (!["deny", "reject"].includes(pending.pending_decision ?? "")) return false;
  if (input.toolCallId && input.toolCallId === pending.pending_tool_call_id) return true;
  if (input.toolName !== pending.pending_tool_name) return false;
  const digest = toolArgumentsDigest(input.toolArgs);
  return !input.toolCallId || !digest || !pending.pending_tool_args_digest || digest === pending.pending_tool_args_digest;
}
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
      /**
       * #2931 —— 严格回退：只有当这个 id **不是**父 run 时才查子任务表。一个产文件的
       * durable 子任务必须用自己的 (run, attempt, lease) 身份被授权；在此之前它在
       * `agent_runs` 里查不到 ⇒ 一律 `run_unavailable`，真实子模型一次都发布不了。
       *
       * JOIN 父 run 不是为了继承它的权限，恰恰相反：① 父级取消照样管住子任务；
       * ② 返回的 `allowed_tools` 把子任务收窄到**只有**发布产物那一个工具，
       * 父 run 的其余 native 工具一概不给。子任务行不带 pending_* 授权字段，
       * 因此 `authorizeOnce` 的 UPDATE 按子任务 id 打在 `agent_runs` 上必然 0 行、
       * 返回 false —— fail closed，不是漏网。
       */
      const row = rows[0] ?? (await session.query<typeof rows[number] & { allowed_tools: string[] }>(
        `SELECT c.status='running' AS active, c.cancel_requested_at IS NOT NULL OR p.cancel_requested_at IS NOT NULL AS cancel_requested,
           c.lease_epoch=$3 AS lease_valid, c.execution_attempt_id AS attempt_id, c.skill_version_ids,
           NULL AS pending_permission_request_id, NULL AS pending_tool_call_id, NULL AS pending_tool_name,
           NULL AS pending_tool_args_digest, NULL AS pending_decision, NULL AS pending_edited_args,
           NULL AS pending_tool_authorized_attempt,
           CASE WHEN c.output_policy IS NOT NULL THEN ARRAY[$4::text] ELSE ARRAY[]::text[] END AS allowed_tools
         FROM subtask_runs c JOIN agent_runs p ON p.org_id=c.org_id AND p.id=c.parent_run_id
         WHERE c.org_id=$1 AND c.id=$2 FOR UPDATE OF p,c`,
        [input.orgId, input.parentRunId, input.leaseEpoch, NATIVE_ARTIFACT_TOOL])).rows[0];
      return check(row ? { active: row.active, cancelRequested: row.cancel_requested, leaseValid: row.lease_valid,
        attemptId: row.attempt_id, skillVersionIds: row.skill_version_ids,
        explicitlyDenied: matchesDeniedTool(input, row),
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
        },
        ...("allowed_tools" in row ? { allowedTools: (row as { allowed_tools: string[] }).allowed_tools } : {}) } : null);
    });
  }
}
