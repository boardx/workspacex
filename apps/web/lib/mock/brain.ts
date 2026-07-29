/**
 * 组织大脑 mock 数据 —— 三层记忆模型 + Context Pack 的可审查面。
 *
 * 覆盖 UC-14.6（检索可审查 / 「AI 读到了什么」）、UC-14.4（决策台账）、
 * UC-14.5（五态机与晋升）、UC-14.2（横向复用），密度照 PROTOTYPE-DIGEST §六。
 *
 * ⚠ 纯可序列化数据，无函数/图标/元素。真实的召回、脱敏、权限传播都在服务端。
 */

/** 三层记忆存量（原型：我 86 / 项目 1,482 / 组织 604）*/
export const LAYER_COUNTS = {
  mine: 86,
  project: 1482,
  org: 604,
};

/** 节点类型分布（假设 318、证据 1,204 含反对 96、决策 42）*/
export const NODE_TYPES: { key: string; label: string; count: number; sub?: string }[] = [
  { key: "hypothesis", label: "假设", count: 318 },
  { key: "evidence", label: "证据", count: 1204, sub: "含反对 96" },
  { key: "decision", label: "决策", count: 42 },
];

/** 立身之本的一条规则 —— 必须显著展示 */
export const PROMOTION_RULE =
  "知识不因为「被写下来」就进组织大脑。只有支撑过一个被签字的决策、并在复盘中被验证的判断，才够格晋升。";

/** 私有层条目类型（默认私有 · 组织管理员也看不到，只看到计数）*/
export const PRIVATE_LAYER = {
  note: "默认私有 · 组织管理员也看不到（个人层对管理员封闭，UC-0.3 R7）。管理员只能看到条目计数。",
  formNote: "偏好影响形式，不影响事实：判断偏好只改变 AI 怎么给结论，不改证据。",
  kinds: [
    { key: "prefs", label: "判断偏好", count: 12, example: "结论先行 · 先给区间再给点估计 · 反对意见单列" },
    { key: "drafts", label: "草稿笔记", count: 41, example: "德国 EPC 谈判要点（未定稿）" },
    { key: "records", label: "判断记录", count: 33, example: "为何否掉路径 A 的三条私人理由" },
  ],
};

/** 组织层条目类型（全员可见 · 每条都有有效期）*/
export const ORG_LAYER = {
  note: "全员可见 · 每条都有有效期。",
  kinds: [
    { key: "method", label: "被验证的方法", count: 128, ttl: "无固定到期 · 随复盘更新" },
    { key: "judgment", label: "可复用判断", count: 214, ttl: "视资产类型" },
    { key: "client", label: "客户档案", count: 96, ttl: "12 个月" },
    { key: "industry", label: "行业事实", count: 166, ttl: "6 个月" },
  ],
};

/** 时效衰减 —— 到期转「待复核」，AI 引用时必须提示已过期。当前 14 条 */
export const DECAY = {
  staleCount: 14,
  rules: [
    { key: "reg", label: "监管类", ttl: "12 个月" },
    { key: "market", label: "市场数据", ttl: "6 个月" },
  ],
  note: "到期后转「待复核」：仍在检索范围内、引用时提示已过期，但不参与定题强度计算（D-33）。",
};

/** 横向复用 —— 项目→项目 直接借用标「未沉淀」。本月 9 次 */
export const LATERAL_REUSE = {
  monthCount: 9,
  note: "项目 → 项目 直接借用会标「未沉淀」徽标 + 源项目名，视觉上与组织层引用明确区分。",
  samples: [
    { id: "lr-1", title: "资质尽调清单 v3", from: "华东产业园项目", to: "远洋新能源" },
    { id: "lr-2", title: "德国 EPC 报价基准", from: "北欧海风项目", to: "远洋新能源" },
  ],
};

/** 五态机计数（候选 4 → 已验证 2 → 已批准 1 → 生效 604 → 待复核 14）+ 出口 */
export const STATE_MACHINE = {
  states: [
    { key: "candidate", label: "候选", count: 4 },
    { key: "verified", label: "已验证", count: 2 },
    { key: "approved", label: "已批准", count: 1 },
    { key: "active", label: "生效", count: 604 },
    { key: "review", label: "待复核", count: 14 },
  ],
  exits: [
    { key: "superseded", label: "被替代", count: 7 },
    { key: "revoked", label: "被撤销", count: 41 },
    { key: "rejected", label: "驳回", count: 9 },
  ],
  queuePending: 4,
};

