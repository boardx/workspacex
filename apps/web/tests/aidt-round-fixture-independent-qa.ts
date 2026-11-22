import { createHash } from "node:crypto";
import { pinAidtPrototypeInputs, updateAidtPrototypeEntityDraft } from "@/features/aidt/lib/aidt-prototype-handoff";
import { editAidtPrototypeText, confirmAidtPrototypeText, bindAidtPrototypeTextOutput, readAidtPrototypeTextConfirmation } from "@/features/aidt/lib/aidt-prototype-text-state";
import { confirmAidtVerificationQuestion } from "@/features/aidt/lib/aidt-verification-loop";
import { updateAidtPrototypeReference } from "@/features/aidt/lib/aidt-prototype-reference";
import { StageDraft } from "@repo/contracts/aidt-stages";
import { readAidtBrainstorm } from "@repo/contracts/aidt-brainstorm";
import { addAidtBrainstormCandidates, aidtBrainstormRoundClassificationDraft, confirmAidtBrainstormClassification, confirmAidtBrainstormCompletion, confirmAidtBrainstormSelection, createAidtBrainstorm } from "@/features/aidt/lib/aidt-brainstorm";
import { AIDT_IDEA_CLASSIFICATION_FIELDS, confirmAidtIdeaClassification, setAidtIdeaCategory, setAidtIdeaClassificationReason } from "@/features/aidt/lib/aidt-idea-classification";
import { confirmAidtIdeaFromChat } from "@/features/aidt/lib/aidt-idea-chat";
import type { AidtUiStageDraft } from "@/features/aidt/lib/aidt-ui-drafts";
export const projectId = "qa-project";
export const empty = (): AidtUiStageDraft => ({ fields: {}, ideas: [], selectedIdeaId: "" });
export const source = (round: string) => ({ id: `hmw-${round}`, revision: round === "a" ? 4 : 7, text: round === "a" ? "如何帮助学生比较口味？" : "如何帮助赶课者减少等待？" });
export function candidates(draft: AidtUiStageDraft, round: "a" | "b", longImages = false) {
  const sessionId = `brainstorm-${round}`;
  let next = createAidtBrainstorm(draft, { id: sessionId, title: `合成 ${round.toUpperCase()} 轮`, source: source(round), method: round === "a" ? "scamper" : "reverse", count: 3, candidates: [] });
  next = addAidtBrainstormCandidates(next, sessionId, [{ messageId: `qa-${round}-reply`, items: [
    { title: `${round} 比较卡`, description: "把两款口味分列展示。学生按已知偏好作比较。" },
    { title: `${round} 小杯试饮`, description: "先领取一小杯试饮。学生再选择是否购买整杯。" },
    { title: `${round} 等候提示`, description: "显示预计等候步骤。学生自行决定是否留下。" },
  ] }]);
  const ids = readAidtBrainstorm(next.fields, sessionId)!.candidates;
  for (const id of ids) {
    const material = { projectId, runId: longImages ? "r".repeat(220) : "qa-image-run", artifactId: longImages ? id + "x".repeat(170) : `image-${id}`,
      versionId: longImages ? "v".repeat(220) : "image-v1", name: longImages ? "图".repeat(220) + ".png" : `${id}.png`, mime: "image/png", sha256: "a".repeat(64), bytes: 42 };
    next = { ...next, fields: { ...next.fields, [`ideaFile:${id}`]: JSON.stringify(material) } };
    next = confirmAidtIdeaFromChat(next, id, next.ideas.find(idea => idea.id === id)!.description);
  }
  return { draft: next, sessionId, ids };
}
export function prepared(draft: AidtUiStageDraft, round: "a" | "b", longImages = false) {
  const built = candidates(draft, round, longImages);
  let next = confirmAidtBrainstormSelection(built.draft, built.sessionId, [built.ids[0]!]);
  let classification = aidtBrainstormRoundClassificationDraft(next, built.sessionId, built.ids);
  for (const id of built.ids) {
    classification = setAidtIdeaCategory(classification, id, round === "a" ? "easy" : "fun", true);
    classification = setAidtIdeaClassificationReason(classification, id, `${round} 轮学生判断：${longImages ? "理由".repeat(370) : "可用现有物品试做"}`);
  }
  classification = confirmAidtIdeaClassification(classification);
  const fields = Object.fromEntries(Object.values(AIDT_IDEA_CLASSIFICATION_FIELDS).map(key => [key, classification.fields[key]!]));
  next = confirmAidtBrainstormClassification(next, built.sessionId, built.ids, fields);
  return { ...built, draft: next, fields };
}
export function completed(draft: AidtUiStageDraft, round: "a" | "b") {
  const ready = prepared(draft, round);
  const next = confirmAidtBrainstormCompletion(ready.draft, ready.sessionId, ready.ids, projectId);
  if (next === ready.draft) throw new Error("Synthetic formal-round fixture failed the actual completion gate");
  return { ...ready, draft: StageDraft.parse(next) };
}


