import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const css = vi.hoisted(() => require.resolve("@copilotkit/react-core/v2/styles.css"));
vi.mock(css, () => ({}));
vi.mock("@/components/chat/subtask-run-live-panel", () => ({ SubtaskRunLivePanel: () => null }));
import { CopilotKit } from "@copilotkit/react-core/v2";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { CopilotKitV2ToolRenderers } from "@/components/chat/copilotkit-v2-tool-renderers";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";
import { renderExecutionTool } from "@/components/chat/workbench/task-timeline";
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
const base = { runId: "raw-render-run", emittedAt: "2026-11-04T00:00:00Z" };
function show(events: ExecutionEvent[]) {
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><CopilotKit runtimeUrl="/api/copilotkit" useSingleEndpoint={false}><CopilotKitV2ToolRenderers /><RunTracePanel runId={base.runId} events={events} expanded renderTool={renderExecutionTool} /></CopilotKit></I18nProvider>);
  screen.getAllByTestId("chat-task-workbench-event-row").forEach(row => fireEvent.click(row));
}
it("uses the actual SDK renderer with translated chrome and unchanged raw file identity", () => {
  show([{ ...base, seq: 1, kind: "tool_start", toolCallId: "raw-call", toolName: "read_file", args: { file_path: "/private/用户文件{count}.txt" } }]);
  const card = screen.getByTestId("copilotkit-v2-tool-generic");
  expect(within(card).getByText("Read file")).toBeTruthy(); expect(within(card).getByText("In progress")).toBeTruthy();
  expect(within(card).getByText("用户文件{count}.txt")).toBeTruthy();
  const status = card.getAttribute("data-tool-status");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("copilotkit-v2-tool-generic")).toBe(card); expect(card.getAttribute("data-tool-name")).toBe("read_file");
  expect(card.getAttribute("data-tool-status")).toBe(status); expect(within(card).getByText("读取文件")).toBeTruthy();
});
it("preserves authoritative failure and raw server result in the actual SDK renderer", () => {
  const result = "服务端原始错误 {count} 🌍";
  show([
    { ...base, seq: 1, kind: "tool_start", toolCallId: "failed-call", toolName: "custom_raw_tool", args: { unknown: "原始参数{count}" } },
    { ...base, seq: 2, kind: "tool_end", toolCallId: "failed-call", toolName: "custom_raw_tool", result, ok: false },
    { ...base, seq: 3, kind: "status", status: "failed" },
  ]);
  const card = screen.getByTestId("copilotkit-v2-tool-generic"); expect(card.getAttribute("data-tool-status")).toBe("failed");
  expect(within(card).getByLabelText("Failed")).toBeTruthy(); expect(within(card).getByText("custom_raw_tool")).toBeTruthy();
  const raw = screen.getByTestId("copilotkit-v2-tool-generic-result"); expect(raw.textContent).toBe(result);
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("copilotkit-v2-tool-generic-result")).toBe(raw); expect(raw.textContent).toBe(result);
  expect(within(card).getByLabelText("失败")).toBeTruthy(); expect(card.getAttribute("data-tool-status")).toBe("failed");
});
