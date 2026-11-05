import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { failureTraceKey } from "@/lib/chat-workbench/failure-trace-visibility";
import { RunTracePanel } from "@/components/chat/workbench/run-trace-panel";

vi.mock("@/components/chat/subtask-run-live-panel", () => ({ SubtaskRunLivePanel: () => null }));
const events: ExecutionEvent[] = [{ runId: "failed-raw", seq: 1, emittedAt: "2026-11-05T00:00:00Z", kind: "status", status: "failed" }];
const scope = "org/raw-thread";
function LocaleControl() {
  const { locale, setLocale } = useI18n();
  return <button onClick={() => setLocale(locale === "en" ? "zh-CN" : "en")}>Switch test language</button>;
}
function host(props: React.ComponentProps<typeof RunTracePanel>) {
  return render(<I18nProvider initialLocale="en"><LocaleControl /><RunTracePanel {...props} /></I18nProvider>);
}
const switchLocale = () => fireEvent.click(screen.getByRole("button", { name: "Switch test language" }));
beforeEach(() => localStorage.clear());
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("projects accepted hide copy and hint without replacing the control or writing its preference on locale", () => {
  const set = vi.spyOn(Storage.prototype, "setItem");
  const retry = vi.fn();
  const before = JSON.stringify(events);
  host({ runId: "failed-raw", events, failureScope: scope, onRetryFailure: retry });
  const hide = screen.getByRole("button", { name: "Hide failed trace" });
  expect(hide).toHaveAttribute("title", "Hide only in this browser. The execution record is retained and can be restored.");
  switchLocale();
  expect(screen.getByRole("button", { name: "隐藏失败记录" })).toBe(hide);
  expect(hide).toHaveAttribute("title", "仅在此浏览器隐藏，执行记录仍保留，可恢复显示");
  expect(set.mock.calls.filter(([key]) => key === failureTraceKey(scope, "failed-raw", events))).toHaveLength(0);
  expect(retry).not.toHaveBeenCalled();
  expect(JSON.stringify(events)).toBe(before);
});

it("keeps an explicitly hidden trace hidden while localizing its retained notice and restore control", () => {
  const set = vi.spyOn(Storage.prototype, "setItem");
  const remove = vi.spyOn(Storage.prototype, "removeItem");
  const key = failureTraceKey(scope, "failed-raw", events)!;
  expect(key).not.toBeNull();
  host({ runId: "failed-raw", events, failureScope: scope });
  fireEvent.click(screen.getByRole("button", { name: "Hide failed trace" }));
  const hidden = screen.getByTestId("run-trace-hidden");
  expect(hidden).toHaveTextContent("Failed trace hidden in this browser");
  const restore = screen.getByRole("button", { name: "Restore display" });
  expect(localStorage.getItem(key)).toBe("1");
  expect(set.mock.calls.filter(([item]) => item === key)).toHaveLength(1);
  switchLocale();
  expect(screen.getByTestId("run-trace-hidden")).toBe(hidden);
  expect(hidden).toHaveTextContent("已在此浏览器隐藏失败记录");
  expect(screen.getByRole("button", { name: "恢复显示" })).toBe(restore);
  expect(set.mock.calls.filter(([item]) => item === key)).toHaveLength(1);
  expect(remove.mock.calls.filter(([item]) => item === key)).toHaveLength(0);
  fireEvent.click(restore);
  expect(remove.mock.calls.filter(([item]) => item === key)).toHaveLength(1);
  expect(screen.getByTestId("run-trace-toggle")).toHaveAttribute("aria-expanded", "false");
});

it("retains the accepted eligible retry callback and invokes it only on the explicit click", () => {
  const retry = vi.fn();
  host({ runId: "failed-raw", events, onRetryFailure: retry });
  const button = screen.getByRole("button", { name: /^Retry$/ });
  switchLocale();
  expect(screen.getByRole("button", { name: /^重试$/ })).toBe(button);
  expect(retry).not.toHaveBeenCalled();
  fireEvent.click(button);
  expect(retry).toHaveBeenCalledTimes(1);
});

it("does not offer run retry for a succeeded run with a settled failed tool in either locale", () => {
  const trace: ExecutionEvent[] = [
    { ...events[0]!, kind: "tool_start", toolCallId: "raw-tool", toolName: "execute", args: { raw: "用户原文不翻译" } },
    { ...events[0]!, seq: 2, kind: "tool_end", toolCallId: "raw-tool", toolName: "execute", ok: false, result: "raw failure cause" },
    { ...events[0]!, seq: 3, kind: "status", status: "succeeded" },
  ];
  const before = JSON.stringify(trace);
  const retry = vi.fn();
  host({ runId: "failed-raw", events: trace, failureScope: scope, onRetryFailure: retry });
  const hide = screen.getByRole("button", { name: "Hide failed trace" });
  expect(screen.queryByRole("button", { name: /^Retry$/ })).not.toBeInTheDocument();
  switchLocale();
  expect(screen.getByRole("button", { name: "隐藏失败记录" })).toBe(hide);
  expect(screen.queryByRole("button", { name: /^重试$/ })).not.toBeInTheDocument();
  expect(retry).not.toHaveBeenCalled();
  expect(JSON.stringify(trace)).toBe(before);
});
