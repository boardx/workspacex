import { StageDraft } from "@repo/contracts/aidt-stages";
import { expect, it } from "vitest";
import type { AidtSharedStage } from "@/features/aidt/lib/live-aidt-stages";
import { emptyAidtUiDrafts, type AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
import { aidtStageHasConfirmation } from "@/features/aidt/lib/use-aidt-confirmed-stages";
import { aidtInterviewMaterialKey, archiveAidtInterview, confirmAidtInterviewFinding, writeAidtInterview, writeAidtInterviewFinding, writeAidtInterviewMaterial, writeAidtInterviewTranscript } from "@/features/aidt/lib/aidt-interviews";
import { chooseAidtDefinitionHmw, saveAidtDefinitionHmw, saveAidtDefinitionPersona } from "@/features/aidt/lib/aidt-definition";
import { confirmAidtIdeaClassification } from "@/features/aidt/lib/aidt-idea-classification";
import { confirmAidtPrototypeEntityHandoff, confirmAidtPrototypeHandoff, readAidtConfirmedPrototypeHandoff, readAidtPrototypeEntityDraft, updateAidtPrototypeEntityDraft } from "@/features/aidt/lib/aidt-prototype-handoff";
import { createAidtTestGroup, updateAidtTestGroup } from "@/features/aidt/lib/aidt-test-groups";
import { createAidtQuestionSnapshot, confirmAidtVerificationQuestion } from "@/features/aidt/lib/aidt-verification-loop";
import { updateAidtPrototypeReference } from "@/features/aidt/lib/aidt-prototype-reference";
import { readyFormalPrototypeFixture, storeFormalPrototypeFixture } from "./aidt-round-fixture-independent-qa";

const projectId = "group-test";
function stage(stageId: number, draft: AidtUiStageDraft): AidtSharedStage {
  return { projectId, stageId, revision: 2, sourceStageRevisions: [], content: { schemaVersion: 1, draft: StageDraft.parse(draft) }, updatedBy: "student", updatedAt: "2026-11-21T00:00:00Z" };
}
it("recognizes an explicitly confirmed real-source interview and rejects edited, archived or foreign-project evidence", async () => {
  const interview = { version: 1 as const, id: "15c7b5e2-9d0e-4b10-bc47-000000000001", code: "U01", topicRevision: 1, topic: "午休如何选择", goal: "了解经历", original: "最近一次如何选择", adopted: "讲讲最近一次经历", guideConfirmed: true, consent: { notes: true, photos: false, audio: false, observedAt: "2026-11-20T00:00:00Z" } };
  const quote = "我看不出口味差别";
  let draft = writeAidtInterview(emptyAidtUiDrafts()[2]!, interview);
  draft = writeAidtInterviewFinding(draft, interview, { headlineKind: "quote", headline: quote, quote, context: "午休点单" });
  const sourceKey = aidtInterviewMaterialKey(interview.id, "raw-transcript");
  draft = writeAidtInterviewMaterial(draft, interview.id, sourceKey, JSON.stringify({ projectId, runId: "run", artifactId: "raw", versionId: "v1", name: "原始转写.txt", mime: "text/plain", sha256: "a".repeat(64), bytes: 42 }));
  draft = writeAidtInterviewTranscript(draft, interview.id, { sourceKey, locator: "01:42", text: quote, checked: true });
  expect(await aidtStageHasConfirmation(stage(2, draft))).toBe(false);
  const confirmed = confirmAidtInterviewFinding(draft, interview.id, projectId);
  expect(await aidtStageHasConfirmation(stage(2, confirmed))).toBe(true);
  expect(await aidtStageHasConfirmation({ ...stage(2, confirmed), projectId: "other" })).toBe(false);
  expect(await aidtStageHasConfirmation(stage(2, archiveAidtInterview(confirmed, interview.id)))).toBe(false);
  expect(await aidtStageHasConfirmation(stage(2, writeAidtInterviewFinding(confirmed, interview, { context: "新解释待确认" })))).toBe(false);
});
it("requires a selected confirmed HMW and its confirmed persona instead of accepting an arbitrary definition marker", async () => {
  const persona = { id: "p1", name: "午休学生", situation: "午休", behavior: "比较口味", need: "清晰差别", limits: "一位受访者", cardIds: ["u1"], confirmed: true, archived: false };
  const hmw = { id: "h1", text: "我们如何帮助学生比较口味？", rationale: "根据访谈", cardIds: ["u1"], personaIds: ["p1"], confirmed: true, archived: false };
  let draft: AidtUiStageDraft = { ...emptyAidtUiDrafts()[3]!, fields: { surpriseStatus: "none", surpriseConfirmed: "true" } };
  draft = saveAidtDefinitionPersona(draft, persona, 2);
  draft = saveAidtDefinitionHmw(draft, hmw, 2);
  expect(await aidtStageHasConfirmation(stage(3, draft))).toBe(false);
  draft = chooseAidtDefinitionHmw(draft, "h1", new Set(["u1"]));
  expect(await aidtStageHasConfirmation(stage(3, draft))).toBe(true);
  expect(await aidtStageHasConfirmation(stage(3, saveAidtDefinitionPersona(draft, { ...persona, confirmed: false, behavior: "更改待核对" }, 2)))).toBe(false);
});
it("keeps a confirmed definition pinned if the interview list is saved again", async () => {
  const empty = emptyAidtUiDrafts();
  let draft = { ...empty[3]!, fields: { surpriseStatus: "found", surpriseConfirmed: "true",
    surpriseCardIds: '["u1"]', surpriseSourceRevision: "2", priorBelief: "先看队列", surprisingFinding: "先比较口味" } } as AidtUiStageDraft;
  draft = saveAidtDefinitionPersona(draft, { id: "p1", name: "午休学生", situation: "午休", behavior: "比较口味",
    need: "清晰差别", limits: "一位受访者", cardIds: ["u1"], confirmed: true, archived: false }, 2);
  draft = saveAidtDefinitionHmw(draft, { id: "h1", text: "我们如何帮助学生比较口味？", rationale: "根据访谈",
    cardIds: ["u1"], personaIds: ["p1"], confirmed: true, archived: false }, 2);
  draft = chooseAidtDefinitionHmw(draft, "h1", new Set(["u1"]));
  const frozen = { ...stage(3, draft), sourceStageRevisions: [{ stageId: 2, revision: 2 }] };
  const renamed = { ...stage(2, empty[2]!), revision: 3 };
  expect(await aidtStageHasConfirmation(frozen, { 2: renamed, 3: frozen })).toBe(true);
  expect(frozen.sourceStageRevisions).toEqual([{ stageId: 2, revision: 2 }]);
});
it("requires the actual three distinct reviewed sheets, student classification and explicit selected ideas", async () => {
  const ids = ["menu", "comparison", "samples"];
  let draft: AidtUiStageDraft = { ...emptyAidtUiDrafts()[4]!, ideas: ids.map((id, index) => ({ id, title: ["菜单标签", "对比卡", "试饮"][index]!, description: "显示三种口味。方便比较。" })), fields: {
    ...Object.fromEntries(ids.map(id => [`ideaFile:${id}`, JSON.stringify({ projectId, runId: `run-${id}`, artifactId: id, versionId: "v1", name: "图.png", mime: "image/png", sha256: "a".repeat(64), bytes: 42 })])),
    ideaHmwSource: JSON.stringify({ revision: 2, id: "h1", text: "我们如何帮助学生比较口味？" }), ideaSheetIds: JSON.stringify(ids), ideaHandoffIds: '["menu"]',
  } };
  expect(await aidtStageHasConfirmation(stage(4, draft))).toBe(false);
  draft = confirmAidtIdeaClassification(draft);
  expect(await aidtStageHasConfirmation(stage(4, draft))).toBe(true);
  expect(await aidtStageHasConfirmation(stage(4, { ...draft, fields: { ...draft.fields, ideaSheetIds: '["menu","menu","samples"]' } }))).toBe(false);
  expect(await aidtStageHasConfirmation({ ...stage(4, draft), projectId: "other" })).toBe(false);
});
function prototypeCandidate(id: string) {
  return readyFormalPrototypeFixture({ projectId, designId: id, sourceRevision: 2,
    fields: { verificationQuestion: "能否理解差别？", beforeTestBelief: "也许可以", verificationBasis: "尚无行为证据", verificationLimits: "静态理解不代表购买", type: "静态图", situation: "午休", task: "比较两款" },
    reference: { designId: id, versionId: "v1", designName: id, createdAt: "2026-11-21T00:00:00Z", seq: 1, summary: "并排对比", frameCount: 2, generatedFrameCount: 2, source: "model" } }).draft;
}
function legacyPrototypeCandidate(id: string) {
  // Read-only historical format: not admitted through the new S5 pin/create path.
  const question = confirmAidtVerificationQuestion({ ...emptyAidtUiDrafts()[5]!, fields: { prototypeIdeaSource: '{"revision":2,"ideaIds":["menu"]}', verificationQuestion: "能否理解差别？", beforeTestBelief: "也许可以", verificationBasis: "尚无行为证据", verificationLimits: "静态理解不代表购买", type: "静态图", situation: "午休", task: "比较两款" } })!;
  return updateAidtPrototypeReference(question, { designId: id, versionId: "v1", designName: id, createdAt: "2026-11-21T00:00:00Z", seq: 1, summary: "历史并排对比", frameCount: 2, generatedFrameCount: 2, source: "model" });
}

it("uses the explicitly selected confirmed prototype and never falls back after that selection changes or disappears", async () => {
  let draft = storeFormalPrototypeFixture(emptyAidtUiDrafts()[5]!, "A", prototypeCandidate("A"));
  draft = confirmAidtPrototypeEntityHandoff(draft, "A");
  expect(await aidtStageHasConfirmation(stage(5, draft))).toBe(true);
  const openedB = storeFormalPrototypeFixture(draft, "B", confirmAidtPrototypeHandoff(prototypeCandidate("B"))!);
  expect(readAidtConfirmedPrototypeHandoff(openedB)?.id).toBe("A");
  const selectedB = confirmAidtPrototypeEntityHandoff(openedB, "B");
  expect(readAidtConfirmedPrototypeHandoff(selectedB)?.id).toBe("B");
  expect(await aidtStageHasConfirmation(stage(5, selectedB))).toBe(true);
  const changedB = updateAidtPrototypeEntityDraft(selectedB, "B", previous => ({ ...previous, fields: { ...previous.fields, task: "更改测试任务" } }));
  expect(await aidtStageHasConfirmation(stage(5, changedB))).toBe(false);
  const missingB = { ...selectedB, fields: { ...selectedB.fields } }; delete missingB.fields["prototypeEntity:B"];
  expect(await aidtStageHasConfirmation(stage(5, missingB))).toBe(false);
  expect(await aidtStageHasConfirmation(stage(5, { ...selectedB, fields: { ...selectedB.fields, prototypeHandoffEntity: "unknown" } }))).toBe(false);
  expect(readAidtPrototypeEntityDraft(selectedB, "A")).toEqual(readAidtPrototypeEntityDraft(draft, "A"));
});
it("supports a unique older confirmed prototype but never invents a current choice among multiple older candidates", async () => {
  // Restore the persisted old format; a new insertion correctly invalidates confirmation.
  const a = StageDraft.parse({ ...emptyAidtUiDrafts()[5]!, fields: { "prototypeEntity:A": JSON.stringify(confirmAidtPrototypeHandoff(legacyPrototypeCandidate("A"))!.fields) } });
  expect(await aidtStageHasConfirmation(stage(5, a))).toBe(true);
  const both = StageDraft.parse({ ...a, fields: { ...a.fields, "prototypeEntity:B": JSON.stringify(confirmAidtPrototypeHandoff(legacyPrototypeCandidate("B"))!.fields) } });
  expect(await aidtStageHasConfirmation(stage(5, both))).toBe(false);
  expect(confirmAidtPrototypeEntityHandoff(both, "B")).toBe(both);
  expect(readAidtConfirmedPrototypeHandoff(both)).toBeNull();
  const historicallySelected = StageDraft.parse({ ...both, fields: { ...both.fields, prototypeHandoffEntity: "B" } });
  expect(await aidtStageHasConfirmation(stage(5, historicallySelected))).toBe(true);
});

it("does not treat a named test with plain reflection text as a confirmed learning round", async () => {
  const binding = createAidtQuestionSnapshot(prototypeCandidate("A"), 2);
  if (!binding.ok) throw new Error(binding.reason);
  const group = createAidtTestGroup(binding.snapshot, "8d806f0e-516e-4a40-97f9-fcd3991df967")!;
  const draft = updateAidtTestGroup({ ...emptyAidtUiDrafts()[6]!, fields: { questionSnapshot: binding.serialized } }, { ...group, reflection: "上传并写了反思，未确认" });
  expect(await aidtStageHasConfirmation(stage(6, draft))).toBe(false);
});
