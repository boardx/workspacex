import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
const api = vi.hoisted(() => ({ load: vi.fn(), event: vi.fn(), dismiss: vi.fn() }));
vi.mock("@/lib/knowledge-graph-api", async (load) => ({ ...(await load<typeof import("@/lib/knowledge-graph-api")>()), fetchSessionBriefing: api.load, recordSessionBriefingEvent: api.event, setSessionBriefingDismissed: api.dismiss }));
import { SessionBriefing } from "@/components/chat/knowledge/session-briefing";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { knowledgeGraph } from "@repo/contracts/chat-knowledge-graph";
const statement = "用户记忆原文 {count}";
const resumePrompt = "服务端首问原文 {locale} const x = '{value}';";
const data = knowledgeGraph.getSessionBriefing.out.parse({ dismissed: false, items: [{ itemId: "recent:raw", section: "recent", kind: "decision", cardKind: null, statement, counterpart: null, goal: null, saidAt: "2026-11-01T12:00:00Z", cite: { claimId: "raw-claim", scope: "personal", threadId: "raw-thread" }, resumePrompt }] });
let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
beforeEach(() => { api.load.mockReset(); api.event.mockReset(); api.dismiss.mockReset(); api.event.mockResolvedValue({ recorded: true }); api.dismiss.mockResolvedValue({ dismissed: true }); });
afterEach(cleanup);

it("changes authored briefing chrome without refetching, re-recording shown or translating server resume text", async () => {
  api.load.mockResolvedValue(data); const resume = vi.fn();
  render(<I18nProvider initialLocale="en"><Driver /><SessionBriefing onResume={resume} /></I18nProvider>);
  const root = await screen.findByTestId("session-briefing"); expect(root).toHaveTextContent("Continue from last time");
  expect(root).toHaveTextContent(statement); const button = screen.getByRole("button", { name: "Continue" });
  await waitFor(() => expect(api.event).toHaveBeenCalledTimes(1)); expect(api.event).toHaveBeenCalledWith("shown", ["recent:raw"]); expect(resume).not.toHaveBeenCalled();
  act(() => changeLocale()); expect(screen.getByTestId("session-briefing")).toBe(root); expect(screen.getByRole("button", { name: "续上" })).toBe(button); expect(api.load).toHaveBeenCalledTimes(1); expect(api.event).toHaveBeenCalledTimes(1);
  fireEvent.click(button); expect(resume).toHaveBeenCalledTimes(1); expect(resume).toHaveBeenCalledWith(resumePrompt); expect(screen.getByTestId("session-briefing-cited")).toHaveAttribute("data-claim-id", "raw-claim"); expect(screen.getByTestId("session-briefing-cited")).toHaveTextContent(statement);
  expect(api.event).toHaveBeenLastCalledWith("accepted", ["recent:raw"]); expect(api.dismiss).not.toHaveBeenCalled();
});

it("localizes a persisted read failure without retrying or blocking a conversation", async () => {
  api.load.mockRejectedValue(new Error("private backend diagnostic"));
  render(<I18nProvider initialLocale="en"><Driver /><SessionBriefing onResume={vi.fn()} /></I18nProvider>);
  const failure = await screen.findByTestId("err-session-briefing"); expect(failure).toHaveTextContent("Could not load your previous progress"); expect(failure).not.toHaveTextContent("private backend diagnostic");
  act(() => changeLocale()); expect(screen.getByTestId("err-session-briefing")).toBe(failure); expect(api.load).toHaveBeenCalledTimes(1); expect(api.event).not.toHaveBeenCalled(); expect(api.dismiss).not.toHaveBeenCalled();
});

it("keeps a failed explicit dismissal as localized display state without repeating preference writes", async () => {
  api.load.mockResolvedValue(data); api.dismiss.mockRejectedValue(new Error("private preference diagnostic"));
  render(<I18nProvider initialLocale="en"><Driver /><SessionBriefing onResume={vi.fn()} /></I18nProvider>);
  await screen.findByTestId("session-briefing"); fireEvent.click(screen.getByRole("button", { name: "Dismiss opening briefing" }));
  const failure = await screen.findByTestId("err-session-briefing-dismiss"); expect(failure).toHaveTextContent("Could not dismiss"); expect(api.dismiss).toHaveBeenCalledTimes(1); expect(api.dismiss).toHaveBeenCalledWith(true);
  act(() => changeLocale()); expect(screen.getByTestId("err-session-briefing-dismiss")).toBe(failure); expect(api.dismiss).toHaveBeenCalledTimes(1); expect(api.load).toHaveBeenCalledTimes(1);
});
