/**
 * Studio · 访谈 的 mock 数据（UC-6.1~6.5 现场记录链 + UC-5.1~5.4 实时转录）
 *
 * ⚠ 纯数据模块，**不带 `"use client"`**——同时被服务端页面与客户端子组件 import。
 *    密度参照 `ui-preview/PROTOTYPE-DIGEST.md` 第九节与访谈章节：说话人不止两个、
 *    转录数十条带时间码、含一段重叠语音标「待人工指派」（裁决 O-13）。
 *    受访者同意与研究员侧联动：受访者拒绝实名引用 → 这里显示代称，不显示真名。
 *
 * 与 `lib/mock/entry.ts` 的受访者同意书（CONSENT / WITHDRAWAL_FLOW）对齐：
 *    两侧共用同一套授权口径，受访者屏拒绝的项 = 研究员屏被禁用/降级的项。
 */

/* ── 预览视角（UC-6.4 R5 多角色，视角切换是预览手段而非权限实现）──────── */

export type InterviewView =
  | "researcher" | "facilitator" | "groupLead" | "observer" | "interviewee";

export const INTERVIEW_VIEWS: { id: InterviewView; label: string; note: string }[] = [
  { id: "researcher", label: "研究员", note: "可发起、标引述、指派说话人、确认洞察" },
  { id: "facilitator", label: "引导师", note: "参与并查看与自身角色相关的结果" },
  { id: "groupLead", label: "组长", note: "参与并查看与自身角色相关的结果" },
  { id: "observer", label: "观察者", note: "仅在已发布且授权允许时只读脱敏结果" },
  { id: "interviewee", label: "受访者", note: "只看自己的授权与撤回，看不到项目内部材料" },
];

export function resolveInterviewView(raw: string | string[] | undefined): InterviewView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return INTERVIEW_VIEWS.some((r) => r.id === v) ? (v as InterviewView) : "researcher";
}

/** 追问建议、洞察确认、指派等写操作只对研究员开放（其余视角只读）*/
export function canWriteInterview(view: InterviewView): boolean {
  return view === "researcher";
}
/** 观察者只能看已发布脱敏结果 —— 用于驱动 denied 态说明 */
export function isReadOnlyView(view: InterviewView): boolean {
  return view === "observer" || view === "interviewee";
}

/* ── 说话人（含同意联动：拒绝实名 → 用代称）────────────────────────── */

export type SpeakerRole = "researcher" | "facilitator" | "interviewee" | "anonymous";

export interface Speaker {
  id: string;
  initials: string;
  /** 真实姓名 —— 仅在受访者授权实名引用时才可展示 */
  realName: string;
  /** 未授权实名时的代称（与 entry.ts CONSENT.alias 同源口径）*/
  alias?: string;
  role: SpeakerRole;
  /** 受访者是否拒绝了实名引用；true → 全项目一律用 alias */
  consentRefusedRealname?: boolean;
  /** 是否已撤回授权（D-13）；撤回后其引述退出检索 */
  withdrawn?: boolean;
}

export const SPEAKERS: Speaker[] = [
  { id: "sp-linke", initials: "林", realName: "林可", role: "researcher" },
  { id: "sp-zhouheng", initials: "周", realName: "周衡", role: "facilitator" },
  {
    id: "sp-wang",
    initials: "运",
    realName: "王建国",
    alias: "某物流园区运营总监",
    role: "interviewee",
    consentRefusedRealname: true,
  },
  { id: "sp-limin", initials: "李", realName: "李敏", alias: "某区域采购负责人", role: "interviewee" },
];

/** 同意联动的核心：能不能露真名，取决于受访者在自己那块屏上勾没勾实名引用 */
export function speakerDisplay(id: string | null): string {
  if (!id) return "说话人 3（临时名）";
  const s = SPEAKERS.find((x) => x.id === id);
  if (!s) return "未知说话人";
  if (s.role === "interviewee" && s.consentRefusedRealname) return s.alias ?? "匿名受访者";
  return s.realName;
}

