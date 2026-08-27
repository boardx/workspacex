"use client";
import * as React from "react";
import { CheckCircle2, CircleDot, Circle, GripVertical, X, Plus, RotateCcw, Info, Unlink } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { PlanStep, PlanStepStatus } from "@repo/contracts/plan-control";

/**
 * F978 —— S3 编辑态（`ui.md`）。一屏内含四控件（调序把手/移除/加约束/撤约束）；
 * 删后浮出"已移除·撤销"（不是二次确认弹窗——`window.confirm` 不出现在这条路径上）。
 *
 * ⚠ 本组件是纯展示层：不自己 fetch，接受回调 props（`onReorder`/`onDelete`/…）。
 * 真实网络调用由宿主容器组装（同 F977 `PlanPhaseIndicator`/`PlanPanelReadOnly`
 * 的既有分工——本包不重复发明第二种"组件自己 fetch"的写法）。
 */
export const PLAN_PANEL_EDIT_TESTID = "chat-task-workbench-plan-panel";
export const PLAN_STEP_TESTID = "chat-task-workbench-plan-step";
export const PLAN_STEP_REORDER_TESTID = "chat-task-workbench-plan-step-reorder";
export const PLAN_STEP_DELETE_TESTID = "chat-task-workbench-plan-step-delete";
export const PLAN_STEP_UNDO_TESTID = "chat-task-workbench-plan-step-undo";
export const PLAN_STEP_ADD_CONSTRAINT_TESTID = "chat-task-workbench-plan-step-add-constraint";
export const PLAN_STEP_ADD_CONSTRAINT_CONFIRM_TESTID = "chat-task-workbench-plan-step-add-constraint-confirm";
export const PLAN_CONSTRAINT_REMOVE_TESTID = "chat-task-workbench-plan-constraint-remove";
export const PLAN_STALE_BANNER_TESTID = "chat-task-workbench-plan-stale-banner";
export const PLAN_PENDING_APPLY_TESTID = "chat-task-workbench-plan-pending-apply";
export const PLAN_ORPHAN_CONSTRAINT_TESTID = "chat-task-workbench-plan-orphan-constraint";

const STEP_STATUS_LABEL_ZH: Readonly<Record<PlanStepStatus, string>> = {
  pending: "待执行", in_progress: "进行中", completed: "已完成",
};

function StepStatusIcon({ status }: { status: PlanStepStatus }): React.JSX.Element {
  const common = "h-4 w-4 shrink-0";
  if (status === "completed") return <CheckCircle2 aria-hidden className={cn(common, "text-success")} />;
  if (status === "in_progress") return <CircleDot aria-hidden className={cn(common, "text-primary")} />;
  return <Circle aria-hidden className={cn(common, "text-muted-foreground")} />;
}

export interface RemovedStepNotice {
  readonly planStepId: string;
  readonly content: string;
}

export interface PlanPanelEditProps {
  readonly steps: readonly PlanStep[];
  /** 越界钳制由服务端做（UC-3），前端只把原始 index 报上去。 */
  readonly onReorder?: (planStepId: string, toIndex: number) => void;
  readonly onDelete?: (planStepId: string) => void;
  readonly onAddConstraint?: (planStepId: string, text: string) => void;
  readonly onRemoveConstraint?: (constraintId: string) => void;
  /** 刚被移除、还能撤销的那一条（宿主维护这个状态；本组件只负责展示 toast）。 */
  readonly justRemoved?: RemovedStepNotice | null;
  readonly onUndoRemove?: () => void;
}

