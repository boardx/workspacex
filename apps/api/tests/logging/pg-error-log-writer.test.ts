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
    const writer = new PgErrorLogWriter(db);

    await writer.record({ traceId: "t-1", msg: "unhandled exception", detail: { name: "Error", message: "boom" } });

    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain("INSERT INTO error_logs");
    expect(queries[0]!.params).toEqual(["t-1", "unhandled exception", JSON.stringify({ name: "Error", message: "boom" })]);
  });

  it("record() redacts before INSERT -- a secret in detail never reaches the query params (review finding #1)", async () => {
    const { db, queries } = fakeDb();
    const writer = new PgErrorLogWriter(db);

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
    const writer = new PgErrorLogWriter(db);

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
    const writer = new PgErrorLogWriter(db);

    for (let i = 0; i < 49; i++) await writer.record({ traceId: `t-${i}`, msg: "x", detail: {} });
    await expect(writer.record({ traceId: "t-50", msg: "x", detail: {} })).resolves.toBeUndefined();
    expect(calls).toBe(51); // 50 inserts + 1 (failed) delete
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
