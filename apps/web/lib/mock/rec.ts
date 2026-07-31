/**
 * `rec`（录音与转写）能力域的 mock 数据 —— UC-5.1 ~ UC-5.4，覆盖 F69~F79（11 feature / 31 点）。
 *
 * ⚠ 纯数据模块，**不带 `"use client"`**——同时被服务端页面与客户端子组件 import。
 * ⚠ 只写前端 + mock，绝不接后端。搜索不真过滤、指派不真回填、删除不真删、九态是静态陈列。
 *
 * ── 契约对齐（本文件最重要的纪律）──────────────────────────────────────
 * 转写段 = 架构的 `segments`（最小检索单元），时间码 = `anchors`（见 UC-5.1 R7 / R10）。
 * phase-00 `context-pack` 束已定死「AI 不得引用不在 Context Pack 中的证据」（F12 passing），
 * 所以引述锚点形态**必须与 `@repo/contracts/artifact` 的 `Anchor` / `SegmentKind` 对得上**。
 * 因此本文件**从契约 import 锚点/段模态的取值**，不另抄一份枚举（避免第 N 次「同一事实两处」）。
 *
 * ── 契约里还缺、我在此集中声明并标注「待迁入 packages/contracts」的 ────────────────
 *   · ~~SegmentStatus~~ —— **契约已建成**（`recording.SegmentStatus`），但取值与本地那份
 *     互有出入 ⇒ 已改名 `SegmentStatusView` 并登记 `CONTRACT_DIVERGENCES.D11`，等人裁
 *   · ~~PiiType~~ —— **契约已建成**（F72，`recording.PiiType`），本文件不再手抄，见下方 import。
 *   · 匿名声道（说话人 A/B/C）与「声道↔人映射」实体 —— diarization 产物，契约未建模
 *   · 材料保留期解析结果（项目覆盖值→组织默认值）—— thresholds.ts 标 known:false，数值待合规
 * 上述三组一旦契约补齐，此处应 `import` 之并删除本地副本。见 README 第二节。
 */
import { AnchorKind, SegmentKind, IngestionStatus, ArtifactSource } from "@repo/contracts/artifact";
import { recording as RecC } from "@repo/contracts";
import type { z } from "zod";

/* 证明与契约同源：这些取值直接来自契约，不是手抄。渲染 file-first 物化时用。 */
export const ANCHOR_KINDS = AnchorKind.options; // page/bbox/timecode/message-id/question-no/image-region
export const SEGMENT_KINDS = SegmentKind.options; // text/message/answer/audio-span
export const INGESTION_STATES = IngestionStatus.options;
export const ARTIFACT_SOURCES = ArtifactSource.options; // survey/conversation/interview/prototype-run/research-run/upload/ai-generated

/* ─────────────────────── 预览维度：屏 / 载体 / 视角 ─────────────────────── */

export type RecScreen =
  | "prep" | "live" | "process" | "verify" | "assign" | "annotate" | "retention";
// prep / process / verify 是本轮（rec-v2）补画的三屏：授权矩阵 / 处理状态 / 逐字稿校对。
// 它们原型早已存在（准备室 16088061 / 处理状态 16121854 / 逐字稿校对 16125909），
// v1 却把它们塌成一个布尔 authComplete / 一个「处理中」/ 一个只读结果——见 rec-v2/V1-WAS-WRONG.md。
export const REC_SCREENS: RecScreen[] = [
  "prep", "live", "process", "verify", "assign", "annotate", "retention",
];
export const REC_SCREEN_LABEL: Record<RecScreen, string> = {
  prep: "准备室 · 逐人授权",
  live: "实时转录",
  process: "处理状态",
  verify: "逐字稿校对",
  assign: "指派说话人",
  annotate: "引述与打点",
  retention: "回流与保留期",
};
export const REC_SCREEN_UC: Record<RecScreen, string> = {
  prep: "UC-5.1 R8 · 授权矩阵",
  live: "UC-5.1 · F69–F73",
  process: "UC-5.1 · 处理状态",
  verify: "UC-5.3 · 逐字稿校对",
  assign: "UC-5.2 · F74–F75",
  annotate: "UC-5.3 · F76–F77",
  retention: "UC-5.4 · F78–F79",
};
export function resolveRecScreen(raw: string | string[] | undefined): RecScreen {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return REC_SCREENS.includes(v as RecScreen) ? (v as RecScreen) : "live";
}

