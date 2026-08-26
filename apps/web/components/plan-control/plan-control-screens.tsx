"use client";
import * as React from "react";
import {
  CheckCircle2, CircleDot, Circle, GripVertical, X, Plus, Pause,
  RotateCcw, Pencil, AlertTriangle, Info, Unlink,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  PLAN_STEPS, PLAN_PHASE_LABEL, PHASE_LINE, STEP_STATUS_LABEL, ORPHAN_CONSTRAINT,
  GATE_REQUIRED, GATE_NOT_REQUIRED, RUN_PROGRESS, RUN_FAILURE, formatElapsed,
  type PlanStepPreview, type PlanStepStatus, type PlanPhase, type PlanControlScreenKey,
} from "@/lib/mock/plan-control";

/**
 * plan-control 契约束（TW-P0-3）UI 先行原型 —— 八屏（G-01～G-08）。
 * ADR-023 签核第 ① 件材料。纯 mock，不接后端；所有派生值（phase/gate/progress）
 * 由 mock 模拟「读账本」（I-7 前端不重算）。
 *
 * ⚠ 落点：全部落在 /chat 三栏骨架内的计划面板/消息流（宿主屏归 chat 束），本束不新建路由。
 *   本预览页把这四个区域单独铺出来供逐屏签核，不代表它们是独立页面。
 * ⚠ 锚点单一事实源是 chat-task-workbench-acceptance.md + 本束 ui.md 第四节，这里只消费。
 */

function StepStatusIcon({ status }: { status: PlanStepStatus }) {
  const common = "h-4 w-4 shrink-0";
  if (status === "completed") return <CheckCircle2 aria-hidden className={cn(common, "text-success")} />;
  if (status === "in_progress") return <CircleDot aria-hidden className={cn(common, "text-primary")} />;
  return <Circle aria-hidden className={cn(common, "text-muted-foreground")} />;
}

function ConstraintRow({
  text, editable, onRemove,
}: { text: string; editable?: boolean; onRemove?: () => void }) {
  return (
    <div className="group ml-7 flex items-center gap-1.5 rounded-control border border-border-subtle bg-panel px-2.5 py-1">
      <span className="text-11 text-muted-foreground" aria-hidden>↳</span>
      <span className="text-12 text-background-foreground">{text}</span>
      <Badge tone="outline" className="text-10">约束</Badge>
      {editable && (
        <button
          type="button"
          aria-label={`撤销约束「${text}」`}
          data-testid="chat-task-workbench-plan-constraint-remove"
          onClick={onRemove}
          className="ml-auto invisible rounded-control p-0.5 text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-background-foreground focus-visible:visible focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover:visible"
        >
          <X aria-hidden className="h-3 w-3" />
        </button>
      )}
    </div>
  );
}

function PlanPanel({
  mode, onToggle, children, footer,
}: {
  mode: "read" | "edit";
  onToggle?: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <Card data-testid="chat-task-workbench-plan-panel" data-plan-mode={mode} className="w-full">
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex items-center gap-2">
          <span className="text-13 font-semibold">当前计划</span>
          <Badge tone="neutral" className="text-10">{PLAN_STEPS.length} 步</Badge>
          <Button
            size="xs"
            variant={mode === "edit" ? "primary" : "outline"}
            className="ml-auto"
            data-testid="chat-task-workbench-plan-edit-toggle"
            onClick={onToggle}
          >
            <Pencil aria-hidden className="h-3 w-3" />
            {mode === "edit" ? "完成编辑" : "编辑计划"}
          </Button>
        </div>
        <ol className="flex flex-col gap-1.5">{children}</ol>
        {footer}
      </CardContent>
    </Card>
  );
}