/* ─────────────────────── 决策台账（UC-14.4）─────────────────────── */

export type ReviewState = "待验证" | "已验证" | "已验证·已晋升" | "被推翻";

export interface LedgerRow {
  id: string;
  decision: string;
  project: string;
  decidedBy: string;
  /** 依据强度：支持/反对条数 */
  support: number;
  against: number;
  reviewState: ReviewState;
  reviewDate?: string;
}

export const LEDGER_HEADER = { total: 42, awaitingSign: 2, pendingReview: 9 };

export const AWAITING_SIGN = [
  {
    id: "sign-path-b",
    decision: "采纳路径 B 作为欧洲进入的主路径",
    project: "远洋新能源 · 欧洲市场进入",
    basis: "支撑 9 条（含 2 条反对） · 复盘：待验证",
    confirmNote: "你正在把这条设为可被引用的依据。签字后进入决策台账，不可逆。",
  },
  {
    id: "sign-dd-conclusion",
    decision: "资质可转让性尽调结论：可转让但需重新备案",
    project: "远洋新能源 · 客户尽调",
    basis: "支撑 12 条（含 1 条反对） · 3 条低置信度",
    confirmNote: "你正在把这条设为可被引用的依据。签字后进入决策台账，不可逆。",
  },
] as const;

export const LEDGER_ROWS: LedgerRow[] = [
  { id: "led-1", decision: "以德荷为首发市场，波兰暂缓", project: "欧洲市场进入", decidedBy: "林可", support: 14, against: 2, reviewState: "已验证·已晋升", reviewDate: "6/28" },
  { id: "led-2", decision: "储电资质走本地合资持照", project: "客户尽调", decidedBy: "周宁", support: 9, against: 3, reviewState: "已验证", reviewDate: "7/12" },
  { id: "led-3", decision: "第一版商业模式画布不含收益保底", project: "欧洲市场进入", decidedBy: "林可", support: 6, against: 4, reviewState: "待验证", reviewDate: "7/29" },
  { id: "led-4", decision: "放弃自建 EPC，全部外包", project: "华东产业园", decidedBy: "高琳", support: 5, against: 7, reviewState: "被推翻", reviewDate: "5/30" },
];

/* ─────────────────── AI 读到了什么 · Context Pack（UC-14.6）─────────────────── */

/** 「这次回答检索到什么」按段列出并带 token 数 */
export const RETRIEVAL_SEGMENTS: { key: string; label: string; source: string; tokens: string; sub?: string }[] = [
  { key: "context", label: "客户与项目上下文", source: "组织大脑", tokens: "2.1k" },
  { key: "method", label: "方法", source: "Skill 库", tokens: "3.4k" },
  { key: "evidence", label: "证据片段 · 9 条", source: "项目图谱", tokens: "7.8k", sub: "含 1 条反对（强制保留）" },
  { key: "history", label: "历史决策与复盘", source: "决策台账", tokens: "1.6k" },
];

/** 五种筛选动作（召回/降权/排除/成对/线索）逐条可见，各带条数与理由 */
export const FILTER_ACTIONS = [
  { key: "recall", label: "召回", count: "47 命中", reason: "组织层只取「生效」+「待复核」两态；待复核仍进候选，但不参与定题强度计算。" },
  { key: "downweight", label: "降权", count: "2 条", reason: "适用范围不匹配（如「波兰不在范围内」），标为「跨范围引用」后降权保留——降权不等于排除。" },
  { key: "exclude", label: "排除", count: "1 条", reason: "已撤销条目永久排除；但其反例文本作为「教训」另行召回。" },
  { key: "pair", label: "成对", count: "1 组", reason: "冲突事实的两条同时注入，引擎不替你选，由你裁决。" },
  { key: "clue", label: "线索", count: "3 条路径", reason: "图谱路径只给固定加成，不单独决定结果。" },
] as const;

/** 上下文预算（原型 14.9k / 120k；上限随模型窗口推导，不写死）*/
export const CONTEXT_BUDGET = { used: 14.9, cap: 120, unit: "k", capNote: "上限随模型上下文窗口推导 · gpt-5.2" };

