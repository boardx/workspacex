"use client";
import * as React from "react";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanPhaseIndicator } from "@/components/plan-control/plan-phase-indicator";
import { PlanPanelReadOnly } from "@/components/plan-control/plan-panel-readonly";
import { PlanPanelEdit, PlanPendingApplyBanner, OrphanConstraintNotice } from "@/components/plan-control/plan-panel-edit";
import { PlanConfirmGate } from "@/components/plan-control/plan-confirm-gate";
import { PlanRunProgress } from "@/components/plan-control/plan-run-progress";
import { PlanFailureRecovery } from "@/components/plan-control/plan-failure-recovery";
import {
  addPlanConstraint, confirmPlan, deletePlanStep, pausePlanRun,
  planControlErrorCode, removePlanConstraint, reorderPlanStep, resumePlanRun, retryPlanStep,
} from "@/lib/plan-control-api";
import { usePlanLedgerPolling } from "@/lib/use-plan-ledger-polling";

/**
 * F972-F978（plan-control 契约束）接入 `copilotkit-v2-panel.tsx` 真实聊天渲染树。
 *
 * ## 为什么是独立文件，不是加进 `copilotkit-v2-panel.tsx`
 *
 * 同 `copilotkit-v2-agent-interrupts.tsx`（issue #2179）的既有理由：宿主文件已经
 * 2600+ 行、多条在途分支同时改动。不同的是本组件**不是**渲染 `null` 的
 * `useHumanInTheLoop` 登记——`plan-control` 的六个屏是消息流顶部一块真实可见的
 * UI（`ui.md` 判据一～六），不经由 CopilotKit 的工具渲染登记表，而是直接 `fetch`
 * `plan-control.controller.ts` 的 HTTP 面（`lib/plan-control-api.ts`）。挂载方式仍是
 * 同一条纪律：作为 provider 子树里的一个独立组件，紧邻 `<CopilotKitV2AgentInterrupts />`。
 *
 * ## 数据源：轮询 `getPlanLedger`，不是订阅 AG-UI 事件流
 *
 * `write_todos` 落账本（UC-2 `ingestEnginePlanSnapshot`）发生在 Node 侧
 * （`copilotkit-agui.controller.ts:389-392`），前端拿不到这个写入的实时推送——
 * 与 `copilotkit-v2-run-progress.ts` 现有的"轮询兜底"是同一类取舍（`sessionToken`
 * 自愈同样用 `window.setInterval`，`copilotkit-v2-panel.tsx:1371`）。3 秒轮询，
 * 卸载/threadId 变化时清理，不在无线程时空转。轮询逻辑本身抽在
 * `lib/use-plan-ledger-polling.ts`（issue #2260）——右侧任务检查器
 * （`chat-task-inspector.tsx`）的「进度」页签共用同一个 hook，读同一张账本，
 * 不再各自维护一套"现在到哪一步了"的判断。
 *
 * ## 已发现、如实登记、没有硬套的三处设计缺口（不在本轮范围内擅自补）
 *
 * 1. **"编辑计划"切换态按钮不存在于已建成组件**：`ui.md` S2 描述"面板右上一个
 *    『编辑计划』按钮"，但 `plan-panel-readonly.tsx`/`plan-panel-edit.tsx` 两个真实
 *    组件都不含这个按钮（`plan-control-screens.tsx` 那个 mock 预览里才有）——
 *    真实组件把"读/编两态用什么触发切换"留给宿主组装。这里补一个最小实现
 *    （复用同一个 testid，方便未来任何断言直接对得上）。
 * 2. **"撤销删除"没有对应的后端操作**：`ui.md` 2.2 节写"撤销就是一次基于旧
 *    revision 的重放"，但 `usecases.md`/`plan-control.ts` 的四个编辑 UC（UC-3…UC-6）
 *    里没有一个"插入/恢复步骤"的操作——`deletePlanStep`（UC-4）不可逆。
 *    `PlanPanelEdit` 的 `justRemoved`/`onUndoRemove` props 因此在这里**不接**：
 *    接一个点了不会真的撤销的按钮，正是 TW 卡"反伪造条款"要挡的那种假交互。
 * 3. **失败态的"哪一步、为什么失败"读不到**：`getPlanLedger.out` 没有
 *    `failedStepId`/失败原因字段（`PlanStep.status` 封闭三值 `pending/in_progress/
 *    completed`，不含 `failed`）。`PlanFailureRecovery` 需要 `failedStepIndex`/
 *    `failedStepLabel`/`reason` 三个 prop——这里用"第一个未完成的步骤"做尽力猜测、
 *    `reason` 给一句如实的通用文案，不编一个看似精确实则编造的原因。
 *
 * ## 人类 2026-08-29 直接反馈：挂载位置改到 composer 上方 + 加折叠
 *
 * `ui.md` S1 原文"落在消息流顶部"的读法是"计划态跨整条对话、不该随消息滚走"——
 * 这条不变量没有变。人类当场反馈的是**顶部固定占屏**这一件具体呈现：改到贴着
 * composer（消息列表下方、输入框上方），同样不随消息滚动，但离用户当前视线
 * （正在打字/正在看的地方）更近；并加一个折叠开关，默认展开，折叠只留
 * `PlanPhaseIndicator` 一行——这是"简化界面"的落点：折叠态不隐藏计划存在与否，
 * 只收起步骤明细/编辑/确认门这些只在需要决策时才用得上的内容。**需要用户决策的
 * 状态（`gate.required` 或 `phase === "failed"`）从别的态转入时自动展开**，不让
 * 用户因为上一轮手动折叠而错过下一次真正需要确认/处理失败的时刻。挂载点搬动见
 * `copilotkit-v2-panel.tsx` 对应改动的注释。
 */

