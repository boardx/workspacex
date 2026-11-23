import { aidtInterviewTitle } from "@repo/contracts/aidt-stages";
import { z } from "zod";
import type { AidtDiscoveryCardDraft, AidtUiStageDraft } from "./aidt-ui-drafts";
import { isAidtResearchImage, parseAidtResearchMaterial, researchMaterialKey, type AidtResearchMaterialReference } from "./aidt-research-material-reference";

const prefix = "interviewRecord:";
const recordKey = (id: string) => `${prefix}${id}`;
const confirmedKey = (id: string) => `interviewConfirmed:${id}`;
const archivedKey = (id: string) => `interviewArchived:${id}`;
const materialPrefix = (id: string) => `interviewMaterial:${id}:`;
const transcriptKey = (id: string) => `interviewTranscript:${id}`;

export const interviewTagsLimit = { maxTags: 8, maxTagLength: 24 };
const Interview = z.object({
  version: z.literal(1),
  kind: z.enum(["interview", "observation"]).optional(),
  id: z.string().uuid(),
  code: z.string().trim().min(1).max(32),
  draftTurnId: z.string().min(1).max(256).optional(),
  displayName: z.string().trim().max(80).optional(),
  tags: z.array(z.string().trim().min(1).max(interviewTagsLimit.maxTagLength)).max(interviewTagsLimit.maxTags).optional(),
  problemEntityId: z.string().uuid().optional(),
  topicRevision: z.number().int().positive().nullable(),
  topic: z.string().max(650),
  goal: z.string().max(250),
  original: z.string().max(1000),
  adopted: z.string().max(1000),
  guideProposalMessageId: z.string().min(1).max(256).optional(),
  guideConfirmedAfterMessageId: z.string().min(1).max(256).optional(),
  guideConfirmed: z.boolean(),
  consent: z.object({ observedAt: z.string().datetime(), notes: z.boolean(), photos: z.boolean(), audio: z.boolean().default(false), capture: z.boolean().optional(), asr: z.boolean().optional() }).nullable(),
});
export type AidtInterview = z.infer<typeof Interview>;
/** Missing kind is a legacy interview; reads never rewrite or migrate it. */
export const isAidtObservation = (record: Pick<AidtInterview, "kind">) => record.kind === "observation";

const audioMetadata = z.object({
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  durationMs: z.number().int().positive(),
  draftTranscript: z.string().max(1700),
  transcriptionStatus: z.enum(["complete", "incomplete"]).optional(),
});

export function readAidtInterviewAudio(fields: Readonly<Record<string, string>>, sourceKey: string) {
  return parse(audioMetadata, fields["captured:" + sourceKey]);
}

export function writeAidtInterviewAudio(draft: AidtUiStageDraft, id: string, sourceKey: string, source: AidtResearchMaterialReference, metadata: z.infer<typeof audioMetadata>) {
  const interview = parse(Interview, draft.fields[recordKey(id)]);
  if (!interview?.consent?.audio || !interview.consent.capture || !sourceKey.startsWith(materialPrefix(id)) || isAidtInterviewArchived(draft.fields, id)) return draft;
  const value = audioMetadata.safeParse({
    ...metadata,
    draftTranscript: interview.consent.asr ? metadata.draftTranscript : "",
    transcriptionStatus: interview.consent.asr ? metadata.transcriptionStatus : undefined,
  });
  if (!value.success || source.mime !== "audio/wav") return draft;
  const attached = writeAidtInterviewMaterial(draft, id, sourceKey, JSON.stringify(source));
  return { ...attached, fields: { ...attached.fields, ["captured:" + sourceKey]: JSON.stringify(value.data) } };
}

const Transcript = z.object({
  sourceKey: z.string(),
  locator: z.string().max(120),
  text: z.string().max(1700),
  checked: z.boolean(),
});
export type AidtInterviewTranscript = z.infer<typeof Transcript>;

