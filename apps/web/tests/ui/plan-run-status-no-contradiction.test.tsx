/**
 * issue #3365 —— 人类 2026-09-10 devapp 实测：一屏之内关于「这条 run 现在处于什么
 * 状态」有五处互相矛盾的声明。
 *
 * 本文件的账本夹具**逐字来自真实权威读输出**（`getPlanLedger` 在真实链路上对
 * `runStatus:"running" + 两步全 completed` 的返回值，见 issue #3365 评论：
 * `phase:"executing" / progress:{completed:2,total:2,elapsedMs:40007}`）——
 * 不是手搓的假形状，缺陷在这份数据下是可复现的。
 *
 * ## 判据判的是「组合」，不是「文案存在」
 *
 * 「屏幕上有『执行中』」这种断言在缺陷下**恒真**，无法被证伪。这里判的是自相矛盾
 * 的组合本身：步骤全完成 ⇒ 不得同时出现「执行中」且「当前步骤 = 已完成的某一步」；
 * 报错 ⇒ 不得停在推进族文案而没有可见出口；进度条分子必须与折叠头的完成数同源。
 */
import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { PlanLedgerView } from "@/lib/plan-control-api";
import { RUN_PROGRESSING_LABELS } from "@repo/contracts/plan-control";

afterEach(cleanup);

const api = vi.hoisted(() => ({
  fetchPlanLedger: vi.fn(), reorderPlanStep: vi.fn(), deletePlanStep: vi.fn(),
  addPlanConstraint: vi.fn(), removePlanConstraint: vi.fn(), confirmPlan: vi.fn(),
  confirmProposedPlan: vi.fn(), pausePlanRun: vi.fn(), resumePlanRun: vi.fn(),
  retryPlanStep: vi.fn(), planControlErrorCode: vi.fn((): string | null => null),
}));
vi.mock("@/lib/plan-control-api", () => api);

import {
  CopilotKitV2PlanControl, PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID,
} from "@/components/chat/copilotkit-v2-plan-control";
import {
  PLAN_RUN_PROGRESS_TESTID, PLAN_RUN_RECENT_ERROR_TESTID, PLAN_RUN_RECOVERY_TESTID,
} from "@/components/plan-control/plan-run-progress";

const STEP_2_LABEL = "重新输出完整 ai-bmc canvas 围栏";

/** 人类截图那条 run 的账本，逐字取自真实 `getPlanLedger` 权威读输出。 */
function humanLedger(over: Partial<PlanLedgerView> = {}): PlanLedgerView {
  return {
    pausedAt: null, pauseRequestedAt: null, cancelRequestedAt: null,
    revision: 3, engineEpoch: 0, origin: "engine",
    steps: [
      { planStepId: "s1", content: "读取 ai-bmc 模板", status: "completed", constraints: [] },
      { planStepId: "s2", content: STEP_2_LABEL, status: "completed", constraints: [] },
    ],
    orphanedConstraints: [], phase: "executing",
    gate: { required: true, reason: "multi-step" },
    progress: { completed: 2, total: 2, elapsedMs: 40_007 },
    pendingApplyAtNextRun: false, stepsAreProposal: false, pendingPermissionRequestId: null,
    runStatus: "running", activeRunId: "run-3365", errorCode: null, failedStepId: null,
    ...over,
  } as unknown as PlanLedgerView;
}

async function renderExpanded(ledger: PlanLedgerView, refetchSignal = 0): Promise<HTMLElement> {
  api.fetchPlanLedger.mockResolvedValue(ledger);
  render(<CopilotKitV2PlanControl threadId="t-3365" refetchSignal={refetchSignal} />);
  const toggle = await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID);
  fireEvent.click(toggle); // 展开，让进度卡与步骤列表同屏——矛盾正是在同屏时被看见的
  return screen.getByTestId("chat-task-workbench-plan-control");
}

