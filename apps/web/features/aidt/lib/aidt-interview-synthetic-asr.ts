import { AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX, AidtSavedSyntheticAsrSchema, type AidtSavedSyntheticAsr } from "@repo/contracts/aidt-test-research";
import { readAidtInterviews, readAidtInterviewMaterials, isAidtInterviewArchived, readAidtInterviewTranscript, writeAidtInterviewTranscript } from "./aidt-interviews";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";
import type { AidtReviewedAudioTranscription } from "./aidt-synthetic-audio-transcription";

export function aidtInterviewSyntheticAsrSlotId(projectId: string, entityId: string, materialKey: string): string {
  return `aidt-s2-synthetic-asr-${[projectId, entityId, materialKey].map(encodeURIComponent).join("--")}`;
}
export function aidtInterviewSyntheticAsrSourceKey(draft: AidtUiStageDraft, entityId: string, projectId: string, materialKey: string): string | null {
  const interview = readAidtInterviews(draft.fields).find(item => item.id === entityId);
  if (!interview?.consent?.notes || !interview.consent.audio || isAidtInterviewArchived(draft.fields, entityId)) return null;
  const material = readAidtInterviewMaterials(draft.fields, entityId, projectId).find(item => item.key === materialKey && item.reference.mime.startsWith("audio/"));
  return material ? JSON.stringify([projectId, entityId, interview.kind ?? "interview", interview.consent, interview.problemEntityId, interview.topicRevision, materialKey, material.reference]) : null;
}
export function aidtReviewedInterviewSyntheticAsr(result: AidtReviewedAudioTranscription): AidtSavedSyntheticAsr {
  return AidtSavedSyntheticAsrSchema.parse({ kind: result.kind,
    audio: { artifactId: result.audioSource.artifactId, versionId: result.audioSource.versionId, runId: result.audioSource.runId, sha256: result.audioSource.sha256 },
    nativeAudio: result.nativeAudio, transcript: result.transcript, reviewedText: result.reviewedText, warnings: result.warnings });
}
export function readAidtSavedInterviewSyntheticAsr(draft: AidtUiStageDraft, entityId: string, projectId: string): AidtSavedSyntheticAsr | null {
  const raw = draft.fields[AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX + entityId];
  if (!raw || raw.length > 6000) return null;
  try {
    const pin = AidtSavedSyntheticAsrSchema.parse(JSON.parse(raw));
    const transcript = readAidtInterviewTranscript(draft.fields, entityId);
    return readAidtInterviewMaterials(draft.fields, entityId, projectId).some(material => transcript?.sourceKey === material.key && material.reference.mime.startsWith("audio/")
      && !!aidtInterviewSyntheticAsrSourceKey(draft, entityId, projectId, material.key)
      && material.reference.artifactId === pin.audio.artifactId && material.reference.versionId === pin.audio.versionId
      && material.reference.runId === pin.audio.runId && material.reference.sha256 === pin.audio.sha256) ? pin : null;
  } catch { return null; }
}
/** Only an explicit save calls this; original audio remains untouched and calibration is still separate. */
export function saveAidtInterviewSyntheticAsr(draft: AidtUiStageDraft, entityId: string, projectId: string, materialKey: string, pin: AidtSavedSyntheticAsr): AidtUiStageDraft {
  if (!aidtInterviewSyntheticAsrSourceKey(draft, entityId, projectId, materialKey)) return draft;
  const material = readAidtInterviewMaterials(draft.fields, entityId, projectId).find(item => item.key === materialKey)?.reference;
  if (!material || material.artifactId !== pin.audio.artifactId || material.versionId !== pin.audio.versionId || material.runId !== pin.audio.runId || material.sha256 !== pin.audio.sha256) return draft;
  const parsed = AidtSavedSyntheticAsrSchema.safeParse(pin);
  if (!parsed.success) return draft;
  const changed = writeAidtInterviewTranscript(draft, entityId, { sourceKey: materialKey, locator: `合成软件测试 ASR V${pin.transcript.version}`, text: pin.reviewedText, checked: false }, projectId);
  const next = { ...changed, fields: { ...changed.fields, [AIDT_INTERVIEW_SYNTHETIC_ASR_PREFIX + entityId]: JSON.stringify(parsed.data) } };
  return Object.keys(next.fields).length <= 100 && Object.values(next.fields).every(value => value.length <= 6000) ? next : draft;
}
export function aidtInterviewSyntheticAsrLines(draft: AidtUiStageDraft, entityId: string, projectId: string): string[] {
  const pin = readAidtSavedInterviewSyntheticAsr(draft, entityId, projectId);
  return pin ? ["材料性质：合成音频软件 QA，不是真人访谈、用户原话或实际行为证据。",
    `原音频 ${pin.audio.artifactId} / 版本 ${pin.audio.versionId} / SHA256 ${pin.audio.sha256}`,
    `原生音频附件 ${pin.nativeAudio.attachmentId} / 消息 ${pin.nativeAudio.messageId}`,
    `实际转写 ${pin.transcript.artifactId} / V${pin.transcript.version} / SHA256 ${pin.transcript.sha256}`,
    `实际 run ${pin.transcript.producedByRunId} / 服务端产物 step 引用 ${pin.transcript.producedByStepId}`,
    "ASR 只提供转写；学生校对和当前摘录确认不代表真人研究已经验证。"] : [];
}