export const PLAN_CONTROL_EDIT_TOGGLE_TESTID = "chat-task-workbench-plan-edit-toggle";
export const PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID = "chat-task-workbench-plan-collapse-toggle";

export interface CopilotKitV2PlanControlProps {
  /** 真实 `chat_threads.id`——`copilotkit-v2-panel.tsx` 里的 `resolvedChatThreadId`
   *  state（不是 `chatThreadIdRef`：这里需要在渲染期知道值，同 issue #2052 的既有理由，
   *  见该文件对 `resolvedChatThreadId` 的头注）。`null` 时（新对话尚未发出第一条消息）
   *  不渲染——线程还不存在，没有账本可读。 */
  readonly threadId: string | null;
}

export function CopilotKitV2PlanControl({ threadId }: CopilotKitV2PlanControlProps): React.JSX.Element | null {
  const { ledger, refetch } = usePlanLedgerPolling(threadId);
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [actionErrorCode, setActionErrorCode] = React.useState<string | null>(null);
  /**
   * 缺口 4（如实登记，未硬套）：`getPlanLedger.out` 不暴露"当前 run 是否已被暂停"
   * （`PlanRunSnapshot.pausedAt` 存在于 `PlanRunStatusReader` 端口，但
   * `get-plan-ledger.ts` 没有把它投影进读模型——`derivePlanPhase` 把 running 和
   * interrupted/paused 都折进同一个 `"executing"` 态）。真正的服务端派生值补全前，
   * 这里退而求其次：暂停/恢复成功后各自把这个 state 板正过来，反映"我最后一次点的
   * 是哪个"，不是真正跨会话/多端一致的服务端状态——如实是一个近似，不是编造。
   */
  const [pausedLocally, setPausedLocally] = React.useState(false);

  // 离开 executing 态（完成/失败/新一轮重新进入 planning）时清掉本地"暂停"近似值——
  // 不让上一轮 run 的暂停印记残留到下一轮。
  React.useEffect(() => {
    if (ledger?.phase !== "executing") setPausedLocally(false);
  }, [ledger?.phase]);

  // 折叠开关：默认展开。needsDecision 从 false→true 的那次转变自动展开——
  // 用户上一轮手动折叠，不该让 ta 错过下一次真正需要确认/处理失败的时刻。
  const [collapsed, setCollapsed] = React.useState(false);
  const needsDecision = ledger !== null && (ledger.phase === "failed" || (ledger.gate.required && ledger.phase !== "executing"));
  const prevNeedsDecisionRef = React.useRef(needsDecision);
  React.useEffect(() => {
    if (needsDecision && !prevNeedsDecisionRef.current) setCollapsed(false);
    prevNeedsDecisionRef.current = needsDecision;
  }, [needsDecision]);

  async function runAction(action: () => Promise<unknown>): Promise<boolean> {
    setBusy(true);
    setActionErrorCode(null);
    try {
      await action();
      await refetch();
      return true;
    } catch (e) {
      // PLAN_REVISION_CHANGED 等错误：立即重取最新账本，让用户在新版本基础上重试，
      // 不是把陈旧的本地状态继续晾在界面上。
      setActionErrorCode(planControlErrorCode(e) ?? "PLAN_ACTION_FAILED");
      await refetch();
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (threadId === null || ledger === null || ledger.phase === "preparing") return null;

  const tid = threadId; // 上面已判非空，供下面闭包按非空类型使用。
  const revision = ledger.revision;

  const handleReorder = (planStepId: string, toIndex: number): void => {
    void runAction(() => reorderPlanStep(tid, { basedOnRevision: revision, planStepId, toIndex }));
  };
  const handleDelete = (planStepId: string): void => {
    void runAction(() => deletePlanStep(tid, { basedOnRevision: revision, planStepId }));
  };
  const handleAddConstraint = (planStepId: string, text: string): void => {
    void runAction(() => addPlanConstraint(tid, { basedOnRevision: revision, planStepId, text }));
  };
  const handleRemoveConstraint = (constraintId: string): void => {
    void runAction(() => removePlanConstraint(tid, { basedOnRevision: revision, constraintId }));
  };
  const handleConfirm = (): void => {
    void runAction(() => confirmPlan(tid, { basedOnRevision: revision }));
  };
  const handlePause = (): void => {
    void runAction(() => pausePlanRun(tid)).then((ok) => { if (ok) setPausedLocally(true); });
  };
  const handleResume = (): void => {
    void runAction(() => resumePlanRun(tid)).then((ok) => { if (ok) setPausedLocally(false); });
  };
  const handleRetryStep = (planStepId: string): void => {
    void runAction(() => retryPlanStep(tid, { planStepId }));
  };

  const runningStepIndex = ledger.steps.findIndex((s) => s.status !== "completed");
  const currentStepIndex = runningStepIndex === -1 ? ledger.steps.length : runningStepIndex + 1;
  const currentStep = ledger.steps[runningStepIndex === -1 ? ledger.steps.length - 1 : runningStepIndex];

  return (
    <div data-testid="chat-task-workbench-plan-control" className="mb-3 flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          data-testid={PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID}
          aria-label={collapsed ? "展开计划面板" : "折叠计划面板"}
          onClick={() => setCollapsed((v) => !v)}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-control text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? <ChevronRight aria-hidden className="h-4 w-4" /> : <ChevronDown aria-hidden className="h-4 w-4" />}
        </button>
        <PlanPhaseIndicator phase={ledger.phase} />
        {!collapsed && ledger.phase !== "failed" && ledger.steps.length > 0 && (
          <Button
            size="xs"
            variant={editing ? "primary" : "outline"}
            className="ml-auto"
            data-testid={PLAN_CONTROL_EDIT_TOGGLE_TESTID}
            onClick={() => setEditing((v) => !v)}
          >
            <Pencil aria-hidden className="h-3 w-3" />
            {editing ? "完成编辑" : "编辑计划"}
          </Button>
        )}
      </div>

      {!collapsed && actionErrorCode !== null && (
        <p role="status" className="text-11 text-destructive" data-testid="chat-task-workbench-plan-action-error">
          {actionErrorCode === "PLAN_REVISION_CHANGED"
            ? "计划刚被更新，已刷新到最新版本——请基于当前状态重试这次修改。"
            : `操作未完成（${actionErrorCode}）`}
        </p>
      )}

      {!collapsed && ledger.phase === "failed" && currentStep && (
        <PlanFailureRecovery
          failedStepIndex={currentStepIndex}
          failedStepLabel={currentStep.content}
          reason="执行未完成——账本读模型目前不提供更具体的失败原因，可重试该步或修改输入后重新确认。"
          onRetryStep={() => handleRetryStep(currentStep.planStepId)}
          onEditInput={() => setEditing(true)}
        />
      )}

      {!collapsed && ledger.phase === "executing" && currentStep && (
        <PlanRunProgress
          currentStepLabel={currentStep.content}
          stepIndex={currentStepIndex}
          stepTotal={ledger.steps.length}
          elapsedMs={ledger.progress.elapsedMs}
          isPaused={pausedLocally}
          onPause={handlePause}
          onResume={handleResume}
        />
      )}

      {!collapsed && ledger.pendingApplyAtNextRun && <PlanPendingApplyBanner onPauseNow={handlePause} />}

      {!collapsed && (editing ? (
        <PlanPanelEdit
          steps={ledger.steps}
          onReorder={handleReorder}
          onDelete={handleDelete}
          onAddConstraint={handleAddConstraint}
          onRemoveConstraint={handleRemoveConstraint}
        />
      ) : (
        <PlanPanelReadOnly steps={ledger.steps} />
      ))}

      {!collapsed && ledger.orphanedConstraints.map((c) => (
        <OrphanConstraintNotice
          key={c.constraintId}
          text={c.text}
          formerStepContent={c.formerStepContent}
          onRemove={() => handleRemoveConstraint(c.constraintId)}
        />
      ))}

      {!collapsed && (
        <PlanConfirmGate
          gate={ledger.gate}
          onConfirmRun={handleConfirm}
          onContinueEditing={() => setEditing(true)}
        />
      )}

      {busy && <span className="sr-only" role="status">计划操作处理中…</span>}
    </div>
  );
}
