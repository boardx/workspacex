import * as React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { deriveRunStatusView, PLAN_PHASE_LABEL_ZH, type PlanPhase, type PlanStep } from "@repo/contracts/plan-control";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { PlanPanelReadOnly } from "@/components/plan-control/plan-panel-readonly";
import { PlanPanelEdit, PlanPendingApplyBanner, PlanStaleBanner, OrphanConstraintNotice } from "@/components/plan-control/plan-panel-edit";
import { PlanConfirmGate, PlanDirectExecutionBadge } from "@/components/plan-control/plan-confirm-gate";
import { PlanRunProgress } from "@/components/plan-control/plan-run-progress";
import { PlanFailureRecovery } from "@/components/plan-control/plan-failure-recovery";
import { PlanPhaseIndicator } from "@/components/plan-control/plan-phase-indicator";

const raw = "模型步骤 {id} 🌱";
const steps: PlanStep[] = [{ planStepId: "raw-step", content: raw, status: "in_progress", constraints: [{ constraintId: "raw-constraint", text: "用户约束 {text}", createdAt: "2026-11-04T00:00:00Z" }] }];
function LocaleControl() {
  const { locale, setLocale } = useI18n();
  return <button onClick={() => setLocale(locale === "en" ? "zh-CN" : "en")}>Switch test locale</button>;
}
function host(children: React.ReactNode) {
  return render(<I18nProvider initialLocale="en"><LocaleControl />{children}</I18nProvider>);
}
const flip = () => fireEvent.click(screen.getByRole("button", { name: "Switch test locale" }));
afterEach(cleanup);

it("keeps readonly raw steps and stopped status on the same DOM across locale", () => {
  host(<PlanPanelReadOnly steps={steps} executionStopped />);
  const row = screen.getByTestId("chat-task-workbench-plan-step");
  expect(screen.getByText("Current plan")).toBeTruthy();
  expect(screen.getByLabelText("Stopped")).toBeTruthy();
  expect(screen.getByText("Constraint")).toBeTruthy();
  flip();
  expect(screen.getByTestId("chat-task-workbench-plan-step")).toBe(row);
  expect(screen.getByLabelText("已停止")).toBeTruthy();
  expect(row).toHaveTextContent(raw);
  expect(row).toHaveTextContent(steps[0]!.constraints[0]!.text);
  expect(row).toHaveAttribute("data-plan-status", "in_progress");
});

it("retains edit draft and exact constraint/reorder IDs without locale actions", () => {
  const add = vi.fn(), reorder = vi.fn(), remove = vi.fn();
  host(<PlanPanelEdit steps={steps} onAddConstraint={add} onReorder={reorder} onDelete={remove} />);
  fireEvent.click(screen.getByTestId("chat-task-workbench-plan-step-add-constraint"));
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "  raw draft 中文 {x}  " } });
  expect(input).toHaveAccessibleName(`Enter a constraint for “${raw}”`);
  flip();
  expect(screen.getByRole("textbox")).toBe(input);
  expect(input).toHaveValue("  raw draft 中文 {x}  ");
  expect(add).not.toHaveBeenCalled();
  expect(reorder).not.toHaveBeenCalled();
  expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId("chat-task-workbench-plan-step-add-constraint-confirm"));
  expect(add).toHaveBeenCalledTimes(1);
  expect(add).toHaveBeenCalledWith("raw-step", "  raw draft 中文 {x}  ");
  fireEvent.keyDown(screen.getByTestId("chat-task-workbench-plan-step-reorder"), { key: "ArrowDown", altKey: true });
  expect(reorder).toHaveBeenCalledWith("raw-step", 1);
});