function ScreenReadOnly() {
  return (
    <ScreenFrame title="G-01 · 计划面板 · 只读态（S2）" note="三种步骤状态同屏：已完成 / 进行中 / 待执行。图标 + aria-label 文本双通道（TW-A11Y-6）。不出现 write_todos 字样（判据二）。">
      <PlanPanel mode="read">
        {PLAN_STEPS.map((step) => (
          <li key={step.id} data-testid="chat-task-workbench-plan-step" data-plan-status={step.status} className="flex flex-col gap-1">
            <div className="flex items-center gap-2 rounded-control px-1 py-0.5">
              <StepStatusIcon status={step.status} />
              <span className={cn("text-13", step.status === "completed" && "text-muted-foreground line-through")}>
                {step.content}
              </span>
              <span className="sr-only">（{STEP_STATUS_LABEL[step.status]}）</span>
              <span aria-label={STEP_STATUS_LABEL[step.status]} className="ml-auto text-10 text-muted-foreground">
                {STEP_STATUS_LABEL[step.status]}
              </span>
            </div>
            {step.status === "in_progress" && (
              <div className="ml-6"><Progress value={40} label="当前步骤进度" className="max-w-[200px]" /></div>
            )}
            {step.constraints.map((c) => <ConstraintRow key={c.id} text={c.text} />)}
          </li>
        ))}
      </PlanPanel>
    </ScreenFrame>
  );
}

function EditStepRow({
  step, index, total, dragging, showConstraintInput,
}: {
  step: PlanStepPreview;
  index: number;
  total: number;
  dragging?: boolean;
  showConstraintInput?: boolean;
}) {
  return (
    <li
      data-testid="chat-task-workbench-plan-step"
      data-plan-status={step.status}
      className={cn(
        "flex flex-col gap-1 rounded-control border px-1.5 py-1 transition-all duration-base",
        dragging ? "border-primary bg-accent shadow-md" : "border-transparent hover:border-border-subtle hover:bg-muted/40",
      )}
    >
      <div className="flex items-center gap-1.5">
        <span
          role="button"
          tabIndex={0}
          aria-label={`拖拽调整「${step.content}」顺序，或用 Alt+↑ / Alt+↓`}
          data-testid="chat-task-workbench-plan-step-reorder"
          className="cursor-grab rounded-control p-0.5 text-muted-foreground transition-colors duration-base hover:bg-muted hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <GripVertical aria-hidden className="h-4 w-4" />
        </span>
        <StepStatusIcon status={step.status} />
        <span className="text-13">{step.content}</span>
        <span className="ml-1 text-10 text-muted-foreground">{index + 1}/{total}</span>
        <Button
          size="xs"
          variant="ghost"
          className="ml-auto text-muted-foreground transition-colors duration-fast hover:text-destructive"
          data-testid="chat-task-workbench-plan-step-delete"
          aria-label={`移除「${step.content}」`}
        >
          移除
        </Button>
      </div>
      {step.constraints.map((c) => <ConstraintRow key={c.id} text={c.text} editable onRemove={() => {}} />)}
      {showConstraintInput ? (
        <div className="ml-7 flex flex-col gap-1 rounded-control border border-primary bg-accent/50 px-2.5 py-2">
          <Label htmlFor={`constraint-${step.id}`} className="text-11 text-muted-foreground">给「{step.content}」加一条约束</Label>
          <div className="flex items-center gap-1.5">
            <Input
              id={`constraint-${step.id}`}
              defaultValue="只用公开可引用的来源"
              placeholder="例如：只用公开可引用的来源"
              aria-label={`为「${step.content}」输入约束`}
              className="h-7 text-12"
            />
            <Button size="xs" variant="primary" data-testid="chat-task-workbench-plan-step-add-constraint-confirm">添加</Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          data-testid="chat-task-workbench-plan-step-add-constraint"
          aria-label={`为「${step.content}」加一条约束`}
          className="ml-7 flex w-fit items-center gap-1 rounded-control px-1.5 py-0.5 text-11 text-muted-foreground transition-colors duration-base hover:bg-muted hover:text-background-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Plus aria-hidden className="h-3 w-3" /> 加一条约束
        </button>
      )}
    </li>
  );
}

function PendingApplyBanner() {
  return (
    <div
      data-testid="chat-task-workbench-plan-pending-apply"
      role="status"
      className="flex items-start gap-2 rounded-control border border-warning/30 bg-warning/5 px-2.5 py-2 text-12"
    >
      <Info aria-hidden className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
      <span>
        Agent 正在执行。你的改动会<b>落到账本、在当前步骤完成后生效</b>，不会改变正在跑的这一步。
        要立刻生效请先<Button size="xs" variant="ghost" className="mx-0.5 h-5 px-1 text-warning underline" data-testid="chat-task-workbench-run-pause-inline">暂停</Button>。
      </span>
    </div>
  );
}

