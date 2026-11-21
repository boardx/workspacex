import { z } from "zod";
import { AidtEntityId, IdeaHmwSource, readIdeaHmwSource, type SharedStageValue } from "./aidt-stages";

export const AIDT_BRAINSTORM_METHODS = { free: "自由联想", reverse: "逆向思考", scamper: "SCAMPER" } as const;
export const AIDT_BRAINSTORM_SELECTION_FIELD = "ideaBrainstormHandoff";
export const AIDT_BRAINSTORM_PREFIX = "ideaBrainstorm:";
export const AIDT_BRAINSTORM_CANDIDATE_LIMIT = 24;

export const AidtBrainstorm = z.object({
  id: AidtEntityId.refine(id => id.startsWith("brainstorm-")),
  source: IdeaHmwSource,
  method: z.enum(["free", "reverse", "scamper"]),
  count: z.number().int().min(1).max(AIDT_BRAINSTORM_CANDIDATE_LIMIT),
  candidates: z.array(AidtEntityId).max(AIDT_BRAINSTORM_CANDIDATE_LIMIT).refine(ids => new Set(ids).size === ids.length),
}).strict().refine(record => record.candidates.length <= record.count);
export type AidtBrainstorm = z.infer<typeof AidtBrainstorm>;

export function readAidtBrainstorm(fields: Record<string, string>, id: string): AidtBrainstorm | null {
  const raw = fields[AIDT_BRAINSTORM_PREFIX + id];
  if (!raw) return null;
  try {
    const record = AidtBrainstorm.safeParse(JSON.parse(raw));
    return record.success && record.data.id === id ? record.data : null;
  } catch {
    return null;
  }
}

export function readAidtBrainstorms(fields: Record<string, string>) {
  return Object.keys(fields).filter(key => key.startsWith(AIDT_BRAINSTORM_PREFIX))
    .flatMap(key => readAidtBrainstorm(fields, key.slice(AIDT_BRAINSTORM_PREFIX.length)) ?? []);
}

export function isAidtConfirmedHmwSource(stage: SharedStageValue | null, source: AidtBrainstorm["source"]) {
  if (stage?.stageId !== 3 || stage.revision !== source.revision) return false;
  const { fields } = stage.content.draft;
  try {
    const hmw = JSON.parse(fields["definitionHmw:" + source.id] ?? "null");
    return hmw?.id === source.id && hmw.confirmed === true && hmw.archived === false
      && typeof hmw.text === "string" && hmw.text.trim() === source.text;
  } catch {
    return false;
  }
}

export function readAidtBrainstormSelection(draft: SharedStageValue["content"]["draft"]) {
  try {
    const selected = z.object({ sessionId: z.string(), ids: z.array(z.string()).min(1).max(8) }).strict()
      .parse(JSON.parse(draft.fields[AIDT_BRAINSTORM_SELECTION_FIELD] ?? ""));
    if (new Set(selected.ids).size !== selected.ids.length) return null;
    const session = readAidtBrainstorm(draft.fields, selected.sessionId);
    const archived: unknown = JSON.parse(draft.fields.ideaArchivedIds || "[]");
    if (!session || !Array.isArray(archived) || !selected.ids.every(id => session.candidates.includes(id) && !archived.includes(id))) return null;
    const ideas = selected.ids.map(id => draft.ideas.find(idea => id === idea.id));
    if (!ideas.every(idea => idea?.title.trim() && idea.description.trim())) return null;
    const stored: unknown = JSON.parse(draft.fields.ideaHandoffIds ?? "");
    const hmw = readIdeaHmwSource(draft.fields.ideaHmwSource);
    if (JSON.stringify(stored) !== JSON.stringify(selected.ids) || !hmw
      || hmw.id !== session.source.id || hmw.revision !== session.source.revision || hmw.text !== session.source.text) return null;
    return { session, selectedIds: selected.ids, ideas: ideas.filter(idea => idea !== undefined) };
  } catch { return null; }
}