/** 三载体共享一套转写能力（UC-5.1 R1：source_type ∈ {workshop, interview, thread}）*/
export type Carrier = "workshop" | "interview" | "thread";
export const CARRIERS: Carrier[] = ["workshop", "interview", "thread"];
export const CARRIER_LABEL: Record<Carrier, string> = {
  workshop: "项目现场（四组并行）",
  interview: "访谈现场",
  thread: "对话线程",
};
export function resolveCarrier(raw: string | string[] | undefined): Carrier {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return CARRIERS.includes(v as Carrier) ? (v as Carrier) : "interview";
}

/**
 * 预览视角（UC-5.1/5.2 R5 列了多角色，每个都要能预览）。
 * ⚠ 视角切换是**预览手段**，真实权限在服务端（NestJS Guard + PostgreSQL RLS）。
 * 「受访者」是场景身份（UC-6.3 一次性令牌），此处作预览视角，只看自己的授权与撤回。
 */
export type RecView = "facilitator" | "groupLead" | "member" | "observer" | "interviewee";
export const REC_VIEWS: { id: RecView; label: string; note: string }[] = [
  { id: "facilitator", label: "引导师", note: "可发起、指派、标引述、确认 AI 打点" },
  { id: "groupLead", label: "组长", note: "被授权范围内参与，看与自身角色相关结果" },
  { id: "member", label: "组员", note: "参与本组，看本组转录；跨组不可见" },
  { id: "observer", label: "观察者", note: "仅已发布且授权允许时只读脱敏结果" },
  { id: "interviewee", label: "受访者", note: "只看自己的授权与撤回，看不到项目内部材料" },
];
export function resolveRecView(raw: string | string[] | undefined): RecView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return REC_VIEWS.some((r) => r.id === v) ? (v as RecView) : "facilitator";
}
export function canWriteRec(v: RecView): boolean {
  return v === "facilitator";
}
export function isReadOnlyRec(v: RecView): boolean {
  return v === "observer" || v === "interviewee";
}

/* ─────────────────────── 转写段模型（待迁入 packages/contracts）─────────────────────── */

/**
 * 转写段状态（展示层）。⚠ 原注释说「契约未建模」——**2026-07-31 起不再成立**：
 * 契约 `recording.SegmentStatus = ["partial","final","pending-manual","disputed"]` 已建成，
 * 与这里**四对四但各有一个对方没有的态**（这里有 `low-confidence`，契约有 `disputed`），
 * 两个都有 UC 出处 ⇒ 改名分离 + 登记 `CONTRACT_DIVERGENCES.D11`，**不自己选边**。
 *
 * 三种「不稳定态」一律不可被抽为引述（UC-5.1 R7 / UC-5.3 R7 硬约束）：
 */
export type SegmentStatusView =
  | "final" // 已定稿，可引述
  | "partial" // 正在识别（UC-5.1 R8 常驻控件③）——定稿前不可引述、不进检索与 AI 归纳
  | "low-confidence" // 识别置信度低·待校对（UC-5.1 E7 / UC-5.2 R5）
  | "pending-manual"; // 两人同时说话·待人工指派（O-13：不得静默归给单一说话人）

export const UNQUOTABLE_STATUSES: SegmentStatusView[] = ["partial", "low-confidence", "pending-manual"];
export function isQuotable(s: TranscriptSegment): boolean {
  return !UNQUOTABLE_STATUSES.includes(s.status);
}

/**
 * PII 五类（O-39 可执行最小集）—— **契约已建成**（F72，`recording.PiiType`），从契约派生，不手抄。
 * 手机号等联系方式加密存储（`pii_originals` 表，列级 GRANT）、界面只掩码——两件事分别落在
 * `apps/api/src/domain/recording/pii-mask.ts` 与本文件（本文件只管展示）。
 */
