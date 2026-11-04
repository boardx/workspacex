import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", async (load) => ({ ...(await load<typeof import("@/lib/api-client")>()), apiRequest: api }));
vi.mock("next/navigation", () => ({ usePathname: () => "/chat/raw-thread", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import { ApiError } from "@/lib/api-client";
import type { FeedbackItem } from "@/lib/live-feedback";

const raw = "用户原文 {kind} const code = '{locale}';";
const rawTitle = "模型标题 {title}";
const rawTarget = "组织数字人原名 {name}";
const target = { kind: "agent" as const, agentId: "raw-agent" };
let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
function app() { return <I18nProvider initialLocale="en"><Driver /><FeedbackDialog target={target} targetLabel={rawTarget} onClose={vi.fn()} /></I18nProvider>; }
const item: FeedbackItem = { id: "raw-feedback", kind: "需求", target, targetLabel: rawTarget, title: rawTitle, detail: raw, attachments: [], structured: null, status: "不做", statusReason: "原始处理说明 {reason}", votes: 3, votedByMe: false, submittedByMe: true, submitterName: "用户原名", occurredRoute: "/chat/raw-thread", appVersion: null, createdAt: "2026-11-04T00:00:00Z", githubIssueUrl: null, githubIssueNumber: null, resolvedByDesignId: null };
beforeEach(() => { api.mockReset(); });
afterEach(cleanup);

it("keeps fullscreen, compose draft and raw target while translating actual controls", () => {
  render(app());
  const dialog = screen.getByTestId("feedback-dialog"); const input = screen.getByTestId("feedback-detail-input");
  expect(screen.getByRole("tab", { name: "Submit" })).toHaveAttribute("aria-selected", "true");
  expect(screen.getByRole("tab", { name: "My feedback" })).toHaveAttribute("aria-selected", "false");
  expect(screen.getByTestId("feedback-dialog-title")).toHaveTextContent(rawTarget);
  fireEvent.change(input, { target: { value: raw } }); fireEvent.click(screen.getByRole("button", { name: "Fullscreen" }));
  expect(dialog).toHaveAttribute("data-fullscreen", "true");
  act(() => changeLocale()); expect(screen.getByTestId("feedback-dialog")).toBe(dialog); expect(screen.getByTestId("feedback-detail-input")).toBe(input); expect(input).toHaveValue(raw);
  expect(dialog).toHaveAttribute("data-fullscreen", "true"); expect(screen.getByRole("button", { name: "退出全屏" })).toBeTruthy(); expect(api).not.toHaveBeenCalled();
});

it("localizes reviewed kind display while preserving canonical kind and raw model-authored title/body", async () => {
  api.mockImplementation((path: string) => path === "/feedback/structure-draft" ? Promise.resolve({ kind: "缺陷", title: rawTitle, detail: raw, structured: null }) : Promise.resolve({ items: [] }));
  render(app()); fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: raw } }); fireEvent.click(screen.getByTestId("feedback-proceed-review"));
  await screen.findByTestId("feedback-submit");
  const kind = screen.getByRole("button", { name: "Feature request" }); fireEvent.click(kind); expect(kind).toHaveAttribute("aria-pressed", "true");
  const title = screen.getByTestId("feedback-title-input"); const detail = screen.getByTestId("feedback-detail-input"); expect(title).toHaveValue(rawTitle); expect(detail).toHaveValue(raw);
  act(() => changeLocale()); expect(screen.getByTestId("feedback-kind-需求")).toBe(kind); expect(kind).toHaveAttribute("aria-pressed", "true"); expect(title).toHaveValue(rawTitle); expect(detail).toHaveValue(raw);
  expect(api.mock.calls.filter(([path]) => path === "/feedback/structure-draft")).toHaveLength(1); expect(api.mock.calls.filter(([path, opts]) => path === "/feedback" && opts?.method === "POST")).toHaveLength(0);
});

it("renders canonical mine status/kind without translating stored title/detail/reason or refetching on locale", async () => {
  api.mockResolvedValue({ items: [item] }); render(app()); fireEvent.click(screen.getByTestId("feedback-tab-mine"));
  const row = await screen.findByTestId("feedback-mine-item-raw-feedback");
  expect(within(row).getByText("Won’t do")).toBeTruthy(); expect(within(row).getByText("Feature request")).toBeTruthy();
  expect(row).toHaveTextContent(rawTitle); expect(row).toHaveTextContent(raw); expect(row).toHaveTextContent(item.statusReason!);
  act(() => changeLocale()); expect(screen.getByTestId("feedback-mine-item-raw-feedback")).toBe(row); expect(row).toHaveTextContent(raw); expect(row).toHaveTextContent(item.statusReason!); expect(api).toHaveBeenCalledTimes(1);
});

it("updates a persisted mine-load error only in the view and retries only explicitly", async () => {
  api.mockRejectedValue(new ApiError(503, "DEPENDENCY_UNAVAILABLE", { debug: "private internal detail" }));
  render(app()); fireEvent.click(screen.getByTestId("feedback-tab-mine"));
  const notice = await screen.findByTestId("feedback-mine-failed");
  expect(notice).toHaveTextContent("Your feedback has not been lost"); expect(notice.textContent?.toLowerCase()).toContain("temporarily unavailable"); expect(notice).not.toHaveTextContent("private internal detail");
  act(() => changeLocale()); expect(screen.getByTestId("feedback-mine-failed")).toBe(notice); expect(api).toHaveBeenCalledTimes(1);
  api.mockResolvedValue({ items: [] }); fireEvent.click(within(notice).getByRole("button", { name: "重试" }));
  expect(await screen.findByTestId("feedback-mine-empty")).toHaveTextContent("你还没提过反馈。"); expect(api).toHaveBeenCalledTimes(2);
});