export function PlanPanelEdit(
  { steps, onReorder, onDelete, onAddConstraint, onRemoveConstraint, justRemoved, onUndoRemove }: PlanPanelEditProps,
): React.JSX.Element {
  const [addingConstraintFor, setAddingConstraintFor] = React.useState<string | null>(null);
  const [draftText, setDraftText] = React.useState("");

  return (
    <div className="flex flex-col gap-2">
      <Card data-testid={PLAN_PANEL_EDIT_TESTID} data-plan-mode="edit" className="w-full">
        <CardContent className="flex flex-col gap-2 py-3">
          <div className="flex items-center gap-2">
            <span className="text-13 font-semibold">当前计划</span>
            <Badge tone="neutral" className="text-10">{steps.length} 步</Badge>
          </div>
          <ol className="flex flex-col gap-1.5">
            {steps.map((step, i) => (
              <li
                key={step.planStepId}
                data-testid={PLAN_STEP_TESTID}
                data-plan-status={step.status}
                className="flex flex-col gap-1 rounded-control border border-transparent px-1.5 py-1 transition-all duration-base hover:border-border-subtle hover:bg-muted/40"
              >
                <div className="flex items-center gap-1.5">
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`拖拽调整「${step.content}」顺序，或用 Alt+↑ / Alt+↓`}
                    data-testid={PLAN_STEP_REORDER_TESTID}
                    onKeyDown={(e) => {
                      if (e.key === "ArrowUp" && e.altKey) onReorder?.(step.planStepId, i - 1);
                      if (e.key === "ArrowDown" && e.altKey) onReorder?.(step.planStepId, i + 1);
                    }}
                    className="cursor-grab rounded-control p-0.5 text-muted-foreground transition-colors duration-base hover:bg-muted hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <GripVertical aria-hidden className="h-4 w-4" />
                  </span>
                  <StepStatusIcon status={step.status} />
                  <span className="text-13">{step.content}</span>
                  <span aria-label={STEP_STATUS_LABEL_ZH[step.status]} className="ml-1 text-10 text-muted-foreground">
                    {i + 1}/{steps.length}
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    className="ml-auto text-muted-foreground transition-colors duration-fast hover:text-destructive"
                    data-testid={PLAN_STEP_DELETE_TESTID}
                    aria-label={`移除「${step.content}」`}
                    // 无二次确认弹窗——直接触发删除，撤销靠下方的 toast，不是 window.confirm。
                    onClick={() => onDelete?.(step.planStepId)}
                  >
                    移除
                  </Button>
                </div>
                {step.constraints.map((c) => (
                  <div
                    key={c.constraintId}
                    className="group ml-7 flex items-center gap-1.5 rounded-control border border-border-subtle bg-panel px-2.5 py-1"
                  >
                    <span className="text-11 text-muted-foreground" aria-hidden>↳</span>
                    <span className="text-12 text-background-foreground">{c.text}</span>
                    <Badge tone="outline" className="text-10">约束</Badge>
                    <button
                      type="button"
                      aria-label={`撤销约束「${c.text}」`}
                      data-testid={PLAN_CONSTRAINT_REMOVE_TESTID}
                      onClick={() => onRemoveConstraint?.(c.constraintId)}
                      className="ml-auto rounded-control p-0.5 text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <X aria-hidden className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {addingConstraintFor === step.planStepId ? (
                  <div className="ml-7 flex flex-col gap-1 rounded-control border border-primary bg-accent/50 px-2.5 py-2">
                    <Label htmlFor={`constraint-${step.planStepId}`} className="text-11 text-muted-foreground">
                      给「{step.content}」加一条约束
                    </Label>
                    <div className="flex items-center gap-1.5">
                      <Input
                        id={`constraint-${step.planStepId}`}
                        value={draftText}
                        onChange={(e) => setDraftText(e.target.value)}
                        placeholder="例如：只用公开可引用的来源"
                        aria-label={`为「${step.content}」输入约束`}
                        className="h-7 text-12"
                      />
                      <Button
                        size="xs"
                        variant="primary"
                        data-testid={PLAN_STEP_ADD_CONSTRAINT_CONFIRM_TESTID}
                        onClick={() => {
                          if (draftText.trim() === "") return;
                          onAddConstraint?.(step.planStepId, draftText);
                          setDraftText("");
                          setAddingConstraintFor(null);
                        }}
                      >
                        添加
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    data-testid={PLAN_STEP_ADD_CONSTRAINT_TESTID}
                    aria-label={`为「${step.content}」加一条约束`}
                    onClick={() => { setAddingConstraintFor(step.planStepId); setDraftText(""); }}
                    className="ml-7 flex w-fit items-center gap-1 rounded-control px-1.5 py-0.5 text-11 text-muted-foreground transition-colors duration-base hover:bg-muted hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Plus aria-hidden className="h-3 w-3" /> 加一条约束
                  </button>
                )}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>

      {justRemoved && (
        <div
          data-testid={PLAN_STEP_UNDO_TESTID}
          className="flex items-center gap-2 rounded-control border border-border bg-card px-3 py-2 text-12 shadow-sm"
        >
          <RotateCcw aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
          <span>已移除「{justRemoved.content}」</span>
          <Button size="xs" variant="ghost" className="ml-auto text-primary" onClick={onUndoRemove}>撤销</Button>
        </div>
      )}
    </div>
  );
}

export function PlanStaleBanner(
  { onViewDiff, onReapply }: { onViewDiff?: () => void; onReapply?: () => void },
): React.JSX.Element {
  return (
    <div
      data-testid={PLAN_STALE_BANNER_TESTID}
      role="status"
      className="flex items-center gap-2 rounded-control border border-ai/25 bg-ai-tint px-2.5 py-2 text-12 text-ai-tint-foreground"
    >
      <Info aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span>Agent 刚更新了计划，你的改动没有丢。</span>
      <Button size="xs" variant="ghost" className="ml-auto" onClick={onViewDiff}>查看差异</Button>
      <Button size="xs" variant="ghost" onClick={onReapply}>重新应用</Button>
    </div>
  );
}

export function PlanPendingApplyBanner(
  { onPauseNow }: { onPauseNow?: () => void },
): React.JSX.Element {
  return (
    <div
      data-testid={PLAN_PENDING_APPLY_TESTID}
      role="status"
      className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning/5 px-2.5 py-2 text-12"
    >
      <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <span>
        Agent 正在执行。你的改动会<b>落到账本、在当前步骤完成后生效</b>，不会改变正在跑的这一步。
        要立刻生效请先<Button size="xs" variant="ghost" className="mx-0.5 h-5 px-1 text-warning underline" onClick={onPauseNow}>暂停</Button>。
      </span>
    </div>
  );
}

export interface OrphanConstraintNoticeProps {
  readonly text: string;
  readonly formerStepContent: string;
  readonly onRemove?: () => void;
}

export function OrphanConstraintNotice(
  { text, formerStepContent, onRemove }: OrphanConstraintNoticeProps,
): React.JSX.Element {
  return (
    <div
      data-testid={PLAN_ORPHAN_CONSTRAINT_TESTID}
      role="status"
      className="flex items-center gap-2 rounded-control border border-warning/30 bg-warning/5 px-2.5 py-2 text-12"
    >
      <Unlink aria-hidden className="h-3.5 w-3.5 shrink-0 text-warning" />
      <span>1 条约束失去了对应步骤：「{text}」（原属「{formerStepContent}」）</span>
      <Button size="xs" variant="ghost" className="ml-auto text-primary" onClick={onRemove}>移除</Button>
    </div>
  );
}
