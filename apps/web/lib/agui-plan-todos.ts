"use client";
import * as React from "react";
import { AguiTodosSnapshot } from "@repo/contracts/agui-state-events";
import type { PlanTodo } from "@/components/chat/agent-plan-panel";

/**
 * DA-17（UX-9 Line D3）—— AG-UI `STATE_SNAPSHOT` 事件的前端消费点。
 *
 * ## 它接的是哪根线
 *
 * D2（#1842）已经在 `apps/api/src/interface/controllers/copilotkit-agui.controller.ts`
 * 的 `writeToolCallStep` 里，`write_todos` 步骤成功后额外下发一次
 * `{ type: EventType.STATE_SNAPSHOT, snapshot: { todos: [...] } }`。这个 SSE 事件目前
 * 唯一能被观测到的前端入口是 `@ag-ui/client` 的 `HttpAgent`（`copilotkit-preview-panel.tsx`
 * 用它直连 `/copilotkit/agui`）——生产聊天页（`chat-live-message-panel.tsx`）走的是完全
 * 不同的 `/agent-runs` 轮询+SSE 通道（`agent-run-stream.ts`，`{type:"delta"|"final"}`
 * 帧形状），从不建立 AG-UI 协议连接，所以从不会收到这个事件。这不是本文件的缺陷——
 * 是当前接线范围的如实边界，写在这里而不是让人凭空猜。
 *
 * ## 解析纪律：单一事实源
 *
 * `snapshot` 在 wire 上已经是 `write_todos` 参数被服务端 `parseWriteTodosSnapshot`
 * 校验过一次之后的产物（`packages/contracts/src/agui-state-events.ts`），但 AG-UI 的
 * `StateSnapshotEventSchema.snapshot` 类型是 `unknown`——到前端手上仍然只是「声称是
 * 这个形状的 JSON」，必须原地再校验一次，不能因为「后端说过合法」就跳过。校验用的
 * `AguiTodosSnapshot` zod schema 与后端 `parseWriteTodosSnapshot` 引的是同一个从
 * `@repo/contracts/agui-state-events` 导出的单一定义——不重新写一份形状判断
 * （本仓「同一事实不得声明两处」纪律）。校验失败 → 返回 null，调用方不更新、不编造。
 */

/** `STATE_SNAPSHOT.snapshot` → 已校验的 `PlanTodo[]`，失败返回 null（调用方不更新）。 */
export function deriveTodosFromStateSnapshot(snapshot: unknown): PlanTodo[] | null {
  const result = AguiTodosSnapshot.safeParse(snapshot);
  return result.success ? result.data.todos : null;
}

/**
 * React hook：订阅一次 `HttpAgent.runAgent` 期间到达的 `STATE_SNAPSHOT` 事件，维护
 * 「最后一次校验通过的快照」。`onStateSnapshotEvent` 的签名匹配 `@ag-ui/client` 的
 * `AgentSubscriber["onStateSnapshotEvent"]`（`{ event: { snapshot: unknown } }`），
 * 直接传进 `agent.runAgent(params, { onStateSnapshotEvent, ... })` 即可接线，调用方
 * 不需要自己重新解析事件形状。
 */
export function useAguiPlanTodos(): {
  readonly todos: PlanTodo[] | null;
  readonly onStateSnapshotEvent: (params: { event: { snapshot?: unknown } }) => void;
  readonly reset: () => void;
} {
  const [todos, setTodos] = React.useState<PlanTodo[] | null>(null);

  const onStateSnapshotEvent = React.useCallback((params: { event: { snapshot?: unknown } }) => {
    const parsed = deriveTodosFromStateSnapshot(params.event.snapshot);
    // 解析失败不覆盖已有的合法快照——一次坏帧不应该把已经渲染好的计划清空。
    if (parsed !== null) setTodos(parsed);
  }, []);

  const reset = React.useCallback(() => setTodos(null), []);

  return { todos, onStateSnapshotEvent, reset };
}
