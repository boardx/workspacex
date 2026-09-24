import type { BoardContentMigrationReport } from './migrate-board-content';
import type { BoardContentRolloutItemOutcome, BoardContentRolloutJob, BoardContentRolloutLease, BoardContentRolloutLimits, BoardContentRolloutRepository, BoardContentRolloutSnapshot } from './content-rollout-ports';

type MigrationRunner = { step(input: { tenantId: string; boardId: string; jobId: string }): Promise<BoardContentMigrationReport> };
type MigrationRunnerFactory = (tenantId: string) => MigrationRunner;

export interface BoardContentRolloutRunInput {
  rolloutId: string;
  tenantIds: readonly string[];
  limits: BoardContentRolloutLimits;
  dryRun?: boolean;
}

export interface BoardContentRolloutDryRun {
  dryRun: true;
  tenants: ReadonlyArray<{ tenantId: string; boardIds: string[]; remaining: number }>;
  discovered: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function assertBoardContentRolloutLimits(value: BoardContentRolloutLimits): void {
  const integer = (n: number, min: number, max: number) => Number.isSafeInteger(n) && n >= min && n <= max;
  if (!integer(value.pageSize, 1, 1_000) || !integer(value.maxPagesPerRun, 1, 100)
    || !integer(value.maxBoardsPerRun, 1, 10_000) || !integer(value.globalConcurrency, 1, 64)
    || !integer(value.tenantConcurrency, 1, 32) || value.tenantConcurrency > value.globalConcurrency
    || !integer(value.ratePerSecond, 1, 10_000) || !integer(value.phaseBudget, 1, 16)
    || !integer(value.retryBudget, 0, 100) || !integer(value.baseBackoffMs, 1, 86_400_000)
    || !integer(value.maxBackoffMs, value.baseBackoffMs, 604_800_000) || !integer(value.leaseMs, 1_000, 3_600_000)) {
    throw new Error('INVALID_ROLLOUT_LIMITS');
  }
}

function safeCode(error: unknown): string {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : 'MIGRATION_FAILED';
}

function terminal(report: BoardContentMigrationReport): boolean {
  return report.state === 'cutover' || report.state === 'completed';
}

function backoff(attempt: number, limits: BoardContentRolloutLimits): number {
  return Math.min(limits.maxBackoffMs, limits.baseBackoffMs * (2 ** Math.max(0, attempt - 1)));
}

/** A single invocation is deliberately bounded by pages, boards, phases and retries. */
export class RunBoardContentRollout {
  constructor(
    private readonly repository: BoardContentRolloutRepository,
    private readonly runnerForTenant: MigrationRunnerFactory,
    private readonly now: () => Date = () => new Date(),
    private readonly sleep: (ms: number) => Promise<void> = ms => new Promise(resolve => setTimeout(resolve, ms)),
    private readonly workerId = `rollout-${process.pid}`,
  ) {}

  async run(input: BoardContentRolloutRunInput): Promise<BoardContentRolloutDryRun | BoardContentRolloutSnapshot[]> {
    assertBoardContentRolloutLimits(input.limits);
    if (!UUID.test(input.rolloutId) || input.tenantIds.length === 0 || new Set(input.tenantIds).size !== input.tenantIds.length
      || input.tenantIds.some(id => !id || id.length > 200)) throw new Error('INVALID_ROLLOUT_IDENTITY');
    if (input.dryRun) return this.preview(input);

    const jobs = await Promise.all(input.tenantIds.map(tenantId => this.repository.loadOrCreate(tenantId, input.rolloutId, input.limits)));
    for (let page = 0; page < input.limits.maxPagesPerRun; page++) {
      const counts = await Promise.all(jobs.map(job => job.status === 'running' && !job.exhausted
        ? this.repository.preparePage(job.tenantId, job.rolloutId) : Promise.resolve(0)));
      if (counts.every(count => count === 0)) break;
    }

    await this.consumeFairly(jobs, input.limits);
    return Promise.all(input.tenantIds.map(tenantId => this.repository.snapshot(tenantId, input.rolloutId)));
  }

  private async preview(input: BoardContentRolloutRunInput): Promise<BoardContentRolloutDryRun> {
    const tenants = await Promise.all(input.tenantIds.map(async tenantId => {
      const page = await this.repository.preview(tenantId, null, input.limits.pageSize * input.limits.maxPagesPerRun);
      return { tenantId, ...page };
    }));
    return { dryRun: true, tenants, discovered: tenants.reduce((sum, item) => sum + item.boardIds.length, 0) };
  }

