import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const api = vi.hoisted(() => ({ fetchPlanLedger: vi.fn(() => new Promise(() => {})) }));
vi.mock("@/lib/plan-control-api", () => api);
import { ChatTaskInspector, type ChatTaskInspectorProps } from "@/components/chat/chat-task-inspector";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
function LocaleControl() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
const props: ChatTaskInspectorProps = {
  hasSelection: true, threadId: "raw-thread-{count}", artifacts: null, materials: null,
  loading: false, artifactsError: null, materialsError: null, onRetry: vi.fn(),
  pendingMaterialsCount: 2, planTodos: null, isRunning: true, runPhaseLabel: "阶段原文 {stage}",
  recoveryDiagnostic: "恢复原文 {reason}", runStartedAt: 1000,
};
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
it("keeps selected run detail rows and elapsed timer mounted while changing language", () => {
  vi.useFakeTimers(); vi.setSystemTime(6000);
  render(<I18nProvider initialLocale="en"><LocaleControl /><ChatTaskInspector {...props} /></I18nProvider>);
  fireEvent.click(screen.getByRole("tab", { name: "Run details" }));
  const panel = screen.getByTestId("chat-task-workbench-inspector-run-details");
  const threadRow = within(panel).getByText(props.threadId!).parentElement;
  const elapsedValue = within(panel).getByText("5 seconds");
  expect(within(panel).getByText("Thread ID")).toBeTruthy();
  expect(within(panel).getByText("Running")).toBeTruthy();
  expect(within(panel).getByText(props.runPhaseLabel!)).toBeTruthy();
  expect(within(panel).getByText(props.recoveryDiagnostic!)).toBeTruthy();
  const requests = api.fetchPlanLedger.mock.calls.length;
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-task-workbench-inspector-run-details")).toBe(panel);
  expect(within(panel).getByText(props.threadId!).parentElement).toBe(threadRow);
  expect(within(panel).getByText("5 秒")).toBe(elapsedValue);
  act(() => { vi.advanceTimersByTime(1000); });
  expect(elapsedValue.textContent).toBe("6 秒");
  expect(within(panel).getByText(props.runPhaseLabel!)).toBeTruthy();
  expect(within(panel).getByText(props.recoveryDiagnostic!)).toBeTruthy();
  expect(api.fetchPlanLedger).toHaveBeenCalledTimes(requests);
  expect(screen.getByTestId("chat-task-workbench-inspector")).toHaveAttribute("data-active-tab", "run-details");
});
it("keeps the user's collapsed state and canonical tab button through locale changes", () => {
  render(<I18nProvider initialLocale="en"><LocaleControl /><ChatTaskInspector {...props} runStartedAt={null} /></I18nProvider>);
  const inspector = screen.getByTestId("chat-task-workbench-inspector");
  const artifacts = screen.getByRole("tab", { name: "Artifacts" });
  fireEvent.click(artifacts);
  fireEvent.click(screen.getByRole("button", { name: "Collapse task inspector" }));
  expect(inspector).toHaveAttribute("data-collapsed", "true");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByRole("tab", { name: "产物" })).toBe(artifacts);
  expect(inspector).toHaveAttribute("data-collapsed", "true");
  expect(inspector).toHaveAttribute("data-active-tab", "artifacts");
});
