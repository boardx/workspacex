import { createHash, randomUUID } from "node:crypto";

export interface IsolationOptions {
  isolationId?: string;
  worktreePath?: string;
}

export interface TestIsolationEnv extends Record<string, string> {
  WORKSPACEX_ISOLATION_SEED: string;
  WORKSPACEX_ISOLATION_ID: string;
  WORKSPACEX_DB: string;
  PGDATABASE: string;
  PGHOST: string;
  PGPORT: string;
  REDIS_PORT: string;
  REDIS_PREFIX: string;
  MINIO_PORT: string;
  MINIO_CONSOLE_PORT: string;
  WORKSPACEX_API_PORT: string;
  WORKSPACEX_WEB_PORT: string;
  COMPOSE_PROJECT_NAME: string;
  WORKSPACEX_DB_CONNECTION_BUDGET: string;
}

const ISOLATION_ENV_KEYS = [
  "WORKSPACEX_ISOLATION_SEED",
  "WORKSPACEX_ISOLATION_ID",
  "WORKSPACEX_DB",
  "PGDATABASE",
  "PGHOST",
  "PGPORT",
  "REDIS_PORT",
  "REDIS_PREFIX",
  "MINIO_PORT",
  "MINIO_CONSOLE_PORT",
  "WORKSPACEX_API_PORT",
  "WORKSPACEX_WEB_PORT",
  "COMPOSE_PROJECT_NAME",
  "WORKSPACEX_DB_CONNECTION_BUDGET",
] as const;

function inheritedIsolation(env: NodeJS.ProcessEnv): TestIsolationEnv | null {
  if (!ISOLATION_ENV_KEYS.every((key) => typeof env[key] === "string" && env[key]!.length > 0)) return null;
  return Object.fromEntries(ISOLATION_ENV_KEYS.map((key) => [key, env[key]!])) as TestIsolationEnv;
}

export interface DatabaseCapacity {
  maxConnections: number;
  reservedConnections: number;
  currentConnections: number;
  requiredConnections: number;
}

export function assertDatabaseCapacity(capacity: DatabaseCapacity): void {
  const available = capacity.maxConnections - capacity.reservedConnections - capacity.currentConnections;
  if (available < capacity.requiredConnections) {
    throw new Error(
      "PostgreSQL connection capacity insufficient: " +
      `max=${capacity.maxConnections} reserved=${capacity.reservedConnections} ` +
      `current=${capacity.currentConnections} available=${available} ` +
      `required=${capacity.requiredConnections}. Refusing to run; tests were not retried.`,
    );
  }
}

function safeId(value: string, hash: string): string {
  const cleaned = value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${(cleaned || "run").slice(0, 27)}-${hash.slice(0, 12)}`;
}

function digest(worktreePath: string, isolationId: string): string {
  return createHash("sha256").update(`${worktreePath}\0${isolationId}`).digest("hex");
}

function portFrom(hash: string, offset: number): string {
  return String(offset + (Number.parseInt(hash.slice(0, 8), 16) % 5_000));
}

export function deriveTestIsolation(options: Required<IsolationOptions>): TestIsolationEnv {
  // Hash the caller's original id before making it safe for resource names. Otherwise
  // distinct ids such as `feature/74` and `feature-74` collapse onto the same resources.
  const hash = digest(options.worktreePath, options.isolationId);
  const isolationId = safeId(options.isolationId, hash);
  const resource = hash.slice(0, 20);
  const db = `wsx_${resource}`;

  return {
    WORKSPACEX_ISOLATION_SEED: options.isolationId,
    WORKSPACEX_ISOLATION_ID: isolationId,
    WORKSPACEX_DB: db,
    PGDATABASE: db,
    PGHOST: "127.0.0.1",
    PGPORT: portFrom(hash, 20_000),
    REDIS_PORT: portFrom(hash, 25_000),
    REDIS_PREFIX: `wsx:${isolationId}:`,
    MINIO_PORT: portFrom(hash, 30_000),
    MINIO_CONSOLE_PORT: portFrom(hash, 35_000),
    WORKSPACEX_API_PORT: portFrom(hash, 40_000),
    WORKSPACEX_WEB_PORT: portFrom(hash, 45_000),
    COMPOSE_PROJECT_NAME: `wsx-${resource}`,
    // Four Vitest workers, each allowed a five-connection application pool, plus
    // migrations/fixtures/monitoring headroom. The global setup enforces this budget.
    WORKSPACEX_DB_CONNECTION_BUDGET: "32",
  };
}

export function ensureTestIsolation(
  inherited: NodeJS.ProcessEnv,
  options: Pick<IsolationOptions, "worktreePath"> = {},
): TestIsolationEnv {
  const existing = inheritedIsolation(inherited);
  if (existing) return existing;
  const isolationId = inherited.WORKSPACEX_ISOLATION_SEED ?? inherited.WORKSPACEX_ISOLATION_ID ??
    `run-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  return deriveTestIsolation({
    isolationId,
    worktreePath: options.worktreePath ?? process.cwd(),
  });
}
