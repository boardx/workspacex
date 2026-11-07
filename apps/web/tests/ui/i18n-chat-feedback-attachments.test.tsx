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
const raw = "用户反馈原文 {count}";
let changeLocale: () => void = () => {};
function Driver() { const { setLocale } = useI18n(); React.useEffect(() => { changeLocale = () => setLocale("zh-CN"); return () => { changeLocale = () => {}; }; }, [setLocale]); return null; }
function app() { return <I18nProvider initialLocale="en"><Driver /><FeedbackDialog target={{ kind: "product" }} targetLabel={null} onClose={vi.fn()} /></I18nProvider>; }
beforeEach(() => { ports.request.mockReset(); ports.upload.mockReset(); });
afterEach(cleanup);

it("localizes the upload entry and rejected-type notice while keeping the exact rejected filename and no upload", () => {
  render(app()); const button = screen.getByTestId("feedback-attachment-add"); expect(button).toHaveTextContent("Add files");
  const file = new File(["raw"], "原始文件 {name}.zip", { type: "application/zip" });
  fireEvent.change(screen.getByTestId("feedback-attachment-input"), { target: { files: [file] } });
  const rejected = screen.getByTestId("feedback-attachment-rejected"); expect(rejected).toHaveTextContent("Unsupported file type"); expect(rejected).toHaveTextContent(file.name);
  act(() => changeLocale()); expect(screen.getByTestId("feedback-attachment-add")).toBe(button); expect(screen.getByTestId("feedback-attachment-rejected")).toBe(rejected); expect(rejected).toHaveTextContent(file.name); expect(ports.upload).not.toHaveBeenCalled(); expect(ports.request).not.toHaveBeenCalled();
});

it("retains one pending original File across locale and removes it only explicitly", async () => {
  let finish!: (value: { attachmentId: string; url: string }) => void;
  ports.upload.mockImplementation(() => new Promise(done => { finish = done; }));
  render(app()); const file = new File(["raw bytes {locale}"], "原文 {name}.txt", { type: "text/plain" });
  fireEvent.change(screen.getByTestId("feedback-attachment-input"), { target: { files: [file] } });
  const remove = screen.getByRole("button", { name: "Remove this attachment" }); expect(ports.upload).toHaveBeenCalledTimes(1); expect(ports.upload).toHaveBeenCalledWith(file, "text/plain");
  act(() => changeLocale()); expect(screen.getByTestId(/^feedback-attachment-remove-/)).toBe(remove); expect(ports.upload).toHaveBeenCalledTimes(1);
  await act(async () => { finish({ attachmentId: "raw-server-id", url: "/feedback/attachments/raw-server-id" }); });
  fireEvent.click(remove); expect(screen.queryByTestId(/^feedback-attachment-file-/)).toBeNull(); expect(ports.upload).toHaveBeenCalledTimes(1);
});

it("formats a persistent upload failure in the current locale and retries the identical File only on click", async () => {
  ports.upload.mockRejectedValue(new TypeError("Failed to fetch")); render(app());
  const file = new File(["raw"], "原文.txt", { type: "text/plain" }); fireEvent.change(screen.getByTestId("feedback-attachment-input"), { target: { files: [file] } });
  const failure = await screen.findByTestId(/^feedback-attachment-error-/); expect(failure).toHaveTextContent("server");
  const retry = screen.getByRole("button", { name: "Retry upload" }); act(() => changeLocale()); expect(screen.getByTestId(/^feedback-attachment-error-/)).toBe(failure); expect(failure).toHaveTextContent("连不上服务器"); expect(ports.upload).toHaveBeenCalledTimes(1);
  fireEvent.click(retry); await act(async () => {}); expect(ports.upload).toHaveBeenCalledTimes(2); expect(ports.upload).toHaveBeenLastCalledWith(file, "text/plain");
});

it("keeps raw user text after a structure failure and changes only its persisted display on locale", async () => {
  ports.request.mockRejectedValue(new ApiError(503, "DEPENDENCY_UNAVAILABLE", "raw internal")); render(app());
  fireEvent.change(screen.getByTestId("feedback-detail-input"), { target: { value: raw } }); fireEvent.click(screen.getByTestId("feedback-proceed-review"));
  const failure = await screen.findByTestId("feedback-structure-error"); expect(failure).toHaveTextContent("Could not organize"); expect(screen.getByTestId("feedback-detail-input")).toHaveValue(raw);
  act(() => changeLocale()); expect(screen.getByTestId("feedback-structure-error")).toBe(failure); expect(screen.getByTestId("feedback-detail-input")).toHaveValue(raw); expect(ports.request).toHaveBeenCalledTimes(1); expect(ports.request).toHaveBeenCalledWith("/feedback/structure-draft", expect.objectContaining({ method: "POST", body: { transcript: raw } }));
});
