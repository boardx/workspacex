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
import { describePlanFailureReason } from "@/lib/plan-control-copy";

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
 * 3. **失败态的"哪一步"仍是猜的，"为什么失败"issue #2451 已补上**：`getPlanLedger.out`
 *    仍然没有 `failedStepId`（`PlanStep.status` 封闭三值 `pending/in_progress/
 *    completed`，不含 `failed`）——`PlanFailureRecovery` 的 `failedStepIndex`/
 *    `failedStepLabel` 仍用"第一个未完成的步骤"做尽力猜测，这半个缺口还在。但
 *    `reason` 不再是写死的占位句：`getPlanLedger.errorCode`（`agent_runs.error_code`
 *    透传）经 `lib/plan-control-copy.ts` 的 `describePlanFailureReason` 翻成人话，
 *    只有 `errorCode` 为 null/不在枚举内时才退回原来那句诚实的通用兜底。
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
  /**
   * issue #2451 —— `copilotkit-v2-panel.tsx` 的 `RUN_ERROR` 订阅（"模型这次没能
   * 返回可用结果"横幅）每次触发都把这个数改一下（自增计数器）。本组件用它做两件事：
   * ① 立刻抢一次 `refetch()`，不用等最多 3 秒的轮询窗口；② 在 `refetch()` 追上真实
   * `phase`（翻到 `"failed"`）之前，把这段时间标成"最近报错"，喂给 `PlanRunProgress`
   * 的 `hasRecentError`，别让暂停按钮继续装作一切正常。不传（`undefined`）时行为
   * 与改动前完全一致——纯粹是轮询节奏和一个展示态，没有新起对错误状态的第二次判定。
   */
  readonly refetchSignal?: number;
}

