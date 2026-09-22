import type { ExecutionEventInput } from "@repo/contracts/execution-journal";

/** 已开、未闭的一次工具调用：预先算好的那条 `tool_end`，只差一个 `result`。 */
type PendingToolEnd = ExecutionEventInput & { kind: "tool_end" };

/** run 终止的方式。三条路径都要补终态，只是那句话不同。 */
export type RunTerminationOutcome = "failed" | "cancelled" | "paused";

const OUTCOME_TEXT: Record<RunTerminationOutcome, string> = {
  failed: "失败", cancelled: "取消", paused: "暂停",
};

/**
 * issue #3403 ② —— 让**每一次开始了的工具调用都有终态**。
 *
 * ## 为什么这件事必须在产生端做
 *
 * 一次工具调用在执行账本里只有 `tool_start` / `tool_end` 两个时刻，而 `tool_end`
 * **只在模型真的交回 ToolMessage 时**才写得出来（`execute-run.ts` 的进展回调是
 * `AIMessage.tool_calls` 与 `ToolMessage` 的配对结果）。于是只要这一轮在某个工具还没
 * 回来时终止——failed / cancelled / paused 都算——那条调用就**永远停在 `tool_start`**。
 * 前端 `traceEntries`（`apps/web/lib/chat-workbench/run-trace.ts`）只认 `tool_end` 才会
 * 把一行从 `running` 翻成终态，所以它渲染出来就是「正在执行 · execute ↻」，而同一屏上
 * 横幅已经写着「执行失败」。人类 2026-09-11 实测到的就是这一幕。
 *
 * ⚠ **展示层补不了，也已经试过两次**：#3316 收敛的是折叠行 spinner 的**活性**（`active`
 * 为假时图标不再转），#3369 收敛的是**计划面板**的状态派生。两者都没碰工具卡自己的终态，
 * 因为那条终态**从来没有被产生过**——而且它同样落进持久账本，刷新后照旧卡住。
 *
 * ## 不伪造结果
 *
 * 补出来的 `result` 是**系统自己写的一句话**（同 `tool_progress` 那条隐私纪律），说的是
 * 「本轮已终止，没有收到这次调用的结果」——不是宣称这个工具失败在哪一步，那是我们不知道的事。
 */
/**
 * 2026-09-22 —— 「这次调用开了很久还没回来」的**展示**通道。
 *
 * 位置在这里而不是 `execute-run.ts`：开与闭的**唯一**两个时刻本来就在这个类里，
 * 计时器挂在别处就等于把同一个生命周期声明到第二处（本仓头号病）。
 *
 * ⚠ 三条纪律：
 *   · 只写 `tool_progress`（有损展示通道），**不改任何终态判定**，不取消那次调用；
 *   · 写失败只吞掉——一条展示信息写不出去不该把一次正在正常推进的 run 弄失败；
 *   · 缺席（`undefined`）⇒ 一个计时器都不创建，行为与本次改动之前逐字节相同。
 */
export interface ToolStallWatch {
  /** 开了这么久还没回来就说第一句。 */
  readonly afterMs: number;
  /** 之后每隔这么久再说一句（避免一条长任务只在第一分钟有反馈）。 */
  readonly repeatEveryMs: number;
  readonly notify: (notice: {
    readonly toolCallId: string;
    readonly sourceToolCallId?: string;
    readonly toolName: string;
    readonly elapsedMs: number;
  }) => Promise<void>;
}

export class OpenToolCalls {
  private readonly pending = new Map<string, PendingToolEnd>();
  private readonly timers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly stall?: ToolStallWatch) {}

  /** 这一轮终止时还没回来的工具名；`undefined` = 全都回来了。#3403 ④ 的结构判据。 */
  get unresolvedToolName(): string | undefined {
    return [...this.pending.values()][0]?.toolName;
  }

  open(toolCallId: string, toolEnd: PendingToolEnd): void {
    this.pending.set(toolCallId, toolEnd);
    this.armStallTimer(toolCallId, toolEnd, Date.now(), this.stall?.afterMs ?? 0);
  }

  close(toolCallId: string): void {
    this.pending.delete(toolCallId);
    this.clearStallTimer(toolCallId);
  }

  /** 每次只挂**一个**计时器，响过之后再挂下一个——不用 setInterval：它在 run 结束后
   *  还会继续响，而这个类不保证 `close` 一定被调用（`closeAll` 才是终点）。 */
  private armStallTimer(toolCallId: string, toolEnd: PendingToolEnd, openedAt: number, delay: number): void {
    const stall = this.stall;
    if (stall === undefined) return;
    const timer = setTimeout(() => {
      this.timers.delete(toolCallId);
      // 已经闭掉了（竞态：计时器排队期间 tool_end 到了）⇒ 什么都不说
      if (!this.pending.has(toolCallId)) return;
      void (async () => {
        try {
          await stall.notify({
            toolCallId, sourceToolCallId: toolEnd.sourceToolCallId,
            toolName: toolEnd.toolName, elapsedMs: Date.now() - openedAt,
          });
        } catch { /* 展示通道：写不出去就算了，见类头注 */ }
        if (this.pending.has(toolCallId)) this.armStallTimer(toolCallId, toolEnd, openedAt, stall.repeatEveryMs);
      })();
    }, delay);
    // 一条挂着的展示计时器不该让进程活下去
    timer.unref?.();
    this.timers.set(toolCallId, timer);
  }

  private clearStallTimer(toolCallId: string): void {
    const timer = this.timers.get(toolCallId);
    if (timer !== undefined) { clearTimeout(timer); this.timers.delete(toolCallId); }
  }

  /** 给所有还没回来的调用补一条 `tool_end{ok:false}`。补终态是尽力而为——写不进去也不能
   *  把一条已经在收尾的 run 再翻成另一种失败，所以逐条吞异常并只记一行日志。 */
  async closeAll(
    outcome: RunTerminationOutcome,
    append: (event: ExecutionEventInput) => Promise<void>,
    onWriteFailure: (toolCallId: string) => void,
  ): Promise<void> {
    const events = [...this.pending.values()];
    this.pending.clear();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    for (const event of events) {
      try {
        await append({ ...event, result: `本轮执行已${OUTCOME_TEXT[outcome]}终止，没有收到这次工具调用的结果。` });
      } catch { onWriteFailure(event.toolCallId); }
    }
  }
}
