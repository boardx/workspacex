import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
const ports = vi.hoisted(() => ({ request: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/api-client", async load => ({ ...(await load<typeof import("@/lib/api-client")>()), apiRequest: ports.request }));
vi.mock("@/lib/live-feedback", async load => ({ ...(await load<typeof import("@/lib/live-feedback")>()), uploadFeedbackAttachment: ports.upload }));
vi.mock("next/navigation", () => ({ usePathname: () => "/chat/raw-thread", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
import { ApiError } from "@/lib/api-client";
import { feedbackLoop } from "@repo/contracts";
const raw = "原始反馈正文 {locale}";
const target = { kind: "agent" as const, agentId: "raw-agent" };
let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
function app(onDraftSaved = vi.fn()) { return <I18nProvider initialLocale="en"><Driver /><FeedbackDialog target={target} targetLabel="组织原名 {target}" onClose={vi.fn()} onDraftSaved={onDraftSaved} /></I18nProvider>; }
async function review() { fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: raw } }); fireEvent.click(screen.getByTestId("feedback-proceed-review")); await screen.findByTestId("feedback-submit"); }
beforeEach(() => { vi.stubEnv("NEXT_PUBLIC_APP_VERSION", "raw-build/{version}"); ports.request.mockReset(); ports.upload.mockReset(); ports.request.mockImplementation((path: string) => path === "/feedback/structure-draft" ? Promise.resolve({ kind: "需求", title: "模型标题 {title}", detail: raw, structured: null }) : Promise.resolve({ items: [] })); });
afterEach(() => { cleanup(); vi.unstubAllEnvs(); });

it("keeps a persistent draft-save failure and the raw editable body without locale retries", async () => {
  ports.request.mockImplementation((path: string) => path === "/feedback/structure-draft" ? Promise.resolve({ kind: "需求", title: "模型标题", detail: raw, structured: null }) : Promise.reject(new ApiError(503, "DEPENDENCY_UNAVAILABLE", "internal")));
  render(app()); await review(); const button = screen.getByRole("button", { name: "Save draft" }); fireEvent.click(button);
  const failure = await screen.findByTestId("feedback-draft-error"); expect(failure).toHaveTextContent("Draft was not saved"); expect(screen.getByTestId("feedback-detail-input")).toHaveValue(raw);
  act(() => changeLocale()); expect(screen.getByTestId("feedback-save-draft")).toBe(button); expect(screen.getByTestId("feedback-draft-error")).toBe(failure); expect(failure).toHaveTextContent("草稿没有被保存"); expect(screen.getByTestId("feedback-detail-input")).toHaveValue(raw); expect(ports.request.mock.calls.filter(([path]) => path === "/feedback/drafts")).toHaveLength(1);
});

it("preserves an explicit pending draft POST payload and delivers the raw returned ID once", async () => {
  let finish!: (value: { draftId: string }) => void;
  ports.request.mockImplementation((path: string) => path === "/feedback/structure-draft" ? Promise.resolve({ kind: "需求", title: "模型标题", detail: raw, structured: null }) : new Promise(done => { finish = done; }));
  const saved = vi.fn(); render(app(saved)); await review(); const button = screen.getByRole("button", { name: "Save draft" }); fireEvent.click(button); expect(button).toBeDisabled();
  const calls = ports.request.mock.calls.filter(([path]) => path === "/feedback/drafts"); expect(calls).toHaveLength(1); expect(calls[0]?.[1]).toEqual({ method: "POST", body: { kind: "需求", target, detail: raw, occurredRoute: "/chat/raw-thread", appVersion: "raw-build/{version}" } });
  act(() => changeLocale()); expect(screen.getByTestId("feedback-save-draft")).toBe(button); expect(button).toBeDisabled(); expect(screen.getByTestId("feedback-detail-input")).toHaveValue(raw); expect(saved).not.toHaveBeenCalled();
  await act(async () => { finish({ draftId: "raw-draft/{id}" }); }); expect(saved).toHaveBeenCalledTimes(1); expect(saved).toHaveBeenCalledWith("raw-draft/{id}"); expect(ports.request.mock.calls.filter(([path]) => path === "/feedback/drafts")).toHaveLength(1);
});

it("translates explicit collected-context disclosure and workbench link without changing raw route or editable body", async () => {
  render(app()); await review(); const notice = screen.getByTestId("feedback-context-notice"); expect(notice).toHaveTextContent("Included context"); expect(notice).toHaveTextContent("/chat/raw-thread"); expect(notice).toHaveTextContent("raw-build/{version}");
  const link = screen.getByRole("link", { name: "Design in the PM workbench" }); expect(link).toHaveAttribute("href", "/platform-admin/design-workbench");
  act(() => changeLocale()); expect(screen.getByTestId("feedback-context-notice")).toBe(notice); expect(screen.getByTestId("feedback-workbench-link")).toBe(link); expect(screen.getByTestId("feedback-detail-input")).toHaveValue(raw); expect(ports.request).toHaveBeenCalledTimes(1);
});

it("keeps contract upload quota and accepted raw Files fixed through locale without retrying or silently adding extras", async () => {
  ports.upload.mockImplementation((file: File) => Promise.resolve({ attachmentId: file.name, url: "/feedback/attachments/raw" })); render(app());
  const files = Array.from({ length: feedbackLoop.FEEDBACK_ATTACHMENT_MAX + 1 }, (_, i) => new File([`raw ${i}`], `原文${i}{name}.txt`, { type: "text/plain" }));
  fireEvent.change(screen.getByTestId("feedback-attachment-input"), { target: { files } }); await act(async () => {});
  const quota = screen.getByTestId("feedback-attachment-quota"); expect(quota).toHaveTextContent("not added"); expect(screen.getByTestId("feedback-attachment-full")).toHaveTextContent("Attachment limit"); expect(screen.queryByTestId("feedback-attachment-add")).toBeNull(); expect(ports.upload).toHaveBeenCalledTimes(feedbackLoop.FEEDBACK_ATTACHMENT_MAX);
  act(() => changeLocale()); expect(screen.getByTestId("feedback-attachment-quota")).toBe(quota); expect(ports.upload).toHaveBeenCalledTimes(feedbackLoop.FEEDBACK_ATTACHMENT_MAX); expect(ports.upload.mock.calls.map(([file]) => file)).toEqual(files.slice(0, feedbackLoop.FEEDBACK_ATTACHMENT_MAX));
});
