import type { DatabasePort } from '../../application/ports/database.port';
import { type BoardBlobSweepResult, SweepBoardBlobs } from '../../application/whiteboard/blob-gc';
import type { BoardBlobGcPolicy } from '../../application/whiteboard/blob-gc-policy';
import { toOrgId } from '../../domain/org-id';

export type BoardBlobSweepRun =
  | { status: 'completed'; startedAt: string; finishedAt: string; result: BoardBlobSweepResult }
  | { status: 'skipped-lease' | 'skipped-frequency' };

/**
 * A transaction-scoped advisory lease serializes every supported runner for one Board.
 * The same transaction persists cadence and counters; a crash releases the lease and a
 * restart safely retries because purge is conditional and idempotent.
 */
export class PgBoardBlobSweepCoordinator {
  constructor(private readonly db: DatabasePort, private readonly sweep: SweepBoardBlobs,
    private readonly policy: BoardBlobGcPolicy, private readonly now: () => Date = () => new Date()) {}

  run(input: { tenantId: string; boardId: string; cursor?: string }): Promise<BoardBlobSweepRun> {
    return this.db.withTenant(toOrgId(input.tenantId), async session => {
      const lease = await session.query<{ acquired: boolean }>(
        `SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) acquired`,
        [`board-blob-gc:${input.tenantId}:${input.boardId}`],
      );
      if (!lease.rows[0]?.acquired) return { status: 'skipped-lease' };
      const prior = await session.query<{ last_finished_at: Date | string; next_cursor: string | null }>(
        `SELECT last_finished_at,next_cursor FROM whiteboard_blob_gc_runs WHERE org_id=$1 AND board_id=$2 FOR UPDATE`,
        [input.tenantId, input.boardId],
      );
      const started = this.now();
      if (prior.rows[0] && started.getTime() - new Date(prior.rows[0].last_finished_at).getTime() < this.policy.minIntervalMs) {
        return { status: 'skipped-frequency' };
      }
      const cursor = input.cursor ?? prior.rows[0]?.next_cursor ?? undefined;
      const result = await this.sweep.run({ tenantId: input.tenantId, boardId: input.boardId,
        createdBefore: new Date(started.getTime() - this.policy.graceMs), limit: this.policy.batchSize, ...(cursor ? { cursor } : {}) });
      const finished = this.now(), durationMs = Math.max(0, finished.getTime() - started.getTime());
      await session.query(
        `INSERT INTO whiteboard_blob_gc_runs(org_id,board_id,last_started_at,last_finished_at,duration_ms,examined,deleted,retained,changed,next_cursor)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT(org_id,board_id) DO UPDATE SET last_started_at=excluded.last_started_at,last_finished_at=excluded.last_finished_at,
           duration_ms=excluded.duration_ms,examined=excluded.examined,deleted=excluded.deleted,retained=excluded.retained,
           changed=excluded.changed,next_cursor=excluded.next_cursor`,
        [input.tenantId, input.boardId, started.toISOString(), finished.toISOString(), durationMs,
          result.examined, result.deleted, result.retained, result.changed, result.nextCursor ?? null],
      );
      return { status: 'completed', startedAt: started.toISOString(), finishedAt: finished.toISOString(), result };
    });
  }
}
