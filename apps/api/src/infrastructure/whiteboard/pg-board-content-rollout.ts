import { randomUUID } from 'node:crypto';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import type { BoardContentRolloutItemOutcome, BoardContentRolloutJob, BoardContentRolloutLease, BoardContentRolloutLimits, BoardContentRolloutRepository, BoardContentRolloutSnapshot, BoardContentRolloutStatus } from '../../application/whiteboard/content-rollout-ports';
import { assertBoardContentRolloutLimits } from '../../application/whiteboard/run-board-content-rollout';
import { toOrgId } from '../../domain/org-id';

type JobRow = { status: BoardContentRolloutStatus; cursor_board_id: string | null; snapshot_upper_board_id: string | null;
  discovery_cycle: string | number; cycle_new_items?: string | number; exhausted: boolean; config: unknown };
type LeaseRow = { board_id: string; migration_job_id: string; attempts: number; lease_token: string; lease_epoch: string | number };
type MetricsRow = { discovered: string; scanned: string; migrated: string; failed: string; retried: string; bytes_read: string; bytes_written: string; cas_resets: string; orphan_candidates: string; phase_calls: string; latency_ms: string };

function nonNegative(value: string | number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('INVALID_ROLLOUT_METRIC');
  return parsed;
}

function parseLimits(value: unknown): BoardContentRolloutLimits {
  if (!value || typeof value !== 'object') throw new Error('INVALID_ROLLOUT_CONFIG');
  const source = value as Record<string, unknown>;
  const limits: BoardContentRolloutLimits = {
    pageSize: Number(source.pageSize), maxPagesPerRun: Number(source.maxPagesPerRun), maxBoardsPerRun: Number(source.maxBoardsPerRun),
    globalConcurrency: Number(source.globalConcurrency), tenantConcurrency: Number(source.tenantConcurrency), ratePerSecond: Number(source.ratePerSecond),
    phaseBudget: Number(source.phaseBudget), retryBudget: Number(source.retryBudget), baseBackoffMs: Number(source.baseBackoffMs),
    maxBackoffMs: Number(source.maxBackoffMs), leaseMs: Number(source.leaseMs),
  };
  assertBoardContentRolloutLimits(limits);
  return limits;
}

function sameConfig(left: BoardContentRolloutLimits, right: BoardContentRolloutLimits): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function job(tenantId: string, rolloutId: string, row: JobRow): BoardContentRolloutJob {
  return { tenantId, rolloutId, status: row.status, cursor: row.cursor_board_id,
    snapshotUpperBoardId: row.snapshot_upper_board_id, discoveryCycle: nonNegative(row.discovery_cycle),
    exhausted: row.exhausted, limits: parseLimits(row.config) };
}

export class PgBoardContentRolloutRepository implements BoardContentRolloutRepository {
  constructor(private readonly db: DatabasePort) {}

  private run<T>(tenantId: string, operation: (session: TenantSession) => Promise<T>): Promise<T> {
    return this.db.withTenant(toOrgId(tenantId), operation);
  }

  preview(tenantId: string, cursor: string | null, limit: number): Promise<{ boardIds: string[]; remaining: number }> {
    return this.run(tenantId, async session => {
      const page = await session.query<{ id: string }>(`SELECT b.id::text id FROM whiteboards b JOIN whiteboard_content_heads h ON h.org_id=b.org_id AND h.board_id=b.id WHERE b.org_id=$1 AND h.storage_kind='legacy_pg' AND ($2::uuid IS NULL OR b.id>$2::uuid) ORDER BY b.id LIMIT $3`, [tenantId, cursor, limit]);
      const count = await session.query<{ count: string }>(`SELECT count(*)::text count FROM whiteboard_content_heads WHERE org_id=$1 AND storage_kind='legacy_pg'`, [tenantId]);
      return { boardIds: page.rows.map(row => row.id), remaining: nonNegative(count.rows[0]?.count ?? '0') };
    });
  }

  loadOrCreate(tenantId: string, rolloutId: string, limits: BoardContentRolloutLimits): Promise<BoardContentRolloutJob> {
    return this.run(tenantId, async session => {
      await session.query(`INSERT INTO whiteboard_content_rollouts(org_id,rollout_id,config,snapshot_upper_board_id)
        VALUES($1,$2,$3::jsonb,(SELECT b.id FROM whiteboards b JOIN whiteboard_content_heads h ON h.org_id=b.org_id AND h.board_id=b.id
        WHERE b.org_id=$1 AND h.storage_kind='legacy_pg' ORDER BY b.id DESC LIMIT 1)) ON CONFLICT(org_id,rollout_id) DO NOTHING`, [tenantId, rolloutId, JSON.stringify(limits)]);
      const loaded = await this.loadRow(session, tenantId, rolloutId);
      const parsed = job(tenantId, rolloutId, loaded);
      if (!sameConfig(parsed.limits, limits)) throw new Error('ROLLOUT_CONFIG_CONFLICT');
      return parsed;
    });
  }