/** API-shaped synthetic fixture only: no browser upload/model or real teaching acceptance. */
export function reviewedFormalRoundFixture(input: {
  projectId: string; sessionId: string; source: { id: string; text: string; revision: number };
  ideas: { title: string; description: string }[]; selectedIndices: readonly number[];
}) {
  let draft = createAidtBrainstorm({ fields: {}, ideas: [], selectedIdeaId: "" }, {
    id: input.sessionId, title: "合成正式来源轮", source: input.source, method: "scamper", count: input.ideas.length, candidates: [],
  });
  draft = addAidtBrainstormCandidates(draft, input.sessionId, [{ messageId: "fixture-reviewed-round", items: input.ideas }]);
  const ids = readAidtBrainstorm(draft.fields, input.sessionId)!.candidates;
  const selectedIds = input.selectedIndices.map(index => ids[index]!);
  draft = confirmAidtBrainstormSelection(draft, input.sessionId, selectedIds);
  for (const id of ids) {
    draft = { ...draft, fields: { ...draft.fields, [`ideaFile:${id}`]: JSON.stringify({ projectId: input.projectId, runId: "fixture-only-no-upload", artifactId: `fixture-image-${id}`,
      versionId: "fixture-image-v1", name: "合成夹具图片引用.png", mime: "image/png", sha256: "a".repeat(64), bytes: 42 }) } };
    draft = confirmAidtIdeaFromChat(draft, id, draft.ideas.find(idea => idea.id === id)!.description);
  }
  let classification = aidtBrainstormRoundClassificationDraft(draft, input.sessionId, ids);
  classification = setAidtIdeaCategory(classification, ids[0]!, "easy", true);
  classification = setAidtIdeaClassificationReason(classification, ids[0]!, "合成学生分类：现有纸卡容易试做。");
  classification = confirmAidtIdeaClassification(classification);
  const fields = Object.fromEntries(Object.values(AIDT_IDEA_CLASSIFICATION_FIELDS).map(key => [key, classification.fields[key]!]));
  draft = confirmAidtBrainstormClassification(draft, input.sessionId, ids, fields);
  const completedDraft = confirmAidtBrainstormCompletion(draft, input.sessionId, ids, input.projectId);
  if (completedDraft === draft) throw new Error("Formal round fixture did not pass the actual review gate");
  return { draft: StageDraft.parse(completedDraft), sessionId: input.sessionId, ids, selectedIds };
}

/** Ready to review the prototype: real formal source + text confirmation + application binding, never a provider-verification claim. */
export function readyFormalPrototypeFixture(input: {
  projectId: string; designId: string; sourceRevision: number; fields: Record<string, string>;
  reference: import("@/features/aidt/lib/aidt-prototype-versions").AidtPrototypeVersionReference;
}) {
  const formal = reviewedFormalRoundFixture({ projectId: input.projectId, sessionId: `brainstorm-fixture-${input.designId}`, source: { revision: 1, id: "hmw-fixture", text: "如何帮助学生比较选择？" }, selectedIndices: [0], ideas: [
    { title: "菜单标签", description: "标注各款口味。学生并排比较。" },
    { title: "比较卡", description: "纸卡列出配料。学生按需选择。" },
    { title: "领取图", description: "图标展示路线。学生沿线领取。" },
  ] });
  const sourceStage: import("@/features/aidt/lib/live-aidt-stages").AidtSharedStage = { projectId: input.projectId, stageId: 4, revision: input.sourceRevision,
    content: { schemaVersion: 1, draft: formal.draft }, sourceStageRevisions: [], updatedBy: "qa-student", updatedAt: "2026-11-22T06:00:00Z" };
  const pinned = pinAidtPrototypeInputs({ fields: input.fields, ideas: [], selectedIdeaId: "" }, sourceStage, formal.selectedIds, formal.sessionId);
  const lineage = JSON.stringify({ schemaVersion: 1, projectId: input.projectId, stage4Revision: input.sourceRevision, brainstormId: formal.sessionId,
    ideas: formal.selectedIds.map(ideaId => ({ ideaId, references: [{ stageId: 4, revision: input.sourceRevision, entityId: formal.sessionId, role: "brainstorm" }], missing: ["合成夹具未关联实地材料"] })) });
  const text = "合成文字设计：先显示两款选择，再用简短说明解释比较方式。";
  const textDraft = editAidtPrototypeText({ ...pinned, fields: { ...pinned.fields, prototypeTextLineage: lineage } }, text, "text-fixture-v1");
  const confirmed = confirmAidtPrototypeText(textDraft, input.projectId, input.designId, 1);
  if (!confirmed) throw new Error("Formal prototype fixture text could not be confirmed");
  const question = confirmAidtVerificationQuestion(confirmed);
  if (!question) throw new Error("Formal prototype fixture requires an actual verification question");
  const draft = bindAidtPrototypeTextOutput(updateAidtPrototypeReference(question, input.reference), input.projectId, input.designId, input.reference.versionId,
    readAidtPrototypeTextConfirmation(confirmed)!, { kind: "native", bindingMethod: "student-selected-native-version", boundBy: "qa-student", boundAt: "2026-11-22T06:00:00Z",
      textSha256: createHash("sha256").update(text).digest("hex"), lineageSha256: createHash("sha256").update(lineage).digest("hex") });
  return { draft, sourceStage, formal };
}

/** Mirror draft-save followed by text-confirm; a fresh insertion correctly invalidates confirmation. */
export function storeFormalPrototypeFixture(stageDraft: AidtUiStageDraft, designId: string, prepared: AidtUiStageDraft) {
  const initial = updateAidtPrototypeEntityDraft(stageDraft, designId, () => ({ ...prepared, fields: { ...prepared.fields, prototypeTextConfirmation: "" } }));
  return updateAidtPrototypeEntityDraft(initial, designId, () => prepared);
}
