import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const api = vi.hoisted(() => ({ uploadAttachment: vi.fn(), cancelPendingAttachment: vi.fn() }));
vi.mock("@/lib/live-chat", async (original) => ({
  ...await original<typeof import("@/lib/live-chat")>(), ...api,
}));
import { ApiError } from "@/lib/api-client";
import { useChatAttachments } from "@/components/chat/chat-composer-attachments";
const remote = { id: "pending-server-id", filename: "draft.txt", mime: "text/plain", bytes: 5, createdAt: "2026-10-01T00:00:00Z" };
const file = () => new File(["draft"], remote.filename, { type: remote.mime });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function upload(result: { current: ReturnType<typeof useChatAttachments> }) {
  act(() => result.current.pickFiles([file()]));
  await waitFor(() => expect(result.current.uploadedIds).toEqual([remote.id]));
  return result.current.attachments[0]!.localId;
}
describe("pending attachment cancellation lifecycle (#962)", () => {
  beforeEach(() => { vi.clearAllMocks(); api.uploadAttachment.mockResolvedValue(remote); api.cancelPendingAttachment.mockResolvedValue(undefined); });
  it("keeps the chip until authenticated cancellation completes, excludes it from send", async () => {
    const cancellation = deferred<void>(); api.cancelPendingAttachment.mockReturnValue(cancellation.promise);
    const { result } = renderHook(() => useChatAttachments({ threadId: "thread-a", bearer: "session-a" }));
    const id = await upload(result);
    act(() => { void result.current.removeAttachment(id); });
    await waitFor(() => expect(api.cancelPendingAttachment).toHaveBeenCalledWith("thread-a", remote.id, "session-a"));
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.uploadedIds).toEqual([]);
    await act(async () => cancellation.resolve());
    await waitFor(() => expect(result.current.attachments).toHaveLength(0));
  });
  it("retains a failed cancellation for retry rather than falsely freeing the server slot", async () => {
    api.cancelPendingAttachment.mockRejectedValueOnce(new Error("offline"));
    const { result } = renderHook(() => useChatAttachments({ threadId: "thread-a", bearer: "session-a" }));
    const id = await upload(result);
    await act(async () => { await result.current.removeAttachment(id); });
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0]?.serverId).toBe(remote.id);
    await act(async () => { await result.current.removeAttachment(id); });
    expect(api.cancelPendingAttachment).toHaveBeenCalledTimes(2);
    expect(result.current.attachments).toHaveLength(0);
  });
  it("cancels a late upload result in its original thread/session", async () => {
    const uploading = deferred<typeof remote>(); api.uploadAttachment.mockReturnValue(uploading.promise);
    const { result, rerender } = renderHook(({ threadId, bearer }) => useChatAttachments({ threadId, bearer }),
      { initialProps: { threadId: "thread-a", bearer: "session-a" } });
    act(() => result.current.pickFiles([file()]));
    await waitFor(() => expect(api.uploadAttachment).toHaveBeenCalledTimes(1));
    const id = result.current.attachments[0]!.localId;
    act(() => { void result.current.removeAttachment(id); });
    rerender({ threadId: "thread-b", bearer: "session-b" });
    await act(async () => uploading.resolve(remote));
    await waitFor(() => expect(api.cancelPendingAttachment).toHaveBeenCalledWith("thread-a", remote.id, "session-a"));
    expect(result.current.attachments).toHaveLength(0);
  });
  it("clearing after a successful send transfers ownership without deleting sent attachments", async () => {
    const { result } = renderHook(() => useChatAttachments({ threadId: "thread-a", bearer: "session-a" }));
    await upload(result);
    act(() => result.current.clear());
    expect(result.current.attachments).toHaveLength(0);
    expect(api.cancelPendingAttachment).not.toHaveBeenCalled();
  });
  it("retains a sent409 conflict and never silently removes the attachment", async () => {
    api.cancelPendingAttachment.mockRejectedValueOnce(new ApiError(409, "ATTACHMENT_NOT_PENDING", null));
    const { result } = renderHook(() => useChatAttachments({ threadId: "thread-a", bearer: "session-a" }));
    const id = await upload(result);
    await act(async () => { await result.current.removeAttachment(id); });
    expect(result.current.attachments).toHaveLength(1);
    expect(result.current.attachments[0]?.removalError).toContain("已随消息发送");
    expect(result.current.uploadedIds).toEqual([]);
  });
  it("coalesces repeated removal clicks while the authenticated delete is in flight", async () => {
    const cancellation = deferred<void>(); api.cancelPendingAttachment.mockReturnValue(cancellation.promise);
    const { result } = renderHook(() => useChatAttachments({ threadId: "thread-a", bearer: "session-a" }));
    const id = await upload(result);
    act(() => { void result.current.removeAttachment(id); void result.current.removeAttachment(id); });
    expect(api.cancelPendingAttachment).toHaveBeenCalledTimes(1);
    await act(async () => cancellation.resolve());
    expect(result.current.attachments).toHaveLength(0);
  });

});