  load(tenantId: string, rolloutId: string): Promise<BoardContentRolloutJob> {
    return this.run(tenantId, async session => job(tenantId, rolloutId, await this.loadRow(session, tenantId, rolloutId)));
  }

  setControl(tenantId: string, rolloutId: string, status: 'running' | 'paused' | 'cancelled'): Promise<BoardContentRolloutJob> {
    return this.run(tenantId, async session => {
      const result = await session.query<JobRow>(`UPDATE whiteboard_content_rollouts SET status=$3,control_revision=control_revision+1,updated_at=now() WHERE org_id=$1 AND rollout_id=$2 AND status<>'completed' RETURNING status,cursor_board_id,snapshot_upper_board_id,discovery_cycle,cycle_new_items,exhausted,config`, [tenantId, rolloutId, status]);
      if (!result.rows[0]) throw new Error('ROLLOUT_NOT_FOUND_OR_COMPLETED');
      if (status === 'paused' || status === 'cancelled') {
        await session.query(`SELECT invalidate_whiteboard_content_rollout_leases($1,$2,$3)`, [tenantId, rolloutId, status]);
      }
      await session.query(`INSERT INTO whiteboard_content_rollout_events(org_id,rollout_id,kind,code,detail) VALUES($1,$2,'control',$3,$4::jsonb)`, [tenantId, rolloutId, status.toUpperCase(), JSON.stringify({ status })]);
      return job(tenantId, rolloutId, result.rows[0]);
    });
  }

  preparePage(tenantId: string, rolloutId: string): Promise<number> {
    return this.run(tenantId, async session => {
      const locked = await session.query<JobRow>(`SELECT status,cursor_board_id,snapshot_upper_board_id,discovery_cycle,cycle_new_items,exhausted,config FROM whiteboard_content_rollouts WHERE org_id=$1 AND rollout_id=$2 FOR UPDATE`, [tenantId, rolloutId]);
      const row = locked.rows[0];
      if (!row) throw new Error('ROLLOUT_NOT_FOUND');
      const current = job(tenantId, rolloutId, row);
      if (current.status !== 'running' || current.exhausted) return 0;
      const boards = await session.query<{ id: string }>(`SELECT b.id::text id FROM whiteboards b JOIN whiteboard_content_heads h ON h.org_id=b.org_id AND h.board_id=b.id WHERE b.org_id=$1 AND h.storage_kind='legacy_pg' AND ($2::uuid IS NULL OR b.id>$2::uuid) AND ($3::uuid IS NULL OR b.id<=$3::uuid) ORDER BY b.id LIMIT $4`, [tenantId, current.cursor, current.snapshotUpperBoardId, current.limits.pageSize]);
      let inserted = 0;
      for (const board of boards.rows) {
        const created = await session.query(`INSERT INTO whiteboard_content_rollout_items(org_id,rollout_id,board_id,migration_job_id) VALUES($1,$2,$3,$4) ON CONFLICT(org_id,rollout_id,board_id) DO NOTHING RETURNING board_id`, [tenantId, rolloutId, board.id, randomUUID()]);
        inserted += created.rows.length;
      }
      const cursor = boards.rows.at(-1)?.id ?? current.cursor;
      const cycleNew = nonNegative(row.cycle_new_items ?? 0) + inserted;
      if (boards.rows.length < current.limits.pageSize) {
        if (cycleNew === 0) {
          await session.query(`UPDATE whiteboard_content_rollouts SET cursor_board_id=$3,exhausted=true,discovered=discovered+$4,cycle_new_items=0,updated_at=now() WHERE org_id=$1 AND rollout_id=$2`, [tenantId, rolloutId, cursor, inserted]);
        } else {
          await session.query(`UPDATE whiteboard_content_rollouts r SET cursor_board_id=NULL,snapshot_upper_board_id=(SELECT b.id FROM whiteboards b JOIN whiteboard_content_heads h ON h.org_id=b.org_id AND h.board_id=b.id WHERE b.org_id=$1 AND h.storage_kind='legacy_pg' ORDER BY b.id DESC LIMIT 1),discovery_cycle=discovery_cycle+1,cycle_new_items=0,discovered=discovered+$3,updated_at=now() WHERE r.org_id=$1 AND r.rollout_id=$2`, [tenantId, rolloutId, inserted]);
        }
      } else {
        await session.query(`UPDATE whiteboard_content_rollouts SET cursor_board_id=$3,cycle_new_items=cycle_new_items+$4,discovered=discovered+$4,updated_at=now() WHERE org_id=$1 AND rollout_id=$2`, [tenantId, rolloutId, cursor, inserted]);
      }
      return inserted;
    });
  }

