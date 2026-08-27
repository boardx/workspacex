"use client";
import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { PlanGateDecision } from "@repo/contracts/plan-control";

/**
 * F978 —— S4 确认门（`ui.md`）。判据四：渲染条件唯一是 `gate.required===true`
 * （UC-8，服务端已判定），前端不自行判断复杂度。
 *
 * ⚠ **条件性从不入 DOM，不是 display:none**——`gate.required===false` 时函数直接
 * `return null`，`chat-task-workbench-plan-confirm` 这个锚点在简单提问路径上
 * 从未出现在渲染树里，不是"渲染后用 CSS 藏起来"。这是 `usecases.md` UC-8 反证
 * ③「从未出现，不是出现后消失」在组件层面的落地。
 */
export const PLAN_CONFIRM_GATE_TESTID = "chat-task-workbench-plan-confirm";
export const PLAN_CONFIRM_RUN_TESTID = "chat-task-workbench-plan-confirm-run";
export const PLAN_CONFIRM_EDIT_TESTID = "chat-task-workbench-plan-confirm-edit";

export interface PlanConfirmGateProps {
  readonly gate: PlanGateDecision;
  readonly onConfirmRun?: () => void;
  readonly onContinueEditing?: () => void;
}

export function PlanConfirmGate(
  { gate, onConfirmRun, onContinueEditing }: PlanConfirmGateProps,
): React.JSX.Element | null {
  if (!gate.required) return null;

  return (
    <Card data-testid={PLAN_CONFIRM_GATE_TESTID} className="border-primary/40">
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex items-center gap-2">
          <span className="text-13 font-semibold">确认后执行</span>
          <Badge tone="warning" className="text-10">需确认</Badge>
        </div>
        <p className="text-12 text-muted-foreground">{gate.reason}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" data-testid={PLAN_CONFIRM_RUN_TESTID} onClick={onConfirmRun}>
            确认并执行
          </Button>
          <Button size="sm" variant="outline" data-testid={PLAN_CONFIRM_EDIT_TESTID} onClick={onContinueEditing}>
            继续编辑
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
