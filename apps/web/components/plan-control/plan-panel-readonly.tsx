"use client";
import * as React from "react";
import { CheckCircle2, CircleDot, Circle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { PlanStep, PlanStepStatus } from "@repo/contracts/plan-control";

/**
 * F977 —— S2 计划面板只读态（`ui.md` 判据二）。
 *
 * ⚠ `steps` 是 `getPlanLedger.steps`（UC-1）的直出——本组件不重算 phase/gate/progress，
 * 不自己解析引擎的 `write_todos` 参数。全程不出现 `write_todos` 字面串（I-15，
 * `chat-task-workbench-copy.spec.ts` 的 TW-COPY-1 黑名单已覆盖，本组件只保证不违反）。
 *
 * 三种步骤状态各有 `aria-label`，不只靠图标（辅助技术单独播报状态文案，
 * 不依赖图标的视觉形状）。约束缩进挂在宿主步骤下（DOM 结构本身表达"属于哪一步"，
 * 不是靠视觉缩进这一件事撑住语义）。
 */
export const PLAN_STEP_TESTID = "chat-task-workbench-plan-step";
export const PLAN_PANEL_TESTID = "chat-task-workbench-plan-panel";

const STEP_STATUS_LABEL_ZH: Readonly<Record<PlanStepStatus, string>> = {
  pending: "待执行", in_progress: "进行中", completed: "已完成",
};

function StepStatusIcon({ status }: { status: PlanStepStatus }): React.JSX.Element {
  const common = "h-4 w-4 shrink-0";
  if (status === "completed") return <CheckCircle2 aria-hidden className={cn(common, "text-success")} />;
  if (status === "in_progress") return <CircleDot aria-hidden className={cn(common, "text-primary")} />;
  return <Circle aria-hidden className={cn(common, "text-muted-foreground")} />;
}

export interface PlanPanelReadOnlyProps {
  readonly steps: readonly PlanStep[];
}

export function PlanPanelReadOnly({ steps }: PlanPanelReadOnlyProps): React.JSX.Element {
  return (
    <Card data-testid={PLAN_PANEL_TESTID} data-plan-mode="read" className="w-full">
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex items-center gap-2">
          <span className="text-13 font-semibold">当前计划</span>
          <Badge tone="neutral" className="text-10">{steps.length} 步</Badge>
        </div>
        <ol className="flex flex-col gap-1.5">
          {steps.map((step) => (
            <li
              key={step.planStepId}
              data-testid={PLAN_STEP_TESTID}
              data-plan-status={step.status}
              className="flex flex-col gap-1"
            >
              <div className="flex items-center gap-2 rounded-control px-1 py-0.5">
                <StepStatusIcon status={step.status} />
                <span className={cn("text-13", step.status === "completed" && "text-muted-foreground line-through")}>
                  {step.content}
                </span>
                {/* aria-label 承载状态文案：不是只靠上面那个图标的形状。 */}
                <span aria-label={STEP_STATUS_LABEL_ZH[step.status]} className="ml-auto text-10 text-muted-foreground">
                  {STEP_STATUS_LABEL_ZH[step.status]}
                </span>
              </div>
              {step.constraints.map((c) => (
                // 约束缩进挂在宿主 step 的 <li> 内部——DOM 层级本身就是"属于这一步"的证据。
                <div
                  key={c.constraintId}
                  data-testid="chat-task-workbench-plan-constraint"
                  className="ml-7 flex items-center gap-1.5 rounded-control border border-border-subtle bg-panel px-2.5 py-1"
                >
                  <span className="text-11 text-muted-foreground" aria-hidden>↳</span>
                  <span className="text-12 text-background-foreground">{c.text}</span>
                  <Badge tone="outline" className="text-10">约束</Badge>
                </div>
              ))}
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
