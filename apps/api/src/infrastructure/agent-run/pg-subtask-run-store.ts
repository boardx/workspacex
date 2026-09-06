import { parentCancelRequestId, type ParentCancellation, type ChildCancellationResult } from "../../application/agent-run/parent-run-control";
import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { SUBTASK_STALE_RUNNING_THRESHOLD_MS } from "../../application/agent-run/subtask-run-queue";
import { SubtaskParentCancelledError, SubtaskIdempotencyConflictError } from "../../application/agent-run/subtask-run-queue";
import type { EnqueueSubtaskRunInput, SubtaskRun, SubtaskRunStore, CancelSubtaskOutcome } from "../../application/agent-run/subtask-run-queue";

type Row = { id: string; parent_run_id: string; description: string; context: string | null;
  status: SubtaskRun["status"]; result: string | null; error: string | null; created_at: Date; updated_at: Date };
const decode = (r: Row): SubtaskRun => ({ id: r.id, parentRunId: r.parent_run_id,
  description: r.description, context: r.context, status: r.status, result: r.result,
  error: r.error, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() });

/** Durable four-state queue. Stale executions fail; they are never automatically replayed
 * without fencing. Existing user retry creates a new id. Recovery runs on the next tenant kick. */
export class PgSubtaskRunStore implements SubtaskRunStore {
  constructor(private readonly db: DatabasePort,
    private readonly staleMs = SUBTASK_STALE_RUNNING_THRESHOLD_MS) {}

  enqueue(orgId: OrgId, input: EnqueueSubtaskRunInput): Promise<SubtaskRun> {
    return this.db.withTenant(orgId, async (s) => {
      const parent = await s.query<{ cancel_requested_at: Date | null }>(
        "SELECT cancel_requested_at FROM agent_runs WHERE org_id=$1 AND id=$2 FOR UPDATE", [orgId,input.parentRunId]);
      if (!parent.rows[0]) throw new Error("subtask_parent_unavailable");
      if (parent.rows[0].cancel_requested_at !== null) throw new SubtaskParentCancelledError();
      const r = await s.query<Row>(`INSERT INTO subtask_runs(id,org_id,parent_run_id,description,context,idempotency_key)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING *`,
        [randomUUID(), orgId, input.parentRunId, input.description, input.context ?? null,input.idempotencyKey ?? null]);
      if (r.rows[0]) return decode(r.rows[0]);
      const existing = await s.query<Row>("SELECT * FROM subtask_runs WHERE org_id=$1 AND parent_run_id=$2 AND idempotency_key=$3",
        [orgId,input.parentRunId,input.idempotencyKey]);
      const row = existing.rows[0];
      if (!row || row.description !== input.description || row.context !== (input.context ?? null)) {
        throw new SubtaskIdempotencyConflictError("subtask_idempotency_conflict");
      }
      return decode(row);
    });
  }

  cancel(orgId: OrgId, parentRunId: string, id: string): Promise<CancelSubtaskOutcome> {
    return this.db.withTenant(orgId, async (s) => {
      const locked = await s.query<Row>("SELECT * FROM subtask_runs WHERE org_id=$1 AND parent_run_id=$2 AND id=$3 FOR UPDATE", [orgId,parentRunId,id]);
      const row = locked.rows[0];
      if (!row) return { kind: "not_found" };
      if (row.status === "running") return { kind: "cancellation_not_supported_for_running" };
      if (row.status === "completed" || row.status === "failed") return { kind: "terminal_conflict" };
      if (row.status === "cancelled") return { kind: "cancelled", subtaskRun: { ...decode(row), status: "cancelled" } };
      const changed = await s.query<Row>("UPDATE subtask_runs SET status='cancelled',updated_at=now() WHERE org_id=$1 AND parent_run_id=$2 AND id=$3 AND status='pending' RETURNING *", [orgId,parentRunId,id]);
      return { kind: "cancelled", subtaskRun: { ...decode(changed.rows[0]!), status: "cancelled" } };
    });
  }