export function speakerInitials(id: string | null): string {
  if (!id) return "?";
  return SPEAKERS.find((x) => x.id === id)?.initials ?? "?";
}

/* ── 4 路录音轨（UC-5.1 AC1：4 路同时录不串台；E2：断网本地缓存补传）──── */

export interface RecordingTrack {
  id: string;
  label: string;
  status: "live" | "buffering" | "idle";
  /** buffering = 断网，本地缓存中，恢复后补传并标缺口 */
  note?: string;
}

export const RECORDING_TRACKS: RecordingTrack[] = [
  { id: "trk-1", label: "轨 1 · 主访谈室", status: "live" },
  { id: "trk-2", label: "轨 2 · 受访者近场麦", status: "live" },
  { id: "trk-3", label: "轨 3 · 会议室吊麦", status: "buffering", note: "断网 8s，本地缓存中，恢复后补传并标缺口" },
  { id: "trk-4", label: "轨 4 · 引导师麦", status: "live" },
];

/* ── 转录段（说话人分离 + 时间码 + 重叠 + 外语 + 引述 + 决策点）────────── */

export type SegmentStatus = "final" | "partial" | "pending-manual" | "disputed";

export interface TranscriptSegment {
  id: string;
  /** 时间码 mm:ss —— AC2：每句都能点时间码跳回音频 */
  tc: string;
  track: string;
  /** null = 未指派（先出文字不猜说话人，UC-5.1 步骤 3）*/
  speakerId: string | null;
  status: SegmentStatus;
  text: string;
  /** 外语时的原文（E3：显示原文与译文两行），text 为译文 */
  original?: string;
  /** 重叠语音的候选说话人 id（O-13：不得静默归给单一说话人）*/
  overlapCandidates?: string[];
  /** 争议：同一段被多人认领（UC-5.2 E1）*/
  disputeClaims?: string[];
  /** 已标为引述（进证据库，带时间码与来源）*/
  quote?: boolean;
  /** AI 标为决策点（机器产出，需人确认）*/
  decisionPoint?: boolean;
  /** 低置信度片段 */
  lowConfidence?: boolean;
}

