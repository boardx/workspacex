import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import type { BoardContentMigrationReport } from '../src/application/whiteboard/migrate-board-content';
import { MigrateBoardContent, RetireBoardContent } from '../src/application/whiteboard/migrate-board-content';
import { boardContentRetirementPolicy } from '../src/application/whiteboard/content-retirement-policy';
import { BoardRetirementCredentialSchema, boardRetirementProofKey } from '../src/domain/whiteboard/retirement-credential';
import { AesGcmBoardBlobCodec, EnvBoardTenantKeyResolver } from '../src/infrastructure/whiteboard/aes-gcm-board-blob-codec';
import { ConfiguredFsBoardBlobStore } from '../src/infrastructure/whiteboard/board-storage.providers';
import { PgBoardContentMigrationRepository } from '../src/infrastructure/whiteboard/pg-board-content-migration';
import { PgDatabase } from '../src/infrastructure/db/pg-database';
import { appConfig } from '../src/infrastructure/db/pg-config';

type MigrationRunner = { step(input: { tenantId: string; boardId: string; jobId: string }): Promise<BoardContentMigrationReport> };
type CliIo = { out(value: string): void; err(value: string): void };

function argument(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1]! : null;
}

export async function runBoardContentMigrationCli(argv: readonly string[], runner: MigrationRunner, io: CliIo,
  terminalStates: ReadonlySet<BoardContentMigrationReport['state']> = new Set(['cutover', 'completed'])): Promise<number> {
  const tenantId = argument(argv, '--tenant-id'), boardId = argument(argv, '--board-id'), jobId = argument(argv, '--job-id');
  if (!tenantId || !boardId || !jobId) {
    io.err(JSON.stringify({ ok: false, errorCode: 'INVALID_ARGUMENTS' }));
    return 2;
  }
  try {
    for (;;) {
      const result: BoardContentMigrationReport = await runner.step({ tenantId, boardId, jobId });
      io.out(JSON.stringify({ ok: true, ...result }));
      if (terminalStates.has(result.state)) return 0;
    }
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
    const argv = process.argv.slice(2), repository = new PgBoardContentMigrationRepository(db), blobs = new ConfiguredFsBoardBlobStore();
    const migration = new MigrateBoardContent(repository, blobs, new AesGcmBoardBlobCodec(new EnvBoardTenantKeyResolver()),
      Number(process.env.WORKSPACEX_BOARD_CONTENT_KEY_VERSION ?? 1), 100, boardContentRetirementPolicy().rollbackWindowMs);
    const io = { out: (value: string) => process.stdout.write(`${value}\n`), err: (value: string) => process.stderr.write(`${value}\n`) };
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