  claimQueued(orgId: OrgId, limit: number): Promise<readonly SubtaskRun[]> {
    return this.db.withTenant(orgId, async (s) => {
      await s.query(`UPDATE subtask_runs SET status='failed', error='subtask_execution_lost_after_restart_or_timeout',
        updated_at=now() WHERE org_id=$1 AND status='running' AND updated_at < now() - ($2 * interval '1 millisecond')`, [orgId, this.staleMs]);
      const maximum = Number.isFinite(limit) ? Math.max(0,Math.floor(limit)) : 0;
      const parents = await s.query<{ id: string; cancel_requested_at: Date | null }>(
        `SELECT id,cancel_requested_at FROM agent_runs WHERE org_id=$1 AND id IN
          (SELECT parent_run_id FROM subtask_runs WHERE org_id=$1 AND status='pending')
         ORDER BY id LIMIT $2 FOR UPDATE SKIP LOCKED`, [orgId,maximum]);
      const claimed: SubtaskRun[] = [];
      for (const parent of parents.rows) {
        if (parent.cancel_requested_at !== null) {
          await s.query("UPDATE subtask_runs SET status='cancelled',updated_at=now() WHERE org_id=$1 AND parent_run_id=$2 AND status='pending'", [orgId,parent.id]);
          continue;
        }
        const r = await s.query<Row>(`UPDATE subtask_runs SET status='running',updated_at=now()
          WHERE org_id=$1 AND id IN (SELECT id FROM subtask_runs WHERE org_id=$1 AND parent_run_id=$2 AND status='pending'
          ORDER BY created_at,id LIMIT $3 FOR UPDATE SKIP LOCKED) RETURNING *`, [orgId,parent.id,maximum-claimed.length]);
        claimed.push(...r.rows.map(decode));
        if (claimed.length >= maximum) break;
      }
      return claimed.sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    });
  }

  cancelChildren(input: ParentCancellation): Promise<ChildCancellationResult> {
    return this.cancellation(input,true);
  }
  readCancellation(input: ParentCancellation): Promise<ChildCancellationResult> {
    return this.cancellation(input,false);
  }
  private cancellation(input: ParentCancellation, mutate: boolean): Promise<ChildCancellationResult> {
    const orgId = input.orgId;
    return this.db.withTenant(orgId, async s => {
      const parent = mutate
        ? await s.query<{ cancel_requested_at: Date | null }>("SELECT cancel_requested_at FROM agent_runs WHERE org_id=$1 AND id=$2 FOR UPDATE",[orgId,input.parentRunId])
        : await s.query<{ cancel_requested_at: Date | null }>("SELECT cancel_requested_at FROM agent_runs WHERE org_id=$1 AND id=$2",[orgId,input.parentRunId]);
      const stamp=parent.rows[0]?.cancel_requested_at;
      if (!stamp || parentCancelRequestId(orgId,input.parentRunId,stamp)!==input.requestId) return {kind:"unavailable"};
      if (mutate) await s.query("UPDATE subtask_runs SET status='cancelled',updated_at=now() WHERE org_id=$1 AND parent_run_id=$2 AND status='pending'",[orgId,input.parentRunId]);
      const active=await s.query<{id:string;status:string}>("SELECT id,status FROM subtask_runs WHERE org_id=$1 AND parent_run_id=$2 AND status IN ('pending','running') ORDER BY id",[orgId,input.parentRunId]);
      return active.rows.length ? {kind:"pending",runningChildIds:active.rows.filter(row=>row.status==='running').map(row=>row.id)} : {kind:"confirmed"};
    });
  }

  complete(orgId: OrgId, id: string, result: string): Promise<void> {
    return this.finish(orgId, id, "completed", result, null);
  }
  fail(orgId: OrgId, id: string, error: string): Promise<void> {
    return this.finish(orgId, id, "failed", null, error);
  }
  private async finish(orgId: OrgId, id: string, status: string, result: string | null, error: string | null): Promise<void> {
    await this.db.withTenant(orgId, (s) => s.query(`UPDATE subtask_runs SET status=$3,result=$4,error=$5,updated_at=now()
      WHERE org_id=$1 AND id=$2 AND status='running'`, [orgId,id,status,result,error]));
  }
  get(orgId: OrgId, id: string): Promise<SubtaskRun | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>("SELECT * FROM subtask_runs WHERE org_id=$1 AND id=$2", [orgId,id]);
      return r.rows[0] ? decode(r.rows[0]) : null;
    });
  }
  listByParentRun(orgId: OrgId, parentRunId: string): Promise<readonly SubtaskRun[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<Row>("SELECT * FROM subtask_runs WHERE org_id=$1 AND parent_run_id=$2 ORDER BY created_at,id", [orgId,parentRunId]);
      return r.rows.map(decode);
    });
  }
}
