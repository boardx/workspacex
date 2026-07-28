/**
 * Studio · 研究 的 mock 数据 —— Context Pack（UC-0.2）最直接的消费面。
 *
 * ⚠ 纯数据模块，不带 `"use client"`。核心命题：一次研究要能看到
 *    **读了什么、丢了什么**。丢弃清单（omissions）可查、带原因、可定位到原始来源。
 *    与访谈（撤回 D-13）、问卷（样本量不足）联动：撤回的证据在这里以「已撤回」丢弃项出现。
 */

/* ── 视角（UC-0.2 / UC-6.5 R5）──────────────────────────────────── */
export type ResearchView = "researcher" | "facilitator" | "observer";
export const RESEARCH_VIEWS: { id: ResearchView; label: string; note: string }[] = [
  { id: "researcher", label: "研究员", note: "可查完整读入与丢弃清单、确认洞察入库" },
  { id: "facilitator", label: "引导师", note: "参与并查看与自身角色相关的结果" },
  { id: "observer", label: "观察者", note: "仅只读已发布的脱敏结论，看不到原始丢弃明细" },
];
export function resolveResearchView(raw: string | string[] | undefined): ResearchView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return RESEARCH_VIEWS.some((r) => r.id === v) ? (v as ResearchView) : "researcher";
}
export function canSeeOmissions(view: ResearchView): boolean {
  return view !== "observer";
}

/* ── 研究列表（左栏）：每次研究读了多少、丢了多少 ─────────────── */
export type RunStatus = "building" | "ready" | "delivered";
export const RUN_STATUS_LABEL: Record<RunStatus, string> = {
  building: "组包中", ready: "可用", delivered: "已交付",
};

export interface ResearchRun {
  id: string;
  title: string;
  status: RunStatus;
  read: number;
  dropped: number;
  active?: boolean;
}

export const RESEARCH_RUNS: ResearchRun[] = [
  { id: "rn-1", title: "欧洲进入策略 · 定题上下文包", status: "ready", read: 24, dropped: 9, active: true },
  { id: "rn-2", title: "储能政策与补贴扫描", status: "building", read: 11, dropped: 4 },
  { id: "rn-3", title: "同行落地案例检索", status: "ready", read: 18, dropped: 6 },
  { id: "rn-4", title: "尽调 · 资质可转让性", status: "delivered", read: 31, dropped: 12 },
];

/* ── Context Pack 元信息 ───────────────────────────────────────── */
export const CONTEXT_PACK = {
  name: "欧洲进入策略 · 定题上下文包",
  project: "远洋新能源 / 欧洲市场进入",
  model: "gpt-5.2 ＋ 本地 qwen3-32b",
  generatedAt: "14:12",
  tokenBudget: 800_000,
  tokensUsed: 612_400,
  readCount: 24,
  droppedCount: 9,
} as const;

/* ── 读入清单（读了什么）—— 每条可定位到原始来源 ─────────────── */
export type EvidenceKind = "interview" | "survey" | "regulation" | "canvas" | "decision" | "memory";
export const EVIDENCE_KIND_LABEL: Record<EvidenceKind, string> = {
  interview: "访谈引述", survey: "问卷结论", regulation: "监管文件",
  canvas: "画布节点", decision: "决策台账", memory: "组织大脑",
};

export interface ReadItem {
  id: string;
  kind: EvidenceKind;
  title: string;
  excerpt: string;
  /** 可定位锚点标签（时间码 / 分布 / 页码 / 节点）*/
  anchorLabel: string;
  /** 跨屏定位链接（访谈时间码、问卷分布…）*/
  anchorHref?: string;
  tokens: number;
  confidence: "high" | "medium" | "low";
}

export const READ_ITEMS: ReadItem[] = [
  { id: "ri-1", kind: "interview", title: "采购总监深访 · 责任归属", excerpt: "价格反而不是最卡的，最卡的是签完之后没人敢为收益兜底。", anchorLabel: "时间码 01:18", anchorHref: "/studio/interview#itv-seg-seg-04", tokens: 1_240, confidence: "high" },
  { id: "ri-2", kind: "interview", title: "采购总监深访 · 本地案例", excerpt: "德国业主只认落地过的项目，没有本地灯塔项目就说服不了董事会。", anchorLabel: "时间码 02:47", anchorHref: "/studio/interview#itv-seg-seg-07", tokens: 1_180, confidence: "high" },
  { id: "ri-3", kind: "survey", title: "诊断问卷 Q1 · 首要障碍分布", excerpt: "全体样本 56% 选「收益无人兜底」（n=9）。", anchorLabel: "原始分布 Q1", anchorHref: "/studio/survey#survey-q-q-1", tokens: 640, confidence: "high" },
  { id: "ri-4", kind: "regulation", title: "Bundesnetzagentur《Netzanschluss 年报 2025》", excerpt: "并网审批时限与本地化要求，第 42 页。", anchorLabel: "第 42 页", tokens: 2_100, confidence: "high" },
  { id: "ri-5", kind: "canvas", title: "进入模式假设树 · 路径 B", excerpt: "先试点后放量，节点标 3 个致命假设。", anchorLabel: "flowchart 节点 B", tokens: 820, confidence: "medium" },
  { id: "ri-6", kind: "decision", title: "决策台账 · 优先落地灯塔项目", excerpt: "已签字决策，支撑证据 4 条。", anchorLabel: "决策 dec-11", tokens: 560, confidence: "high" },
  { id: "ri-7", kind: "memory", title: "组织大脑 · 德国工商储客户档案", excerpt: "被验证的方法：以自审计数据换董事会信任。", anchorLabel: "组织层 · 有效期内", tokens: 480, confidence: "medium" },
];