function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, raw?: string): T | null {
  if (!raw) return null;
  try {
    const result = schema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function readAidtInterviews(fields: Readonly<Record<string, string>>) {
  return Object.entries(fields).flatMap(([key, raw]) => {
    if (!key.startsWith(prefix)) return [];
    const record = parse(Interview, raw);
    return record && key === recordKey(record.id) ? [record] : [];
  });
}

export function readAidtInterviewMaterials(fields: Readonly<Record<string, string>>, id: string, projectId?: string) {
  return Object.entries(fields).flatMap(([key, value]) => {
    if (!key.startsWith(materialPrefix(id))) return [];
    const reference = parseAidtResearchMaterial(value);
    return reference && (!projectId || reference.projectId === projectId) ? [{ key, reference }] : [];
  });
}

export function readAidtInterviewPhoto(draft: AidtUiStageDraft, interview: AidtInterview, projectId: string) {
  if (!interview.consent?.photos) return undefined;
  const selected = parseAidtResearchMaterial(draft.fields[researchMaterialKey("photo", interview.id)]);
  if (!selected || !isAidtResearchImage(selected)) return undefined;
  const identity = JSON.stringify(selected);
  return readAidtInterviewMaterials(draft.fields, interview.id, projectId).find(item => JSON.stringify(item.reference) === identity);
}

export function readAidtInterviewTranscript(fields: Readonly<Record<string, string>>, id: string) {
  return parse(Transcript, fields[transcriptKey(id)]);
}

export function writeAidtInterviewTranscript(draft: AidtUiStageDraft, id: string, transcript: AidtInterviewTranscript, projectId?: string) {
  const interview = parse(Interview, draft.fields[recordKey(id)]);
  const material = transcript.checked && projectId && readAidtInterviewMaterials(draft.fields, id, projectId).find(item => item.key === transcript.sourceKey);
  const finding = draft.discoveryCards?.find(card => card.id === id);
  if (interview?.consent?.notes && finding?.headline && material && transcript.text.trim() && transcript.locator.trim()
    && !material.reference.mime.startsWith("image/") && (!material.reference.mime.startsWith("audio/") || interview.consent.audio)
    && (!finding.quote || transcript.text.includes(finding.quote))) {
    draft = writeAidtInterviewFinding(draft, interview, { sourceRef: material.reference.name + " · " + transcript.locator });
  }
  return { ...draft, fields: { ...draft.fields, [transcriptKey(id)]: JSON.stringify(transcript), [confirmedKey(id)]: "" } };
}

export function writeAidtInterviewMaterial(draft: AidtUiStageDraft, id: string, key: string, raw: string) {
  if (!key.startsWith(materialPrefix(id))) return draft;
  const fields = { ...draft.fields, [confirmedKey(id)]: "" };
  if (raw) fields[key] = raw;
  else {
    const photoKey = researchMaterialKey("photo", id);
    const sourceKey = researchMaterialKey("source", id);
    const removed = fields[key];
    const removedPhoto = parseAidtResearchMaterial(removed);
    if (removedPhoto && JSON.stringify(parseAidtResearchMaterial(fields[photoKey])) === JSON.stringify(removedPhoto)) {
      delete fields[photoKey];
      draft = { ...draft, discoveryCards: (draft.discoveryCards ?? []).map(card => card.id === id ? { ...card, photoRef: "" } : card) };
    }
    if (removed && fields[sourceKey] === removed) delete fields[sourceKey];
    delete fields[key];
    delete fields["captured:" + key];
  }
  return { ...draft, fields };
}

export const aidtInterviewMaterialKey = (id: string, attachmentId: string) => `${materialPrefix(id)}${attachmentId}`;
export const isAidtInterviewArchived = (fields: Readonly<Record<string, string>>, id: string) => fields[archivedKey(id)] === "true";
export const isAidtInterviewConfirmed = (fields: Readonly<Record<string, string>>, id: string) => fields[confirmedKey(id)] === "true";

export function writeAidtInterview(draft: AidtUiStageDraft, interview: AidtInterview): AidtUiStageDraft {
  const current = parse(Interview, draft.fields[recordKey(interview.id)]);
  const value = Interview.safeParse(interview);
  if (current && value.success && isAidtObservation(current) !== isAidtObservation(value.data)) return draft;
  if (!value.success || readAidtInterviews(draft.fields).some(record => record.id !== interview.id
    && record.code.normalize("NFKC").toLowerCase() === value.data.code.normalize("NFKC").toLowerCase())) return draft;
  const payload = JSON.stringify(value.data);
  if (payload.length > 6000) return draft;
  const invalidate = current && (current.code !== value.data.code || current.topicRevision !== value.data.topicRevision || current.problemEntityId !== value.data.problemEntityId
    || !value.data.guideConfirmed || JSON.stringify(current.consent) !== JSON.stringify(value.data.consent));
  const fields = { ...draft.fields, [recordKey(interview.id)]: payload, ...(invalidate ? { [confirmedKey(interview.id)]: "" } : {}) };
  if (invalidate) delete fields[researchMaterialKey("source", interview.id)];
  if (!value.data.consent?.photos) delete fields[researchMaterialKey("photo", interview.id)];
  return {
    ...draft,
    fields,
    discoveryCards: (draft.discoveryCards ?? []).map(card => card.id === value.data.id ? {
      ...card,
      participantCode: value.data.code,
      photoRef: value.data.consent?.photos ? card.photoRef : "",
      photoAttachment: value.data.consent?.photos ? card.photoAttachment : undefined,
    } : card),
  };
}

export function getAidtInterviewFinding(draft: AidtUiStageDraft, interview: AidtInterview): AidtDiscoveryCardDraft {
  const existing = draft.discoveryCards?.find(card => card.id === interview.id);
  if (existing) return isAidtObservation(interview) ? { ...existing, headlineKind: "student-summary", quote: "" } : existing;
  return {
    id: interview.id,
    participantCode: interview.code,
    headlineKind: "student-summary",
    headline: "",
    context: "",
    quote: "",
    sourceRef: "",
    photoRef: "",
  };
}

export function hasAidtInterviewFinding(draft: AidtUiStageDraft, interview: AidtInterview) {
  const finding = getAidtInterviewFinding(draft, interview);
  return Boolean(interview.consent?.notes && (finding.headline || finding.context || finding.quote || draft.fields["interviewInterpretation:" + interview.id]));
}

export function savedAidtInterviewArtifactTitle(draft: AidtUiStageDraft | undefined, id: string | undefined) {
  if (!draft || !id || isAidtInterviewArchived(draft.fields, id)) return undefined;
  const interview = readAidtInterviews(draft.fields).find(item => item.id === id);
  return interview && (interview.adopted.trim() || hasAidtInterviewFinding(draft, interview))
    ? `${interview.code} · ${isAidtObservation(interview) ? "观察产物" : "访谈产物"}` : undefined;
}

export function writeAidtInterviewFinding(draft: AidtUiStageDraft, interview: AidtInterview, patch: Partial<AidtDiscoveryCardDraft>) {
  const card = { ...getAidtInterviewFinding(draft, interview), ...patch, id: interview.id, participantCode: interview.code,
    ...(isAidtObservation(interview) ? { headlineKind: "student-summary" as const, quote: "" } : {}),
  };
  return {
    ...draft,
    fields: { ...draft.fields, [confirmedKey(interview.id)]: "" },
    discoveryCards: [...(draft.discoveryCards ?? []).filter(item => item.id !== card.id), card],
  };
}

export function aidtInterviewFindingMissing(draft: AidtUiStageDraft, interview: AidtInterview, projectId?: string): string[] {
  const finding = getAidtInterviewFinding(draft, interview);
  const transcript = readAidtInterviewTranscript(draft.fields, interview.id);
  const observation = isAidtObservation(interview);
  const source = readAidtInterviewMaterials(draft.fields, interview.id, projectId)
    .find(material => material.key === transcript?.sourceKey && !material.reference.mime.startsWith("image/"));
  return [
    !interview.topicRevision && "从已确认的研究问题进入本卡，关联问题版本。",
    !interview.guideConfirmed && (observation ? "在聊天中勾选关注点并确认观察计划。" : "在聊天中确认访谈问题清单。"),
    !interview.consent?.notes && "在右侧「材料」记录实际的文字共享授权。",
    !finding.headline.trim() && "填写「一句发现」。",
    !finding.context.trim() && "填写「具体情况」。",
    (!source || !transcript?.checked || !transcript.locator.trim() || !transcript.text.trim()) &&
      (observation ? "在右侧「材料」选择观察原件、填写定位和摘录，并勾选已校对。" :
        "在右侧「录音与转录」选择原件、填写定位和摘录，并勾选已校对。"),
    source?.reference.mime.startsWith("audio/") && !interview.consent?.audio &&
      "在右侧「材料」记录实际的原始录音共享授权。",
    !!finding.quote.trim() && !!transcript?.text.trim() && !transcript.text.includes(finding.quote.trim()) &&
      "将「可定位的受访者原话」与已校对摘录对齐。",
    finding.headlineKind !== "student-summary" && finding.quote.trim() !== finding.headline.trim() &&
      "标题使用受访者原话时，需与已填写的原话一致。",
  ].filter((item): item is string => typeof item === "string");
}

export function aidtInterviewFindingReady(draft: AidtUiStageDraft, interview: AidtInterview, projectId?: string) {
  return aidtInterviewFindingMissing(draft, interview, projectId).length === 0;
}

export function confirmAidtInterviewFinding(draft: AidtUiStageDraft, id: string, projectId: string) {
  const interview = parse(Interview, draft.fields[recordKey(id)]);
  if (!interview || isAidtInterviewArchived(draft.fields, id) || !aidtInterviewFindingReady(draft, interview, projectId)) return draft;
  const transcript = readAidtInterviewTranscript(draft.fields, id)!;
  const source = readAidtInterviewMaterials(draft.fields, id, projectId).find(item => item.key === transcript.sourceKey)!;
  const linked = writeAidtInterviewFinding(draft, interview, {
    sourceRef: `${source.reference.name} · ${transcript.locator}`,
  });
  return { ...linked, fields: {
    ...linked.fields,
    [researchMaterialKey("source", id)]: JSON.stringify(source.reference),
    [confirmedKey(id)]: "true",
  } };
}

export function setAidtInterviewPhoto(draft: AidtUiStageDraft, interviewId: string, key: string, projectId: string) {
  const interview = parse(Interview, draft.fields[recordKey(interviewId)]);
  if (!interview?.consent?.photos || isAidtInterviewArchived(draft.fields, interviewId)) return draft;
  const material = readAidtInterviewMaterials(draft.fields, interview.id, projectId).find(item => item.key === key);
  if (key && (!material || !isAidtResearchImage(material.reference))) return draft;
  const next = writeAidtInterviewFinding(draft, interview, { photoRef: material?.reference.name ?? "" });
  const fields = { ...next.fields };
  const photoKey = researchMaterialKey("photo", interview.id);
  if (material) fields[photoKey] = JSON.stringify(material.reference);
  else delete fields[photoKey];
  return { ...next, fields };
}

export function archiveAidtInterview(draft: AidtUiStageDraft, id: string) {
  if (!draft.fields[recordKey(id)]) return draft;
  return { ...draft, fields: { ...draft.fields, [archivedKey(id)]: "true" } };
}

export function confirmedAidtInterviewCards(draft: AidtUiStageDraft) {
  return (draft.discoveryCards ?? []).filter(card => isAidtInterviewConfirmed(draft.fields, card.id) && !isAidtInterviewArchived(draft.fields, card.id));
}

export function areAidtInterviewsComplete(draft: AidtUiStageDraft, projectId: string) {
  const active = readAidtInterviews(draft.fields).filter(interview => !isAidtInterviewArchived(draft.fields, interview.id));
  const activeCount = Object.keys(draft.fields).filter(key => key.startsWith(prefix) && !isAidtInterviewArchived(draft.fields, key.slice(prefix.length))).length;
  return active.length > 0 && active.length === activeCount && active.every(interview =>
    isAidtInterviewConfirmed(draft.fields, interview.id) && aidtInterviewFindingReady(draft, interview, projectId));
}

export function aidtInterviewHandoffReady(draft: AidtUiStageDraft) {
  const interviews = readAidtInterviews(draft.fields);
  if (!interviews.length) return null;
  return confirmedAidtInterviewCards(draft).length > 0;
}


export function aidtInterviewDirectory(draft: AidtUiStageDraft) {
  return readAidtInterviews(draft.fields).map(record => ({
    id: record.id,
    title: aidtInterviewTitle(record.code, record.displayName),
    archived: isAidtInterviewArchived(draft.fields, record.id),
  }));
}

export function countAidtInterviewRecords(draft: AidtUiStageDraft) {
  return readAidtInterviews(draft.fields).length;
}