export type PiiType = z.infer<typeof RecC.PiiType>;
export const PII_TYPES = RecC.PiiType.options;
export const PII_LABEL: Record<PiiType, string> = {
  email: "邮箱地址",
  phone: "手机号",
  "id-card": "身份证号",
  "bank-card": "银行卡号",
  address: "详细住址",
};

/** 时间码 anchor —— 字段名与契约 `Anchor`（startMs/endMs）对齐，音频段 kind=audio-span。*/
export interface SegAnchor {
  kind: "timecode" | "message-id"; // 音频用 timecode；对话线程用 message-id（契约 AnchorKind 子集）
  startMs: number;
  endMs: number;
  /** 常驻显示的绝对时间码（原型：周宁 14:29:40）*/
  tc: string;
  /** 对话线程载体下的消息锚点 */
  messageId?: string;
}

/**
 * 证据性质（展示层）。⚠ 与契约 `recording.EvidenceNature` **语义 1:1、线上码不同**：
 * 契约取中文字面值 `["个人经历","二手转述","观点"]`，这里取英文码 + 中文 label。
 * ⇒ 改名分离 + 登记 `CONTRACT_DIVERGENCES.D12`。
 * ⚠ 这一条**建议按通则裁**（契约整体中英文混用且无成文规则），不要单独拍。
 */
export type EvidenceNatureView = "personal" | "secondhand" | "opinion";
export const EVIDENCE_NATURE_LABEL: Record<EvidenceNatureView, string> = {
  personal: "个人经历",
  secondhand: "二手转述",
  opinion: "观点",
};

export interface TranscriptSegment {
  id: string;
  /** 匿名声道（说话人 A/B/C）——diarization 产物，未指派前不猜真名（UC-5.1 R3 第 4 步）*/
  anonChannel: "A" | "B" | "C" | null;
  /** 指派后的真人 id（指向 SPEAKERS）；null = 出处待补（UC-5.2 R3 第 4 步）*/
  assignedTo: string | null;
  status: SegmentStatusView;
  anchor: SegAnchor;
  /** 遮盖后的展示文本（默认读接口只返回这个）*/
  maskedText: string;
  /** 该段命中的 PII 类型（就地显示「已自动遮盖」）*/
  pii?: PiiType[];
  /** 已被标为引述 */
  quote?: {
    rq: string | null; // 绑定的研究问题（UC-5.3 R3 第 3 步），可空
    nature: EvidenceNatureView;
  };
  /** AI 打点候选（origin: ai，落候选态，不进证据库直到人工确认）*/
  aiMoment?: {
    agent: string; // 如 Ava
    label: string; // 如 决策点
    basis: string; // [看洞察] 出口点开看到的依据片段
  };
  /** 重叠语音的候选说话人（两人同时说话，人工在他们之间指派或保持待指派）*/
  overlapCandidates?: string[];
  /** 外语场景：原文/译文两行（原型方向标注 德→中）*/
  original?: string;
}

/* ── 说话人 / 在场名单（候选只来自本场在场名单，无跨场次声纹比对）───────────── */

export interface Speaker {
  id: string;
  initials: string;
  realName: string;
  alias?: string; // 拒绝实名引用时用代称
  role: "facilitator" | "groupLead" | "member" | "interviewee" | "researcher";
  onsite: boolean; // 是否在本场在场名单（候选门槛）
  authComplete: boolean; // 授权未完成者不会被录音/转写（P-12 原型硬约束）
  consentRefusedRealname?: boolean;
}

