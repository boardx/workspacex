import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { BoardContentMigrationReport } from '../src/application/whiteboard/migrate-board-content';
import { MigrateBoardContent, RetireBoardContent } from '../src/application/whiteboard/migrate-board-content';
import { boardContentRetirementPolicy } from '../src/application/whiteboard/content-retirement-policy';
import type { BoardContentRolloutLimits } from '../src/application/whiteboard/content-rollout-ports';
import { RunBoardContentRollout } from '../src/application/whiteboard/run-board-content-rollout';
import { BoardRetirementCredentialSchema, boardRetirementProofKey } from '../src/domain/whiteboard/retirement-credential';
import { createConfiguredBoardStorageRuntime } from '../src/infrastructure/whiteboard/board-storage.providers';
import { PgBoardContentMigrationRepository } from '../src/infrastructure/whiteboard/pg-board-content-migration';
import { PgBoardContentRolloutRepository } from '../src/infrastructure/whiteboard/pg-board-content-rollout';
import { PgDatabase } from '../src/infrastructure/db/pg-database';
import { appConfig } from '../src/infrastructure/db/pg-config';

type MigrationRunner = { step(input: { tenantId: string; boardId: string; jobId: string }): Promise<BoardContentMigrationReport> };
type CliIo = { out(value: string): void; err(value: string): void };

function argument(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1]! : null;
}

function argumentsFor(argv: readonly string[], name: string): string[] {
  return argv.flatMap((value, index) => value === name && index + 1 < argv.length ? [argv[index + 1]!] : []);
}

function positive(argv: readonly string[], name: string, fallback: number): number {
  const parsed = Number(argument(argv, name) ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('INVALID_ARGUMENTS');
  return parsed;
}

function nonNegative(argv: readonly string[], name: string, fallback: number): number {
  const parsed = Number(argument(argv, name) ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error('INVALID_ARGUMENTS');
  return parsed;
}

export function rolloutLimits(argv: readonly string[]): BoardContentRolloutLimits {
  return {
    pageSize: positive(argv, '--page-size', 100), maxPagesPerRun: positive(argv, '--max-pages', 1),
    maxBoardsPerRun: positive(argv, '--max-boards', 100), globalConcurrency: positive(argv, '--global-concurrency', 4),
    tenantConcurrency: positive(argv, '--tenant-concurrency', 2), ratePerSecond: positive(argv, '--rate-per-second', 4),
    phaseBudget: positive(argv, '--phase-budget', 3), retryBudget: nonNegative(argv, '--retry-budget', 5),
    baseBackoffMs: positive(argv, '--base-backoff-ms', 1_000), maxBackoffMs: positive(argv, '--max-backoff-ms', 60_000),
    leaseMs: positive(argv, '--lease-ms', 60_000),
  };
}

export async function runBoardContentMigrationCli(argv: readonly string[], runner: MigrationRunner, io: CliIo,
  terminalStates: ReadonlySet<BoardContentMigrationReport['state']> = new Set(['cutover', 'completed']), maxPhaseCalls = 3): Promise<number> {
  const tenantId = argument(argv, '--tenant-id'), boardId = argument(argv, '--board-id'), jobId = argument(argv, '--job-id');
  if (!tenantId || !boardId || !jobId) {
    io.err(JSON.stringify({ ok: false, errorCode: 'INVALID_ARGUMENTS' }));
    return 2;
  }
  try {
    for (let phase = 0; phase < maxPhaseCalls; phase++) {
      const result: BoardContentMigrationReport = await runner.step({ tenantId, boardId, jobId });
      io.out(JSON.stringify({ ok: true, ...result }));
      if (terminalStates.has(result.state)) return 0;
    }
    io.err(JSON.stringify({ ok: false, errorCode: 'PHASE_BUDGET_EXHAUSTED' }));
    return 1;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
      ? error.code : 'MIGRATION_FAILED';
    io.err(JSON.stringify({ ok: false, errorCode: code }));
    return 1;
  }
}

async function main(): Promise<number> {
  const db = new PgDatabase(appConfig());
  try {
    const argv = process.argv.slice(2);
    const io = { out: (value: string) => process.stdout.write(`${value}\n`), err: (value: string) => process.stderr.write(`${value}\n`) };
    if (argv.includes('--rollout')) {
      const rolloutId = argument(argv, '--rollout-id'), tenantIds = argumentsFor(argv, '--tenant-id');
      if (!rolloutId || tenantIds.length === 0) { io.err(JSON.stringify({ ok: false, errorCode: 'INVALID_ARGUMENTS' })); return 2; }
      const rollouts = new PgBoardContentRolloutRepository(db), control = argument(argv, '--control');
      if (control) {
        if (!['pause', 'resume', 'cancel'].includes(control)) throw new Error('INVALID_ARGUMENTS');
        const status = control === 'resume' ? 'running' : control === 'pause' ? 'paused' : 'cancelled';
        const result = await Promise.all(tenantIds.map(tenantId => rollouts.setControl(tenantId, rolloutId, status)));
        io.out(JSON.stringify({ ok: true, control, jobs: result }));
        return 0;
      }
      const dryRun = argv.includes('--dry-run');
      let configuredMigration: MigrateBoardContent | undefined;
      const service = new RunBoardContentRollout(rollouts, dryRun
        ? () => { throw new Error('DRY_RUN_MUST_NOT_RESOLVE_STORAGE'); }
        : () => configuredMigration ??= (() => {
          const repository = new PgBoardContentMigrationRepository(db), storage = createConfiguredBoardStorageRuntime();
          return new MigrateBoardContent(repository, storage.blobs, storage.codec,
            Number(process.env.WORKSPACEX_BOARD_CONTENT_KEY_VERSION ?? 1), 100, boardContentRetirementPolicy().rollbackWindowMs);
        })());
      const result = await service.run({ rolloutId, tenantIds, limits: rolloutLimits(argv), dryRun });
      io.out(JSON.stringify({ ok: true, result }));
      return 0;
    }
    const repository = new PgBoardContentMigrationRepository(db), storage = createConfiguredBoardStorageRuntime();
    const migration = new MigrateBoardContent(repository, storage.blobs, storage.codec,
      Number(process.env.WORKSPACEX_BOARD_CONTENT_KEY_VERSION ?? 1), 100, boardContentRetirementPolicy().rollbackWindowMs);
    if (!argv.includes('--retire')) return runBoardContentMigrationCli(argv, migration, io);
    const credentialPath = argument(argv, '--credential-file');
    if (!credentialPath) return runBoardContentMigrationCli([], migration, io);
    const bytes = await readFile(credentialPath);
    if (bytes.byteLength > 64 * 1024) throw new Error('RETIREMENT_CREDENTIAL_TOO_LARGE');
    const credential = BoardRetirementCredentialSchema.parse(JSON.parse(bytes.toString('utf8')));
    const retirement = new RetireBoardContent(repository, migration, boardRetirementProofKey());
    return runBoardContentMigrationCli(argv, { step: identity => retirement.step({ ...identity, credential }) }, io, new Set(['completed']));
  } finally { await db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    process.stderr.write(`${JSON.stringify({ ok: false, errorCode: 'MIGRATION_STARTUP_FAILED' })}\n`);
    process.exitCode = 1;
  });
}
