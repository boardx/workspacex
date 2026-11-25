import { isAidtCandidateRequest } from "@repo/contracts/aidt-candidate-request";
import { isAidtGreetingText } from "@repo/contracts/aidt-stages";
import { z } from "zod";
import { AIDT_BRAINSTORM_PREFIX, AIDT_BRAINSTORM_SELECTION_FIELD, AidtBrainstorm, readAidtBrainstorm, readAidtBrainstorms, readAidtBrainstormSelection, type AidtBrainstorm as Session, AidtBrainstormRoundSelection, AidtBrainstormRoundCompletion, aidtBrainstormRoundSelectionKey, aidtBrainstormRoundCompletionKey, readAidtBrainstormRoundSelection, readAidtBrainstormRoundCompletion } from "@repo/contracts/aidt-brainstorm";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";
import { readAidtIdeaHandoff, readAidtIdeaHmwSource, readAidtIdeaDirectory } from "./aidt-idea-handoff";
import { AIDT_IDEA_CLASSIFICATION_FIELDS, readAidtIdeaClassification } from "./aidt-idea-classification";

import { aidtBrainstormTitle } from "@repo/contracts/aidt-brainstorm";
import { parseAidtResearchMaterial, isAidtResearchImage, researchMaterialKey } from "./aidt-research-material-reference";
import { aidtIdeaReadiness } from "./aidt-idea-readiness";

export { readAidtBrainstormSelection };
const descriptions = z.array(z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().min(5).max(1000),
}).strict()).min(1).max(24);
type Candidate = z.infer<typeof descriptions>[number];
type Turn = { id: string; role: string; content?: unknown };
type Proposal = { messageId: string; items: Candidate[] };
const stableTitle = (title: string) => title.normalize("NFKC").toLowerCase().replace(/[\s\p{P}]/gu, "");

export function createAidtBrainstorm(draft: AidtUiStageDraft, session: Session): AidtUiStageDraft {
  if (!AidtBrainstorm.safeParse(session).success || session.candidates.length
    || readAidtBrainstorm(draft.fields, session.id) || Object.keys(draft.fields).length >= 100) return draft;
  return { ...draft, fields: { ...draft.fields, [AIDT_BRAINSTORM_PREFIX + session.id]: JSON.stringify(session) } };
}

/** Parse only the existing model output format; this supplies no student or save decision. */
function brainstormCandidateBlocks(text: string, sessionId: string, allowJson = false): Candidate[][] {
  if (text.length > 100_000) return [];
  const blocks: Candidate[][] = [];
  const fence = allowJson
    ? /\x60\x60\x60(?:aidt-ideas|json)\s*\r?\n([\s\S]*?)\r?\n\x60\x60\x60/g
    : /\x60\x60\x60aidt-ideas\s*\r?\n([\s\S]*?)\r?\n\x60\x60\x60/g;
  for (const match of text.matchAll(fence)) {
    try {
      const parsed = z.object({ sessionId: z.literal(sessionId), candidates: descriptions }).strict().safeParse(JSON.parse(match[1]!));
      if (parsed.success) blocks.push(parsed.data.candidates);
    } catch { /* Ignore malformed and incomplete model drafts. */ }
  }
  return blocks;
}
export function readAidtBrainstormCandidateReply(text: string, sessionId: string): Candidate[] {
  return brainstormCandidateBlocks(text, sessionId, true).flat();
}

export function readAidtBrainstormProposals(turns: readonly Turn[], sessionId: string): Proposal[] {
  const proposals: Proposal[] = [];
  let studentStarted = false;
  let previewOnly = false;
  for (const turn of turns) {
    if (typeof turn.content !== "string") continue;
    if (turn.role === "user") {
      previewOnly = isAidtCandidateRequest(turn.content, "ideation");
      if (!previewOnly && turn.content.trim() && !isAidtGreetingText(turn.content)) studentStarted = true;
    }
    if (turn.role !== "assistant" || previewOnly || !studentStarted) continue;
    for (const items of brainstormCandidateBlocks(turn.content, sessionId)) proposals.push({ messageId: turn.id, items });
  }
  return proposals;
}

