import { z } from "zod";
import { AidtEntityId, IdeaHmwSource, readIdeaHmwSource } from "./aidt-stages";

/** Teaching labels, first prompts and method-specific limits share this registry. */
export const AIDT_BRAINSTORM_METHOD_REGISTRY = {
  free: { label: "自由联想", description: "从 HMW 中的人、场景或行为出发，沿关键词连续联想，保留不同方向，不急着评价。", startPrompt: "先选 HMW 中一个让你有想法的词，写下你自己想到的一个点子。" },
  reverse: { label: "逆向思考", description: "先提出会让体验更糟的做法，再把学生提出的做法翻转成改善方向。", startPrompt: "如果故意让这段体验更糟，你们会怎样做，又能怎样反过来？" },
  scamper: { label: "SCAMPER", description: "用替代、组合、调整、改变、他用、消除、重排或反转寻找变化；由学生选一个切口开始，不要求一次做完。", startPrompt: "从现有做法中挑一个环节，你想先替代、组合还是去掉什么？" },
  analogy: { label: "类比迁移", description: "寻找其他领域遇到的相似困难，将其做法转译到当前 HMW，并说明哪些条件不同。类比启发不是用户证据。", startPrompt: "你见过哪个不同场景也有类似困难，其中什么做法值得借来试试？" },
  role: { label: "换位思考", description: "从其他相关者角度提出不同可能，作为待验证的角色假设。", startPrompt: "换一个与你们不同的角色看这个问题，你会提出什么点子？请把猜测标出来。" },
  brainwriting: { label: "静默脑写", description: "先各自安静写下点子，再轮流分享、接续扩展，让每位成员都有思考空间。", startPrompt: "请各自先写一个点子，再把愿意分享的内容贴到这里，我们从这些实际内容接着想。" },
} as const;
export type AidtBrainstormMethod = keyof typeof AIDT_BRAINSTORM_METHOD_REGISTRY;
const methodKeys = Object.keys(AIDT_BRAINSTORM_METHOD_REGISTRY) as [AidtBrainstormMethod, ...AidtBrainstormMethod[]];
export const AIDT_BRAINSTORM_METHODS = Object.fromEntries(methodKeys.map(key => [key, AIDT_BRAINSTORM_METHOD_REGISTRY[key].label])) as Readonly<{
  [Key in AidtBrainstormMethod]: typeof AIDT_BRAINSTORM_METHOD_REGISTRY[Key]["label"];
}>;
export type AidtBrainstormMethodGuide = { readonly description: string; readonly startPrompt: string };
export const AIDT_BRAINSTORM_METHOD_GUIDES: Readonly<Record<AidtBrainstormMethod, AidtBrainstormMethodGuide>> = Object.fromEntries(methodKeys.map(key => {
  const { label: _label, ...guide } = AIDT_BRAINSTORM_METHOD_REGISTRY[key];
  return [key, guide];
})) as Readonly<Record<AidtBrainstormMethod, AidtBrainstormMethodGuide>>;
export const AIDT_BRAINSTORM_SELECTION_FIELD = "ideaBrainstormHandoff";
export const AIDT_BRAINSTORM_PREFIX = "ideaBrainstorm:";
export const AIDT_BRAINSTORM_CANDIDATE_LIMIT = 24;

export const AidtBrainstorm = z.object({
  id: AidtEntityId.refine(id => id.startsWith("brainstorm-")),
  title: z.string().trim().min(1).max(120).optional(),
  archived: z.literal(true).optional(),
  source: IdeaHmwSource,
  method: z.enum(methodKeys),
  count: z.number().int().min(1).max(AIDT_BRAINSTORM_CANDIDATE_LIMIT),
  candidates: z.array(AidtEntityId).max(AIDT_BRAINSTORM_CANDIDATE_LIMIT).refine(ids => new Set(ids).size === ids.length),
}).strict().refine(record => record.candidates.length <= record.count);
export type AidtBrainstorm = z.infer<typeof AidtBrainstorm>;

