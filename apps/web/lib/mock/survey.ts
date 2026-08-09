/**
 * Studio · 问卷 的 mock 数据（UC-12.1 新建问卷与模板 / 12.2 发放与回收 / 12.3 交叉分析 / 12.4 现场投票）
 *
 * ⚠ 纯数据模块，不带 `"use client"`。
 *
 * 保真度基线（2026-08-09 审计，`phases/requirements/12-survey` UC 文档已逐条标注字节偏移）：
 * - 问卷状态**恰为四态**：`草稿 → 待发出 → 回收中 → 已截止`（UC-12.1 R7.2，原型列表筛选行
 *   「全部 4 / 草稿 1 / 回收中 1 / 已截止 2」与四条实例逐个可证）。此前实现用的
 *   `draft/collecting/analyzed/delivered` 不是这四态，已改正。
 * - 问卷工作台**三个标签**：`问卷设计 ｜ 报告模板 ｜ 回收与分析`（原型字节 16,193,522 起）。
 *   `报告模板` 标签是**质量门禁双阻断**（UC-12.2 R7.1）的载体：
 *   题目侧 `→ 报告章节` 映射 + 章节侧供料/缺口，此前实现完全没有这一屏，已补齐。
 * - 每份问卷带 **匿名 / 实名** 属性（创建后不可改，UC-12.1 R7.3），列表行常驻显示。
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

/* ── 范围与标签（UC-12.1 R7.4：与研究/访谈/原型三个 Studio 共用同一套口径）──── */
export type SurveyScope = "project" | "unassigned";
export const SURVEY_SCOPES: { id: SurveyScope; label: string }[] = [
  { id: "project", label: "本项目" },
  { id: "unassigned", label: "不属于任何项目" },
];

export type SurveyTag = "all" | "client" | "internal" | "priority" | "archived";
export const SURVEY_TAGS: { id: SurveyTag; label: string }[] = [
  { id: "all", label: "全部标签" },
  { id: "client", label: "客户" },
  { id: "internal", label: "内部" },
  { id: "priority", label: "高优先级" },
  { id: "archived", label: "已归档" },
];

/* ── 问卷列表（左栏）── UC-12.1 R7.2：状态恰为四态，各态动作互斥 ──────── */
export type SurveyStatus = "draft" | "pending_send" | "collecting" | "closed";
export const SURVEY_STATUS_LABEL: Record<SurveyStatus, string> = {
  draft: "草稿", pending_send: "待发出", collecting: "回收中", closed: "已截止",
};
/** 各态唯一允许的主动作（UC-12.1 R7.2 表；服务端裁决，前端只呈现）*/
export const SURVEY_STATUS_ACTION: Record<SurveyStatus, string> = {
  draft: "继续编辑", pending_send: "改触发时机", collecting: "催未交的 N 人", closed: "复制为新问卷",
};

export type SurveyAnonymity = "匿名" | "实名";

export interface SurveyListItem {
  id: string;
  title: string;
  status: SurveyStatus;
  anonymity: SurveyAnonymity;
  questionCount: number;
  scope: SurveyScope;
  tags: SurveyTag[];
  /** 回收中/已截止：`34/48` 这类回收进度行 */
  recovery?: { submitted: number; total: number; medianDuration?: string; insights?: number; dueDate?: string };
  /** 待发出：触发时机说明（UC-12.2 R7.2）*/
  triggerNote?: string;
  /** 发出人/来源摘要 */
  meta: string;
  version: string;
}

export const SURVEY_LIST: SurveyListItem[] = [
  {
    id: "sv-1", title: "采购决策链诊断问卷", status: "collecting",
    anonymity: "匿名", questionCount: 12, scope: "project", tags: ["client"],
    recovery: { submitted: 9, total: 12, medianDuration: "6 分 40 秒", insights: 3, dueDate: "本周五" },
    meta: "3 组发放 · 项目经理发出", version: "v4",
  },
  {
    id: "sv-5", title: "会后反馈 · 现场节奏与产出", status: "pending_send",
    anonymity: "实名", questionCount: 6, scope: "project", tags: ["internal"],
    triggerNote: "绑定在环节 7 结束后触发，题目已定，尚未发出。预计 12 人 · 由 Echo 汇总",
    meta: "会后自动发出", version: "v1",
  },
  {
    id: "sv-3", title: "现场收敛 · 路径投票前摸底", status: "draft",
    anonymity: "实名", questionCount: 5, scope: "project", tags: ["internal", "priority"],
    meta: "停在「题目与逻辑」· 报告模板未绑定完整", version: "v1（草稿）",
  },
  {
    id: "sv-2", title: "储能方案偏好摸底", status: "closed",
    anonymity: "匿名", questionCount: 9, scope: "project", tags: ["client", "archived"],
    recovery: { submitted: 41, total: 45, insights: 3 },
    meta: "3 条洞察已入库", version: "v2",
  },
  {
    id: "sv-4", title: "客户满意度回访", status: "closed",
    anonymity: "实名", questionCount: 8, scope: "unassigned", tags: ["client", "archived"],
    recovery: { submitted: 38, total: 40, insights: 5 },
    meta: "已截止 · 报告已交付 · 结论被引用 8 次", version: "v3",
  },
];