/** ~30 条，从 00:00 跑到 34:xx，说话人四位 + 一段重叠 + 一段外语 + 若干引述 */
export const TRANSCRIPT: TranscriptSegment[] = [
  { id: "seg-01", tc: "00:12", track: "trk-4", speakerId: "sp-zhouheng", status: "final", text: "今天主要想请您聊聊采购委员会真实的决策链条，随时可以打断我。" },
  { id: "seg-02", tc: "00:41", track: "trk-2", speakerId: "sp-wang", status: "final", text: "行。我们园区去年评估过三家储能方案，最后一家都没签。" },
  { id: "seg-03", tc: "01:05", track: "trk-4", speakerId: "sp-zhouheng", status: "final", text: "都没签——是价格问题还是别的？" },
  { id: "seg-04", tc: "01:18", track: "trk-2", speakerId: "sp-wang", status: "final", quote: true, text: "价格反而不是最卡的。最卡的是签完之后没人敢为收益兜底。" },
  { id: "seg-05", tc: "01:52", track: "trk-2", speakerId: "sp-wang", status: "final", text: "采购、财务、法务三方，谁签字谁背锅，所以最后就一直挂着。" },
  { id: "seg-06", tc: "02:20", track: "trk-1", speakerId: "sp-limin", status: "final", text: "我补充一下，其实我们更担心的是本地没有可参照的落地案例。" },
  { id: "seg-07", tc: "02:47", track: "trk-1", speakerId: "sp-limin", status: "final", quote: true, text: "德国业主只认落地过的项目，PPT 再漂亮没有本地灯塔项目就说服不了董事会。" },
  {
    id: "seg-08", tc: "03:15", track: "trk-1", speakerId: null, status: "pending-manual",
    overlapCandidates: ["sp-wang", "sp-limin"],
    text: "……对，而且质保条款那块……／……预算窗口期也就三个月……（两位受访者同时开口）",
  },
  { id: "seg-09", tc: "03:40", track: "trk-2", speakerId: "sp-wang", status: "final", text: "抱歉我们俩抢话了。我刚说的是质保条款看不懂，法务要求重读一遍。" },
  { id: "seg-10", tc: "04:02", track: "trk-1", speakerId: "sp-limin", status: "final", text: "我说的是预算审批窗口只有三个月，走三级审批经常拖过去。" },
  { id: "seg-11", tc: "04:38", track: "trk-2", speakerId: "sp-wang", status: "final", quote: true, decisionPoint: true, text: "如果供应商肯写收益保底，我们内部至少能推进到董事会那一步。" },
  { id: "seg-12", tc: "05:10", track: "trk-1", speakerId: "sp-limin", status: "final", lowConfidence: true, text: "去年那家……好像违约过一次？我记不太准，得回去查合同。" },
  {
    id: "seg-13", tc: "05:44", track: "trk-2", speakerId: "sp-wang", status: "final",
    original: "The board only trusts numbers they can audit themselves.",
    text: "董事会只相信他们自己能审计的数字。",
    quote: true,
  },
  { id: "seg-14", tc: "06:20", track: "trk-4", speakerId: "sp-zhouheng", status: "final", text: "所以「可自审计」比「第三方背书」更重要，我记一下。" },
  { id: "seg-15", tc: "06:58", track: "trk-1", speakerId: "sp-limin", status: "final", text: "对。而且要中文的、能给法务逐条对的版本。" },
  { id: "seg-16", tc: "07:33", track: "trk-2", speakerId: "sp-wang", status: "final", text: "预算这块，三级审批分别是部门、财务口、和分管副总。" },
  {
    id: "seg-17", tc: "08:05", track: "trk-1", speakerId: "sp-limin", status: "disputed",
    disputeClaims: ["sp-limin", "sp-wang"],
    text: "卡最久的是财务口，通常压两到三周。",
  },
  { id: "seg-18", tc: "08:41", track: "trk-4", speakerId: "sp-zhouheng", status: "final", text: "两到三周——那三个月窗口基本一半就没了。" },
  { id: "seg-19", tc: "09:12", track: "trk-2", speakerId: "sp-wang", status: "final", quote: true, text: "所以我们宁可要一个先小规模试点、验证收益再放量的路径。" },
  { id: "seg-20", tc: "09:50", track: "trk-1", speakerId: "sp-limin", status: "final", text: "试点最好能挂一个本地灯塔项目的名义，免费改造换背书也行。" },
  { id: "seg-21", tc: "10:24", track: "trk-4", speakerId: "sp-zhouheng", status: "final", text: "灯塔项目换背书这个思路很关键，我们后面画布上单独拉一条。" },
  { id: "seg-22", tc: "11:02", track: "trk-2", speakerId: "sp-wang", status: "final", text: "法务那关，最好你们先出一版风险对照表，别让我们自己啃英文合同。" },
  { id: "seg-23", tc: "11:48", track: "trk-1", speakerId: null, status: "final", text: "（第三位与会者插话，尚未认领身份）我们那边情况类似，也是卡法务。" },
  { id: "seg-24", tc: "12:30", track: "trk-2", speakerId: "sp-wang", status: "final", text: "数据出境也得提一句，方案如果要连境外云，合规直接一票否决。" },
  { id: "seg-25", tc: "13:14", track: "trk-4", speakerId: "sp-zhouheng", status: "final", text: "明白，那本地部署会是硬约束之一。" },
  { id: "seg-26", tc: "13:55", track: "trk-1", speakerId: "sp-limin", status: "final", quote: true, text: "只要能本地部署、能自审计、有本地案例，价格贵一点董事会能接受。" },
  { id: "seg-27", tc: "14:40", track: "trk-2", speakerId: "sp-wang", status: "final", text: "差不多就这些，你们要的重点我觉得都说到了。" },
  { id: "seg-28", tc: "15:02", track: "trk-4", speakerId: "sp-zhouheng", status: "partial", text: "好，那我们最后确认一下质保和法务那条还没展开的……" },
];

