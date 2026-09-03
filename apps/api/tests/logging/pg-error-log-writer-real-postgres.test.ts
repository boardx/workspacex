/**
 * `PgErrorLogWriter` against a REAL Postgres database, executing the actual migration -- PR
 * #2444 independent review, finding #4: the other `pg-error-log-writer.test.ts` suite proves
 * the writer's own logic (cadence, redaction application, failure handling) against a fake
 * `DatabasePort`, which is the right tool for that (see that file's header). It does not
 * prove the migration actually creates a queryable `error_logs` table, that a real INSERT
 * with a `jsonb` parameter round-trips, that the trace_id index makes the lookup this table
 * exists for actually work, or that `sweepExpiredErrorLogs`'s DELETE really removes old rows
 * and leaves new ones. This file does, over the real `PgDatabase` + real migrations, same
 * infrastructure the other F20/F16x suites use (`ensureDatabase`/`migrateOnce`/`PgDatabase`).
 *
 * ## Why verification reads go through `asOwner`, not `db` (2026-09-01, finding #1 fixed for real)
 *
 * `writer`/`db` run as `app_rw` -- the same identity `PgErrorLogWriter` uses in production
 * (`appConfig()`). The migration now `REVOKE`s ALL on `error_logs` from `app_rw` and grants
 * back only `INSERT, DELETE` (see the migration's header). That is not a detail of this test
 * file to route around -- it is exactly the privilege boundary finding #1 asked for, and this
 * suite verifying "the row is really there" by `SELECT`ing through the same role that is now
 * forbidden from `SELECT`ing would either silently regrant the privilege back (masking the
 * fix) or fail every assertion in this file with `permission denied`. `asOwner` -- the
 * fixture-setup connection this repo's other suites already use for the same reason -- reads
 * the row back with the migration role instead, matching how a human operator would actually
 * query this table in production.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig, diagnosticsReaderConfig } from "../../src/infrastructure/db/pg-config";
import { PgErrorLogWriter, sweepExpiredErrorLogs } from "../../src/infrastructure/logging/pg-error-log-writer";

let db: PgDatabase;
/** `app_diag_ro` -- a genuinely separate credential, see `pg-config.ts`'s header. */
let readDb: PgDatabase;
let writer: PgErrorLogWriter;

interface ErrorLogRow {
  trace_id: string;
  msg: string;
  detail: { name?: string; message?: string; raw?: string };
  created_at: string;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  readDb = new PgDatabase(diagnosticsReaderConfig());
  writer = new PgErrorLogWriter(db, readDb);
});

beforeEach(async () => {
  await asOwner((c) => c.query("DELETE FROM error_logs"));
});

afterAll(async () => {
  await db?.close();
  await readDb?.close();
});

