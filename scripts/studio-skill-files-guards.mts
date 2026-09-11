import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertIsolatedDatabase, deriveTestIsolation } from "../.harness/scripts/lib/test-isolation.ts";
import { migrationConfig, type PgConfig } from "../apps/api/src/infrastructure/db/pg-config.ts";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** No I/O: must run before Docker, mkdir, seeds or any other command. */
export function assertStudioIsolation(env: NodeJS.ProcessEnv = process.env, actual: PgConfig = migrationConfig(), root = repositoryRoot): void {
  assertIsolatedDatabase({ env, resolvedDatabase: actual.database });
  if (!env.WORKSPACEX_ISOLATION_SEED) throw new Error("STUDIO requires the standard isolation seed");
  const derived = deriveTestIsolation({ worktreePath: root, isolationId: env.WORKSPACEX_ISOLATION_SEED });
  for (const key of Object.keys(derived)) if (!env[key]) throw new Error(`STUDIO missing isolation field ${key}`);
  for (const key of ["WORKSPACEX_DB", "PGDATABASE", "COMPOSE_PROJECT_NAME", "WORKSPACEX_ISOLATION_ID", "REDIS_PREFIX"])
    if (env[key] !== derived[key]) throw new Error(`STUDIO non-isolated or inconsistent ${key}`);
  if (env.PGHOST !== derived.PGHOST || actual.host !== env.PGHOST || actual.port !== Number(env.PGPORT))
    throw new Error("STUDIO database connection does not match isolated host/port");
  // Reserved ports may differ from the deterministic seed. Check the actual assigned ports,
  // without recreating or overriding the standard reservation policy.
  const keys = ["PGPORT", "REDIS_PORT", "MINIO_PORT", "MINIO_CONSOLE_PORT", "WORKSPACEX_API_PORT", "WORKSPACEX_WEB_PORT", "SKILL_SANDBOX_PORT"];
  const ports = keys.map(key => Number(env[key]));
  if (ports.some(port => !Number.isInteger(port) || port < 1024 || port > 65535) || new Set(ports).size !== ports.length)
    throw new Error("STUDIO invalid or overlapping reserved ports");
}

/** Test seam proves rejected isolation cannot reach the command callback. */
export async function withStudioIsolation<T>(action: () => Promise<T>, env = process.env, actual = migrationConfig(), root = repositoryRoot): Promise<T> {
  assertStudioIsolation(env, actual, root);
  return action();
}

type RecordValue = Record<string, unknown>;
function object(value: unknown): RecordValue {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid Playwright JSON report");
  return value as RecordValue;
}
export function assertStudioReport(value: unknown): void {
  const report = object(value), stats = object(report.stats);
  if (stats.expected !== 1 || stats.unexpected !== 0 || stats.skipped !== 0 || stats.flaky !== 0 || !Array.isArray(report.errors) || report.errors.length)
    throw new Error("STUDIO requires expected=1, failed=0, skipped=0, flaky=0");
  const tests: RecordValue[] = [];
  function suites(value: unknown): void {
    if (!Array.isArray(value)) throw new Error("Invalid Playwright suites");
    for (const item of value) {
      const suite = object(item);
      if (!Array.isArray(suite.specs)) throw new Error("Invalid Playwright specs");
      for (const specValue of suite.specs) {
        const spec = object(specValue);
        if (!Array.isArray(spec.tests)) throw new Error("Invalid Playwright tests");
        tests.push(...spec.tests.map(object));
      }
      if (suite.suites !== undefined) suites(suite.suites);
    }
  }
  suites(report.suites);
  if (tests.length !== 1) throw new Error("STUDIO must execute exactly one test");
  const test = tests[0]!;
  if (test.expectedStatus !== "passed" || test.status !== "expected" || !Array.isArray(test.results) || test.results.length !== 1 || object(test.results[0]).status !== "passed")
    throw new Error("STUDIO requires passed=1, failed=0 and no retries");
}
