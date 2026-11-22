import { beforeEach, expect, it, vi } from "vitest";
import { SharedStage } from "@repo/contracts/aidt-stages";
import { aidtTestGroupRoundReportLines, readAidtTestGroupRound, writeAidtTestGroupRound } from "@/features/aidt/lib/aidt-test-group-round";
import { createAidtTestGroup, readAidtTestGroups, updateAidtTestGroup, resetAidtTestRound } from "@/features/aidt/lib/aidt-test-groups";
import { isAidtReflectionConfirmed } from "@/features/aidt/lib/aidt-verification-loop";
import { loadAidtIterationDesignContext, aidtIterationDesignPrompt } from "@/features/aidt/lib/aidt-iteration-design-context";
import { loadAidtReturnChatContext } from "@/features/aidt/lib/aidt-chat-return-context";
import type { AidtQuestionSnapshot } from "@repo/contracts/aidt-return-reflection";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
const mocks = vi.hoisted(() => ({ revision: vi.fn(), history: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStageRevision: mocks.revision, listAidtStageHistory: mocks.history }));
vi.mock("@/features/aidt/lib/aidt-module-config", () => ({ isAidtModuleEnabled: () => true }));
const snapshot: AidtQuestionSnapshot = { schemaVersion: 1, question: "用户能否理解领取顺序？", beforeTestBelief: "学生先前推测会理解", verificationBasis: "尚无真人证据", verificationLimits: "仅合成软件测试", prototypeRef: "原型V2", prototypeDesignId: "native-design", prototypeVersionId: "prototype-v2", sourceStageRevision: 20 };
const group = (id: string, name: string) => {
  const value = { ...createAidtTestGroup(snapshot, id, "native-design")!, name, task: "理解领取顺序", reflection: name + "学生反思", evidenceGap: "尚无真人证据，需要继续研究", confirmedFromMessageId: "synthetic-saved-message-" + name };
  return readAidtTestGroups(updateAidtTestGroup({ fields: {}, ideas: [], selectedIdeaId: "" }, value).fields)[0]!;
};
const a = group("11111111-1111-4111-8111-111111111111", "A"), b = group("22222222-2222-4222-8222-222222222222", "B");
const empty = (): AidtUiStageDraft => ({ fields: {}, ideas: [], selectedIdeaId: "" });
const round = (name: string, returnStep = "2"): AidtUiStageDraft => ({ ...empty(), fields: { questionSnapshot: JSON.stringify(snapshot), version: snapshot.prototypeRef,
  understandingChangeStatus: "insufficient", afterTestBelief: name + "本组认识", understandingEvidence: name + "本组材料", unresolvedQuestions: "需要真实测试", returnStep,
  returnReason: name + "返回理由", nextAction: name + "下一步", reflectionConfirmed: "true" } });
