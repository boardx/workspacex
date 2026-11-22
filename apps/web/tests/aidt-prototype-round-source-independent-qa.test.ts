import { beforeEach, expect, it, vi } from "vitest";
import { StageDraft } from "@repo/contracts/aidt-stages";
import { aidtBrainstormRoundCompletionKey } from "@repo/contracts/aidt-brainstorm";
import { readAidtPrototypeIdeaRounds, aidtChosenPrototypeIdeas, pinAidtPrototypeInputs, readAidtPrototypeInputSelection, resolveAidtPrototypeInputIdeas, readAidtPrototypeHmwSource } from "@/features/aidt/lib/aidt-prototype-handoff";
import { loadAidtPrototypeTextSources } from "@/features/aidt/lib/aidt-prototype-text-sources";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import { completed, empty, projectId } from "./aidt-round-fixture-independent-qa";
const mocks = vi.hoisted(() => ({ read: vi.fn(), revision: vi.fn() }));
vi.mock("@/features/aidt/lib/live-aidt-stages", () => ({ readAidtStage: mocks.read, readAidtStageRevision: mocks.revision }));
const stage = (stageId: number, revision: number, draft = empty()): AidtSharedStage => ({ projectId, stageId, revision, content: { schemaVersion: 1, draft: StageDraft.parse(draft) }, sourceStageRevisions: [], updatedBy: "qa-student", updatedAt: "2026-11-22T06:00:00Z" });
let a: ReturnType<typeof completed>, b: ReturnType<typeof completed>, formal: AidtSharedStage;
beforeEach(() => {
  vi.clearAllMocks(); a = completed(empty(), "a"); b = completed(a.draft, "b"); formal = stage(4, 12, b.draft);
  mocks.read.mockRejectedValue(new Error("CURRENT_S4_MUST_NOT_REPLACE_PIN"));
  mocks.revision.mockImplementation(async (_project: string, step: number, revision: number) => {
    if (step === 4 && revision === 12) return formal;
    if (step === 3 && [4, 7].includes(revision)) {
      const hmw = revision === 4 ? a : b;
      return stage(3, revision, { ...empty(), fields: { [`definitionHmw:hmw-${revision === 4 ? "a" : "b"}`]: JSON.stringify({ id: revision === 4 ? "hmw-a" : "hmw-b", text: revision === 4 ? "如何帮助学生比较口味？" : "如何帮助赶课者减少等待？", confirmed: true, archived: false, cardIds: [], personaIds: [], rationale: `${hmw.sessionId} 合成研究依据缺口需显式保留` }) } });
    }
    return null;
  });
});

it.each([1, 3])("pins %s idea(s) from exactly one formal round and preserves the real stage4 revision", async count => {
  const ids = a.ids.slice(0, count);
  const pinned = pinAidtPrototypeInputs(empty(), formal, ids, a.sessionId);
  const selection = readAidtPrototypeInputSelection(pinned)!;
  expect(selection).toEqual({ revision: 12, brainstormId: a.sessionId, ideaIds: ids });
  expect(resolveAidtPrototypeInputIdeas(selection, formal).map(idea => idea.id)).toEqual(ids);
  expect(resolveAidtPrototypeInputIdeas(selection, { ...formal, revision: 13 })).toEqual([]);
  expect(readAidtPrototypeHmwSource(formal, a.sessionId)).toEqual({ id: "hmw-a", revision: 4, text: "如何帮助学生比较口味？" });
  const sources = await loadAidtPrototypeTextSources({ projectId, sessionToken: "qa-token", selection });
  expect(sources.lineage).toMatchObject({ stage4Revision: 12, brainstormId: a.sessionId });
  expect(sources.items.map(item => item.ideaId)).toEqual(ids);
  expect(mocks.read).not.toHaveBeenCalled();
  expect(sources.items.every(item => item.views.some(view => view.reference.role === "idea" && view.href.includes(`entity=${a.sessionId}`) && view.href.includes("entityRevision=12")))).toBe(true);
});

