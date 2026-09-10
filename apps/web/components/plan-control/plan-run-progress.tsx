"use client";
import * as React from "react";
import { CircleDot, Pause, Play } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { RunStatusView } from "@repo/contracts/plan-control";

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
export const PLAN_RUN_RECOVERY_TESTID = "chat-task-workbench-run-recovery";

export interface PlanRunProgressProps {
  /**
   * issue #3365 —— **这张卡不再自己推导任何状态量**。状态文字、当前步骤序号、
   * 进度分子/分母、要不要给恢复入口，全部来自契约里的 `deriveRunStatusView`
   * （单一事实源）。改动前这里有两个各自独立的分子：可见文案读 `stepIndex`、
   * 进度条读 `stepIndex - 1`、`data-completed` 又读 `progress.completed`，
   * 于是真实链路上产出过「可见 2/2、机器可读 1/2、条子填 50%」这种自相矛盾。
   *
   * ⚠ 不要在本文件里新增任何从 props 再算一次状态的表达式——那就是把同一事实
   * 声明到第二处。由 `.harness/scripts/lint-run-status-view-single-source.test.ts` 门控。
   */
  readonly view: RunStatusView;
  /**
   * `view.currentStepIndex` 指向的那一步的文本；`view.currentStepIndex === null`
   * 时**必须**是 `null`——「当前步骤」这句话此刻没有真实所指，不许兜底填最后一条
   * （那正是人类截图里「当前步骤 = 已完成的第 2 步」那句假话的来处）。
   */
  readonly currentStepLabel: string | null;
  readonly elapsedMs: number;
  readonly isPaused: boolean;
  readonly isPauseRequested?: boolean;
  readonly onPause?: () => void;
  readonly onResume?: () => void;
  /** issue #3318 —— 暂停入口的开关。为 `false` 时整个按钮不进 DOM。 */
  readonly showPause?: boolean;
  /**
   * issue #3365 —— `view.showRecovery` 为真时这张卡必须给出一个**真的能点**的出口。
   * 「最近一次调用出错，正在等待执行状态更新……」等的是一个在真实链路里可能永远
   * 不会来的更新（见 #3367），只留这句话等于让用户干等。
   */
  readonly onRecover?: () => void;
}

export function PlanRunProgress(
  {
    view, currentStepLabel, elapsedMs, isPaused, onPause, onResume,
    isPauseRequested = false, showPause = true, onRecover,
  }: PlanRunProgressProps,
): React.JSX.Element {
  const stalled = view.activity === "stalled";
  return (
    /*
     * issue #3132 —— 三个机器可读属性（完成比例 / 耗时可被判定）。#3365 起它们与
     * 可见文案、进度条读的是**同一个** `view`，不再是三份各自算出来的量。
     */
    <Card
      data-testid={PLAN_RUN_PROGRESS_TESTID}
      data-completed={String(view.progressValue)}
      data-total={String(view.progressTotal)}
      data-elapsed-ms={String(elapsedMs)}
      data-activity={view.activity}
      data-state-label={view.stateLabel}
    >
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex items-center gap-2">
          <CircleDot aria-hidden className="h-4 w-4 text-primary" />
          {/*
            * issue #3365 —— 没有真实「当前步骤」时如实只说状态，不编一个步骤出来。
            */}
          <span className="text-13">
            {currentStepLabel === null ? <b>{view.stateLabel}</b> : <>当前步骤：<b>{currentStepLabel}</b></>}
          </span>
          <span className="text-11 text-muted-foreground">
            {view.progressValue}/{view.progressTotal} 步已完成 · 已用 {formatElapsed(elapsedMs)}
          </span>
          {isPaused ? (
            <Button
              size="sm" variant="primary" className="ml-auto" disabled={!onResume || stalled}
              data-testid={PLAN_RUN_RESUME_TESTID} onClick={onResume}
            >
              <Play aria-hidden className="h-3.5 w-3.5" /> 恢复
            </Button>
          ) : showPause ? (
            <Button
              size="sm" variant="outline" className="ml-auto" disabled={!onPause || stalled || isPauseRequested}
              data-testid={PLAN_RUN_PAUSE_TESTID} onClick={onPause}
            >
              <Pause aria-hidden className="h-3.5 w-3.5" /> {isPauseRequested ? "暂停中…" : "暂停"}
            </Button>
          ) : null}
        </div>
        {view.showRecovery && (
          <div className="flex items-center gap-2">
            <p role="status" data-testid={PLAN_RUN_RECENT_ERROR_TESTID} className="text-11 text-destructive">
              最近一次调用出错，这轮执行结果未确认。
            </p>
            {onRecover && (
              <Button size="xs" variant="outline" data-testid={PLAN_RUN_RECOVERY_TESTID} onClick={onRecover}>
                重试这轮任务
              </Button>
            )}
          </div>
        )}
        {/* issue #3365 —— 分子只有 `view.progressValue` 一个来处（不变量 I4）。 */}
        <Progress
          value={view.progressValue}
          max={Math.max(1, view.progressTotal)}
          tone={stalled ? "destructive" : "primary"}
          label={`执行进度 ${view.progressValue}/${view.progressTotal}`}
        />
      </CardContent>
    </Card>
  );
}
