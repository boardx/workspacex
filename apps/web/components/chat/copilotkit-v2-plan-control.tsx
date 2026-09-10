"use client";
import * as React from "react";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PlanPanelReadOnly } from "@/components/plan-control/plan-panel-readonly";
import { PlanPanelEdit, PlanPendingApplyBanner, OrphanConstraintNotice } from "@/components/plan-control/plan-panel-edit";
import { PlanConfirmGate } from "@/components/plan-control/plan-confirm-gate";
import { PlanRunProgress, PLAN_RUN_PAUSE_TESTID, PLAN_RUN_RESUME_TESTID } from "@/components/plan-control/plan-run-progress";
import { derivePlanSurface, deriveRunControls, deriveRunStatusView } from "@repo/contracts/plan-control";
import { PlanFailureRecovery } from "@/components/plan-control/plan-failure-recovery";
import { PlanPhaseIndicator } from "@/components/plan-control/plan-phase-indicator";
import {
  addPlanConstraint, confirmPlan, confirmProposedPlan, deletePlanStep, pausePlanRun,
  planControlErrorCode, removePlanConstraint, reorderPlanStep, resumePlanRun, retryPlanStep,
} from "@/lib/plan-control-api";
import { usePlanLedgerPolling } from "@/lib/use-plan-ledger-polling";
import { CHAT_RUN_PAUSE_ENTRY_ENABLED } from "@/lib/chat-run-pause-entry";
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
 * 3. **失败态的"哪一步、为什么失败"issue #2451 已补齐**（此前登记的缺口，现已
 *    落地，不再是遗留）：`getPlanLedger.out.failedStepId` 取最新账本快照里
 *    `status==='in_progress'` 的那一步（run 死掉那一刻仍在跑的那一步，`PlanStep.
 *    status` 仍是封闭三值 `pending/in_progress/completed`，不含 `failed`——不是给
 *    这三态加第四态，而是从既有信号里挑出真实对应的那一个），只有连 `in_progress`
 *    都取不到（run 在第一步真正开始前就死了）才退回第一个 `pending` 步骤；
 *    `PlanFailureRecovery` 的 `failedStepIndex`/`failedStepLabel` 因此改用它，不再靠
 *    "第一个未完成的步骤"硬猜（见下方 `failedStepIndex`/`failedStep` 的计算处）。
 *    `reason` 同样不是写死的占位句：`getPlanLedger.errorCode`（`agent_runs.error_code`
 *    透传）经 `lib/plan-control-copy.ts` 的 `describePlanFailureReason` 翻成人话，
 *    只有 `errorCode` 为 null/不在枚举内时才退回原来那句诚实的通用兜底。
 *
 * ## 人类 2026-08-29 直接反馈：挂载位置改到 composer 上方 + 加折叠
 *
 * `ui.md` S1 原文"落在消息流顶部"的读法是"计划态跨整条对话、不该随消息滚走"——
 * 这条不变量没有变。人类当场反馈的是**顶部固定占屏**这一件具体呈现：改到贴着
 * composer（消息列表下方、输入框上方），同样不随消息滚动，但离用户当前视线
 * （正在打字/正在看的地方）更近；并加一个折叠开关，普通计划默认折叠，折叠只留
 * 真实进度摘要一行——这是"简化界面"的落点：折叠态不隐藏计划存在与否，
 * 只收起步骤明细/编辑/确认门这些只在需要决策时才用得上的内容。**需要用户决策的
 * 状态（`gate.required` 或 `phase === "failed"`）从别的态转入时自动展开**，不让
 * 用户因为上一轮手动折叠而错过下一次真正需要确认/处理失败的时刻。挂载点搬动见
 * `copilotkit-v2-panel.tsx` 对应改动的注释。
 */

export const PLAN_CONTROL_EDIT_TOGGLE_TESTID = "chat-task-workbench-plan-edit-toggle";
/**
 * 计划面板的滚动容器盒模型只声明一次——`e2e/fixtures/plan-panel-scroll-fixture.tsx`
 * 引用它量真几何，不抄第二份（抄一份的话夹具会永远量到"旧的正确答案"）。
 */
export const PLAN_CONTROL_SCROLLER_CLASS =
  "flex max-h-48 shrink-0 flex-col gap-2 overflow-y-auto overscroll-contain md:max-h-64";
