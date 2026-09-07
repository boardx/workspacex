import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { useRunTrace } from "@/lib/chat-workbench/use-run-trace";
describe("business submission acknowledgement", () => {
  it("acknowledges durable running status even if execution later fails, never correlation RUN_STARTED", () => {
    let subscriber: any;
    const agent = { subscribe: (value: unknown) => { subscriber = value; return { unsubscribe: vi.fn() }; } } as unknown as AbstractAgent;
    const { result } = renderHook(() => useRunTrace(agent, "thread-a"));
    act(() => subscriber.onRunStartedEvent({ event: { runId: "client-correlation" } }));
    expect(result.current.acceptedRunEpoch.current).toBe(0);
    const base = { runId: "business-run", emittedAt: "2026-09-07T00:00:00Z", kind: "status" };
    act(() => subscriber.onCustomEvent({ event: { name: "execution_event", value: { ...base, seq: 0, status: "running" } } }));
    expect(result.current.acceptedRunEpoch.current).toBe(1);
    act(() => subscriber.onCustomEvent({ event: { name: "execution_event", value: { ...base, seq: 1, status: "failed" } } }));
    expect(result.current.acceptedRunEpoch.current).toBe(1);
    expect(result.current.events["business-run"]).toHaveLength(2);
  });
});
