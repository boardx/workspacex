import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { subtaskRun } from "@repo/contracts";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { SubtaskRunPanel } from "@/components/chat/subtask-run-panel";
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
const failed = subtaskRun.SubtaskRun.parse({
  id: "raw-subtask", parentRunId: "raw-parent", description: "模型子任务{count}", context: "用户上下文🌍", status: "failed", result: null, error: "服务端错误{status}",
  snapshot: { agentVersionId: "raw-agent-version", skillVersionIds: ["raw-skill"], modelProvider: "controlled-fixture", modelId: "controlled-model" }, artifactRefs: [],
  createdAt: "2026-11-04T00:00:00Z", updatedAt: "2026-11-04T00:00:04Z",
  toolCalls: [{ toolCallId: "raw-call", toolName: "org_tool_raw", argsSummary: "原始参数{count}", resultSummary: "原始结果🌍", ok: false, startedAt: "2026-11-04T00:00:00Z", durationMs: 4000 }],
});
it("keeps expanded subtask facts and original immutable retry input through locale changes", () => {
  const retry = vi.fn();
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><SubtaskRunPanel parentRunId={failed.parentRunId} runs={[failed]} onRetry={retry} defaultOpen /></I18nProvider>);
  const card = screen.getByTestId("chat-subtask-card"); expect(within(card).getByTestId("chat-subtask-status-label").textContent).toBe("Failed");
  const button = within(card).getByRole("button", { name: "Retry this subtask" }); const rawError = within(card).getByTestId("chat-subtask-error");
  expect(rawError.textContent).toBe(failed.error); expect(screen.getByTestId("chat-subtask-tool-call").textContent).toContain("原始参数{count}");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("chat-subtask-card")).toBe(card); expect(within(card).getByTestId("chat-subtask-error")).toBe(rawError);
  expect(within(card).getByRole("button", { name: "重试这一个" })).toBe(button); expect(retry).not.toHaveBeenCalled();
  fireEvent.click(button); expect(retry).toHaveBeenCalledTimes(1); expect(retry.mock.calls[0]?.[0]).toBe(failed);
});
it("keeps confirmed cancellation distinct from failure and cannot invent a retry action", () => {
  const cancelled = subtaskRun.SubtaskRun.parse({ ...failed, status: "cancelled", error: null, toolCalls: [], cancellation: { requestedAt: "2026-11-04T00:00:03Z", state: "confirmed" } });
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><SubtaskRunPanel parentRunId={cancelled.parentRunId} runs={[cancelled]} defaultOpen /></I18nProvider>);
  const card = screen.getByTestId("chat-subtask-card"); expect(within(card).getByTestId("chat-subtask-status-label").textContent).toBe("Cancelled");
  expect(card.getAttribute("data-status")).toBe("cancelled"); expect(screen.queryByTestId("chat-subtask-retry")).toBeNull(); expect(screen.queryByTestId("chat-subtask-error")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "switch language" })); expect(screen.getByTestId("chat-subtask-card")).toBe(card);
  expect(within(card).getByTestId("chat-subtask-status-label").textContent).toBe("已取消"); expect(screen.queryByTestId("chat-subtask-retry")).toBeNull();
});
