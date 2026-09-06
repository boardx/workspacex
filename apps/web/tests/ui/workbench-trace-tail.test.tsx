import * as React from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { reduceTrace, type TraceStore } from "@/lib/chat-workbench/run-trace";
import { executionTailDelay, useRunTraceTail } from "@/lib/chat-workbench/use-run-trace-tail";
const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/chat-workbench/execution-events-api", () => ({ readExecutionPage: read }));
const base = { runId: "run-a", emittedAt: "2026-09-07T00:00:00Z", kind: "status" as const };
afterEach(() => { vi.useRealTimers(); read.mockReset(); });
describe("resume journal tail", () => {
  it("paused and approval states remain observable with backoff", () => {
    expect(executionTailDelay([{ ...base, seq: 0, status: "paused" }])).toBe(5000);
    expect(executionTailDelay([{ ...base, seq: 0, status: "awaiting_tool_permission" }])).toBe(5000);
    expect(executionTailDelay([], 8)).toBe(30_000);
  });
  it("tails a resumed run without runAgent and restores final result once using advancing cursor", async () => {
    vi.useFakeTimers();
    const onSettled = vi.fn().mockResolvedValue(true);
    read.mockResolvedValueOnce({ events: [{ ...base, seq: 1, status: "running" }], nextSeq: null })
      .mockResolvedValueOnce({ events: [{ ...base, seq: 2, status: "succeeded" }], nextSeq: null });
    renderHook(() => {
      const [events, setEvents] = React.useState<TraceStore>({ "run-a": [{ ...base, seq: 0, status: "paused" }] });
      const append = React.useCallback((incoming: readonly ExecutionEvent[]) => setEvents((previous) => reduceTrace(previous, incoming)), []);
      useRunTraceTail({ threadId: "thread-a", bearer: "token", events, append, onSettled });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(read.mock.calls[0]?.slice(0, 3)).toEqual(["run-a", 0, "token"]);
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(read.mock.calls[1]?.slice(0, 3)).toEqual(["run-a", 1, "token"]);
    expect(onSettled).toHaveBeenCalledTimes(1);
    expect(onSettled).toHaveBeenCalledWith("run-a");
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(read).toHaveBeenCalledTimes(2);
  });
  it("aborts an old thread request when changing scope", () => {
    read.mockImplementation(() => new Promise(() => {}));
    const { rerender } = renderHook(({ threadId }) => useRunTraceTail({ threadId, bearer: "token", events: { "run-a": [{ ...base, seq: 0, status: "paused" }] }, append: vi.fn(), onSettled: vi.fn() }), { initialProps: { threadId: "a" } });
    const signal = read.mock.calls[0]?.[3] as AbortSignal;
    rerender({ threadId: "b" });
    expect(signal.aborted).toBe(true);
  });
  it("never uses legacy display sequence as a live cursor and observes explicitly restored runs", () => {
    read.mockImplementation(() => new Promise(() => {}));
    const events: TraceStore = { "run-a": [{ runId: "run-a", emittedAt: "now", source: "legacy", seq: 50, kind: "text_delta", messageId: "old", delta: "history" }] };
    const first = renderHook(() => useRunTraceTail({ threadId: "thread", bearer: "token", events, append: vi.fn(), onSettled: vi.fn() }));
    expect(read).not.toHaveBeenCalled();
    first.unmount();
    renderHook(() => useRunTraceTail({ threadId: "thread", bearer: "token", events, observedRunId: "run-a", append: vi.fn(), onSettled: vi.fn() }));
    expect(read.mock.calls[0]?.slice(0, 3)).toEqual(["run-a", -1, "token"]);
  });

});
