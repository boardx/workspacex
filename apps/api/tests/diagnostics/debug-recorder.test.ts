/**
 * `DebugRecorder` —— 环形缓冲 / 批量落库 / DB 失败降级 / 脱敏（issue #3082）。
 * 全部对着 fake `DebugEventStore`，不碰 DB；真库那侧见 `pg-debug-event-store-real-postgres.test.ts`。
 */
import { describe, expect, it, vi } from "vitest";
import { DebugRecorder, debugRecorderOptionsFromEnv } from "../../src/application/diagnostics/debug-recorder";
import { redactDebugData, type DebugEvent, type DebugEventStore } from "../../src/application/ports/debug-trace.port";

function fakeStore(opts: { failTimes?: number } = {}): DebugEventStore & { batches: DebugEvent[][] } {
  let fails = opts.failTimes ?? 0;
  const batches: DebugEvent[][] = [];
  return {
    batches,
    async insertBatch(events) {
      if (fails > 0) {
        fails -= 1;
        throw new Error("connect ECONNREFUSED postgres://app_rw:hunter2@db/x");
      }
      batches.push([...events]);
    },
    query: vi.fn(async () => ({ items: [], hasMore: false })),
    getTrace: vi.fn(async () => []),
  };
}

let tick = 0;
const now = () => new Date(1_700_000_000_000 + tick++ * 1000).toISOString();

describe("DebugRecorder -- buffering and flushing", () => {
  it("record() is synchronous and nothing is written until flush()", async () => {
    const store = fakeStore();
    const rec = new DebugRecorder(store, { now, batchSize: 100 });
    rec.record({ traceId: "t1", kind: "http.request", level: "info", msg: "GET /x -> 200" });
    expect(store.batches).toHaveLength(0);
    expect(rec.stats().buffered).toBe(1);
    await rec.flush();
    expect(store.batches).toHaveLength(1);
    expect(store.batches[0]![0]).toMatchObject({ traceId: "t1", kind: "http.request", data: null, durationMs: null });
    expect(rec.stats()).toMatchObject({ buffered: 0, flushed: 1, dropped: 0, flushFailures: 0 });
  });

  it("reaching batchSize triggers a flush on its own", async () => {
    const store = fakeStore();
    const rec = new DebugRecorder(store, { now, batchSize: 3 });
    for (let i = 0; i < 3; i += 1) rec.record({ traceId: `t${i}`, kind: "k", level: "info", msg: "m" });
    await rec.flush(); // joins the in-flight flush
    expect(store.batches).toHaveLength(1);
    expect(store.batches[0]).toHaveLength(3);
  });

  it("a failing store keeps events buffered, counts the failure, redacts the error, and retries next flush", async () => {
    const store = fakeStore({ failTimes: 1 });
    const rec = new DebugRecorder(store, { now, batchSize: 100 });
    rec.record({ traceId: "t1", kind: "k", level: "error", msg: "boom" });
    await rec.flush();
    const s1 = rec.stats();
    expect(s1.flushFailures).toBe(1);
    expect(s1.buffered).toBe(1);
    expect(s1.lastFlushError).toContain("ECONNREFUSED");
    expect(s1.lastFlushError).not.toContain("hunter2");
    // still readable from memory while the DB is down
    expect(rec.recent({ limit: 10, beforeId: null }).items.map((e) => e.msg)).toEqual(["boom"]);
    await rec.flush();
    expect(store.batches).toHaveLength(1);
    expect(rec.stats()).toMatchObject({ buffered: 0, flushed: 1, flushFailures: 1 });
  });

  it("overflow drops the OLDEST unpersisted events and counts them", async () => {
    const store = fakeStore({ failTimes: 99 });
    const rec = new DebugRecorder(store, { now, capacity: 3, batchSize: 1000 });
    for (let i = 0; i < 5; i += 1) rec.record({ traceId: "t", kind: "k", level: "info", msg: `m${i}` });
    expect(rec.stats().dropped).toBe(2);
    expect(rec.recent({ limit: 10, beforeId: null }).items.map((e) => e.msg)).toEqual(["m4", "m3", "m2"]);
  });

  it("disabled recorder drops everything silently", async () => {
    const store = fakeStore();
    const rec = new DebugRecorder(store, { now, enabled: false });
    rec.record({ traceId: "t", kind: "k", level: "info", msg: "m" });
    await rec.flush();
    expect(store.batches).toHaveLength(0);
    expect(rec.stats().enabled).toBe(false);
  });

  it("recent() filters by traceId / kind prefix / level / text / time window, newest first, with hasMore", () => {
    const rec = new DebugRecorder(fakeStore(), { now, batchSize: 1000 });
    rec.record({ traceId: "a", kind: "agent_run.started", level: "info", msg: "run r1 started" });
    rec.record({ traceId: "a", kind: "agent_run.failed", level: "error", msg: "run r1 failed: KERNEL_UNAVAILABLE" });
    rec.record({ traceId: "b", kind: "http.request", level: "warn", msg: "POST /threads -> 504" });
    expect(rec.recent({ traceId: "a", limit: 10, beforeId: null }).items).toHaveLength(2);
    expect(rec.recent({ kind: "agent_run", limit: 10, beforeId: null }).items.map((e) => e.kind)).toEqual(["agent_run.failed", "agent_run.started"]);
    expect(rec.recent({ level: "error", limit: 10, beforeId: null }).items).toHaveLength(1);
    expect(rec.recent({ q: "/THREADS", limit: 10, beforeId: null }).items[0]!.traceId).toBe("b");
    const page = rec.recent({ limit: 2, beforeId: null });
    expect(page.hasMore).toBe(true);
    expect(page.items).toHaveLength(2);
    const older = rec.recent({ limit: 2, beforeId: page.items[1]!.id.replace("mem-", "") });
    expect(older.items.map((e) => e.kind)).toEqual(["agent_run.started"]);
  });

  it("stop() flushes and is safe to call twice; the interval timer is unref'd", async () => {
    const store = fakeStore();
    const rec = new DebugRecorder(store, { now, flushIntervalMs: 50 });
    rec.start();
    rec.start();
    rec.record({ traceId: "t", kind: "k", level: "info", msg: "m" });
    await rec.stop();
    await rec.onApplicationShutdown();
    expect(store.batches).toHaveLength(1);
  });
});