function ScreenEdit() {
  return (
    <ScreenFrame title="G-02 · 计划面板 · 编辑态（S3）" note="三个动作同屏：拖拽把手（调序 UC-3）/ 每行「移除」（删步 UC-4，无二次确认，靠撤销代替）/「+ 加一条约束」（UC-5）+ 约束行悬停「×」（撤约束 UC-6）。">
      <PlanPanel mode="edit">
        {PLAN_STEPS.map((step, i) => (
          <EditStepRow key={step.id} step={step} index={i} total={PLAN_STEPS.length} />
        ))}
      </PlanPanel>
      <UndoToast />
    </ScreenFrame>
  );
}

function UndoToast() {
  return (
    <div className="flex items-center gap-2 rounded-control border border-border bg-card px-3 py-2 text-12 shadow-sm" data-testid="chat-task-workbench-plan-step-undo">
      <RotateCcw aria-hidden className="h-3.5 w-3.5 text-muted-foreground" />
      <span>已移除「提炼差异化机会与风险」</span>
      <Button size="xs" variant="ghost" className="ml-auto text-primary">撤销</Button>
    </div>
  );
}

function ScreenDragging() {
  const reordered = [0, 2, 1, 3, 4].map((i) => PLAN_STEPS[i]).filter((s): s is PlanStepPreview => Boolean(s));
  return (
    <ScreenFrame title="G-03 · 调序进行中（S3）" note="第 3 步被抬起、落点高亮。调序是唯一有中间态的动作。键盘等价：Alt+↑ / Alt+↓（TW-A11Y-8）。">
      <PlanPanel mode="edit">
        {reordered.map((step, i) => (
          <EditStepRow key={step.id} step={step} index={i} total={reordered.length} dragging={i === 1} />
        ))}
      </PlanPanel>
    </ScreenFrame>
  );
}

function ScreenAddConstraint() {
  return (
    <ScreenFrame title="G-04 · 加约束就地展开 + 已挂载一条（S3）" note="「加约束」就地展开单行输入（不套第二层弹窗）；下方「生成报告」已挂载一条约束示范最终形态。这是本束最不确定的一件（domain 三·①）。">
      <PlanPanel mode="edit">
        {PLAN_STEPS.map((step, i) => (
          <EditStepRow
            key={step.id}
            step={step}
            index={i}
            total={PLAN_STEPS.length}
            showConstraintInput={step.id === "s4"}
          />
        ))}
      </PlanPanel>
    </ScreenFrame>
  );
}

