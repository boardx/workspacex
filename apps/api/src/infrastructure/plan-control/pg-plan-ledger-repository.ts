/**
 * PostgreSQL implementation of `PlanLedgerRepository` + `PlanRunStatusReader` (F973).
 *
 * Append-only is enforced BELOW this class (migration
 * `20260826150000_f972_plan_control_ledger.sql`'s pre-write immutability guard trigger, plus
 * the fact that its UPDATE-grant was revoked), same discipline as `pg-provenance-repository.ts`:
 * there is no `update` method here because there is no grant to back one, not the other way round.
 */
import { randomUUID } from "node:crypto";
import type { PlanStep } from "@repo/contracts/plan-control";
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  OrphanedConstraintRow,
  PlanLedgerRepository,
  PlanLedgerRow,
  PlanRunSnapshot,
  PlanRunStatusReader,
} from "../../application/plan-control/ports";
import type { OrgId } from "../../domain/org-id";

interface LedgerRow {
  revision: number;
  engine_epoch: number;
  origin: "engine" | "user";
  based_on_revision: number | null;
  steps: unknown;
  created_by: string | null;
  created_at: Date;
}

function toLedgerRow(r: LedgerRow): PlanLedgerRow {
  return {
    revision: r.revision,
    engineEpoch: r.engine_epoch,
    origin: r.origin,
    basedOnRevision: r.based_on_revision,
    // `steps` is stored as jsonb -- the `pg` driver already decodes it to plain JS values,
    // shape guaranteed by whoever wrote the row (this class' own `appendEngineSnapshot`, or
    // F974's edit use cases once they land). Not re-validated with zod on read: this is a
    // trusted internal round-trip, not an external boundary.
    steps: r.steps as PlanStep[],
    createdBy: r.created_by,
    createdAt: r.created_at.toISOString(),
  };
}

/** `agent_runs.status` (DB enum, six values incl. DA-07b's `awaiting_tool_permission`) → contract's `RunStatusForPhase`. */
function toRunStatusForPhase(dbStatus: string): PlanRunSnapshot["status"] {
  switch (dbStatus) {
    case "queued":
    case "running":
    case "writeback_pending":
    case "awaiting_tool_permission":
      return "running";
    case "paused":
      return "interrupted";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    default:
      // Unknown future status: fail toward "running" (i.e. do not silently claim "done").
      return "running";
  }
}

export class PgPlanLedgerRepository implements PlanLedgerRepository, PlanRunStatusReader {
  constructor(private readonly db: DatabasePort) {}

