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
import type { DatabasePort } from "../../application/ports/database.port";
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

/** `agent_runs.status` (DB enum, six values incl. DA-07b's `awaiting_approval`) → contract's `RunStatusForPhase`. */
function toRunStatusForPhase(dbStatus: string): PlanRunSnapshot["status"] {
  switch (dbStatus) {
    case "queued":
    case "running":
    case "writeback_pending":
    case "awaiting_approval":
      return "running";
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
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

  async getLatestRun(orgId: OrgId, threadId: string): Promise<PlanRunSnapshot | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<{
        id: string; status: string; pending_tool_name: string | null; created_at: Date;
      }>(
        `SELECT id, status, pending_tool_name, created_at
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
        status: toRunStatusForPhase(row.status),
        pendingToolName: row.status === "awaiting_approval" ? row.pending_tool_name : null,
        createdAt: row.created_at.toISOString(),
      };
    });
  }
}

/** Exported for tests/callers that need a fresh planStepId without importing `node:crypto` directly. */
export function newPlanStepId(): string {
  return randomUUID();
}