it("步骤全完成 ⇒ 不得同时宣称「执行中」且「当前步骤 = 已完成的某一步」", async () => {
  const panel = await renderExpanded(humanLedger());
  const text = panel.textContent ?? "";
  const card = screen.getByTestId(PLAN_RUN_PROGRESS_TESTID);

  // 这条 run 的两步在账本里都是 completed —— 前置事实，先钉住，免得夹具漂了还全绿。
  expect(humanLedger().steps.every((s) => s.status === "completed")).toBe(true);

  // ① 不得再出现推进族文案。
  for (const label of RUN_PROGRESSING_LABELS) {
    expect(text, `全完成却仍显示「${label}」`).not.toContain(label);
  }
  // ② 不得再出现「当前步骤：<已完成的那一步>」。
  expect(text).not.toContain(`当前步骤：${STEP_2_LABEL}`);
  // ③ activity 不得是 progressing（机器可读，e2e 与单测共用同一个锚点）。
  expect(card.getAttribute("data-activity")).not.toBe("progressing");
});

it("进度条分子与折叠头完成数同源：全完成时条子必须满，不是 50%", async () => {
  await renderExpanded(humanLedger());
  const card = screen.getByTestId(PLAN_RUN_PROGRESS_TESTID);
  const bar = card.querySelector('[role="progressbar"]');
  expect(bar).not.toBeNull();

  const completedFromHeader = Number(card.getAttribute("data-completed"));
  const total = Number(card.getAttribute("data-total"));
  expect(completedFromHeader).toBe(2);
  expect(total).toBe(2);
  // 缺陷现场：aria-valuenow=1 / max=2 / width 50%，而同一张卡的 label 写着 2/2。
  expect(Number(bar!.getAttribute("aria-valuenow")), "进度条分子必须是已完成数，不是「当前步号 - 1」")
    .toBe(completedFromHeader);
  expect((bar!.firstElementChild as HTMLElement).style.width).toBe("100%");
});

it("折叠头与进度卡说的是同一句状态（不许两处各拼一句）", async () => {
  await renderExpanded(humanLedger());
  const summary = screen.getByTestId("chat-task-workbench-plan-summary").textContent ?? "";
  const label = screen.getByTestId(PLAN_RUN_PROGRESS_TESTID).getAttribute("data-state-label") ?? "";
  expect(label).not.toBe("");
  expect(summary, "折叠头的状态词必须与进度卡同源").toContain(label);
});

it("报了错 ⇒ 不得停在推进族文案，且必须给出可见的恢复入口", async () => {
  api.fetchPlanLedger.mockResolvedValue(humanLedger({
    steps: [
      { planStepId: "s1", content: "读取 ai-bmc 模板", status: "completed", constraints: [] },
      { planStepId: "s2", content: STEP_2_LABEL, status: "in_progress", constraints: [] },
    ],
    progress: { completed: 1, total: 2, elapsedMs: 40_007 },
  } as unknown as Partial<PlanLedgerView>));
  const { rerender } = render(<CopilotKitV2PlanControl threadId="t-3365" refetchSignal={0} />);
  fireEvent.click(await screen.findByTestId(PLAN_CONTROL_COLLAPSE_TOGGLE_TESTID));
  // 父组件的 AG-UI `RUN_ERROR` 订阅：计数器自增一次。
  rerender(<CopilotKitV2PlanControl threadId="t-3365" refetchSignal={1} />);

  await waitFor(() => expect(screen.getByTestId(PLAN_RUN_RECENT_ERROR_TESTID)).toBeTruthy());
  const card = screen.getByTestId(PLAN_RUN_PROGRESS_TESTID);
  expect(card.getAttribute("data-activity")).toBe("stalled");
  const text = screen.getByTestId("chat-task-workbench-plan-control").textContent ?? "";
  for (const label of RUN_PROGRESSING_LABELS) {
    expect(text, `报错后仍显示「${label}」`).not.toContain(label);
  }
  // 出错就不能只留一句「等待执行状态更新」让用户干等——那个更新在真实链路里
  // 可能永远不会来（#3367：controller 的 catch 家族写 RUN_ERROR 却不落失败态）。
  expect(screen.getByTestId(PLAN_RUN_RECOVERY_TESTID)).toBeTruthy();
  fireEvent.click(screen.getByTestId(PLAN_RUN_RECOVERY_TESTID));
  await waitFor(() => expect(api.retryPlanStep).toHaveBeenCalled());
});
