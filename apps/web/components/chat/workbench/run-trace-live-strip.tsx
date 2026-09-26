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
  /*
   * 2026-09-24（评测集 E2）—— **静默窗口里也要有随时间变化的事实**。
   *
   * 实测：慢剧本（模拟模型思考 12 秒）期间，执行过程一行都没有，于是下面的
   * `runningEntry` 与 `lastSettled` 双双为空，这一行退化成一句恒定的「正在推进任务」。
   * 整轮 90 秒采样只读到**一种**文案——用户看到的就是一个会转的圈加一句不变的话，
   * 与「卡死了」在屏幕上长得一模一样。人类最早那张「深度研究 5:20 一屏白」的截图
   * 就是这个场景。
   *
   * 2026-09-24（E3）连带改掉那句「正在推进任务」：一条工具都还没收尾时，我们**确切知道**
   * 此刻在等什么——在等模型返回。说「正在推进任务」是一句放之四海皆准、因而什么也没说的话；
   * 说「正在等待模型返回」才是这一刻的事实，用户据此能判断「是模型慢，不是界面卡了」。
   *
   * 「已等待 N 秒」是**真事实**（我们确实知道等了多久），不是伪造的进度百分比——
   * 后者才是这个文件头注一直在拒绝的那种「界面从未验证过的谎言」。
   */
  const [elapsedSec, setElapsedSec] = React.useState(0);
  const startedAt = React.useRef<number | null>(null);
  React.useEffect(() => {
    if (!active) { startedAt.current = null; setElapsedSec(0); return undefined; }
    startedAt.current ??= Date.now();
    const tick = (): void => {
      setElapsedSec(Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000));
    };
    tick();
    const timer = setInterval(tick, 1_000);
    return () => { clearInterval(timer); };
  }, [active]);

  if (!active) return null;
  const runningEntry = entries.find((entry) => entry.status === "running");
  const completed = entries.filter((entry) => entry.status === "succeeded" || entry.status === "failed").length;
  /*
   * 2026-09-22 —— 没有在飞的工具时，说**刚做完的那一步**，而不是一句恒定的「正在推进任务」。
   *
   * 人类实测截图里这一行是「正在推进任务 · 已完成 17 步」：17 步都做完了、`runningEntry`
   * 却是 `undefined`，于是最有信息量的那一段退化成一个常量。这不是偶发——本地模型两次工具
   * 之间要思考几十秒，**「什么都没在飞」才是常态**，所以那句常量是用户大部分时间看到的东西。
   *
   * 「刚完成 X」与「正在做 X」都取自同一份日志事实（entry.status），只是取最后一条已收尾的
   * 而不是唯一一条在跑的；`completed` 会继续增长，活性仍然可判。
   */
  const lastSettled = [...entries].reverse().find((entry) => entry.status === "succeeded" || entry.status === "failed");
  return <span
    data-testid="run-trace-live-strip"
    data-has-detail={runningEntry === undefined ? "false" : "true"}
    data-completed={String(completed)}
    className="flex min-w-0 items-center"
  >
    <span data-testid="run-trace-live-label" className="truncate">
      {runningEntry !== undefined
        ? liveLabel(runningEntry)
        : lastSettled === undefined ? "正在等待模型返回" : settledLabel(lastSettled)}
      {completed > 0 ? ` · 已完成 ${String(completed)} 个动作` : ""}
      {elapsedSec >= 3 ? ` · 已等待 ${String(elapsedSec)} 秒` : ""}
    </span>
  </span>;
}

/**
 * 刚收尾的那一步。用「刚完成 / 刚失败」而不是「正在」——它说的是过去式，不能借活性文案
 * 的位置假装有东西在跑。
 */
function settledLabel(entry: TraceEntry): string {
  const what = entry.kind === "skill" ? `技能 · ${entry.text}` : actionName(entry.text);
  return entry.status === "failed" ? `刚失败：${what}` : `刚完成：${what}`;
}

/** 与折叠行同一套动作措辞，但只说**此刻**在做什么——不带「有失败步骤」这种恒在的后缀。 */
function liveLabel(entry: TraceEntry): string {
  if (entry.activityStage) return "正在执行技能";
  if (entry.kind === "skill") return `正在调用技能 · ${entry.text}`;
  return `正在${actionName(entry.text)}`;
}

/** 动作措辞的单一事实源：`liveLabel`（进行中）与 `settledLabel`（已收尾）共用。 */
function actionName(tool: string): string {
  return tool === "search_documents" ? "检索资料"
    : tool === "spawn_async_task" ? "派发后台任务"
    : tool === "write_todos" ? "更新执行计划"
    : tool === "run_script" ? "执行生成脚本"
    : "执行工具操作";
}