export const SPEAKERS: Speaker[] = [
  { id: "sp-linke", initials: "林", realName: "林可", role: "researcher", onsite: true, authComplete: true },
  { id: "sp-zhouning", initials: "周", realName: "周宁", role: "facilitator", onsite: true, authComplete: true },
  { id: "sp-p10", initials: "P10", realName: "陈涛", alias: "P-10", role: "interviewee", onsite: true, authComplete: true },
  { id: "sp-p11", initials: "P11", realName: "Kraus", alias: "P-11", role: "interviewee", onsite: true, authComplete: true, consentRefusedRealname: true },
  { id: "sp-weber", initials: "W", realName: "Weber", alias: "P-13", role: "interviewee", onsite: true, authComplete: true, consentRefusedRealname: true },
  // 授权未完成：在名单但不会被录音/转写（原型 P-12），指派候选里应显式排除并给「去授权」出口
  { id: "sp-p12", initials: "P12", realName: "（未授权）", alias: "P-12", role: "interviewee", onsite: true, authComplete: false },
];
export function speakerById(id: string | null): Speaker | undefined {
  return id ? SPEAKERS.find((s) => s.id === id) : undefined;
}
export function speakerDisplay(id: string | null, view: RecView): string {
  const s = speakerById(id);
  if (!s) return "出处待补";
  if (view === "observer") {
    return s.role === "interviewee" ? "受访者" : s.role === "facilitator" ? "引导师" : s.role === "researcher" ? "研究员" : "参与者";
  }
  // 拒绝实名 → 一律用代称（与 entry.ts 同源口径）
  return s.consentRefusedRealname && s.alias ? s.alias : s.realName;
}
/** 指派候选：只来自本场在场名单，且授权已完成（无任何跨场次声纹比对）*/
export const ASSIGN_CANDIDATES = SPEAKERS.filter((s) => s.onsite && s.role === "interviewee");

/* ── 会话头部 / 实时状态（三载体不同，但共用一套字段）──────────────────── */

export const SESSION: Record<Carrier, {
  title: string; project: string; segment: string;
  connection: string; recording: string; elapsed: string; planned: string;
  latencySec: string; langDir: string | null; lastSync: string;
}> = {
  workshop: {
    title: "远洋 · 欧洲市场进入 · 现场推演", project: "欧洲市场进入", segment: "议程环节：机会发散",
    connection: "已连接", recording: "四组并行录音中", elapsed: "28:14", planned: "60:00",
    latencySec: "1.2s", langDir: null, lastSync: "3 秒前",
  },
  interview: {
    title: "第 3 组访谈 · 储能采购决策", project: "欧洲市场进入", segment: "议程环节：深访",
    connection: "已连接", recording: "录音中", elapsed: "34:12", planned: "60:00",
    latencySec: "1.8s", langDir: "德→中", lastSync: "刚刚",
  },
  thread: {
    title: "欧洲储能进入策略 · 假设梳理", project: "欧洲市场进入", segment: "对话线程",
    connection: "已连接", recording: "会议转录中", elapsed: "28:14", planned: "—",
    latencySec: "1.5s", langDir: null, lastSync: "1 秒前",
  },
};

/** 多路录音轨（AC1：4 路同时录不串台；含未录制 / 录制已暂停 / 麦克风关闭）*/
export type TrackStatus = "live" | "buffering" | "paused" | "declined" | "muted";
export interface RecTrack {
  id: string;
  label: string;
  status: TrackStatus;
  note?: string;
}
export const TRACKS: Record<Carrier, RecTrack[]> = {
  workshop: [
    { id: "g1", label: "第 1 组", status: "live", note: "实时 · 不串台" },
    { id: "g2", label: "第 2 组", status: "live", note: "实时 · 不串台" },
    { id: "g3", label: "第 3 组", status: "buffering", note: "断网 · 本地缓存中，恢复后补传并标缺口" },
    { id: "g4", label: "第 4 组", status: "declined", note: "拒绝麦克风 · 本路未录制，不产生转写段" },
  ],
  interview: [
    { id: "itv", label: "受访者 P-10", status: "live", note: "实时 · 不串台" },
    { id: "itr", label: "研究员 林可", status: "live", note: "实时 · 不串台" },
    { id: "w", label: "受访者 Weber", status: "muted", note: "已关闭麦克风 · 录制已暂停，缺口保留不拼接" },
  ],
  thread: [
    { id: "th", label: "会议音频", status: "live", note: "实时 · 不串台" },
  ],
};

export const TRACK_STATUS_LABEL: Record<TrackStatus, string> = {
  live: "录制中",
  buffering: "断网缓存",
  paused: "已暂停",
  declined: "未录制（拒绝麦克风）",
  muted: "已关麦（录制已暂停）",
};