export function surveyStatusCounts(): Record<SurveyStatus, number> {
  const counts: Record<SurveyStatus, number> = { draft: 0, pending_send: 0, collecting: 0, closed: 0 };
  for (const s of SURVEY_LIST) counts[s.status] += 1;
  return counts;
}

/* ── 题目与结果汇总（12.1）──────────────────────────────────────── */
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
  /** UC-12.1 R7.5：题目侧一等字段——供料的报告章节；null = 未映射（孤儿题，阻断项）*/
  reportSectionId: string | null;
  /** UC-12.1 R7.6 / UC-12.2 R7.1 阻断一：诱导性表述编辑期检测 */
  leadingIssue?: string;
}

export const SURVEY_QUESTIONS: SurveyQuestion[] = [
  {
    id: "q-1", no: 1, type: "single", sampleN: 9, reportSectionId: "sec-blocker",
    text: "贵司储能采购推进中最大的障碍是？",
    options: [
      { label: "收益无人兜底 / 责任归属不清", count: 5 },
      { label: "缺本地落地案例", count: 2 },
      { label: "预算审批周期太长", count: 1 },
      { label: "法务 / 质保条款看不懂", count: 1 },
    ],
  },
  {
    id: "q-2", no: 2, type: "multi", sampleN: 9, reportSectionId: "sec-decision",
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
    id: "q-3", no: 3, type: "scale", sampleN: 9, scaleAvg: 4.3, reportSectionId: null,
    text: "「本地落地案例」对说服董事会来说是不是显然最重要的一环（1–5）？",
    leadingIssue: "诱导性表述：题干预设了「显然最重要」，会引导受访者选高分，需改写为中性措辞",
    options: [
      { label: "1 · 不重要", count: 0 },
      { label: "2", count: 0 },
      { label: "3", count: 1 },
      { label: "4", count: 4 },
      { label: "5 · 非常重要", count: 4 },
    ],
  },
  {
    id: "q-4", no: 4, type: "open", sampleN: 9, reportSectionId: null,
    text: "关于采购，你最担心的一件事是什么？",
    openSamples: [
      "签完之后收益不达标，没人负责。",
      "三级审批走到一半窗口期就过了。",
      "英文合同里的质保条款，法务不敢背书。",
      "数据出境这条如果卡了，方案直接推翻。",
    ],
  },
];

/* ── 报告模板 ↔ 题目双向映射（UC-12.1 R7.5 本用例核心结构 / UC-12.2 R7.1 头号硬约束）──
 * 原型硬规则原文（字节 16,186,516 起）：
 *   「每个问卷发布前必须映射到一个报告模板 —— 没映射完的题不能发布。」
 * 章节侧未供料显示缺口（原型实例「按规模分群差异　缺分群字段」）。
 */
export interface ReportSection {
  id: string;
  label: string;
  /** 未供料时的缺口描述；有供料题目时为空 */
  missingField?: string;
}

export const REPORT_TEMPLATE = {
  name: "客户体验诊断",
  sections: [
    { id: "sec-blocker", label: "阻碍分布" },
    { id: "sec-decision", label: "决策链与否决点" },
    { id: "sec-segment", label: "按规模分群差异", missingField: "缺分群字段" },
  ] satisfies ReportSection[],
};

export function mappedQuestions(sectionId: string): SurveyQuestion[] {
  return SURVEY_QUESTIONS.filter((q) => q.reportSectionId === sectionId);
}

/** 质量门禁双阻断（UC-12.2 R7.1）：阻断一 = 诱导性表述；阻断二 = 双向映射未完成（孤儿题 + 缺料章节）*/
export function qualityGateBlockers(): { type: "leading_question" | "mapping_incomplete"; side?: "question" | "section"; label: string }[] {
  const blockers: { type: "leading_question" | "mapping_incomplete"; side?: "question" | "section"; label: string }[] = [];
  for (const q of SURVEY_QUESTIONS) {
    if (q.leadingIssue) blockers.push({ type: "leading_question", label: `Q${q.no} 诱导性表述` });
  }
  for (const q of SURVEY_QUESTIONS) {
    if (q.reportSectionId === null) blockers.push({ type: "mapping_incomplete", side: "question", label: `Q${q.no} 未映射到报告章节` });
  }
  for (const sec of REPORT_TEMPLATE.sections) {
    if (mappedQuestions(sec.id).length === 0) {
      blockers.push({ type: "mapping_incomplete", side: "section", label: `报告『${sec.label}』${sec.missingField ?? "缺供料题目"}` });
    }
  }
  return blockers;
}

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

/* ── 现场快速投票（12.4：60 秒倒计时；未投的人在哪个模块忙）─────────────
 * ⚠ IA 提醒（UC-12.4 R7.1）：原型里现场投票是**主持台知识图谱派发链路**的一个工作类型
 *   （`VT 全场投票` 卡片，与 DR/IT/UX/LG 并列，字节 15,295,586 一带），不是问卷工作台里的
 *   一个独立标签。当前作为问卷工作台第 4 个标签展示，是为了在问卷模块内演示投票结果与
 *   问卷体系共享的匿名口径与分布组件；真正的发起入口应落在主持台的图谱派发卡片上
 *   （该链路不在本模块范围，见 2026-08-09 审计记录）。
 */
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
