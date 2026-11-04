import * as React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { interview } from "@repo/contracts";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { InterviewStudioHome } from "@/components/itv/interview-studio-home";
import { InterviewHistoryCardActions } from "@/components/itv/interview-history-card-actions";
const api = vi.hoisted(() => ({ history: vi.fn(), experts: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/interview-api", async original => ({ ...await original<typeof import("@/lib/interview-api")>(), loadDigitalInterviewHistory: api.history, loadDigitalExperts: api.experts }));
vi.mock("@/lib/interview-expert-library-api", () => ({ loadCustomInterviewExperts: async () => ({ items: [] }) }));
function Language() { const { setLocale } = useI18n(); return <><button onClick={() => setLocale("en")}>EN test</button><button onClick={() => setLocale("zh-CN")}>ZH test</button></>; }
function show(children: React.ReactNode) { return render(<I18nProvider initialLocale="en"><Language />{children}</I18nProvider>); }
function swap() { fireEvent.click(screen.getByText("ZH test")); fireEvent.click(screen.getByText("EN test")); }
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); api.history.mockResolvedValue({ items: [] }); api.experts.mockResolvedValue({ items: [] }); });
it("localizes actual history filters and retains a raw query and chosen sort across locale changes", async () => {
  show(<InterviewStudioHome />);
  const input = await screen.findByRole("textbox", { name: "Search interviews" });
  expect(input).toHaveAttribute("placeholder", "Search interviews by name or tag");
  fireEvent.change(input, { target: { value: "用户查询 {count}" } }); swap();
  expect(input).toHaveValue("用户查询 {count}");
  fireEvent.click(screen.getByRole("button", { name: "Currently Recently updated; change sort order" }));
  swap(); expect(screen.getByRole("button", { name: "Currently Oldest updated; change sort order" })).toBeVisible();
  expect(api.history).toHaveBeenCalledTimes(1);
});
it("localizes the management business label while retaining an edited interview name", async () => {
  const item = interview.DigitalInterviewHistoryRow.parse({ interviewId: "history-locale", kind: "batch", name: "原始访谈 {count}", tags: ["原标签"], topic: "原主题", canManage: true, status: "report_pending", expertCount: 1, completedExpertCount: 1, primaryAction: "generate_report", updatedAt: "2026-11-03T00:00:00.000Z" });
  const changed = vi.fn(); show(<InterviewHistoryCardActions item={item} onChanged={changed} />);
  const trigger = screen.getByTestId("itv-history-actions-history-locale");
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false }); fireEvent.pointerUp(trigger, { button: 0, ctrlKey: false }); fireEvent.click(trigger);
  fireEvent.click(await screen.findByTestId("itv-history-edit-history-locale"));
  expect(screen.getByRole("heading", { name: "Edit interview" })).toBeVisible();
  fireEvent.change(screen.getByTestId("itv-edit-name"), { target: { value: "用户编辑访谈 {count}" } }); swap();
  expect(screen.getByRole("heading", { name: "Edit interview" })).toBeVisible();
  expect(screen.getByTestId("itv-edit-name")).toHaveValue("用户编辑访谈 {count}"); expect(changed).not.toHaveBeenCalled();
});
