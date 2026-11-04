import { RECORDING_DISPLAY_ZH, formatRecordingDisplayCopy } from "@/lib/recording-display-copy";

/**
 * rec-v2 补画三屏的 mock 数据 —— 准备室（逐人×三项授权矩阵）/ 处理状态 / 逐字稿校对。
 *
 * ⚠ 这三屏原型里都在（准备室 16088061 / 处理状态 16121854 / 逐字稿校对 16125909），
 *   v1 却把它们的**结论**展示了、把**产生结论的那一屏**丢了：
 *     · 「授权 3/4」徽标被展示，而逐人×三项的授权矩阵屏根本不存在（塌成布尔 authComplete）；
 *     · 六个处理任务被一个「处理中」盖住，看不到「失败不阻塞其它任务」；
 *     · 逐字稿只有只读结果，没有「播放器 + 改词 + 确认后才进证据库」的校对交互。
 *   本文件按原型逐字复刻，注明「待迁入 packages/contracts」。
 *
 * ⚠ 契约缺口（待迁入 packages/contracts · rec 授权/处理域）：
 *   · AuthzGrant（逐人授权：录音 | 转录 | AI 分析 三项独立三态）—— 契约只有布尔 authComplete
 *   · ProcessingTask（处理任务：独立状态 + 失败不阻塞 + 可重试）—— 契约未建模
 *   · TranscriptReviewItem（低置信改词 / 发言人不确定 的行内决策）—— 契约未建模
 *
 * ⚠ 命名自洽：原型「准备室」把 P-10 标为 Weber、P-12 为匿名未签；而既有 rec.ts 的 SPEAKERS 里
 *   P-10=陈涛、Weber=P-13。这是**原型自身**在两屏用了不同编号，本文件忠实复刻准备室屏的编号，
 *   并在 README「界面上无法自洽的点」里点名，交人类裁决，**不擅自统一**。
 */

/* ─────────────────────── 准备室 · 逐人 × 三项授权矩阵（16088061）─────────────────────── */

export type AuthzValue = "allow" | "deny" | "pending";
export const AUTHZ_LABEL: Record<AuthzValue, string> = {
  allow: RECORDING_DISPLAY_ZH["rec.project.auth.allow"],
  deny: RECORDING_DISPLAY_ZH["rec.project.auth.deny"],
  pending: RECORDING_DISPLAY_ZH["rec.project.auth.pending"],
};
export const AUTHZ_COLS = ["record", "transcribe", "aiAnalysis"] as const;
export type AuthzCol = (typeof AUTHZ_COLS)[number];
export const AUTHZ_COL_LABEL: Record<AuthzCol, string> = {
  record: RECORDING_DISPLAY_ZH["rec.project.consentLabel.record"],
  transcribe: RECORDING_DISPLAY_ZH["rec.project.tasks.transcribe"],
  aiAnalysis: RECORDING_DISPLAY_ZH["rec.project.auth.aiAnalysis"],
};

export interface PrepParticipant {
  id: string;
  name: string;
  /** 三项各自的授权取值 —— 逐人配置，不强制全场统一 */
  authz: Record<AuthzCol, AuthzValue>;
  /** 拒绝 AI 分析等特例的一句话后果说明（原型 Weber 段） */
  note?: string;
}

export const PREP_PARTICIPANTS: PrepParticipant[] = [
  {
    id: "p-10", name: "P-10 Weber",
    authz: { record: "allow", transcribe: "allow", aiAnalysis: "deny" },
    note: "Weber 同意录音与转录，但拒绝 AI 分析：他的发言只进逐字稿，不参与主题归纳与证据强度计算，报告里只能作为直接引述出现。",
  },
  {
    id: "p-11", name: "P-11 Kraus",
    authz: { record: "allow", transcribe: "allow", aiAnalysis: "allow" },
  },
  {
    id: "p-12", name: "P-12 匿名",
    authz: { record: "pending", transcribe: "pending", aiAnalysis: "pending" },
    note: "P-12 未签前，开始按钮不可用。",
  },
];

/** 未完成授权（任意一项为 pending）的人数 —— 决定「开始」按钮可用性。 */
export const PREP_INCOMPLETE = PREP_PARTICIPANTS.filter((p) =>
  AUTHZ_COLS.some((c) => p.authz[c] === "pending"),
);
export const PREP_CAN_START = PREP_INCOMPLETE.length === 0;

