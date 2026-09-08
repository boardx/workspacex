/**
 * `DebugRequestRecorder` —— HTTP 流水与「卡住的请求」两种事件（issue #3082）。
 * 用 EventEmitter 伪造 req/res，fake timers 驱动 stall 判定。
 */
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { DebugRequestRecorder } from "../../src/interface/middleware/debug-request-recorder";
import type { DebugEventInput, DebugTracePort } from "../../src/application/ports/debug-trace.port";

function fakeTrace(): DebugTracePort & { events: DebugEventInput[] } {
  const events: DebugEventInput[] = [];
  return {
    events,
    record: (e) => { events.push(e); },
    query: vi.fn(), getTrace: vi.fn(), recent: vi.fn(), stats: vi.fn(), flush: vi.fn(),
  };
}

function fakeReq(method: string, url: string, extra: Record<string, unknown> = {}): Request {
  return { method, url, originalUrl: url, traceId: `trace-${url}`, baseUrl: "", ...extra } as unknown as Request;
}

function fakeRes(status: number): Response & EventEmitter {
  const res = new EventEmitter() as Response & EventEmitter;
  (res as { statusCode: number }).statusCode = status;
  (res as { writableFinished: boolean }).writableFinished = false;
  (res as unknown as { getHeader: () => undefined }).getHeader = () => undefined;
  return res;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("DebugRequestRecorder", () => {
  it("records finish with level by status and duration, and picks up the principal set later by the guard", () => {
    const trace = fakeTrace();
    const rec = new DebugRequestRecorder(trace, { slowMs: 1000, stallMs: 60_000 });
    const req = fakeReq("GET", "/projects/1?x=1");
    const res = fakeRes(200);
    rec.middleware(req, res, () => undefined);
    (req as unknown as { principal: unknown }).principal = { userId: "u1", orgId: "o1" };
    (req as unknown as { route: unknown }).route = { path: "/projects/:id" };
    vi.advanceTimersByTime(30);
    (res as { writableFinished: boolean }).writableFinished = true;
    res.emit("finish");
    res.emit("close");
    expect(trace.events).toHaveLength(1);
    expect(trace.events[0]).toMatchObject({
      traceId: "trace-/projects/1?x=1", kind: "http.request", level: "info", userId: "u1", orgId: "o1", durationMs: 30,
      msg: "GET /projects/:id -> 200 (30ms)",
    });
    expect(rec.inFlightRequests()).toEqual([]);
  });

  it("4xx is warn, 5xx is error, slow 2xx is warn, client abort is error", () => {
    const trace = fakeTrace();
    const rec = new DebugRequestRecorder(trace, { slowMs: 500, stallMs: 60_000 });
    const cases: [number, number, boolean, string][] = [[404, 1, false, "warn"], [500, 1, false, "error"], [200, 900, false, "warn"], [200, 1, true, "error"]];
    for (const [status, wait, abort, level] of cases) {
      const res = fakeRes(status);
      rec.middleware(fakeReq("POST", `/x/${status}/${wait}/${abort}`), res, () => undefined);
      vi.advanceTimersByTime(wait);
      if (abort) res.emit("close");
      else { (res as { writableFinished: boolean }).writableFinished = true; res.emit("finish"); }
      expect(trace.events.at(-1)!.level).toBe(level);
    }
    expect(trace.events.at(-1)!.msg).toContain("aborted by client");
  });

  it("healthy probes on quiet paths are skipped; failing probes are not", () => {
    const trace = fakeTrace();
    const rec = new DebugRequestRecorder(trace, { stallMs: 60_000 });
    for (const status of [200, 503]) {
      const res = fakeRes(status);
      rec.middleware(fakeReq("GET", "/health"), res, () => undefined);
      (res as { writableFinished: boolean }).writableFinished = true;
      res.emit("finish");
    }
    expect(trace.events.map((e) => e.level)).toEqual(["error"]);
  });

  it("a request that never finishes emits http.request.stalled once and stays in the in-flight list", () => {
    const trace = fakeTrace();
    const rec = new DebugRequestRecorder(trace, { stallMs: 15_000 });
    rec.middleware(fakeReq("POST", "/agent-runs"), fakeRes(200), () => undefined);
    vi.advanceTimersByTime(14_999);
    expect(trace.events).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(trace.events).toHaveLength(1);
    expect(trace.events[0]).toMatchObject({ kind: "http.request.stalled", level: "warn", durationMs: 15_000 });
    vi.advanceTimersByTime(60_000);
    expect(trace.events).toHaveLength(1);
    expect(rec.inFlightRequests()).toEqual([{ traceId: "trace-/agent-runs", method: "POST", path: "/agent-runs", ageMs: 75_000 }]);
  });

  it("a throwing DebugTracePort never breaks the request", () => {
    const trace = fakeTrace();
    trace.record = () => { throw new Error("nope"); };
    const rec = new DebugRequestRecorder(trace, { stallMs: 60_000 });
    const res = fakeRes(200);
    const next = vi.fn();
    rec.middleware(fakeReq("GET", "/x"), res, next);
    expect(next).toHaveBeenCalledOnce();
    (res as { writableFinished: boolean }).writableFinished = true;
    expect(() => res.emit("finish")).not.toThrow();
  });
});