/* ── 研究问题覆盖度（UC-6.4 AC1：结束时立刻看到 5 个问题的覆盖状态）──── */

export type Coverage = "covered" | "partial" | "untouched";
export const COVERAGE_LABEL: Record<Coverage, string> = {
  covered: "已覆盖", partial: "部分覆盖", untouched: "未触及",
};

export interface ResearchQuestion {
  id: string;
  no: number;
  text: string;
  coverage: Coverage;
  /** 支撑该问题的转录段（可点回时间码）*/
  evidenceSegments: string[];
}

export const RESEARCH_QUESTIONS: ResearchQuestion[] = [
  { id: "rq-1", no: 1, text: "采购委员会的真实决策链条是怎样的？", coverage: "covered", evidenceSegments: ["seg-05", "seg-16", "seg-17"] },
  { id: "rq-2", no: 2, text: "签约时最大的顾虑与责任归属在哪？", coverage: "covered", evidenceSegments: ["seg-04", "seg-11"] },
  { id: "rq-3", no: 3, text: "本地落地案例对说服董事会有多重要？", coverage: "partial", evidenceSegments: ["seg-07", "seg-20", "seg-26"] },
  { id: "rq-4", no: 4, text: "预算审批周期与窗口期约束是什么？", coverage: "partial", evidenceSegments: ["seg-10", "seg-18"] },
  { id: "rq-5", no: 5, text: "质保与法务条款的具体障碍是什么？", coverage: "untouched", evidenceSegments: [] },
];

/* ── 授权状态（UC-6.3 AC1：现场页顶部「授权 3/4」；同意联动）──────────── */

export interface AuthorizationItem {
  id: string;
  label: string;
  granted: boolean;
  /** 未授权时现场对应能力被禁用（A1：禁用而非提示后照做）*/
  disabledHint?: string;
}

export const AUTHORIZATION = {
  interviewee: "sp-wang",
  /** 4 项里授权了 3 项 → 顶部显示「授权 3/4」*/
  items: [
    { id: "record", label: "录音", granted: true },
    { id: "transcript", label: "转文字稿", granted: true },
    { id: "quote", label: "引述", granted: true },
    { id: "reuse", label: "内部复用", granted: false, disabledHint: "未授权：本场引述不得跨项目复用，相关按钮已禁用" },
  ] satisfies AuthorizationItem[],
  /** 实名引用单独一项，拒绝 → 全项目用代称 */
  realnameGranted: false,
  alias: "某物流园区运营总监",
} as const;

export function authGrantedCount(): { granted: number; total: number } {
  const total = AUTHORIZATION.items.length;
  const granted = AUTHORIZATION.items.filter((i) => i.granted).length;
  return { granted, total };
}

/* ── 追问建议（UC-6.4 右栏只给研究员；含平衡发言 E2 与覆盖度提醒 步骤3）─ */

export interface FollowUpSuggestion {
  id: string;
  kind: "coverage" | "balance" | "probe";
  text: string;
  /** 建议来源（哪个研究问题 / 哪段发言），保证可追溯 */
  source: string;
}

export const FOLLOWUPS: FollowUpSuggestion[] = [
  { id: "fu-1", kind: "coverage", text: "研究问题 5「质保与法务条款」还没实质展开，剩约 8 分钟，建议现在切入。", source: "覆盖度矩阵 · RQ5 未触及" },
  { id: "fu-2", kind: "balance", text: "王建国已连续发言约 4 分 12 秒，可请李敏就「本地案例」补充，平衡发言。", source: "发言时长 · 轨 2 vs 轨 1" },
  { id: "fu-3", kind: "probe", text: "追问：财务口压两到三周，卡点是流程还是某个具体审批人？", source: "seg-17 · 08:05" },
];

