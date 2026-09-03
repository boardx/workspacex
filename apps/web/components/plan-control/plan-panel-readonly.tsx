"use client";
import * as React from "react";
import { CheckCircle2 } from "lucide-react";
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

/**
 * issue #2476 —— 步骤序号徽标：圆形 + 序号，替代此前"只有一个状态图标、没有序号"
 * 的呈现。**状态信息不因此丢失**——完成态仍然是 `CheckCircle2`（对勾本身就是
 * 状态，不需要再叠一个数字），进行中/待执行才显示序号，且序号徽标本身按状态
 * 换色（`--accent` 进行中 / 描边 待执行），不是纯装饰。
 */
function StepBadge({ status, index }: { status: PlanStepStatus; index: number }): React.JSX.Element {
  if (status === "completed") {
    return (
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-success text-success-foreground">
        <CheckCircle2 aria-hidden className="h-4 w-4" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        "flex h-6 w-6 shrink-0 items-center justify-center rounded-full font-mono text-11 font-medium",
        status === "in_progress" ? "bg-accent text-accent-foreground" : "border border-border text-muted-foreground",
      )}
    >
      {index + 1}
    </span>
  );
}

export interface PlanPanelReadOnlyProps {
  readonly steps: readonly PlanStep[];
}

export function PlanPanelReadOnly({ steps }: PlanPanelReadOnlyProps): React.JSX.Element {
  return (
    <Card data-testid={PLAN_PANEL_TESTID} data-plan-mode="read" className="w-full overflow-hidden">
      {/*
        issue #2476 —— 卡头改成独立的、`--accent` 浅底的标题区，跟下面的步骤列表
        分层：卡头只回答"这是什么计划"，不跟步骤内容混排。复用既有 `--accent`
        （F19 已定义、2026-08-27 改版未触碰的浅青绿 token），不是新色。
      */}
      <div className="flex items-center gap-2 border-b border-border-subtle bg-accent px-3 py-2.5">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-9 font-medium uppercase tracking-wide text-accent-foreground/70">Plan</span>
          <span className="text-13 font-semibold text-accent-foreground">当前计划</span>
        </div>
        <Badge tone="neutral" className="ml-auto text-10">{steps.length} 步</Badge>
      </div>
      <CardContent className="flex flex-col gap-2 py-3">
        <ol className="flex flex-col gap-1.5">
          {steps.map((step, index) => (
            <li
              key={step.planStepId}
              data-testid={PLAN_STEP_TESTID}
              data-plan-status={step.status}
              className="flex flex-col gap-1"
            >
              <div className="flex items-center gap-2 rounded-control px-1 py-0.5">
                <StepBadge status={step.status} index={index} />
                <span className={cn("text-13", step.status === "completed" && "text-muted-foreground line-through")}>
                  {step.content}
                </span>
                {/* aria-label 承载状态文案：不是只靠上面那个徽标的形状/颜色。 */}
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
