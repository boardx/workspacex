import type { SharedStageValue } from "@repo/contracts/aidt-stages";
import { isAidtCandidateRequest } from "@repo/contracts/aidt-candidate-request";
import { AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX, AidtSavedSyntheticAsrSchema } from "@repo/contracts/aidt-test-research";
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
  const headings = /^#{2,4} (访谈问题清单|人物发现卡|观察计划|观察关注点清单|观察发现卡)[（(]草稿[）)][ \t]*$/u;
  const questions: string[] = [];
  const finding: Record<string, string> = {};
  const labels: Record<string, string> = { "一句发现": "headline", "一句观察发现": "headline", "具体情况": "context", "观察情况": "context", "学生的解释": "interpretation", "受访者原话": "quote" };
  let section = "", goal = "", fenced = false;
  for (const line of text.split(/\r?\n/)) {
    if (line.trimStart().startsWith("```")) { fenced = !fenced; section = ""; continue; }
    if (fenced) continue;
    const title = headings.exec(line.trim());
    if (title) { section = ["观察计划", "观察关注点清单"].includes(title[1]!) ? "访谈问题清单" : title[1] === "观察发现卡" ? "人物发现卡" : title[1]!; continue; }
    if (!line.trim()) continue;
    const field = /^(研究重点|观察重点|观察关注点|一句发现|一句观察发现|具体情况|观察情况|学生的解释|受访者原话)[：:]\s*(.+)$/u.exec(line.trim());
    const bullet = /^(?:[-*] |\d+[.)、]\s*)(.+)$/u.exec(line.trim());
    if (section === "访谈问题清单" && field && ["研究重点", "观察重点", "观察关注点"].includes(field[1]!)) goal = field[2]!;
    else if (section === "访谈问题清单" && bullet) questions.push(bullet[1]!);
    else if (section === "人物发现卡" && field && labels[field[1]!]) finding[labels[field[1]!]!] = field[2]!;
    else section = "";
  }
  if (!questions.length && !Object.keys(finding).length) return null;
  const parsed = draftPatch.safeParse({ ...(goal && { goal }), ...(questions.length && { questions }), ...(Object.keys(finding).length && { finding }) });
  return parsed.success ? parsed.data : null;
}

type Draft = SharedStageValue["content"]["draft"];
type Turn = { verifiedFindingText?: readonly string[]; projectId?: string; user: string; assistant: string; messageId: string };
const recordShape = z.object({
  id: z.string().uuid(), version: z.literal(1), code: z.string().min(1).max(32), original: z.string(),
  adopted: z.string(), goal: z.string(), guideConfirmed: z.boolean(), consent: z.object({ notes: z.boolean() }).passthrough().nullable(),
}).passthrough();
const sourceShape = z.object({ checked: z.literal(true), text: z.string().trim().min(1).max(1700), locator: z.string().trim().min(1).max(120), sourceKey: z.string() });
const materialShape = z.object({ mime: z.string().min(1), name: z.string().min(1).max(300), artifactId: z.string().min(1), versionId: z.string().min(1), projectId: z.string().min(1) });
function json(raw: string | undefined): unknown { try { return JSON.parse(raw ?? ""); } catch { return null; } }