export function aidtBrainstormTitle(session: AidtBrainstorm) {
  return session.title ?? `头脑风暴 · ${AIDT_BRAINSTORM_METHODS[session.method]}`;
}

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

export function readAidtBrainstormSelection<Idea extends { id: string; title: string; description: string }>(
  draft: { fields: Record<string, string>; ideas: readonly Idea[] },
) {
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

/** Each existing session is one round. Pending choices never imply a formal completion. */
export const AIDT_BRAINSTORM_ROUND_SELECTION_PREFIX = "ideaBrainstormRoundSelection:";
export const AIDT_BRAINSTORM_ROUND_COMPLETION_PREFIX = "ideaBrainstormRoundCompletion:";
const roundIds = z.array(AidtEntityId).min(1).max(8).refine(ids => new Set(ids).size === ids.length);
const roundIdeaText = z.object({ id: AidtEntityId, title: z.string().trim().min(1).max(6000), description: z.string().max(6000) }).strict();
const roundClassificationData = z.object({ tags: z.record(AidtEntityId, z.array(z.string().min(1).max(64)).max(3)), reasons: z.record(AidtEntityId, z.string().max(6000)) }).strict();
export const AidtBrainstormRoundSelection = z.object({
  schemaVersion: z.literal(1), sessionId: AidtEntityId, source: IdeaHmwSource, method: z.enum(methodKeys), selectedIds: roundIds,
  classification: roundClassificationData.extend({ basis: z.array(roundIdeaText).max(100).refine(ideas => new Set(ideas.map(idea => idea.id)).size === ideas.length), confirmed: z.literal(true) }).strict().optional(),
}).strict();
export type AidtBrainstormRoundSelection = z.infer<typeof AidtBrainstormRoundSelection>;
export const AidtBrainstormRoundCompletion = z.object({
  schemaVersion: z.literal(1), status: z.literal("confirmed"), sessionId: AidtEntityId, projectId: z.string().min(1).max(256),
  title: z.string().trim().min(1).max(120), source: IdeaHmwSource, method: z.enum(methodKeys), selectedIds: roundIds,
  sheets: z.array(roundIdeaText.extend({ imageMaterial: z.string().min(1).max(6000) }).strict()).min(3).max(8),
  classification: roundClassificationData.extend({ titles: z.record(AidtEntityId, z.string().trim().min(1).max(6000)), confirmed: z.literal(true) }).strict(),
}).strict().refine(value => new Set(value.sheets.map(idea => idea.id)).size === value.sheets.length && value.selectedIds.every(id => value.sheets.some(idea => idea.id === id)));
export type AidtBrainstormRoundCompletion = z.infer<typeof AidtBrainstormRoundCompletion>;
export const aidtBrainstormRoundSelectionKey = (sessionId: string) => AIDT_BRAINSTORM_ROUND_SELECTION_PREFIX + sessionId;
export const aidtBrainstormRoundCompletionKey = (sessionId: string) => AIDT_BRAINSTORM_ROUND_COMPLETION_PREFIX + sessionId;
export function readAidtBrainstormRoundSelection(fields: Record<string, string>, sessionId: string): AidtBrainstormRoundSelection | null {
  const raw = fields[aidtBrainstormRoundSelectionKey(sessionId)];
  if (!raw || raw.length > 6000) return null;
  try { const value = AidtBrainstormRoundSelection.safeParse(JSON.parse(raw)); return value.success && value.data.sessionId === sessionId ? value.data : null; } catch { return null; }
}
export function readAidtBrainstormRoundCompletion(fields: Record<string, string>, sessionId: string): AidtBrainstormRoundCompletion | null {
  const raw = fields[aidtBrainstormRoundCompletionKey(sessionId)];
  if (!raw || raw.length > 6000) return null;
  try { const value = AidtBrainstormRoundCompletion.safeParse(JSON.parse(raw)); return value.success && value.data.sessionId === sessionId ? value.data : null; } catch { return null; }
}