/** 装配后的系统提示只读快照：四段注入 + 硬约束段（原文逐字可见，不可裁剪、不可 AI 改写）*/
export const SYSTEM_PROMPT = {
  redacted: true,
  sections: [
    { id: "role", title: "# 角色", body: "你是战略分析师 Ava，服务远洋新能源的欧洲市场进入项目。" },
    { id: "context", title: "# 客户与项目上下文 ← 组织大脑", body: "客户：远洋新能源（能源组）。目标市场：德国、荷兰。已排除：波兰（适用范围不匹配，见降权）。" },
    { id: "method", title: "# 方法 ← Skill 库", body: "MECE 假设拆解 → 逐条标注致命假设 → 结论先行。" },
    { id: "evidence", title: "# 证据 ← 项目图谱", body: "9 条证据片段（含 1 条反对，强制保留）。每条带页码/时间码锚点，不得引用未在此列出的证据。" },
    { id: "hard-constraint", title: "# 硬约束", body: "不得写入决策节点；不得引用未在上文列出的证据；客户机密材料只能由本地模型处理。" },
  ],
};

/** 三个出口按钮（原型待补：按钮在、目标屏未接线）*/
export const CONTEXT_PACK_EXITS = [
  { key: "log", label: "看这次的完整调用日志", stub: true },
  { key: "reweight", label: "调整检索权重", stub: true, methodOwnerOnly: true },
  { key: "pin", label: "固定这段上下文到本项目", stub: true },
] as const;

/**
 * 丢弃清单（omissions）—— UC-14.6 的立身之本：被丢弃/被裁剪/被权限排除的片段
 * **必须可查、带原因**。
 *
 * ⚠ 裁决 D-U4（2026-07-28）：原因分类是**封闭枚举，唯一事实源在 `lib/omission-reason.ts`**。
 * 此前本文件自带三类（`below-threshold` / `budget-trimmed` / `permission`），
 * 与 research 屏的七类**是两套词汇**——两个屏都在回答「AI 丢了什么」却各说各话，
 * 这正是封闭枚举要防的漂移。已映射到统一词汇：
 *   below-threshold → low-confidence（低置信）
 *   budget-trimmed  → budget（预算截断）
 *   permission      → unauthorized（无授权）
 */
import { type OmissionReason, omissionLabel } from "@/lib/omission-reason";
export type { OmissionReason };

/**
 * 契约里的 `Omission` 是**线上结构**（`{ref, reason, compliance, explain}`）；
 * 这里是**展示视图**（带标题、详情、来源引用）。两者不同层，故名字上分开。
 */
export interface OmissionView {
  id: string;
  title: string;
  reasonType: OmissionReason;
  /** 展示名来自单一事实源，不在此处硬写 */
  reasonLabel?: string;
  /** 逐条的具体原因说明，不是一句「已丢弃」*/
  reason: string;
  relevance?: number;
  /** 权限排除时以脱敏占位呈现：条目存在这一事实可见，内容不可见 */
  masked?: boolean;
}

export const OMISSIONS: OmissionView[] = [
  {
    id: "om-poland",
    title: "波兰储能补贴细则 2023",
    reasonType: "low-confidence",
    reason: "适用地域为波兰，本项目范围为德荷；相关度 0.38 < 本任务类型（decision-support）阈值 0.45。",
    relevance: 0.38,
  },
  {
    id: "om-brainstorm",
    title: "早期头脑风暴便签 · 第 1 周",
    reasonType: "low-confidence",
    reason: "仅由图召回且重排分低（0.41），未命中精确原话/编号/术语通道，被丢弃。",
    relevance: 0.41,
  },
  {
    id: "om-price-history",
    title: "电价历史曲线 2018–2020（完整版）",
    reasonType: "budget",
    reason: "命中但装配时超上下文预算 120k，按相关度截断；属证据段较低优先级，裁剪动作已进丢弃集可审查。",
    relevance: 0.52,
  },
  {
    id: "om-salary",
    title: "客户内部薪酬明细表",
    reasonType: "unauthorized",
    reason: "由高密级与低密级两来源合成，取所有来源的最严格权限；你的角色不满足高密级，条目存在但内容不可见（脱敏占位）。",
    masked: true,
  },
];

/**
 * 「展开」后显示的其余低相关条目（原型：被丢弃 · 14 条低相关 = 4 条明细 + 这 10 条长尾）。
 * 全部 relevance < 0.45（本任务类型阈值），逐条仍带原因——「不得静默丢弃」也适用于长尾。
 */
