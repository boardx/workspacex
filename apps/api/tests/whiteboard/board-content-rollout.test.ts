import { describe, expect, it } from 'vitest';
import type { BoardContentMigrationReport } from '../../src/application/whiteboard/migrate-board-content';
import type { BoardContentRolloutItemOutcome, BoardContentRolloutJob, BoardContentRolloutLease, BoardContentRolloutLimits, BoardContentRolloutRepository, BoardContentRolloutSnapshot, BoardContentRolloutStatus } from '../../src/application/whiteboard/content-rollout-ports';
import { RunBoardContentRollout } from '../../src/application/whiteboard/run-board-content-rollout';

const rolloutId = '0199aabb-ccdd-7eef-8abc-012345678900';
const board = (value: number) => `0199aabb-ccdd-7eef-8abc-${String(value).padStart(12, '0')}`;
const limits: BoardContentRolloutLimits = { pageSize: 2, maxPagesPerRun: 1, maxBoardsPerRun: 10, globalConcurrency: 2,
  tenantConcurrency: 1, ratePerSecond: 1_000, phaseBudget: 3, retryBudget: 1, baseBackoffMs: 10, maxBackoffMs: 100, leaseMs: 10_000 };

type Item = { boardId: string; jobId: string; state: 'queued' | 'running' | 'retry' | 'succeeded' | 'failed' | 'cancelled'; attempts: number; error: string | null;
  owner: string | null; token: string | null; epoch: number; leaseUntil: number };
type Stored = { job: BoardContentRolloutJob; boards: string[]; items: Map<string, Item>; cycleNew: number; metrics: BoardContentRolloutSnapshot['metrics'] };

