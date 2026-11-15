import * as React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { AidtImageAttachmentPicker, AidtImageAttachmentPreview } from "@/features/aidt/components/aidt-image-attachment-picker";
import type { AidtImageAttachmentOption } from "@/features/aidt/lib/aidt-image-attachments";
const mocks = vi.hoisted(() => ({ enabled: true, hasSession: true, load: vi.fn(), media: vi.fn(), session: { currentOrgId: "org", userId: "student", sessionToken: "token" } }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mocks.enabled }));
vi.mock("@/features/aidt/lib/aidt-image-attachments", async (original) => ({ ...await original<typeof import("@/features/aidt/lib/aidt-image-attachments")>(), loadAidtImageAttachments: mocks.load }));
vi.mock("@/components/session/session-provider", () => ({ useOptionalSession: () => mocks.hasSession ? ({ session: mocks.session }) : null }));
vi.mock("@/lib/use-authed-image-src", () => ({ useAuthedImageSrc: mocks.media }));
vi.mock("@/lib/api-client", () => ({ apiUrl: (path: string) => `/api${path}` }));
const option = (attachmentId = "a1", threadId = "t"): AidtImageAttachmentOption => ({ attachmentId, threadId, name: `${attachmentId}.png`, mime: "image/png", bytes: 12, createdAt: "2026-11-15T00:00:00Z", messageId: "m1" });
beforeEach(() => { vi.clearAllMocks(); mocks.enabled = true; mocks.hasSession = true; mocks.load.mockResolvedValue([option()]); mocks.media.mockReturnValue({ src: "blob:authorized-native-image", failed: false }); });
it("loads lazily and selects only an existing sent attachment reference", async () => {
  const selected = vi.fn(); render(<AidtImageAttachmentPicker projectId="p" thread="t" onChange={selected} />);
  expect(mocks.load).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "选择点子图像" }));
  const image = await screen.findByRole("img", { name: "a1.png" });
  const choice = screen.getByRole("button", { name: /a1.png/ }); expect(choice).toBeDisabled();
  Object.defineProperties(image, { naturalWidth: { value: 40 }, naturalHeight: { value: 30 } }); fireEvent.load(image);
  await waitFor(() => expect(choice).toBeEnabled()); fireEvent.click(choice);
  expect(selected).toHaveBeenCalledWith({ attachmentId: "a1", threadId: "t", name: "a1.png" });
  expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ projectId: "p", threadId: "t", sessionToken: "token" }));
  expect(mocks.media).toHaveBeenCalledWith("/api/chat/threads/t/attachments/a1/content");
  expect(screen.queryByText("从本步共享对话中选择已发送的图片。", { exact: false })).not.toBeInTheDocument();
});
it("distinguishes loading failure with retry from a genuine empty list", async () => {
  mocks.load.mockRejectedValueOnce(new Error("503"));
  render(<AidtImageAttachmentPicker projectId="p" thread="t" onChange={vi.fn()} />); fireEvent.click(screen.getByRole("button", { name: "选择点子图像" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("不能据此判断没有图片");
  expect(screen.queryByText("本步还没有可选择的已发送图片。")).not.toBeInTheDocument();
  mocks.load.mockResolvedValueOnce([]); fireEvent.click(screen.getByRole("button", { name: "重试图片列表" }));
  expect(await screen.findByText("本步还没有可选择的已发送图片。")).toBeVisible();
});
it("keeps image selection disabled when authenticated bytes are unavailable", async () => {
  mocks.media.mockReturnValue({ src: null, failed: true }); const selected = vi.fn();
  render(<AidtImageAttachmentPicker projectId="p" thread="t" onChange={selected} />); fireEvent.click(screen.getByRole("button", { name: "选择点子图像" }));
  const choice = await screen.findByRole("button", { name: /a1.png/ }); expect(choice).toBeDisabled(); expect(selected).not.toHaveBeenCalled();
});
it("does not read or change materials when the module is disabled or no thread is ready", () => {
  mocks.enabled = false; const selected = vi.fn(); const { rerender } = render(<AidtImageAttachmentPicker projectId="p" thread="t" onChange={selected} />);
  expect(screen.queryByTestId("aidt-image-attachment-picker")).not.toBeInTheDocument(); expect(mocks.load).not.toHaveBeenCalled();
  mocks.enabled = true; rerender(<AidtImageAttachmentPicker projectId="p" thread={null} onChange={selected} />);
  expect(screen.getByRole("button", { name: "选择点子图像" })).toBeDisabled(); expect(mocks.load).not.toHaveBeenCalled();
});
it("respects readonly and removes a reference without deleting the native attachment", () => {
  const selected = vi.fn(); const ref = { attachmentId: "a1", threadId: "t", name: "a1.png" };
  const { rerender } = render(<AidtImageAttachmentPicker projectId="p" thread="t" value={ref} readOnly onChange={selected} />);
  expect(screen.getByRole("button", { name: "移除点子图像" })).toBeDisabled(); expect(mocks.load).not.toHaveBeenCalled();
  rerender(<AidtImageAttachmentPicker projectId="p" thread="t" value={ref} onChange={selected} />); fireEvent.click(screen.getByRole("button", { name: "移除点子图像" }));
  expect(selected).toHaveBeenCalledWith(null); expect(mocks.load).not.toHaveBeenCalled();
});
it("discards a previous thread's late response and cancels its consumer", async () => {
  let finish!: (items: readonly AidtImageAttachmentOption[]) => void;
  mocks.load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; })).mockResolvedValue([option("current", "t2")]);
  const { rerender } = render(<AidtImageAttachmentPicker projectId="p" thread="t1" onChange={vi.fn()} />); fireEvent.click(screen.getByRole("button", { name: "选择点子图像" }));
  const firstSignal = mocks.load.mock.calls[0]![0].signal as AbortSignal;
  rerender(<AidtImageAttachmentPicker projectId="p" thread="t2" onChange={vi.fn()} />);
  await screen.findByRole("button", { name: /current.png/ }); await act(async () => { finish([option("previous", "t1")]); });
  expect(firstSignal.aborted).toBe(true); expect(screen.queryByRole("button", { name: /previous.png/ })).not.toBeInTheDocument();
});
it("previews restored references only after authorized source validation and exposes the native blob for export", async () => {
  const state = vi.fn(); render(<AidtImageAttachmentPreview projectId="p" reference={{ attachmentId: "a1", threadId: "t", name: "a1.png" }} onState={state} />);
  const image = await screen.findByRole("img", { name: "a1.png" }); expect(image).toHaveAttribute("src", "blob:authorized-native-image");
  expect(state).toHaveBeenLastCalledWith({ src: null, failed: false });
  Object.defineProperties(image, { naturalWidth: { value: 40 }, naturalHeight: { value: 30 } }); fireEvent.load(image);
  expect(state).toHaveBeenLastCalledWith({ src: "blob:authorized-native-image", failed: false });
});
it("never fetches bytes for an unavailable or mismatched restored reference", async () => {
  render(<AidtImageAttachmentPreview projectId="p" reference={{ attachmentId: "a1", threadId: "t", name: "spoofed.png" }} />);
  expect(await screen.findByText("图片不可用或无权访问，未替换成其他图片。")).toBeVisible(); expect(mocks.media).not.toHaveBeenCalled();
});
it("rejects a corrupt image even when native authorized fetch produced a blob URL", async () => {
  const selected = vi.fn(); render(<AidtImageAttachmentPicker projectId="p" thread="t" onChange={selected} />);
  fireEvent.click(screen.getByRole("button", { name: "选择点子图像" }));
  const image = await screen.findByRole("img", { name: "a1.png" }); const choice = screen.getByRole("button", { name: /a1.png/ });
  fireEvent.error(image);
  await waitFor(() => expect(choice).toBeDisabled()); fireEvent.click(choice); expect(selected).not.toHaveBeenCalled();
});
it("removes corrupt image blobs from the PDF readiness callback", async () => {
  const state = vi.fn(); render(<AidtImageAttachmentPreview projectId="p" reference={{ attachmentId: "a1", threadId: "t", name: "a1.png" }} onState={state} />);
  const image = await screen.findByRole("img", { name: "a1.png" }); fireEvent.error(image);
  await waitFor(() => expect(state).toHaveBeenLastCalledWith({ src: null, failed: true }));
});

it("does not read images without a session provider", () => {
  mocks.hasSession = false;
  render(<AidtImageAttachmentPicker projectId="p" thread="t" onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "选择点子图像" }));
  expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.media).not.toHaveBeenCalled();
});
it("does not reuse the previous thread's successful image decode for a new image", async () => {
  mocks.load.mockResolvedValueOnce([option("previous", "t1")]).mockResolvedValueOnce([option("current", "t2")]);
  const { rerender } = render(<AidtImageAttachmentPicker projectId="p" thread="t1" onChange={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "选择点子图像" }));
  const previous = await screen.findByRole("img", { name: "previous.png" });
  Object.defineProperties(previous, { naturalWidth: { value: 40 }, naturalHeight: { value: 30 } }); fireEvent.load(previous);
  expect(screen.getByRole("button", { name: /previous.png/ })).toBeEnabled();
  rerender(<AidtImageAttachmentPicker projectId="p" thread="t2" onChange={vi.fn()} />);
  await screen.findByRole("img", { name: "current.png" }); fireEvent.load(previous);
  expect(screen.getByRole("button", { name: /current.png/ })).toBeDisabled();
});