export function CopilotKitV2PlanControl(
  { threadId, refetchSignal }: CopilotKitV2PlanControlProps,
): React.JSX.Element | null {
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

  // issue #2451 —— `refetchSignal` 每变一次（父组件的 `RUN_ERROR` 订阅触发），立刻
  // 抢一次 refetch，并把这次报错标成"最近报错"；同样在离开 executing 态时清掉——
  // 与上面 `pausedLocally` 是同一条纪律，不让上一轮的报错印记残留到下一轮。
  const [recentErrorTick, setRecentErrorTick] = React.useState<number | null>(null);
  const prevRefetchSignalRef = React.useRef(refetchSignal);
  React.useEffect(() => {
    if (refetchSignal === undefined || refetchSignal === prevRefetchSignalRef.current) return;
    prevRefetchSignalRef.current = refetchSignal;
    setRecentErrorTick(refetchSignal);
    void refetch();
  }, [refetchSignal, refetch]);
  React.useEffect(() => {
    if (ledger?.phase !== "executing") setRecentErrorTick(null);
  }, [ledger?.phase]);
  const hasRecentError = recentErrorTick !== null;

  // 折叠开关：默认展开。needsDecision 从 false→true 的那次转变自动展开——
  // 用户上一轮手动折叠，不该让 ta 错过下一次真正需要确认/处理失败的时刻。
  const [collapsed, setCollapsed] = React.useState(false);
  //
  // ⚠ 合并注：原写法是 `gate.required && phase !== "executing"`，与下面渲染
  // `PlanConfirmGate` 的条件（`phase === "planning"`）不是同一个判据——`gate.
  // required` 在 `phase:"done"` 之后仍恒为 true（见下面确认门那段头注：
  // `evaluatePlanGate` 只看 todoCount，不知道 run 跑完没跑完），会导致任务
  // 已经完成、用户手动折叠了面板，却又被这里强制重新展开成一个没有确认门、
  // 只剩只读步骤列表的面板——比原来的"卡片残留"轻，但仍是同一个根因的余震。
  // 改成与确认门渲染条件同源：只有「计划阶段确实要确认」或「失败态确实要处理」
  // 才算需要决策，"done" 不再触发强制展开。
  const needsDecision = ledger !== null && (
    ledger.phase === "failed" || (ledger.phase === "planning" && ledger.gate.required)
  );
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
          // issue #2451 —— 真实失败原因（`agent_runs.error_code` 经 `getPlanLedger.errorCode`
          // 透传），不再是写死的占位句。`errorCode` 为 null 或不在枚举内时，
          // `describePlanFailureReason` 自己退回同一句诚实兜底，不在这里再判一次。
          reason={describePlanFailureReason(ledger.errorCode)}
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
          hasRecentError={hasRecentError}
        />
      )}

      {/*
       * issue #2451 —— 真实截图抓到的矛盾：`phase==="done"`（阶段条显示"完成"）
       * 但 `ledger.steps` 里仍有步骤是 `pending`/`in_progress`（阶段派生只看
       * `agent_runs.status`，见 `derivePlanPhase` I-7，不检查 `PlanStep.status`——
       * 这两者是 write_todos 快照与 run 终态两条独立写路径，最常见的成因是模型
       * 收尾时没有再调用一次 write_todos 把所有步骤标 completed）。这里不悄悄把
       * 步骤状态改成"已完成"（那是编造数据，不是修复展示），只如实提示这个已知的
       * 账本滞后现象，让阶段条和下面的步骤列表不再无声互相矛盾。
       */}
      {!collapsed && ledger.phase === "done" && ledger.progress.completed < ledger.progress.total && (
        <p
          role="status"
          data-testid="chat-task-workbench-plan-done-incomplete-notice"
          className="text-11 text-muted-foreground"
        >
          本轮执行已结束，但计划账本里还有 {ledger.progress.total - ledger.progress.completed} 步没有被标记完成——
          大概率是模型收尾时没有再同步一次进度，不代表这些步骤真的没做，可展开下方步骤自行核对。
        </p>
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

      {/*
       * 🔴 真栈实测发现的缺口（如实登记，不是硬套契约）：`evaluatePlanGate`
       * （`packages/contracts/src/plan-control.ts` UC-8）按契约**只看 `todoCount`**，
       * 完全不知道这一轮 run 有没有已经跑完——一个 4 步计划的 `gate.required` 从
       * 确认前到执行中到 `phase:"done"` 之后**恒为 `true`**，因为 `todoCount` 从
       * 头到尾没变过。契约本身没错（它就是纯函数、UC-8 反证只要求"简单提问不加
       * 确认门"），错在这里：`gate` 是"要不要在**开始执行前**问一下"的判定，
       * 不是"现在还要不要显示这张卡"，而组件此前不加区分地把它渲染在每个 phase 下，
       * 于是任务做完了、卡片却和执行前长得一模一样，用户以为"没结束"。
       *
       * 修法是**只在 `phase === "planning"`**（即 `derivePlanPhase` 里那个
       * "有计划、run 还没起、没有失败、没有待审批"的态）渲染确认门——这正是
       * UC-8 判据四原本要挡的那个时刻：执行开始之前。一旦进了 `executing`/
       * `approving`/`done`/`failed`，"确认并执行"这个动作本身就不再有意义
       * （run 已经在跑或已经跑完），继续渲染这张卡是界面在说谎，不是加了一层
       * 保险。不改 `evaluatePlanGate` 本身——它仍然如实回答"这份计划要不要
       * 确认"，只是本组件不再对着一个已经过去的阶段问这个问题。
       *
       * `!collapsed` 是折叠开关（同一批合入 main 的独立改动）：折叠态下整块
       * 都不渲染，与 `phase === "planning"` 是两个独立的必要条件，不是二选一
       * ——`needsDecision` 已经保证 gate.required 时不会停在折叠态上，这里
       * 只是同时满足"没折叠"与"确实到了该问的那个阶段"。
       */}
      {!collapsed && ledger.phase === "planning" && (
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