export function addAidtBrainstormCandidates(draft: AidtUiStageDraft, sessionId: string, proposals: readonly Proposal[]) {
  const session = readAidtBrainstorm(draft.fields, sessionId);
  if (!session || session.archived || session.candidates.length >= session.count) return draft;
  const existing = draft.ideas.filter(idea => session.candidates.includes(idea.id));
  const titles = new Set(existing.map(idea => stableTitle(idea.title)));
  const descriptions = new Set(existing.map(idea => stableTitle(idea.description)));
  const usedIds = new Set(draft.ideas.map(idea => idea.id));
  const ideas: AidtUiStageDraft["ideas"] = [];
  for (const proposal of proposals) {
    for (const [index, item] of proposal.items.entries()) {
      if (session.candidates.length + ideas.length >= session.count || draft.ideas.length + ideas.length >= 100) break;
      const suffix = proposal.messageId.replace(/[^\w-]/g, "").slice(-48);
      if (!suffix) continue;
      const id = `${sessionId}-${suffix}-${index}`;
      const title = stableTitle(item.title), description = stableTitle(item.description);
      if (usedIds.has(id) || !title || !description || titles.has(title) || descriptions.has(description)) continue;
      titles.add(title);
      descriptions.add(description);
      usedIds.add(id);
      ideas.push({ id, ...item });
    }
  }
  if (!ideas.length) return draft;
  const next = { ...session, candidates: [...session.candidates, ...ideas.map(idea => idea.id)] };
  return { ...draft, ideas: [...draft.ideas, ...ideas], fields: { ...draft.fields,
    ideaSheetIds: "", [AIDT_IDEA_CLASSIFICATION_FIELDS.confirmed]: "",
    [AIDT_BRAINSTORM_PREFIX + sessionId]: JSON.stringify(next) } };
}

const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(id => b.includes(id));
const sameSource = (a: Session["source"], b: Session["source"]) => a.id === b.id && a.revision === b.revision && a.text === b.text;
function boundedDraft(old: AidtUiStageDraft, next: AidtUiStageDraft): AidtUiStageDraft {
  return Object.keys(next.fields).length <= 100 && Object.values(next.fields).every(value => value.length <= 6000) && next.ideas.length <= 100 ? next : old;
}

/** Specified session's pending student selection; legacy global data is read, never migrated. */
export function readAidtBrainstormSelectionForSession(draft: AidtUiStageDraft, sessionId: string) {
  const session = readAidtBrainstorm(draft.fields, sessionId);
  if (!session) return null;
  const key = aidtBrainstormRoundSelectionKey(sessionId);
  if (!Object.hasOwn(draft.fields, key)) {
    const legacy = readAidtBrainstormSelection(draft);
    return legacy?.session.id === sessionId ? legacy : null;
  }
  const saved = readAidtBrainstormRoundSelection(draft.fields, sessionId);
  const active = new Set(readAidtIdeaDirectory(draft).filter(idea => !idea.archived).map(idea => idea.id));
  if (!saved || !sameSource(saved.source, session.source) || saved.method !== session.method
    || !saved.selectedIds.every(id => session.candidates.includes(id) && active.has(id))) return null;
  const ideas = saved.selectedIds.map(id => draft.ideas.find(idea => idea.id === id));
  if (!ideas.every(idea => idea?.title.trim() && idea.description.trim())) return null;
  return { session, selectedIds: saved.selectedIds, ideas: ideas.filter(idea => idea !== undefined) };
}

/** Only current round candidates and explicitly reviewed same-HMW sheets are classifiable here. */
export function aidtBrainstormRoundClassificationDraft(draft: AidtUiStageDraft, sessionId: string, sheetIds: readonly string[] = []): AidtUiStageDraft {
  const session = readAidtBrainstorm(draft.fields, sessionId);
  if (!session) return { ...draft, ideas: [] };
  const active = new Set(readAidtIdeaDirectory(draft).filter(idea => !idea.archived).map(idea => idea.id));
  const ids = new Set([...session.candidates, ...sheetIds]);
  const ideas = draft.ideas.filter(idea => ids.has(idea.id) && active.has(idea.id) && sameSource(readAidtIdeaHmwSource(draft, idea.id) ?? session.source, session.source));
  const basis = ideas.map(({ id, title, description }) => ({ id, title, description })).sort((a, b) => a.id.localeCompare(b.id));
  const own = readAidtBrainstormRoundSelection(draft.fields, sessionId);
  const legacy = !Object.hasOwn(draft.fields, aidtBrainstormRoundSelectionKey(sessionId)) && readAidtBrainstormSelection(draft)?.session.id === sessionId;
  const classification = own?.classification;
  const filtered = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([id]) => ideas.some(idea => idea.id === id)));
  const oldClassification = readAidtIdeaClassification(draft);
  const tags = classification?.tags ?? (legacy ? filtered(oldClassification.tags) : {});
  const reasons = classification?.reasons ?? (legacy ? filtered(oldClassification.reasons) : {});
  const confirmed = classification ? JSON.stringify(classification.basis) === JSON.stringify(basis) && sameSource(own!.source, session.source) && own!.method === session.method : Boolean(legacy && oldClassification.confirmed);
  return { ...draft, ideas, fields: { ...draft.fields,
    [AIDT_IDEA_CLASSIFICATION_FIELDS.tags]: JSON.stringify(tags), [AIDT_IDEA_CLASSIFICATION_FIELDS.reasons]: JSON.stringify(reasons),
    [AIDT_IDEA_CLASSIFICATION_FIELDS.confirmed]: confirmed ? "true" : "" } };
}

