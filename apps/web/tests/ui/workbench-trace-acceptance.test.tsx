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
    act(() => subscriber.onToolCallStartEvent({ event: { toolCallId: "tc-1", parentMessageId: "message-1" } }));
    act(() => subscriber.onTextMessageStartEvent({ event: { messageId: "message-2" } }));
    expect(result.current.messageRuns).toEqual({});
    act(() => subscriber.onCustomEvent({ event: { name: "execution_event", value: { runId: "business-run", emittedAt: "2026-09-07T00:00:00Z", kind: "status", seq: 0, status: "running" } } }));
    expect(result.current.messageRuns).toEqual({ "message-1": "business-run", "message-2": "business-run" });
    act(() => subscriber.onToolCallStartEvent({ event: { toolCallId: "tc-2", parentMessageId: "message-3" } }));
    expect(result.current.messageRuns["message-3"]).toBe("business-run");
  });

  /**
   * ⚠ 上面那条用例**手喂**了 `parentMessageId`——本仓服务端从来不发它
   * （`copilotkit-agui.controller.ts` 的 `AguiEvent` 联合里没有这个字段，wire 实测见
   * `apps/web/.copilotkit-v2-tool-rendering/wire-known-limitation-3-evidence.txt`）。
   * 替身说了上游不说的方言，于是「工具调用消息绑不上 run」这个缺陷在单测层全绿、
   * 只在 e2e（DA-19c / 矩阵 D1）上稳定红。
   *
   * 这条用例说 wire 的真实方言：`TOOL_CALL_START` 只有 `toolCallId`。
   * `@ag-ui/client` 0.0.57 在这种形状下新造一条 assistant 消息、**用 `toolCallId` 当它的 id**，
   * 所以要绑的就是 `toolCallId`。改动前本条必红（`messageRuns` 为空）。
   */
  it("binds the synthetic assistant message the client mints when the wire omits parentMessageId", () => {
    let subscriber: any;
    const agent = { subscribe: (value: unknown) => { subscriber = value; return { unsubscribe: vi.fn() }; } } as unknown as AbstractAgent;
    const { result } = renderHook(() => useRunTrace(agent, "thread-a"));
    act(() => subscriber.onRunStartedEvent({ event: { runId: "client-correlation" } }));
    // 工具调用先于第一条 durable execution 事件到达（真实时序，见上一条用例的注释）。
    act(() => subscriber.onToolCallStartEvent({ event: { toolCallId: "tool-call-1" } }));
    expect(result.current.messageRuns).toEqual({});
    act(() => subscriber.onCustomEvent({ event: { name: "execution_event", value: { runId: "business-run", emittedAt: "2026-09-07T00:00:00Z", kind: "status", seq: 0, status: "running" } } }));
    expect(result.current.messageRuns).toEqual({ "tool-call-1": "business-run" });
    // run id 已知之后到达的工具调用同样要绑上。
    act(() => subscriber.onToolCallStartEvent({ event: { toolCallId: "tool-call-2" } }));
    expect(result.current.messageRuns["tool-call-2"]).toBe("business-run");
  });

  it("does not carry messages of an abandoned run into the next one", () => {
    let subscriber: any;
    const agent = { subscribe: (value: unknown) => { subscriber = value; return { unsubscribe: vi.fn() }; } } as unknown as AbstractAgent;
    const { result } = renderHook(() => useRunTrace(agent, "thread-a"));
    act(() => subscriber.onRunStartedEvent({ event: { runId: "correlation-1" } }));
    act(() => subscriber.onToolCallStartEvent({ event: { toolCallId: "orphan-call", parentMessageId: "orphan" } }));
    act(() => subscriber.onRunStartedEvent({ event: { runId: "correlation-2" } }));
    act(() => subscriber.onCustomEvent({ event: { name: "execution_event", value: { runId: "second-run", emittedAt: "2026-09-07T00:00:01Z", kind: "status", seq: 0, status: "running" } } }));
    expect(result.current.messageRuns).toEqual({});
  });
});
