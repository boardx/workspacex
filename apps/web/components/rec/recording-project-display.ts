import { RECORDING_DISPLAY_ZH } from "@/lib/recording-display-copy";
import type { useI18n } from "@/lib/i18n/provider";
import type { MessageKey } from "@/lib/i18n/messages";
import { speakerById, speakerDisplay, SESSION, TRACKS, VOICEPRINT, type RecView, type Carrier, type RecTrack } from "@/lib/mock/rec";

type Translate = ReturnType<typeof useI18n>["t"];
export const recordingTaskKeys: Readonly<Record<string, MessageKey>> = {
  upload: "rec.project.tasks.upload", transcribe: "rec.project.tasks.transcribe", diarize: "rec.project.tasks.diarize", mask: "rec.project.tasks.mask", translate: "rec.project.tasks.translate", summary: "rec.project.tasks.summary",
};
export const recordingCheckKeys: Readonly<Record<string, MessageKey>> = {
  mic: "rec.project.checks.mic", storage: "rec.project.checks.storage", lang: "rec.project.checks.lang", voiceprint: "rec.project.checks.voiceprint",
};
export const recordingTabKeys: Readonly<Record<string, MessageKey>> = {
  transcript: "rec.project.tabs.transcript", execution: "rec.project.tabs.execution", insight: "rec.project.tabs.insight", artifact: "rec.project.tabs.artifact", material: "rec.project.tabs.material",
};
export const recordingWithdrawalKeys: Readonly<Record<string, MessageKey>> = {
  "01": "rec.project.withdrawal.01", "02": "rec.project.withdrawal.02", "03": "rec.project.withdrawal.03", "04": "rec.project.withdrawal.04", "05": "rec.project.withdrawal.05",
};
export function recordingDisplay(t: Translate, keys: Readonly<Record<string, MessageKey>>, id: string, fallback: string) {
  return Object.hasOwn(keys, id) ? t(keys[id]!) : fallback;
}
/** Original names and aliases stay literal; only observer role labels are UI copy. */
export function recordingSpeakerDisplay(t: Translate, id: string | null, view: RecView): string {
  const speaker = speakerById(id);
  if (!speaker) return t("rec.project.source.needed");
  if (view !== "observer") return speakerDisplay(id, view);
  return t(speaker.role === "interviewee" ? "rec.project.role.interviewee" : speaker.role === "facilitator" ? "rec.project.role.facilitator" : speaker.role === "researcher" ? "rec.project.role.researcher" : "rec.project.role.member");
}
/** Translate units only; all durations and inequalities remain the canonical input. */
export function recordingSla(t: Translate, value: string): string {
  if (value === "即时") return t("rec.project.unit.immediate");
  if (value === "需人工") return t("rec.project.unit.human");
  return value.replace("分钟", t("rec.project.unit.minutes")).replace("天", t("rec.project.unit.days"));
}

export function recordingTaskDetail(t: Translate, task: { id: string; detail: string }): string {
  const numbers = task.detail.match(/\d[\d,]*/g) ?? [];
  switch (task.id) {
    case "upload": return t("rec.project.taskDetail.upload", { amount: task.detail.split(" · ")[0]! });
    case "transcribe": return numbers[0] ? t("rec.project.taskDetail.transcribe", { count: numbers[0] }) : task.detail;
    case "diarize": return numbers[0] && numbers[1] ? t("rec.project.taskDetail.diarize", { percent: numbers[0], count: numbers[1] }) : task.detail;
    case "mask": return numbers[0] ? t("rec.project.taskDetail.mask", { count: numbers[0] }) : task.detail;
    case "translate": return numbers[0] ? t("rec.project.taskDetail.translate", { attempt: numbers[0] }) : task.detail;
    case "summary": return t("rec.project.taskDetail.summary");
    default: return task.detail;
  }
}

export function recordingSync(t: Translate, value: string): string {
  if (value === SESSION.interview.lastSync) return t("rec.project.syncJustNow");
  const seconds = value.match(/^(\d+) 秒前$/)?.[1];
  return seconds ? t("rec.project.syncSecondsAgo", { count: Number(seconds) }) : value;
}
export function recordingTrackLabel(t: Translate, carrier: Carrier, track: RecTrack): string {
  const original = TRACKS[carrier].find(item => item.id === track.id);
  if (!original || track.label !== original.label) return track.label;
  if (carrier === "workshop") {
    const count = track.label.match(/^第 (\d+) 组$/)?.[1];
    return count ? t("rec.project.trackLabel.group", { count }) : track.label;
  }
  if (carrier === "thread") return t("rec.project.trackLabel.meeting");
  const name = track.label.slice(track.label.indexOf(" ") + 1);
  return track.id === "itr" ? t("rec.project.trackLabel.researcher", { name }) : t("rec.project.trackLabel.interviewee", { name });
}
export function recordingTrackNote(t: Translate, track: RecTrack): string {
  const original = Object.values(TRACKS).flat().find(item => item.status === track.status);
  if (!track.note || track.note !== original?.note) return track.note ?? "";
  const keys = { live: "rec.project.trackNote.live", buffering: "rec.project.trackNote.buffering", declined: "rec.project.trackNote.declined", muted: "rec.project.trackNote.muted" } as const;
  return Object.hasOwn(keys, track.status) ? t(keys[track.status as keyof typeof keys]) : track.note;
}
export function recordingVoiceprintNotice(t: Translate): string {
  const comparison = VOICEPRINT.note.match(/（(\d+) 天）/)?.[1];
  return comparison ? t("rec.project.voiceprint", { fallback: VOICEPRINT.fallbackDay, comparison }) : VOICEPRINT.note;
}

/** Translate a known state caption only; preserve unknown/custom values verbatim. */
export function recordingFixedDisplay(t: Translate, keys: Readonly<Record<string, keyof typeof RECORDING_DISPLAY_ZH>>, id: string, value: string): string {
  if (!Object.hasOwn(keys, id)) return value;
  const key = keys[id]!;
  return value === RECORDING_DISPLAY_ZH[key] ? t(key) : value;
}