/* ── 洞察候选（UC-6.5：抽引述、合并同类；每条必须挂原始引述与出处）───── */

export type InsightStrength = "strong" | "virtual" | "weak";
export const INSIGHT_STRENGTH_LABEL: Record<InsightStrength, string> = {
  strong: "强洞察 · 真人来源", virtual: "虚拟来源 · 单独计数", weak: "弱信号 · 待补证",
};

export interface InsightCandidate {
  id: string;
  text: string;
  strength: InsightStrength;
  /** 机器产出标识（AI 生成候选必须可识别）*/
  machineGenerated: boolean;
  confirmed: boolean;
  theme: string;
  /** 挂到的原始引述段（点回原始证据 · AC1）*/
  quoteSegmentIds: string[];
}

export const INSIGHT_CANDIDATES: InsightCandidate[] = [
  {
    id: "ins-1", theme: "责任归属", strength: "strong", machineGenerated: true, confirmed: false,
    text: "阻碍签约的核心不是价格，而是「收益兜底」的责任无人承担。",
    quoteSegmentIds: ["seg-04", "seg-11"],
  },
  {
    id: "ins-2", theme: "本地案例", strength: "strong", machineGenerated: true, confirmed: true,
    text: "本地灯塔项目是说服董事会的前置条件，可用免费改造换背书。",
    quoteSegmentIds: ["seg-07", "seg-20", "seg-26"],
  },
  {
    id: "ins-3", theme: "预算窗口", strength: "weak", machineGenerated: true, confirmed: false,
    text: "三级审批中财务口压 2–3 周，可能吃掉一半的三个月窗口。",
    quoteSegmentIds: ["seg-17", "seg-18"],
  },
  {
    id: "ins-4", theme: "合规约束", strength: "virtual", machineGenerated: true, confirmed: false,
    text: "（虚拟推演）本地部署 + 可自审计或成为硬性准入门槛。",
    quoteSegmentIds: ["seg-24", "seg-26"],
  },
];

/* ── 撤回的下游影响（D-13：不静默删除）────────────────────────────── */

export interface WithdrawalImpact {
  interviewee: string;
  /** 该场退出检索的引述数 */
  quotesRemoved: number;
  matrixRecomputed: boolean;
  /** 引用过它的报告段落，标「证据已撤回」而不是删掉 */
  affectedReportSegments: { id: string; title: string }[];
  /** 若已支撑签字决策，通知拍板人复核（需人工）*/
  decisionToReview?: { id: string; title: string; owner: string };
  retentionDeleteBy: string;
}

export const WITHDRAWAL_IMPACT: WithdrawalImpact = {
  interviewee: "某区域采购负责人",
  quotesRemoved: 7,
  matrixRecomputed: true,
  affectedReportSegments: [
    { id: "rep-2", title: "报告 · 3.2 本地案例的说服力" },
    { id: "rep-4", title: "报告 · 4.1 准入门槛建议" },
  ],
  decisionToReview: { id: "dec-11", title: "决策 · 优先落地灯塔项目", owner: "项目经理 · 沈岚" },
  retentionDeleteBy: "2026-01-24",
};

/* ── 保留期（UC-5.4 AC1：能看到每份转写的保留期与删除时间）─────────── */

export const RETENTION = {
  transcript: "欧洲进入策略 · 采购总监深访",
  retentionDays: 180,
  deleteBy: "2026-01-24",
  noTraining: true,
} as const;

/* ── 会话元信息（现场记录页头部）──────────────────────────────────── */

export const INTERVIEW_SESSION = {
  title: "欧洲储能进入策略 · 采购总监深访",
  project: "远洋新能源 / 欧洲市场进入",
  segment: "第 2 周 · 现场记录",
  elapsed: "15:02",
  planned: "45:00",
  lastSync: "2s 前",
  connection: "已连接",
  recording: "录制中",
} as const;
