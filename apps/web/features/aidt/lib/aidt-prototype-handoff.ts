import { z } from "zod";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";
import type { AidtSharedStage } from "./live-aidt-stages";
import { getAidtPrototypeGenerationReadiness, aidtVerificationConfirmation } from "./aidt-verification-loop";
import { readAidtPrototypeReference } from "./aidt-prototype-reference";
import { readAidtIdeaHandoff } from "./aidt-idea-handoff";

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
  return stage?.stageId === 4 ? readAidtIdeaHandoff(stage.content.draft, stage.projectId)?.ideas ?? [] : [];
}

export function pinAidtPrototypeInputs(draft: AidtUiStageDraft, stage: AidtSharedStage, selected?: readonly string[]) {
  const ideas = aidtChosenPrototypeIdeas(stage).filter(idea => !selected || selected.includes(idea.id));
  if (!ideas.length) return draft;
  return { ...draft, fields: { ...draft.fields, [sourceField]: JSON.stringify({ revision: stage.revision, ideaIds: ideas.map(idea => idea.id) }), [confirmationField]: "", verificationQuestionConfirmed: "", verificationQuestionConfirmation: "" } };
}

export function resolveAidtPrototypeInputIdeas(selection: AidtPrototypeInputSelection, stage: AidtSharedStage | undefined) {
  if (stage?.stageId !== 4 || stage.revision !== selection.revision) return [];
  // Historical prototypes retain their exact previously pinned source. This
  // reader does not admit new inputs: adoption/pinning uses the strict gate above.
  try {
    const retainedIds = Selection.shape.ideaIds.parse(JSON.parse(stage.content.draft.fields.ideaHandoffIds ?? ""));
    if (new Set(retainedIds).size !== retainedIds.length || !selection.ideaIds.every(id => retainedIds.includes(id))) return [];
    const chosen = selection.ideaIds.map(id => stage.content.draft.ideas.find(idea => idea.id === id));
    return chosen.every(idea => idea?.title.trim() && idea.description.trim()) ? chosen.flatMap(idea => idea ? [idea] : []) : [];
  } catch { return []; }
}