/** 设备与转录检查（四项，含未采样） */
export type CheckState = "ok" | "warn";
export interface PrepCheck { id: string; label: string; state: CheckState; }
export const PREP_CHECKS: PrepCheck[] = [
  { id: "mic", label: RECORDING_DISPLAY_ZH["rec.project.checks.mic"], state: "ok" },
  { id: "storage", label: RECORDING_DISPLAY_ZH["rec.project.checks.storage"], state: "ok" },
  { id: "lang", label: RECORDING_DISPLAY_ZH["rec.project.checks.lang"], state: "ok" },
  { id: "voiceprint", label: RECORDING_DISPLAY_ZH["rec.project.checks.voiceprint"], state: "warn" },
];

/** 发言人标签（校准态） */
export interface PrepSpeakerLabel { id: string; name: string; calibrated: boolean; }
export const PREP_SPEAKER_LABELS: PrepSpeakerLabel[] = [
  { id: "host", name: "主持人 林可", calibrated: true },
  { id: "p-10", name: "P-10 Weber", calibrated: true },
  { id: "p-11", name: "P-11 Kraus", calibrated: true },
  { id: "p-12", name: "P-12 匿名", calibrated: false },
];

/** 材料与原型（准备室右栏底部） */
export const PREP_MATERIALS = ["责任归属清单原型 v3", "三条路径对比一页纸"];

export const PREP_META = {
  title: RECORDING_DISPLAY_ZH["rec.project.prep.title"],
  startDisabledLabel: RECORDING_DISPLAY_ZH["rec.project.prep.startDisabled"],
  startEnabledLabel: RECORDING_DISPLAY_ZH["rec.project.prep.start"],
  footnote: RECORDING_DISPLAY_ZH["rec.project.prep.footnote"],
} as const;

/* ─────────────────────── 处理状态 · 六任务独立报状态（16121854）─────────────────────── */

export type TaskState = "done" | "running" | "failed" | "blocked";
export const TASK_STATE_LABEL: Record<TaskState, string> = {
  done: RECORDING_DISPLAY_ZH["rec.project.state.done"],
  running: RECORDING_DISPLAY_ZH["rec.project.state.running"],
  failed: RECORDING_DISPLAY_ZH["rec.project.state.failed"],
  blocked: RECORDING_DISPLAY_ZH["rec.project.state.blocked"],
};

export interface ProcessingTask {
  id: string;
  label: string;
  state: TaskState;
  /** 右侧的定量说明（412 MB · 完成 / 1,284 句 · 完成 …） */
  detail: string;
  /** 失败任务的补充说明 + 可重试 */
  failNote?: string;
  retryable?: boolean;
}

export const PROCESSING_TASKS: ProcessingTask[] = [
  { id: "upload", label: RECORDING_DISPLAY_ZH["rec.project.tasks.upload"], state: "done", detail: formatRecordingDisplayCopy("rec.project.taskDetail.upload", { amount: "412 MB" }) },
  { id: "transcribe", label: RECORDING_DISPLAY_ZH["rec.project.tasks.transcribe"], state: "done", detail: formatRecordingDisplayCopy("rec.project.taskDetail.transcribe", { count: "1,284" }) },
  { id: "diarize", label: RECORDING_DISPLAY_ZH["rec.project.tasks.diarize"], state: "running", detail: formatRecordingDisplayCopy("rec.project.taskDetail.diarize", { percent: 92, count: 14 }) },
  { id: "mask", label: RECORDING_DISPLAY_ZH["rec.project.tasks.mask"], state: "done", detail: formatRecordingDisplayCopy("rec.project.taskDetail.mask", { count: 3 }) },
  {
    id: "translate", label: RECORDING_DISPLAY_ZH["rec.project.tasks.translate"], state: "failed", detail: formatRecordingDisplayCopy("rec.project.taskDetail.translate", { attempt: 3 }),
    failNote: formatRecordingDisplayCopy("rec.project.taskFailNote", { attempt: 3 }), retryable: true,
  },
  { id: "summary", label: RECORDING_DISPLAY_ZH["rec.project.tasks.summary"], state: "blocked", detail: RECORDING_DISPLAY_ZH["rec.project.taskDetail.summary"] },
];

export const PROCESS_META = {
  title: RECORDING_DISPLAY_ZH["rec.project.process.title"],
  failedBadge: RECORDING_DISPLAY_ZH["rec.project.process.failed"],
  principle: RECORDING_DISPLAY_ZH["rec.project.process.principle"],
} as const;

/* ─────────────────────── 逐字稿校对 · 播放器 + 改词 + 进证据库（16125909）─────────────────────── */