export const OMISSIONS_MORE: OmissionView[] = [
  { id: "om-2019-tender", title: "2019 荷兰海上风电招标纪要", reasonType: "low-confidence", reasonLabel: "低于相关度阈值", reason: "标的为海上风电，与储能进入策略跨品类；相关度 0.33。", relevance: 0.33 },
  { id: "om-generic-swot", title: "通用 SWOT 模板 · 咨询工具箱", reasonType: "low-confidence", reasonLabel: "低于相关度阈值", reason: "模板类内容无项目事实，重排分 0.29，未命中术语通道。", relevance: 0.29 },
  { id: "om-cn-subsidy", title: "国内储能补贴政策汇编 2024", reasonType: "low-confidence", reasonLabel: "低于相关度阈值", reason: "适用地域为中国，本项目范围德荷；相关度 0.36。", relevance: 0.36 },
  { id: "om-old-quote", title: "2021 EPC 报价单（已失效）", reasonType: "low-confidence", reasonLabel: "低于相关度阈值", reason: "报价已过有效期，仅作历史参照，重排分 0.31。", relevance: 0.31 },
  { id: "om-team-notes", title: "内部周会随手记 · 第 3 周", reasonType: "low-confidence", reasonLabel: "低于相关度阈值", reason: "口语化便签，无结构化结论，仅图召回命中，0.27。", relevance: 0.27 },
  { id: "om-competitor-blog", title: "竞品官网博客译文", reasonType: "low-confidence", reasonLabel: "低于相关度阈值", reason: "营销文案、无一手数据，来源可信度低，0.34。", relevance: 0.34 },
  { id: "om-wiki-grid", title: "维基百科『电网并网』词条", reasonType: "low-confidence", reasonLabel: "低于相关度阈值", reason: "通识性内容与项目结论无直接支撑关系，0.30。", relevance: 0.30 },
  { id: "om-fx-2022", title: "2022 欧元汇率走势备忘", reasonType: "low-confidence", reasonLabel: "低于相关度阈值", reason: "时点过旧，现金流模型已用最新汇率假设，0.32。", relevance: 0.32 },
  { id: "om-hr-headcount", title: "海外派驻人力编制草案", reasonType: "low-confidence", reasonLabel: "低于相关度阈值", reason: "属组织内部事务，非市场进入依据，0.28。", relevance: 0.28 },
  { id: "om-old-persona", title: "上一项目的客户画像 v1", reasonType: "low-confidence", reasonLabel: "低于相关度阈值", reason: "跨客户复用需先降权，已标『跨范围』并低于阈值，0.39。", relevance: 0.39 },
];

/** 未展开的剩余低相关条数（原型：被丢弃 · 14 条低相关 = 4 明细 + 10 长尾）*/
export const OMISSIONS_REMAINING = OMISSIONS_MORE.length;

/** 完整调用日志（Context Pack「看这次的完整调用日志」展开内容）*/
export const RETRIEVAL_LOG: { id: string; ts: string; op: string; detail: string }[] = [
  { id: "lg-1", ts: "14:32:01.220", op: "plan", detail: "任务类型判定 decision-support · 阈值 0.45 · 目标预算 120k" },
  { id: "lg-2", ts: "14:32:01.244", op: "recall", detail: "graph.search(project:远洋, type:[假设,证据]) → 64 命中" },
  { id: "lg-3", ts: "14:32:01.402", op: "recall", detail: "brain.recall(生效+待复核) → 47 命中 · 待复核 3 条不计强度" },
  { id: "lg-4", ts: "14:32:01.510", op: "downweight", detail: "波兰补贴细则等 2 条标『跨范围』降权保留" },
  { id: "lg-5", ts: "14:32:01.560", op: "exclude", detail: "已撤销条目 1 条永久排除 · 反例文本改走『教训』通道" },
  { id: "lg-6", ts: "14:32:01.611", op: "rerank", detail: "混合重排 · 14 条低于阈值进丢弃集（逐条留因）" },
  { id: "lg-7", ts: "14:32:01.703", op: "trim", detail: "装配超预算 · 电价历史曲线按相关度截断" },
  { id: "lg-8", ts: "14:32:01.740", op: "assemble", detail: "注入 4 段 + 硬约束段 · 客户机密仅路由本地模型" },
];