  private async consumeFairly(jobs: BoardContentRolloutJob[], limits: BoardContentRolloutLimits): Promise<void> {
    let launched = 0, tenantIndex = 0;
    const active = new Set<Promise<void>>(), activeByTenant = new Map<string, number>();
    const intervalMs = Math.ceil(1_000 / limits.ratePerSecond);
    let lastLaunch = 0;
    while (launched < limits.maxBoardsPerRun) {
      let lease: BoardContentRolloutLease | undefined;
      for (let checked = 0; checked < jobs.length; checked++) {
        const job = jobs[tenantIndex++ % jobs.length]!;
        if ((activeByTenant.get(job.tenantId) ?? 0) >= limits.tenantConcurrency) continue;
        const current = await this.repository.load(job.tenantId, job.rolloutId);
        if (current.status !== 'running') continue;
        lease = (await this.repository.claim(job.tenantId, job.rolloutId, this.workerId, 1,
          new Date(this.now().getTime() + limits.leaseMs)))[0];
        if (lease) break;
      }
      if (!lease) {
        if (active.size === 0) break;
        await Promise.race(active);
        continue;
      }
      while (active.size >= limits.globalConcurrency) await Promise.race(active);
      const wait = Math.max(0, lastLaunch + intervalMs - this.now().getTime());
      if (wait > 0) await this.sleep(wait);
      lastLaunch = this.now().getTime();
      launched++;
      activeByTenant.set(lease.tenantId, (activeByTenant.get(lease.tenantId) ?? 0) + 1);
      const task = this.processLease(lease, limits).finally(() => {
        active.delete(task);
        activeByTenant.set(lease!.tenantId, Math.max(0, (activeByTenant.get(lease!.tenantId) ?? 1) - 1));
      });
      active.add(task);
    }
    await Promise.all(active);
  }

  private async processLease(lease: BoardContentRolloutLease, limits: BoardContentRolloutLimits): Promise<void> {
    const started = this.now().getTime();
    let result: BoardContentMigrationReport | null = null, phaseCalls = 0;
    const operation = { bytesRead: 0, bytesWritten: 0, casResets: 0, orphanCandidates: 0 };
    try {
      for (let phase = 0; phase < limits.phaseBudget; phase++) {
        const job = await this.repository.load(lease.tenantId, lease.rolloutId);
        if (job.status !== 'running') { await this.repository.release(lease); return; }
        result = await this.runnerForTenant(lease.tenantId).step({ tenantId: lease.tenantId, boardId: lease.boardId, jobId: lease.migrationJobId });
        phaseCalls++;
        operation.bytesRead += result.operation.bytesRead; operation.bytesWritten += result.operation.bytesWritten;
        operation.casResets += result.operation.casResets; operation.orphanCandidates += result.operation.orphanCandidates;
        if (terminal(result)) break;
      }
      if (result) result = { ...result, operation };
      const success = result !== null && terminal(result);
      await this.repository.finish(lease, this.outcome(lease, limits, success ? 'succeeded' : 'retry',
        success ? null : 'PHASE_BUDGET_EXHAUSTED', result, phaseCalls, started));
    } catch (error) {
      if (result) result = { ...result, operation };
      await this.repository.finish(lease, this.outcome(lease, limits, 'retry', safeCode(error), result, phaseCalls, started));
    }
  }

  private outcome(lease: BoardContentRolloutLease, limits: BoardContentRolloutLimits, requested: 'succeeded' | 'retry', errorCode: string | null,
    report: BoardContentMigrationReport | null, phaseCalls: number, started: number): BoardContentRolloutItemOutcome {
    const exhausted = requested === 'retry' && lease.attempt >= limits.retryBudget + 1;
    const state = exhausted ? 'failed' : requested;
    return { state, errorCode: exhausted ? (errorCode ?? 'RETRY_BUDGET_EXHAUSTED') : errorCode,
      retryAt: state === 'retry' ? new Date(this.now().getTime() + backoff(lease.attempt, limits)) : null,
      report, phaseCalls, latencyMs: Math.max(0, this.now().getTime() - started) };
  }
}
