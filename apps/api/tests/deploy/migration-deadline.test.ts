import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const calls = vi.hoisted(() => ({ query: vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [] as unknown[] })), end: vi.fn(async () => {}) }));
vi.mock("pg", () => ({ default: { Client: class { connect = async () => {}; query = calls.query; end = calls.end; } } }));
import { migrate } from "../../src/infrastructure/db/migrator";
const cfg = { host: "localhost", port: 5432, database: "test", user: "owner", password: "not-logged" };
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it("bounds advisory lock waits before attempting the lock", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wsx-lock-"));
  try {
    await migrate(cfg, { dir, lockTimeoutMs: 250 });
    expect(calls.query.mock.calls[0]).toEqual(["SELECT set_config('lock_timeout', $1, false)", ["250ms"]]);
    expect(calls.query.mock.calls[1]?.[0]).toContain("pg_advisory_lock");
    expect(calls.end).toHaveBeenCalledOnce();
  } finally { rmSync(dir, { recursive: true }); }
});
it("rejects unbounded lock waits", async () => { await expect(migrate(cfg, { lockTimeoutMs: 0 })).rejects.toThrow("timeout"); expect(calls.query).not.toHaveBeenCalled(); });
it("cloud migration cannot create development roles implicitly", async () => {
  vi.stubEnv("WORKSPACEX_DEPLOY_PROFILE", "starter");
  await expect(migrate(cfg)).rejects.toThrow("roles must be provisioned");
  expect(calls.query.mock.calls.some(([sql]) => sql.includes("CREATE TABLE"))).toBe(false);
  expect(calls.end).toHaveBeenCalledOnce();
});
