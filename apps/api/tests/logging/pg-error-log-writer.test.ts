/**
 * `PgErrorLogWriter` -- write path + opportunistic retention cadence, against a fake
 * `DatabasePort` (no real Postgres -- the thing under test is the writer's own logic, the
 * same call-count/tick pattern the other F20 login suites use for logic that doesn't need a
 * real integration boundary; see `login-session-store-unavailable.test.ts`'s file header for
 * the fuller version of this argument).
 */
import { describe, expect, it } from "vitest";
import { PgErrorLogWriter, sweepExpiredErrorLogs } from "../../src/infrastructure/logging/pg-error-log-writer";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";

function fakeDb(): { db: DatabasePort; queries: { sql: string; params: readonly unknown[] }[] } {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  const session: TenantSession = {
    async query(sql, params = []) {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
  const db: DatabasePort = {
    withTenant: async (_orgId, fn) => fn(session),
    withoutTenant: async (fn) => fn(session),
    close: async () => undefined,
  };
  return { db, queries };
}

describe("PgErrorLogWriter", () => {
  it("record() inserts trace_id/msg/detail via withoutTenant (no tenant context)", async () => {
    const { db, queries } = fakeDb();
    const writer = new PgErrorLogWriter(db, db);

    await writer.record({ traceId: "t-1", msg: "unhandled exception", detail: { name: "Error", message: "boom" } });

    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain("INSERT INTO error_logs");
    expect(queries[0]!.params).toEqual(["t-1", "unhandled exception", JSON.stringify({ name: "Error", message: "boom" })]);
  });

  it("record() redacts before INSERT -- a secret in detail never reaches the query params (review finding #1)", async () => {
    const { db, queries } = fakeDb();
    const writer = new PgErrorLogWriter(db, db);

    await writer.record({
      traceId: "t-secret",
      msg: "unhandled exception",
      detail: { name: "Error", message: "connect failed: postgres://app_rw:s3cr3t-pw@10.0.0.5:5432/workspacex" },
    });

    const insertedDetail = String(queries[0]!.params[2]);
    expect(insertedDetail).not.toContain("s3cr3t-pw");
    expect(insertedDetail).toContain("[REDACTED]");
  });

  it("housekeeping DELETE runs on exactly every 50th write, not every write", async () => {
    const { db, queries } = fakeDb();
    const writer = new PgErrorLogWriter(db, db);

    for (let i = 0; i < 49; i++) {
      await writer.record({ traceId: `t-${i}`, msg: "x", detail: {} });
    }
    expect(queries.filter((q) => q.sql.includes("DELETE"))).toHaveLength(0);

    await writer.record({ traceId: "t-50", msg: "x", detail: {} }); // the 50th write
    expect(queries.filter((q) => q.sql.includes("DELETE"))).toHaveLength(1);

    for (let i = 0; i < 49; i++) {
      await writer.record({ traceId: `t-2-${i}`, msg: "x", detail: {} });
    }
    expect(queries.filter((q) => q.sql.includes("DELETE"))).toHaveLength(1); // still just the one

    await writer.record({ traceId: "t-100", msg: "x", detail: {} }); // the 100th write
    expect(queries.filter((q) => q.sql.includes("DELETE"))).toHaveLength(2);
  });

  it("a failing housekeeping DELETE does not reject record() -- the write it rode in on already succeeded", async () => {
    let calls = 0;
    const session: TenantSession = {
      async query(sql: string) {
        calls += 1;
        if (sql.includes("DELETE")) throw new Error("cleanup unavailable");
        return { rows: [] };
      },
    };
    const db: DatabasePort = {
      withTenant: async (_orgId, fn) => fn(session),
      withoutTenant: async (fn) => fn(session),
      close: async () => undefined,
    };
    const writer = new PgErrorLogWriter(db, db);

    for (let i = 0; i < 49; i++) await writer.record({ traceId: `t-${i}`, msg: "x", detail: {} });
    await expect(writer.record({ traceId: "t-50", msg: "x", detail: {} })).resolves.toBeUndefined();
    expect(calls).toBe(51); // 50 inserts + 1 (failed) delete
  });
});

describe("PgErrorLogWriter.list() -- routes through readDb (app_diag_ro), never db (app_rw)", () => {
  // review finding (PR #2475): a SECURITY DEFINER function callable by app_rw has the same
  // blast radius as a table-wide GRANT SELECT to app_rw -- anything that can run SQL over
  // that ONE connection reaches the content either way. The actual fix is a SEPARATE
  // credential (`readDb`, wired to `app_diag_ro`) that `db` (app_rw) never touches. These
  // tests assert that separation directly: two independent fake pools, and `list()` must
  // never issue a single query against the `db` (write/app_rw) pool.
  it("calls kernel_read_error_logs(...) on readDb, and NEVER touches db at all", async () => {
    const { db, queries: writeQueries } = fakeDb();
    const { db: readDb, queries: readQueries } = fakeDb();
    const writer = new PgErrorLogWriter(db, readDb);

    await writer.list({ limit: 20, beforeId: null });

    expect(writeQueries).toHaveLength(0);
    expect(readQueries).toHaveLength(1);
    expect(readQueries[0]!.sql).toContain("kernel_read_error_logs_with_ai_summary($1, $2)");
    expect(readQueries[0]!.sql).not.toMatch(/FROM\s+error_logs\b/);
    // fetches limit+1 to derive hasMore from one query
    expect(readQueries[0]!.params).toEqual([21, null]);
  });

  it("record() and sweepExpiredErrorLogs, symmetrically, never touch readDb", async () => {
    const { db, queries: writeQueries } = fakeDb();
    const { db: readDb, queries: readQueries } = fakeDb();
    const writer = new PgErrorLogWriter(db, readDb);

    await writer.record({ traceId: "t-1", msg: "x", detail: {} });
    await sweepExpiredErrorLogs(db);

    expect(writeQueries.length).toBeGreaterThan(0);
    expect(readQueries).toHaveLength(0);
  });

  it("passes beforeId through as the function's second argument", async () => {
    const { db } = fakeDb();
    const { db: readDb, queries: readQueries } = fakeDb();
    const writer = new PgErrorLogWriter(db, readDb);

    await writer.list({ limit: 10, beforeId: "42" });

    expect(readQueries[0]!.params).toEqual([11, "42"]);
  });

  it("hasMore is derived from the extra fetched row, which is trimmed from items", async () => {
    const session: TenantSession = {
      async query<R = Record<string, unknown>>() {
        return {
          rows: [
            { id: "3", trace_id: "t-3", msg: "x", detail: {}, created_at: new Date("2026-09-02T00:00:00Z") },
            { id: "2", trace_id: "t-2", msg: "x", detail: {}, created_at: new Date("2026-09-01T00:00:00Z") },
          ] as unknown as R[],
        };
      },
    };
    const readDb: DatabasePort = {
      withTenant: async (_orgId, fn) => fn(session),
      withoutTenant: async (fn) => fn(session),
      close: async () => undefined,
    };
    const { db } = fakeDb();
    const writer = new PgErrorLogWriter(db, readDb);

    const out = await writer.list({ limit: 1, beforeId: null });

    expect(out.items).toHaveLength(1);
    expect(out.items[0]!.traceId).toBe("t-3");
    expect(out.hasMore).toBe(true);
  });
});

describe("sweepExpiredErrorLogs -- the boot-time self-heal trigger (review finding #2)", () => {
  it("issues the DELETE and reports ok:true on success", async () => {
    const { db, queries } = fakeDb();
    const result = await sweepExpiredErrorLogs(db);
    expect(result).toEqual({ ok: true });
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain("DELETE FROM error_logs");
  });

  it("never throws -- reports ok:false with the error instead, same discipline as the platform-skill boot self-heal it mirrors", async () => {
    const boom = new Error("pg unavailable at boot");
    const db: DatabasePort = {
      withTenant: async (_orgId, fn) => fn({ query: async () => { throw boom; } }),
      withoutTenant: async (fn) => fn({ query: async () => { throw boom; } }),
      close: async () => undefined,
    };
    await expect(sweepExpiredErrorLogs(db)).resolves.toEqual({ ok: false, error: boom });
  });
});
