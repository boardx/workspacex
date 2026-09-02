/**
 * 2026-09-02（人类：处理过程要明晰）—— `useCopilotKitV2RunProgress` 新增的逐步时间线
 * `steps`。用一个假 agent 手动派发 AG-UI 事件，钉住：RUN_STARTED 起一步「准备」；
 * TOOL_CALL_START 结束上一步、起一步工具；`call_skill` 的参数到达后把该步文案加细；
 * TOOL_CALL_RESULT 只结束对应那一步；TEXT_MESSAGE_START 起「回复」；RUN_FINISHED 清空。
 * 每一步都是真实事件的投影——没有事件就没有步骤。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { AbstractAgent } from "@ag-ui/client";
import { useCopilotKitV2RunProgress, REPLYING_PHASE_LABEL } from "@/lib/copilotkit-v2-run-progress";

type Subscriber = Record<string, (arg: { event: Record<string, unknown> }) => void>;

function fakeAgent(): { agent: AbstractAgent; emit: (name: string, event?: Record<string, unknown>) => void } {
  let subscriber: Subscriber = {};
  const agent = {
    subscribe: (s: Subscriber) => { subscriber = s; return { unsubscribe: () => { subscriber = {}; } }; },
  } as unknown as AbstractAgent;
  return { agent, emit: (name, event = {}) => { subscriber[name]?.({ event }); } };
}

describe("useCopilotKitV2RunProgress · steps 时间线", () => {
  it("准备 → 工具（参数加细）→ 结果结束该步 → 回复 → RUN_FINISHED 清空", () => {
    const { agent, emit } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));
    expect(result.current.steps).toEqual([]);

    act(() => emit("onRunStartedEvent"));
    expect(result.current.steps.map((s) => s.kind)).toEqual(["prepare"]);
    expect(result.current.steps[0]!.endedAt).toBeNull();

    act(() => emit("onToolCallStartEvent", { toolCallId: "t1", toolCallName: "call_skill" }));
    expect(result.current.steps.map((s) => s.kind)).toEqual(["prepare", "tool"]);
    expect(result.current.steps[0]!.endedAt).not.toBeNull();
    expect(result.current.steps[1]!.endedAt).toBeNull();

    act(() => emit("onToolCallArgsEvent", { toolCallId: "t1", delta: JSON.stringify({ skill_stable_name: "pdf-create", task: "x" }) }));
    expect(result.current.steps[1]!.label).toContain("pdf-create");
    expect(result.current.phaseLabel).toContain("pdf-create");

    act(() => emit("onToolCallStartEvent", { toolCallId: "t2", toolCallName: "web_search" }));
    expect(result.current.steps).toHaveLength(3);
    expect(result.current.steps[1]!.endedAt).not.toBeNull();

    act(() => emit("onToolCallResultEvent", { toolCallId: "t2" }));
    expect(result.current.steps[2]!.endedAt).not.toBeNull();

    act(() => emit("onTextMessageStartEvent"));
    const reply = result.current.steps.at(-1)!;
    expect(reply.kind).toBe("reply");
    expect(reply.label).toBe(REPLYING_PHASE_LABEL);
    // 同一轮多条 TEXT_MESSAGE_START 不重复起「回复」步。
    act(() => emit("onTextMessageStartEvent"));
    expect(result.current.steps.filter((s) => s.kind === "reply")).toHaveLength(1);

    act(() => emit("onRunFinishedEvent"));
    expect(result.current.steps).toEqual([]);
    expect(result.current.stage).toBeNull();
  });

  it("isRunning=false 时不报告任何步骤（与阶段/计时同一条纪律）", () => {
    const { agent, emit } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, false));
    act(() => emit("onRunStartedEvent"));
    act(() => emit("onToolCallStartEvent", { toolCallId: "t1", toolCallName: "web_search" }));
    expect(result.current.steps).toEqual([]);
  });
});
