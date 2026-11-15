import { beforeEach, expect, it, vi } from "vitest";
import { AIDT_EMPTY_SAVED_CONTEXT, loadAidtSavedChatContext } from "@/features/aidt/lib/aidt-chat-saved-context";
const mocks = vi.hoisted(() => ({ enabled: true, thread: vi.fn(), list: vi.fn(), source: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mocks.enabled }));
vi.mock("@/lib/live-chat", () => ({ getThread: mocks.thread, listThreadArtifacts: mocks.list, getThreadArtifactSource: mocks.source }));
const ref = { stageNumber: 1, threadId: "t1", artifactId: "a1", expectedImmutableRevision: "artifact-v1:1" };
const input = () => ({ projectId: "group-one", sessionToken: "captured-bearer", references: [ref] });
const item = (mode: "draft" | "live" | "pinned" = "pinned", artifactId = "a1") => ({ artifactId, title: "学生保存的主题", mode, version: mode === "draft" ? null : 1, hasSource: true, messageId: "source-message", pinnedBy: mode === "pinned" ? "student" : null, pinnedAt: null });
const source = (version: number | null = 1) => ({ markdown: "学生自己的研究主题，尚未访谈。", version, immutableRevision: "artifact-v1:1", savedAt: "2026-11-15T01:00:00Z", savedBy: "student" });
beforeEach(() => {
  vi.resetAllMocks(); mocks.enabled = true;
  mocks.thread.mockResolvedValue({ thread: { projectId: "group-one", visibilityScope: "plenary" } });
  mocks.list.mockResolvedValue({ items: [item()] }); mocks.source.mockResolvedValue(source());
});
it("performs no read for unselected references or a disabled module", async () => {
  expect(await loadAidtSavedChatContext({ ...input(), references: [] })).toEqual(AIDT_EMPTY_SAVED_CONTEXT);
  mocks.enabled = false; await expect(loadAidtSavedChatContext(input())).rejects.toThrow("AIDT_CONTEXT_CHANGED");
  expect(mocks.thread).not.toHaveBeenCalled(); expect(mocks.source).not.toHaveBeenCalled();
});
it("reads only the authorized current project's source with the captured bearer and provenance", async () => {
  const result = await loadAidtSavedChatContext(input());
  expect(mocks.thread).toHaveBeenCalledWith("t1", "group-one", "captured-bearer");
  expect(mocks.list).toHaveBeenCalledWith("t1", "group-one", "captured-bearer");
  expect(mocks.source).toHaveBeenCalledWith("t1", "a1", "group-one", "captured-bearer");
  expect(result).toMatchObject({ status: "ready", items: [{ artifactId: "a1", messageId: "source-message", immutableRevision: "artifact-v1:1", savedBy: "student", reviewStatus: "not-confirmed", evidenceStatus: "not-verified" }] });
});
it("does not read private draft content into a plenary AI context until explicitly selected for disclosure", async () => {
  mocks.list.mockResolvedValue({ items: [item("draft")] }); mocks.source.mockResolvedValue(source(null));
  expect(await loadAidtSavedChatContext(input())).toEqual({ status: "failed", items: [], issues: [{ stageNumber: 1, reason: "private-draft" }] });
  expect(mocks.source).not.toHaveBeenCalled();
  const result = await loadAidtSavedChatContext({ ...input(), references: [{ ...ref, includePrivateDraft: true }] });
  expect(result).toMatchObject({ status: "ready", items: [{ mode: "draft", visibility: "private-draft-explicitly-shared", reviewStatus: "not-confirmed" }] });
});
it("does not query source bytes for cross-project, private-thread or unlisted artifacts", async () => {
  mocks.thread.mockResolvedValueOnce({ thread: { projectId: "foreign", visibilityScope: "plenary" } });
  expect((await loadAidtSavedChatContext(input())).status).toBe("failed");
  mocks.thread.mockResolvedValueOnce({ thread: { projectId: "group-one", visibilityScope: "member-private" } });
  expect((await loadAidtSavedChatContext(input())).status).toBe("failed");
  mocks.list.mockResolvedValueOnce({ items: [] });
  expect((await loadAidtSavedChatContext(input())).status).toBe("failed");
  expect(mocks.source).not.toHaveBeenCalled();
});
it("reports a stale immutable revision without substituting the latest text", async () => {
  mocks.source.mockResolvedValue({ ...source(), markdown: "新版不能冒充旧版", immutableRevision: "artifact-v1:2" });
  const result = await loadAidtSavedChatContext(input());
  expect(result).toEqual({ status: "failed", items: [], issues: [{ stageNumber: 1, reason: "version-changed" }] });
  expect(JSON.stringify(result)).not.toContain("新版不能冒充旧版");
});
it("keeps successful sources and reports a dependency failure as partial, not empty", async () => {
  mocks.list.mockResolvedValue({ items: [item(), item("pinned", "a2")] });
  mocks.source.mockResolvedValueOnce(source()).mockRejectedValueOnce(new Error("STORAGE_UNAVAILABLE"));
  const result = await loadAidtSavedChatContext({ ...input(), references: [ref, { ...ref, artifactId: "a2" }] });
  expect(result.status).toBe("partial"); expect(result.items).toHaveLength(1); expect(result.issues).toEqual([{ stageNumber: 1, reason: "unavailable" }]);
  expect(mocks.thread).toHaveBeenCalledTimes(1); expect(mocks.list).toHaveBeenCalledTimes(1);
});
it("bounds duplicate inputs and long source text while preserving explicit truncation", async () => {
  mocks.source.mockResolvedValue({ ...source(), markdown: "学".repeat(4000) });
  const result = await loadAidtSavedChatContext({ ...input(), references: [ref, ref] });
  expect(result.items[0]?.markdown.length).toBe(3000); expect(result.items[0]?.truncated).toBe(true); expect(mocks.source).toHaveBeenCalledTimes(1);
  mocks.thread.mockClear();
  const oversized = await loadAidtSavedChatContext({ ...input(), references: Array.from({ length: 13 }, (_, stageNumber) => ({ ...ref, stageNumber })) });
  expect(oversized).toMatchObject({ status: "failed", issues: [{ reason: "limit" }] }); expect(mocks.thread).not.toHaveBeenCalled();
});
it("stops source loading when the actor's context is cancelled during the authorization read", async () => {
  let finish!: (value: { thread: { projectId: string; visibilityScope: string } }) => void;
  mocks.thread.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const cancellation = new AbortController(); const task = loadAidtSavedChatContext({ ...input(), signal: cancellation.signal });
  cancellation.abort(); finish({ thread: { projectId: "group-one", visibilityScope: "plenary" } });
  await expect(task).rejects.toThrow("AIDT_CONTEXT_CHANGED"); expect(mocks.list).not.toHaveBeenCalled(); expect(mocks.source).not.toHaveBeenCalled();
});