it("translates stale, pending and orphan notices while preserving raw text and callbacks", () => {
  const diff = vi.fn(), reapply = vi.fn(), remove = vi.fn();
  host(<><PlanStaleBanner onViewDiff={diff} onReapply={reapply} /><PlanPendingApplyBanner /><OrphanConstraintNotice text="raw约束" formerStepContent={raw} onRemove={remove} /></>);
  expect(screen.getByRole("button", { name: "View changes" })).toBeTruthy();
  expect(screen.getByTestId("chat-task-workbench-plan-pending-apply")).toHaveTextContent("after the current step finishes");
  expect(screen.getByTestId("chat-task-workbench-plan-orphan-constraint")).toHaveTextContent("raw约束");
  expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
  const notice = screen.getByTestId("chat-task-workbench-plan-orphan-constraint");
  flip();
  expect(screen.getByTestId("chat-task-workbench-plan-orphan-constraint")).toBe(notice);
  expect(diff).not.toHaveBeenCalled(); expect(reapply).not.toHaveBeenCalled(); expect(remove).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "查看差异" }));
  expect(diff).toHaveBeenCalledTimes(1);
});

it("keeps pending confirmation and external raw step decisions explicit", () => {
  const confirm = vi.fn(), adjust = vi.fn(), reject = vi.fn();
  host(<PlanConfirmGate gate={{ required: true, reason: "multi-step-high-risk" }} steps={steps} externalStepIds={new Set(["raw-step"])} onConfirmRun={confirm} onAdjustStep={adjust} onRejectStep={reject} />);
  const button = screen.getByRole("button", { name: "Confirm execution" });
  expect(screen.getByTestId("chat-task-workbench-plan-confirm-reason")).toHaveTextContent("externally visible");
  expect(screen.getByTestId("chat-task-workbench-plan-confirm-step-external")).toHaveTextContent("External");
  flip();
  expect(screen.getByRole("button", { name: "确认执行" })).toBe(button);
  expect(confirm).not.toHaveBeenCalled(); expect(adjust).not.toHaveBeenCalled(); expect(reject).not.toHaveBeenCalled();
  expect(screen.getByTestId("chat-task-workbench-plan-confirm-step")).toHaveTextContent(raw);
  fireEvent.click(screen.getByTestId("chat-task-workbench-plan-confirm-step-adjust"));
  expect(adjust).toHaveBeenCalledWith("raw-step");
  fireEvent.click(button); expect(confirm).toHaveBeenCalledTimes(1);
});

it("translates direct/automatic delivery without inventing absent step actions", () => {
  host(<><PlanDirectExecutionBadge /><PlanConfirmGate gate={{ required: false, reason: "multi-step-low-risk", deliverPlan: true }} steps={steps} /></>);
  expect(screen.getByText("Direct execution")).toBeTruthy();
  expect(screen.getByText("Executing this plan")).toBeTruthy();
  expect(screen.queryByTestId("chat-task-workbench-plan-confirm-run")).toBeNull();
  expect(screen.getByTestId("chat-task-workbench-plan-auto-deliver-step")).toHaveTextContent(raw);
});

it("renders authoritative progress values and raw current step without new timer or locale action", () => {
  const view = deriveRunStatusView({ phase: "executing", runStatus: "running", stepStatuses: ["completed", "in_progress"], progressCompleted: 1, progressTotal: 2, paused: false, pauseRequested: false, gateRequired: false, hasRecentError: false, pauseEntryEnabled: false });
  host(<PlanRunProgress view={view} currentStepLabel={raw} elapsedMs={65000} isPaused={false} showPause={false} />);
  const card = screen.getByTestId("chat-task-workbench-run-progress");
  expect(card).toHaveTextContent("Current step:");
  expect(card).toHaveTextContent("1m 5s");
  expect(screen.getByRole("progressbar")).toHaveAccessibleName("Execution progress 1/2");
  expect(screen.queryByTestId("chat-task-workbench-run-pause")).toBeNull();
  flip();
  expect(screen.getByTestId("chat-task-workbench-run-progress")).toBe(card);
  expect(card).toHaveAttribute("data-completed", "1");
  expect(card).toHaveAttribute("data-state-label", view.stateLabel);
  expect(card).toHaveTextContent(raw);
  expect(card).toHaveTextContent("1分5秒");
});

