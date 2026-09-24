export interface BoardBlobGcPolicy {
  graceMs: number;
  minIntervalMs: number;
  batchSize: number;
}

const DEFAULT_GRACE_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_MIN_INTERVAL_MS = 60 * 60 * 1_000;
const DEFAULT_BATCH_SIZE = 100;

function integer(env: NodeJS.ProcessEnv, name: string, fallback: number, maximum: number): number {
  const raw = env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name}`);
  return value;
}

/** Single runtime source for sweep safety window, frequency and bounded work. */
export function boardBlobGcPolicy(env: NodeJS.ProcessEnv = process.env): BoardBlobGcPolicy {
  return {
    graceMs: integer(env, 'WORKSPACEX_BOARD_BLOB_GC_GRACE_MS', DEFAULT_GRACE_MS, 365 * 24 * 60 * 60 * 1_000),
    minIntervalMs: integer(env, 'WORKSPACEX_BOARD_BLOB_GC_MIN_INTERVAL_MS', DEFAULT_MIN_INTERVAL_MS, 30 * 24 * 60 * 60 * 1_000),
    batchSize: integer(env, 'WORKSPACEX_BOARD_BLOB_GC_BATCH_SIZE', DEFAULT_BATCH_SIZE, 1_000),
  };
}
