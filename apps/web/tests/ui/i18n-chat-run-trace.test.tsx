import * as React from "react";
import { expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
const base = { runId: "run-raw", emittedAt: "2026-11-04T00:00:00Z" };
it("localizes the trace wrapper without changing raw tool arguments/results or the expanded content node", () => {
  const args = { task: "用户工具输入 {count}", code: '{"status":"pending"}' };
  const result = { text: "用户结果 🌍", status: "failed" };
  const events: ExecutionEvent[] = [
    { ...base, seq: 1, kind: "tool_start", toolCallId: "raw-tool-call", toolName: "custom_tool_raw", args },
    { ...base, seq: 2, kind: "tool_end", toolCallId: "raw-tool-call", toolName: "custom_tool_raw", ok: true, result },
    { ...base, seq: 3, kind: "status", status: "succeeded" },
  ];
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><RunTracePanel runId={base.runId} events={events} expanded renderTool={entry => <pre data-testid="raw-tool-projection">{JSON.stringify({ args: entry.args, result: entry.result })}</pre>} /></I18nProvider>);
  const toggle = screen.getByTestId("run-trace-toggle"); expect(toggle.textContent).toContain("Execution trace");
  const body = screen.getByRole("region", { name: "Task execution trace" }); const raw = screen.getByTestId("raw-tool-projection");
  expect(raw.textContent).toBe(JSON.stringify({ args, result }));
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("run-trace-toggle")).toBe(toggle); expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("region", { name: "任务执行过程" })).toBe(body); expect(screen.getByTestId("raw-tool-projection")).toBe(raw);
  expect(raw.textContent).toBe(JSON.stringify({ args, result })); expect(screen.getByTestId("run-trace-panel").getAttribute("data-run-id")).toBe(base.runId);
});
it("keeps the journal cancellation authoritative when the message slot still says running", () => {
  const events: ExecutionEvent[] = [
    { ...base, seq: 1, kind: "tool_start", toolCallId: "raw-tool-call", toolName: "custom_tool_raw", args: {} },
    { ...base, seq: 2, kind: "status", status: "cancelled" },
  ];
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><RunTracePanel runId={base.runId} events={events} running /></I18nProvider>);
  const toggle = screen.getByTestId("run-trace-toggle"); expect(toggle.textContent).toContain("Stopped");
  expect(screen.queryByTestId("copilotkit-v2-thinking-mark")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("run-trace-toggle")).toBe(toggle); expect(toggle.textContent).toContain("已停止");
  expect(screen.queryByTestId("copilotkit-v2-thinking-mark")).toBeNull();
});
