// @global-scope-fixture table:debug_events: 诊断表没有 org_id；本文件 beforeEach 全表 DELETE 收敛，且只有本文件写它。
/**
 * `PgDebugEventStore` 对着真 Postgres：迁移建表、批量 INSERT、app_diag_ro 读函数、trace 正序、
 * 双重裁剪、以及 app_rw 读不到诊断内容的反证（issue #3082）。同 `pg-error-log-writer-real-postgres.test.ts`
 * 的夹具与理由。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig, diagnosticsReaderConfig } from "../../src/infrastructure/db/pg-config";
import { PgDebugEventStore, sweepDebugEvents } from "../../src/infrastructure/diagnostics/pg-debug-event-store";
import { DebugRecorder } from "../../src/application/diagnostics/debug-recorder";

let db: PgDatabase;
let readDb: PgDatabase;
let store: PgDebugEventStore;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  readDb = new PgDatabase(diagnosticsReaderConfig());
  store = new PgDebugEventStore(db, readDb);
});
beforeEach(async () => { await asOwner((c) => c.query("DELETE FROM debug_events")); });
afterAll(async () => { await db?.close(); await readDb?.close(); });

const at = (s: number) => new Date(Date.UTC(2026, 8, 8, 0, 0, s)).toISOString();

describe("PgDebugEventStore against real Postgres", () => {
  it("a batch inserts as one statement, round-trips jsonb, and is readable through app_diag_ro with filters", async () => {
    await store.insertBatch([
      { traceId: "tr-1", kind: "http.request", level: "info", msg: "GET /a -> 200 (3ms)", data: { status: 200 }, durationMs: 3, userId: "u1", orgId: "o1", createdAt: at(1) },
      { traceId: "tr-1", kind: "exception.unhandled", level: "error", msg: "unhandled exception", data: { name: "Error" }, durationMs: null, userId: null, orgId: null, createdAt: at(2) },
      { traceId: "tr-2", kind: "agent_run.failed", level: "error", msg: "run r1 failed", data: null, durationMs: null, userId: "u2", orgId: "o1", createdAt: at(3) },
    ]);
    const all = await store.query({ limit: 10, beforeId: null });
    expect(all.items.map((e) => e.kind)).toEqual(["agent_run.failed", "exception.unhandled", "http.request"]);
    expect(all.items[2]!.data).toEqual({ status: 200 });
    expect(all.items[2]).toMatchObject({ durationMs: 3, userId: "u1", orgId: "o1", createdAt: at(1) });

    expect((await store.query({ level: "error", limit: 10, beforeId: null })).items).toHaveLength(2);
    expect((await store.query({ kind: "agent_run", limit: 10, beforeId: null })).items[0]!.kind).toBe("agent_run.failed");
    expect((await store.query({ q: "/A ->", limit: 10, beforeId: null })).items).toHaveLength(1);
    expect((await store.query({ userId: "u2", limit: 10, beforeId: null })).items).toHaveLength(1);
    expect((await store.query({ since: at(2), until: at(2), limit: 10, beforeId: null })).items.map((e) => e.kind)).toEqual(["exception.unhandled"]);

    const page1 = await store.query({ limit: 2, beforeId: null });
    expect(page1.hasMore).toBe(true);
    const page2 = await store.query({ limit: 2, beforeId: page1.items[1]!.id });
    expect(page2.hasMore).toBe(false);
    expect(page2.items.map((e) => e.kind)).toEqual(["http.request"]);
  });

  it("getTrace returns one trace's events oldest first", async () => {
    await store.insertBatch([
      { traceId: "tr-x", kind: "b", level: "info", msg: "second", data: null, durationMs: null, userId: null, orgId: null, createdAt: at(5) },
      { traceId: "tr-x", kind: "a", level: "info", msg: "first", data: null, durationMs: null, userId: null, orgId: null, createdAt: at(4) },
      { traceId: "tr-y", kind: "c", level: "info", msg: "other", data: null, durationMs: null, userId: null, orgId: null, createdAt: at(4) },
    ]);
    expect((await store.getTrace("tr-x")).map((e) => e.msg)).toEqual(["first", "second"]);
  });

  it("sweep trims by age AND by row count, and runs as app_rw", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => ({
      traceId: `tr-${i}`, kind: "k", level: "info" as const, msg: `m${i}`, data: null, durationMs: null, userId: null, orgId: null,
      createdAt: i === 0 ? new Date(Date.now() - 10 * 86_400_000).toISOString() : new Date(Date.now() - i * 1000).toISOString(),
    }));
    await store.insertBatch(rows);
    const swept = await sweepDebugEvents(db, { retentionDays: 7, maxRows: 3 });
    expect(swept.ok).toBe(true);
    const left = await store.query({ limit: 10, beforeId: null });
    expect(left.items.map((e) => e.msg)).toEqual(["m5", "m4", "m3"]);
  });

  it("end to end through DebugRecorder: record() -> flush() -> readable by trace", async () => {
    const rec = new DebugRecorder(store, { batchSize: 100 });
    rec.record({ traceId: "tr-e2e", kind: "http.request.stalled", level: "warn", msg: "POST /threads still running", data: { authorization: "Bearer x" } });
    await rec.flush();
    const items = await store.getTrace("tr-e2e");
    expect(items).toHaveLength(1);
    expect((items[0]!.data as Record<string, unknown>).authorization).toBe("[redacted]");
    expect(rec.stats()).toMatchObject({ flushed: 1, flushFailures: 0 });
  });

  it("app_rw structurally cannot read diagnostic content, and app_diag_ro cannot write", async () => {
    await expect(db.withoutTenant((s) => s.query("SELECT msg FROM debug_events"))).rejects.toMatchObject({ code: "42501" });
    await expect(
      readDb.withoutTenant((s) => s.query("INSERT INTO debug_events (trace_id, kind, level, msg, created_at) VALUES ('x','k','info','m', now())")),
    ).rejects.toMatchObject({ code: "42501" });
  });
});