  async getLatest(orgId: OrgId, threadId: string): Promise<PlanLedgerRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<LedgerRow>(
        `SELECT revision, engine_epoch, origin, based_on_revision, steps, created_by, created_at
           FROM chat_plan_ledgers
          WHERE thread_id = $1
          ORDER BY revision DESC
          LIMIT 1`,
        [threadId],
      );
      const row = r.rows[0];
      return row ? toLedgerRow(row) : null;
    });
  }

  async listOrphanedConstraints(orgId: OrgId, threadId: string): Promise<OrphanedConstraintRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        constraint_id: string; text: string; orphaned_at_revision: number; former_step_content: string;
      }>(
        `SELECT constraint_id, text, orphaned_at_revision, former_step_content
           FROM chat_plan_orphan_constraints
          WHERE thread_id = $1
          ORDER BY created_at`,
        [threadId],
      );
      return r.rows.map((row) => ({
        constraintId: row.constraint_id,
        text: row.text,
        orphanedAtRevision: row.orphaned_at_revision,
        formerStepContent: row.former_step_content,
      }));
    });
  }

  async appendEngineSnapshot(input: {
    readonly orgId: OrgId; readonly threadId: string; readonly steps: PlanStep[];
  }): Promise<{ revision: number; engineEpoch: number }> {
    return this.db.withTenant(input.orgId, async (s) => {
      // Serialise with the CURRENT max revision inside the same transaction the INSERT runs
      // in -- Postgres' default READ COMMITTED plus this table's (thread_id, revision)
      // PRIMARY KEY means a genuine race here surfaces as a duplicate-key error, not a
      // silently-lost revision (I-2). This use case (single in-process AG-UI bridge call per
      // write_todos) does not need a row lock (`SELECT ... FOR UPDATE`) on top of that.
      const latest = await s.query<{ revision: number; engine_epoch: number }>(
        `SELECT revision, engine_epoch FROM chat_plan_ledgers
          WHERE thread_id = $1 ORDER BY revision DESC LIMIT 1`,
        [input.threadId],
      );
      const prev = latest.rows[0];
      const revision = prev ? prev.revision + 1 : 0;
      const engineEpoch = prev ? prev.engine_epoch + 1 : 0;

      await s.query(
        `INSERT INTO chat_plan_ledgers
           (thread_id, org_id, revision, engine_epoch, origin, based_on_revision, steps, created_by)
         VALUES ($1,$2,$3,$4,'engine',NULL,$5,NULL)`,
        [input.threadId, input.orgId, revision, engineEpoch, JSON.stringify(input.steps)],
      );
      return { revision, engineEpoch };
    });
  }

  async getLatestWithin(session: TenantSession, threadId: string): Promise<PlanLedgerRow | null> {
    const r = await session.query<LedgerRow>(
      `SELECT revision, engine_epoch, origin, based_on_revision, steps, created_by, created_at
         FROM chat_plan_ledgers
        WHERE thread_id = $1
        ORDER BY revision DESC
        LIMIT 1`,
      [threadId],
    );
    const row = r.rows[0];
    return row ? toLedgerRow(row) : null;
  }

  async appendUserEditWithin(session: TenantSession, input: {
    readonly orgId: OrgId; readonly threadId: string; readonly basedOnRevision: number;
    readonly engineEpoch: number; readonly steps: PlanStep[]; readonly createdBy: string;
  }): Promise<{ revision: number }> {
    const revision = input.basedOnRevision + 1;
    await session.query(
      `INSERT INTO chat_plan_ledgers
         (thread_id, org_id, revision, engine_epoch, origin, based_on_revision, steps, created_by)
       VALUES ($1,$2,$3,$4,'user',$5,$6,$7)`,
      [
        input.threadId, input.orgId, revision, input.engineEpoch, input.basedOnRevision,
        JSON.stringify(input.steps), input.createdBy,
      ],
    );
    return { revision };
  }

  async insertOrphanedConstraintsWithin(session: TenantSession, input: {
    readonly orgId: OrgId; readonly threadId: string; readonly orphanedAtRevision: number;
    readonly formerStepContent: string;
    readonly constraints: ReadonlyArray<{ readonly constraintId: string; readonly text: string }>;
  }): Promise<void> {
    for (const c of input.constraints) {
      await session.query(
        `INSERT INTO chat_plan_orphan_constraints
           (constraint_id, thread_id, org_id, text, former_step_content, orphaned_at_revision)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [c.constraintId, input.threadId, input.orgId, c.text, input.formerStepContent, input.orphanedAtRevision],
      );
    }
  }

  async deleteOrphanedConstraintWithin(
    session: TenantSession, orgId: OrgId, threadId: string, constraintId: string,
  ): Promise<boolean> {
    // `TenantSession.query`'s `QueryResult<R>` only exposes `rows`, not `pg`'s own
    // `rowCount` -- so "did this actually delete anything" is read off a `RETURNING`
    // clause rather than a driver field this port's shape does not carry.
    const r = await session.query<{ constraint_id: string }>(
      `DELETE FROM chat_plan_orphan_constraints WHERE thread_id = $1 AND constraint_id = $2
       RETURNING constraint_id`,
      [threadId, constraintId],
    );
    return r.rows.length > 0;
  }

  async getLatestRun(orgId: OrgId, threadId: string): Promise<PlanRunSnapshot | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string; status: string; pending_tool_name: string | null; created_at: Date; agent_id: string;
        remote_run_id: string | null; paused_at: Date | null; error_code: string | null; model_provider: string; pause_requested_at: Date | null; cancel_requested_at: Date | null;
      }>(
        `SELECT id, status, pending_tool_name, created_at, agent_id, remote_run_id, paused_at, error_code, model_provider, pause_requested_at, cancel_requested_at
           FROM agent_runs
          WHERE thread_id = $1
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
        [threadId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        runId: row.id,
        modelProvider: row.model_provider,
        pauseRequestedAt: row.pause_requested_at?.toISOString() ?? null,
        cancelRequestedAt: row.cancel_requested_at?.toISOString() ?? null,
        status: toRunStatusForPhase(row.status),
        pendingToolName: row.status === "awaiting_tool_permission" ? row.pending_tool_name : null,
        createdAt: row.created_at.toISOString(),
        agentId: row.agent_id,
        remoteRunId: row.remote_run_id,
        pausedAt: row.paused_at ? row.paused_at.toISOString() : null,
        // issue #2451 -- 只在真正失败时暴露：run 还没到终态、或成功终态时这一列本来就是
        // NULL（见 get-plan-ledger-derived.test.ts 的插入约定：`status === "failed" ?
        // "MODEL_CALL_FAILED" : null`），这里原样透传，不额外加判断——没有第二份真相。
        errorCode: row.error_code,
      };
    });
  }

  async recordRemoteRunId(orgId: OrgId, runId: string, remoteRunId: string): Promise<void> {
    await this.db.withTenant(orgId, (s) =>
      s.query("UPDATE agent_runs SET remote_run_id = $1 WHERE id = $2", [remoteRunId, runId]),
    );
  }

  async markRunPaused(orgId: OrgId, runId: string): Promise<void> {
    await this.db.withTenant(orgId, (s) =>
      s.query("UPDATE agent_runs SET paused_at = now() WHERE id = $1", [runId]),
    );
  }
}

/** Exported for tests/callers that need a fresh planStepId without importing `node:crypto` directly. */
export function newPlanStepId(): string {
  return randomUUID();
}
