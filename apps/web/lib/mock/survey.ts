/**
 * Studio · 问卷 的 mock 数据（UC-12.1 设计 / 12.2 发放回收 / 12.3 交叉分析 / 12.4 现场投票）
 *
 * ⚠ 纯数据模块，不带 `"use client"`。密度参照原型：回收进度 9/12、题型齐全、
 *    交叉分析含「样本量 < 8 不可推断」（UC-12.3 E1）。问卷结论进证据链后同样要可定位。
 */

/* ── 视角（UC-12.2 R5）──────────────────────────────────────────── */
export type SurveyView = "researcher" | "facilitator" | "participant" | "observer";
export const SURVEY_VIEWS: { id: SurveyView; label: string; note: string }[] = [
  { id: "researcher", label: "研究员", note: "可建卷、发放、催填、确认结论入库" },
  { id: "facilitator", label: "引导师", note: "参与并查看与自身角色相关的结果" },
  { id: "participant", label: "参与者", note: "匿名填写；不记录个人身份" },
  { id: "observer", label: "观察者", note: "仅只读已发布的脱敏汇总" },
];
export function resolveSurveyView(raw: string | string[] | undefined): SurveyView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return SURVEY_VIEWS.some((r) => r.id === v) ? (v as SurveyView) : "researcher";
}
export function canWriteSurvey(view: SurveyView): boolean {
  return view === "researcher";
}

/* ── 问卷列表（左栏）─────────────────────────────────────────── */
export type SurveyStatus = "draft" | "collecting" | "analyzed" | "delivered";
export const SURVEY_STATUS_LABEL: Record<SurveyStatus, string> = {
  draft: "草稿", collecting: "回收中", analyzed: "已分析", delivered: "已交付",
};

export interface SurveyListItem {
  id: string;
  title: string;
  status: SurveyStatus;
  meta: string;
  version: string;
}

export const SURVEY_LIST: SurveyListItem[] = [
  { id: "sv-1", title: "采购决策链诊断问卷", status: "collecting", meta: "回收 9/12 · 3 组发放", version: "v4" },
  { id: "sv-2", title: "储能方案偏好摸底", status: "analyzed", meta: "回收 41/45 · 3 条结论入库", version: "v2" },
  { id: "sv-3", title: "现场收敛 · 路径投票", status: "draft", meta: "停在「题目与逻辑」", version: "v1（草稿）" },
  { id: "sv-4", title: "客户满意度回访", status: "delivered", meta: "已交付 · 结论 5 · 被引用 8 次", version: "v3" },
];

/* ── 题目与结果汇总（12.1 / 12.2）──────────────────────────────── */
export type QuestionType = "single" | "multi" | "scale" | "open";
export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  single: "单选", multi: "多选", scale: "五点量表", open: "开放题",
};

export interface SurveyOption { label: string; count: number }

export interface SurveyQuestion {
  id: string;
  no: number;
  type: QuestionType;
  text: string;
  sampleN: number;
  options?: SurveyOption[];
  /** 五点量表均值 */
  scaleAvg?: number;
  /** 开放题抽样回答（脱敏）*/
  openSamples?: string[];
}

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: "q-1", no: 1, type: "single", sampleN: 9,
    text: "贵司储能采购推进中最大的障碍是？",
    options: [
      { label: "收益无人兜底 / 责任归属不清", count: 5 },
      { label: "缺本地落地案例", count: 2 },
      { label: "预算审批周期太长", count: 1 },
      { label: "法务 / 质保条款看不懂", count: 1 },
    ],
  },
  {
    id: "q-2", no: 2, type: "multi", sampleN: 9,
    text: "签约前必须解决的事项（可多选）？",
    options: [
      { label: "收益保底条款", count: 7 },
      { label: "本地灯塔项目背书", count: 6 },
      { label: "中文风险对照表", count: 5 },
      { label: "本地部署 / 数据不出境", count: 4 },
      { label: "试点后放量的分期路径", count: 3 },
    ],
  },
  {
    id: "q-3", no: 3, type: "scale", sampleN: 9, scaleAvg: 4.3,
    text: "「本地落地案例」对说服董事会的重要程度（1–5）",
    options: [
      { label: "1 · 不重要", count: 0 },
      { label: "2", count: 0 },
      { label: "3", count: 1 },
      { label: "4", count: 4 },
      { label: "5 · 非常重要", count: 4 },
    ],
  },
  {
    id: "q-4", no: 4, type: "open", sampleN: 9,
    text: "关于采购，你最担心的一件事是什么？",
    openSamples: [
      "签完之后收益不达标，没人负责。",
      "三级审批走到一半窗口期就过了。",
      "英文合同里的质保条款，法务不敢背书。",
      "数据出境这条如果卡了，方案直接推翻。",
    ],
  },
];

