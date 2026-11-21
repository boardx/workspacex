import type { SharedStageValue } from "@repo/contracts/aidt-stages";
import { z } from "zod";

const question = z.string().trim().min(1).max(1000);
const draftPatch = z.object({
  goal: z.string().trim().min(1).max(250).optional(),
  questions: z.array(question).min(1).max(30).refine(items => items.join("\n").length <= 1000).optional(),
  finding: z.object({
    headline: z.string().trim().min(1).max(500).optional(), context: z.string().trim().min(1).max(1700).optional(),
    interpretation: z.string().trim().min(1).max(1700).optional(), quote: z.string().trim().min(1).max(800).optional(),
  }).strict().optional(),
}).strict();

/** Only completed assistant turns can supply this draft. Decisions, identity and permissions are outside the contract. */
export function readInterviewChatDraft(text: string) {
  const headings = /^#{2,4} (访谈问题清单|人物发现卡)[（(]草稿[）)][ \t]*$/u;
  const questions: string[] = [];
  const finding: Record<string, string> = {};
  const labels: Record<string, string> = { "一句发现": "headline", "具体情况": "context", "学生的解释": "interpretation", "受访者原话": "quote" };
  let section = "", goal = "", fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("```")) { fenced = !fenced; section = ""; continue; }
    if (fenced) continue;
    const title = headings.exec(line.trim());
    if (title) { section = title[1]!; continue; }
    if (!line.trim()) continue;
    const field = /^(研究重点|一句发现|具体情况|学生的解释|受访者原话)[：:]\s*(.+)$/u.exec(line.trim());
    const bullet = /^(?:[-*] |\d+[.)、]\s*)(.+)$/u.exec(line.trim());
    if (section === "访谈问题清单" && field?.[1] === "研究重点") goal = field[2]!;
    else if (section === "访谈问题清单" && bullet) questions.push(bullet[1]!);
    else if (section === "人物发现卡" && field && labels[field[1]!]) finding[labels[field[1]!]!] = field[2]!;
    else section = "";
  }
  if (!questions.length && !Object.keys(finding).length) return null;
  const parsed = draftPatch.safeParse({ ...(goal && { goal }), ...(questions.length && { questions }), ...(Object.keys(finding).length && { finding }) });
  return parsed.success ? parsed.data : null;
}

type Draft = SharedStageValue["content"]["draft"];
type Turn = { user: string; assistant: string; messageId: string };
const recordShape = z.object({
  id: z.string().uuid(), version: z.literal(1), code: z.string().min(1).max(32), original: z.string(),
  adopted: z.string(), goal: z.string(), guideConfirmed: z.boolean(), consent: z.object({ notes: z.boolean() }).passthrough().nullable(),
}).passthrough();
const sourceShape = z.object({ checked: z.literal(true), text: z.string(), locator: z.string().trim().min(1), sourceKey: z.string() });
const materialShape = z.object({ mime: z.string(), artifactId: z.string().min(1), projectId: z.string().min(1) });
function json(raw: string | undefined): unknown { try { return JSON.parse(raw ?? ""); } catch { return null; } }

/** Run completion owns automatic drafts. Caller authenticates the pinned Skill, thread, turn and stage before calling. */
export function projectInterviewSkillDraft(draft: Draft, entityId: string, turn: Turn): Draft | null {
  const key = "interviewRecord:" + entityId;
  const record = recordShape.safeParse(json(draft.fields[key]));
  if (!record.success || record.data.id !== entityId || draft.fields["interviewArchived:" + entityId] === "true"
    || !turn.messageId || turn.messageId.length > 256 || record.data.draftTurnId === turn.messageId) return null;
  const current = record.data, data = readInterviewChatDraft(turn.assistant);
  const userText = turn.user.trim();
  if (!userText) return null;
  // Save student-authored questions even when the Skill first asks to clarify the interview context.
  const openingHasQuestion = userText.split(/\n+/u).some(line => {
    const text = line.trim();
    if (text.length < 4 || /^(?:你好|您好|在吗|hello|hi)[呀啊吗？?!！,.，。\s]*$/iu.test(text)) return false;
    if (/(?:帮我|代我|替我|如何|怎么)(?:来)?(?:生成|编写|设计|改写|优化|导出|保存)(?:访谈)?(?:问题|提纲|清单)|(?:如何|怎么)使用(?:这个)?(?:工具|系统|技能)|(?:how do i use|help me (?:write|generate|edit))/iu.test(text)) return false;
    return /[？?]|(?:能否|怎样|如何|什么|哪[一件次个]|什么时候|请(?:回想|回忆|描述|介绍|说说))/u.test(text);
  });
  const captureOpening = openingHasQuestion && !current.original && !current.consent && !current.guideConfirmed && userText.length <= 1000;
  const guide = !current.guideConfirmed && (Boolean(current.original) || captureOpening) && data?.questions;
  const adopted = guide ? guide.join("\n") : current.adopted;
  const goal = guide && data.goal ? data.goal : current.goal;
  const original = captureOpening ? userText : current.original;
  const saved = { ...current, adopted, goal, original, draftTurnId: turn.messageId };
  const fields = { ...draft.fields };
  let cards = draft.discoveryCards;
  let changed = original !== current.original || adopted !== current.adopted || goal !== current.goal;
  if (data?.finding && current.consent?.notes && fields["interviewConfirmed:" + entityId] !== "true") {
    const source = sourceShape.safeParse(json(fields["interviewTranscript:" + entityId]));
    const attached = source.success && source.data.sourceKey.startsWith("interviewMaterial:" + entityId + ":") ? materialShape.safeParse(json(fields[source.data.sourceKey])) : null;
    const canQuote = source.success && attached?.success && !attached.data.mime.startsWith("image/") && (!attached.data.mime.startsWith("audio/") || current.consent.audio === true);
    const prior = cards?.find(card => card.id === entityId);
    const next = prior ? { ...prior } : { id: entityId, participantCode: current.code, headlineKind: "student-summary" as const, headline: "", quote: "", context: "", sourceRef: "", photoRef: "" };
    const f = data.finding;
    if (f.headline && userText.includes(f.headline)) { next.headline = f.headline; next.headlineKind = "student-summary"; }
    if (f.context && userText.includes(f.context)) next.context = f.context;
    if (f.quote && source.success && canQuote && source.data.text.includes(f.quote)) next.quote = f.quote;
    const interpretationKey = "interviewInterpretation:" + entityId;
    if (f.interpretation && userText.includes(f.interpretation) && fields[interpretationKey] !== f.interpretation) {
      fields[interpretationKey] = f.interpretation; changed = true;
    }
    if ((next.headline || next.context || next.quote) && JSON.stringify(next) !== JSON.stringify(prior)) {
      cards = prior ? cards!.map(card => card.id === entityId ? next : card) : [...(cards ?? []), next];
      changed = true;
    }
  }
  if (!changed) return null;
  fields[key] = JSON.stringify(saved);
  if (fields[key].length > 6000 || Object.keys(fields).length > 100 || (cards?.length ?? 0) > 100) return null;
  return { ...draft, fields, ...(cards && { discoveryCards: cards }) };
}
