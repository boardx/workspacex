/**
 * `PgErrorLogWriter` -- write path + opportunistic retention cadence, against a fake
 * `DatabasePort` (no real Postgres -- the thing under test is the writer's own logic, the
 * same call-count/tick pattern the other F20 login suites use for logic that doesn't need a
 * real integration boundary; see `login-session-store-unavailable.test.ts`'s file header for
 * the fuller version of this argument).
 */
import { describe, expect, it, vi } from "vitest";
import { PgErrorLogWriter, sweepExpiredErrorLogs, type PgErrorLogWriterAiDeps } from "../../src/infrastructure/logging/pg-error-log-writer";
import type { DatabasePort, TenantSession } from "../../src/application/ports/database.port";

/** 等一拍事件循环——`record()` 里的 AI 摘要触发是 fire-and-forget（不 await），测试要等
 *  那段后台工作真正跑起来才能断言它做了什么。 */
function tick(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function fakeAiDeps(over: Partial<PgErrorLogWriterAiDeps> = {}): PgErrorLogWriterAiDeps {
  return {
    model: { complete: vi.fn(async () => ({ text: '{"title":"t","summary":"s"}' })) },
    summaryModel: { provider: "test-provider", modelId: "test-model" },
    log: vi.fn(),
    ...over,
  } as PgErrorLogWriterAiDeps;
}

function fakeDb(): { db: DatabasePort; queries: { sql: string; params: readonly unknown[] }[] } {
  const queries: { sql: string; params: readonly unknown[] }[] = [];
  let nextId = 1;
  const session: TenantSession = {
    async query<R = Record<string, unknown>>(sql: string, params: readonly unknown[] = []) {
      queries.push({ sql, params });
      // `record()` does `INSERT ... RETURNING id`, and the AI-summary fire-and-forget only
      // fires when it gets a real id back (see `record()`'s `id !== null` guard) -- a fake
      // that always returned `{ rows: [] }` silently made every AI-summary test below a no-op.
      if (sql.includes("RETURNING id")) return { rows: [{ id: String(nextId++) }] as unknown as R[] };
      return { rows: [] as R[] };
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
  it("calls kernel_read_error_logs_with_lifecycle(...) on readDb, and NEVER touches db at all", async () => {
    const { db, queries: writeQueries } = fakeDb();
    const { db: readDb, queries: readQueries } = fakeDb();
    const writer = new PgErrorLogWriter(db, readDb);

    await writer.list({ limit: 20, beforeId: null });

    expect(writeQueries).toHaveLength(0);
    expect(readQueries).toHaveLength(1);
    expect(readQueries[0]!.sql).toContain("kernel_read_error_logs_with_lifecycle($1, $2)");
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

describe("PgErrorLogWriter -- lifecycle (status/statusReason/devNote/tags)", () => {
  it("getLifecycle() reads via kernel_read_error_log_lifecycle on db (app_rw), not readDb", async () => {
    const session: TenantSession = {
      async query<R = Record<string, unknown>>() {
        return { rows: [{ status: "待处理", status_reason: null, dev_note: null, tags: ["a", "b"] }] as unknown as R[] };
      },
    };
    const db: DatabasePort = { withTenant: async (_o, fn) => fn(session), withoutTenant: async (fn) => fn(session), close: async () => undefined };
    const { db: readDb, queries: readQueries } = fakeDb();
    const writer = new PgErrorLogWriter(db, readDb);

    const out = await writer.getLifecycle("1");

    expect(out).toEqual({ status: "待处理", statusReason: null, devNote: null, tags: ["a", "b"] });
    expect(readQueries).toHaveLength(0);
  });

  it("getLifecycle() returns null for an unknown id", async () => {
    const { db } = fakeDb();
    const writer = new PgErrorLogWriter(db, db);
    await expect(writer.getLifecycle("missing")).resolves.toBeNull();
  });

  it("updateLifecycle() sets p_set_* flags true only for fields actually provided (field-level partial write)", async () => {
    const session: TenantSession = {
      async query<R = Record<string, unknown>>() {
        return { rows: [{ status: "已转入开发", status_reason: null, dev_note: "备注", tags: ["x"] }] as unknown as R[] };
      },
    };
    const db: DatabasePort = { withTenant: async (_o, fn) => fn(session), withoutTenant: async (fn) => fn(session), close: async () => undefined };
    const writer = new PgErrorLogWriter(db, db);

    const out = await writer.updateLifecycle("1", {
      expectedStatus: "待处理", status: "已转入开发", statusReason: null, devNote: "备注", tags: ["x"],
    });

    expect(out).toEqual({ status: "已转入开发", statusReason: null, devNote: "备注", tags: ["x"] });
  });

  it("updateLifecycle(): a tags-only patch sets p_set_status/p_set_status_reason/p_set_dev_note false, expectedStatus null", async () => {
    const { db, queries } = fakeDb();
    const writer = new PgErrorLogWriter(db, db);

    await writer.updateLifecycle("1", { expectedStatus: null, tags: ["x", "y"] });

    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain("kernel_write_error_log_lifecycle");
    // [id, expectedStatus, setStatus, status, setReason, reason, setDevNote, devNote, setTags, tags]
    expect(queries[0]!.params).toEqual(["1", null, false, null, false, null, false, null, true, ["x", "y"]]);
  });

  it("updateLifecycle(): a status-changing patch passes expectedStatus and sets p_set_status/p_set_status_reason true", async () => {
    const { db, queries } = fakeDb();
    const writer = new PgErrorLogWriter(db, db);

    await writer.updateLifecycle("1", { expectedStatus: "待处理", status: "不做", statusReason: "过期", devNote: undefined, tags: undefined });

    expect(queries[0]!.params).toEqual(["1", "待处理", true, "不做", true, "过期", false, null, false, null]);
  });

  it("updateLifecycle() returns null when the write function returns zero rows (CAS conflict or unknown id)", async () => {
    const { db } = fakeDb(); // default fake returns { rows: [] } for non-INSERT queries
    const writer = new PgErrorLogWriter(db, db);

    await expect(
      writer.updateLifecycle("1", { expectedStatus: "待处理", status: "已转入开发" }),
    ).resolves.toBeNull();
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

describe("PgErrorLogWriter -- AI 摘要触发（独立评审 2026-09-03 回应）", () => {
  it("finding #2：喂给模型的 msg 是脱敏后的版本，不是原始 msg", async () => {
    const { db } = fakeDb();
    const complete = vi.fn(async (_input: { user: string }) => ({ text: '{"title":"t","summary":"s"}' }));
    const ai = fakeAiDeps({ model: { complete } });
    const writer = new PgErrorLogWriter(db, db, ai);

    await writer.record({
      traceId: "t-secret-msg",
      msg: "client error: postgres://app_rw:s3cr3t-pw@10.0.0.5:5432/workspacex",
      detail: {},
    });
    await tick();

    expect(complete).toHaveBeenCalledTimes(1);
    const sentUser = complete.mock.calls[0]![0].user;
    expect(sentUser).not.toContain("s3cr3t-pw");
    expect(sentUser).toContain("[REDACTED]");
  });

  it("finding #3：超过并发上限的摘要生成被跳过（丢弃，不是排队），记一条日志", async () => {
    const { db } = fakeDb();
    let resolveFirst: (() => void) | undefined;
    const complete = vi.fn(() => new Promise<{ text: string }>((resolve) => { resolveFirst ??= () => resolve({ text: '{"title":"t","summary":"s"}' }); }));
    const log = vi.fn();
    const ai = fakeAiDeps({ model: { complete }, log });
    const writer = new PgErrorLogWriter(db, db, ai);

    // 6 条同时落库，上限是 5——第 6 条应该被跳过，不发起第 6 次模型调用。
    for (let i = 0; i < 6; i++) {
      await writer.record({ traceId: `t-burst-${i}`, msg: "x", detail: {} });
    }
    await tick();

    expect(complete).toHaveBeenCalledTimes(5);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("skipped"), expect.objectContaining({ max: 5 }));

    resolveFirst?.();
    await tick();
  });

  it("finding #3 反证：并发降下来之后，新来的异常又能正常生成摘要（不是永久锁死）", async () => {
    const { db } = fakeDb();
    const complete = vi.fn(async () => ({ text: '{"title":"t","summary":"s"}' }));
    const ai = fakeAiDeps({ model: { complete } });
    const writer = new PgErrorLogWriter(db, db, ai);

    for (let i = 0; i < 5; i++) {
      await writer.record({ traceId: `t-a-${i}`, msg: "x", detail: {} });
      await tick(); // 每条都立即 resolve，串行等它们各自跑完，不占着并发名额
    }
    await writer.record({ traceId: "t-after", msg: "x", detail: {} });
    await tick();

    expect(complete).toHaveBeenCalledTimes(6);
  });
});
