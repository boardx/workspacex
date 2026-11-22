import { z } from "zod";
import { IdeaHmwSource, readIdeaHmwSource } from "@repo/contracts/aidt-stages";
import { AIDT_IDEA_CLASSIFICATION_FIELDS, readAidtIdeaClassification } from "./aidt-idea-classification";
import { aidtIdeaReadiness } from "./aidt-idea-readiness";
import { isAidtResearchImage, parseAidtResearchMaterial, researchMaterialKey } from "./aidt-research-material-reference";
import { readAidtBrainstorms, readAidtBrainstormSelection } from "@repo/contracts/aidt-brainstorm";
import { hasAidtIdeaChatConfirmations, isAidtIdeaChatConfirmed } from "./aidt-idea-chat";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";

const ideaIds = z.array(z.string().min(1).max(256)).min(1).max(8)
  .refine(ids => new Set(ids).size === ids.length);

export type AidtIdeaHmwSource = z.infer<typeof IdeaHmwSource>;

function parse<T>(schema: z.ZodType<T>, raw?: string): T | null {
  if (!raw || raw.length > 6000) return null;
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function readAidtIdeaHmwSource(draft: AidtUiStageDraft, entityId?: string): AidtIdeaHmwSource | null {
  const key = `ideaHmwSource:${entityId}`;
  const owner = entityId && readAidtBrainstorms(draft.fields).find(session => session.candidates.includes(entityId));
  if (owner) return owner.source;
  return readIdeaHmwSource(entityId && Object.hasOwn(draft.fields, key) ? draft.fields[key] : draft.fields.ideaHmwSource);
}

export function readAidtIdeaSheetIds(draft: AidtUiStageDraft): string[] {
  return parse(ideaIds, draft.fields.ideaSheetIds) ?? [];
}

export function readAidtIdeaHandoffIds(draft: AidtUiStageDraft): string[] {
  return parse(ideaIds, draft.fields.ideaHandoffIds) ?? [];
}

export function canConfirmAidtIdeaSheets(draft: AidtUiStageDraft, ids: string[], projectId: string): boolean {
  const activeDraft = activeAidtIdeaDraft(draft);
  if (!readAidtIdeaHmwSource(draft) || !readAidtIdeaClassification(activeDraft).confirmed || !ideaIds.safeParse(ids).success) return false;
  const ideas = activeDraft.ideas.filter(idea => ids.includes(idea.id));
  const sessions = readAidtBrainstorms(draft.fields);
  if (ids.some(id => sessions.some(session => session.archived && session.candidates.includes(id)))) return false;
  const brainstorm = readAidtBrainstormSelection(draft);
  if (brainstorm?.session.archived) return false;
  const hmw = readAidtIdeaHmwSource(draft);
  if (brainstorm && !ids.every(id => {
    const source = readAidtIdeaHmwSource(draft, id);
    return source?.id === hmw?.id && source?.revision === hmw?.revision && source?.text === hmw?.text;
  })) return false;
  if ((brainstorm || hasAidtIdeaChatConfirmations(draft)) && !ids.every(id => isAidtIdeaChatConfirmed(draft, id))) return false;
  const hasSavedImage = (idea: (typeof ideas)[number]) => {
    const material = parseAidtResearchMaterial(draft.fields[researchMaterialKey("idea", idea.id)]);
    return material?.projectId === projectId && isAidtResearchImage(material);
  };
  return ideas.length === ids.length && ideas.every(hasSavedImage) && aidtIdeaReadiness(ideas, hasSavedImage).ready;
}

export function readAidtIdeaHandoff(draft: AidtUiStageDraft, projectId: string) {
  const brainstorm = readAidtBrainstormSelection(draft);
  if (draft.fields.ideaBrainstormHandoff && (!brainstorm || brainstorm.session.archived)) return null;
  const hmw = readAidtIdeaHmwSource(draft);
  const sheetIds = readAidtIdeaSheetIds(draft);
  const selectedIds = readAidtIdeaHandoffIds(draft);
  if (!hmw || !canConfirmAidtIdeaSheets(draft, sheetIds, projectId) || !selectedIds.length || !selectedIds.every(id => sheetIds.includes(id))) return null;
  return { hmw, sheetIds, selectedIds, ideas: draft.ideas.filter(idea => selectedIds.includes(idea.id)) };
}

export function invalidateAidtIdeaSheets(draft: AidtUiStageDraft): AidtUiStageDraft {
  if (!draft.fields.ideaSheetIds && !draft.fields.ideaHandoffIds) return draft;
  // Editing a candidate invalidates formal review, not the student's text shortlist.
  if (readAidtBrainstormSelection(draft)) return { ...draft, fields: { ...draft.fields, ideaSheetIds: "" } };
  return { ...draft, fields: { ...draft.fields, ideaSheetIds: "", ideaHandoffIds: "", ideaBrainstormHandoff: "" } };
}

export function readAidtIdeaDirectory(draft: AidtUiStageDraft) {
  const archived = readAidtArchivedIdeaIds(draft);
  return draft.ideas
    .filter(idea => !/^draft-[123]$/u.test(idea.id) || idea.title.trim() || idea.description.trim() || idea.imageAttachment)
    .map(idea => ({ id: idea.id, title: idea.title.trim() || "未命名点子", archived: archived.includes(idea.id) }));
}

export function createAidtIdea(draft: AidtUiStageDraft, id: string, title: string): AidtUiStageDraft {
  const meaningful = draft.ideas.filter(idea => !/^draft-[123]$/u.test(idea.id) || idea.title.trim() || idea.description.trim() || idea.imageAttachment);
  if (!title.trim() || title.length > 120 || meaningful.length >= 8 || !id || meaningful.some(idea => idea.id === id)) return draft;
  return invalidateAidtIdeaSheets({
    ...draft,
    fields: { ...draft.fields, [AIDT_IDEA_CLASSIFICATION_FIELDS.confirmed]: "" },
    ideas: [...meaningful, { id, title: title.trim(), description: "" }],
  });
}

export function renameAidtIdea(draft: AidtUiStageDraft, id: string, title: string): AidtUiStageDraft {
  const name = title.trim();
  if (!name || name.length > 120 || !readAidtIdeaDirectory(draft).some(item => item.id === id && !item.archived && item.title !== name)) return draft;
  return invalidateAidtIdeaSheets({
    ...draft,
    fields: { ...draft.fields, [AIDT_IDEA_CLASSIFICATION_FIELDS.confirmed]: "" },
    ideas: draft.ideas.map(item => item.id === id ? { ...item, title: name } : item),
  });
}

function readAidtArchivedIdeaIds(draft: AidtUiStageDraft): string[] {
  return parse(ideaIds, draft.fields.ideaArchivedIds) ?? [];
}

export function activeAidtIdeaDraft(draft: AidtUiStageDraft): AidtUiStageDraft {
  const archived = readAidtArchivedIdeaIds(draft);
  if (!archived.length) return draft;
  return { ...draft, ideas: draft.ideas.filter(idea => !archived.includes(idea.id)) };
}

export function archiveAidtIdea(draft: AidtUiStageDraft, id: string): AidtUiStageDraft {
  const archived = readAidtArchivedIdeaIds(draft);
  if (archived.includes(id) || !readAidtIdeaDirectory(draft).some(idea => idea.id === id)) return draft;
  return invalidateAidtIdeaSheets({ ...draft, fields: {
    ...draft.fields, ideaArchivedIds: JSON.stringify([...archived, id]), [AIDT_IDEA_CLASSIFICATION_FIELDS.confirmed]: "",
  } });
}
