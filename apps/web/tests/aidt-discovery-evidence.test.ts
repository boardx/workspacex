import { beforeEach, expect, it, vi } from "vitest";
import { aidtDiscoverySourceLabel, discoverySourceKey, loadAidtDiscoverySources, readAidtDiscoverySource } from "@/features/aidt/lib/aidt-discovery-evidence";
const mocks = vi.hoisted(() => ({ enabled: true, thread: vi.fn(), list: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mocks.enabled }));
vi.mock("@/lib/live-chat", () => ({ getThread: mocks.thread, listMessages: mocks.list }));
const message = (id = "m", authorKind: "human" | "agent" = "human", text = "教学夹具原文") => ({ id, authorKind, text, authorId: "student", agentId: null, clientMessageId: null, agentRunId: null, replyToMessageId: null, createdAt: "2026-11-16T00:00:00.000Z" });
const input = { projectId: "p", threadId: "t", sessionToken: "captured" };
beforeEach(() => {
  vi.resetAllMocks(); mocks.enabled = true;
  mocks.thread.mockResolvedValue({ thread: { id: "t", projectId: "p", visibilityScope: "plenary", groupId: null } });
  mocks.list.mockResolvedValue({ messages: [message()], nextCursor: null });
});
it("retains a precise human-message locator and excludes AI answers, blanks and duplicates", async () => {
  mocks.list.mockResolvedValueOnce({ messages: [message(), message(), message("ai", "agent", "并非受访者原话"), message("empty", "human", " ")], nextCursor: "earlier" });
  const result = await loadAidtDiscoverySources(input);
  expect(mocks.thread).toHaveBeenCalledWith("t", "p", "captured");
  expect(mocks.list).toHaveBeenCalledWith("t", { limit: 100, cursor: undefined }, "captured");
  expect(result.nextCursor).toBe("earlier"); expect(result.items).toHaveLength(1);
  const source = result.items[0]!;
  expect(aidtDiscoverySourceLabel(source)).toContain("小组 p · 对话 t · 消息 m · 提交者 student");
  expect(readAidtDiscoverySource({ [discoverySourceKey("card")]: JSON.stringify(source) }, "card")).toEqual(source);
});
it("reads older originals explicitly and labels a bounded snapshot without altering the original", async () => {
  mocks.list.mockResolvedValueOnce({ messages: [message("long", "human", "原".repeat(5001))], nextCursor: null });
  const result = await loadAidtDiscoverySources({ ...input, cursor: "older" });
  expect(mocks.list).toHaveBeenCalledWith("t", { limit: 100, cursor: "older" }, "captured");
  expect(result.items[0]?.text).toHaveLength(4000); expect(result.items[0]?.truncated).toBe(true);
  expect(readAidtDiscoverySource({ [discoverySourceKey("card")]: "malformed" }, "card")).toBeNull();
});
it("keeps escaped original snapshots inside the actual shared-field serialization limit", async () => {
  mocks.list.mockResolvedValueOnce({ messages: [message("escaped", "human", "\"\\\n".repeat(1400))], nextCursor: null });
  const result = await loadAidtDiscoverySources(input);
  expect(JSON.stringify(result.items[0]).length).toBeLessThanOrEqual(6000);
  expect(result.items[0]?.truncated).toBe(true);
});
it("denies foreign, personal and subgroup sources before reading their text", async () => {
  for (const patch of [{ projectId: "other" }, { id: "other" }, { visibilityScope: "personal" }, { groupId: "subgroup" }]) {
    mocks.thread.mockResolvedValueOnce({ thread: { id: "t", projectId: "p", visibilityScope: "plenary", groupId: null, ...patch } });
    await expect(loadAidtDiscoverySources(input)).rejects.toThrow("AIDT_SOURCE_UNAVAILABLE");
  }
  expect(mocks.list).not.toHaveBeenCalled();
});
it("does not reinterpret denied, malformed, disabled or cancelled reads as empty evidence", async () => {
  mocks.list.mockRejectedValueOnce(new Error("403")); await expect(loadAidtDiscoverySources(input)).rejects.toThrow("403");
  mocks.list.mockResolvedValueOnce({ messages: [{ text: "missing author" }], nextCursor: null }); await expect(loadAidtDiscoverySources(input)).rejects.toThrow();
  mocks.enabled = false; const before = mocks.thread.mock.calls.length;
  await expect(loadAidtDiscoverySources(input)).rejects.toThrow("AIDT_CONTEXT_CHANGED"); expect(mocks.thread).toHaveBeenCalledTimes(before);
  mocks.enabled = true; const cancellation = new AbortController();
  mocks.thread.mockImplementationOnce(async () => { cancellation.abort(); return { thread: { id: "t", projectId: "p", visibilityScope: "plenary", groupId: null } }; });
  await expect(loadAidtDiscoverySources({ ...input, signal: cancellation.signal })).rejects.toThrow("AIDT_CONTEXT_CHANGED");
  expect(mocks.list).toHaveBeenCalledTimes(2);
});
