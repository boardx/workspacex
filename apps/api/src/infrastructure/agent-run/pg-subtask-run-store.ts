import { randomUUID } from "node:crypto";
import type { DatabasePort } from "../../application/ports/database.port";
import type { OrgId } from "../../domain/org-id";
import { DEFAULT_STALE_RUNNING_THRESHOLD_MS } from "../../application/agent-run/ports";
import { SubtaskIdempotencyConflictError } from "../../application/agent-run/subtask-run-queue";
import type { EnqueueSubtaskRunInput, SubtaskRun, SubtaskRunStore } from "../../application/agent-run/subtask-run-queue";

type Row = { id: string; parent_run_id: string; description: string; context: string | null;
  status: SubtaskRun["status"]; result: string | null; error: string | null; created_at: Date; updated_at: Date };
const decode = (r: Row): SubtaskRun => ({ id: r.id, parentRunId: r.parent_run_id,
  description: r.description, context: r.context, status: r.status, result: r.result,
  error: r.error, createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString() });

/** Durable four-state queue. Stale executions fail; they are never automatically replayed
 * without fencing. Existing user retry creates a new id. Recovery runs on the next tenant kick. */
export class PgSubtaskRunStore implements SubtaskRunStore {
  constructor(private readonly db: DatabasePort,
    private readonly staleMs = DEFAULT_STALE_RUNNING_THRESHOLD_MS) {}

  enqueue(orgId: OrgId, input: EnqueueSubtaskRunInput): Promise<SubtaskRun> {
    return this.db.withTenant(orgId, async (s) => {
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

  claimQueued(orgId: OrgId, limit: number): Promise<readonly SubtaskRun[]> {
    return this.db.withTenant(orgId, async (s) => {
      await s.query(`UPDATE subtask_runs SET status='failed', error='subtask_execution_lost_after_restart_or_timeout',
        updated_at=now() WHERE org_id=$1 AND status='running' AND updated_at < now() - ($2 * interval '1 millisecond')`, [orgId, this.staleMs]);
      const r = await s.query<Row>(`UPDATE subtask_runs SET status='running', updated_at=now()
        WHERE id IN (SELECT id FROM subtask_runs WHERE org_id=$1 AND status='pending'
          ORDER BY created_at,id LIMIT $2 FOR UPDATE SKIP LOCKED) RETURNING *`,
      [orgId, Number.isFinite(limit) ? Math.max(0, Math.floor(limit)) : 0]);
      return r.rows.map(decode).sort((a,b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
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