describe("PgErrorLogWriter against real Postgres -- migration, INSERT, jsonb, index, retention", () => {
  it("the migration creates a queryable table: record() really inserts a row, readable by trace_id", async () => {
    await writer.record({
      traceId: "t-real-1",
      msg: "unhandled exception",
      detail: { name: "Error", message: "Connection is closed." },
    });

    const rows = await asOwner((c) =>
      c.query<ErrorLogRow>(
        "SELECT trace_id, msg, detail, created_at FROM error_logs WHERE trace_id = $1", ["t-real-1"],
      ).then((r) => r.rows),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ trace_id: "t-real-1", msg: "unhandled exception" });
    // `detail` round-trips as real jsonb -- pg deserialises it back into an object, not a string.
    expect(rows[0]!.detail).toEqual({ name: "Error", message: "Connection is closed." });
    expect(new Date(rows[0]!.created_at).getTime()).not.toBeNaN();
  });

  it("a secret in the detail is redacted BEFORE it lands in the real table (finding #1, end to end)", async () => {
    await writer.record({
      traceId: "t-real-secret",
      msg: "unhandled exception",
      detail: { name: "Error", message: "postgres://app_rw:s3cr3t-pw@10.0.0.5:5432/workspacex" },
    });

    const rows = await asOwner((c) =>
      c.query<ErrorLogRow>("SELECT detail FROM error_logs WHERE trace_id = $1", ["t-real-secret"]).then((r) => r.rows),
    );
    const stored = JSON.stringify(rows[0]!.detail);
    expect(stored).not.toContain("s3cr3t-pw");
    expect(stored).toContain("[REDACTED]");
  });

  it("sweepExpiredErrorLogs really deletes rows older than the retention window and leaves recent ones", async () => {
    await writer.record({ traceId: "t-real-old", msg: "x", detail: {} });
    await writer.record({ traceId: "t-real-recent", msg: "x", detail: {} });
    await asOwner((c) =>
      c.query("UPDATE error_logs SET created_at = now() - interval '31 days' WHERE trace_id = $1", ["t-real-old"]),
    );

    const result = await sweepExpiredErrorLogs(db);
    expect(result).toEqual({ ok: true });

    const rows = await asOwner((c) => c.query<{ trace_id: string }>("SELECT trace_id FROM error_logs").then((r) => r.rows));
    const traceIds = rows.map((r) => r.trace_id);
    expect(traceIds).not.toContain("t-real-old");
    expect(traceIds).toContain("t-real-recent");
  });

  it("trace_id index makes the lookup this table exists for actually usable (reflects real query plan, not just a passing SELECT)", async () => {
    const rows = await asOwner((c) =>
      c.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes WHERE tablename = 'error_logs' AND indexdef LIKE '%trace_id%'`,
      ).then((r) => r.rows),
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  // Finding #1's actual ask: not "redact what's in the table" but "the app role itself must
  // not be able to read the diagnostic content back". Mechanical, not a comment -- if a future
  // migration ever regrants table-wide SELECT to app_rw, this is the test that goes red.
  //
  // Reads `trace_id`/`msg`/`detail` specifically, not `SELECT 1 FROM error_logs` -- the latter
  // references no column at all, so it is not a reliable probe of "can app_rw read the
  // diagnostic content" now that app_rw legitimately holds a column-scoped
  // `SELECT (created_at)` (needed for `sweepExpiredErrorLogs`'s WHERE clause, see the
  // migration's header). The columns that actually carry the sensitive payload are the ones
  // this test must prove are unreachable.
  it("【反证】app_rw（进程自身的运行时身份）读不到诊断内容列，不是只对新 HTTP 面收窄", async () => {
    await writer.record({ traceId: "t-real-priv-check", msg: "x", detail: {} });

    await expect(
      db.withoutTenant((s) => s.query("SELECT trace_id, msg, detail FROM error_logs LIMIT 1")),
    ).rejects.toThrow(/permission denied/);
  });

  it("app_rw 仍然能 INSERT/DELETE（最小权限不是零权限）：writer 与 sweep 在新授权下依然工作", async () => {
    await expect(writer.record({ traceId: "t-real-still-insertable", msg: "x", detail: {} })).resolves.toBeUndefined();
    await expect(sweepExpiredErrorLogs(db)).resolves.toEqual({ ok: true });
  });

  // review finding (PR #2475), round 2: a SECURITY DEFINER function with EXECUTE granted to
  // app_rw has the SAME blast radius as the table-wide GRANT the negative test above already
  // rules out -- anything able to run SQL over the app_rw connection could call the function
  // directly. This is the test that would have caught that: app_rw must be refused EXECUTE
  // on kernel_read_error_logs, not just refused a raw table SELECT. If a future migration
  // ever grants app_rw EXECUTE here (the second wrong shape this PR tried), this goes red.
  it("【反证2】app_rw 连 kernel_read_error_logs 也调不了——SECURITY DEFINER 函数不是 app_rw 的又一条读路径", async () => {
    await expect(
      db.withoutTenant((s) => s.query("SELECT * FROM kernel_read_error_logs(10, NULL)")),
    ).rejects.toThrow(/permission denied/);
  });

  // review finding (PR #2475), round 3: PostgreSQL grants EXECUTE to PUBLIC by default on a
  // new function -- without an explicit REVOKE, app_rw could have INHERITED execute rights
  // through PUBLIC regardless of whether it was ever granted directly. The rejected-call test
  // above proves the end behaviour; this asserts the underlying catalog fact directly, so a
  // regression (a future migration re-adding the function without the REVOKE) is caught even
  // if some other change happened to make the call itself fail for an unrelated reason.
  it("has_function_privilege(app_rw, ..., EXECUTE) is false -- not inherited via PUBLIC either", async () => {
    const rows = await asOwner((c) =>
      c
        .query<{ has_priv: boolean }>(
          `SELECT has_function_privilege('app_rw', 'kernel_read_error_logs(integer,bigint)', 'EXECUTE') AS has_priv`,
        )
        .then((r) => r.rows),
    );
    expect(rows[0]!.has_priv).toBe(false);
  });

  // The positive counterpart to both negative tests above: a DIFFERENT credential
  // (app_diag_ro, via `readDb`) CAN call the function -- proving the separation is real (a
  // working reader exists) and not merely "nobody can read anything".
  it("app_diag_ro 能调用 kernel_read_error_logs——分离是真的分离，不是把读路径也一起锁死", async () => {
    await writer.record({ traceId: "t-real-diag-ro-direct", msg: "x", detail: {} });

    const rows = await readDb.withoutTenant((s) =>
      s.query<{ trace_id: string }>("SELECT * FROM kernel_read_error_logs(50, NULL)"),
    );
    expect(rows.rows.map((r) => r.trace_id)).toContain("t-real-diag-ro-direct");
  });

  // review finding (PR #2475), round 3: p_limit is clamped to 0..200 INSIDE the function
  // (defense in depth, independent of whatever limit the application layer passes) -- prove
  // it against real Postgres, not just by reading the SQL.
  it("kernel_read_error_logs clamps an oversized p_limit to 200, even called directly", async () => {
    for (let i = 0; i < 205; i++) {
      await writer.record({ traceId: `t-real-clamp-${i}`, msg: "x", detail: {} });
    }

    const rows = await readDb.withoutTenant((s) =>
      s.query<{ id: string }>("SELECT * FROM kernel_read_error_logs(100000, NULL)"),
    );
    expect(rows.rows.length).toBeLessThanOrEqual(200);
  });

  // review finding (PR #2475): the negative tests above prove app_rw cannot read the table
  // directly OR through the function -- these two prove the one narrow path that CAN
  // (app_diag_ro, via `writer.list()`/`readDb`) actually works against real Postgres.
  it("writer.list() reads real rows back through kernel_read_error_logs even though app_rw cannot SELECT the table directly", async () => {
    await writer.record({ traceId: "t-real-list-1", msg: "first", detail: { name: "Error", message: "one" } });
    await writer.record({ traceId: "t-real-list-2", msg: "second", detail: { name: "Error", message: "two" } });

    const out = await writer.list({ limit: 50, beforeId: null });

    const traceIds = out.items.map((i) => i.traceId);
    expect(traceIds).toContain("t-real-list-1");
    expect(traceIds).toContain("t-real-list-2");
    // newest-first
    expect(traceIds.indexOf("t-real-list-2")).toBeLessThan(traceIds.indexOf("t-real-list-1"));
    const second = out.items.find((i) => i.traceId === "t-real-list-2");
    expect(second?.detail).toEqual({ name: "Error", message: "two" });
  });

  it("writer.list() beforeId cursor really excludes rows at/after that id, against real Postgres", async () => {
    await writer.record({ traceId: "t-real-cursor-1", msg: "x", detail: {} });
    await writer.record({ traceId: "t-real-cursor-2", msg: "x", detail: {} });
    await writer.record({ traceId: "t-real-cursor-3", msg: "x", detail: {} });

    const firstPage = await writer.list({ limit: 1, beforeId: null });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.items[0]!.traceId).toBe("t-real-cursor-3");
    expect(firstPage.hasMore).toBe(true);

    const secondPage = await writer.list({ limit: 1, beforeId: firstPage.items[0]!.id });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]!.traceId).toBe("t-real-cursor-2");
  });
});

/**
 * AI 摘要（迁移 `20260902160000_error_logs_ai_summary.sql`）的权限边界，对真实 Postgres——
 * 独立评审 finding #5（2026-09-03）：迁移的头注引用了这份文件，但当时只改了函数名断言，
 * 没有加对新函数/新列的真实权限反证。这里补上，镜子照的是上面 `kernel_read_error_logs`
 * 那组反证的同一套结构（拒绝 app_rw 直连、拒绝 app_rw 走旧函数、PUBLIC 已显式 REVOKE、
 * app_diag_ro 能走新函数、上限被夹住），只是换成新函数/新列。
 */
describe("AI 摘要权限边界（app_rw 只能写两个摘要列，app_diag_ro 才能整表读，对真实 Postgres）", () => {
  it("【反证3】app_rw 对 ai_title/ai_summary 两列也没有裸 SELECT——不是只锁了旧列", async () => {
    await writer.record({ traceId: "t-real-ai-cols", msg: "x", detail: {} });

    await expect(
      db.withoutTenant((s) => s.query("SELECT ai_title, ai_summary FROM error_logs LIMIT 1")),
    ).rejects.toThrow(/permission denied/);
  });

  it("【反证4】app_rw 对 error_logs 没有裸 UPDATE——唯一的写回路径是 SECURITY DEFINER 函数", async () => {
    await writer.record({ traceId: "t-real-ai-no-update", msg: "x", detail: {} });

    await expect(
      db.withoutTenant((s) => s.query("UPDATE error_logs SET ai_title = 'x' WHERE trace_id = 't-real-ai-no-update'")),
    ).rejects.toThrow(/permission denied/);
  });

  it("app_rw 能调用 kernel_write_error_log_ai_summary，且只有那两列被改——其余字段原样不动", async () => {
    await writer.record({ traceId: "t-real-ai-write", msg: "original msg", detail: { name: "Error" } });
    const before = await asOwner((c) =>
      c.query<{ id: string; msg: string }>("SELECT id, msg FROM error_logs WHERE trace_id = $1", ["t-real-ai-write"])
        .then((r) => r.rows[0]!),
    );

    await db.withoutTenant((s) =>
      s.query("SELECT kernel_write_error_log_ai_summary($1::bigint, $2, $3)", [before.id, "标题", "说明"]),
    );

    const after = await asOwner((c) =>
      c.query<{ msg: string; ai_title: string; ai_summary: string }>(
        "SELECT msg, ai_title, ai_summary FROM error_logs WHERE trace_id = $1", ["t-real-ai-write"],
      ).then((r) => r.rows[0]!),
    );
    expect(after.ai_title).toBe("标题");
    expect(after.ai_summary).toBe("说明");
    expect(after.msg).toBe(before.msg); // 函数体只 UPDATE 两个摘要列，msg 没被顺手改掉
  });

  it("【反证5】app_rw 调不了 kernel_read_error_logs_with_ai_summary——EXECUTE 只给了 app_diag_ro", async () => {
    await expect(
      db.withoutTenant((s) => s.query("SELECT * FROM kernel_read_error_logs_with_ai_summary(10, NULL)")),
    ).rejects.toThrow(/permission denied/);
  });

  it("has_function_privilege(app_rw, kernel_read_error_logs_with_ai_summary, EXECUTE) 为 false——PUBLIC 也没有隐式继承", async () => {
    const rows = await asOwner((c) =>
      c.query<{ has_priv: boolean }>(
        `SELECT has_function_privilege('app_rw', 'kernel_read_error_logs_with_ai_summary(integer,bigint)', 'EXECUTE') AS has_priv`,
      ).then((r) => r.rows),
    );
    expect(rows[0]!.has_priv).toBe(false);
  });

  it("has_function_privilege(app_rw, kernel_write_error_log_ai_summary, EXECUTE) 为 true——这是唯一授出的写路径", async () => {
    const rows = await asOwner((c) =>
      c.query<{ has_priv: boolean }>(
        `SELECT has_function_privilege('app_rw', 'kernel_write_error_log_ai_summary(bigint,text,text)', 'EXECUTE') AS has_priv`,
      ).then((r) => r.rows),
    );
    expect(rows[0]!.has_priv).toBe(true);
  });

  it("app_diag_ro 能调用 kernel_read_error_logs_with_ai_summary，读到的 ai_title/ai_summary 与写回的一致", async () => {
    await writer.record({ traceId: "t-real-ai-diag-read", msg: "x", detail: {} });
    const row = await asOwner((c) =>
      c.query<{ id: string }>("SELECT id FROM error_logs WHERE trace_id = $1", ["t-real-ai-diag-read"]).then((r) => r.rows[0]!),
    );
    await db.withoutTenant((s) =>
      s.query("SELECT kernel_write_error_log_ai_summary($1::bigint, $2, $3)", [row.id, "诊断标题", "诊断说明"]),
    );

    const out = await writer.list({ limit: 50, beforeId: null });
    const item = out.items.find((i) => i.traceId === "t-real-ai-diag-read");
    expect(item?.aiTitle).toBe("诊断标题");
    expect(item?.aiSummary).toBe("诊断说明");
  });

  it("没写回摘要的行，aiTitle/aiSummary 原样是 null——不是空字符串，不是伪造的占位符", async () => {
    await writer.record({ traceId: "t-real-ai-still-null", msg: "x", detail: {} });

    const out = await writer.list({ limit: 50, beforeId: null });
    const item = out.items.find((i) => i.traceId === "t-real-ai-still-null");
    expect(item?.aiTitle).toBeNull();
    expect(item?.aiSummary).toBeNull();
  });

  it("kernel_read_error_logs_with_ai_summary 同样把超大 p_limit 夹到 200（函数内部的纵深防御，不只是应用层传参克制）", async () => {
    for (let i = 0; i < 5; i++) {
      await writer.record({ traceId: `t-real-ai-clamp-${i}`, msg: "x", detail: {} });
    }

    const rows = await readDb.withoutTenant((s) =>
      s.query<{ id: string }>("SELECT * FROM kernel_read_error_logs_with_ai_summary(100000, NULL)"),
    );
    expect(rows.rows.length).toBeLessThanOrEqual(200);
  });
});
