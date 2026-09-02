/**
 * issue #2321 round 3 —— `useCopilotKitV2RunProgress` 的阶段文案反证，重点是新加的
 * 「`call_skill` 的 `TOOL_CALL_ARGS` 里带的 `skill_stable_name` 把通用的
 * "正在执行技能脚本…" 细化成"正在执行技能脚本（pdf-create）…"」这一段（见该文件
 * 头注 2021 round 3 那一节）。不重复覆盖已有的耗时/longrun 提示逻辑（那两段行为
 * 本轮未动）。
 *
 * 用一个最小的假 `AbstractAgent`：只实现这个 hook 真正调用的 `.subscribe(handlers)`
 * ——调用方拿到 handlers 后由测试自己按需触发，不起真实 AG-UI 连接。
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

describe("useCopilotKitV2RunProgress -- call_skill 阶段文案细化（issue #2321 round 3）", () => {
  it("call_skill 的 TOOL_CALL_ARGS 带 skill_stable_name → 阶段文案加细成具体技能名", () => {
    const { agent, handlers } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));

    act(() => handlers.onRunStartedEvent?.({}));
    act(() => handlers.onToolCallStartEvent?.({
      event: { toolCallId: "tc-1", toolCallName: "call_skill" },
    }));
    expect(result.current.phaseLabel).toBe("正在执行技能脚本…");

    act(() => handlers.onToolCallArgsEvent?.({
      event: { toolCallId: "tc-1", delta: JSON.stringify({ skill_stable_name: "pdf-create", task: "生成一份 PDF" }) },
    }));
    expect(result.current.phaseLabel).toBe("正在执行技能脚本（pdf-create）…");
  });

  it("非 call_skill 工具的 TOOL_CALL_ARGS 不被误读——阶段文案原地不动", () => {
    const { agent, handlers } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));

    act(() => handlers.onRunStartedEvent?.({}));
    act(() => handlers.onToolCallStartEvent?.({
      event: { toolCallId: "tc-2", toolCallName: "list_org_skills" },
    }));
    expect(result.current.phaseLabel).toBe("正在准备技能…");

    act(() => handlers.onToolCallArgsEvent?.({
      event: { toolCallId: "tc-2", delta: JSON.stringify({ skill_stable_name: "pdf-create" }) },
    }));
    // list_org_skills 不是 call_skill：即便 args 长得像也不套用，保持它自己的通用文案。
    expect(result.current.phaseLabel).toBe("正在准备技能…");
  });

  it("call_skill 的 args 还没流完 / 不是合法 JSON → 不报错，沿用 START 时的通用文案", () => {
    const { agent, handlers } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));

    act(() => handlers.onRunStartedEvent?.({}));
    act(() => handlers.onToolCallStartEvent?.({
      event: { toolCallId: "tc-3", toolCallName: "call_skill" },
    }));
    act(() => handlers.onToolCallArgsEvent?.({
      event: { toolCallId: "tc-3", delta: "{not valid json" },
    }));
    expect(result.current.phaseLabel).toBe("正在执行技能脚本…");
  });

  it("call_skill 的 args 里 skill_stable_name 是空白字符串 → 同样不细化，保留通用文案", () => {
    const { agent, handlers } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));

    act(() => handlers.onRunStartedEvent?.({}));
    act(() => handlers.onToolCallStartEvent?.({
      event: { toolCallId: "tc-4", toolCallName: "call_skill" },
    }));
    act(() => handlers.onToolCallArgsEvent?.({
      event: { toolCallId: "tc-4", delta: JSON.stringify({ skill_stable_name: "  ", task: "x" }) },
    }));
    expect(result.current.phaseLabel).toBe("正在执行技能脚本…");
  });

  it("下一轮 RUN_STARTED 清空上一轮的 toolCallId→name 记忆（不跨轮误配）", () => {
    const { agent, handlers } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));

    act(() => handlers.onRunStartedEvent?.({}));
    act(() => handlers.onToolCallStartEvent?.({
      event: { toolCallId: "tc-reused", toolCallName: "call_skill" },
    }));
    act(() => handlers.onRunFinishedEvent?.({}));

    // 新一轮复用了同一个 toolCallId（AG-UI 不保证跨 run 唯一），但这次它根本不是
    // call_skill——上一轮的记忆如果没清，这里会被误判成 call_skill。
    act(() => handlers.onRunStartedEvent?.({}));
    act(() => handlers.onToolCallStartEvent?.({
      event: { toolCallId: "tc-reused", toolCallName: "list_org_skills" },
    }));
    act(() => handlers.onToolCallArgsEvent?.({
      event: { toolCallId: "tc-reused", delta: JSON.stringify({ skill_stable_name: "pdf-create" }) },
    }));
    expect(result.current.phaseLabel).toBe("正在准备技能…");
  });
});

describe("useCopilotKitV2RunProgress -- 第一个工具调用之前的真实阶段（CUSTOM run_phase，2026-09-02）", () => {
  it("RUN_STARTED 后收到 context_building / model_thinking ⇒ 准备阶段的文案随之变化，stage 仍是 preparing", () => {
    const { agent, handlers } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));

    act(() => handlers.onRunStartedEvent?.({}));
    expect(result.current.phaseLabel).toBe("正在准备…");

    act(() => handlers.onCustomEvent?.({ event: { name: "run_phase", value: { phase: "context_building" } } }));
    expect(result.current.phaseLabel).toBe("正在整理上下文…");
    expect(result.current.stage).toBe("preparing");

    act(() => handlers.onCustomEvent?.({ event: { name: "run_phase", value: { phase: "model_thinking" } } }));
    expect(result.current.phaseLabel).toBe("模型正在思考…");
    expect(result.current.stage).toBe("preparing");
  });

  it("已进入工具阶段后迟到的 run_phase 不把文案倒退回准备阶段", () => {
    const { agent, handlers } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));

    act(() => handlers.onRunStartedEvent?.({}));
    act(() => handlers.onToolCallStartEvent?.({
      event: { toolCallId: "tc-9", toolCallName: "list_org_skills" },
    }));
    act(() => handlers.onCustomEvent?.({ event: { name: "run_phase", value: { phase: "model_thinking" } } }));
    expect(result.current.phaseLabel).toBe("正在准备技能…");
    expect(result.current.stage).toBe("acting");
  });

  it("别的 CUSTOM 事件 / 形状不对的 value 一律忽略", () => {
    const { agent, handlers } = fakeAgent();
    const { result } = renderHook(() => useCopilotKitV2RunProgress(agent, true));

    act(() => handlers.onRunStartedEvent?.({}));
    act(() => handlers.onCustomEvent?.({ event: { name: "chat_thread_id", value: "thr-1" } }));
    act(() => handlers.onCustomEvent?.({ event: { name: "run_phase", value: { phase: "nonsense" } } }));
    expect(result.current.phaseLabel).toBe("正在准备…");
  });
});
