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

export interface PlanRunProgressProps {
  readonly currentStepLabel: string;
  readonly stepIndex: number;
  readonly stepTotal: number;
  readonly elapsedMs: number;
  readonly isPaused: boolean;
  readonly onPause?: () => void;
  readonly onResume?: () => void;
}

export function PlanRunProgress(
  { currentStepLabel, stepIndex, stepTotal, elapsedMs, isPaused, onPause, onResume }: PlanRunProgressProps,
): React.JSX.Element {
  return (
    <Card data-testid={PLAN_RUN_PROGRESS_TESTID}>
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex items-center gap-2">
          <CircleDot aria-hidden className="h-4 w-4 text-primary" />
          <span className="text-13">当前步骤：<b>{currentStepLabel}</b></span>
          <span className="text-11 text-muted-foreground">{stepIndex}/{stepTotal} · 已用 {formatElapsed(elapsedMs)}</span>
          {isPaused ? (
            <Button size="sm" variant="primary" className="ml-auto" data-testid={PLAN_RUN_RESUME_TESTID} onClick={onResume}>
              <Play aria-hidden className="h-3.5 w-3.5" /> 恢复
            </Button>
          ) : (
            <Button size="sm" variant="outline" className="ml-auto" data-testid={PLAN_RUN_PAUSE_TESTID} onClick={onPause}>
              <Pause aria-hidden className="h-3.5 w-3.5" /> 暂停
            </Button>
          )}
        </div>
        <Progress value={stepIndex - 1} max={stepTotal} label={`执行进度 ${stepIndex}/${stepTotal}`} />
      </CardContent>
    </Card>
  );
}