/* ── 回收进度与名单（12.2 AC1：回收数与名单能对上，缺谁一目了然）───── */
export interface RosterEntry {
  id: string;
  name: string;
  group: string;
  submitted: boolean;
  /** 同一链接重复提交按最后一次生效（E1）*/
  resubmitted?: boolean;
}

export const RECOVERY = {
  rosterTotal: 12,
  submitted: 9,
  anonymous: true,
  roster: [
    { id: "r-1", name: "采购 · 王建国", group: "第 1 组", submitted: true },
    { id: "r-2", name: "采购 · 李敏", group: "第 1 组", submitted: true, resubmitted: true },
    { id: "r-3", name: "财务 · 张涛", group: "第 1 组", submitted: true },
    { id: "r-4", name: "财务 · 陈静", group: "第 2 组", submitted: false },
    { id: "r-5", name: "法务 · 赵磊", group: "第 2 组", submitted: true },
    { id: "r-6", name: "法务 · 孙倩", group: "第 2 组", submitted: false },
    { id: "r-7", name: "运营 · 周衡", group: "第 2 组", submitted: true },
    { id: "r-8", name: "运营 · 吴迪", group: "第 3 组", submitted: true },
    { id: "r-9", name: "采购 · 郑楠", group: "第 3 组", submitted: true },
    { id: "r-10", name: "财务 · 冯磊", group: "第 3 组", submitted: true },
    { id: "r-11", name: "运营 · 何军", group: "第 3 组", submitted: true },
    { id: "r-12", name: "法务 · 高琳", group: "第 3 组", submitted: false },
  ] satisfies RosterEntry[],
} as const;

export function missingRoster(): RosterEntry[] {
  return RECOVERY.roster.filter((r) => !r.submitted);
}

/* ── 交叉分析（12.3：按角色切分；样本量<8 不可推断；结论点回原始分布）── */
export const MIN_INFERABLE_N = 8;

export interface CrossSegment {
  id: string;
  label: string;
  n: number;
  /** 该切分最集中的选项与占比（不可推断时不给结论）*/
  topOption?: string;
  topPct?: number;
}

export const CROSS_SEGMENTS: CrossSegment[] = [
  { id: "seg-purchase", label: "采购口", n: 3, topOption: "收益无人兜底", topPct: 67 },
  { id: "seg-finance", label: "财务口", n: 3, topOption: "预算审批周期", topPct: 67 },
  { id: "seg-legal", label: "法务口", n: 3, topOption: "条款看不懂", topPct: 100 },
  { id: "seg-ops", label: "运营口", n: 3, topOption: "缺本地案例", topPct: 67 },
  { id: "seg-all", label: "全体", n: 9, topOption: "收益无人兜底", topPct: 56 },
];

export interface SurveyConclusion {
  id: string;
  text: string;
  /** 挂的题目（点回原始分布）*/
  questionId: string;
  sampleN: number;
  machine: boolean;
  confirmed: boolean;
}

export const SURVEY_CONCLUSIONS: SurveyConclusion[] = [
  { id: "c-1", text: "全体样本中，「收益无人兜底」是首要障碍（56%，n=9）。", questionId: "q-1", sampleN: 9, machine: true, confirmed: true },
  { id: "c-2", text: "「本地落地案例」重要度均值 4.3/5，接近共识。", questionId: "q-3", sampleN: 9, machine: true, confirmed: false },
  { id: "c-3", text: "法务口 100% 选「条款看不懂」，但 n=3 < 8，标为不可推断，仅作定性线索。", questionId: "q-1", sampleN: 3, machine: true, confirmed: false },
];

/* ── 现场快速投票（12.4：60 秒倒计时；未投的人在哪个模块忙）─────── */
export const LIVE_VOTE = {
  fromHypothesis: "路径 B：先小规模试点、验证收益再放量",
  question: "是否采用「先试点后放量」作为主推路径？",
  countdownSec: 60,
  remainingSec: 23,
  anonymous: true,
  options: [
    { label: "采用", count: 6 },
    { label: "有条件采用", count: 3 },
    { label: "不采用", count: 1 },
  ] satisfies SurveyOption[],
  notVoted: [
    { name: "参与者 · 财务口", where: "正在填写问卷 Q4" },
    { name: "参与者 · 法务口", where: "在画布上补便签" },
  ],
} as const;

/* ── 会话元信息 ─────────────────────────────────────────────── */
export const SURVEY_SESSION = {
  active: "采购决策链诊断问卷",
  project: "远洋新能源 / 欧洲市场进入",
  lastUpdate: "12s 前",
} as const;