function PhaseLine({ current }: { current: PlanPhase }) {
  if (current === "failed") {
    return (
      <div
        data-testid="chat-task-workbench-phase-indicator"
        data-phase="failed"
        role="status"
        className="flex items-center gap-2 rounded-control border border-destructive/40 bg-destructive/5 px-3 py-1.5"
      >
        <AlertTriangle aria-hidden className="h-4 w-4 text-destructive" />
        <span className="text-13 font-medium text-destructive">执行失败</span>
        <span className="text-11 text-muted-foreground">当前态：{PLAN_PHASE_LABEL.failed}</span>
      </div>
    );
  }
  return (
    <div
      data-testid="chat-task-workbench-phase-indicator"
      data-phase={current}
      className="flex items-center gap-1 rounded-control border border-border-subtle bg-panel px-3 py-1.5"
    >
      <span role="status" className="sr-only">当前处于「{PLAN_PHASE_LABEL[current]}」阶段</span>
      {PHASE_LINE.map((p, i) => (
        <React.Fragment key={p}>
          {i > 0 && <span aria-hidden className="text-11 text-muted-foreground">›</span>}
          <span
            aria-current={p === current ? "step" : undefined}
            className={cn(
              "rounded-control px-1.5 py-0.5 text-12 transition-colors duration-base",
              p === current ? "bg-primary font-semibold text-primary-foreground" : "text-muted-foreground",
            )}
          >
            {PLAN_PHASE_LABEL[p]}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

function ScreenPhaseIndicator() {
  const all: PlanPhase[] = ["preparing", "planning", "executing", "approving", "done", "failed"];
  return (
    <ScreenFrame title="G-05 · 六态指示器 · 六联（S1）" note="当前态是可读文本 + aria-current + role=status 播报，去掉 CSS 后仍读得出在哪一态（判据一「不靠颜色暗示」）。数据来自 getPlanLedger.phase（UC-1），前端不重算（I-7）。failed 不在线上，替换整条 → S6。">
      <div className="flex flex-col gap-2">
        {all.map((p) => (
          <div key={p} className="flex items-center gap-3">
            <span className="w-10 shrink-0 text-11 text-muted-foreground">{PLAN_PHASE_LABEL[p]}</span>
            <PhaseLine current={p} />
          </div>
        ))}
      </div>
    </ScreenFrame>
  );
}

function ConfirmGate() {
  return (
    <Card data-testid="chat-task-workbench-plan-confirm" className="border-primary/40">
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex items-center gap-2">
          <span className="text-13 font-semibold">确认后执行</span>
          <Badge tone="warning" className="text-10">需确认</Badge>
        </div>
        <p className="text-12 text-muted-foreground">{GATE_REQUIRED.reason}</p>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="primary" data-testid="chat-task-workbench-plan-confirm-run">确认并执行</Button>
          <Button size="sm" variant="outline" data-testid="chat-task-workbench-plan-confirm-edit">继续编辑</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ScreenConfirmGate() {
  return (
    <ScreenFrame title="G-06 · 确认门 vs 简单提问 对照（S4）" note="判据四是一对对照。渲染条件唯一：gate.required===true（UC-8），前端不自行判断复杂度。简单路径上该节点从不进入 DOM（不是 display:none）。门上只有两个出口，无「跳过确认」。">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-panel p-3">
          <span className="text-11 font-medium text-muted-foreground">复杂任务 · gate.required = true</span>
          <PlanPanel mode="read">
            {PLAN_STEPS.slice(0, 3).map((s) => (
              <li key={s.id} data-testid="chat-task-workbench-plan-step" data-plan-status={s.status} className="flex items-center gap-2 px-1 py-0.5">
                <StepStatusIcon status={s.status} /><span className="text-13">{s.content}</span>
              </li>
            ))}
          </PlanPanel>
          <ConfirmGate />
        </div>
        <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-panel p-3">
          <span className="text-11 font-medium text-muted-foreground">简单提问 · gate.required = false</span>
          <Card><CardContent className="py-3 text-13 text-muted-foreground">
            <p className="text-background-foreground">「北京今天天气怎么样？」</p>
            <p className="mt-2">直接作答，无计划面板、无确认门。</p>
            <p className="mt-2 text-11">{GATE_NOT_REQUIRED.reason}</p>
            <p className="mt-2 rounded-control border border-dashed border-border px-2 py-1 text-11">
              此处<b>没有</b> <code className="text-11">chat-task-workbench-plan-confirm</code> 节点（不在 DOM，非隐藏）。
            </p>
          </CardContent></Card>
        </div>
      </div>
    </ScreenFrame>
  );
}

function ScreenRunning() {
  const p = RUN_PROGRESS;
  return (
    <ScreenFrame title="G-07 · 执行态进度 + 暂停；执行中编辑告知（S5 / S8）" note="耗时是真实 run 起止差（getPlanLedger.progress.elapsedMs），刷新后仍对，不是前端计时器。「暂停」文案与 I-12 语义待人类拍（暂停 vs 停止）。下方告知条是 I-11 对用户的唯一出口。">
      <div className="flex flex-col gap-3">
        <PhaseLine current="executing" />
        <Card data-testid="chat-task-workbench-run-progress">
          <CardContent className="flex flex-col gap-2 py-3">
            <div className="flex items-center gap-2">
              <CircleDot aria-hidden className="h-4 w-4 text-primary" />
              <span className="text-13">当前步骤：<b>{p.currentStepLabel}</b></span>
              <span className="text-11 text-muted-foreground">{p.stepIndex}/{p.stepTotal} · 已用 {formatElapsed(p.elapsedMs)}</span>
              <Button size="sm" variant="outline" className="ml-auto" data-testid="chat-task-workbench-run-pause">
                <Pause aria-hidden className="h-3.5 w-3.5" /> 暂停
              </Button>
            </div>
            <Progress value={p.stepIndex - 1 + 0.4} max={p.stepTotal} label={`执行进度 ${p.stepIndex}/${p.stepTotal}`} />
          </CardContent>
        </Card>
        <PendingApplyBanner />
      </div>
    </ScreenFrame>
  );
}

function ScreenFailure() {
  const f = RUN_FAILURE;
  return (
    <ScreenFrame title="G-08 · 失败态 + 两个恢复动作（S6）" note="裁决 (c)：只画两个恢复动作（重试该步 UC-10 / 修改输入 → 回编辑态）。第三个「恢复检查点」本轮明确不做——按钮不渲染、锚点不存在（本仓封顶 0.7，如实报缺口，绝不画点了报错的死按钮）。">
      <div className="flex flex-col gap-3">
        <PhaseLine current="failed" />
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col gap-3 py-3">
            <div className="flex items-start gap-2">
              <AlertTriangle aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="flex flex-col gap-0.5">
                <span className="text-13">第 {f.failedStepIndex} 步「{f.failedStepLabel}」失败</span>
                <span className="text-12 text-muted-foreground">{f.reason}</span>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="primary" data-testid="chat-task-workbench-failure-retry-step">
                <RotateCcw aria-hidden className="h-3.5 w-3.5" /> 重试该步
              </Button>
              <Button size="sm" variant="outline" data-testid="chat-task-workbench-failure-edit-input">
                <Pencil aria-hidden className="h-3.5 w-3.5" /> 修改输入
              </Button>
              <span className="text-11 text-muted-foreground">
                （「恢复检查点」本轮不提供 —— 引擎原语未接，如实缺口，见 ui.md 2.5）
              </span>
            </div>
          </CardContent>
        </Card>
      </div>
    </ScreenFrame>
  );
}

export function OrphanConstraintNotice() {
  return (
    <div
      data-testid="chat-task-workbench-plan-orphan-constraint"
      role="status"
      className="flex items-center gap-2 rounded-control border border-warning/30 bg-warning/5 px-2.5 py-2 text-12"
    >
      <Unlink aria-hidden className="h-3.5 w-3.5 shrink-0 text-warning" />
      <span>1 条约束失去了对应步骤：「{ORPHAN_CONSTRAINT.text}」（原属「{ORPHAN_CONSTRAINT.formerHostLabel}」）</span>
      <Button size="xs" variant="ghost" className="ml-auto text-primary">重新挂载</Button>
      <Button size="xs" variant="ghost" className="text-muted-foreground">移除</Button>
    </div>
  );
}

export function StaleBanner() {
  return (
    <div
      data-testid="chat-task-workbench-plan-stale-banner"
      role="status"
      className="flex items-center gap-2 rounded-control border border-ai/25 bg-ai-tint px-2.5 py-2 text-12 text-ai-tint-foreground"
    >
      <Info aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span>Agent 刚更新了计划，你的改动没有丢。</span>
      <Button size="xs" variant="ghost" className="ml-auto">查看差异</Button>
      <Button size="xs" variant="ghost">重新应用</Button>
    </div>
  );
}

function ScreenFrame({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h1 className="text-16 font-semibold tracking-tight">{title}</h1>
        <p className="rounded-control border border-warning/30 bg-warning/5 px-3 py-2 text-11 text-muted-foreground" data-testid="plan-control-screen-note">{note}</p>
      </div>
      {children}
    </div>
  );
}

const SCREENS: Record<PlanControlScreenKey, () => JSX.Element> = {
  g01: ScreenReadOnly,
  g02: ScreenEdit,
  g03: ScreenDragging,
  g04: ScreenAddConstraint,
  g05: ScreenPhaseIndicator,
  g06: ScreenConfirmGate,
  g07: ScreenRunning,
  g08: ScreenFailure,
};

export function PlanControlScreen({ screen }: { screen: PlanControlScreenKey }) {
  const S = SCREENS[screen] ?? ScreenReadOnly;
  return (
    <div data-testid="plan-control-preview" className="mx-auto flex max-w-3xl flex-col gap-4 bg-background p-6 text-background-foreground">
      <S />
      {screen === "g04" && (
        <div className="flex flex-col gap-2 rounded-card border border-border-subtle bg-panel p-3">
          <span className="text-11 font-medium text-muted-foreground">附 · I-8 孤儿约束（S7）与 I-5 陈旧横条 —— 新增四锚点的界面面</span>
          <OrphanConstraintNotice />
          <StaleBanner />
        </div>
      )}
    </div>
  );
}
