"use client";
import * as React from "react";
import { AlertTriangle, RotateCcw, Pencil } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * F978 —— S6 失败态（`ui.md`）。裁决 (c)：只画两个恢复动作
 * （重试该步 UC-10 / 修改输入 → 回编辑态）。
 *
 * ⚠ **`chat-task-workbench-failure-restore-checkpoint` 这个锚点不存在于 DOM**——
 * 不是渲染一个点了报错的死按钮，是这段 JSX 里根本没有写它。第三个恢复动作
 * 本轮明确不做（人类 2026-08-26 裁决 (c)），TW-P0-3 如实封顶 0.7，不假装能做。
 */
export const PLAN_FAILURE_RETRY_STEP_TESTID = "chat-task-workbench-failure-retry-step";
export const PLAN_FAILURE_EDIT_INPUT_TESTID = "chat-task-workbench-failure-edit-input";

export interface PlanFailureRecoveryProps {
  readonly failedStepIndex: number;
  readonly failedStepLabel: string;
  readonly reason: string;
  readonly onRetryStep?: () => void;
  readonly onEditInput?: () => void;
}

export function PlanFailureRecovery(
  { failedStepIndex, failedStepLabel, reason, onRetryStep, onEditInput }: PlanFailureRecoveryProps,
): React.JSX.Element {
  return (
    <Card className="border-destructive/30">
      <CardContent className="flex flex-col gap-3 py-3">
        <div className="flex items-start gap-2">
          <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex flex-col gap-0.5">
            <span className="text-13">第 {failedStepIndex} 步「{failedStepLabel}」失败</span>
            <span className="text-12 text-muted-foreground">{reason}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="primary" data-testid={PLAN_FAILURE_RETRY_STEP_TESTID} onClick={onRetryStep}>
            <RotateCcw aria-hidden className="h-3.5 w-3.5" /> 重试该步
          </Button>
          <Button size="sm" variant="outline" data-testid={PLAN_FAILURE_EDIT_INPUT_TESTID} onClick={onEditInput}>
            <Pencil aria-hidden className="h-3.5 w-3.5" /> 修改输入
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