export const PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID = "chat-task-workbench-plan-collapse-toggle";

export interface CopilotKitV2PlanControlProps {
  /** 真实 `chat_threads.id`——`copilotkit-v2-panel.tsx` 里的 `resolvedChatThreadId`
   *  state（不是 `chatThreadIdRef`：这里需要在渲染期知道值，同 issue #2052 的既有理由，
   *  见该文件对 `resolvedChatThreadId` 的头注）。`null` 时（新对话尚未发出第一条消息）
   *  不渲染——线程还不存在，没有账本可读。 */
  readonly threadId: string | null;
  readonly projectId?: string | null;
  readonly canWrite?: boolean;
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

export function CopilotKitV2PlanControl(props: CopilotKitV2PlanControlProps): React.JSX.Element {
  return <PlanControlSession key={JSON.stringify([props.threadId, props.projectId ?? null])} {...props} />;
}

function PlanControlSession(
  { threadId, projectId, canWrite = true, refetchSignal }: CopilotKitV2PlanControlProps,
): React.JSX.Element | null {
  const { ledger, refetch } = usePlanLedgerPolling(threadId, projectId);
  const [editing, setEditing] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [actionErrorCode, setActionErrorCode] = React.useState<string | null>(null);
  // Pause state comes only from the durable ledger, including after refresh.
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

  // 折叠开关：默认折叠。needsDecision 从 false→true 的那次转变自动展开——
  // 用户上一轮手动折叠，不该让 ta 错过下一次真正需要确认/处理失败的时刻。
  const [collapsed, setCollapsed] = React.useState(true);
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
    ledger.phase === "failed" || ledger.phase === "approving" || ledger.pendingApplyAtNextRun || ledger.orphanedConstraints.length > 0 || (ledger.phase === "planning" && ledger.gate.required)
  );
  const prevNeedsDecisionRef = React.useRef(needsDecision);
  React.useEffect(() => {
    if (needsDecision && !prevNeedsDecisionRef.current) setCollapsed(false);
    prevNeedsDecisionRef.current = needsDecision;
  }, [needsDecision]);

