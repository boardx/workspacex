export type BoardContentRetirementPolicy = { rollbackWindowMs: number };
const DEVELOPMENT_ROLLBACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function boardContentRetirementPolicy(env: NodeJS.ProcessEnv = process.env): BoardContentRetirementPolicy {
  const raw = env.WORKSPACEX_BOARD_ROLLBACK_WINDOW_MS;
  if (env.NODE_ENV === 'production' && raw === undefined) throw new Error('WORKSPACEX_BOARD_ROLLBACK_WINDOW_MS is required in production');
  const rollbackWindowMs = raw === undefined ? DEVELOPMENT_ROLLBACK_WINDOW_MS : Number(raw);
  if (!Number.isSafeInteger(rollbackWindowMs) || rollbackWindowMs < 1) throw new Error('WORKSPACEX_BOARD_ROLLBACK_WINDOW_MS must be a positive safe integer');
  return { rollbackWindowMs };
}