it("does not admit a cross-round mix, implicit/default round, duplicate choice, or a legacy global list as a new source", () => {
  const base = empty();
  expect(readAidtPrototypeIdeaRounds(formal).map(round => round.stableId)).toEqual([a.sessionId, b.sessionId]);
  expect(aidtChosenPrototypeIdeas(formal)).toEqual([]);
  expect(pinAidtPrototypeInputs(base, formal, [a.ids[0]!, b.ids[0]!], a.sessionId)).toBe(base);
  expect(pinAidtPrototypeInputs(base, formal, a.ids)).toBe(base);
  expect(pinAidtPrototypeInputs(base, formal, [a.ids[0]!, a.ids[0]!], a.sessionId)).toBe(base);
  const legacy = stage(4, 12, { ...b.draft, fields: { ...b.draft.fields } });
  delete legacy.content.draft.fields[aidtBrainstormRoundCompletionKey(a.sessionId)];
  delete legacy.content.draft.fields[aidtBrainstormRoundCompletionKey(b.sessionId)];
  expect(readAidtPrototypeIdeaRounds(legacy)).toEqual([]);
  expect(pinAidtPrototypeInputs(base, legacy, b.ids, b.sessionId)).toBe(base);
});

it("uses the frozen A sheet/classification even after global ideas, HMW and classification drift to B or a later draft", async () => {
  const pin = readAidtPrototypeInputSelection(pinAidtPrototypeInputs(empty(), formal, a.ids, a.sessionId))!;
  const oldText = a.draft.ideas[0]!.description;
  formal = stage(4, 12, { ...formal.content.draft, ideas: formal.content.draft.ideas.map(idea => a.ids.includes(idea.id) ? { ...idea, title: "全局未确认新标题", description: "这是最新未审草稿。不得代替旧成果。" } : idea),
    fields: { ...formal.content.draft.fields, ideaHmwSource: JSON.stringify({ id: "hmw-other", revision: 999, text: "不应采用" }), ideaClassificationTags: "{}", ideaClassificationReasons: "{}", ideaClassificationConfirmed: "" } });
  expect(resolveAidtPrototypeInputIdeas(pin, formal)[0]?.description).toBe(oldText);
  const sources = await loadAidtPrototypeTextSources({ projectId, sessionToken: "qa-token", selection: pin });
  expect(JSON.stringify(sources)).toContain(oldText); expect(JSON.stringify(sources)).toContain("最容易实现的");
  expect(JSON.stringify(sources)).not.toMatch(/全局未确认新标题|这是最新未审草稿|不应采用/);
});

it.each(["missing", "broken", "wrong-project", "wrong-stage-version"] as const)("refuses %s formal source without borrowing global B", async fault => {
  const selection = { revision: 12, brainstormId: a.sessionId, ideaIds: a.ids };
  const key = aidtBrainstormRoundCompletionKey(a.sessionId);
  if (fault === "missing") delete formal.content.draft.fields[key];
  if (fault === "broken") formal.content.draft.fields[key] = "{broken";
  if (fault === "wrong-project") formal = { ...formal, projectId: "foreign-project" };
  if (fault === "wrong-stage-version") formal = { ...formal, revision: 13 };
  await expect(loadAidtPrototypeTextSources({ projectId, sessionToken: "qa-token", selection })).rejects.toThrow(/AIDT_PROTOTYPE_SOURCE_(UNCONFIRMED|SCOPE_MISMATCH)/);
  expect(mocks.read).not.toHaveBeenCalled();
});

it("retains a legacy pin for historical reading without letting it create a new formal pin", () => {
  const old = stage(4, 5, { ...empty(), fields: { ideaHandoffIds: JSON.stringify(["old-idea"]) }, ideas: [{ id: "old-idea", title: "旧点子", description: "原有的历史选择。仅作回看。" }] });
  const selection = { revision: 5, ideaIds: ["old-idea"] };
  expect(resolveAidtPrototypeInputIdeas(selection, old).map(idea => idea.id)).toEqual(["old-idea"]);
  const base = empty(); expect(pinAidtPrototypeInputs(base, old, selection.ideaIds)).toBe(base);
});
