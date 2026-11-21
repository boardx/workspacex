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

const audioMetadata = z.object({
  startedAt: z.string().datetime(),
  finishedAt: z.string().datetime(),
  durationMs: z.number().int().positive(),
  draftTranscript: z.string().max(1700),
});

export function readAidtInterviewAudio(fields: Readonly<Record<string, string>>, sourceKey: string) {
  return parse(audioMetadata, fields["captured:" + sourceKey]);
}

export function writeAidtInterviewAudio(draft: AidtUiStageDraft, id: string, sourceKey: string, source: AidtResearchMaterialReference, metadata: z.infer<typeof audioMetadata>) {
  const interview = parse(Interview, draft.fields[recordKey(id)]);
  if (!interview?.consent?.audio || !interview.consent.capture || !sourceKey.startsWith(materialPrefix(id)) || isAidtInterviewArchived(draft.fields, id)) return draft;
  const value = audioMetadata.safeParse({ ...metadata, draftTranscript: interview.consent.asr ? metadata.draftTranscript : "" });
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

export function readAidtInterviewTranscript(fields: Readonly<Record<string, string>>, id: string) {
  return parse(Transcript, fields[transcriptKey(id)]);
}

export function writeAidtInterviewTranscript(draft: AidtUiStageDraft, id: string, transcript: AidtInterviewTranscript) {
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
    if (removed && fields[photoKey] === removed) {
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
    } : card),
  };
}

export function getAidtInterviewFinding(draft: AidtUiStageDraft, interview: AidtInterview): AidtDiscoveryCardDraft {
  return draft.discoveryCards?.find(card => card.id === interview.id) ?? {
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
    ? `${interview.code} · 访谈产物` : undefined;
}

export function writeAidtInterviewFinding(draft: AidtUiStageDraft, interview: AidtInterview, patch: Partial<AidtDiscoveryCardDraft>) {
  const card = { ...getAidtInterviewFinding(draft, interview), ...patch, id: interview.id, participantCode: interview.code };
  return {
    ...draft,
    fields: { ...draft.fields, [confirmedKey(interview.id)]: "" },
    discoveryCards: [...(draft.discoveryCards ?? []).filter(item => item.id !== card.id), card],
  };
}

export function aidtInterviewFindingReady(draft: AidtUiStageDraft, interview: AidtInterview, projectId?: string) {
  const finding = getAidtInterviewFinding(draft, interview);
  const transcript = readAidtInterviewTranscript(draft.fields, interview.id);
  return Boolean(interview.topicRevision && interview.guideConfirmed && interview.consent?.notes
    && finding.headline.trim() && finding.context.trim() && transcript?.checked && transcript.locator.trim() && transcript.text.trim()
    && readAidtInterviewMaterials(draft.fields, interview.id, projectId).some(material => material.key === transcript.sourceKey
      && !material.reference.mime.startsWith("image/")
      && (!material.reference.mime.startsWith("audio/") || interview.consent?.audio))
    && (!finding.quote.trim() || transcript.text.includes(finding.quote.trim()))
    && (finding.headlineKind === "student-summary" || finding.quote.trim() === finding.headline.trim()));

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

export function setAidtInterviewPhoto(draft: AidtUiStageDraft, interview: AidtInterview, key: string, projectId: string) {
  if (!interview.consent?.photos) return draft;
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
    title: record.code,
    archived: isAidtInterviewArchived(draft.fields, record.id),
  }));
}

export function countAidtInterviewRecords(draft: AidtUiStageDraft) {
  return readAidtInterviews(draft.fields).length;
}