/* ── 丢弃清单（丢了什么）—— 可查、带原因、可定位 ───────────────── */
export type OmissionReason =
  | "withdrawn" | "expired" | "low-confidence" | "unauthorized" | "budget" | "deduped" | "out-of-scope";

export const OMISSION_REASON_LABEL: Record<OmissionReason, string> = {
  withdrawn: "证据已撤回",
  expired: "时效过期",
  "low-confidence": "低置信筛除",
  unauthorized: "无授权 · 数据出域",
  budget: "token 预算截断",
  deduped: "去重 · 已被更强证据覆盖",
  "out-of-scope": "越出项目范围",
};

export interface Omission {
  id: string;
  kind: EvidenceKind;
  title: string;
  reason: OmissionReason;
  /** 为什么丢——一句话可读原因 */
  detail: string;
  /** 原始来源标识，供追查 */
  sourceRef: string;
}

export const OMISSIONS: Omission[] = [
  { id: "om-1", kind: "interview", title: "某区域采购负责人 · 7 条引述", reason: "withdrawn", detail: "受访者已撤回授权，本场引述退出检索；引用过它的报告段标「证据已撤回」，不静默删除。", sourceRef: "访谈场次 itv-0714 · D-13" },
  { id: "om-2", kind: "regulation", title: "2024 版补贴细则（旧）", reason: "expired", detail: "监管类 12 个月到期，已转「待复核」；AI 引用时必须提示已过期，本次不纳入。", sourceRef: "组织大脑 · 监管事实 · 过期 14 条之一" },
  { id: "om-3", kind: "survey", title: "法务口切分结论", reason: "low-confidence", detail: "样本量 n=3 < 8，标为不可推断，仅作定性线索，不进结论。", sourceRef: "问卷 sv-1 · 交叉切分 seg-legal" },
  { id: "om-4", kind: "memory", title: "客户 CRM · 联系人明细", reason: "unauthorized", detail: "含机密且未授权跨范围读取；一个自建 agent 曾尝试访问已被拦截。仅本地模型可读的部分未纳入。", sourceRef: "MCP · 客户CRM · 越权拦截 7 次" },
  { id: "om-5", kind: "interview", title: "第 3 位与会者未认领发言", reason: "low-confidence", detail: "说话人未指派、出处待补，暂不作为可引用证据。", sourceRef: "转录 seg-23 · 11:48" },
  { id: "om-6", kind: "canvas", title: "早期头脑风暴便签 42 条", reason: "deduped", detail: "已被结构化的假设树节点覆盖，去重后不重复占用预算。", sourceRef: "画布 · empathy-map v1" },
  { id: "om-7", kind: "regulation", title: "法国电价机制专题", reason: "out-of-scope", detail: "本项目范围限定德国市场，法国材料越出范围，未纳入。", sourceRef: "材料库 · region:FR" },
  { id: "om-8", kind: "interview", title: "深访后半段 · 质保细节", reason: "budget", detail: "token 预算已用 76%，超预算部分按相关度截断；可提高预算后重跑纳入。", sourceRef: "转录 seg-22 起 · 预算 800k" },
  { id: "om-9", kind: "memory", title: "个人草稿笔记", reason: "unauthorized", detail: "私有层默认私有，组织管理员也看不到，不进上下文包。", sourceRef: "大脑 · 私有层" },
];

export function omissionsByReason(reason: OmissionReason): Omission[] {
  return OMISSIONS.filter((o) => o.reason === reason);
}

/* ── 洞察矩阵 / Claim（右栏）—— 每条挂读入证据（无锚点不合格）────── */
export interface Claim {
  id: string;
  text: string;
  confidence: "high" | "medium" | "low";
  theme: string;
  /** 支撑该结论的读入项 id（可点回原始证据）*/
  evidenceIds: string[];
}

export const CLAIMS: Claim[] = [
  { id: "cl-1", theme: "责任归属", confidence: "high", text: "签约核心障碍是「收益兜底」责任无人承担，价格并非首因。", evidenceIds: ["ri-1", "ri-3"] },
  { id: "cl-2", theme: "本地案例", confidence: "high", text: "本地灯塔项目是说服董事会的前置条件。", evidenceIds: ["ri-2", "ri-6", "ri-7"] },
  { id: "cl-3", theme: "路径选择", confidence: "medium", text: "「先试点后放量」在监管时限与预算窗口下更可行。", evidenceIds: ["ri-4", "ri-5"] },
];