/* ── 右栏五标签（UC-5.1 R8：转录 / 执行 / 洞察 / 产物 / 材料）─────────────── */
export const RIGHT_TABS: { id: string; label: string; count: number | null }[] = [
  { id: "transcript", label: "转录", count: null },
  { id: "execution", label: "执行", count: 2 },
  { id: "insight", label: "洞察", count: 6 },
  { id: "artifact", label: "产物", count: 3 },
  { id: "material", label: "材料", count: 12 }, // 第五标签叫「材料」不是「来源」，testid 用 material
];

/* ─────────────────────── UC-5.1 逐字稿（实时转录屏）─────────────────────── */

const A = (startMs: number, endMs: number, tc: string): SegAnchor => ({ kind: "timecode", startMs, endMs, tc });

export const TRANSCRIPT: TranscriptSegment[] = [
  {
    id: "seg-01", anonChannel: "A", assignedTo: "sp-zhouning", status: "final",
    anchor: A(1_770_000, 1_782_000, "29:30"),
    maskedText: "我们先把欧洲三个候选市场的进入门槛过一遍，德国的补贴细则去年改过。",
  },
  {
    id: "seg-02", anonChannel: "B", assignedTo: "sp-p10", status: "final",
    anchor: A(1_782_000, 1_799_000, "29:42"),
    maskedText: "从我们上个项目的经验看，德国的并网审批周期是最长的，差不多要 14 个月。",
    quote: { rq: "RQ2", nature: "personal" },
  },
  {
    id: "seg-03", anonChannel: "B", assignedTo: "sp-p10", status: "final",
    anchor: A(1_799_000, 1_820_000, "29:59"),
    maskedText: "如果要联系当地并网负责人，可以发到 已自动遮盖 或打 已自动遮盖。",
    pii: ["email", "phone"],
  },
  {
    id: "seg-04", anonChannel: "C", assignedTo: null, status: "final",
    anchor: A(1_820_000, 1_836_000, "30:20"),
    maskedText: "波兰的补贴反而更激进，但政策连续性存疑，我个人不太看好三年以上的稳定性。",
    original: "Der polnische Zuschuss ist aggressiver, aber die Kontinuität ist fraglich.",
  },
  {
    id: "seg-05", anonChannel: "B", assignedTo: "sp-p10", status: "final",
    anchor: A(1_836_000, 1_851_000, "30:36"),
    maskedText: "决定了，第一步先进德国，波兰放到第二阶段观察。",
    aiMoment: { agent: "Ava", label: "决策点", basis: "「决定了，第一步先进德国」含明确的阶段决策措辞，且与 RQ1 进入次序相关。" },
  },
  {
    id: "seg-06", anonChannel: null, assignedTo: null, status: "low-confidence",
    anchor: A(1_925_000, 1_940_000, "32:05"),
    maskedText: "这个 Netzentgelt 的算法……（识别置信度低，可能识别错，需人工校对）",
    original: "Das Netzentgelt … [混写，低置信]",
  },
  {
    id: "seg-07", anonChannel: null, assignedTo: null, status: "pending-manual",
    anchor: A(1_950_000, 1_968_000, "32:30"),
    maskedText: "（两位受访者同时开口，系统不自动归属，待人工指派）",
    overlapCandidates: ["sp-p10", "sp-p11"],
  },
  {
    id: "seg-08", anonChannel: "A", assignedTo: "sp-zhouning", status: "partial",
    anchor: A(1_990_000, 1_996_000, "33:10"),
    maskedText: "那我们接下来看一下融资结构……（正在识别）",
  },
];

/** 状态条计数：待校对 = low-confidence + pending-manual（与「逐字稿校对 N」同源）*/
export function reviewCount(): number {
  return TRANSCRIPT.filter((s) => s.status === "low-confidence" || s.status === "pending-manual").length;
}

/* ─────────────────────── UC-5.2 匿名声道卡（指派屏）─────────────────────── */

