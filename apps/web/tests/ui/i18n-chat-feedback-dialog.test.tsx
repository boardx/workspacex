import * as React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", async (load) => ({ ...(await load<typeof import("@/lib/api-client")>()), apiRequest: api }));
vi.mock("next/navigation", () => ({ usePathname: () => "/chat/raw-thread", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { FeedbackDialog, structuredToText, composeReviewDetail } from "@/components/feedback/feedback-dialog";
import { ApiError } from "@/lib/api-client";
import type { FeedbackItem } from "@/lib/live-feedback";
let changeLocale: () => void = () => {};
function LocaleControl() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
const raw = "用户原文 {kind}。代码 const a = '{locale}';";
const title = "模型标题 {title}";
const label = "组织数字人原名 {name}";
const target = { kind: "agent" as const, agentId: "raw-agent" };
afterEach(() => { cleanup(); vi.clearAllMocks(); });
function app(close: () => void) { return <I18nProvider initialLocale="en"><LocaleControl /><FeedbackDialog target={target} targetLabel={label} onClose={close} /></I18nProvider>; }
function structure(path: string, opts?: { method?: string }) { if (path === "/feedback/structure-draft") return Promise.resolve({ kind: "缺陷", title, detail: raw, structured: null }); if (path === "/feedback" && opts?.method !== "POST") return Promise.resolve({ items: [] }); throw new Error(`unexpected path ${path}`); }
it("preserves the actual compose draft and target through locale and Escape without submitting", () => {
  const close = vi.fn(); render(app(close));
  expect(screen.getByRole("dialog", { name: "Submit feedback" })).toBeTruthy(); expect(screen.getByTestId("feedback-dialog-title").textContent).toContain(label);
  const input = screen.getByTestId("feedback-detail-input"); fireEvent.change(input, { target: { value: raw } });
  act(() => changeLocale()); expect(screen.getByTestId("feedback-detail-input")).toBe(input); expect(input).toHaveValue(raw); expect(api).not.toHaveBeenCalled();
  fireEvent.keyDown(window, { key: "Escape" }); expect(close).toHaveBeenCalledTimes(1); expect(api).not.toHaveBeenCalled();
});
it("keeps the canonical kind, target and raw model-reviewed draft while a single submit is pending", async () => {
  let finish!: (value: { feedbackId: string; status: string }) => void;
  let saved = false;
  const item: FeedbackItem = { id: "raw-feedback-id", kind: "缺陷", target, targetLabel: label, title, detail: raw,
    attachments: [], structured: null, status: "待处理", statusReason: null, votes: 0, votedByMe: false,
    submittedByMe: true, submitterName: "原始提交人", occurredRoute: "/chat/raw-thread", appVersion: null,
    createdAt: "2026-11-04T00:00:00Z", githubIssueUrl: null, githubIssueNumber: null, resolvedByDesignId: null };
  api.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path === "/feedback" && opts?.method === "POST") return new Promise(resolve => { finish = value => { saved = true; resolve(value); }; });
    if (path === "/feedback") return Promise.resolve({ items: saved ? [item] : [] });
    return structure(path, opts);
  });
  render(app(vi.fn()));
  expect(screen.getByRole("dialog", { name: "Submit feedback" })).toBeTruthy();
  fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: raw } }); fireEvent.click(screen.getByTestId("feedback-proceed-review"));
  const submit = await screen.findByTestId("feedback-submit"); fireEvent.click(submit);
  const input = screen.getByTestId("feedback-detail-input"); act(() => changeLocale()); expect(screen.getByTestId("feedback-detail-input")).toBe(input); expect(input).toHaveValue(raw); expect(submit).toBeDisabled();
  const writes = api.mock.calls.filter(([path, opts]) => path === "/feedback" && opts?.method === "POST"); expect(writes).toHaveLength(1);
  expect(writes[0]?.[1].body).toMatchObject({ kind: "缺陷", target, title, detail: raw, occurredRoute: "/chat/raw-thread" });
  expect(Object.keys(writes[0]?.[1].body).sort()).toEqual(["appVersion", "detail", "kind", "occurredRoute", "target", "title"].sort());
  const request = api.mock.calls.find(([path]) => path === "/feedback/structure-draft"); expect(request?.[1].body).toEqual({ transcript: raw });
  await act(async () => { finish({ feedbackId: "raw-feedback-id", status: "待处理" }); });
  const row = await screen.findByTestId("feedback-mine-item-raw-feedback-id");
  expect(within(row).getByTestId("feedback-just-submitted")).toBeTruthy(); expect(row).toHaveTextContent(title); expect(row).toHaveTextContent(raw);
  expect(screen.getByTestId("feedback-tab-mine")).toHaveAttribute("aria-selected", "true");
  expect(api.mock.calls.filter(([path, opts]) => path === "/feedback" && opts?.method === "POST")).toHaveLength(1);
});
it("re-renders a persistent failed-submit notice without resubmitting or replacing the draft", async () => {
  api.mockImplementation((path: string, opts?: { method?: string }) => path === "/feedback" && opts?.method === "POST" ? Promise.reject(new ApiError(503, "DEPENDENCY_UNAVAILABLE", { debug: "internal detail" })) : structure(path, opts));
  render(app(vi.fn()));
  fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: raw } }); fireEvent.click(screen.getByTestId("feedback-proceed-review")); fireEvent.click(await screen.findByTestId("feedback-submit"));
  const failure = await screen.findByTestId("feedback-submit-error"); expect(failure.textContent?.toLowerCase()).toContain("not saved"); expect(failure.textContent).toContain("temporarily unavailable"); expect(failure.textContent).not.toContain("internal detail");
  act(() => changeLocale()); expect(screen.getByTestId("feedback-submit-error")).toBe(failure); expect(failure.textContent).toContain("没有被保存"); expect(screen.getByTestId("feedback-detail-input")).toHaveValue(raw);
  expect(api.mock.calls.filter(([path, opts]) => path === "/feedback" && opts?.method === "POST")).toHaveLength(1);
});
it("inserts authored template headings only on an explicit click and never rewrites existing content on locale", async () => {
  api.mockImplementation(structure); render(app(vi.fn()));
  fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: raw } }); fireEvent.click(screen.getByTestId("feedback-proceed-review"));
  await screen.findByTestId("feedback-submit"); const input = screen.getByTestId("feedback-detail-input") as HTMLTextAreaElement;
  expect(input).toHaveValue(raw); fireEvent.click(screen.getByRole("button", { name: "Apply template" }));
  const inserted = input.value; expect(inserted.startsWith(raw + "\n\n")).toBe(true); expect(inserted).toContain("Reproduction steps"); expect(inserted).toContain("Expected result"); expect(inserted).not.toContain("复现步骤");
  act(() => changeLocale()); expect(screen.getByTestId("feedback-detail-input")).toBe(input); expect(input).toHaveValue(inserted);
  expect(api.mock.calls.filter(([path, opts]) => path === "/feedback" && opts?.method === "POST")).toHaveLength(0);
});

it("keeps canonical reviewed-body headings and raw structured values independent of display locale", () => {
  render(app(vi.fn()));
  const bug = { reproFrequencyEnv: "原始环境 {env}", expectedResult: title, actualResult: raw, reproSteps: "1. 用户步骤 {step}" };
  const bugText = `复现频率 · 环境：\n原始环境 {env}\n\n期望结果：\n${title}\n\n实际结果：\n${raw}\n\n复现步骤：\n1. 用户步骤 {step}`;
  const requirement = { useScenario: raw, expectedCapability: title, priorityScope: "原始范围 {scope}" };
  const requirementText = `使用场景：\n${raw}\n\n期望能力：\n${title}\n\n优先级 · 影响范围：\n原始范围 {scope}`;
  expect(structuredToText("缺陷", bug)).toBe(bugText); expect(structuredToText("需求", requirement)).toBe(requirementText);
  expect(composeReviewDetail("缺陷", raw, bug)).toBe(raw + "\n\n" + bugText);
  act(() => changeLocale());
  expect(structuredToText("缺陷", bug)).toBe(bugText); expect(structuredToText("需求", requirement)).toBe(requirementText);
  expect(api).not.toHaveBeenCalled();
});