  claim(tenantId: string, rolloutId: string, workerId: string, limit: number, leaseUntil: Date): Promise<BoardContentRolloutLease[]> {
    return this.run(tenantId, async session => {
      if (limit < 1) return [];
      const token = randomUUID();
      const rows = await session.query<LeaseRow>(`SELECT board_id::text,migration_job_id::text,attempt attempts,lease_token::text,lease_epoch FROM claim_whiteboard_content_rollout_admission($1,$2,$3,$4,$5)`, [tenantId, rolloutId, workerId, token, leaseUntil.toISOString()]);
      return rows.rows.map(row => ({ tenantId, rolloutId, boardId: row.board_id, migrationJobId: row.migration_job_id,
        attempt: nonNegative(row.attempts), owner: workerId, token: row.lease_token, epoch: nonNegative(row.lease_epoch) }));
    });
  }

  release(lease: BoardContentRolloutLease): Promise<void> {
    return this.run(lease.tenantId, async session => {
      const admitted = await session.query<{ released: boolean }>(`SELECT release_whiteboard_content_rollout_admission($1,$2,$3,$4,$5,$6,$7,$8) released`, [lease.tenantId, lease.rolloutId, lease.boardId, lease.migrationJobId, lease.owner, lease.token, lease.epoch, lease.attempt]);
      if (!admitted.rows[0]?.released) return;
      const changed = await session.query(`UPDATE whiteboard_content_rollout_items SET state='queued',attempts=greatest(0,attempts-1),lease_owner=NULL,lease_token=NULL,lease_until=NULL,updated_at=now() WHERE org_id=$1 AND rollout_id=$2 AND board_id=$3 AND migration_job_id=$4 AND state='running' AND lease_owner=$5 AND lease_token=$6 AND lease_epoch=$7 AND attempts=$8 AND lease_until>now() RETURNING board_id`, [lease.tenantId, lease.rolloutId, lease.boardId, lease.migrationJobId, lease.owner, lease.token, lease.epoch, lease.attempt]);
      if (!changed.rows[0]) throw Object.assign(new Error('ROLLOUT_LEASE_LOST'), { code: 'ROLLOUT_LEASE_LOST' });
    });
  }

