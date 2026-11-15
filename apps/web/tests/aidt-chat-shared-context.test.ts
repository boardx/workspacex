import { beforeEach, expect, it, vi } from "vitest";
import { AIDT_EMPTY_SHARED_CONTEXT, loadAidtSharedChatContext, aidtSharedContextPreview } from "@/features/aidt/lib/aidt-chat-shared-context";
const mocks = vi.hoisted(() => ({ enabled: true, read: vi.fn() }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => mocks.enabled }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mocks.read }));
const input = () => ({ projectId: "group-one", currentStage: 2, sessionToken: "captured-bearer", references: [{ stageNumber: 1, revision: 2 }] });
const stage = () => ({ projectId: "group-one", stageId: 1, revision: 2, content: { schemaVersion: 1, draft: { fields: { topic: "学生保存的主题，仍需研究" }, ideas: [], selectedIdeaId: "" } }, sourceStageRevisions: [], updatedBy: "student", updatedAt: "2026-11-15T01:00:00Z" });
beforeEach(() => { vi.resetAllMocks(); mocks.enabled = true; mocks.read.mockResolvedValue({ stage: stage() }); });
it("does not read unselected material or a disabled module", async () => {
  expect(await loadAidtSharedChatContext({ ...input(), references: [] })).toEqual(AIDT_EMPTY_SHARED_CONTEXT);
  mocks.enabled = false; await expect(loadAidtSharedChatContext(input())).rejects.toThrow("AIDT_CONTEXT_CHANGED");
  expect(mocks.read).not.toHaveBeenCalled();
});
it("uses the captured bearer and genuine revision provenance without promoting drafts to confirmed evidence", async () => {
  const result = await loadAidtSharedChatContext(input());
  expect(mocks.read).toHaveBeenCalledWith("group-one", 1, "captured-bearer", undefined);
  expect(result).toMatchObject({ status: "ready", items: [{ kind: "aidt-stage", projectId: "group-one", stageNumber: 1, revision: 2, updatedBy: "student", reviewStatus: "not-confirmed", evidenceStatus: "not-verified", visibility: "group-shared" }] });
  expect(JSON.parse(result.items[0]!.draftText)).toEqual(stage().content);
  expect(result.items[0]).not.toHaveProperty("artifactId");
});
it("rejects cross-project, wrong-stage and absent responses without incorporating their content", async () => {
  for (const reply of [{ ...stage(), projectId: "foreign" }, { ...stage(), stageId: 2 }, null]) {
    mocks.read.mockResolvedValueOnce({ stage: reply });
    expect(await loadAidtSharedChatContext(input())).toEqual({ status: "failed", items: [], issues: [{ stageNumber: 1, reason: "unavailable" }] });
  }
});
it("does not substitute a newer saved revision for the selected older version", async () => {
  mocks.read.mockResolvedValue({ stage: { ...stage(), revision: 3 } });
  expect(await loadAidtSharedChatContext(input())).toEqual({ status: "failed", items: [], issues: [{ stageNumber: 1, reason: "version-changed" }] });
});
it("limits access to current/earlier valid selections and rejects ambiguous duplicate revisions before reads", async () => {
  expect((await loadAidtSharedChatContext({ ...input(), references: [{ stageNumber: 3, revision: 1 }] })).status).toBe("failed");
  expect((await loadAidtSharedChatContext({ ...input(), references: [{ stageNumber: 1, revision: 0 }] })).status).toBe("failed");
  expect((await loadAidtSharedChatContext({ ...input(), references: [{ stageNumber: 1, revision: 1 }, { stageNumber: 1, revision: 2 }] })).issues[0]?.reason).toBe("version-changed");
  expect((await loadAidtSharedChatContext({ ...input(), references: Array.from({ length: 7 }, () => ({ stageNumber: 1, revision: 2 })) })).issues[0]?.reason).toBe("limit");
  expect(mocks.read).not.toHaveBeenCalled();
});
it("keeps successful sources and identifies partial read failures", async () => {
  mocks.read.mockResolvedValueOnce({ stage: stage() }).mockRejectedValueOnce(new Error("UNAVAILABLE"));
  const result = await loadAidtSharedChatContext({ ...input(), references: [...input().references, { stageNumber: 2, revision: 1 }] });
  expect(result.status).toBe("partial"); expect(result.items).toHaveLength(1); expect(result.issues).toEqual([{ stageNumber: 2, reason: "unavailable" }]);
});
it("bounds long content and deduplicates identical stage selections", async () => {
  mocks.read.mockResolvedValue({ stage: { ...stage(), content: { schemaVersion: 1, draft: { fields: { long: "学".repeat(10000) }, ideas: [], selectedIdeaId: "" } } } });
  const result = await loadAidtSharedChatContext({ ...input(), references: [...input().references, ...input().references] });
  expect(result.items[0]?.draftText.length).toBe(5000); expect(result.items[0]?.truncated).toBe(true); expect(mocks.read).toHaveBeenCalledTimes(1);
});
it("discards a read that completed after the actor scope was cancelled", async () => {
  let finish!: (reply: { stage: ReturnType<typeof stage> }) => void;
  mocks.read.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const cancellation = new AbortController(); const task = loadAidtSharedChatContext({ ...input(), signal: cancellation.signal });
  cancellation.abort(); finish({ stage: stage() });
  await expect(task).rejects.toThrow("AIDT_CONTEXT_CHANGED");
});

it("shows saved student text with existing stage field labels without generating missing facts", async () => {
  const source = (await loadAidtSharedChatContext(input())).items[0]!;
  const draftText = JSON.stringify({ schemaVersion: 1, draft: { fields: { rewrittenTheme: "学生自己保存的工作坊主题" }, ideas: [], selectedIdeaId: "" } });
  const preview = aidtSharedContextPreview({ ...source, draftText });
  expect(preview).toContain("学生重写的工作坊主题：学生自己保存的工作坊主题"); expect(preview).not.toContain("真实访谈已完成");
});
it("keeps truncated source text literal instead of inventing a completed summary", async () => {
  const source = (await loadAidtSharedChatContext(input())).items[0]!;
  const draftText = '{"schemaVersion":1,"draft":{"fields":{"initial":"<script>untrusted';
  expect(aidtSharedContextPreview({ ...source, draftText, truncated: true })).toBe(draftText);
});