export interface VerifyNavSpeaker { id: string; name: string; pct: number; tone: "person" | "host" | "uncertain"; count?: number; }
export const VERIFY_NAV_SPEAKERS: VerifyNavSpeaker[] = [
  { id: "p-10", name: "P-10 Weber", pct: 61, tone: "person" },
  { id: "host", name: "林可", pct: 27, tone: "host" },
  { id: "uncertain", name: RECORDING_DISPLAY_ZH["rec.project.verify.uncertainSpeaker"], pct: 0, tone: "uncertain", count: 14 },
];
export const VERIFY_CHAPTERS = [
  { id: "bg", name: "背景与现状", active: false },
  { id: "decision", name: "采购决策过程", active: true },
  { id: "vendor", name: "供应商比选", active: false },
];
export const VERIFY_MARKS = [
  { id: "quote", label: RECORDING_DISPLAY_ZH["rec.project.quote.130"], count: 11 },
  { id: "pain", label: RECORDING_DISPLAY_ZH["rec.project.verify.painMarker"], count: 6 },
];

/** 逐字稿段：普通 / 低置信改词 / 发言人不确定 三类，各有行内决策出口。 */
export type VerifyItemKind = "plain" | "low-confidence" | "speaker-uncertain";
export interface VerifyItem {
  id: string;
  tc: string;
  speaker?: string;
  kind: VerifyItemKind;
  text: string;
  /** low-confidence：标注的专有名词 + 置信度 + 三个出口 */
  lowConf?: { term: string; score: string; actions: string[] };
  /** speaker-uncertain：两人重叠 + 三个出口 */
  speakerUncertain?: { note: string; actions: string[] };
}

export const VERIFY_ITEMS: VerifyItem[] = [
  {
    id: "v-1", tc: "00:31:04", speaker: "P-10 Weber", kind: "plain",
    text: "采购委员会最后卡的不是价格，是没人愿意为「万一出问题谁负责」签字。",
  },
  {
    id: "v-2", tc: "00:32:05", kind: "low-confidence",
    text: "我们法务只认 Vertragswerk。",
    lowConf: { term: "Vertragswerk", score: "0.42", actions: [RECORDING_DISPLAY_ZH["rec.project.correction.listen"], RECORDING_DISPLAY_ZH["rec.project.correction.replace"], RECORDING_DISPLAY_ZH["rec.project.correction.keep"]] },
  },
  {
    id: "v-3", tc: "00:32:30", kind: "speaker-uncertain",
    text: "…那次其实我们也试过，但权限一直对不上。",
    speakerUncertain: { note: RECORDING_DISPLAY_ZH["rec.project.verify.overlapHint"], actions: [RECORDING_DISPLAY_ZH["rec.project.correction.weber"], RECORDING_DISPLAY_ZH["rec.project.correction.kraus"], RECORDING_DISPLAY_ZH["rec.project.correction.split"]] },
  },
];

/** 右栏 AI 识别的主题与证据（含「待你判断」附和处理） */
export interface VerifyTheme { id: string; name: string; meta: string; strength: "中" | "弱"; kind: "theme" | "judge"; actions?: string[]; note?: string; }
export const VERIFY_THEMES: VerifyTheme[] = [
  { id: "t-1", name: "责任无人承担", meta: "3 条引述 · 1 个具体流程 · 强度：中", strength: "中", kind: "theme", actions: [RECORDING_DISPLAY_ZH["rec.project.correction.confirm"], RECORDING_DISPLAY_ZH["rec.project.correction.rename"]] },
  { id: "t-2", name: "法务是隐形门槛", meta: "1 条引述 · 待追问 · 强度：弱", strength: "弱", kind: "theme" },
  { id: "t-3", name: RECORDING_DISPLAY_ZH["rec.project.verify.reviewNeeded"], meta: "", strength: "弱", kind: "judge", note: "Kraus 的「对，我们也是这样」算不算独立证据？默认按附和处理，不计入强度。" },
];

export const VERIFY_META = {
  title: RECORDING_DISPLAY_ZH["rec.project.verify.title"],
  pendingBadge: RECORDING_DISPLAY_ZH["rec.project.verify.pending"],
  commitLabel: RECORDING_DISPLAY_ZH["rec.project.verify.commit"],
  duration: "31:04 / 68:12",
  progressPct: 47,
  evidenceNote: RECORDING_DISPLAY_ZH["rec.project.verify.evidence"],
} as const;
