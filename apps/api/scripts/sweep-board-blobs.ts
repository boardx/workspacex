import { pathToFileURL } from 'node:url';
import { SweepBoardBlobs } from '../src/application/whiteboard/blob-gc';
import { boardBlobGcPolicy } from '../src/application/whiteboard/blob-gc-policy';
import { PgDatabase } from '../src/infrastructure/db/pg-database';
import { appConfig } from '../src/infrastructure/db/pg-config';
import { createBoardStorageSelection } from '../src/infrastructure/whiteboard/board-storage-selection';
import { EnvHostedBoardClientFactory, versionedBoardKeySourceFromEnv } from '../src/infrastructure/whiteboard/hosted-board-provider-factory';
import { PgBoardBlobReferenceGuard } from '../src/infrastructure/whiteboard/pg-board-blob-reference-guard';
import { PgBoardBlobSweepCoordinator, type BoardBlobSweepRun } from '../src/infrastructure/whiteboard/pg-board-blob-sweep-coordinator';

type Runner = { run(input: { tenantId: string; boardId: string; cursor?: string }): Promise<BoardBlobSweepRun> };
type CliIo = { out(value: string): void; err(value: string): void };

function argumentsOf(argv: readonly string[]): { tenantId: string; boardId: string; cursor?: string } | null {
  const values = new Map<string, string>(), allowed = new Set(['--tenant-id','--board-id','--cursor']);
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!name || !allowed.has(name) || !value || value.startsWith('--') || values.has(name)) return null;
    values.set(name, value);
  }
  const tenantId = values.get('--tenant-id'), boardId = values.get('--board-id'), cursor = values.get('--cursor');
  return tenantId && boardId ? { tenantId, boardId, ...(cursor ? { cursor } : {}) } : null;
}

export async function runBoardBlobSweepCli(argv: readonly string[], runner: Runner, io: CliIo): Promise<number> {
  const input = argumentsOf(argv);
  if (!input) {
    io.err(JSON.stringify({ ok: false, errorCode: 'INVALID_ARGUMENTS' })); return 2;
  }
  try {
    const run = await runner.run(input);
    io.out(JSON.stringify({ ok: true, ...run }));
    return 0;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && /^[A-Z0-9_]{1,64}$/.test(error.code)
      ? error.code : 'BOARD_BLOB_GC_FAILED';
    io.err(JSON.stringify({ ok: false, errorCode: code })); return 1;
  }
}

async function main(): Promise<number> {
  const db = new PgDatabase(appConfig());
  try {
    const storage = await createBoardStorageSelection(process.env, {
      hostedClients: new EnvHostedBoardClientFactory(process.env),
      versionedKeys: versionedBoardKeySourceFromEnv(process.env),
    });
    const sweep = new SweepBoardBlobs(storage.store, storage.purgeStore, storage.codec, new PgBoardBlobReferenceGuard(db));
    const runner = new PgBoardBlobSweepCoordinator(db, sweep, boardBlobGcPolicy());
    return runBoardBlobSweepCli(process.argv.slice(2), runner, {
      out: value => process.stdout.write(`${value}\n`), err: value => process.stderr.write(`${value}\n`),
    });
  } finally { await db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    process.stderr.write(`${JSON.stringify({ ok: false, errorCode: 'BOARD_BLOB_GC_STARTUP_FAILED' })}\n`); process.exitCode = 1;
  });
}