export function aidtPrototypePreparationError(draft: AidtUiStageDraft): string | null {
  if (draft.fields.prototypeArchived === "true") return "此原型已归档。";
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

export function countAidtPrototypeEntityDrafts(stageDraft: AidtUiStageDraft) {
  return Object.keys(stageDraft.fields).filter(key => {
    if (!key.startsWith(entityPrefix)) return false;
    const draft = readAidtPrototypeEntityDraft(stageDraft, key.slice(entityPrefix.length));
    return draft && Object.values(draft.fields).some(value => value.trim());
  }).length;
}

export function listAidtConfirmedPrototypeEntities(stageDraft: AidtUiStageDraft) {
  return Object.keys(stageDraft.fields).flatMap(key => {
    if (!key.startsWith(entityPrefix)) return [];
    const id = key.slice(entityPrefix.length);
    const draft = readAidtPrototypeEntityDraft(stageDraft, id);
    const reference = draft ? readAidtPrototypeReference(draft) : null;
    return draft && draft.fields.prototypeArchived !== "true" && reference && isAidtPrototypeHandoffConfirmed(draft) ? [{ id, title: reference.designName, draft }] : [];
  });
}

/** Selecting a handoff is a student action, separate from merely opening a candidate. */
export function confirmAidtPrototypeEntityHandoff(stageDraft: AidtUiStageDraft, id: string): AidtUiStageDraft {
  const draft = readAidtPrototypeEntityDraft(stageDraft, id);
  const confirmed = draft && confirmAidtPrototypeHandoff(draft);
  if (!confirmed) return stageDraft;
  const next = updateAidtPrototypeEntityDraft(stageDraft, id, () => confirmed);
  return { ...next, fields: { ...next.fields, prototypeHandoffEntity: id } };
}

export function readAidtConfirmedPrototypeHandoff(stageDraft: AidtUiStageDraft) {
  const candidates = listAidtConfirmedPrototypeEntities(stageDraft);
  if (Object.hasOwn(stageDraft.fields, "prototypeHandoffEntity")) {
    return candidates.find(candidate => candidate.id === stageDraft.fields.prototypeHandoffEntity) ?? null;
  }
  // Older documents had no selection pointer. Multiple candidates cannot imply a choice.
  return candidates.length === 1 ? candidates[0]! : null;
}

/** Card metadata uses the same stage document as its version and confirmation. */
export function updateAidtPrototypeCard(draft: AidtUiStageDraft, id: string, name: string) {
  const title = name.trim().slice(0, 80);
  if (!title || !validPrototypeEntity(id)) return draft;
  return updateAidtPrototypeEntityDraft(draft, id, previous => ({ ...previous, fields: { ...previous.fields, prototypeCardTitle: title } }));
}

export function archiveAidtPrototypeCard(draft: AidtUiStageDraft, id: string) {
  if (!validPrototypeEntity(id)) return draft;
  const next = updateAidtPrototypeEntityDraft(draft, id, previous => ({ ...previous, fields: { ...previous.fields, prototypeArchived: "true" } }));
  if (draft.fields.prototypeHandoffEntity !== id) return next;
  return { ...next, fields: { ...next.fields, prototypeHandoffEntity: "" } };
}

export function aidtAllActivePrototypeEntitiesConfirmed(draft: AidtUiStageDraft) {
  const active = Object.keys(draft.fields).filter(key => key.startsWith(entityPrefix))
    .map(key => readAidtPrototypeEntityDraft(draft, key.slice(entityPrefix.length)))
    .filter(candidate => candidate?.fields.prototypeArchived !== "true");
  return active.length > 0 && active.every(candidate => candidate && isAidtPrototypeHandoffConfirmed(candidate))
    && Boolean(readAidtConfirmedPrototypeHandoff(draft));
}

const proposalFields = {
  verificationQuestion: "验证问题", beforeTestBelief: "测试前看法", verificationBasis: "已有依据",
  verificationLimits: "验证范围", type: "原型形式", situation: "使用情境", task: "可观察的任务",
  touchpoints: "用户接触点", operations: "用户操作步骤", requirements: "制作要求",
} as const;
export const AIDT_PROTOTYPE_DISCUSSION_FIELDS = proposalFields;

type DiscussionTurn = { id: string; role: string; content?: unknown };
type PrototypeProposalField = keyof typeof proposalFields;
type PrototypeProposal = Partial<Record<PrototypeProposalField, string>>;
const fieldForLabel = new Map<string, PrototypeProposalField>(Object.entries(proposalFields).map(([field, label]) => [label, field as PrototypeProposalField]));
const proposalFieldNames = Object.keys(proposalFields) as PrototypeProposalField[];

/** Project only known teaching fields, never IDs, evidence references or confirmation flags. */
export function readAidtPrototypeDiscussionProposal(messages: readonly DiscussionTurn[]): PrototypeProposal | null {
  const result: PrototypeProposal = {};
  let studentSeen = false;
  for (const message of messages) {
    const content = typeof message.content === "string" ? message.content.trim() : "";
    if (!content || content.length > 12000) continue;
    if (message.role === "user") studentSeen = true;
    if (!studentSeen || (message.role !== "user" && message.role !== "assistant")) continue;
    const block = /\x60\x60\x60aidt-prototype\s*\n([\s\S]+?)\n\x60\x60\x60/i.exec(content)?.[1];
    if (block) {
      try {
        const candidate: unknown = JSON.parse(block);
        if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
          const values = candidate as Record<string, unknown>;
          for (const key of proposalFieldNames) {
            const value = values[key];
            if (typeof value === "string" && value.trim() && value.length <= 400) result[key] = value.trim();
          }
        }
      } catch { /* A malformed proposal leaves valid prior fields available. */ }
    }
    for (const raw of content.split("\n")) {
      const line = raw.trim().replace(/^[-*]\s+/, "").replace(/\*\*/g, "");
      const match = /^([^：:]+)[：:]\s*(.+)$/.exec(line);
      const name = match?.[1]?.trim(), value = match?.[2]?.trim();
      const field = name && fieldForLabel.get(name);
      if (field && value && value.length <= 400) result[field] = value;
    }
  }
  return studentSeen && Object.keys(result).length ? result : null;
}

export function readAidtSavedPrototypeDiscussion(draft: AidtUiStageDraft): PrototypeProposal | null {
  try {
    const record: unknown = JSON.parse(draft.fields.prototypeDiscussionProposal ?? "");
    if (!record || typeof record !== "object" || Array.isArray(record)) return null;
    const result: PrototypeProposal = {};
    for (const field of proposalFieldNames) {
      const value = (record as Record<string, unknown>)[field];
      if (typeof value === "string" && value.trim() && value.length <= 400) result[field] = value.trim();
    }
    return Object.keys(result).length ? result : null;
  } catch { return null; }
}
