import { beforeEach, expect, it, vi } from "vitest";
import { aidtImageAttachmentContentUrl, loadAidtImageAttachments } from "@/features/aidt/lib/aidt-image-attachments";
const mocks = vi.hoisted(() => ({ enabled: true, thread: vi.fn(), list: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mocks.enabled }));
vi.mock("@/lib/live-chat", () => ({ getThread: mocks.thread, listThreadAttachments: mocks.list }));
vi.mock("@/lib/api-client", () => ({ apiUrl: (path: string) => `/api${path}` }));
const item = (id = "a1", mime = "image/png", messageId = "m1") => ({ id, mime, messageId, filename: `${id}.png`, bytes: 12, createdAt: "2026-11-15T00:00:00Z" });
const input = () => ({ projectId: "p", threadId: "t", sessionToken: "captured-token" });
beforeEach(() => {
  vi.resetAllMocks(); mocks.enabled = true;
  mocks.thread.mockResolvedValue({ thread: { id: "t", projectId: "p", visibilityScope: "plenary", groupId: null }, messages: [{ id: "m1" }] });
  mocks.list.mockResolvedValue({ items: [item()] });
});
it("returns sent native image references using the captured project and bearer", async () => {
  const result = await loadAidtImageAttachments(input());
  expect(mocks.thread).toHaveBeenCalledWith("t", "p", "captured-token"); expect(mocks.list).toHaveBeenCalledWith("t", "p", "captured-token");
  expect(result).toEqual([{ attachmentId: "a1", threadId: "t", name: "a1.png", mime: "image/png", messageId: "m1", bytes: 12, createdAt: "2026-11-15T00:00:00Z" }]);
});
it("excludes pending, orphaned, non-image and duplicate attachments", async () => {
  mocks.list.mockResolvedValue({ items: [item(), item(), item("pending", "image/png", ""), item("orphan", "image/png", "missing-message"), item("doc", "application/pdf"), item("svg", "image/svg+xml")] });
  expect((await loadAidtImageAttachments(input())).map((value) => value.attachmentId)).toEqual(["a1"]);
});
it("rejects foreign projects, personal/small-group scopes and mismatched threads before listing attachments", async () => {
  for (const thread of [
    { id: "t", projectId: "other", visibilityScope: "plenary", groupId: null },
    { id: "t", projectId: "p", visibilityScope: "personal", groupId: null },
    { id: "t", projectId: "p", visibilityScope: "plenary", groupId: "subgroup" },
    { id: "other", projectId: "p", visibilityScope: "plenary", groupId: null },
  ]) { mocks.thread.mockResolvedValueOnce({ thread, messages: [{ id: "m1" }] }); await expect(loadAidtImageAttachments(input())).rejects.toThrow("AIDT_IMAGE_UNAVAILABLE"); }
  expect(mocks.list).not.toHaveBeenCalled();
});
it("does not turn failed or malformed lists into an empty successful state", async () => {
  mocks.list.mockRejectedValueOnce(new Error("503")); await expect(loadAidtImageAttachments(input())).rejects.toThrow("503");
  mocks.list.mockResolvedValueOnce({ items: [{ id: "missing-metadata" }] }); await expect(loadAidtImageAttachments(input())).rejects.toThrow();
});
it("does not start or continue attachment reads after disable/cancellation", async () => {
  mocks.enabled = false; await expect(loadAidtImageAttachments(input())).rejects.toThrow("AIDT_CONTEXT_CHANGED"); expect(mocks.thread).not.toHaveBeenCalled();
  mocks.enabled = true; const cancellation = new AbortController();
  mocks.thread.mockImplementationOnce(async () => { cancellation.abort(); return { thread: { id: "t", projectId: "p", visibilityScope: "plenary", groupId: null }, messages: [{ id: "m1" }] }; });
  await expect(loadAidtImageAttachments({ ...input(), signal: cancellation.signal })).rejects.toThrow("AIDT_CONTEXT_CHANGED"); expect(mocks.list).not.toHaveBeenCalled();
});
it("builds only the fixed authenticated content route with opaque identifiers encoded", () => {
  expect(() => aidtImageAttachmentContentUrl({ threadId: "..", attachmentId: "a", name: "ignored.png" })).toThrow("AIDT_IMAGE_UNAVAILABLE");
  expect(aidtImageAttachmentContentUrl({ threadId: "t/../remote", attachmentId: "a?x=#", name: "https://untrusted/image.png" })).toBe("/api/chat/threads/t%2F..%2Fremote/attachments/a%3Fx%3D%23/content");
});
