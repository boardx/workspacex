"use client";
import * as React from "react";
import { CheckCircle2, Circle, CircleDot } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentRunView } from "@/lib/agent-run";

/**
 * agent-plan-panel（DA-06，#1749，rubric D1「规划可见性」的前端半边）—— 活体生产组件。
 *
 * ## 数据从哪来（没有新接口、没有新状态通道）
 *
 * deepagents 0.7 的 `TodoListMiddleware`（DA-02 挂上）让引擎在多步任务里调用
 * `write_todos` 工具维护结构化计划。那个调用与其他工具一样经 `completeWithProgress`
 * 的 onProgress → `record()` 落进 `agent_run_steps` 账本（#742：没有留痕就没有调用），
 * 于是它就在 `runObservation.view.steps` 里——本组件只是从 steps 中找**最后一次**
 * `write_todos` 调用，`JSON.parse` 它的 `toolArgsSummary`（后端对 write_todos 特判
 * 4000 字符上限，保证是完整合法 JSON——见 deep-agent-model-provider.ts 的注释），
 * 渲染成规划条。「最后一次」即当前计划的最新快照：引擎每次更新计划都是一次新的
 * write_todos 全量调用（deepagents 的语义），不需要在前端做增量合并。
 *
 * ## 解析失败 = 不渲染，绝不编占位
 *
 * 老 run（截断时代写入的）、非 JSON、形状不符——一律返回 null 静默不渲染。
 * 用占位文案顶替会把「解析不了」伪装成「没有计划」，那是两回事；且本组件是
 * 纯展示叠加层，它的缺席不影响任何既有功能（与 streamingText 的纪律同一条）。
 *
 * ## 样式语言对齐 agent-tool-chain
 *
 * 同一张卡片式（rounded-md border bg-card）、同一 11px 字号——规划条与工具链
 * 在消息流里是同一层级的「过程可见性」信息，不引入风格孤岛（fidelity rubric）。
 *
 * ## `stateSnapshotTodos`（DA-17，UX-9 Line D3）—— 第二条真实数据路径，不冲突
 *
 * D2（#1842）让后端在 `write_todos` 成功后于 AG-UI SSE 上额外发一次
 * `STATE_SNAPSHOT { snapshot: { todos } }`（`copilotkit-agui.controller.ts`）——这是
 * **服务端已确认的状态快照**，比本组件从 `toolArgsSummary` 反解字符串更权威（少一次
 * 客户端 JSON.parse）。消费方（`apps/web/lib/agui-plan-todos.ts` 的
 * `useAguiPlanTodos` hook）把它按 `@repo/contracts/agui-state-events` 的单一解析纪律
 * 校验好之后，通过这个 prop 传进来。**非 null 时优先于 `derivePlanTodos(steps)`**——
 * 但 `steps` 派生路径不删：STATE_SNAPSHOT 事件到达前（或消费方根本没接 AG-UI 事件流，
 * 比如仍在用 `/agent-runs` 轮询的生产聊天页）仍要有得看，两条路径是「更权威的一旦到达
 * 就顶上，没到达就用现成的」，不是二选一。
 */

type Step = AgentRunView["steps"][number];

export interface PlanTodo {
  readonly content: string;
  readonly status: "pending" | "in_progress" | "completed";
}

const VALID_STATUS = new Set(["pending", "in_progress", "completed"]);

/** steps → 当前计划快照。解析失败返回 null（调用方不渲染）。导出供测试反证。 */
export function derivePlanTodos(steps: readonly Step[]): PlanTodo[] | null {
  const last = [...steps].reverse().find(
    (s) => s.kind === "tool_call" && s.toolName === "write_todos" && s.toolArgsSummary !== null,
  );
  if (!last || last.toolArgsSummary === null) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(last.toolArgsSummary);
  } catch {
    return null;
  }
  const todos = (parsed as { todos?: unknown }).todos;
  if (!Array.isArray(todos) || todos.length === 0) return null;
  const out: PlanTodo[] = [];
  for (const item of todos) {
    const content = (item as { content?: unknown }).content;
    const status = (item as { status?: unknown }).status;
    if (typeof content !== "string" || content.trim() === "") return null;
    if (typeof status !== "string" || !VALID_STATUS.has(status)) return null;
    out.push({ content, status: status as PlanTodo["status"] });
  }
  return out;
}

function StatusIcon({ status }: { status: PlanTodo["status"] }) {
  if (status === "completed") return <CheckCircle2 aria-hidden className="h-3.5 w-3.5 shrink-0 text-success" />;
  if (status === "in_progress") return <CircleDot aria-hidden className="h-3.5 w-3.5 shrink-0 text-primary" />;
  return <Circle aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
}

export function AgentPlanPanel({
  steps,
  stateSnapshotTodos = null,
}: {
  steps: readonly Step[];
  /** DA-17／Line D3 -- STATE_SNAPSHOT 已解析好的 todos，非 null 时优先于 `steps` 派生。
   *  null（默认）= 尚未收到快照（或该消费方压根没接 AG-UI 事件流），退回旧路径。 */
  stateSnapshotTodos?: PlanTodo[] | null;
}) {
  const todos = stateSnapshotTodos ?? derivePlanTodos(steps);
  if (todos === null) return null;
  const done = todos.filter((t) => t.status === "completed").length;
  return (
    <div
      className="rounded-md border border-border-subtle bg-card px-2.5 py-1.5"
      data-testid="agent-plan-panel"
      data-plan-total={todos.length}
      data-plan-done={done}
    >
      <div className="mb-1 text-11 font-medium text-muted-foreground">
        计划 {done}/{todos.length}
      </div>
      <ol className="space-y-0.5">
        {todos.map((todo, i) => (
          <li
            key={`${i}-${todo.content}`}
            className="flex items-center gap-2 text-11"
            data-testid={`agent-plan-item-${i}`}
            data-plan-status={todo.status}
          >
            <StatusIcon status={todo.status} />
            <span
              className={cn(
                "min-w-0 flex-1 truncate",
                todo.status === "completed" && "text-muted-foreground line-through",
              )}
            >
              {todo.content}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}
