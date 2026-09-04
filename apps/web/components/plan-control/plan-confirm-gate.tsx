"use client";
import * as React from "react";
import { Pause, ShieldAlert, Zap } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { PlanGateDecision, PlanGateReason, PlanStep } from "@repo/contracts/plan-control";

/**
 * F978 —— S4 确认门（`ui.md`）+ issue #2665（任务类型标记 / 自动执行版计划卡 /
 * 待确认版计划卡，需求文档 07 章 US-01/02/03）。
 *
 * ## 依赖：issue #2663「计划确认策略」（PR #2676，写这个文件时尚未合入 main）
 *
 * `evaluatePlanGate`（`packages/contracts/src/plan-control.ts`）在那个 PR 里新增了
 * `taskRiskClass` 入参、`deliverPlan` 出参、`"multi-step-low-risk"` /
 * `"multi-step-high-risk"` 两个新 `reason` 值——但 `main` 上的 `PlanGateDecision`
 * 契约**还没有**这些字段（本文件写作时点，PR #2676 未合并）。本组件不擅自去改
 * `packages/contracts/src/plan-control.ts`（那是 #2663 的范围，另一个 PR 在跑），
 * 而是在这里本地声明一个"契约将会扩展成什么样"的超集类型（`PlanGateDecisionWithRisk`
 * / `PlanGateReasonWithRisk`），结构逐字对应 PR #2676 diff 里的形状。等 #2663 合并、
 * `PlanGateDecision` 本身长出这些字段后，这里的超集类型与 `PlanGateDecision` 结构
 * 相同，直接删掉本地类型、改回 import 契约类型即可（不是重新设计，是收口）。
 *
 * ## 端到端管道现状（如实登记，不是本组件的阻塞项）
 *
 * `taskRiskClass` 目前只存在于 `deep-agent-service` 内部的 LangGraph state
 * （`TaskClassificationState.task_classification.category`），`apps/api` 侧的
 * `getPlanLedger`（`get-plan-ledger.ts`）调用 `evaluatePlanGate` 时**没有传**这个
 * 字段——见 PR #2676 描述与其 `evaluatePlanGate` 头注"端到端管道现状"一节。也就是说：
 * 就算 #2663 合并，真实后端返回的 `gate` 在管道打通前也只会落在 `reason` 原有四值
 * 之一，`deliverPlan` 恒为 `undefined`——`deliverPlan===true` 这条渲染分支眼下**没有
 * 真实数据能触发**，只能靠本文件下方 mock props 驱动的组件测试覆盖。
 *
 * TODO(打通管道后再接)：`apps/web/components/chat/copilotkit-v2-plan-control.tsx`
 * 直接把 `ledger.gate` 透传给本组件——那条线路不用改；需要改的是 `apps/api` 一侧
 * （`getPlanLedger` 要能读到 `task_classification`，把 `taskRiskClass` 传进
 * `evaluatePlanGate`）。那一步留给后续 issue，本次只做好组件能正确渲染扩展后
 * 的 `gate` 形状这一半。
 */

/** PR #2676：`PlanGateReason` 新增的两个风险分档值——本地补齐，见上方文件头注。 */
export type PlanGateReasonWithRisk = PlanGateReason | "multi-step-low-risk" | "multi-step-high-risk";

/** PR #2676：`PlanGateDecision` 新增的可选 `deliverPlan` 字段——本地补齐，见上方文件头注。 */
export interface PlanGateDecisionWithRisk extends Omit<PlanGateDecision, "reason"> {
  readonly reason: PlanGateReasonWithRisk;
  /** 仅在"低风险自动交付"分支为真（`required:false` 且来自 `multi_step_low_risk`）。 */
  readonly deliverPlan?: boolean;
}

/* ────────────────────────────────────────────────────────────────────── *
 * 一、任务类型标记（issue #2665 US-01）—— 一步到位任务，助手回复开头一个很轻的标记。
 * ────────────────────────────────────────────────────────────────────── */

export const PLAN_TASK_TYPE_BADGE_TESTID = "chat-task-workbench-task-type-badge";

/**
 * `PlanDirectExecutionBadge` —— 只在 `gate.reason === "no-plan"`（一步到位，
 * `evaluatePlanGate` 判定不需要计划）时由宿主渲染，挂在助手回复开头。故意做成
 * 一个独立的、不依赖 `PlanConfirmGate` 主体的极小组件——US-01 的验收标准是
 * "全程不出现『是否需要计划』提示，直接看到结果"，这个标记只是"判断为直接执行"
 * 的轻量说明，不是一张卡片，不能带出确认/计划相关的视觉重量。
 */
