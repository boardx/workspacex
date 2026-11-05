import * as React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
const ports = vi.hoisted(() => ({ request: vi.fn(), download: vi.fn() }));
vi.mock("@/lib/api-client", async load => ({ ...(await load<typeof import("@/lib/api-client")>()), apiRequest: ports.request }));
vi.mock("@/lib/live-feedback", async load => ({ ...(await load<typeof import("@/lib/live-feedback")>()), fetchFeedbackAttachmentObjectUrl: ports.download }));
vi.mock("next/navigation", () => ({ usePathname: () => "/chat/raw-thread", useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
import { FeedbackDialog } from "@/components/feedback/feedback-dialog";
import type { FeedbackItem } from "@/lib/live-feedback";
import { I18nProvider, useI18n } from "@/lib/i18n/provider";
const url = "/feedback/attachments/raw-server-id";
const base: FeedbackItem = { id: "raw-feedback", kind: "缺陷", target: { kind: "product" }, targetLabel: null, title: "用户原始标题 {title}", detail: "用户正文 {body}", attachments: [], structured: null, status: "待处理", statusReason: null, votes: 0, votedByMe: false, submittedByMe: true, submitterName: "原名", occurredRoute: "/chat/raw-thread", appVersion: null, createdAt: "2026-11-04T00:00:00Z", githubIssueUrl: null, githubIssueNumber: null, resolvedByDesignId: null };
let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
async function openMine(mime: "application/pdf" | "image/png") { const item: FeedbackItem = { ...base, attachments: [{ id: "raw-attachment", mime, url }] }; ports.request.mockResolvedValue({ items: [item] }); render(<I18nProvider initialLocale="en"><Driver /><FeedbackDialog target={{ kind: "product" }} targetLabel={null} onClose={vi.fn()} /></I18nProvider>); fireEvent.click(screen.getByTestId("feedback-tab-mine")); return screen.findByTestId("feedback-mine-attachment-open"); }
beforeEach(() => { ports.request.mockReset(); ports.download.mockReset(); ports.download.mockResolvedValue("blob:original-bytes"); vi.stubGlobal("IntersectionObserver", undefined); vi.stubGlobal("URL", class extends URL { static revokeObjectURL = vi.fn(); }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("keeps actual PDF preview iframe and exact authenticated download bytes on locale without downloading again", async () => {
  const open = await openMine("application/pdf"); expect(open).toHaveAccessibleName("Preview PDF attachment"); expect(ports.download).not.toHaveBeenCalled(); fireEvent.click(open);
  const frame = await screen.findByTestId("feedback-mine-attachment-preview-pdf"); expect(frame).toHaveAttribute("title", "PDF attachment"); expect(frame).toHaveAttribute("src", "blob:original-bytes"); expect(ports.download).toHaveBeenCalledTimes(1); expect(ports.download).toHaveBeenCalledWith(url);
  const preview = screen.getByTestId("feedback-mine-attachment-preview"); act(() => changeLocale()); expect(screen.getByTestId("feedback-mine-attachment-preview-pdf")).toBe(frame); expect(screen.getByTestId("feedback-mine-attachment-preview")).toBe(preview); expect(frame).toHaveAttribute("src", "blob:original-bytes"); expect(ports.download).toHaveBeenCalledTimes(1); expect(ports.request).toHaveBeenCalledTimes(1);
});

it("uses the same lazy-loaded image bytes in the actual preview and keeps its chrome DOM on locale", async () => {
  const open = await openMine("image/png"); expect(open).toHaveAccessibleName("Preview attachment"); fireEvent.click(open);
  const image = screen.getByTestId("feedback-mine-attachment-preview-image"); expect(image).toHaveAttribute("src", "blob:original-bytes"); const preview = screen.getByTestId("feedback-mine-attachment-preview"); expect(preview).toHaveTextContent("Attachment preview");
  act(() => changeLocale()); expect(screen.getByTestId("feedback-mine-attachment-preview-image")).toBe(image); expect(screen.getByTestId("feedback-mine-attachment-preview")).toBe(preview); expect(image).toHaveAttribute("src", "blob:original-bytes"); expect(ports.download).toHaveBeenCalledTimes(1); expect(ports.download).toHaveBeenCalledWith(url); expect(ports.request).toHaveBeenCalledTimes(1);
});

it("keeps a failed file-preview button and retries only an explicit click with the same canonical URL", async () => {
  ports.download.mockRejectedValue(new TypeError("Failed to fetch")); const open = await openMine("application/pdf"); fireEvent.click(open); await act(async () => {}); expect(open).toHaveAttribute("title", "Load failed. Click to retry.");
  act(() => changeLocale()); expect(screen.getByTestId("feedback-mine-attachment-open")).toBe(open); expect(ports.download).toHaveBeenCalledTimes(1); fireEvent.click(open); await act(async () => {}); expect(ports.download).toHaveBeenCalledTimes(2); expect(ports.download).toHaveBeenLastCalledWith(url); expect(ports.request).toHaveBeenCalledTimes(1);
});