export interface AnonChannelCard {
  channel: "A" | "B" | "C";
  durationPct: number;
  firstTc: string;
  sampleClips: string[];
  /** 已指派到的真人 id（null = 未指派）*/
  assignedTo: string | null;
}
export const ANON_CHANNELS: AnonChannelCard[] = [
  { channel: "A", durationPct: 41, firstTc: "29:30", sampleClips: ["29:30", "33:10", "41:52"], assignedTo: "sp-zhouning" },
  { channel: "B", durationPct: 38, firstTc: "29:42", sampleClips: ["29:42", "30:36", "38:04"], assignedTo: "sp-p10" },
  { channel: "C", durationPct: 21, firstTc: "30:20", sampleClips: ["30:20", "35:11"], assignedTo: null },
];

/** 声纹 embedding 销毁状态（O-14：指派完成即销毁，兜底本场结束后 7 天）*/
export const VOICEPRINT = {
  /** 本场是否已全部指派完成 */
  allAssigned: false,
  fallbackDay: 7,
  note: "本场声纹 embedding 属 derived_representations，指派完成即物理删除并写审计；未完成则兜底任务在本场结束第 7 天无条件销毁。存活期远短于材料保留期（180 天）。", // [threshold-ok:retentionMaterial] 说明性对比，非取值
};

/* ─────────────────────── UC-5.3 AI 打点候选队列（打点屏）─────────────────── */

export interface AiMomentCandidate {
  id: string;
  agent: string;
  label: string;
  segId: string;
  tc: string;
  snippet: string;
  basis: string;
  /** 依据片段被撤回/改写时自动失效 */
  invalidated?: boolean;
}
export const AI_MOMENTS: AiMomentCandidate[] = [
  { id: "aim-1", agent: "Ava", label: "决策点", segId: "seg-05", tc: "30:36", snippet: "决定了，第一步先进德国，波兰放到第二阶段观察。", basis: "含明确阶段决策措辞，且与 RQ1 进入次序相关。" },
  { id: "aim-2", agent: "Ava", label: "痛点", segId: "seg-02", tc: "29:42", snippet: "德国的并网审批周期是最长的，差不多要 14 个月。", basis: "受访者主动指出审批周期长，情绪与量化并存，疑似关键痛点。" },
  { id: "aim-3", agent: "Scout", label: "机会", segId: "seg-04", tc: "30:20", snippet: "波兰的补贴反而更激进……", basis: "外部补贴政策变化，可能构成进入窗口。", invalidated: true },
];

/** 研究问题（RQ）—— 引述绑定目标，被 UC-6.4 覆盖度 / UC-6.5 证据矩阵消费 */
export const RESEARCH_QUESTIONS: { id: string; label: string }[] = [
  { id: "RQ1", label: "RQ1 · 三个候选市场的进入次序应如何排？" },
  { id: "RQ2", label: "RQ2 · 各市场的并网/审批周期与合规门槛？" },
  { id: "RQ3", label: "RQ3 · 补贴政策的连续性风险如何评估？" },
];

/* ─────────────────────── UC-5.4 保留期 / 回流（保留期屏）─────────────────── */

/**
 * 材料保留期的解析结果 —— **契约 thresholds.retentionMaterial 标 known:false（数值待合规）**。
 * 这里用 O-01 给出的默认值 180 天做 mock，并记录解析依据（用了哪一级）。**不硬编码进组件**。
 */
export const RETENTION_PARAM = {
  orgDefaultDays: 180, // 组织默认值（O-01 默认，区间待合规收窄）
  projectOverrideDays: 90, // 本项目覆盖值（示例：合规客户收紧到 90）
  /** 生效值 = 项目覆盖值 → 组织默认值 */
  get effectiveDays() {
    return this.projectOverrideDays ?? this.orgDefaultDays;
  },
  resolvedFrom: "project-override" as "project-override" | "org-default",
  noTraining: true, // 禁止用于训练（独立开关，全生命周期恒成立）
  dataController: "远洋咨询",
  contact: "林可",
  complianceEmail: "compliance@yuanyang-consulting.cn",
};

