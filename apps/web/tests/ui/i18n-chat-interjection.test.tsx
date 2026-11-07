import * as React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({ getStoredSessionToken: () => null, apiRequest: api }));
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { RunInterjections } from "@/components/chat/workbench/run-interjections";
import type { ExecutionEvent } from "@repo/contracts/execution-journal";
function SwitchLanguage() { const { setLocale } = useI18n(); return <button onClick={() => setLocale("zh-CN")}>switch language</button>; }
it("keeps unapplied content and explicit resend separate from a language change", () => {
  const resend = vi.fn(); const text = "用户插话 {count} 🌍";
  const events: ExecutionEvent[] = [{ runId: "raw-run", emittedAt: "2026-11-04T00:00:00Z", seq: 1, kind: "interjection", interjectionId: "raw-interjection", text, status: "not_applied" }];
  render(<I18nProvider initialLocale="en"><SwitchLanguage /><RunInterjections events={events} onResend={resend} /></I18nProvider>);
  const status = screen.getByTestId("workbench-interjection-status");
  expect(status.textContent).toContain("Not applied in this run; the assistant did not receive this message");
  expect(status.textContent).toContain(text); expect(within(status).getByRole("button", { name: "Resend" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "switch language" }));
  expect(screen.getByTestId("workbench-interjection-status")).toBe(status); expect(resend).not.toHaveBeenCalled(); expect(api).not.toHaveBeenCalled();
  fireEvent.click(within(status).getByRole("button", { name: "重新发送" })); expect(resend).toHaveBeenCalledTimes(1); expect(resend).toHaveBeenCalledWith(text);
});
it("describes carried-over input as a durable handoff without offering another resend", () => {
  const resend = vi.fn(); const text = "下一轮原文 {status}";
  const events: ExecutionEvent[] = [{ runId: "raw-run", emittedAt: "2026-11-04T00:00:00Z", seq: 1, kind: "interjection", interjectionId: "carried-id", text, status: "carried_over" }];
  render(<I18nProvider initialLocale="en"><RunInterjections events={events} onResend={resend} /></I18nProvider>);
  const status = screen.getByTestId("workbench-interjection-status"); expect(status.getAttribute("data-status")).toBe("carried_over");
  expect(status.textContent).toContain("Carried over as the next message"); expect(status.textContent).toContain(text);
  expect(screen.queryByTestId("workbench-interjection-resend")).toBeNull(); expect(resend).not.toHaveBeenCalled();
});