  finish(lease: BoardContentRolloutLease, outcome: BoardContentRolloutItemOutcome): Promise<void> {
    return this.run(lease.tenantId, async session => {
      const stats = outcome.operation;
      const admitted = await session.query<{ released: boolean }>(`SELECT release_whiteboard_content_rollout_admission($1,$2,$3,$4,$5,$6,$7,$8) released`, [lease.tenantId, lease.rolloutId, lease.boardId, lease.migrationJobId, lease.owner, lease.token, lease.epoch, lease.attempt]);
      if (!admitted.rows[0]?.released) throw Object.assign(new Error('ROLLOUT_LEASE_LOST'), { code: 'ROLLOUT_LEASE_LOST' });
      const changed = await session.query(`UPDATE whiteboard_content_rollout_items SET state=$5,last_error_code=$6,next_attempt_at=coalesce($7::timestamptz,now()),lease_owner=NULL,lease_token=NULL,lease_until=NULL,bytes_read=bytes_read+$8,bytes_written=bytes_written+$9,cas_resets=cas_resets+$10,orphan_candidates=orphan_candidates+$11,phase_calls=phase_calls+$12,latency_ms=latency_ms+$13,updated_at=now() WHERE org_id=$1 AND rollout_id=$2 AND board_id=$3 AND migration_job_id=$4 AND state='running' AND lease_owner=$14 AND lease_token=$15 AND lease_epoch=$16 AND attempts=$17 AND lease_until>now() RETURNING board_id`, [lease.tenantId, lease.rolloutId, lease.boardId, lease.migrationJobId, outcome.state, outcome.errorCode, outcome.retryAt?.toISOString() ?? null, stats.bytesRead, stats.bytesWritten, stats.casResets, stats.orphanCandidates, outcome.phaseCalls, outcome.latencyMs, lease.owner, lease.token, lease.epoch, lease.attempt]);
      if (!changed.rows[0]) throw Object.assign(new Error('ROLLOUT_LEASE_LOST'), { code: 'ROLLOUT_LEASE_LOST' });
      await session.query(`INSERT INTO whiteboard_content_rollout_events(org_id,rollout_id,board_id,kind,code,detail) VALUES($1,$2,$3,'outcome',$4,$5::jsonb)`, [lease.tenantId, lease.rolloutId, lease.boardId, outcome.errorCode ?? outcome.state.toUpperCase(), JSON.stringify({ state: outcome.state, attempt: lease.attempt, phaseCalls: outcome.phaseCalls, latencyMs: outcome.latencyMs })]);
      await session.query(`UPDATE whiteboard_content_rollouts SET scanned=scanned+CASE WHEN $10=1 THEN 1 ELSE 0 END,migrated=migrated+CASE WHEN $3='succeeded' THEN 1 ELSE 0 END,failed=failed+CASE WHEN $3='failed' THEN 1 ELSE 0 END,retried=retried+CASE WHEN $3='retry' THEN 1 ELSE 0 END,bytes_read=bytes_read+$4,bytes_written=bytes_written+$5,cas_resets=cas_resets+$6,orphan_candidates=orphan_candidates+$7,phase_calls=phase_calls+$8,latency_ms=latency_ms+$9,updated_at=now() WHERE org_id=$1 AND rollout_id=$2`, [lease.tenantId, lease.rolloutId, outcome.state, stats.bytesRead, stats.bytesWritten, stats.casResets, stats.orphanCandidates, outcome.phaseCalls, outcome.latencyMs, lease.attempt]);
      await session.query(`UPDATE whiteboard_content_rollouts r SET status='completed',completed_at=now(),updated_at=now() WHERE r.org_id=$1 AND r.rollout_id=$2 AND r.exhausted AND r.status='running' AND NOT EXISTS (SELECT 1 FROM whiteboard_content_rollout_items i WHERE i.org_id=r.org_id AND i.rollout_id=r.rollout_id AND i.state IN ('queued','retry','running'))`, [lease.tenantId, lease.rolloutId]);
    });
  }

  snapshot(tenantId: string, rolloutId: string): Promise<BoardContentRolloutSnapshot> {
    return this.run(tenantId, async session => {
      const row = await this.loadRow(session, tenantId, rolloutId) as JobRow & MetricsRow;
      const remaining = await session.query<{ count: string }>(`SELECT count(*)::text count FROM whiteboard_content_heads WHERE org_id=$1 AND storage_kind='legacy_pg'`, [tenantId]);
      const errors = await session.query<{ board_id: string; last_error_code: string; attempts: number }>(`SELECT board_id::text,last_error_code,attempts FROM whiteboard_content_rollout_items WHERE org_id=$1 AND rollout_id=$2 AND last_error_code IS NOT NULL ORDER BY updated_at DESC,board_id LIMIT 50`, [tenantId, rolloutId]);
      return { ...job(tenantId, rolloutId, row), metrics: { discovered: nonNegative(row.discovered), scanned: nonNegative(row.scanned), migrated: nonNegative(row.migrated), failed: nonNegative(row.failed), retried: nonNegative(row.retried), bytesRead: nonNegative(row.bytes_read), bytesWritten: nonNegative(row.bytes_written), casResets: nonNegative(row.cas_resets), orphanCandidates: nonNegative(row.orphan_candidates), phaseCalls: nonNegative(row.phase_calls), latencyMs: nonNegative(row.latency_ms), remaining: nonNegative(remaining.rows[0]?.count ?? '0') }, errors: errors.rows.map(error => ({ boardId: error.board_id, errorCode: error.last_error_code, attempt: nonNegative(error.attempts) })) };
    });
  }

  private async loadRow(session: TenantSession, tenantId: string, rolloutId: string): Promise<JobRow & Partial<MetricsRow>> {
    const result = await session.query<JobRow & MetricsRow>(`SELECT status,cursor_board_id,snapshot_upper_board_id,discovery_cycle,cycle_new_items,exhausted,config,discovered,scanned,migrated,failed,retried,bytes_read,bytes_written,cas_resets,orphan_candidates,phase_calls,latency_ms FROM whiteboard_content_rollouts WHERE org_id=$1 AND rollout_id=$2`, [tenantId, rolloutId]);
    if (!result.rows[0]) throw new Error('ROLLOUT_NOT_FOUND');
    return result.rows[0];
  }
}
