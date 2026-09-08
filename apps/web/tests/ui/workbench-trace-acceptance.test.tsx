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

  /** #3137: a tool call may start before the first durable execution event of the
   * run reaches the client. The message must still be bound to that run — an
   * unbound message is rendered as "legacy", which puts a second copy of the very
   * same tool card outside the run trace panel. */
  it("binds messages whose first event arrived before the run id was known", () => {
    let subscriber: any;
    const agent = { subscribe: (value: unknown) => { subscriber = value; return { unsubscribe: vi.fn() }; } } as unknown as AbstractAgent;
    const { result } = renderHook(() => useRunTrace(agent, "thread-a"));
    act(() => subscriber.onRunStartedEvent({ event: { runId: "client-correlation" } }));
    act(() => subscriber.onToolCallStartEvent({ event: { parentMessageId: "message-1" } }));
    act(() => subscriber.onTextMessageStartEvent({ event: { messageId: "message-2" } }));
    expect(result.current.messageRuns).toEqual({});
    act(() => subscriber.onCustomEvent({ event: { name: "execution_event", value: { runId: "business-run", emittedAt: "2026-09-07T00:00:00Z", kind: "status", seq: 0, status: "running" } } }));
    expect(result.current.messageRuns).toEqual({ "message-1": "business-run", "message-2": "business-run" });
    act(() => subscriber.onToolCallStartEvent({ event: { parentMessageId: "message-3" } }));
    expect(result.current.messageRuns["message-3"]).toBe("business-run");
  });

  it("does not carry messages of an abandoned run into the next one", () => {
    let subscriber: any;
    const agent = { subscribe: (value: unknown) => { subscriber = value; return { unsubscribe: vi.fn() }; } } as unknown as AbstractAgent;
    const { result } = renderHook(() => useRunTrace(agent, "thread-a"));
    act(() => subscriber.onRunStartedEvent({ event: { runId: "correlation-1" } }));
    act(() => subscriber.onToolCallStartEvent({ event: { parentMessageId: "orphan" } }));
    act(() => subscriber.onRunStartedEvent({ event: { runId: "correlation-2" } }));
    act(() => subscriber.onCustomEvent({ event: { name: "execution_event", value: { runId: "second-run", emittedAt: "2026-09-07T00:00:01Z", kind: "status", seq: 0, status: "running" } } }));
    expect(result.current.messageRuns).toEqual({});
  });
});
