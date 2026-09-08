/**
 * issue #3063 反证 —— 阶段文案不再把 skill 的**身份**字段直接给人看。
 *
 * #3058 把 `stable_name` 收回为合规 slug（契约 `StableName` 容不下下划线/非 ASCII，
 * 中文展示名 ⇒ `skill-<8 位 hex>`）。于是 G2（2026-09-07）「用户看到一串没意义的
 * 字符」的问题换了个形状回来：用户看到的是 `正在执行技能脚本（skill-9f3a1b7c）…`。
 *
 * 这里用一条**真实形状**的 journal 事件（`tool_start` + run 侧解析出的
 * `skillDisplayName`）跑通链路：CUSTOM `execution_event` 先到（`execution-journal-relay.ts`
 * 的 `accept` 就是这个顺序），随后同一个 `toolCallId` 的 TOOL_CALL_ARGS 决定文案。
 * 断言两条：中文名出现、`skill-9f3a1b7c` 不出现。撤掉修复（`phaseLabelForCallSkillArgs`
 * 不看展示名 / hook 不记 `skillDisplayName`）本文件立刻红。
 */
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { AbstractAgent } from "@ag-ui/client";
import { AGUI_EXECUTION_EVENT_NAME } from "@repo/contracts/execution-journal";
import { useCopilotKitV2RunProgress } from "@/lib/copilotkit-v2-run-progress";
import { phaseLabelForCallSkillArgs } from "@/lib/agent-run-phase";

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

const STABLE_NAME = "skill-9f3a1b7c";
const DISPLAY_NAME = "会议纪要整理";
const TOOL_CALL_ID = "r:1:call-1";

function toolStartEvent(overrides: Record<string, unknown> = {}) {
  return {
    name: AGUI_EXECUTION_EVENT_NAME,
    value: {
      kind: "tool_start", runId: "run-1", seq: 3, emittedAt: "2026-09-08T00:00:00.000Z",
      attemptId: "r:1", toolCallId: TOOL_CALL_ID, toolName: "call_skill",
      args: JSON.stringify({ skill_stable_name: STABLE_NAME, task: "整理会议纪要" }),
      skillDisplayName: DISPLAY_NAME,
      ...overrides,
    },
  };
}

describe("#3063 阶段文案显示 skill 展示名，不回显合规 slug 身份", () => {
  it("journal 带 skillDisplayName ⇒ 文案是中文展示名，且不含 skill-9f3a1b7c", () => {
    const { agent, handlers } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));

    act(() => handlers.onRunStartedEvent?.({}));
    act(() => handlers.onCustomEvent?.({ event: toolStartEvent() }));
    act(() => handlers.onToolCallStartEvent?.({
      event: { toolCallId: TOOL_CALL_ID, toolCallName: "call_skill" },
    }));
    act(() => handlers.onToolCallArgsEvent?.({
      event: { toolCallId: TOOL_CALL_ID, delta: JSON.stringify({ skill_stable_name: STABLE_NAME, task: "整理会议纪要" }) },
    }));

    expect(result.current.phaseLabel).toBe(`正在执行技能脚本（${DISPLAY_NAME}）…`);
    expect(result.current.phaseLabel).not.toContain(STABLE_NAME);
  });

  it("journal 没带展示名（老事件 / 没挂上）⇒ 逐字退回原来的 stable_name 回显", () => {
    const { agent, handlers } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));

    act(() => handlers.onRunStartedEvent?.({}));
    act(() => handlers.onCustomEvent?.({ event: toolStartEvent({ skillDisplayName: undefined }) }));
    act(() => handlers.onToolCallStartEvent?.({
      event: { toolCallId: TOOL_CALL_ID, toolCallName: "call_skill" },
    }));
    act(() => handlers.onToolCallArgsEvent?.({
      event: { toolCallId: TOOL_CALL_ID, delta: JSON.stringify({ skill_stable_name: STABLE_NAME }) },
    }));

    expect(result.current.phaseLabel).toBe(`正在执行技能脚本（${STABLE_NAME}）…`);
  });

  it("上一跳的展示名不会串到下一轮 run（RUN_STARTED 清账）", () => {
    const { agent, handlers } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));

    act(() => handlers.onRunStartedEvent?.({}));
    act(() => handlers.onCustomEvent?.({ event: toolStartEvent() }));
    act(() => handlers.onRunFinishedEvent?.({}));

    act(() => handlers.onRunStartedEvent?.({}));
    act(() => handlers.onToolCallStartEvent?.({
      event: { toolCallId: TOOL_CALL_ID, toolCallName: "call_skill" },
    }));
    act(() => handlers.onToolCallArgsEvent?.({
      event: { toolCallId: TOOL_CALL_ID, delta: JSON.stringify({ skill_stable_name: STABLE_NAME }) },
    }));

    expect(result.current.phaseLabel).toBe(`正在执行技能脚本（${STABLE_NAME}）…`);
  });

  it("纯函数层：展示名为空白 ⇒ 不当成名字用，仍回显 stable_name", () => {
    expect(phaseLabelForCallSkillArgs(STABLE_NAME, "   ")).toBe(`正在执行技能脚本（${STABLE_NAME}）…`);
    expect(phaseLabelForCallSkillArgs(STABLE_NAME, null)).toBe(`正在执行技能脚本（${STABLE_NAME}）…`);
    expect(phaseLabelForCallSkillArgs(STABLE_NAME, DISPLAY_NAME)).toBe(`正在执行技能脚本（${DISPLAY_NAME}）…`);
  });
});
