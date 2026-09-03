/**
 * PROP-CHAT-UIUX-ITER-002 V2 —— `useCopilotKitV2RunProgress` 新增的 `stage` 三桶
 * （`preparing`/`acting`/`replying`），逐个事件钉死转换，反面用例同等重要：
 * `TOOL_CALL_ARGS`（只细化 phaseLabel 文案）不应该把 stage 从 `acting` 推走，
 * `RUN_FINISHED`/`RUN_ERROR` 必须清空 stage（不留着上一轮的阶段继续显示）。
 *
 * 复用 `copilotkit-v2-run-progress.test.tsx` 的假 agent 写法，不重写一份。
 */
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { AbstractAgent } from "@ag-ui/client";
import { useCopilotKitV2RunProgress } from "@/lib/copilotkit-v2-run-progress";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Handlers = Record<string, (params: any) => void>;

function fakeAgent(): { agent: AbstractAgent; handlers: Handlers } {
  const handlers: Handlers = {};
  const agent = {
    subscribe: (h: Handlers) => {
      Object.assign(handlers, h);
      return { unsubscribe: () => {} };
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any as AbstractAgent;
  return { agent, handlers };
}

describe("useCopilotKitV2RunProgress -- stage 三桶（PROP-CHAT-UIUX-ITER-002 V2）", () => {
  it("尚未开始一轮 run 时 stage 为 null", () => {
    const { agent } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, false));
    expect(result.current.stage).toBeNull();
  });

  it("RUN_STARTED → preparing，TOOL_CALL_START → acting，TEXT_MESSAGE_START → replying", () => {
    const { agent, handlers } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));

    act(() => handlers.onRunStartedEvent?.({}));
    expect(result.current.stage).toBe("preparing");

    act(() => handlers.onToolCallStartEvent?.({
      event: { toolCallId: "tc-1", toolCallName: "list_org_skills" },
    }));
    expect(result.current.stage).toBe("acting");

    act(() => handlers.onTextMessageStartEvent?.({}));
    expect(result.current.stage).toBe("replying");
  });

  it("TOOL_CALL_ARGS 只细化 phaseLabel 文案，不把 stage 从 acting 推走", () => {
    const { agent, handlers } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));

    act(() => handlers.onRunStartedEvent?.({}));
    act(() => handlers.onToolCallStartEvent?.({
      event: { toolCallId: "tc-1", toolCallName: "call_skill" },
    }));
    act(() => handlers.onToolCallArgsEvent?.({
      event: { toolCallId: "tc-1", delta: JSON.stringify({ skill_stable_name: "pdf-create" }) },
    }));
    expect(result.current.stage).toBe("acting");
  });

  it("RUN_FINISHED 清空 stage——不留着上一轮的阶段继续显示", () => {
    const { agent, handlers } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));

    act(() => handlers.onRunStartedEvent?.({}));
    act(() => handlers.onToolCallStartEvent?.({
      event: { toolCallId: "tc-1", toolCallName: "list_org_skills" },
    }));
    expect(result.current.stage).toBe("acting");

    act(() => handlers.onRunFinishedEvent?.({}));
    expect(result.current.stage).toBeNull();
  });

  it("RUN_ERROR 同样清空 stage", () => {
    const { agent, handlers } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));

    act(() => handlers.onRunStartedEvent?.({}));
    act(() => handlers.onRunErrorEvent?.({}));
    expect(result.current.stage).toBeNull();
  });
});
