import { AIDT_CANDIDATE_ACTIONS, aidtInterviewFindingAiSourceField, readAidtInterviewFindingAiSource } from "@repo/contracts/aidt-candidate-request";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";
import { getAidtInterviewFinding, isAidtInterviewArchived, readAidtInterviews, readAidtInterviewMaterials, readAidtInterviewTranscript, writeAidtInterviewFinding } from "./aidt-interviews";

export type InterviewDiscoveryTurn = { id: string; role: string; content?: unknown };
export const interviewDiscoverySourceKey = aidtInterviewFindingAiSourceField;

/** Current authorized, checked material for this person; never a cross-person context bundle. */
export function interviewDiscoverySource(draft: AidtUiStageDraft, projectId: string, entityId: string): string | null {
  const interview = readAidtInterviews(draft.fields).find(item => item.id === entityId);
  const transcript = readAidtInterviewTranscript(draft.fields, entityId);
  if (!interview?.consent?.notes || isAidtInterviewArchived(draft.fields, entityId) || !interview.guideConfirmed || !transcript?.checked || !transcript.text.trim() || !transcript.locator.trim()) return null;
  const material = readAidtInterviewMaterials(draft.fields, entityId, projectId).find(item => item.key === transcript.sourceKey);
  if (!material || material.reference.mime.startsWith("image/") || material.reference.mime.startsWith("audio/") && !interview.consent.audio) return null;
  return JSON.stringify({ projectId, entityId, kind: interview.kind ?? "interview", consent: interview.consent, topic: interview.topic, topicRevision: interview.topicRevision, goal: interview.goal, transcript, material });
}

/** The prompt carries scope, not evidence or authority. The normal native bridge loads allowed context. */
export function interviewDiscoveryPrompt(entityId: string, requestId: string, observation = false): string {
  return `${AIDT_CANDIDATE_ACTIONS.interview}\n本次请求：${requestId}\n${observation ? "当前观察" : "当前访谈"}：${entityId}\n${observation ? "这是观察记录。请勿把观察称为访谈、受访者原话或心理动机；" : ""}请仅依据${observation ? "本次观察当前获准的对话与已校对记录" : "本受访者当前获准的访谈对话与已校对材料"}，归纳 1 至 3 个不同的一句发现候选，供我预览和选择。先检查我已经表达的发现，不编造动机，不概括整个人群。候选属于 AI 概括草稿，不是受访者原话或已经验证的事实。每个候选单独一行，格式“候选1：具体发现”，每项不超过 500 字。不要写人物发现卡（草稿）或访谈问题清单，不保存、不确认；材料不足时请直接说明缺少什么。`;
}

/** Accept only named, finite candidate lines from this action's real assistant reply. */
export function readInterviewDiscoveryCandidates(text: string): string[] {
  if (text.length > 6000 || text.includes("```")) return [];
  const entries = text.split(/\r?\n/u).flatMap(line => {
    const match = /^候选\s*([1-3])[：:]\s*(.{1,500})$/u.exec(line.trim());
    const value = match?.[2]?.trim();
    return value && !/[\u0000-\u001f\u007f]/u.test(value) ? [{ ordinal: match![1], value }] : [];
  });
  const values = entries.map(entry => entry.value);
  return values.length >= 1 && values.length <= 3 && new Set(values).size === values.length && new Set(entries.map(entry => entry.ordinal)).size === entries.length ? values : [];
}

export function interviewDiscoveryOrigin(draft: AidtUiStageDraft, id: string, projectId: string): string | null {
  const interview = readAidtInterviews(draft.fields).find(item => item.id === id);
  return interview ? readAidtInterviewFindingAiSource(draft.fields, id, projectId, getAidtInterviewFinding(draft, interview).headline)?.messageId ?? null : null;
}

/** An explicit student's choice changes only local editable text; normal group save remains separate. */
export function applyInterviewDiscoveryCandidate(draft: AidtUiStageDraft, input: {
  projectId: string; entityId: string; source: string; threadId: string; messageId: string; requestId: string; headline: string; expectedHeadline: string;
}): AidtUiStageDraft {
  if (interviewDiscoverySource(draft, input.projectId, input.entityId) !== input.source || !input.headline.trim() || input.headline.length > 500
    || !input.messageId || input.messageId.length > 256 || !input.threadId || input.threadId.length > 256) return draft;
  const interview = readAidtInterviews(draft.fields).find(item => item.id === input.entityId);
  const key = interviewDiscoverySourceKey(input.entityId);
  if (!interview || getAidtInterviewFinding(draft, interview).headline !== input.expectedHeadline || !Object.hasOwn(draft.fields, key) && Object.keys(draft.fields).length >= 100) return draft;
  const next = writeAidtInterviewFinding(draft, interview, { headlineKind: "student-summary", headline: input.headline });
  return { ...next, fields: { ...next.fields, [key]: JSON.stringify({ projectId: input.projectId, entityId: input.entityId, threadId: input.threadId, messageId: input.messageId, requestId: input.requestId, headline: input.headline, kind: "ai-summary-student-selected" }) } };
}