describe("redactDebugData", () => {
  it("drops secret-looking keys entirely and scrubs secret-looking string values", () => {
    const out = redactDebugData({
      headers: { authorization: "Bearer abc.def.ghi", cookie: "sid=1", "x-trace-id": "t" },
      apiKey: "sk-live-123",
      dsn: "postgres://user:pw@host/db",
      nested: { password: "x", ok: 1 },
    }) as Record<string, unknown>;
    expect(out.apiKey).toBe("[redacted]");
    expect((out.headers as Record<string, unknown>).authorization).toBe("[redacted]");
    expect((out.headers as Record<string, unknown>).cookie).toBe("[redacted]");
    expect((out.headers as Record<string, unknown>)["x-trace-id"]).toBe("t");
    expect(String(out.dsn)).not.toContain("pw@");
    expect((out.nested as Record<string, unknown>).password).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).ok).toBe(1);
  });

  it("bounds depth, key count and array length, and survives cycles and Errors", () => {
    const cyc: Record<string, unknown> = { a: 1 };
    cyc.self = cyc;
    const out = redactDebugData(cyc) as Record<string, unknown>;
    expect(out.self).toBe("[cycle]");
    const deep: unknown = { l1: { l2: { l3: { l4: { l5: { l6: { l7: "x" } } } } } } };
    expect(JSON.stringify(redactDebugData(deep))).toContain("[depth]");
    const wide = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
    expect((redactDebugData(wide) as Record<string, unknown>)["[truncated]"]).toBe(true);
    const arr = redactDebugData(Array.from({ length: 70 }, (_, i) => i)) as unknown[];
    expect(arr).toHaveLength(65);
    expect(arr[64]).toBe("[+6 more]");
    const err = redactDebugData(new Error("password=secret123 leaked")) as Record<string, unknown>;
    expect(err.name).toBe("Error");
    expect(String(err.message)).not.toContain("secret123");
  });

  it("recorder applies redaction to msg and data on the way in", async () => {
    const store = fakeStore();
    const rec = new DebugRecorder(store, { now });
    rec.record({ traceId: "t", kind: "k", level: "info", msg: "token=abcdef", data: { token: "x", n: 2 }, durationMs: 12.6 });
    await rec.flush();
    const e = store.batches[0]![0]!;
    expect((e.data as Record<string, unknown>).token).toBe("[redacted]");
    expect((e.data as Record<string, unknown>).n).toBe(2);
    expect(e.durationMs).toBe(13);
  });
});

describe("debugRecorderOptionsFromEnv", () => {
  it("reads the four knobs and treats DEBUG_TRACE_ENABLED=0 as off", () => {
    expect(debugRecorderOptionsFromEnv({ DEBUG_TRACE_ENABLED: "0", DEBUG_TRACE_CAPACITY: "10", DEBUG_TRACE_BATCH_SIZE: "x" }))
      .toEqual({ enabled: false, capacity: 10, batchSize: undefined, flushIntervalMs: undefined });
    expect(debugRecorderOptionsFromEnv({}).enabled).toBe(true);
  });
});