function two() { return updateAidtTestGroup(updateAidtTestGroup(empty(), a), b); }
function stage(draft: AidtUiStageDraft, revision = 31) { return SharedStage.parse({ projectId: "qa-project", stageId: 6, revision, sourceStageRevisions: [], content: { schemaVersion: 1, draft }, updatedBy: "qa-agent", updatedAt: "2026-11-22T08:00:00Z" }); }
function write(draft: AidtUiStageDraft, expected: typeof a, value: AidtUiStageDraft, publish: boolean, revision = 31) {
  return Reflect.apply(writeAidtTestGroupRound, undefined, [draft, expected, value, publish, revision]) as AidtUiStageDraft;
}
beforeEach(() => vi.resetAllMocks());
it("keeps two groups' confirmed learning distinct after the last group publishes its compatibility projection", () => {
  const first = write(two(), a, round("A"), true), final = write(first, b, round("B"), true);
  expect(readAidtTestGroupRound(final, a.id)?.fields.afterTestBelief).toBe("A本组认识");
  expect(readAidtTestGroupRound(final, b.id)?.fields.afterTestBelief).toBe("B本组认识");
  expect(final.fields.reflectionSourceEntity).toBe(b.id); expect(final.fields.afterTestBelief).toBe("B本组认识");
  expect(aidtTestGroupRoundReportLines(final, a.id).join("\n")).toContain("A本组认识");
  expect(aidtTestGroupRoundReportLines(final, a.id).join("\n")).not.toContain("B本组认识");
});
it("drafts only the selected namespace and clears compatibility confirmation only for its own publishing owner", () => {
  let draft = write(write(two(), a, round("A"), true), b, round("B"), true);
  const bRaw = Object.fromEntries(Object.entries(draft.fields).filter(([key]) => key.startsWith(`testRound:${b.id}:`)));
  draft = write(draft, a, { ...round("A"), fields: { ...round("A").fields, reflectionConfirmed: "", afterTestBelief: "A未确认新稿" } }, false);
  expect(draft.fields.reflectionConfirmed).toBe("true"); expect(draft.fields.reflectionSourceEntity).toBe(b.id);
  expect(Object.fromEntries(Object.entries(draft.fields).filter(([key]) => key.startsWith(`testRound:${b.id}:`)))).toEqual(bRaw);
  draft = write(draft, b, { ...round("B"), fields: { ...round("B").fields, reflectionConfirmed: "" } }, false);
  expect(draft.fields.reflectionConfirmed).toBe("");
});
it("does not project a prior learning record after its test group feedback changes", () => {
  const saved = write(two(), a, round("A"), true);
  const changed = updateAidtTestGroup(saved, { ...a, reflection: "改变后的研究反思" });
  expect(readAidtTestGroupRound(changed, a.id)).toBeNull();
  expect(() => write(changed, a, round("A"), true)).toThrow(/测试记录/);
  expect(readAidtTestGroups(changed.fields).find(item => item.id === a.id)?.reflection).toBe("改变后的研究反思");
});
it("rejects a round that names a different tested prototype and rejects malformed capacity without overwriting the source", () => {
  const draft = two();
  const wrong = { ...round("A"), fields: { ...round("A").fields, questionSnapshot: JSON.stringify({ ...snapshot, prototypeVersionId: "different" }) } };
  expect(() => write(draft, a, wrong, true)).toThrow();
  const full = { ...draft, fields: { ...draft.fields, ...Object.fromEntries(Array.from({ length: 100 - Object.keys(draft.fields).length }, (_, index) => ["unrelated:" + index, "preserve"])) } };
  expect(() => write(full, a, round("A"), true)).toThrow(/保存空间/); expect(Object.keys(full.fields)).toHaveLength(100);
});
it("preserves named historical rounds when beginning a new shared test round", () => {
  const saved = write(two(), a, round("A"), true), reset = resetAidtTestRound(saved);
  expect(readAidtTestGroupRound(reset, a.id)?.fields.afterTestBelief).toBe("A本组认识");
  expect(reset.fields.reflectionConfirmed).toBeUndefined();
});
it("reads the exact group learning for a return-five design while the current text is supplied separately", async () => {
  const saved = write(two(), a, round("A", "5"), true, 31);
  const later = write(saved, b, round("B", "2"), true, 32);
  mocks.revision.mockImplementation(async (_p, _s, revision) => revision === 31 ? stage(saved, 31) : stage(later, 32));
  const result = await loadAidtIterationDesignContext({ projectId: "qa-project", designId: "native-design", entityId: a.id, revision: "31", sessionToken: "qa-token" });
  expect(result).toContain("A本组认识"); expect(result).not.toContain("B本组认识");
  expect(aidtIterationDesignPrompt("当前已确认文字V3", result)).toContain("当前已确认文字V3");
  expect(mocks.revision).toHaveBeenCalledWith("qa-project", 6, 31, "qa-token", undefined);
});
it.each(["project", "stage", "revision", "archived", "entity", "aborted"] as const)("rejects wrong %s in the exact iteration-learning source", async kind => {
  let saved = write(two(), a, round("A", "5"), true);
  if (kind === "archived") saved = updateAidtTestGroup(saved, { ...a, archived: true });
  const result = stage(saved), controller = new AbortController();
  mocks.revision.mockResolvedValue({ ...result, ...(kind === "project" ? { projectId: "other" } : kind === "stage" ? { stageId: 5 } : kind === "revision" ? { revision: 32 } : {}) });
  if (kind === "aborted") controller.abort();
  await expect(loadAidtIterationDesignContext({ projectId: "qa-project", designId: "native-design", entityId: kind === "entity" ? b.id : a.id, revision: "31", sessionToken: "qa-token", signal: controller.signal })).rejects.toThrow("AIDT_DESIGN_RETURN_CONTEXT_INVALID");
});
it("normal Chat cannot accept A's entity context paired with B's last globally published revision", async () => {
  const saved = write(write(two(), a, round("A", "2"), true), b, round("B", "2"), true);
  expect(isAidtReflectionConfirmed(readAidtTestGroupRound(saved, a.id)!)).toBe(true);
  mocks.history.mockResolvedValue({ items: [stage(saved)], nextBeforeRevision: null });
  const input = { projectId: "qa-project", currentStage: 2, sessionToken: "qa-token", returnRevision: "31", returnEntity: a.id };
  const result = await loadAidtReturnChatContext(input);
  expect(result.status).toBe("failed"); expect(result.items).toHaveLength(0);
});
