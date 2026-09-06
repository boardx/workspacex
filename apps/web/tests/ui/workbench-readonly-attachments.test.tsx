import { act, renderHook, waitFor } from "@testing-library/react";
import type * as React from "react";
import { expect, it, vi } from "vitest";
const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@/lib/live-chat", async (original) => ({ ...await original<typeof import("@/lib/live-chat")>(), uploadAttachment: upload }));
import { useChatAttachments } from "@/components/chat/chat-composer-attachments";
it("blocks readonly drop/pick/retry while permitting local removal", async () => {
  upload.mockRejectedValue(new Error("offline"));
  const file = new File(["pdf"], "file.pdf", { type: "application/pdf" });
  const hook = renderHook(({ canWrite }) => useChatAttachments({ threadId: "thread", canWrite }), { initialProps: { canWrite: false } });
  act(() => {
    hook.result.current.dragHandlers.onDrop({ preventDefault: vi.fn(), dataTransfer: { files: [file] } } as unknown as React.DragEvent);
    hook.result.current.pickFiles([file]);
  });
  await act(async () => {});
  expect(upload).not.toHaveBeenCalled();
  expect(hook.result.current.attachments).toHaveLength(0);
  hook.rerender({ canWrite: true });
  act(() => hook.result.current.pickFiles([file]));
  await waitFor(() => expect(hook.result.current.attachments[0]?.status).toBe("error"));
  const id = hook.result.current.attachments[0]!.localId;
  hook.rerender({ canWrite: false });
  act(() => hook.result.current.retry(id));
  await act(async () => {});
  expect(upload).toHaveBeenCalledTimes(1);
  act(() => hook.result.current.removeAttachment(id));
  expect(hook.result.current.attachments).toHaveLength(0);
});