export function confirmAidtBrainstormSelection(draft: AidtUiStageDraft, sessionId: string, ids: string[]): AidtUiStageDraft {
  const session = readAidtBrainstorm(draft.fields, sessionId);
  if (!session || session.archived) return draft;
  const previous = readAidtBrainstormRoundSelection(draft.fields, sessionId);
  const record = AidtBrainstormRoundSelection.safeParse({ schemaVersion: 1, sessionId, source: session.source, method: session.method, selectedIds: ids,
    ...(previous?.classification && sameSource(previous.source, session.source) && previous.method === session.method ? { classification: previous.classification } : {}) });
  if (!record.success) return draft;
  const next = { ...draft, fields: { ...draft.fields,
    ideaHmwSource: JSON.stringify(session.source), ideaSheetIds: "", ideaHandoffIds: JSON.stringify(ids),
    [AIDT_BRAINSTORM_SELECTION_FIELD]: JSON.stringify({ sessionId, ids }),
    [aidtBrainstormRoundSelectionKey(sessionId)]: JSON.stringify(record.data),
  } };
  return readAidtBrainstormSelection(next) ? boundedDraft(draft, next) : draft;
}

/** Explicit classification is round-local; editing or selecting never rewrites the formal snapshot. */
export function confirmAidtBrainstormClassification(draft: AidtUiStageDraft, sessionId: string, sheetIds: string[], fields: Record<string, string>): AidtUiStageDraft {
  const selected = readAidtBrainstormSelectionForSession(draft, sessionId);
  if (!selected || selected.session.archived) return draft;
  const scoped = aidtBrainstormRoundClassificationDraft({ ...draft, fields: { ...draft.fields, ...fields } }, sessionId, sheetIds);
  // The explicit editor's fields are the student decision; the scope supplies the actual idea list.
  const submitted = { ...scoped, fields: { ...scoped.fields, ...fields } };
  const value = readAidtIdeaClassification(submitted);
  if (!value.confirmed) return draft;
  const basis = scoped.ideas.map(({ id, title, description }) => ({ id, title, description })).sort((a, b) => a.id.localeCompare(b.id));
  const record = AidtBrainstormRoundSelection.safeParse({ schemaVersion: 1, sessionId, source: selected.session.source, method: selected.session.method, selectedIds: selected.selectedIds,
    classification: { tags: value.tags, reasons: value.reasons, basis, confirmed: true } });
  if (!record.success) return draft;
  return boundedDraft(draft, { ...draft, fields: { ...draft.fields, ...fields, ideaSheetIds: "",
    [aidtBrainstormRoundSelectionKey(sessionId)]: JSON.stringify(record.data) } });
}

export type AidtConfirmedBrainstormRound = {
  stableId: string; sessionId: string; title: string; source: Session["source"]; method: Session["method"];
  selectedIds: string[]; sheetIds: string[]; ideas: AidtUiStageDraft["ideas"]; draft: AidtUiStageDraft; classificationDraft: AidtUiStageDraft; legacy: boolean;
};
function formalRound(value: AidtBrainstormRoundCompletion, projectId: string): AidtConfirmedBrainstormRound | null {
  if (value.projectId !== projectId) return null;
  const fields: Record<string, string> = {
    [AIDT_IDEA_CLASSIFICATION_FIELDS.tags]: JSON.stringify(value.classification.tags),
    [AIDT_IDEA_CLASSIFICATION_FIELDS.reasons]: JSON.stringify(value.classification.reasons), [AIDT_IDEA_CLASSIFICATION_FIELDS.confirmed]: "true",
  };
  const ideas = value.sheets.map(({ id, title, description, imageMaterial }) => { fields[researchMaterialKey("idea", id)] = imageMaterial; return { id, title, description }; });
  const hasImage = (idea: typeof ideas[number]) => { const image = parseAidtResearchMaterial(fields[researchMaterialKey("idea", idea.id)]); return image?.projectId === projectId && isAidtResearchImage(image); };
  if (!aidtIdeaReadiness(ideas, hasImage).ready || !value.selectedIds.every(id => ideas.some(idea => idea.id === id))) return null;
  const classIdeas = Object.entries(value.classification.titles).map(([id, title]) => ({ id, title, description: ideas.find(idea => idea.id === id)?.description ?? "" }));
  if (!ideas.every(idea => classIdeas.some(item => item.id === idea.id))) return null;
  const classificationDraft = { fields, ideas: classIdeas, selectedIdeaId: "" };
  if (!readAidtIdeaClassification(classificationDraft).confirmed) return null;
  const onlySheets = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => ideas.some(idea => idea.id === id)));
  // A derived read view, never persisted. It does not invent individual Chat confirmations.
  const snapshotDraft: AidtUiStageDraft = { ideas, selectedIdeaId: "", fields: { ...fields,
    [AIDT_IDEA_CLASSIFICATION_FIELDS.tags]: JSON.stringify(onlySheets(value.classification.tags)),
    [AIDT_IDEA_CLASSIFICATION_FIELDS.reasons]: JSON.stringify(onlySheets(value.classification.reasons)),
    ideaHmwSource: JSON.stringify(value.source), ideaHandoffIds: JSON.stringify(value.selectedIds), ideaSheetIds: JSON.stringify(ideas.map(idea => idea.id)) } };
  return { stableId: value.sessionId, sessionId: value.sessionId, title: value.title, source: value.source, method: value.method, selectedIds: value.selectedIds,
    sheetIds: ideas.map(idea => idea.id), ideas, draft: snapshotDraft, classificationDraft, legacy: false };
}

