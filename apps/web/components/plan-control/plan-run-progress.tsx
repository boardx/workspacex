"use client";
import * as React from "react";
import { CircleDot, Pause, Play } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

/**
 * F978 —— S5 执行态进度（`ui.md`）。耗时是真实 run 起止差
 * （`getPlanLedger.progress.elapsedMs`），本组件只格式化展示，不用前端计时器估算。
 *
 * 暂停/恢复是**同一个控件的两态**（`run-pause` ↔ `run-resume`），不是两个并存的按钮——
 * `isPaused` 是唯一开关，`data-testid` 随之切换。
 */
export const PLAN_RUN_PROGRESS_TESTID = "chat-task-workbench-run-progress";
export const PLAN_RUN_PAUSE_TESTID = "chat-task-workbench-run-pause";
export const PLAN_RUN_RESUME_TESTID = "chat-task-workbench-run-resume";

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}

export const PLAN_RUN_RECENT_ERROR_TESTID = "chat-task-workbench-run-recent-error";

export interface PlanRunProgressProps {
  readonly currentStepLabel: string;
  readonly stepIndex: number;
  readonly stepTotal: number;
  readonly elapsedMs: number;
  /**
   * issue #3132 —— **已标记完成的步骤数**，与 `stepIndex`（"现在跑到第几步"）不是
   * 同一件事：跑到第 3 步不等于前 2 步都已 `completed`（引擎可能跳步、也可能收尾
   * 时才补标）。判据 TW-P0-3⑤ 要的是"完成比例"，唯一诚实的来源是账本自己数出来的
   * `getPlanLedger.progress.completed`，不是从当前步号推。
   *
   * ⚠ 只经 `data-completed` 暴露，不新增第二段可见文案——可见的 `x/y` 说的是"当前
   * 步/总步"，两句话摆在一起只会让用户以为界面自相矛盾。
   */
  readonly completedCount: number;
  readonly isPaused: boolean;
  readonly isPauseRequested?: boolean;
  readonly onPause?: () => void;
  readonly onResume?: () => void;
  /**
   * issue #2451 —— `RUN_ERROR`（"模型这次没能返回可用结果"横幅）与这块账本轮询
   * 出来的 `phase==="executing"` 是两条独立的异步信号源（`copilotkit-v2-panel.tsx`
   * 的 onError 订阅 vs 3 秒轮询），中间有个窗口两者互相矛盾：错误横幅已经出现，
   * 这里却还显示"执行中 + 可暂停"。为真时禁用暂停/恢复（继续暂停一个已经出错、
   * 服务端状态还没来得及同步过来的 run 没有意义）并给一行诚实的等待提示——
   * 不是新宣称一个"失败"态（那要等 `phase` 真的翻到 `"failed"` 才算数，见
   * `copilotkit-v2-plan-control.tsx`），只是不再让按钮的可交互外观和已知的报错
   * 事实自相矛盾。默认 `false`，向后兼容既有调用方。
   */
  readonly hasRecentError?: boolean;
}

export function PlanRunProgress(
  {
    currentStepLabel, stepIndex, stepTotal, elapsedMs, isPaused, onPause, onResume,
    completedCount, hasRecentError = false, isPauseRequested = false,
  }: PlanRunProgressProps,
): React.JSX.Element {
  return (
    /*
     * issue #3132 —— 三个机器可读属性。此前这张卡只有给人看的文案（"2/3 · 已用 5秒"），
     * 判据 TW-P0-3⑤ 要求的"完成比例 / 耗时可被判定"在 DOM 上**没有任何载体**：
     * `chat-task-workbench-run-progress` 即使渲染出来，`data-completed` / `data-total` /
     * `data-elapsed-ms` 三条断言也必红。属性值与上面那行可见文案同源（`stepTotal` /
     * `elapsedMs` 各只有一个来处），不是第二份事实。
     */
    <Card
      data-testid={PLAN_RUN_PROGRESS_TESTID}
      data-completed={String(completedCount)}
      data-total={String(stepTotal)}
      data-elapsed-ms={String(elapsedMs)}
    >
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex items-center gap-2">
          <CircleDot aria-hidden className="h-4 w-4 text-primary" />
          <span className="text-13">当前步骤：<b>{currentStepLabel}</b></span>
          <span className="text-11 text-muted-foreground">{stepIndex}/{stepTotal} · 已用 {formatElapsed(elapsedMs)}</span>
          {isPaused ? (
            <Button
              size="sm" variant="primary" className="ml-auto" disabled={!onResume || hasRecentError}
              data-testid={PLAN_RUN_RESUME_TESTID} onClick={onResume}
            >
              <Play aria-hidden className="h-3.5 w-3.5" /> 恢复
            </Button>
          ) : (
            <Button
              size="sm" variant="outline" className="ml-auto" disabled={!onPause || hasRecentError || isPauseRequested}
              data-testid={PLAN_RUN_PAUSE_TESTID} onClick={onPause}
            >
              <Pause aria-hidden className="h-3.5 w-3.5" /> {isPauseRequested ? "暂停中…" : "暂停"}
            </Button>
          )}
        </div>
        {hasRecentError && (
          <p role="status" data-testid={PLAN_RUN_RECENT_ERROR_TESTID} className="text-11 text-destructive">
            最近一次调用出错，正在等待执行状态更新……
          </p>
        )}
        <Progress value={stepIndex - 1} max={stepTotal} label={`执行进度 ${stepIndex}/${stepTotal}`} />
      </CardContent>
    </Card>
  );
}
