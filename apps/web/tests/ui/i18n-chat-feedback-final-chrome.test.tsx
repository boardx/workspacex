import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
const ports = vi.hoisted(() => ({ request: vi.fn(), upload: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/api-client", async load => ({ ...(await load<typeof import("@/lib/api-client")>()), apiRequest: ports.request }));
vi.mock("@/lib/live-feedback", async load => ({ ...(await load<typeof import("@/lib/live-feedback")>()), uploadFeedbackAttachment: ports.upload }));
vi.mock("next/navigation", () => ({ usePathname: () => "/chat/raw-thread", useRouter: () => ({ push: ports.push, replace: vi.fn() }) }));
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import type { FeedbackItem } from "@/lib/live-feedback";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
const raw = "原始用户正文 {locale}";
let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
function app(props: Partial<React.ComponentProps<typeof FeedbackDialog>> = {}) { return <I18nProvider initialLocale="en"><Driver /><FeedbackDialog target={{ kind: "product" }} targetLabel={null} onClose={vi.fn()} {...props} /></I18nProvider>; }
async function review(text = raw) { fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: text } }); fireEvent.click(screen.getByTestId("feedback-proceed-review")); await screen.findByTestId("feedback-submit"); }
beforeEach(() => { ports.request.mockReset(); ports.upload.mockReset(); ports.push.mockReset(); ports.request.mockImplementation((path: string, opts?: { body?: { transcript?: string } }) => path === "/feedback/structure-draft" ? Promise.resolve({ kind: "缺陷", title: "模型标题 {title}", detail: opts?.body?.transcript ?? raw, structured: null }) : Promise.resolve({ items: [] })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("localizes initial guidance and final submit/cancel chrome while keeping the same body and only explicit cancel", async () => {
  const close = vi.fn(); render(app({ onClose: close })); expect(screen.getByTestId("feedback-dialog")).toHaveTextContent("Speak to transcribe"); expect(screen.getByRole("button", { name: "Next" })).toBeTruthy(); await review();
  const submit = screen.getByRole("button", { name: "Submit directly" }); const cancel = screen.getByRole("button", { name: /^Cancel$/ }); act(() => changeLocale()); expect(screen.getByTestId("feedback-submit")).toBe(submit); expect(screen.getByTestId("feedback-detail-input")).toHaveValue(raw); expect(close).not.toHaveBeenCalled(); expect(ports.request).toHaveBeenCalledTimes(1); fireEvent.click(cancel); expect(close).toHaveBeenCalledTimes(1);
});

it("retains an already-saved feedback receipt after navigation fails, with raw ID and no second POST on locale", async () => {
  const id = "raw-feedback/{id}"; const submitted = vi.fn(); const close = vi.fn(); ports.push.mockImplementation(() => { throw new Error("navigation unavailable"); });
  ports.request.mockImplementation((path: string, opts?: { method?: string }) => path === "/feedback/structure-draft" ? Promise.resolve({ kind: "缺陷", title: "模型标题", detail: raw, structured: null }) : path === "/feedback" && opts?.method === "POST" ? Promise.resolve({ feedbackId: id, status: "待处理" }) : Promise.resolve({ items: [] }));
  render(app({ afterSubmit: "inbox", onSubmitted: submitted, onClose: close })); await review(); fireEvent.click(screen.getByTestId("feedback-submit")); const receipt = await screen.findByTestId("feedback-inbox-open-failed"); expect(receipt).toHaveTextContent("Saved, but the inbox could not be opened"); expect(receipt).toHaveTextContent(id); const link = within(receipt).getByRole("link", { name: "Open saved feedback" }); expect(link).toHaveAttribute("href", `/platform-admin/inbox?open=${encodeURIComponent(id)}`);
  act(() => changeLocale()); expect(screen.getByTestId("feedback-inbox-open-failed")).toBe(receipt); expect(receipt).toHaveTextContent(id); expect(submitted).toHaveBeenCalledTimes(1); expect(submitted).toHaveBeenCalledWith(id); expect(close).not.toHaveBeenCalled(); expect(ports.request.mock.calls.filter(([path, opts]) => path === "/feedback" && opts?.method === "POST")).toHaveLength(1); expect(screen.queryByTestId("feedback-submit-error")).toBeNull();
});

it("opens the original selected image preview with a raw filename and reuses its bytes across locale", async () => {
  vi.stubGlobal("URL", class extends URL { static createObjectURL = vi.fn(() => "blob:original-file"); static revokeObjectURL = vi.fn(); }); ports.upload.mockResolvedValue({ attachmentId: "raw-attachment", url: "/feedback/attachments/raw-attachment" });
  render(app()); const file = new File([new Uint8Array([137, 80, 78, 71])], "原图 {name}.png", { type: "image/png" }); fireEvent.change(screen.getByTestId("feedback-attachment-input"), { target: { files: [file] } }); await act(async () => {}); fireEvent.click(screen.getByRole("button", { name: `Preview ${file.name}` }));
  const preview = screen.getByTestId("feedback-attachment-preview"); const image = screen.getByTestId("feedback-attachment-preview-image"); expect(preview).toHaveTextContent(file.name); expect(image).toHaveAttribute("alt", file.name); expect(image).toHaveAttribute("src", "blob:original-file"); act(() => changeLocale()); expect(screen.getByTestId("feedback-attachment-preview-image")).toBe(image); expect(screen.getByTestId("feedback-attachment-preview")).toBe(preview); expect(image).toHaveAttribute("src", "blob:original-file"); expect(ports.upload).toHaveBeenCalledTimes(1); expect(ports.upload).toHaveBeenCalledWith(file, "image/png");
});

it("keeps a declined full-template insertion and its original raw body when the persisted notice changes language", async () => {
  render(app()); await review(); const input = screen.getByTestId("feedback-detail-input") as HTMLTextAreaElement; const full = "原文{raw}".padEnd(input.maxLength - 1, "x"); fireEvent.change(input, { target: { value: full } }); fireEvent.click(screen.getByTestId("feedback-template-button"));
  const notice = screen.getByTestId("feedback-template-notice"); expect(notice).toHaveTextContent("Not enough room"); expect(input).toHaveValue(full); const before = notice.textContent; act(() => changeLocale()); expect(screen.getByTestId("feedback-template-notice")).toBe(notice); expect(notice.textContent).not.toBe(before); expect(screen.getByTestId("feedback-detail-input")).toBe(input); expect(input).toHaveValue(full); expect(ports.request).toHaveBeenCalledTimes(1);
});

it("translates structured field headings only at render, retaining exact stored model text and stable field rows", async () => {
  const model = "模型结构化原文 {field}\n1. 保留原文";
  const item: FeedbackItem = { id: "raw-feedback", kind: "缺陷", target: { kind: "product" }, targetLabel: null, title: "模型标题", detail: raw, attachments: [], structured: { reproSteps: model }, status: "待处理", statusReason: null, votes: 0, votedByMe: false, submittedByMe: true, submitterName: "用户原名", occurredRoute: "/chat", appVersion: null, createdAt: "2026-11-04T00:00:00Z", githubIssueUrl: null, githubIssueNumber: null, resolvedByDesignId: null };
  ports.request.mockResolvedValue({ items: [item] }); render(app()); fireEvent.click(screen.getByTestId("feedback-tab-mine")); const block = await screen.findByTestId("feedback-mine-structured-raw-feedback"); const heading = within(block).getByText("Reproduction steps"); const body = screen.getByTestId("feedback-mine-structured-raw-feedback-repro-steps"); expect(body.textContent).toBe(model); act(() => changeLocale()); expect(within(block).getByText("复现步骤")).toBe(heading); expect(screen.getByTestId("feedback-mine-structured-raw-feedback-repro-steps")).toBe(body); expect(body.textContent).toBe(model); expect(ports.request).toHaveBeenCalledTimes(1);
});
