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
  allow: "允许",
  deny: "拒绝",
  pending: "待签",
};
export const AUTHZ_COLS = ["record", "transcribe", "aiAnalysis"] as const;
export type AuthzCol = (typeof AUTHZ_COLS)[number];
export const AUTHZ_COL_LABEL: Record<AuthzCol, string> = {
  record: "录音",
  transcribe: "转录",
  aiAnalysis: "AI 分析",
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
  { id: "mic", label: "麦克风 · 输入正常", state: "ok" },
  { id: "storage", label: "本地存储 · 可录 6.5 小时", state: "ok" },
  { id: "lang", label: "转录语言 · 德语→中文", state: "ok" },
  { id: "voiceprint", label: "声纹校准 · P-12 未采样", state: "warn" },
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
  title: "准备室 · 访谈 11",
  startDisabledLabel: "开始访谈 · 待 P-12 授权",
  startEnabledLabel: "开始访谈",
  footnote: "未完成授权前，系统不会开启录音、转录与任何 AI 分析。",
} as const;

/* ─────────────────────── 处理状态 · 六任务独立报状态（16121854）─────────────────────── */

export type TaskState = "done" | "running" | "failed" | "blocked";
export const TASK_STATE_LABEL: Record<TaskState, string> = {
  done: "完成",
  running: "进行中",
  failed: "失败",
  blocked: "等待前序",
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
  { id: "upload", label: "音频上传", state: "done", detail: "412 MB · 完成" },
  { id: "transcribe", label: "转录", state: "done", detail: "1,284 句 · 完成" },
  { id: "diarize", label: "发言人识别", state: "running", detail: "92% · 14 句待人工指派" },
  { id: "mask", label: "敏感信息遮盖", state: "done", detail: "3 处 · 完成" },
  {
    id: "translate", label: "德语→中文对照翻译", state: "failed", detail: "本地模型队列超时（第 3 次）",
    failNote: "本地模型队列超时（第 3 次）· 音频与原文不受影响", retryable: true,
  },
  { id: "summary", label: "AI 摘要与证据提取", state: "blocked", detail: "等翻译完成" },
];

export const PROCESS_META = {
  title: "处理状态 · 访谈 10（68 分钟）",
  failedBadge: "1 个任务失败",
  principle: "每个任务单独报状态，不用一个「处理中」盖住全部。失败任务不阻塞已完成的部分——你现在就可以去校对逐字稿。",
} as const;

/* ─────────────────────── 逐字稿校对 · 播放器 + 改词 + 进证据库（16125909）─────────────────────── */

export interface VerifyNavSpeaker { id: string; name: string; pct: number; tone: "person" | "host" | "uncertain"; count?: number; }
export const VERIFY_NAV_SPEAKERS: VerifyNavSpeaker[] = [
  { id: "p-10", name: "P-10 Weber", pct: 61, tone: "person" },
  { id: "host", name: "林可", pct: 27, tone: "host" },
  { id: "uncertain", name: "不确定", pct: 0, tone: "uncertain", count: 14 },
];
export const VERIFY_CHAPTERS = [
  { id: "bg", name: "背景与现状", active: false },
  { id: "decision", name: "采购决策过程", active: true },
  { id: "vendor", name: "供应商比选", active: false },
];
export const VERIFY_MARKS = [
  { id: "quote", label: "引述", count: 11 },
  { id: "pain", label: "痛点", count: 6 },
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
    lowConf: { term: "Vertragswerk", score: "0.42", actions: ["听这一段", "改为「合同文本」", "保留原词"] },
  },
  {
    id: "v-3", tc: "00:32:30", kind: "speaker-uncertain",
    text: "…那次其实我们也试过，但权限一直对不上。",
    speakerUncertain: { note: "发言人不确定 · 两人重叠", actions: ["指派 Weber", "指派 Kraus", "拆成两段"] },
  },
];

/** 右栏 AI 识别的主题与证据（含「待你判断」附和处理） */
export interface VerifyTheme { id: string; name: string; meta: string; strength: "中" | "弱"; kind: "theme" | "judge"; actions?: string[]; note?: string; }
export const VERIFY_THEMES: VerifyTheme[] = [
  { id: "t-1", name: "责任无人承担", meta: "3 条引述 · 1 个具体流程 · 强度：中", strength: "中", kind: "theme", actions: ["确认", "改名"] },
  { id: "t-2", name: "法务是隐形门槛", meta: "1 条引述 · 待追问 · 强度：弱", strength: "弱", kind: "theme" },
  { id: "t-3", name: "待你判断", meta: "", strength: "弱", kind: "judge", note: "Kraus 的「对，我们也是这样」算不算独立证据？默认按附和处理，不计入强度。" },
];

export const VERIFY_META = {
  title: "逐字稿校对 · 访谈 10",
  pendingBadge: "14 处待确认",
  commitLabel: "确认并入证据库",
  duration: "31:04 / 68:12",
  progressPct: 47,
  evidenceNote: "确认后逐字稿才进正式证据库；未确认的内容不会被其他 Studio 检索到。",
} as const;
