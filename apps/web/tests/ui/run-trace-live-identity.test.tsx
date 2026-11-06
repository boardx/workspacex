import { act, renderHook } from "@testing-library/react";
import type { AbstractAgent } from "@ag-ui/client";
import { expect, it, vi } from "vitest";
import { useRunTrace } from "@/lib/chat-workbench/use-run-trace";
import { readExecutionPage } from "@/lib/chat-workbench/execution-events-api";
import { AGUI_EXECUTION_EVENT_NAME, type ExecutionEvent } from "@repo/contracts/execution-journal";
vi.mock("@/lib/chat-workbench/execution-events-api", () => ({ readExecutionPage: vi.fn() }));

it("only actual live events establish identity; hydration cannot replace it and run/scope starts clear it", async () => {
  let subscriber: { onRunStartedEvent: () => void; onCustomEvent: (args: { event: { name: string; value: unknown } }) => void };
  const agent = { messages: [], subscribe: (observer: unknown) => {
    subscriber = observer as typeof subscriber; return { unsubscribe: vi.fn() };
  } } as unknown as AbstractAgent;
  const event = (runId: string, status: "running" | "succeeded"): ExecutionEvent => ({ kind: "status", runId,
    status, seq: 1, emittedAt: "2026-11-06T08:00:00Z" });
  vi.mocked(readExecutionPage).mockResolvedValue({ events: [event("historical", "succeeded")], nextSeq: null });
  const { result, rerender } = renderHook(({ thread }) => useRunTrace(agent, thread), { initialProps: { thread: "thread-1" } });
  await act(() => result.current.hydrate([{ id: "old-message", agentRunId: "historical" }]));
  expect(result.current.liveRunId).toBeNull();
  act(() => subscriber.onCustomEvent({ event: { name: AGUI_EXECUTION_EVENT_NAME, value: event("live-1", "running") } }));
  expect(result.current.liveRunId).toBe("live-1");
  await act(() => result.current.hydrate([{ id: "old-message", agentRunId: "historical" }]));
  expect(result.current.liveRunId).toBe("live-1");
  act(() => subscriber.onRunStartedEvent()); expect(result.current.liveRunId).toBeNull();
  // A fast run can first report its genuine terminal event.
  act(() => subscriber.onCustomEvent({ event: { name: AGUI_EXECUTION_EVENT_NAME, value: event("live-2", "succeeded") } }));
  expect(result.current.liveRunId).toBe("live-2");
  rerender({ thread: "thread-2" }); expect(result.current.liveRunId).toBeNull();
});
