import { describe, expect, it } from 'vitest';
import type { BoardContentMigrationReport } from '../../src/application/whiteboard/migrate-board-content';
import type { BoardContentRolloutItemOutcome, BoardContentRolloutJob, BoardContentRolloutLease, BoardContentRolloutLimits, BoardContentRolloutRepository, BoardContentRolloutSnapshot, BoardContentRolloutStatus } from '../../src/application/whiteboard/content-rollout-ports';
import { RunBoardContentRollout } from '../../src/application/whiteboard/run-board-content-rollout';

const rolloutId = '0199aabb-ccdd-7eef-8abc-012345678900';
const board = (value: number) => `0199aabb-ccdd-7eef-8abc-${String(value).padStart(12, '0')}`;
const limits: BoardContentRolloutLimits = { pageSize: 2, maxPagesPerRun: 1, maxBoardsPerRun: 10, globalConcurrency: 2,
  tenantConcurrency: 1, ratePerSecond: 1_000, phaseBudget: 3, retryBudget: 1, baseBackoffMs: 10, maxBackoffMs: 100, leaseMs: 10_000 };

type Item = { boardId: string; jobId: string; state: 'queued' | 'running' | 'retry' | 'succeeded' | 'failed' | 'cancelled'; attempts: number; error: string | null };
type Stored = { job: BoardContentRolloutJob; boards: string[]; items: Map<string, Item>; metrics: BoardContentRolloutSnapshot['metrics'] };

class MemoryRollouts implements BoardContentRolloutRepository {
  readonly mutations: string[] = [];
  readonly outcomes: BoardContentRolloutItemOutcome[] = [];
  private readonly jobs = new Map<string, Stored>();
  constructor(private readonly inventory: Record<string, string[]>) {}
  private key(tenant: string, rollout = rolloutId) { return `${tenant}:${rollout}`; }
  private stored(tenant: string, rollout = rolloutId) { const value = this.jobs.get(this.key(tenant, rollout)); if (!value) throw new Error('missing'); return value; }
  async preview(tenantId: string, cursor: string | null, limit: number) {
    const all = this.inventory[tenantId] ?? [], filtered = all.filter(id => !cursor || id > cursor);
    return { boardIds: filtered.slice(0, limit), remaining: all.length };
  }
  async loadOrCreate(tenantId: string, id: string, config: BoardContentRolloutLimits) {
    this.mutations.push(`create:${tenantId}`);
    const key = this.key(tenantId, id);
    if (!this.jobs.has(key)) this.jobs.set(key, { job: { tenantId, rolloutId: id, status: 'running', cursor: null, exhausted: false, limits: config }, boards: this.inventory[tenantId] ?? [], items: new Map(), metrics: { discovered: 0, scanned: 0, migrated: 0, failed: 0, retried: 0, bytesRead: 0, bytesWritten: 0, casResets: 0, orphanCandidates: 0, phaseCalls: 0, latencyMs: 0, remaining: this.inventory[tenantId]?.length ?? 0 } });
    return structuredClone(this.stored(tenantId, id).job);
  }
  async load(tenantId: string, id: string) { return structuredClone(this.stored(tenantId, id).job); }
  async setControl(tenantId: string, id: string, status: 'running' | 'paused' | 'cancelled') {
    this.mutations.push(`${status}:${tenantId}`); const stored = this.stored(tenantId, id); stored.job.status = status;
    if (status === 'cancelled') for (const item of stored.items.values()) if (!['succeeded', 'failed'].includes(item.state)) item.state = 'cancelled';
    return structuredClone(stored.job);
  }
  async preparePage(tenantId: string, id: string) {
    this.mutations.push(`page:${tenantId}`); const stored = this.stored(tenantId, id), start = stored.job.cursor ? stored.boards.findIndex(value => value === stored.job.cursor) + 1 : 0;
    const page = stored.boards.slice(start, start + stored.job.limits.pageSize);
    page.forEach((boardId, index) => stored.items.set(boardId, stored.items.get(boardId) ?? { boardId, jobId: board(8_000 + start + index), state: 'queued', attempts: 0, error: null }));
    stored.job.cursor = page.at(-1) ?? stored.job.cursor; stored.job.exhausted = page.length < stored.job.limits.pageSize || start + page.length === stored.boards.length;
    stored.metrics.discovered += page.length; return page.length;
  }
  async claim(tenantId: string, id: string, _worker: string, limit: number, _until: Date) {
    const stored = this.stored(tenantId, id), selected = [...stored.items.values()].filter(item => item.state === 'queued' || item.state === 'retry').slice(0, limit);
    return selected.map(item => { item.state = 'running'; item.attempts++; return { tenantId, rolloutId: id, boardId: item.boardId, migrationJobId: item.jobId, attempt: item.attempts }; });
  }
  async release(lease: BoardContentRolloutLease) { const item = this.stored(lease.tenantId, lease.rolloutId).items.get(lease.boardId)!; item.state = 'queued'; item.attempts--; }
  async finish(lease: BoardContentRolloutLease, outcome: BoardContentRolloutItemOutcome) {
    this.outcomes.push(structuredClone(outcome));
    this.mutations.push(`finish:${lease.tenantId}:${lease.boardId}:${outcome.state}`);
    const stored = this.stored(lease.tenantId, lease.rolloutId), item = stored.items.get(lease.boardId)!;
    item.state = outcome.state; item.error = outcome.errorCode; if (lease.attempt === 1) stored.metrics.scanned++;
    if (outcome.state === 'succeeded') stored.metrics.migrated++;
    if (outcome.state === 'failed') stored.metrics.failed++;
    if (outcome.state === 'retry') stored.metrics.retried++;
    const operation = outcome.report?.operation;
    stored.metrics.bytesRead += operation?.bytesRead ?? 0; stored.metrics.bytesWritten += operation?.bytesWritten ?? 0;
    stored.metrics.casResets += operation?.casResets ?? 0; stored.metrics.orphanCandidates += operation?.orphanCandidates ?? 0;
    stored.metrics.phaseCalls += outcome.phaseCalls; stored.metrics.latencyMs += outcome.latencyMs;
    if (outcome.state === 'succeeded') stored.metrics.remaining--;
    if (stored.job.exhausted && [...stored.items.values()].every(value => ['succeeded', 'failed', 'cancelled'].includes(value.state))) stored.job.status = 'completed';
  }
  async snapshot(tenantId: string, id: string) {
    const stored = this.stored(tenantId, id);
    return { ...structuredClone(stored.job), metrics: structuredClone(stored.metrics), errors: [...stored.items.values()].filter(item => item.error).map(item => ({ boardId: item.boardId, errorCode: item.error!, attempt: item.attempts })) };
  }
  state(tenant: string) { return this.stored(tenant); }
}

