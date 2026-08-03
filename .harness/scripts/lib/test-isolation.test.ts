import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { assertDatabaseCapacity, deriveTestIsolation, ensureTestIsolation } from "./test-isolation";

const ROOT = resolve(import.meta.dirname, "../../..");

describe("test isolation contract (#74)", () => {
  it("reuses every derived resource for the same explicit isolation id", () => {
    const first = deriveTestIsolation({
      isolationId: "reuse-proof",
      worktreePath: "/tmp/worktree-a",
    });
    const second = deriveTestIsolation({
      isolationId: "reuse-proof",
      worktreePath: "/tmp/worktree-a",
    });

    expect(second).toEqual(first);
    expect(first.PGDATABASE).toBe(first.WORKSPACEX_DB);
    expect(first.REDIS_PREFIX).toContain(first.WORKSPACEX_ISOLATION_ID);
  });

  it("isolates separate runs and separate worktrees", () => {
    const runA = deriveTestIsolation({ isolationId: "run-a", worktreePath: "/tmp/worktree-a" });
    const runB = deriveTestIsolation({ isolationId: "run-b", worktreePath: "/tmp/worktree-a" });
    const treeB = deriveTestIsolation({ isolationId: "run-a", worktreePath: "/tmp/worktree-b" });

    for (const key of ["WORKSPACEX_DB", "COMPOSE_PROJECT_NAME", "PGPORT", "REDIS_PORT"] as const) {
      expect(runA[key]).not.toBe(runB[key]);
      expect(runA[key]).not.toBe(treeB[key]);
    }
  });

  it("generates safe PostgreSQL names and non-overlapping valid port bands", () => {
    const env = deriveTestIsolation({
      isolationId: "Feature/74: spaces and punctuation!".repeat(8),
      worktreePath: "/tmp/worktree-a",
    });

    expect(env.WORKSPACEX_DB).toMatch(/^[a-z_][a-z0-9_]{0,62}$/);
    expect(env.WORKSPACEX_DB.length).toBeLessThanOrEqual(63);
    const ports = [env.PGPORT, env.REDIS_PORT, env.MINIO_PORT, env.MINIO_CONSOLE_PORT].map(Number);
    expect(new Set(ports).size).toBe(ports.length);
    for (const port of ports) expect(port).toBeGreaterThanOrEqual(10_000);
    for (const port of ports) expect(port).toBeLessThanOrEqual(65_535);
  });

  it("creates a new run by default but preserves an inherited run", () => {
    const inherited = ensureTestIsolation(
      { WORKSPACEX_ISOLATION_ID: "parent-run" },
      { worktreePath: "/tmp/worktree-a" },
    );
    const freshA = ensureTestIsolation({}, { worktreePath: "/tmp/worktree-a" });
    const freshB = ensureTestIsolation({}, { worktreePath: "/tmp/worktree-a" });

    expect(inherited.WORKSPACEX_ISOLATION_ID).toBe("parent-run");
    expect(freshA.WORKSPACEX_ISOLATION_ID).not.toBe(freshB.WORKSPACEX_ISOLATION_ID);
  });

  it("wires init, pre-push and harness verify through the same helper", () => {
    const init = readFileSync(resolve(ROOT, "init.sh"), "utf8");
    const verify = readFileSync(resolve(ROOT, ".harness/scripts/verify.ts"), "utf8");
    const packageJson = readFileSync(resolve(ROOT, "package.json"), "utf8");

    expect(init).toContain("with-test-isolation");
    expect(verify).toContain("ensureTestIsolation");
    expect(packageJson).toContain("with-test-isolation");
  });

  it("caps Vitest's actual default forks pool via maxWorkers", () => {
    const config = readFileSync(resolve(ROOT, "apps/api/vitest.config.ts"), "utf8");
    expect(config).toMatch(/maxWorkers:\s*4/);
    expect(config).not.toMatch(/threads:\s*\{[\s\S]*maxThreads/);
  });

  it("fails fast when PostgreSQL cannot satisfy the declared connection budget", () => {
    expect(() => assertDatabaseCapacity({
      maxConnections: 100,
      reservedConnections: 3,
      currentConnections: 80,
      requiredConnections: 32,
    })).toThrow(/available=17.*required=32/);

    expect(() => assertDatabaseCapacity({
      maxConnections: 100,
      reservedConnections: 3,
      currentConnections: 5,
      requiredConnections: 32,
    })).not.toThrow();
  });
});
