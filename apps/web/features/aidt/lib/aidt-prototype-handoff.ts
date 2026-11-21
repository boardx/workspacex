import { z } from "zod";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";
import type { AidtSharedStage } from "./live-aidt-stages";
import { getAidtPrototypeGenerationReadiness, aidtVerificationConfirmation } from "./aidt-verification-loop";
import { readAidtPrototypeReference } from "./aidt-prototype-reference";

const Selection = z.object({
  revision: z.number().int().positive().max(2147483646),
  ideaIds: z.array(z.string().min(1).max(256)).min(1).max(8),
}).strict();
export type AidtPrototypeInputSelection = z.infer<typeof Selection>;

const IdeaHmw = z.object({ revision: Selection.shape.revision, id: z.string().min(1).max(256), text: z.string().trim().min(1).max(6000) }).strict();
export function readAidtPrototypeHmwSource(stage: AidtSharedStage | null) {
  if (stage?.stageId !== 4) return null;
  try {
    const result = IdeaHmw.safeParse(JSON.parse(stage.content.draft.fields.ideaHmwSource ?? ""));
    return result.success ? result.data : null;
  } catch { return null; }
}

const sourceField = "prototypeIdeaSource";
const confirmationField = "aidtPrototypeConfirmedHandoff";
const preparationFields = ["type", "situation", "task", "touchpoints", "operations", "requirements"] as const;

export function readAidtPrototypeInputSelection(draft: AidtUiStageDraft): AidtPrototypeInputSelection | null {
  try {
    const result = Selection.safeParse(JSON.parse(draft.fields[sourceField] ?? ""));
    return result.success && new Set(result.data.ideaIds).size === result.data.ideaIds.length ? result.data : null;
  } catch { return null; }
}

export function aidtChosenPrototypeIdeas(stage: AidtSharedStage | undefined) {
  if (stage?.stageId !== 4) return [];
  const draft = stage.content.draft;
  try {
    const result = Selection.shape.ideaIds.safeParse(JSON.parse(draft.fields.ideaHandoffIds ?? ""));
    if (!result.success || new Set(result.data).size !== result.data.length) return [];
    const ideas = result.data.map(id => draft.ideas.find(idea => idea.id === id));
    return ideas.every(idea => idea?.title.trim() && idea.description.trim()) ? ideas.flatMap(idea => idea ? [idea] : []) : [];
  } catch { return []; }
}

export function pinAidtPrototypeInputs(draft: AidtUiStageDraft, stage: AidtSharedStage) {
  const ideas = aidtChosenPrototypeIdeas(stage);
  if (!ideas.length) return draft;
  return { ...draft, fields: { ...draft.fields, [sourceField]: JSON.stringify({ revision: stage.revision, ideaIds: ideas.map(idea => idea.id) }), [confirmationField]: "", verificationQuestionConfirmed: "", verificationQuestionConfirmation: "" } };
}

export function resolveAidtPrototypeInputIdeas(selection: AidtPrototypeInputSelection, stage: AidtSharedStage | undefined) {
  if (stage?.revision !== selection.revision) return [];
  const ideas = aidtChosenPrototypeIdeas(stage);
  return ideas.length === selection.ideaIds.length && ideas.every((idea, index) => idea.id === selection.ideaIds[index]) ? ideas : [];
}

export function aidtPrototypePreparationError(draft: AidtUiStageDraft): string | null {
  const readiness = getAidtPrototypeGenerationReadiness(draft);
  if (!readiness.ready) return readiness.reason;
  if (!["beforeTestBelief", "verificationBasis", "verificationLimits"].every(field => draft.fields[field]?.trim())) return "请写下先前看法、已有依据或尚无证据，以及静态原型能验证的范围。";
  if (!preparationFields.slice(0, 3).every(field => draft.fields[field]?.trim())) return "请填写原型形式、使用情境和可观察的任务，再进入 Design 工作台。";
  return null;
}

function prototypeConfirmation(draft: AidtUiStageDraft): string | null {
  const selection = readAidtPrototypeInputSelection(draft);
  const reference = readAidtPrototypeReference(draft);
  if (aidtPrototypePreparationError(draft) || !selection || !reference?.generatedFrameCount) return null;
  return JSON.stringify({
    ...selection,
    designId: reference.designId,
    versionId: reference.versionId,
    question: aidtVerificationConfirmation(draft),
    brief: preparationFields.map(field => draft.fields[field]?.trim() ?? ""),
  });
}

export function confirmAidtPrototypeHandoff(draft: AidtUiStageDraft): AidtUiStageDraft | null {
  const confirmation = prototypeConfirmation(draft);
  if (!confirmation || confirmation.length > 6000) return null;
  return { ...draft, fields: { ...draft.fields, [confirmationField]: confirmation } };
}

export function isAidtPrototypeHandoffConfirmed(draft: AidtUiStageDraft) {
  const confirmation = prototypeConfirmation(draft);
  return Boolean(confirmation && draft.fields[confirmationField] === confirmation);
}

export function usesAidtPrototypeInputSelection(draft: AidtUiStageDraft) {
  return Object.hasOwn(draft.fields, sourceField);
}

const entityPrefix = "prototypeEntity:";
const EntityFields = z.record(z.string().max(6000));
export function readAidtPrototypeIdeaRevision(value: string | null | undefined): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const revision = Number(value);
  return revision <= 2147483646 ? revision : undefined;
}

const validPrototypeEntity = (id: string) => !!id.trim() && id.length <= 200 && !/[\u0000-\u001f\u007f]/.test(id) && id !== "." && id !== "..";

export function readAidtPrototypeEntityDraft(stageDraft: AidtUiStageDraft, id: string): AidtUiStageDraft | null {
  if (!validPrototypeEntity(id)) return null;
  const raw = stageDraft.fields[entityPrefix + id];
  if (!raw) return null;
  try {
    const fields = EntityFields.parse(JSON.parse(raw));
    const prototype = readAidtPrototypeReference({ fields, ideas: [], selectedIdeaId: "" });
    if (prototype && prototype.designId !== id) return null;
    return { fields, ideas: [], selectedIdeaId: "" };
  } catch { return null; }
}

export function updateAidtPrototypeEntityDraft(
  stageDraft: AidtUiStageDraft,
  id: string,
  change: (draft: AidtUiStageDraft) => AidtUiStageDraft,
): AidtUiStageDraft {
  if (!validPrototypeEntity(id)) return stageDraft;
  const previous = readAidtPrototypeEntityDraft(stageDraft, id) ?? { fields: {}, ideas: [], selectedIdeaId: "" };
  const next = change(previous);
  return { ...stageDraft, fields: { ...stageDraft.fields, [entityPrefix + id]: JSON.stringify(next.fields) } };
}

export function aidtPrototypeEntityDraftTooLarge(stageDraft: AidtUiStageDraft, id: string) {
  return (stageDraft.fields[entityPrefix + id]?.length ?? 0) > 6000;
}

export function listAidtConfirmedPrototypeEntities(stageDraft: AidtUiStageDraft) {
  return Object.keys(stageDraft.fields).flatMap(key => {
    if (!key.startsWith(entityPrefix)) return [];
    const id = key.slice(entityPrefix.length);
    const draft = readAidtPrototypeEntityDraft(stageDraft, id);
    const reference = draft ? readAidtPrototypeReference(draft) : null;
    return draft && reference && isAidtPrototypeHandoffConfirmed(draft) ? [{ id, title: reference.designName, draft }] : [];
  });
}
