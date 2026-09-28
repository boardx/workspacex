/**
 * 从执行过程里把**计划**读出来。
 *
 * ## 为什么需要它（2026-09-24，评测集 E3）
 *
 * 评测集第 ② 项（「可见的规划步骤」）实测 0.3 分：多步剧本里 `write_todos` 明明发了
 * 一份三步计划，界面上**默认看不到、展开右栏也看不到**。
 *
 * 查下来不是数据没到：那份计划就在 `write_todos` 这次工具调用的 `args.todos` 里，
 * 已经在浏览器手上了。真正的缺口是**没有任何东西把它渲染成计划**——
 * v2 这条路径的计划面板吃的是 AG-UI `STATE_SNAPSHOT` 或计划账本，
 * 而 deep-agent provider 这条链两样都不走，于是 `planTodos` 恒为 null。
 *
 * 所以这里只做一件事：把已经在手的事实解析出来，交给**既有的** `AgentPlanPanel` 渲染。
 * 不新画一套计划视图——那个组件的头注已经写明「渲染只有这一份」。
 *
 * ⚠ 形状锚点是真实 deepagents 的 `TodoListMiddleware`：`args.todos` 是
 * `{content, status}` 数组，status ∈ pending | in_progress | completed。
 * 认不出的形状一律返回 null（不猜、不编一个空计划出来占位）。
 */

import type { PlanTodo } from "@/components/chat/agent-plan-panel";
import type { TraceEntry } from "@/lib/chat-workbench/run-trace";

const TODO_TOOL = "write_todos";
const STATUSES = new Set(["pending", "in_progress", "completed"]);

/**
 * 取**最后一次** `write_todos` 的计划。
 *
 * 取最后一次而不是第一次：同一条 run 里 `write_todos` 会被多次调用来推进状态
 * （第一次宣布三步、后面几次把某一步标成 in_progress/completed）。
 * 用户要看的是「现在的计划长什么样」，不是它最初的样子。
 */
export function planFromTrace(entries: readonly TraceEntry[]): PlanTodo[] | null {
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const entry = entries[i];
    if (entry === undefined || entry.text !== TODO_TOOL) continue;
    const todos = parseTodos(entry.args);
    if (todos !== null) return todos;
  }
  return null;
}

function parseTodos(args: unknown): PlanTodo[] | null {
  if (args === null || typeof args !== "object") return null;
  const raw = (args as { todos?: unknown }).todos;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: PlanTodo[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object") return null;
    const { content, status } = item as { content?: unknown; status?: unknown };
    if (typeof content !== "string" || content.trim() === "") return null;
    if (typeof status !== "string" || !STATUSES.has(status)) return null;
    out.push({ content: content.trim(), status: status as PlanTodo["status"] });
  }
  return out;
}

/** 一步计划下面做过的一个动作——右栏「进度」页签按步展开时用。 */
export interface PlanStepAction {
  readonly id: string;
  readonly kind: "tool" | "skill";
  readonly tool: string;
  readonly args?: unknown;
  readonly status: TraceEntry["status"];
}

/**
 * 2026-09-27 人类裁决「计划显示统一按你的方案做」—— 三处计划各司其职：
 * 消息流里是本轮结束后的计划快照、底部是实时计划与控制、右栏是**每一步的细节**。
 *
 * 右栏要的细节就是「这一步里具体做了哪些动作」。执行过程是一条按时间排好的流水，
 * 计划推进也在这条流水里（每次 `write_todos` 把某一步标成 in_progress），所以不用猜：
 * 一个动作归属于**它发生时正处于 in_progress 的那一步**。第一次有步骤进入
 * in_progress 之前的动作（理解目标、读技能说明……）不归任何一步，不编一个归属。
 *
 * 键是步骤文本（trim 后）——账本步骤与 `write_todos` 快照是同一份文本，右栏按文本对上。
 */
export function actionsByPlanStep(entries: readonly TraceEntry[]): ReadonlyMap<string, readonly PlanStepAction[]> {
  const out = new Map<string, PlanStepAction[]>();
  let current: string | null = null;
  for (const entry of entries) {
    if (entry.text === TODO_TOOL) {
      const todos = parseTodos(entry.args);
      if (todos !== null) current = todos.find((todo) => todo.status === "in_progress")?.content ?? null;
      continue;
    }
    if ((entry.kind !== "tool" && entry.kind !== "skill") || current === null) continue;
    const list = out.get(current) ?? [];
    list.push({ id: entry.id, kind: entry.kind, tool: entry.text, args: entry.args, status: entry.status });
    out.set(current, list);
  }
  return out;
}