/* ─────────────────── 晋升队列（UC-14.5 五态机 · 候选→已验证 的待审）─────────────────── */

export interface PromotionCandidate {
  id: string;
  title: string;
  project: string;
  /** 当前所处态 */
  fromState: string;
  /** 支撑该条晋升的被签字决策（够格晋升的前提）*/
  backedBy: string;
  /** 复盘验证情况 */
  reviewNote: string;
  /** 支持 / 反对条数（依据强度，反对必列）*/
  support: number;
  against: number;
}

/** 晋升队列 4 条待审（对齐 STATE_MACHINE.queuePending = 4）*/
export const PROMOTION_QUEUE: PromotionCandidate[] = [
  { id: "pq-tariff-method", title: "工商储电价机制核查法（可复用方法）", project: "远洋新能源 · 欧洲市场进入", fromState: "候选", backedBy: "采纳路径 B 作为主路径（待签字）", reviewNote: "复盘：待验证 · 需一次真实项目验证", support: 9, against: 2 },
  { id: "pq-dd-checklist", title: "储能资质可转让性尽调清单 v3", project: "远洋新能源 · 客户尽调", fromState: "已验证", backedBy: "资质可转让但需重新备案（待签字）", reviewNote: "复盘：已验证 1 次 · 达晋升门槛", support: 12, against: 1 },
  { id: "pq-epc-benchmark", title: "德国 EPC 报价基准区间", project: "北欧海风项目 → 远洋（横向）", fromState: "候选", backedBy: "— 尚无被签字决策支撑", reviewNote: "复盘：未验证 · 横向借用中标『未沉淀』", support: 5, against: 3 },
  { id: "pq-grid-timing", title: "各州并网时效实测口径", project: "远洋新能源 · 欧洲市场进入", fromState: "候选", backedBy: "以德荷为首发市场（已验证·已晋升）", reviewNote: "复盘：已验证 · 数据源需季度刷新", support: 8, against: 1 },
];

/* ─────────────────── 推演链（决策台账「看完整推演链/支持链」的展开内容）─────────────────── */

export interface ReasoningStep {
  id: string;
  /** 立场：支持 / 反对（反对必须能被翻出来）*/
  side: "support" | "against";
  claim: string;
  /** 带锚点的出处 */
  source: string;
}

/** 按决策/台账行 id 归集的推演链片段（缺省用 fallback 生成，见组件层）*/
export const REASONING_CHAINS: Record<string, ReasoningStep[]> = {
  "sign-path-b": [
    { id: "rc-pb-1", side: "support", claim: "路径 B 单位度电成本较路径 A 低 11%，回本周期短 8 个月", source: "Ledger 现金流模型 · 敏感性 2/3" },
    { id: "rc-pb-2", side: "support", claim: "德荷并网时效近 12 个月内明显缩短，支撑假设①", source: "Bayernwerk《并网时效季报 2025Q1》第 7 页" },
    { id: "rc-pb-3", side: "against", claim: "补贴退坡后电价套利窗口存在收窄风险，路径 B 对此更敏感", source: "决策台账 · 反对 2 条" },
  ],
  "sign-dd-conclusion": [
    { id: "rc-dd-1", side: "support", claim: "资质主体可依本地合资持照方式承接，法律意见书支持", source: "客户尽调 · 法律意见 v2" },
    { id: "rc-dd-2", side: "support", claim: "同类项目华东产业园已跑通合资持照路径", source: "横向复用 · 资质尽调清单 v3" },
    { id: "rc-dd-3", side: "against", claim: "需重新备案，周期不确定，3 条结论置信度偏低", source: "尽调报告 · 低置信度标注" },
  ],
};

/** 台账行 id → 推演链（无专属链时用支持/反对条数合成一条概览）*/
export function reasoningChainFor(id: string, support: number, against: number): ReasoningStep[] {
  if (REASONING_CHAINS[id]) return REASONING_CHAINS[id];
  return [
    { id: `${id}-s`, side: "support", claim: `${support} 条支持证据（含页码/时间码锚点，可逐条翻查）`, source: "项目图谱 · 证据段" },
    { id: `${id}-a`, side: "against", claim: `${against} 条反对证据（强制保留，不因结论成立而隐藏）`, source: "项目图谱 · 反对段" },
  ];
}