  async function runAction(action: () => Promise<unknown>): Promise<boolean> {
    if (!canWrite) return false;
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

  // issue #3099 —— **运行级控制与计划级视图解耦**。判据只有一个：run 现在还在不在
  // （`deriveRunControls`，契约里的单一事实源），与「模型有没有产出 `write_todos`」无关。
  //
  // 改动前这里读的是 `phase`：当时 `derivePlanPhase` 先判 `ledgerEmpty` 再判 `running`，
  // 于是「正在跑但还没有计划的 run」（大量普通对话）和「什么都没发生的线程」
  // 都是 `"preparing"`——整块 return null，用户没有任何暂停入口。这不是把渲染门
  // 「放宽」，是它此前问错了问题：暂停是 run 级动作，不该由计划账本的存在性决定。
  //
  // ⚠ #3208 已把那条顺序修正（在途 run 的 `phase` 现在是 `"executing"`），但**这里
  // 仍然只读 `deriveRunControls`**：run 的在途性只许有一个事实源。不要因为 `phase`
  // 现在"也对了"就把门改回读 `phase`——那就是把同一事实重新声明到第二处。
  //
  // ⚠ 终态（done/cancelled/failed）不受影响：`deriveRunControls` 对终态返回全 false，
  // #2927 的「run 结束后没有控制操作」与 #2999 的只读账本两条都不变。
  const runControls = deriveRunControls({ runStatus: ledger?.runStatus ?? "idle" });
  const runLive = runControls.canPause || runControls.canResume;
  const hasPlanAction = ledger !== null && ((ledger.phase === "planning" && ledger.gate.required)
    || ledger.pendingApplyAtNextRun || ledger.orphanedConstraints.length > 0);
  if (threadId === null || ledger === null) return null;

  /*
   * issue #3321 —— **本组件对「计划区要不要出现在屏幕上」不再有任何自己的判断。**
   *
   * 改动前这份判定散在五处早退里，与契约里的 `shouldSurfacePlanPhaseIndicator`
   * 构成两个事实源，已实测产出两处硬矛盾（见 `derivePlanSurface` 头注 1 / 2），
   * 其中「`gate.required` 被裸读，导致终态卸载门永不触发」正是人类两次反馈
   * 「plan panel 平常时间不要显示」的直接根因。
   *
   * ⚠ 不要在下面任何地方新增 `return null` 或别的可见性条件——那就是把这份判定
   * 重新声明到第二处。宿主只许 `switch (surface.kind)`。
   * 由 `.harness/scripts/lint-plan-surface-single-source.test.ts` 机械门控。
   */
  const surface = derivePlanSurface({
    phase: ledger.phase,
    runStatus: ledger.runStatus,
    stepCount: ledger.steps.length,
    gateRequired: ledger.gate.required,
    pendingApplyAtNextRun: ledger.pendingApplyAtNextRun,
    orphanedConstraintCount: ledger.orphanedConstraints.length,
    paused: Boolean(ledger.pausedAt),
    pauseRequested: Boolean(ledger.pauseRequestedAt),
    progressCompleted: ledger.progress.completed,
    progressTotal: ledger.progress.total,
    hasActionError: actionErrorCode !== null,
  });

  /*
   * issue #3365 —— **「这条 run 现在处于什么状态」的唯一派生处**（`deriveRunStatusView`）。
   *
   * 改动前这份事实散在四处，各读各的量：折叠头的 `stateLabel` 三元、进度卡的
   * `findIndex(!completed)` + 全完成兜底取最后一条、进度条的 `stepIndex - 1`、
   * 阶段条的 `ledger.phase`。人类 2026-09-10 实测的一屏五处矛盾正是它们的合成结果
   * （真实权威读账本逐字见 issue #3365）。
   *
   * ⚠ 不要在下面任何地方再算一次状态文字 / 当前步骤 / 进度分子——那就是把同一事实
   * 重新声明到第二处。由 `.harness/scripts/lint-run-status-view-single-source.test.ts` 门控。
   */
  const statusView = deriveRunStatusView({
    phase: ledger.phase,
    runStatus: ledger.runStatus,
    stepStatuses: ledger.steps.map((s) => s.status),
    progressCompleted: ledger.progress.completed,
    progressTotal: ledger.progress.total,
    paused: Boolean(ledger.pausedAt),
    pauseRequested: Boolean(ledger.pauseRequestedAt),
    gateRequired: ledger.gate.required,
    hasRecentError,
    pauseEntryEnabled: CHAT_RUN_PAUSE_ENTRY_ENABLED,
  });

  const tid = threadId; // 上面已判非空，供下面闭包按非空类型使用。
  const revision = ledger.revision;

  const handleReorder = (planStepId: string, toIndex: number): void => {
    void runAction(() => reorderPlanStep(tid, { basedOnRevision: revision, planStepId, toIndex }, projectId));
  };
  const handleDelete = (planStepId: string): void => {
    void runAction(() => deletePlanStep(tid, { basedOnRevision: revision, planStepId }, projectId));
  };
  const handleAddConstraint = (planStepId: string, text: string): void => {
    void runAction(() => addPlanConstraint(tid, { basedOnRevision: revision, planStepId, text }, projectId));
  };
  const handleRemoveConstraint = (constraintId: string): void => {
    void runAction(() => removePlanConstraint(tid, { basedOnRevision: revision, constraintId }, projectId));
  };
  /**
   * issue #3132（B7）—— 「确认并执行」有**两条**语义不同的路径，按 `stepsAreProposal`
   * 分流。走错分支会多起一条 run（人类 2026-09-08 裁决 O-2 明确切开）：
   *
   * - `stepsAreProposal === true`（run 正停在 `write_todos` 计划确认中断上，账本为空）：
   *   **恢复停住的那条 run** —— `decidePermissionRequest(once)`。
   * - 否则（账本里已有计划、run 已结束或从未起过）：沿用既有 `confirmPlan`
   *   （`createConfirmedRun`，新起一条 run 去执行账本里的计划），语义逐字不变。
   *
   * ⚠ `pendingPermissionRequestId` / `activeRunId` 任一为空时**不回退到 `confirmPlan`**：
   * 那会在「引擎正停着等确认」的时刻悄悄另起一条 run，是比按钮无反应更坏的形态。
   * 这里如实报一个失败码，让用户看见「这次确认没送出去」。
   */
  const handleConfirm = (): void => {
    if (ledger.stepsAreProposal) {
      const requestId = ledger.pendingPermissionRequestId;
      const runId = ledger.activeRunId;
      if (requestId === null || runId === null) {
        setActionErrorCode("PLAN_ACTION_FAILED");
        return;
      }
      void runAction(() => confirmProposedPlan(runId, requestId));
      return;
    }
    void runAction(() => confirmPlan(tid, { basedOnRevision: revision }, projectId));
  };
  const handlePause = (): void => {
    void runAction(() => pausePlanRun(tid, projectId));
  };
  const handleResume = (): void => {
    void runAction(() => resumePlanRun(tid, projectId));
  };
  // issue #3132 —— `planStepId === null` = 重试整轮任务（这条 run 从未产出过计划步骤）。
  const handleRetryStep = (planStepId: string | null): void => {
    void runAction(() => retryPlanStep(tid, { planStepId }, projectId));
  };
  // issue #3132 —— 「修改输入」在有计划时是进编辑态；**没有计划步骤时编辑态是空的**，
  // 那就成了点了没有任何效果的假按钮。无计划时改为把焦点交回 composer，让用户就地
  // 改写这次输入重发——这是这种失败形状下"修改输入"唯一真实存在的动作。
  const handleEditInput = (): void => {
    if (ledger.steps.length > 0) { setCollapsed(false); setEditing(true); return; }
    const composer = document.querySelector<HTMLElement>('[data-testid="copilotkit-v2-input"]');
    composer?.scrollIntoView?.({ block: "nearest" });
    composer?.focus();
  };

  /*
   * issue #3132 —— 六态指示器此前**从来没有被挂进 /chat**（消费方只有单测与
   * `/preview`），`chat-task-workbench-phase-indicator` 在真实页面上不存在。
   * 它读的是 `getPlanLedger.phase` 直出（I-7，前端不重算）。
   *
   * issue #3208（裁决：方案 A「按需渲染 + 收进折叠头」）+ #3214 —— 挂载**不再无条件**。
   *
   * #3132 那句"挂在所有分支之前，包括什么都还没发生的新线程（phase: preparing）"
   * 正是 #3214 的现场：全新空白会话（没有任何 run）底部照样显示一条高亮着「准备」
   * 的阶段条。#3208 ① 把 `preparing` 的含义收窄为「无在途 run 且无计划」之后，空白
   * 会话**仍然**落在 `preparing`——所以那条修正救不了这里，只能由渲染条件解决。
   *
   * 判据只有一个输入：`ledger.phase`，也就是指示器自己要显示的那个值
   * （`shouldSurfacePlanPhaseIndicator`，契约里的单一事实源）。**刻意不再从
   * `runStatus` / `steps.length` 另推一次"现在算不算需要"**——那就是把同一事实
   * 声明到第二处，本仓今晚已因此出过五次事故（#3207/#3220 同一形态）。
   *
   * ⚠ 隐藏的只是**常驻**，不是可触达性：下面主面板里 `!collapsed` 时照样渲染，
   * 折叠头（`PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID`，那行 `执行计划 · <stateLabel>`）
   * 就是用户随时把它调出来的入口。能力面（暂停/继续执行）一个字没动，仍在原处
   * ——#3081/F3 刚把暂停修到第一次真的可点，不许由这次改动带回不可触达。
   */
  const phaseIndicator = <PlanPhaseIndicator phase={ledger.phase} />;
  const indicator = surface.pinIndicator ? phaseIndicator : null;

  /*
   * issue #3132 —— 原先这里（连同上面的 threadId/ledger 判空）整块 `return null`。
   * 于是「失败但从未产出计划的 run」——steps 为空、终态所以 `runLive===false`、
   * failed 态下 `hasPlanAction` 也为 false——三条同时成立，用户拿不到任何恢复入口。
   * 失败态因此显式排除在这条卸载门之外：**失败一定要有可操作入口**（coordinator
   * 裁决 ②）。其余"无事发生"的形状仍只留一行阶段指示器，不凭空造计划面板。
   */
  if (surface.kind === "hidden") return null;
  if (surface.kind === "indicator-only") return indicator;

  // issue #2999 —— run 结束（done/cancelled）后**保留只读账本**，不再整块 return null。
  //
  // #2927（f9afc3d63）在这里加过 `return null`，理由是"完成历史属于持久执行轨迹"。
  // 但同一提交把 `workbench/task-timeline.tsx` 的 `write_todos` 也渲染成 null——
  // 那条轨迹从此不再画计划。两处相加 = run 结束后计划痕迹归零，而且 #2451 那条
  // `chat-task-workbench-plan-done-incomplete-notice`（`phase === "done"` 门控）
  // 结构上不可达。coordinator 裁决（#2999）：这是回归，不是设计。
  //
  // 恢复的是**展示**，不是控制：#2927 真正要挡的"任务已结束、界面却和执行前长得
  // 一模一样（还能勾选/编辑/确认）"仍然被挡住——下面 `readOnlyLedger` 为真时
  // 不渲染「编辑计划」开关、强制走 `PlanPanelReadOnly`；`PlanConfirmGate` 只在
  // `phase === "planning"`、`PlanRunProgress` 只在 `phase === "executing"` 渲染，
  // 本来就不会在结束态出现。`hasPlanAction`（待应用改动 / 孤儿约束）为真时，
  // 结束态仍有真实可做的操作，因此不算只读。
  const readOnlyLedger = ["done", "cancelled"].includes(ledger.phase) && !hasPlanAction;
  const canOperate = canWrite && !readOnlyLedger;

  // issue #3099 —— run 在跑、但账本里一个步骤都没有（模型没调 `write_todos`）：
  // 渲染**只有运行级控制**的一行，不编造步骤序号/进度分数（那是计划级的东西，
  // 这里没有真实数据支撑它）。原先这里只处理"已暂停且无计划"一种情况
  // （`pausedWithoutPlan`），于是「正在跑且无计划」——也就是想暂停的那一刻——
  // 反而没有入口。两态用同一个控件，testid 与 `PlanRunProgress` 里那对一致，
  // 断言不需要知道这一轮模型有没有产出计划。
  /**
   * ⚠ 这一行**没有可操作入口时不渲染**——人类 2026-09-10 实测反馈：「不要显示，
   *   执行中的文字」。
   *
   *   截图里的那一屏：折叠头已经说了「正在执行 · 历时 00:07 · …」，下面一行
   *   「正在推进任务」，再下面又孤零零一句「执行中」——同一件事第三次。而这一行此刻
   *   **一个按钮都没有**：暂停入口已随 #3318 下线（`CHAT_RUN_PAUSE_ENTRY_ENABLED`），
   *   run 在跑时也谈不上「继续执行」。剩下的就是一句纯状态复述。
   *
   *   #3365 收敛的是「五处各自推导同一个状态」，这条是它的续作：推导只剩一份之后，
   *   **同一份事实仍然被说了三遍**。收敛推导之外还得收敛出口——一行既不给信息（上面
   *   已经说过）也不给动作的东西，删掉比留着诚实。
   *
   *   有按钮时照旧渲染：那时候标签是按钮的上下文（「已暂停」+「继续执行」），
   *   不是复述——`已暂停` 恰恰是上面两行**不会**说的那一句。
   */
  const hasRunControl = runControls.canResume || CHAT_RUN_PAUSE_ENTRY_ENABLED || actionErrorCode !== null;
  if (surface.kind === "run-controls" && !hasRunControl) return indicator;
  if (surface.kind === "run-controls") return <><div className="flex items-center gap-2 text-13" data-testid="chat-task-workbench-plan-control" data-thread-id={tid}>
    {indicator}
    {/*
      * issue #3318 —— 暂停入口下线（`CHAT_RUN_PAUSE_ENTRY_ENABLED`）时，
      * 「正在暂停」这个中间态文案也一起下线：没有入口就产生不了 pause-requested，
      * 留着它只会在系统侧偶发写了那个字段时告诉用户"有个暂停正在进行"——
      * 而那正是人类实测里卡住的那一屏。
      */}
    {/* issue #3365 —— 这一行此前自己拼三元文案，是「run 现在什么状态」的第二处推导。改读同一个 view。 */}
    <span role="status">{statusView.stateLabel}</span>
    {runControls.canResume ? (
      <Button size="sm" variant="primary" data-testid={PLAN_RUN_RESUME_TESTID} disabled={!canWrite || busy} onClick={handleResume}>继续执行</Button>
    ) : CHAT_RUN_PAUSE_ENTRY_ENABLED ? (
      <Button
        size="sm" variant="outline" data-testid={PLAN_RUN_PAUSE_TESTID}
        // #3365 —— 停滞与否同样只从 `statusView` 读，不裸读 `hasRecentError` 再判一次。
        disabled={!canWrite || busy || statusView.activity === "stalled" || Boolean(ledger.pauseRequestedAt)}
        onClick={handlePause}
      >{ledger.pauseRequestedAt ? "暂停中…" : "暂停"}</Button>
    ) : null}
    {actionErrorCode !== null && <span role="status" className="text-11 text-destructive">操作未完成（{actionErrorCode}）</span>}
  </div></>;

  /*
   * issue #3365 —— 改动前这三行是「当前步骤」的第二处推导，且带一个致命兜底：
   * `findIndex` 落空（**全部步骤已完成**）时 `currentStep` 取 `steps[length-1]`——
   * 也就是已经做完的最后一条。人类截图里那句「当前步骤：重新输出完整 ai-bmc
   * canvas 围栏 · 2/2」正是这个兜底编出来的，屏幕上没有任何真实事实支持它。
   * 现在 `currentStepIndex` 为 `null` 就是 `null`（契约不变量 I3），标签跟着为 null。
   */
  const currentStepIndex = statusView.currentStepIndex;
  const currentStep = currentStepIndex === null ? undefined : ledger.steps[currentStepIndex - 1];
  const currentStepLabel = currentStep?.content ?? null;

  // issue #2451 —— failed 态不再靠"第一个未完成的步骤"猜：改用服务端算出的真实
  // `failedStepId`（`get-plan-ledger.ts` 头注：`in_progress` 步骤，run 死掉那一刻
  // 唯一有真实信号支持"正是它"的一步）。`findIndex` 落空（理论上不会——`failedStepId`
  // 本就是从这同一份 `ledger.steps` 里选出来的）才退回上面那个旧近似值，保底不炸，
  // 不是又加一层猜测。
  const failedStepIndex = ledger.failedStepId !== null
    ? ledger.steps.findIndex((s) => s.planStepId === ledger.failedStepId)
    : -1;
  const failedStep = failedStepIndex !== -1 ? ledger.steps[failedStepIndex] : currentStep;
  // #3365 —— `currentStepIndex` 现在可能为 null（全完成时没有当前步骤）；
  // 取不到就不编序号，`PlanFailureRecovery` 的 `failedStepIndex` 本就是可选的。
  const failedStepDisplayIndex = failedStepIndex !== -1 ? failedStepIndex + 1 : currentStepIndex ?? undefined;

  /*
   * issue #3245① —— 人类 2026-09-10 devapp 验收原话：「plan panel 不要一直显示在下方」。
   * #3225 已让五格阶段条按需显示，仍然常驻的是它下面那一行折叠头
   * `› 执行计划 · 本轮已结束 · 2/2 步已标记完成`。
   *
   * ## 结束态它还承载什么新增信息——分两种，不是一句话
   * ① **账本已跑满**（`completed === total`）：这一行只剩「结束了」+「N/N」。同屏消息区
   *    已有完整回复与「执行过程 · 历时 · 工具 N 次」摘要，两者都在说同一件事。**纯重复**。
   * ② **账本没跑满**（`completed < total`）：这一行是 #2451 那条已知矛盾的唯一出口
   *    （阶段说完成、账本仍有 N 步没标完），`chat-task-workbench-plan-done-incomplete-notice`
   *    就挂在它展开之后。这不是重复，是**新增信息**。
   *
   * 所以只卸载 ① 这一种形状。替代触达路径（回看本轮计划）是右栏「进度」页签：
   * `chat-task-inspector.tsx` 的 `ProgressTab` 读的是同一份账本（`usePlanLedgerPolling`），
   * 在结束态照样列出全部步骤——不是新造的入口，是本来就有的那一个。
   *
   * ⚠ 能力面一格没动：`暂停`/`继续执行` 只在 `runLive` 下渲染，而这条门要求 `!runLive`；
   *   失败恢复、待确认门、待应用编辑、孤儿约束、刚失败的操作各自一条否决项，
   *   任何一件还需要用户动手，面板就留着（#3081 修好的暂停入口不受影响）。
   */

  /*
   * issue #3365 —— 折叠头此前有自己的 `stateLabel` 七档三元，以及自己数一遍的
   * `completed`。两者与进度卡、阶段条各自独立，是同一事实的第二、第三份声明。
   * 现在全部读 `statusView`（`completed` 直接用账本的 `progress.completed`——
   * 读模型已经数过一次，前端不重数）。
   */
  const stateLabel = statusView.stateLabel;
  const completed = statusView.progressValue;

  return (
    /*
     * `data-thread-id` 是**机器可读的绑定证据**（沿用 `chat-read-screen.tsx` 的同名模式）：
     * e2e 要能证明「屏幕上这块面板绑的是我正在读账本的那条线程」。#3321 上一轮取证
     * 正是栽在这里——DOM 量的是旧线程、账本列读的是新线程，据此写出的结论已作废。
     * 不占用户界面，只让取样指针错位变成一件会红的事。
     */
    <div data-testid="chat-task-workbench-plan-control" data-thread-id={tid} className={PLAN_CONTROL_SCROLLER_CLASS}>
      {/* #3208 方案 A —— 常驻四态，或用户展开折叠头时（"收起后仍可触达"那一半）。 */}
      {surface.pinIndicator || !collapsed ? phaseIndicator : null}
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={!collapsed}
          data-testid={PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID}
          aria-label={collapsed ? "展开计划面板" : "折叠计划面板"}
          onClick={() => setCollapsed((v) => !v)}
          className="flex min-w-0 items-center gap-2 rounded-control px-1 py-1 text-13 text-muted-foreground transition-colors duration-fast hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {collapsed ? <ChevronRight aria-hidden className="h-4 w-4" /> : <ChevronDown aria-hidden className="h-4 w-4" />}
          <span data-testid="chat-task-workbench-plan-summary">执行计划 · {stateLabel}{ledger.steps.length > 0 ? ` · ${completed}/${ledger.steps.length} 步已标记完成` : ""}</span>
        </button>
        {!collapsed && !readOnlyLedger && ledger.phase !== "failed" && ledger.steps.length > 0 && (
          <Button
            size="xs"
            disabled={!canOperate}
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

      {actionErrorCode !== null && (
        <p role="status" className="text-11 text-destructive" data-testid="chat-task-workbench-plan-action-error">
          {actionErrorCode === "PLAN_REVISION_CHANGED"
            ? "计划刚被更新，已刷新到最新版本——请基于当前状态重试这次修改。"
            : `操作未完成（${actionErrorCode}）`}
        </p>
      )}

      {/*
        * issue #3132 —— 门从 `failed && failedStep` 放宽为 `failed`：`failedStep` 只能
        * 从非空 steps 算出，于是"没有计划的失败 run"落进了一个没有恢复动作的空洞。
        * 缺步骤时不编造步骤序号（`PlanFailureRecovery` 两个 props 可选，缺就只说
        * "这次任务执行失败"），重试走 UC-10 的整轮重试（planStepId: null）。
        */}
      {canWrite && ledger.phase === "failed" && (
        <PlanFailureRecovery
          failedStepIndex={failedStep ? failedStepDisplayIndex : undefined}
          failedStepLabel={failedStep?.content}
          // issue #2451 —— 真实失败原因（`agent_runs.error_code` 经 `getPlanLedger.errorCode`
          // 透传），不再是写死的占位句。`errorCode` 为 null 或不在枚举内时，
          // `describePlanFailureReason` 自己退回同一句诚实兜底，不在这里再判一次。
          reason={describePlanFailureReason(ledger.errorCode)}
          onRetryStep={() => handleRetryStep(failedStep?.planStepId ?? null)}
          onEditInput={handleEditInput}
        />
      )}

      {/*
        * issue #3099 —— 门控从 `phase === "executing"` 换成 `runLive`（`deriveRunControls`）。
        * 两者在"有计划的 run"上等价（`phase` 在 ledger 非空 + running/interrupted 时正是
        * `"executing"`），差别只在于 `runLive` 不再受账本存在性影响，与上面那个无计划分支
        * 用的是同一个判据——「run 在跑就能暂停」在两条分支上只声明一次。
        */}
      {/*
        * issue #3365 —— 门里原本有 `&& currentStep`：全部步骤完成后 `currentStep`
        * 为空，整张进度卡会连同它一起消失，用户失去「这轮到底还在不在跑」的唯一
        * 载体。收尾态（`settling`）正是最需要如实说话的时刻，卡必须留着。
        */}
      {(!collapsed || Boolean(ledger.pausedAt) || Boolean(ledger.pauseRequestedAt)) && runLive && ledger.steps.length > 0 && (
        <PlanRunProgress
          view={statusView}
          currentStepLabel={currentStepLabel}
          elapsedMs={ledger.progress.elapsedMs}
          isPaused={Boolean(ledger.pausedAt)}
          isPauseRequested={CHAT_RUN_PAUSE_ENTRY_ENABLED && !ledger.pausedAt && Boolean(ledger.pauseRequestedAt)}
          showPause={CHAT_RUN_PAUSE_ENTRY_ENABLED}
          onPause={canWrite ? handlePause : undefined}
          onResume={canWrite ? handleResume : undefined}
          // #3365 —— 停滞态（RUN_ERROR 到手、账本可能永远追不上）必须给真出口，
          // 不是只留一句「正在等待执行状态更新……」让用户干等（见 #3367）。
          onRecover={canWrite ? () => handleRetryStep(currentStep?.planStepId ?? null) : undefined}
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
          本轮执行已结束，计划账本仍有 {ledger.progress.total - ledger.progress.completed} 步未标记完成，请核对下方步骤。
        </p>
      )}

      {ledger.pendingApplyAtNextRun && <fieldset disabled={!canWrite || busy} className="min-w-0"><PlanPendingApplyBanner onPauseNow={CHAT_RUN_PAUSE_ENTRY_ENABLED ? handlePause : undefined} /></fieldset>}

      {!collapsed && ledger.steps.length > 0 && (editing && canOperate ? (
        <PlanPanelEdit
          steps={ledger.steps}
          onReorder={handleReorder}
          onDelete={handleDelete}
          onAddConstraint={handleAddConstraint}
          onRemoveConstraint={handleRemoveConstraint}
        />
      ) : (
        <PlanPanelReadOnly steps={ledger.steps} compact />
      ))}

      {ledger.orphanedConstraints.map((c) => (
        <fieldset key={c.constraintId} disabled={!canWrite || busy} className="min-w-0">
        <OrphanConstraintNotice
          text={c.text}
          formerStepContent={c.formerStepContent}
          onRemove={() => handleRemoveConstraint(c.constraintId)}
        />
        </fieldset>
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
       * 待确认操作独立于详情折叠，避免收起步骤后隐藏处理入口。
       */}
      {ledger.phase === "planning" && ledger.gate.required && (
        <fieldset disabled={!canWrite || busy} className="min-w-0">
        {/*
          * issue #3132（B7）—— 「提案」标记：这份步骤列表**尚未生效**（引擎账本 revision
          * 仍是 0，`write_todos` 还没执行）。与已生效账本视觉可区分是设计 ① 的硬要求——
          * 不标的话，用户看到的提案和一份真实计划长得一模一样，无从判断确认按钮到底
          * 在确认什么。判据来自读模型的 `stepsAreProposal`，不在这里拿 phase 自己推。
          */}
        {ledger.stepsAreProposal && (
          <p data-testid="chat-task-workbench-plan-proposal-badge" className="mb-2 text-xs text-muted-foreground">
            以下是待确认的<strong>提案计划</strong>，确认后才会开始执行。
          </p>
        )}
        <PlanConfirmGate
          gate={ledger.gate}
          onConfirmRun={handleConfirm}
          onContinueEditing={() => { if (canWrite) { setCollapsed(false); setEditing(true); } }}
        />
        </fieldset>
      )}

      {busy && <span className="sr-only" role="status">计划操作处理中…</span>}
    </div>
  );
}
