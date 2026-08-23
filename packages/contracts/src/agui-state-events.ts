/**
 * AG-UI 状态轴与自定义事件轴的共享 shape（DA-17，UX-9 Line D2）。
 *
 * 架构裁决（coord-architecture，2026-08-23）：DA-13 双栏的小而频 UI 状态走
 * `STATE_DELTA`（RFC 6902 JSON Patch），DA-15 文件事件走 `CUSTOM {name,value}`，
 * **两轴并用，不 fork 协议**。事件的 wire 字段名逐字取自 `@ag-ui/core@0.0.57`
 * 的 zod schema（`StateSnapshotEventSchema.snapshot` / `StateDeltaEventSchema.delta`
 * / `CustomEventSchema.name+value`），与 ag-ui-protocol/ag-ui 的
 * `docs/concepts/events.mdx` 一致——不凭记忆。
 *
 * ## 这里放什么、不放什么
 *   · `JsonPatchOp` —— RFC 6902 六操作的窄类型，`STATE_DELTA.delta` 的元素类型。
 *     协议侧 `delta` 是 `z.array(z.any())`；本仓收窄到六操作是为了让生产者在
 *     编译期就发不出非法 patch，不是改协议。
 *   · `AguiTodosSnapshot` + `parseWriteTodosSnapshot` —— `write_todos` 工具参数
 *     （`toolArgsSummary`）→ `STATE_SNAPSHOT { snapshot: { todos } }` 的**唯一**
 *     解析纪律。它逐条复刻 `apps/web/components/chat/agent-plan-panel.tsx` 的
 *     `derivePlanTodos`：坏 JSON → null；`todos` 非数组或空 → null；任一条目
 *     `content` 非非空字符串或 `status` 不在三态枚举 → 整体 null。**解析失败不发
 *     事件，绝不发编造的**（本仓反空转纪律）。web 侧收敛到本文件是 D1 线的活
 *     （本轮 apps/web 禁区），在此之前本文件即是新增消费方的单一事实源。
 */
import { z } from "zod";

/** RFC 6902 §4 的六种操作。`STATE_DELTA.delta` 的元素类型。 */
export type JsonPatchOp =
  | { readonly op: "add"; readonly path: string; readonly value: unknown }
  | { readonly op: "remove"; readonly path: string }
  | { readonly op: "replace"; readonly path: string; readonly value: unknown }
  | { readonly op: "move"; readonly from: string; readonly path: string }
  | { readonly op: "copy"; readonly from: string; readonly path: string }
  | { readonly op: "test"; readonly path: string; readonly value: unknown };

/** 与 `derivePlanTodos` 的 `VALID_STATUS` 逐字一致的三态。 */
export const AguiPlanTodoStatus = z.enum(["pending", "in_progress", "completed"]);
export type AguiPlanTodoStatus = z.infer<typeof AguiPlanTodoStatus>;

export const AguiPlanTodo = z.object({
  content: z.string().refine((s) => s.trim() !== "", "content 不得为空白"),
  status: AguiPlanTodoStatus,
});
export type AguiPlanTodo = z.infer<typeof AguiPlanTodo>;

/** `STATE_SNAPSHOT.snapshot` 的当前唯一生产形状：`{ todos: [...] }`，非空。 */
export const AguiTodosSnapshot = z.object({
  todos: z.array(AguiPlanTodo).min(1),
});
export type AguiTodosSnapshot = z.infer<typeof AguiTodosSnapshot>;

/**
 * `write_todos` 的 `toolArgsSummary` → 快照，失败返回 `null`（调用方不发事件）。
 *
 * `toolArgsSummary` 对 write_todos 有 4000 字符截断特判（deep-agent-model-provider
 * 的 DA-06 注释）——超长参数会被截成非法 JSON，这正是「坏 JSON → null」在生产上
 * 真实存在的路径，不是假想防御。
 */
export function parseWriteTodosSnapshot(toolArgsSummary: string): AguiTodosSnapshot | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(toolArgsSummary);
  } catch {
    return null;
  }
  const result = AguiTodosSnapshot.safeParse(parsed);
  return result.success ? result.data : null;
}
