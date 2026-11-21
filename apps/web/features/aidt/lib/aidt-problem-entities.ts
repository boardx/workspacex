import { z } from "zod";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";

const problem = z.object({ id: z.string().uuid(), title: z.string().trim().min(1).max(120), archived: z.boolean() });
const fields = z.record(z.string());
const prefix = "problemEntity:";

function parse<T>(schema: z.ZodType<T>, raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    const value = schema.safeParse(JSON.parse(raw));
    return value.success ? value.data : null;
  } catch {
    return null;
  }
}

export function listAidtProblems(draft: AidtUiStageDraft) {
  return Object.entries(draft.fields).flatMap(([key, value]) => {
    if (!key.startsWith(prefix)) return [];
    const entry = parse(problem, value);
    return entry && key === prefix + entry.id ? [entry] : [];
  });
}

export function addAidtProblem(draft: AidtUiStageDraft, id: string, title: string) {
  const entry = problem.safeParse({ id, title, archived: false });
  if (!entry.success || draft.fields[prefix + id] || Object.keys(draft.fields).length > 95) return draft;
  return { ...draft, fields: { ...draft.fields, [prefix + id]: JSON.stringify(entry.data) } };
}

export function archiveAidtProblem(draft: AidtUiStageDraft, id: string) {
  const entry = listAidtProblems(draft).find(item => item.id === id);
  if (!entry || entry.archived) return draft;
  return { ...draft, fields: { ...draft.fields, [prefix + id]: JSON.stringify({ ...entry, archived: true }) } };
}

export function readAidtProblemEntityDraft(draft: AidtUiStageDraft, id: string): AidtUiStageDraft {
  return { fields: parse(fields, draft.fields["problemDraft:" + id]) ?? {}, ideas: [], selectedIdeaId: "" };
}

export function updateAidtProblemEntity(
  draft: AidtUiStageDraft,
  id: string,
  mutate: (old: AidtUiStageDraft) => AidtUiStageDraft,
) {
  if (!listAidtProblems(draft).some(item => item.id === id && !item.archived)) return draft;
  const previous = readAidtProblemEntityDraft(draft, id);
  const changed = mutate(previous);
  const record = JSON.stringify(changed.fields);
  const nextFields = { ...draft.fields, ["problemDraft:" + id]: record };
  // The named group handoff becomes current only through the explicit student confirmation.
  if (changed.fields.roundCompletion && previous.fields.roundCompletion !== changed.fields.roundCompletion) {
    const oldHandoff = draft.fields.problemHandoffEntity;
    const ordinary = (key: string) => key !== "problemHandoffEntity" && !key.startsWith(prefix) && !key.startsWith("problemDraft:");
    if (oldHandoff) {
      for (const key of Object.keys(readAidtProblemEntityDraft(draft, oldHandoff).fields).filter(ordinary)) delete nextFields[key];
    }
    Object.assign(nextFields, Object.fromEntries(Object.entries(changed.fields).filter(([key]) => ordinary(key))), { problemHandoffEntity: id });
  }
  return { ...draft, fields: nextFields };
}