export interface MaterialRow {
  id: string;
  name: string;
  source: "interview" | "workshop" | "conversation"; // 归档议程环节来源
  segment: string;
  sizeBytes: number;
  storedAt: string;
  /** 到期时间 = 落库时间 + 生效保留期，落库时固化（参数变更不追溯）*/
  deleteBy: string;
  retentionDays: number;
  resolvedFrom: "project-override" | "org-default";
  status: "active" | "expiring" | "pending-delete" | "delete-blocked";
  /** 🔴 已被某个定版引用过 —— 触发 I-11 / X-4 冲突：保留期到了也删不掉 */
  pinnedByFinalReport?: string;
}

export const MATERIALS: MaterialRow[] = [
  {
    id: "mat-01", name: "第 3 组访谈.wav", source: "interview", segment: "深访", sizeBytes: 88_402_100,
    storedAt: "2026-05-02", deleteBy: "2026-07-31", retentionDays: 90, resolvedFrom: "project-override", status: "active",
  },
  {
    id: "mat-02", name: "第 3 组访谈.transcript.jsonl", source: "interview", segment: "深访", sizeBytes: 204_882,
    storedAt: "2026-05-02", deleteBy: "2026-07-31", retentionDays: 90, resolvedFrom: "project-override", status: "active",
  },
  {
    id: "mat-03", name: "第 3 组访谈.notes.md", source: "interview", segment: "深访", sizeBytes: 8_204,
    storedAt: "2026-05-02", deleteBy: "2026-07-31", retentionDays: 90, resolvedFrom: "project-override", status: "active",
  },
  {
    id: "mat-04", name: "工作坊录音 · 第 2 组.wav", source: "workshop", segment: "机会发散", sizeBytes: 132_004_882,
    storedAt: "2026-04-11", deleteBy: "2026-07-10", retentionDays: 90, resolvedFrom: "project-override", status: "expiring",
  },
  {
    // 🔴 冲突样本：这份逐字稿已被「欧洲市场进入 · 终版报告」定版引用过（pinned 快照）。
    // 材料保留期到期要删，但它作为固定快照被引用 → I-11「固定快照不可删/不可改/不可降级」
    // 与 X-4「撤回删除是不可变原则的唯一豁口」直接相撞。界面上必须可见，不能糊过去。
    id: "mat-05", name: "工作坊录音 · 第 2 组.transcript.jsonl", source: "workshop", segment: "机会发散", sizeBytes: 312_004,
    storedAt: "2026-04-11", deleteBy: "2026-07-10", retentionDays: 90, resolvedFrom: "project-override", status: "delete-blocked",
    pinnedByFinalReport: "欧洲市场进入 · 终版报告 v3（2026-06-20 定版）",
  },
  {
    id: "mat-06", name: "线程音频 · 假设梳理.wav", source: "conversation", segment: "对话线程", sizeBytes: 41_200_004,
    storedAt: "2026-06-01", deleteBy: "2026-08-30", retentionDays: 90, resolvedFrom: "project-override", status: "active",
  },
];

/** 同意书渲染实例（UC-5.4 R3 第 3 步）——文案由参数动态渲染，已提交快照不可改 */
export const CONSENT_RENDER = {
  liveTemplate: (days: number) =>
    `录音——只在这场访谈中录，存于${RETENTION_PARAM.dataController}的服务器，${days} 天后自动删除；禁止用于训练。`,
  /** 已提交的同意书快照：当时项目覆盖值是 180，改成 90 后此快照仍显示 180（不回溯改写）*/
  submittedSnapshot: {
    submittedBy: "P-10 陈涛",
    submittedAt: "2026-04-20",
    days: 180,
    text: "录音——只在这场访谈中录，存于远洋咨询的服务器，180 天后自动删除；禁止用于训练。", // [threshold-ok:retentionMaterial] 同上：快照正文，改掉它才是错的
  },
  /** 渲染变量缺失时不得发出授权链接（E6）*/
  requiredVars: ["材料保留期", "数据控制方", "联系人", "合规邮箱"],
};

export function formatBytes(n: number): string {
  if (n === 0) return "生成中";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
