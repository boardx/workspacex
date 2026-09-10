"use client";
import * as React from "react";
import type { TraceEntry } from "@/lib/chat-workbench/run-trace";

/**
 * issue #3320 —— 「工具失败之后界面失去前进感，用户以为死机」的活性文案。
 *
 * ## 缺陷机制（实测判定，三选一里的 (b)）
 *
 * 人类在 devapp 上看到 `执行工具操作失败`（`edit_file` → String not found）之后界面就"停住"了，
 * 但系统其实还在跑——后面还有「已执行工具操作 ✓」和 `execute · 进行中`。issue 要求先分开取证
 * 三种机制，结论是：
 *
 * - **(a) 后续条目根本没渲染 —— 不成立。** `run-trace-panel.tsx` 的 `rows.map` 是一次完整遍历，
 *   没有 `slice`、没有 `findIndex(failed)`、没有按状态过滤、没有提前 `return`；
 *   `lib/chat-workbench/run-trace.ts` 的 `traceEntries` 同样全量投影，失败只是把
 *   `entry.status` 写成 `"failed"`，后面的 `tool_start` 照样 `entries.push`。
 * - **(b) 渲染了但默认折叠且无活性信号 —— 成立，这是主机制。** 整块轨迹在
 *   `run-trace-body` 里，而那个区块 `hidden={!expanded}`，`expanded` 默认 `false`
 *   （`task-timeline.tsx` 的 `expanded?.[runId] ?? false`），失败**不会**翻转它。
 *   折叠行标题里唯一与失败有关的信号是 `· 有失败步骤`，它一旦出现就恒在，
 *   **不区分「最新一步就是失败」还是「失败之后又跑了三步」**——于是标题在失败之后基本静止。
 * - **(c) 滚动位置停在失败那条 —— 不是独立成因。** `use-timeline-scroll.ts` 的跟随逻辑里
 *   没有任何「失败后停止」的条件，唯一的停止条件是用户自己滚上去（`isAtBottom === false`）。
 *   但它是 (b) 的**被动后果**：折叠区 `hidden` 不占布局高度，新增条目既不改 `messages`
 *   也不触发 `ResizeObserver`，于是自动滚动什么也不做，页面一帧都不变——这加重了 (b) 的观感。
 *
 * ## 这个组件按人类给的三条验收标准补的是什么
 *
 * ① **失败之后下一个工具的执行必须被可视化，不能要求手动展开** ⇒ 本段挂在折叠区**之外**
 *    （与 #3100 D6 把后台任务面板挪出折叠区是同一个理由），`expanded` 与它无关。
 * ② **必须有动画 loading 表明系统在工作，这是底线，没有细节也必须有** ⇒ `active` 期间
 *    折叠行左侧的蝴蝶（`RunProgressButterfly`，`animate-butterfly-fly`）恒在恒动，
 *    见 `run-trace-panel.tsx` 里那枚图形的挂载条件与门控。
 * ③ **最好有细节** ⇒ 有在飞的工具时显示它的动作名，并始终显示「已完成 N 步」。
 *    「N」会随失败之后的每一次工具收尾而**增大**，这正是「失败之后系统仍在推进」的可判形态：
 *    与恒在的 `· 有失败步骤` 不同，它是会变的。
 *
 * ⚠ **本段渲染在折叠行标题里，不是自己一行**（2026-09-10 人类实测：「工具调用的 2 个消息重复了」）。
 * 它此前是折叠行下面**另起的一条**，于是同一轮 run 的同一件事实被讲了两遍：上一行
 * 「正在执行 · 历时 02:10 · …」带一只在飞的蝴蝶，下一行「正在执行工具操作 · 已完成 3 步」
 * 带一枚在转的 `Loader2`——两句话、两个活性动画、零新增信息。按 AGENTS.md「同一事实不得
 * 声明在两处」收敛成一行：**活性动画只剩蝴蝶那一枚**，此刻在做什么与已完成步数接在标题最前面
 * （最易变的排在最前），后面才是恒定的历时与计数。三条验收标准一条没放宽——①②由折叠行本身
 * 满足（它本来就在折叠区外、本来就带动画），③ 就是这段文案。
 *
 * ⚠ 「此刻在做什么」取自**日志事实**（`tool_start` 无配对 `tool_end` ⇒ entry.status === "running"），
 * 「这轮还活着吗」取自调用方传进来的 `active`（执行账本最后一条 status）——都不取
 * `running` prop。`running` 由 `props.isRunning && !有 final_message` 算出，而 `props.isRunning`
 * 是 CopilotKit 逐条消息的标志：长任务里正文早发完、工具还在跑，它就翻假了。
 * 用它当活性来源正是 #3316 那条「静止的 spinner」的根因。
 */
export function RunTraceLiveStrip({ entries, active }: {
  readonly entries: readonly TraceEntry[];
  /** 这条 run 此刻是否仍在途（由 journal 的 status 事实定，见 `RunTracePanel`）。 */
  readonly active: boolean;
}): JSX.Element | null {
  if (!active) return null;
  const runningEntry = entries.find((entry) => entry.status === "running");
  const completed = entries.filter((entry) => entry.status === "succeeded" || entry.status === "failed").length;
  return <span
    data-testid="run-trace-live-strip"
    data-has-detail={runningEntry === undefined ? "false" : "true"}
    data-completed={String(completed)}
    className="flex min-w-0 items-center"
  >
    <span data-testid="run-trace-live-label" className="truncate">
      {runningEntry === undefined ? "正在推进任务" : liveLabel(runningEntry)}
      {completed > 0 ? ` · 已完成 ${String(completed)} 步` : ""}
    </span>
  </span>;
}

/** 与折叠行同一套动作措辞，但只说**此刻**在做什么——不带「有失败步骤」这种恒在的后缀。 */
function liveLabel(entry: TraceEntry): string {
  if (entry.activityStage) return "正在执行技能";
  if (entry.kind === "skill") return `正在调用技能 · ${entry.text}`;
  const action = entry.text === "search_documents" ? "检索资料"
    : entry.text === "spawn_async_task" ? "派发后台任务"
    : entry.text === "write_todos" ? "更新执行计划"
    : entry.text === "run_script" ? "执行生成脚本"
    : "执行工具操作";
  return `正在${action}`;
}