/** A saved marker never turns synthetic audio into participant evidence, even if damaged or revoked. */
export function interviewSyntheticAsrContext(fields: Draft["fields"], entityId: string, projectId: string) {
  const raw = fields[AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX + entityId];
  const transcript = sourceShape.extend({ checked: z.boolean() }).safeParse(json(fields["interviewTranscript:" + entityId]));
  if (raw === undefined && !(transcript.success && transcript.data.locator.startsWith("合成软件测试 ASR"))) return;
  const interview = recordShape.safeParse(json(fields["interviewRecord:" + entityId]));
  const pin = raw && raw.length <= 6000 ? AidtSavedSyntheticAsrSchema.safeParse(json(raw)) : null;
  const material = transcript.success ? materialShape.passthrough().safeParse(json(fields[transcript.data.sourceKey])) : null;
  const matching = interview.success && interview.data.id === entityId && interview.data.consent?.notes
    && interview.data.consent.audio === true && fields["interviewArchived:" + entityId] !== "true"
    && transcript.success && transcript.data.sourceKey.startsWith("interviewMaterial:" + entityId + ":")
    && material?.success && material.data.projectId === projectId && material.data.mime.startsWith("audio/")
    && pin?.success && material.data.artifactId === pin.data.audio.artifactId && material.data.versionId === pin.data.audio.versionId
    && material.data.runId === pin.data.audio.runId && material.data.sha256 === pin.data.audio.sha256
    && transcript.data.locator === `合成软件测试 ASR V${pin.data.transcript.version}`;
  return { evidenceOrigin: "synthetic-file-asr" as const,
    status: matching ? "matching-saved-source-not-reverified" : "unavailable-or-mismatched",
    evidenceStatus: "合成音频软件 QA，不是真人访谈、用户原话或实际行为证据；保存的工具坐标未在本次上下文回源核验。",
    omissions: ["合成转写摘录及其发现正文不自动加入教学上下文；缺失、损坏、错源或撤权均不能按真人材料读取。"] };
}

/** Only the reviewed excerpt can reach the teaching Skill, never recording bytes or raw ASR. */
export function checkedInterviewExcerpt(fields: Draft["fields"], entityId: string, projectId: string) {
  if (interviewSyntheticAsrContext(fields,entityId,projectId)) return;
  const interview = recordShape.safeParse(json(fields["interviewRecord:" + entityId]));
  if (!interview.success || interview.data.id !== entityId || !interview.data.consent?.notes || fields["interviewArchived:" + entityId] === "true") return;
  const source = sourceShape.safeParse(json(fields["interviewTranscript:" + entityId]));
  if (!source.success || !source.data.sourceKey.startsWith("interviewMaterial:" + entityId + ":")) return;
  const material = materialShape.safeParse(json(fields[source.data.sourceKey]));
  if (!material.success || material.data.projectId !== projectId || material.data.mime.startsWith("image/")
    || (material.data.mime.startsWith("audio/") && interview.data.consent.audio !== true)) return;
  return { text: source.data.text, locator: source.data.locator, name: material.data.name };
}

/** Run completion owns automatic drafts. Caller authenticates the pinned Skill, thread, turn and stage before calling. */
export function projectInterviewSkillDraft(draft: Draft, entityId: string, turn: Turn): Draft | null {
  // This explicit human action requests transient candidates, never a saved stage draft.
  if (isAidtCandidateRequest(turn.user, "interview")
    || (isAidtCandidateRequest(turn.user, "test") && /^合成音频转写请求：[0-9a-f-]{36}$/u.test(turn.user.trim().split(/\r?\n/u)[1] ?? ""))) return null;
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
    const source = turn.projectId ? checkedInterviewExcerpt(fields, entityId, turn.projectId) : undefined;
    const prior = cards?.find(card => card.id === entityId);
    const next = prior ? { ...prior } : { id: entityId, participantCode: current.code, headlineKind: "student-summary" as const, headline: "", quote: "", context: "", sourceRef: "", photoRef: "" };
    const f = data.finding;
    const studentWrote = (value: string) => userText.includes(value) || turn.verifiedFindingText?.includes(value);
    if (f.headline && studentWrote(f.headline)) { next.headline = f.headline; next.headlineKind = "student-summary"; }
    if (f.context && studentWrote(f.context)) next.context = f.context;
    if (current.kind !== "observation" && f.quote && source?.text.includes(f.quote)) {
      next.quote = f.quote;
      next.sourceRef = source.name + " · " + source.locator;
    }
    const interpretationKey = "interviewInterpretation:" + entityId;
    if (f.interpretation && studentWrote(f.interpretation) && fields[interpretationKey] !== f.interpretation) {
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
