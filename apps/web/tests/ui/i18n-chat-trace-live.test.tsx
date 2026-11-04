import * as React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import type { TraceEntry } from "@/lib/chat-workbench/run-trace";
import { RunTraceLiveStrip } from "@/components/chat/workbench/run-trace-live-strip";
import { RunTraceLivePreview } from "@/components/chat/workbench/run-trace-live-preview";
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
afterEach(() => vi.useRealTimers());
it("preserves elapsed time and completed facts when changing locale between tool calls", () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-04T00:00:00Z"));
  const entries: TraceEntry[] = [{ id: "raw-failed", kind: "tool", text: "read_file", status: "failed", args: { path: "用户文件{count}.txt" } }];
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><RunTraceLiveStrip entries={entries} active /></I18nProvider>);
  const strip = screen.getByTestId("run-trace-live-strip"); const label = screen.getByTestId("run-trace-live-label");
  expect(label.textContent).toContain("Just failed"); expect(strip.getAttribute("data-completed")).toBe("1");
  act(() => vi.advanceTimersByTime(4000)); expect(label.textContent).toContain("Waited 4 seconds");
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("run-trace-live-strip")).toBe(strip); expect(screen.getByTestId("run-trace-live-label")).toBe(label);
  expect(label.textContent).toContain("已等待 4 秒"); expect(strip.getAttribute("data-completed")).toBe("1");
  act(() => vi.advanceTimersByTime(1000)); expect(label.textContent).toContain("已等待 5 秒");
  expect(entries[0]?.args).toEqual({ path: "用户文件{count}.txt" });
});
it("localizes recent-step status without changing raw filenames, selected rows or preview limit", () => {
  const entries: TraceEntry[] = ["failed", "succeeded", "running", "succeeded"].map((status, i) => ({ id: `row-${i}`, kind: "tool", text: "read_file", status: status as TraceEntry["status"], args: { path: `原始文件${i}{count}.txt` } }));
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><RunTraceLivePreview entries={entries} active hasAssistantText={false} /></I18nProvider>);
  expect(screen.getByText("Expand to see all 4 actions")).toBeTruthy();
  expect(screen.getByLabelText("In progress")).toBeTruthy();
  const rows = screen.getAllByTestId("run-trace-live-preview-row"); expect(rows).toHaveLength(3);
  rows.forEach((row, i) => expect(row.textContent).toBe(`原始文件${i + 1}{count}.txt`));
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getAllByTestId("run-trace-live-preview-row")).toEqual(rows);
  expect(screen.getByText("展开可看全部 4 个动作")).toBeTruthy(); expect(screen.getByLabelText("进行中")).toBeTruthy();
});
it("uses singular and plural action counts without changing the recorded completion facts", () => {
  const one: TraceEntry[] = [{ id: "completed-1", kind: "tool", text: "raw_tool", status: "succeeded" }];
  const { rerender } = render(<I18nProvider initialLocale="en"><RunTraceLiveStrip entries={one} active /></I18nProvider>);
  const strip = screen.getByTestId("run-trace-live-strip");
  expect(screen.getByTestId("run-trace-live-label").textContent).toBe("Just completed: Tool operation · Completed 1 action");
  rerender(<I18nProvider initialLocale="en"><RunTraceLiveStrip entries={[...one, { id: "completed-2", kind: "tool", text: "raw_tool", status: "failed" }]} active /></I18nProvider>);
  expect(screen.getByTestId("run-trace-live-strip")).toBe(strip); expect(strip.getAttribute("data-completed")).toBe("2");
  expect(screen.getByTestId("run-trace-live-label").textContent).toBe("Just failed: Tool operation · Completed 2 actions");
});
