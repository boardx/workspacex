import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import type { DatabasePort, TenantSession } from '../../src/application/ports/database.port';
import type { SweepBoardBlobs } from '../../src/application/whiteboard/blob-gc';
import { boardBlobGcPolicy } from '../../src/application/whiteboard/blob-gc-policy';
import { PgBoardBlobSweepCoordinator } from '../../src/infrastructure/whiteboard/pg-board-blob-sweep-coordinator';
import { runBoardBlobSweepCli } from '../../scripts/sweep-board-blobs';

const tenantId = 'gc-runtime-tenant', boardId = '0199aabb-ccdd-7eef-8abc-0123456789ab';

function database(query: TenantSession['query']): DatabasePort {
  return { async withTenant(_org, operation) { return operation({ query }); }, async withoutTenant() { throw new Error('not used'); }, async close() {} };
}

describe('Board blob GC production runtime', () => {
  it('reads grace, frequency and batch from one bounded runtime policy', () => {
    expect(boardBlobGcPolicy({})).toEqual({ graceMs: 86_400_000, minIntervalMs: 3_600_000, batchSize: 100 });
    expect(boardBlobGcPolicy({ WORKSPACEX_BOARD_BLOB_GC_GRACE_MS: '2000', WORKSPACEX_BOARD_BLOB_GC_MIN_INTERVAL_MS: '3000', WORKSPACEX_BOARD_BLOB_GC_BATCH_SIZE: '7' }))
      .toEqual({ graceMs: 2000, minIntervalMs: 3000, batchSize: 7 });
    expect(() => boardBlobGcPolicy({ WORKSPACEX_BOARD_BLOB_GC_BATCH_SIZE: '1001' })).toThrow();
  });

  it('holds a per-Board lease, applies cadence/batch/grace and persists sweep counters', async () => {
    const queries: Array<{ sql: string; params?: readonly unknown[] }> = [];
    const db = database(async <R>(sql: string, params?: readonly unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes('pg_try_advisory')) return { rows: [{ acquired: true }] as R[] };
      if (sql.startsWith('SELECT last_finished_at')) return { rows: [] as R[] };
      return { rows: [] as R[] };
    });
    const calls: unknown[] = [];
    const sweep = { async run(input: unknown) { calls.push(input); return { examined: 7, deleted: 3, retained: 2, changed: 2, nextCursor: 'v1:513' }; } } as unknown as SweepBoardBlobs;
    const times = [new Date('2026-01-02T00:00:00.000Z'), new Date('2026-01-02T00:00:00.025Z')];
    const result = await new PgBoardBlobSweepCoordinator(db, sweep, { graceMs: 86_400_000, minIntervalMs: 3_600_000, batchSize: 7 }, () => times.shift()!).run({ tenantId, boardId });
    expect(result).toMatchObject({ status: 'completed', result: { examined: 7, deleted: 3, retained: 2, changed: 2 } });
    expect(calls).toEqual([{ tenantId, boardId, createdBefore: new Date('2026-01-01T00:00:00.000Z'), limit: 7 }]);
    expect(queries[0]?.params).toEqual([`board-blob-gc:${tenantId}:${boardId}`]);
    expect(queries.at(-1)?.sql).toContain('whiteboard_blob_gc_runs');
    expect(queries.at(-1)?.params).toContain(25);
  });

  it('does no object work when lease is busy or the durable frequency gate is active', async () => {
    let swept = 0;
    const sweep = { async run() { swept++; return { examined: 0, deleted: 0, retained: 0, changed: 0 }; } } as unknown as SweepBoardBlobs;
    const busy = database(async <R>() => ({ rows: [{ acquired: false }] as R[] }));
    await expect(new PgBoardBlobSweepCoordinator(busy, sweep, { graceMs: 1, minIntervalMs: 10, batchSize: 1 }).run({ tenantId, boardId }))
      .resolves.toEqual({ status: 'skipped-lease' });
    let query = 0;
    const frequent = database(async <R>() => (++query === 1 ? { rows: [{ acquired: true }] as R[] }
      : { rows: [{ last_finished_at: '2026-01-02T00:00:00.000Z' }] as R[] }));
    await expect(new PgBoardBlobSweepCoordinator(frequent, sweep, { graceMs: 1, minIntervalMs: 60_000, batchSize: 1 }, () => new Date('2026-01-02T00:00:01.000Z')).run({ tenantId, boardId }))
      .resolves.toEqual({ status: 'skipped-frequency' });
    expect(swept).toBe(0);
  });

  it('resumes the persisted bounded cursor after restart and keeps the coordinator metadata-only', async () => {
    let query = 0; const calls: unknown[] = [];
    const db = database(async <R>() => (++query === 1 ? { rows: [{ acquired: true }] as R[] }
      : query === 2 ? { rows: [{ last_finished_at: '2025-12-31T00:00:00.000Z', next_cursor: 'v1:1026' }] as R[] } : { rows: [] as R[] }));
    const sweep = { async run(input: unknown) { calls.push(input); return { examined: 0, deleted: 0, retained: 0, changed: 0 }; } } as unknown as SweepBoardBlobs;
    await new PgBoardBlobSweepCoordinator(db, sweep, { graceMs: 1, minIntervalMs: 1, batchSize: 3 }, () => new Date('2026-01-02T00:00:00.000Z')).run({ tenantId, boardId });
    expect(calls).toEqual([{ tenantId, boardId, createdBefore: new Date('2026-01-01T23:59:59.999Z'), limit: 3, cursor: 'v1:1026' }]);
    const source = await readFile(new URL('../../src/infrastructure/whiteboard/pg-board-blob-sweep-coordinator.ts', import.meta.url), 'utf8');
    expect(source).toContain('this.db.withTenant'); expect(source).not.toContain('.withoutTenant(');
    expect(source).not.toMatch(/\b(snapshot|ciphertext|plaintext)\b/);
  });

  it('CLI accepts only one explicitly scoped Board and emits structured metrics', async () => {
    const out: string[] = [], err: string[] = [], inputs: unknown[] = [];
    const runner = { async run(input: unknown) { inputs.push(input); return { status: 'completed' as const, startedAt: 'a', finishedAt: 'b', result: { examined: 1, deleted: 1, retained: 0, changed: 0 } }; } };
    expect(await runBoardBlobSweepCli(['--tenant-id', tenantId, '--board-id', boardId], runner, { out: value => out.push(value), err: value => err.push(value) })).toBe(0);
    expect(inputs).toEqual([{ tenantId, boardId }]); expect(JSON.parse(out[0]!)).toMatchObject({ ok: true, status: 'completed', result: { deleted: 1 } });
    expect(await runBoardBlobSweepCli(['--tenant-id', tenantId, '--board-id', boardId, '--limit', '9999'], runner, { out: value => out.push(value), err: value => err.push(value) })).toBe(2);
    expect(JSON.parse(err.at(-1)!)).toEqual({ ok: false, errorCode: 'INVALID_ARGUMENTS' });
  });
});