it("translates stalled owned state and keeps recovery an explicit once callback", () => {
  const recover = vi.fn();
  const view = deriveRunStatusView({ phase: "executing", runStatus: "running", stepStatuses: [], progressCompleted: 0, progressTotal: 0, paused: false, pauseRequested: false, gateRequired: false, hasRecentError: true, pauseEntryEnabled: false });
  host(<PlanRunProgress view={view} currentStepLabel={null} elapsedMs={1000} isPaused={false} showPause={false} onRecover={recover} />);
  expect(screen.getByTestId("chat-task-workbench-run-progress")).toHaveTextContent("Execution result unconfirmed");
  const button = screen.getByRole("button", { name: "Retry this task" });
  flip(); expect(recover).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "重试这轮任务" })).toBe(button);
  fireEvent.click(button); expect(recover).toHaveBeenCalledTimes(1);
});

it("translates recovery chrome but never interprets raw caller reason/note", () => {
  const retry = vi.fn();
  host(<PlanFailureRecovery failedStepIndex={2} failedStepLabel={raw} reason="caller原始reason" note="caller原始note" onRetryStep={retry} />);
  expect(screen.getByText(`Step 2 “${raw}” failed`)).toBeTruthy();
  const button = screen.getByRole("button", { name: "Retry this step" });
  flip(); expect(retry).not.toHaveBeenCalled();
  expect(screen.getByText("caller原始reason")).toBeTruthy();
  expect(screen.getByTestId("chat-task-workbench-failure-note")).toHaveTextContent("caller原始note");
  expect(screen.getByRole("button", { name: "重试该步" })).toBe(button);
});

it.each([false, true])("accepted retry guard copy follows locale without changing busy=%s or retaining less raw content", busy => {
  const retry = vi.fn(), edit = vi.fn();
  host(<PlanFailureRecovery failedStepIndex={2} failedStepLabel={raw} reason="raw cause 原文" busy={busy} onRetryStep={retry} onEditInput={edit} />);
  expect(screen.getByText("Completed steps are retained. Retrying continues from unfinished work.")).toBeTruthy();
  const button = screen.getByTestId("chat-task-workbench-failure-retry-step");
  expect(button).toHaveTextContent(busy ? "Retrying…" : "Retry this step");
  expect(button).toHaveProperty("disabled", busy);
  expect(screen.getByTestId("chat-task-workbench-failure-edit-input")).toHaveProperty("disabled", busy);
  flip();
  expect(screen.getByTestId("chat-task-workbench-failure-retry-step")).toBe(button);
  expect(button).toHaveProperty("disabled", busy);
  expect(screen.getByText("raw cause 原文")).toBeTruthy();
  expect(screen.getByText(`第 2 步「${raw}」失败`)).toBeTruthy();
  expect(retry).not.toHaveBeenCalled(); expect(edit).not.toHaveBeenCalled();
});

it.each<[PlanPhase, string]>([["preparing", "Preparing"], ["planning", "Planning"], ["executing", "Executing"], ["approving", "Approval"], ["done", "Completed"], ["failed", "Failed"], ["cancelled", "Stopped"]])("translates canonical phase %s with stable machine identity", (phase, english) => {
  host(<PlanPhaseIndicator phase={phase} />);
  const root = screen.getByTestId("chat-task-workbench-phase-indicator");
  expect(root).toHaveTextContent(english);
  expect(root).toHaveAttribute("data-phase", phase);
  const active = root.querySelector('[aria-current="step"]');
  flip();
  expect(screen.getByTestId("chat-task-workbench-phase-indicator")).toBe(root);
  expect(root).toHaveTextContent(PLAN_PHASE_LABEL_ZH[phase]);
  expect(root.querySelector('[aria-current="step"]')).toBe(active);
});