/** S5 selects 1 or 3 only from ONE result's frozen ideas, then pins its real stage4 revision + sessionId. */
export function readAidtConfirmedBrainstormRounds(draft: AidtUiStageDraft, projectId: string, options: { sessionId?: string; includeArchived?: boolean } = {}): AidtConfirmedBrainstormRound[] {
  return readAidtBrainstorms(draft.fields).filter(session => (!options.sessionId || session.id === options.sessionId) && (options.includeArchived || !session.archived)).flatMap(session => {
    const key = aidtBrainstormRoundCompletionKey(session.id);
    if (Object.hasOwn(draft.fields, key)) {
      const saved = readAidtBrainstormRoundCompletion(draft.fields, session.id);
      const result = saved && formalRound(saved, projectId);
      return result ? [result] : [];
    }
    const legacySelection = readAidtBrainstormSelection(draft);
    const legacy = legacySelection?.session.id === session.id ? readAidtIdeaHandoff(draft, projectId) : null;
    if (!legacy) return [];
    return [{ stableId: session.id, sessionId: session.id, title: aidtBrainstormTitle(session), source: session.source, method: session.method,
      selectedIds: legacy.selectedIds, sheetIds: legacy.sheetIds, ideas: draft.ideas.filter(idea => legacy.sheetIds.includes(idea.id)),
      draft, classificationDraft: aidtBrainstormRoundClassificationDraft(draft, session.id, legacy.sheetIds), legacy: true }];
  });
}

/** Explicit student review creates a formal snapshot; shortlist and unfinished edits cannot do this. */
export function confirmAidtBrainstormCompletion(draft: AidtUiStageDraft, sessionId: string, sheetIds: string[], projectId: string): AidtUiStageDraft {
  const choice = readAidtBrainstormSelectionForSession(draft, sessionId);
  if (!choice || choice.session.archived) return draft;
  const classificationDraft = aidtBrainstormRoundClassificationDraft(draft, sessionId, sheetIds);
  const classification = readAidtIdeaClassification(classificationDraft);
  if (!classification.confirmed) return draft;
  const projected = { ...draft, fields: { ...draft.fields, ...Object.fromEntries(Object.values(AIDT_IDEA_CLASSIFICATION_FIELDS).map(key => [key, classificationDraft.fields[key] ?? ""])),
    ideaHmwSource: JSON.stringify(choice.session.source), ideaHandoffIds: JSON.stringify(choice.selectedIds), ideaSheetIds: JSON.stringify(sheetIds),
    [AIDT_BRAINSTORM_SELECTION_FIELD]: JSON.stringify({ sessionId, ids: choice.selectedIds }) } };
  if (!readAidtIdeaHandoff(projected, projectId)) return draft;
  const sheets = sheetIds.map(id => { const idea = draft.ideas.find(item => item.id === id)!; return { id, title: idea.title, description: idea.description, imageMaterial: draft.fields[researchMaterialKey("idea", id)] ?? "" }; });
  const snapshot = AidtBrainstormRoundCompletion.safeParse({ schemaVersion: 1, status: "confirmed", sessionId, projectId, title: aidtBrainstormTitle(choice.session), source: choice.session.source,
    method: choice.session.method, selectedIds: choice.selectedIds, sheets, classification: { tags: classification.tags, reasons: classification.reasons, titles: Object.fromEntries(classificationDraft.ideas.map(idea => [idea.id, idea.title])), confirmed: true } });
  if (!snapshot.success || !formalRound(snapshot.data, projectId)) return draft;
  return boundedDraft(draft, { ...projected, fields: { ...projected.fields, [aidtBrainstormRoundCompletionKey(sessionId)]: JSON.stringify(snapshot.data) } });
}