export function PlanDirectExecutionBadge(): React.JSX.Element {
  return (
    <span
      data-testid={PLAN_TASK_TYPE_BADGE_TESTID}
      className="inline-flex w-fit items-center gap-1 rounded-control bg-muted px-1.5 py-0.5 text-10 font-medium text-muted-foreground"
    >
      <Zap aria-hidden className="h-2.5 w-2.5" />
      判断为直接执行
    </span>
  );
}

/* ────────────────────────────────────────────────────────────────────── *
 * 二、计划卡片 · 自动执行版（issue #2665 US-02）—— `deliverPlan: true`。
 * ────────────────────────────────────────────────────────────────────── */

export const PLAN_AUTO_DELIVER_TESTID = "chat-task-workbench-plan-auto-deliver";
export const PLAN_AUTO_DELIVER_STEP_TESTID = "chat-task-workbench-plan-auto-deliver-step";
export const PLAN_AUTO_DELIVER_PAUSE_TESTID = "chat-task-workbench-plan-auto-deliver-pause";

function AutoDeliveredPlanCard(
  { steps, onPauseOrAdjust }: { readonly steps: readonly PlanStep[]; readonly onPauseOrAdjust?: () => void },
): React.JSX.Element {
  return (
    // 低风险多步任务不需要用户点头，但也不该悄悄跑——整块用 `--accent` 浅底
    // （与 `plan-panel-readonly.tsx` 卡头同一套 token），比确认门的 `--warning-tint`
    // 更轻，呼应"不打扰但可见"这条要求：颜色上明确区别于"需要你做决定"的警示色。
    <Card data-testid={PLAN_AUTO_DELIVER_TESTID} className="overflow-hidden border-accent/40 bg-accent/30">
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex items-center gap-2">
          <Badge tone="primary" className="text-10">已在执行</Badge>
          <span className="text-13 font-semibold text-accent-foreground">已在按此计划执行</span>
          {/*
            issue #2665 US-02 —— "不打扰但可见"的暂停/调整入口：复用与
            `PlanRunProgress`（S5 执行态）同一条取消路径——`pausePlanRun` →
            `apps/api` UC-9 `pausePlanRun` → `EngineRunController.cancelRun`
            （`apps/api/src/infrastructure/plan-control/
            deep-agent-engine-run-controller.ts`），不是另起一套。本组件不直接
            依赖 `lib/plan-control-api.ts`（那会把网络请求绑死进这个纯展示组件），
            回调交给宿主（`copilotkit-v2-plan-control.tsx`）传入，同一个
            `handlePause` 即可接上——那里已经调用 `pausePlanRun(tid)`。
          */}
          <Button
            size="sm" variant="outline" className="ml-auto"
            data-testid={PLAN_AUTO_DELIVER_PAUSE_TESTID} onClick={onPauseOrAdjust}
          >
            <Pause aria-hidden className="h-3.5 w-3.5" /> 暂停/调整
          </Button>
        </div>
        {steps.length > 0 && (
          <ol className="flex flex-col gap-1">
            {steps.map((step, index) => (
              <li
                key={step.planStepId}
                data-testid={PLAN_AUTO_DELIVER_STEP_TESTID}
                data-plan-status={step.status}
                className="flex items-center gap-2 rounded-control px-1 py-0.5 text-12"
              >
                <span className="font-mono text-10 text-muted-foreground">{index + 1}.</span>
                <span className={cn(step.status === "completed" && "text-muted-foreground line-through")}>
                  {step.content}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────────────── *
 * 三、计划卡片 · 待确认版（issue #2665 US-03）—— `gate.required === true`。
 * ────────────────────────────────────────────────────────────────────── */

export const PLAN_CONFIRM_GATE_TESTID = "chat-task-workbench-plan-confirm";
export const PLAN_CONFIRM_RUN_TESTID = "chat-task-workbench-plan-confirm-run";
export const PLAN_CONFIRM_EDIT_TESTID = "chat-task-workbench-plan-confirm-edit";
export const PLAN_CONFIRM_STEP_TESTID = "chat-task-workbench-plan-confirm-step";
export const PLAN_CONFIRM_STEP_EXTERNAL_TESTID = "chat-task-workbench-plan-confirm-step-external";
export const PLAN_CONFIRM_STEP_ADJUST_TESTID = "chat-task-workbench-plan-confirm-step-adjust";
export const PLAN_CONFIRM_STEP_REJECT_TESTID = "chat-task-workbench-plan-confirm-step-reject";

const HIGH_RISK_REASONS: ReadonlySet<PlanGateReasonWithRisk> = new Set(["multi-step-high-risk", "multi-step"]);

function PendingConfirmPlanCard(
  {
    gate, steps, externalStepIds, onConfirmRun, onContinueEditing, onAdjustStep, onRejectStep,
  }: {
    readonly gate: PlanGateDecisionWithRisk;
    readonly steps: readonly PlanStep[];
    readonly externalStepIds?: ReadonlySet<string>;
    readonly onConfirmRun?: () => void;
    readonly onContinueEditing?: () => void;
    readonly onAdjustStep?: (planStepId: string) => void;
    readonly onRejectStep?: (planStepId: string) => void;
  },
): React.JSX.Element {
  const isHighRisk = HIGH_RISK_REASONS.has(gate.reason);
  // issue #2665 US-03 —— "标出哪一步对外"：`PlanStep` 契约目前没有携带这个标记
  // （`packages/contracts/src/plan-control.ts` 的 `PlanStep` 只有
  // `planStepId`/`content`/`status`/`constraints`，见文件头注），所以数据源是
  // 宿主可选传入的 `externalStepIds`。**没传时不假装"这一步不对外"**——按 issue
  // 原话"没有就先展示全部步骤，对外步骤的标记留 TODO"：不高亮任何一步为对外，
  // 也不把"未知"渲染成"确定不对外"，两者是不同的诚实程度。
  const hasExternalHints = externalStepIds !== undefined && externalStepIds.size > 0;

  return (
    // issue #2476：`--warning-tint` 底色横幅（既有既有实现，本次未改动这块视觉基调）。
    <Card data-testid={PLAN_CONFIRM_GATE_TESTID} className="overflow-hidden border-warning/30 bg-warning-tint">
      <CardContent className="flex flex-col gap-2 py-3">
        <div className="flex items-center gap-2">
          <Badge tone="warning" className="text-10">需确认</Badge>
          <span className="text-13 font-semibold text-warning-tint-foreground">
            {isHighRisk ? "涉及对外动作，确认后执行" : "确认后执行"}
          </span>
        </div>
        {isHighRisk && (
          <p className="flex items-center gap-1.5 text-11 text-warning-tint-foreground/80">
            <ShieldAlert aria-hidden className="h-3 w-3 shrink-0" />
            {hasExternalHints
              ? "带「对外」标记的步骤会产生外部可见的影响，执行前请逐步核对。"
              : "本轮计划可能包含对外动作，暂无法逐步定位具体哪一步——已展示全部步骤，执行前请核对。"}
          </p>
        )}
        {steps.length > 0 && (
          <ol className="flex flex-col gap-1.5">
            {steps.map((step, index) => {
              const isExternal = externalStepIds?.has(step.planStepId) ?? false;
              return (
                <li
                  key={step.planStepId}
                  data-testid={PLAN_CONFIRM_STEP_TESTID}
                  data-plan-status={step.status}
                  data-plan-step-external={isExternal}
                  className={cn(
                    "flex items-center gap-2 rounded-control px-1.5 py-1 text-12",
                    isExternal && "border border-warning/50 bg-warning/10",
                  )}
                >
                  <span className="font-mono text-10 text-muted-foreground">{index + 1}.</span>
                  <span className="flex-1">{step.content}</span>
                  {isExternal && (
                    <Badge tone="warning" className="text-9" data-testid={PLAN_CONFIRM_STEP_EXTERNAL_TESTID}>
                      对外
                    </Badge>
                  )}
                  {/*
                    issue #2665 US-03 —— 单步调整/拒绝：只在宿主传入对应回调时才
                    渲染这两个按钮（渐进增强，向后兼容不传的既有调用方）。点击只
                    针对这一步，不影响其它步骤，也不等同于整体"继续编辑"/"确认并
                    执行"那两个宏观动作。
                  */}
                  {onAdjustStep && (
                    <Button
                      size="xs" variant="ghost" data-testid={PLAN_CONFIRM_STEP_ADJUST_TESTID}
                      onClick={() => onAdjustStep(step.planStepId)}
                    >
                      调整
                    </Button>
                  )}
                  {onRejectStep && (
                    <Button
                      size="xs" variant="ghost" data-testid={PLAN_CONFIRM_STEP_REJECT_TESTID}
                      onClick={() => onRejectStep(step.planStepId)}
                    >
                      拒绝
                    </Button>
                  )}
                </li>
              );
            })}
          </ol>
        )}
        <div className="flex items-center gap-2">
          {/* 等待态：按钮文案 + `aria-live` 状态行，明确这是"正等着你" 而不是普通操作项。 */}
          <Button size="sm" variant="primary" data-testid={PLAN_CONFIRM_RUN_TESTID} onClick={onConfirmRun}>
            确认执行
          </Button>
          <Button size="sm" variant="outline" data-testid={PLAN_CONFIRM_EDIT_TESTID} onClick={onContinueEditing}>
            继续编辑
          </Button>
          <span role="status" className="ml-auto text-10 text-warning-tint-foreground/70">等待你的确认…</span>
        </div>
      </CardContent>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────────────── *
 * 四、组装：`PlanConfirmGate` —— 按 `gate` 在三态间选择渲染，或不渲染。
 * ────────────────────────────────────────────────────────────────────── */

export interface PlanConfirmGateProps {
  /** 扩展后的判定结构（见文件头注）；`main` 上现存调用方传入的既有 `PlanGateDecision`
   *  值（四个旧 `reason`、无 `deliverPlan`）是这个类型的子集，天然兼容。 */
  readonly gate: PlanGateDecisionWithRisk;
  /**
   * `getPlanLedger.out.steps`（UC-1）直出，用于自动执行版/待确认版两张卡片渲染
   * 步骤列表。可选（默认 `[]`）——`gate.required===true` 且不传 `steps` 时仍只渲染
   * 确认门本体，与本组件改造前的行为逐字一致（现有测试即按这个形态断言）。
   */
  readonly steps?: readonly PlanStep[];
  /**
   * 哪些 `planStepId` "对外"（issue #2665 US-03）。TODO：目前没有服务端信号
   * 能算出这个集合（`PlanStep` 契约未携带该标记，见 `PendingConfirmPlanCard`
   * 头注）——传或不传全由宿主决定，不传时视觉上展示全部步骤、不做任何"对外"
   * 高亮，不是把"未知"当"确定不对外"渲染。
   */
  readonly externalStepIds?: ReadonlySet<string>;
  readonly onConfirmRun?: () => void;
  readonly onContinueEditing?: () => void;
  /**
   * 自动执行版的"暂停/调整"入口回调。TODO 接入：宿主传入与 `PlanRunProgress`
   * 的 `onPause` 相同的处理函数（`copilotkit-v2-plan-control.tsx` 里已有的
   * `handlePause`，最终打到 `pausePlanRun` → `EngineRunController.cancelRun`），
   * 不需要新起一条取消路径。
   */
  readonly onPauseOrAdjust?: () => void;
  /** 单步调整（issue #2665 US-03）。传入即视为该功能已启用，渲染对应按钮。 */
  readonly onAdjustStep?: (planStepId: string) => void;
  /** 单步拒绝（issue #2665 US-03）。传入即视为该功能已启用，渲染对应按钮。 */
  readonly onRejectStep?: (planStepId: string) => void;
}

/**
 * F978 —— S4 确认门 + issue #2665 计划卡片两态。
 *
 * ⚠ **条件性从不入 DOM，不是 display:none**——三种"不渲染任何计划/确认 UI"的路径
 * （`!gate.required && !gate.deliverPlan`，涵盖旧有 `no-plan`/`single-step`）
 * 都直接 `return null`，同 `plan-confirm-gate.tsx` 原有纪律（`usecases.md` UC-8
 * 反证③）不变。
 */
export function PlanConfirmGate(
  {
    gate, steps = [], externalStepIds, onConfirmRun, onContinueEditing, onPauseOrAdjust,
    onAdjustStep, onRejectStep,
  }: PlanConfirmGateProps,
): React.JSX.Element | null {
  if (gate.required) {
    return (
      <PendingConfirmPlanCard
        gate={gate}
        steps={steps}
        externalStepIds={externalStepIds}
        onConfirmRun={onConfirmRun}
        onContinueEditing={onContinueEditing}
        onAdjustStep={onAdjustStep}
        onRejectStep={onRejectStep}
      />
    );
  }

  if (gate.deliverPlan) {
    return <AutoDeliveredPlanCard steps={steps} onPauseOrAdjust={onPauseOrAdjust} />;
  }

  return null;
}