class MemoryRollouts implements BoardContentRolloutRepository {
  readonly mutations: string[] = [];
  readonly outcomes: BoardContentRolloutItemOutcome[] = [];
  private readonly jobs = new Map<string, Stored>();
  private readonly globalLeases = new Map<string, number>();
  private token = 0;
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
    if (!this.jobs.has(key)) this.jobs.set(key, { job: { tenantId, rolloutId: id, status: 'running', cursor: null,
      snapshotUpperBoardId: [...(this.inventory[tenantId] ?? [])].sort().at(-1) ?? null, discoveryCycle: 1, exhausted: false, limits: config },
    boards: this.inventory[tenantId] ?? [], items: new Map(), cycleNew: 0, metrics: { discovered: 0, scanned: 0, migrated: 0, failed: 0, retried: 0, bytesRead: 0, bytesWritten: 0, casResets: 0, orphanCandidates: 0, phaseCalls: 0, latencyMs: 0, remaining: this.inventory[tenantId]?.length ?? 0 } });
    return structuredClone(this.stored(tenantId, id).job);
  }
  async load(tenantId: string, id: string) { return structuredClone(this.stored(tenantId, id).job); }
  async setControl(tenantId: string, id: string, status: 'running' | 'paused' | 'cancelled') {
    this.mutations.push(`${status}:${tenantId}`); const stored = this.stored(tenantId, id); stored.job.status = status;
    if (status === 'paused') for (const item of stored.items.values()) if (item.state === 'running') {
      if (item.token) this.globalLeases.delete(item.token); item.state = 'queued'; item.attempts = Math.max(0, item.attempts - 1); item.owner = null; item.token = null;
    }
    if (status === 'cancelled') for (const item of stored.items.values()) if (!['succeeded', 'failed'].includes(item.state)) {
      if (item.token) this.globalLeases.delete(item.token); item.state = 'cancelled'; item.owner = null; item.token = null;
    }
    return structuredClone(stored.job);
  }
  async preparePage(tenantId: string, id: string) {
    this.mutations.push(`page:${tenantId}`); const stored = this.stored(tenantId, id);
    const eligible = stored.boards.filter(value => (!stored.job.cursor || value > stored.job.cursor) && (!stored.job.snapshotUpperBoardId || value <= stored.job.snapshotUpperBoardId)).sort();
    const page = eligible.slice(0, stored.job.limits.pageSize); let inserted = 0;
    page.forEach((boardId, index) => { if (!stored.items.has(boardId)) { stored.items.set(boardId, { boardId, jobId: board(8_000 + stored.items.size + index), state: 'queued', attempts: 0, error: null, owner: null, token: null, epoch: 0, leaseUntil: 0 }); inserted++; } });
    stored.job.cursor = page.at(-1) ?? stored.job.cursor; stored.cycleNew += inserted; stored.metrics.discovered += inserted;
    if (page.length < stored.job.limits.pageSize) {
      if (stored.cycleNew === 0) stored.job.exhausted = true;
      else { stored.job.cursor = null; stored.job.snapshotUpperBoardId = [...stored.boards].sort().at(-1) ?? null; stored.job.discoveryCycle++; stored.cycleNew = 0; }
    }
    return inserted;
  }
  async claim(tenantId: string, id: string, worker: string, limit: number, until: Date) {
    const stored = this.stored(tenantId, id), selected = [...stored.items.values()].filter(item => item.state === 'queued' || item.state === 'retry').slice(0, limit);
    const available = Math.max(0, stored.job.limits.globalConcurrency - this.globalLeases.size);
    return selected.slice(0, available).map(item => { item.state = 'running'; item.attempts++; item.owner = worker; item.token = `token-${++this.token}`; item.epoch++; item.leaseUntil = until.getTime(); this.globalLeases.set(item.token, item.leaseUntil);
      return { tenantId, rolloutId: id, boardId: item.boardId, migrationJobId: item.jobId, attempt: item.attempts, owner: worker, token: item.token, epoch: item.epoch }; });
  }
  async release(lease: BoardContentRolloutLease) { const item = this.stored(lease.tenantId, lease.rolloutId).items.get(lease.boardId)!;
    if (item.state !== 'running' || item.owner !== lease.owner || item.token !== lease.token || item.epoch !== lease.epoch || item.attempts !== lease.attempt) return;
    this.globalLeases.delete(lease.token); item.state = 'queued'; item.attempts--; item.owner = null; item.token = null;
  }
  async finish(lease: BoardContentRolloutLease, outcome: BoardContentRolloutItemOutcome) {
    const stored = this.stored(lease.tenantId, lease.rolloutId), item = stored.items.get(lease.boardId)!;
    if (item.state !== 'running' || item.owner !== lease.owner || item.token !== lease.token || item.epoch !== lease.epoch || item.attempts !== lease.attempt) throw Object.assign(new Error('ROLLOUT_LEASE_LOST'), { code: 'ROLLOUT_LEASE_LOST' });
    this.outcomes.push(structuredClone(outcome));
    this.mutations.push(`finish:${lease.tenantId}:${lease.boardId}:${outcome.state}`);
    this.globalLeases.delete(lease.token); item.owner = null; item.token = null;
    item.state = outcome.state; item.error = outcome.errorCode; if (lease.attempt === 1) stored.metrics.scanned++;
    if (outcome.state === 'succeeded') stored.metrics.migrated++;
    if (outcome.state === 'failed') stored.metrics.failed++;
    if (outcome.state === 'retry') stored.metrics.retried++;
    const operation = outcome.operation;
    stored.metrics.bytesRead += operation.bytesRead; stored.metrics.bytesWritten += operation.bytesWritten;
    stored.metrics.casResets += operation.casResets; stored.metrics.orphanCandidates += operation.orphanCandidates;
    stored.metrics.phaseCalls += outcome.phaseCalls; stored.metrics.latencyMs += outcome.latencyMs;
    if (outcome.state === 'succeeded') stored.metrics.remaining--;
    if (stored.job.exhausted && [...stored.items.values()].every(value => ['succeeded', 'failed', 'cancelled'].includes(value.state))) stored.job.status = 'completed';
  }
  async snapshot(tenantId: string, id: string) {
    const stored = this.stored(tenantId, id);
    return { ...structuredClone(stored.job), metrics: structuredClone(stored.metrics), errors: [...stored.items.values()].filter(item => item.error).map(item => ({ boardId: item.boardId, errorCode: item.error!, attempt: item.attempts })) };
  }
  state(tenant: string) { return this.stored(tenant); }
  expire(lease: BoardContentRolloutLease) { const item = this.stored(lease.tenantId, lease.rolloutId).items.get(lease.boardId)!;
    const stored = this.stored(lease.tenantId, lease.rolloutId); this.globalLeases.delete(lease.token); item.state = 'retry'; item.owner = null; item.token = null; item.error = 'LEASE_EXPIRED';
    stored.metrics.retried++; if (item.attempts === 1) stored.metrics.scanned++;
  }
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

  it('rescans a fixed UUID snapshot cycle so a newly visible lower UUID is not lost', async () => {
    const inventory = { alpha: [board(200)] }, repository = new MemoryRollouts(inventory);
    await repository.loadOrCreate('alpha', rolloutId, { ...limits, pageSize: 1 });
    expect(await repository.preparePage('alpha', rolloutId)).toBe(1);
    inventory.alpha.push(board(100));
    expect(await repository.preparePage('alpha', rolloutId)).toBe(0); // closes cycle 1 and snapshots cycle 2
    expect(await repository.preparePage('alpha', rolloutId)).toBe(1);
    expect([...repository.state('alpha').items.keys()].sort()).toEqual([board(100), board(200)]);
    expect(repository.state('alpha').job.discoveryCycle).toBe(2);
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

  it('reclaims an active paused lease without spending an attempt or losing first-scan metrics', async () => {
    const repository = new MemoryRollouts({ alpha: [board(1)] });
    await repository.loadOrCreate('alpha', rolloutId, limits); await repository.preparePage('alpha', rolloutId);
    const [beforePause] = await repository.claim('alpha', rolloutId, 'worker-a', 1, new Date(Date.now() + 1_000));
    expect(beforePause).toMatchObject({ attempt: 1 });
    await repository.setControl('alpha', rolloutId, 'paused');
    expect(repository.state('alpha').items.get(board(1))).toMatchObject({ state: 'queued', attempts: 0 });
    await repository.setControl('alpha', rolloutId, 'running');
    const [afterResume] = await repository.claim('alpha', rolloutId, 'worker-b', 1, new Date(Date.now() + 1_000));
    expect(afterResume).toMatchObject({ attempt: 1, epoch: 2 });
    await repository.finish(afterResume!, { state: 'succeeded', errorCode: null, retryAt: null, report: report(afterResume!.migrationJobId, 'cutover'),
      operation: { bytesRead: 5, bytesWritten: 7, casResets: 0, orphanCandidates: 0 }, phaseCalls: 1, latencyMs: 1 });
    expect(repository.state('alpha').metrics).toMatchObject({ scanned: 1, migrated: 1, retried: 0 });
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

  it('fences stale lease generations and treats mid-phase cancellation as a stable stop', async () => {
    const repository = new MemoryRollouts({ alpha: [board(1)] });
    await repository.loadOrCreate('alpha', rolloutId, limits); await repository.preparePage('alpha', rolloutId);
    const [first] = await repository.claim('alpha', rolloutId, 'worker-a', 1, new Date(Date.now() + 1_000));
    repository.expire(first!);
    const [second] = await repository.claim('alpha', rolloutId, 'worker-b', 1, new Date(Date.now() + 1_000));
    const applied: BoardContentRolloutItemOutcome = { state: 'succeeded', errorCode: null, retryAt: null,
      report: report(second!.migrationJobId, 'cutover'), operation: { bytesRead: 5, bytesWritten: 7, casResets: 0, orphanCandidates: 0 }, phaseCalls: 1, latencyMs: 1 };
    await expect(repository.finish(first!, applied)).rejects.toMatchObject({ code: 'ROLLOUT_LEASE_LOST' });
    await repository.release(first!);
    expect(repository.state('alpha').items.get(board(1))).toMatchObject({ state: 'running', owner: 'worker-b', epoch: 2 });
    await repository.finish(second!, applied);
    expect(repository.state('alpha').metrics).toMatchObject({ scanned: 1, migrated: 1, retried: 1 });

    const cancelled = new MemoryRollouts({ alpha: [board(2)] }); let release!: () => void;
    const started = new Promise<void>(resolve => { release = resolve; }); let continuePhase!: () => void;
    const gate = new Promise<void>(resolve => { continuePhase = resolve; });
    const running = new RunBoardContentRollout(cancelled, () => ({ step: async input => { release(); await gate; return report(input.jobId, 'cutover'); } }))
      .run({ rolloutId, tenantIds: ['alpha'], limits: { ...limits, maxPagesPerRun: 2 } });
    await started; await cancelled.setControl('alpha', rolloutId, 'cancelled'); continuePhase();
    await expect(running).resolves.toMatchObject([{ status: 'cancelled' }]);
    expect(cancelled.outcomes).toHaveLength(0);
  });

  it('shares the global concurrency lease across independent runner instances', async () => {
    const repository = new MemoryRollouts({ alpha: [board(1)], beta: [board(2)] }); let active = 0, maxActive = 0;
    const runner = () => ({ step: async (input: { jobId: string }) => { active++; maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 5)); active--; return report(input.jobId, 'cutover'); } });
    const bounded = { ...limits, globalConcurrency: 1, tenantConcurrency: 1, maxPagesPerRun: 2 };
    await Promise.all([
      new RunBoardContentRollout(repository, runner, undefined, undefined, 'process-a').run({ rolloutId, tenantIds: ['alpha'], limits: bounded }),
      new RunBoardContentRollout(repository, runner, undefined, undefined, 'process-b').run({ rolloutId, tenantIds: ['beta'], limits: bounded }),
    ]);
    await new RunBoardContentRollout(repository, runner, undefined, undefined, 'process-b-retry').run({ rolloutId, tenantIds: ['beta'], limits: bounded });
    expect(maxActive).toBe(1);
    expect(repository.state('alpha').metrics.migrated + repository.state('beta').metrics.migrated).toBe(2);
  });

  it('aggregates exact auditable bytes, CAS, orphan, phase and error metrics', async () => {
    const repository = new MemoryRollouts({ alpha: [board(1), board(2)] });
    const runner = () => ({ step: async (input: { boardId: string; jobId: string }) => {
      if (input.boardId === board(2)) throw Object.assign(new Error('private detail'), { code: 'INTEGRITY_FAILED' });
      return report(input.jobId, 'cutover', { bytesRead: 11, bytesWritten: 13, casResets: 1, orphanCandidates: 2 });
    } });
    const [snapshot] = await new RunBoardContentRollout(repository, runner).run({ rolloutId, tenantIds: ['alpha'], limits: { ...limits, retryBudget: 0 } }) as BoardContentRolloutSnapshot[];
    expect(snapshot!.metrics).toMatchObject({ discovered: 2, scanned: 2, migrated: 1, failed: 1, bytesRead: 11, bytesWritten: 13, casResets: 1, orphanCandidates: 2, phaseCalls: 2, remaining: 1 });
    expect(snapshot!.errors).toEqual([{ boardId: board(2), errorCode: 'INTEGRITY_FAILED', attempt: 1 }]);
    expect(JSON.stringify(snapshot)).not.toContain('private detail');
  });
});
