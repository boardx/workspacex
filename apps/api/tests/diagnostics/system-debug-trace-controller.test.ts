/** `SystemDebugTraceController` —— 查询参数收窄、memory 源、trace 合并缓冲（issue #3082）。 */
import { describe, expect, it, vi } from "vitest";
import { SystemDebugTraceController, parseDebugEventQuery } from "../../src/interface/controllers/system-debug-trace.controller";
import type { DebugEventRow, DebugTracePort } from "../../src/application/ports/debug-trace.port";
import type { DebugRequestRecorder } from "../../src/interface/middleware/debug-request-recorder";
import type { Principal } from "../../src/domain/principal";
import type { OrgId } from "../../src/domain/org-id";

const principal: Principal = { userId: "u-1", orgId: "org-1" as OrgId };
const row = (id: string, createdAt: string, msg = "same"): DebugEventRow =>
  ({ id, traceId: "t", kind: "k", level: "info", msg, data: null, durationMs: null, userId: null, orgId: null, createdAt });

function fakeTrace(): DebugTracePort {
  return {
    record: vi.fn(),
    query: vi.fn(async () => ({ items: [], hasMore: false })),
    getTrace: vi.fn(async () => [row("1", "2026-09-08T00:00:01Z")]),
    // `mem-1` 是同一条已落库的 "1"（同 createdAt/kind/msg）——必须去重；`mem-9` 还没落库——必须补进来。
    recent: vi.fn(() => ({ items: [row("mem-9", "2026-09-08T00:00:02Z", "pending"), row("mem-1", "2026-09-08T00:00:01Z")], hasMore: false })),
    stats: vi.fn(() => ({ enabled: true, buffered: 1, flushed: 2, dropped: 0, flushFailures: 0, lastFlushError: null, lastFlushAt: null })),
    flush: vi.fn(),
  };
}
const requests = { inFlightRequests: () => [{ traceId: "x", method: "GET", path: "/p", ageMs: 5 }] } as unknown as DebugRequestRecorder;

describe("parseDebugEventQuery", () => {
  it("narrows rather than rejects: bad limit/level/dates fall back, empty strings drop out", () => {
    expect(parseDebugEventQuery({ limit: "9999", level: "loud", since: "not-a-date", traceId: "", beforeId: "abc" }))
      .toEqual({ traceId: undefined, kind: undefined, level: undefined, since: undefined, until: undefined, q: undefined, userId: undefined, limit: 100, beforeId: null });
    expect(parseDebugEventQuery({ limit: "5", level: "error", since: "2026-09-08T00:00:00Z", kind: "agent_run", beforeId: "42", q: "x" }))
      .toMatchObject({ limit: 5, level: "error", since: "2026-09-08T00:00:00.000Z", kind: "agent_run", beforeId: "42", q: "x" });
  });
});

describe("SystemDebugTraceController", () => {
  it("GET /system/debug/events reads the DB by default and memory when source=memory", async () => {
    const trace = fakeTrace();
    const c = new SystemDebugTraceController(trace, requests);
    await c.list(principal, { level: "warn" });
    expect(trace.query).toHaveBeenCalledWith(expect.objectContaining({ level: "warn", limit: 100 }));
    await c.list(principal, { source: "memory" });
    expect(trace.recent).toHaveBeenCalledOnce();
  });

  it("GET /system/debug/traces/:id merges persisted rows with not-yet-flushed buffer rows, deduplicated and time-ordered", async () => {
    const c = new SystemDebugTraceController(fakeTrace(), requests);
    const out = await c.getTrace(principal, "t");
    expect(out.traceId).toBe("t");
    expect(out.items.map((e) => e.id)).toEqual(["1", "mem-9"]);
  });

  it("GET /system/debug/status combines recorder stats with in-flight requests", async () => {
    const c = new SystemDebugTraceController(fakeTrace(), requests);
    expect(await c.status(principal)).toMatchObject({ buffered: 1, flushed: 2, inFlightRequests: [{ traceId: "x", ageMs: 5 }] });
  });
});
