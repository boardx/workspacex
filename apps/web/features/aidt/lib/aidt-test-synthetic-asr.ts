import { AIDT_TEST_SYNTHETIC_ASR_PREFIX, AidtSavedSyntheticAsrSchema, type AidtSavedSyntheticAsr } from "@repo/contracts/aidt-test-research";
import type { AidtReviewedAudioTranscription } from "./aidt-synthetic-audio-transcription";
import { aidtTestResearchPath } from "./aidt-test-research";
import { updateAidtTestGroup, type AidtTestGroup } from "./aidt-test-groups";
import type { AidtUiStageDraft } from "./aidt-ui-drafts";

export function aidtSyntheticAsrMatches(group: AidtTestGroup, pin: AidtSavedSyntheticAsr) {
  const audio = group.material;
  return Boolean(aidtTestResearchPath(group) === "offline" && group.audioConsentAt && audio && audio.mime.startsWith("audio/")
    && audio.artifactId === pin.audio.artifactId && audio.versionId === pin.audio.versionId && audio.runId === pin.audio.runId && audio.sha256 === pin.audio.sha256);
}
export function readAidtSavedSyntheticAsr(draft: AidtUiStageDraft, group: AidtTestGroup): AidtSavedSyntheticAsr | null {
  const raw = draft.fields[AIDT_TEST_SYNTHETIC_ASR_PREFIX + group.id];
  if (!raw || raw.length > 6000 || group.evidenceOrigin !== "synthetic-file-asr") return null;
  try { const value = AidtSavedSyntheticAsrSchema.parse(JSON.parse(raw)); return aidtSyntheticAsrMatches(group, value) ? value : null; } catch { return null; }
}
export function aidtSavedSyntheticAsr(result: AidtReviewedAudioTranscription): AidtSavedSyntheticAsr {
  return AidtSavedSyntheticAsrSchema.parse({ kind: result.kind,
    audio: { artifactId: result.audioSource.artifactId, versionId: result.audioSource.versionId, runId: result.audioSource.runId, sha256: result.audioSource.sha256 },
    nativeAudio: result.nativeAudio, transcript: result.transcript, reviewedText: result.reviewedText, warnings: result.warnings,
  });
}
export function saveAidtSyntheticAsr(draft: AidtUiStageDraft, group: AidtTestGroup, pin: AidtSavedSyntheticAsr): AidtUiStageDraft {
  if (group.archived || !aidtSyntheticAsrMatches(group, pin)) return draft;
  const value = JSON.stringify(AidtSavedSyntheticAsrSchema.parse(pin)), key = AIDT_TEST_SYNTHETIC_ASR_PREFIX + group.id;
  if (value.length > 6000 || (!(key in draft.fields) && Object.keys(draft.fields).length >= 100)) return draft;
  const changed = updateAidtTestGroup(draft, { ...group, evidenceOrigin: "synthetic-file-asr", said: "", did: "", evidenceGap: "合成音频软件验收，不是真人访谈或真实行为证据。", sourceLocation: `合成 ASR ${pin.transcript.artifactId} V${pin.transcript.version}`.slice(0, 180) });
  return { ...changed, fields: { ...changed.fields, [key]: value, reflectionConfirmed: "" } };
}
export function aidtSyntheticAsrSourceKey(group: AidtTestGroup) {
  return JSON.stringify([group.id, group.researchPath ?? "offline", group.stage5Revision, group.prototypeEntity, group.designId, group.versionId, group.material, group.audioConsentAt, group.evidenceOrigin]);
}