function report(jobId: string, state: BoardContentMigrationReport['state'], operation = { bytesRead: 5, bytesWritten: 7, casResets: 0, orphanCandidates: 0 }): BoardContentMigrationReport {
  return { jobId, state, sourceEpoch: 1, sourceHeadSeq: 1, candidateManifestDigest: state === 'enrolled' ? null : 'a'.repeat(64), cleanupThroughSeq: 0,
    attempts: 1, errorCode: null, cutoverAt: state === 'cutover' ? new Date(0).toISOString() : null, retirementNotBefore: null, retirementProofDigest: null, operation };
}

describe('bounded Board content fleet rollout', () => {
  it('dry-run previews a stable bounded page with zero PG/blob mutations', async () => {
    const repository = new MemoryRollouts({ alpha: [board(1), board(2), board(3)] }); let calls = 0;
    const result = await new RunBoardContentRollout(repository, () => ({ step: async input => { calls++; return report(input.jobId, 'cutover'); } }))
      .run({ rolloutId, tenantIds: ['alpha'], limits: { ...limits, maxPagesPerRun: 1 }, dryRun: true });
    expect(result).toMatchObject({ dryRun: true, discovered: 2, tenants: [{ tenantId: 'alpha', boardIds: [board(1), board(2)], remaining: 3 }] });
    expect(repository.mutations).toEqual([]); expect(calls).toBe(0);
  });

  it('resumes across page and process boundaries from the durable cursor', async () => {
    const repository = new MemoryRollouts({ alpha: [board(1), board(2), board(3), board(4), board(5)] });
    const factory = () => ({ step: async (input: { jobId: string }) => report(input.jobId, 'cutover') });
    await new RunBoardContentRollout(repository, factory).run({ rolloutId, tenantIds: ['alpha'], limits: { ...limits, maxBoardsPerRun: 1 } });
    expect(repository.state('alpha').job.cursor).toBe(board(2));
    await new RunBoardContentRollout(repository, factory).run({ rolloutId, tenantIds: ['alpha'], limits: { ...limits, maxBoardsPerRun: 4 } });
    expect(repository.state('alpha').job.cursor).toBe(board(4));
    expect(repository.state('alpha').metrics.migrated).toBe(4);
    expect([...repository.state('alpha').items.keys()]).toEqual([board(1), board(2), board(3), board(4)]);
  });

  it('persists pause across restart and resumes without consuming an attempt', async () => {
    const repository = new MemoryRollouts({ alpha: [board(1)] }); let calls = 0;
    await repository.loadOrCreate('alpha', rolloutId, limits); await repository.preparePage('alpha', rolloutId); await repository.setControl('alpha', rolloutId, 'paused');
    const factory = () => ({ step: async (input: { jobId: string }) => { calls++; return report(input.jobId, 'cutover'); } });
    await new RunBoardContentRollout(repository, factory).run({ rolloutId, tenantIds: ['alpha'], limits });
    expect(calls).toBe(0); expect(repository.state('alpha').items.get(board(1))?.attempts).toBe(0);
    await repository.setControl('alpha', rolloutId, 'running');
    await new RunBoardContentRollout(repository, factory).run({ rolloutId, tenantIds: ['alpha'], limits });
    expect(calls).toBe(1); expect(repository.state('alpha').metrics.migrated).toBe(1);
  });

  it('bounds a continuously changing Board by phase and retry budgets with exponential backoff', async () => {
    const repository = new MemoryRollouts({ alpha: [board(1)] }); let calls = 0, now = 0; const sleeps: number[] = [];
    const service = () => new RunBoardContentRollout(repository, () => ({ step: async input => { calls++; return report(input.jobId, 'enrolled', { bytesRead: 3, bytesWritten: 4, casResets: 1, orphanCandidates: 2 }); } }),
      () => new Date(now), async ms => { sleeps.push(ms); });
    const bounded = { ...limits, phaseBudget: 2, retryBudget: 2, maxBoardsPerRun: 1 };
    await service().run({ rolloutId, tenantIds: ['alpha'], limits: bounded });
    expect(repository.state('alpha').items.get(board(1))?.state).toBe('retry');
    now = 10; await service().run({ rolloutId, tenantIds: ['alpha'], limits: bounded });
    now = 30; await service().run({ rolloutId, tenantIds: ['alpha'], limits: bounded });
    expect(calls).toBe(6); expect(repository.state('alpha').items.get(board(1))?.state).toBe('failed');
    expect(repository.outcomes.slice(0, 2).map(outcome => outcome.retryAt?.getTime())).toEqual([10, 30]);
    expect(repository.state('alpha').metrics).toMatchObject({ scanned: 1, retried: 2, failed: 1, casResets: 6, orphanCandidates: 12, phaseCalls: 6 });
    expect(sleeps.every(ms => ms <= limits.maxBackoffMs)).toBe(true);
  });

  it('enforces global and per-tenant concurrency while claiming tenants round-robin', async () => {
    const repository = new MemoryRollouts({ alpha: [board(1), board(2)], beta: [board(3), board(4)] });
    let active = 0, maxActive = 0; const byTenant = new Map<string, number>(), maxByTenant = new Map<string, number>(), order: string[] = [];
    const runner = (tenant: string) => ({ step: async (input: { jobId: string }) => {
      order.push(tenant); active++; maxActive = Math.max(maxActive, active); byTenant.set(tenant, (byTenant.get(tenant) ?? 0) + 1); maxByTenant.set(tenant, Math.max(maxByTenant.get(tenant) ?? 0, byTenant.get(tenant)!));
      await new Promise(resolve => setTimeout(resolve, 2)); active--; byTenant.set(tenant, byTenant.get(tenant)! - 1); return report(input.jobId, 'cutover');
    } });
    await new RunBoardContentRollout(repository, runner).run({ rolloutId, tenantIds: ['alpha', 'beta'], limits: { ...limits, maxBoardsPerRun: 4 } });
    expect(order.slice(0, 2)).toEqual(['alpha', 'beta']); expect(maxActive).toBeLessThanOrEqual(2);
    expect([...maxByTenant.values()].every(value => value <= 1)).toBe(true);
    expect(repository.state('alpha').metrics.migrated + repository.state('beta').metrics.migrated).toBe(4);
  });

  it('aggregates exact auditable bytes, CAS, orphan, phase and error metrics', async () => {
    const repository = new MemoryRollouts({ alpha: [board(1), board(2)] });
    const runner = () => ({ step: async (input: { boardId: string; jobId: string }) => {
      if (input.boardId === board(2)) throw Object.assign(new Error('private detail'), { code: 'INTEGRITY_FAILED' });
      return report(input.jobId, 'cutover', { bytesRead: 11, bytesWritten: 13, casResets: 1, orphanCandidates: 2 });
    } });
    const [snapshot] = await new RunBoardContentRollout(repository, runner).run({ rolloutId, tenantIds: ['alpha'], limits: { ...limits, retryBudget: 0 } }) as BoardContentRolloutSnapshot[];
    expect(snapshot!.metrics).toMatchObject({ discovered: 2, scanned: 2, migrated: 1, failed: 1, bytesRead: 11, bytesWritten: 13, casResets: 1, orphanCandidates: 2, phaseCalls: 1, remaining: 1 });
    expect(snapshot!.errors).toEqual([{ boardId: board(2), errorCode: 'INTEGRITY_FAILED', attempt: 1 }]);
    expect(JSON.stringify(snapshot)).not.toContain('private detail');
  });
});
