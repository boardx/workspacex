import { pathToFileURL } from 'node:url';
import type { BoardContentMigrationReport } from '../src/application/whiteboard/migrate-board-content';
import { MigrateBoardContent } from '../src/application/whiteboard/migrate-board-content';
import { AesGcmBoardBlobCodec, EnvBoardTenantKeyResolver } from '../src/infrastructure/whiteboard/aes-gcm-board-blob-codec';
import { ConfiguredFsBoardBlobStore } from '../src/infrastructure/whiteboard/board-storage.providers';
import { PgBoardContentMigrationRepository } from '../src/infrastructure/whiteboard/pg-board-content-migration';
import { PgDatabase } from '../src/infrastructure/db/pg-database';
import { appConfig } from '../src/infrastructure/db/pg-config';

type MigrationRunner = Pick<MigrateBoardContent, 'step'>;
type CliIo = { out(value: string): void; err(value: string): void };

function argument(argv: readonly string[], name: string): string | null {
  const index = argv.indexOf(name);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1]! : null;
}

export async function runBoardContentMigrationCli(argv: readonly string[], runner: MigrationRunner, io: CliIo): Promise<number> {
  const tenantId = argument(argv, '--tenant-id'), boardId = argument(argv, '--board-id'), jobId = argument(argv, '--job-id');
  if (!tenantId || !boardId || !jobId) {
    io.err(JSON.stringify({ ok: false, errorCode: 'INVALID_ARGUMENTS' }));
    return 2;
  }
  try {
    for (;;) {
      const result: BoardContentMigrationReport = await runner.step({ tenantId, boardId, jobId });
      io.out(JSON.stringify({ ok: true, ...result }));
      if (result.state === 'completed') return 0;
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
    const runner = new MigrateBoardContent(
      new PgBoardContentMigrationRepository(db),
      new ConfiguredFsBoardBlobStore(),
      new AesGcmBoardBlobCodec(new EnvBoardTenantKeyResolver()),
      Number(process.env.WORKSPACEX_BOARD_CONTENT_KEY_VERSION ?? 1),
    );
    return runBoardContentMigrationCli(process.argv.slice(2), runner, { out: value => process.stdout.write(`${value}\n`), err: value => process.stderr.write(`${value}\n`) });
  } finally { await db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    process.stderr.write(`${JSON.stringify({ ok: false, errorCode: 'MIGRATION_STARTUP_FAILED' })}\n`);
    process.exitCode = 1;
  });
}
