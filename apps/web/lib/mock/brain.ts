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

/**
 * 节点类型分布（原型 `showBrain` 左栏「节点类型」区，字节 16,227,163 起，五类顺序原样保留）：
 * 问题/决策 42、假设 318、致命假设 61、证据 1,204（含反对 96）、方法/Skill 86。
 * ⚠ 此前只画了三类（假设/证据/决策），漏了「致命假设」「方法/Skill」——已按原型补全（issue #818）。
 */
export const NODE_TYPES: { key: string; label: string; count: number; sub?: string }[] = [
  { key: "decision", label: "问题 / 决策", count: 42 },
  { key: "hypothesis", label: "假设", count: 318 },
  { key: "fatal-hypothesis", label: "致命假设", count: 61 },
  { key: "evidence", label: "证据", count: 1204, sub: "含反对 96" },
  { key: "method-skill", label: "方法 / Skill", count: 86 },
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

/**
 * 组织层条目类型（全员可见 · 每条都有有效期）。
 * 原型 `isBrOrg` 分支「五类资产」网格（字节 16,290,357 起）：
 * 被验证的方法 86 / 可复用判断 241 / 客户档案 38 / 行业事实 198 ——
 * 前四类合计 604＝生效可检索；「反例与教训」41 **另计，不在 604 内**，仅以教训形态召回。
 * ⚠ 此前四类数字（128/214/96/166）系摘要转述错误，且完全没有「反例与教训」类目——已按原型改正（issue #818）。
 */
export const ORG_LAYER = {
  note: "全员可见 · 每条都有有效期。前四类合计 604 条＝生效可检索。",
  kinds: [
    { key: "method", label: "被验证的方法", count: 86, ttl: "无固定到期 · 随复盘更新" },
    { key: "judgment", label: "可复用判断", count: 241, ttl: "视资产类型" },
    { key: "client", label: "客户档案", count: 38, ttl: "12 个月" },
    { key: "industry", label: "行业事实", count: 198, ttl: "6 个月" },
  ],
  /** 反例与教训 —— 另计，不在 604 生效条目内，仅以教训形态被召回，不参与定题强度计算 */
  counterexamples: { key: "counterexample", label: "反例与教训", count: 41, note: "另计 · 不在 604 内 · 仅以教训形态召回" },
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

/**
 * 五种筛选动作（召回/降权/排除/成对/线索）逐条可见，各带条数与理由。
 *
 * ⚠ **键、展示名、说明全部取自契约的单一事实源**（`@/lib/filter-action`）。
 * 此前本文件自带一份，键是 `pair` / `clue`，而契约是 `paired` / `lead`——
 * 两份都自洽，界面按自己那份渲染、后端按自己那份留痕，谁都不会报错，
 * 直到有人想把这一栏和 `items[].retrievalReasons` 对起来（F11 收敛）。
 *
 * 这里剩下的只有**本次装配的条数**——那是数据，不是事实定义。
 */
import { FILTER_ACTION_KEYS, filterActionLabel, filterActionExplain, filterActionTracedIn } from "@/lib/filter-action";
import { relevanceThresholdFor } from "@repo/contracts/thresholds";

/** 原型示例的各动作条数（数据侧，按契约键索引）*/
const FILTER_ACTION_COUNTS: Record<string, string> = {
  recall: "47 命中",
  downweight: "2 条",
  exclude: "1 条",
  paired: "1 组",
  lead: "3 条路径",
};

export const FILTER_ACTIONS = FILTER_ACTION_KEYS.map((key) => ({
  key,
  label: filterActionLabel(key),
  count: FILTER_ACTION_COUNTS[key] ?? "—",
  reason: filterActionExplain(key),
  /**
   * ⚠ 这一动作的痕迹落在 Pack 的哪一段（`items` 还是 `omissions`）。
   * `exclude` 是 `omissions`——被排除的候选不在 `items[]` 里，界面若声称
   * 「五种动作都在上面那张证据表里」就是在说一件做不到的事（KNOWN_CONTRACT_GAPS.G1）。
   */
  tracedIn: filterActionTracedIn(key),
}));

/**
 * 本次装配的任务类型与相关度阈值。
 *
 * ⚠ **阈值不在本文件里**：它是裁决 O-36 的数值，单一事实源在
 * `@repo/contracts/thresholds`（`THRESHOLDS.contextPackRelevance`），按任务类型可配。
 * 收敛前 `0.45` 在本文件出现三次（丢弃条目的说明、长尾注释、调用日志），
 * 一旦有人给某个任务类型配了别的值，这三处会当场向用户说谎而没有任何东西会红。
 */
export const PACK_TASK = "decision-support" as const;
export const RELEVANCE_THRESHOLD = relevanceThresholdFor(PACK_TASK);

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
    reason: `适用地域为波兰，本项目范围为德荷；相关度 0.38 < 本任务类型（${PACK_TASK}）阈值 ${RELEVANCE_THRESHOLD}。`,
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
 * 全部 relevance 低于本任务类型阈值（见 `RELEVANCE_THRESHOLD`），逐条仍带原因——
 * 「不得静默丢弃」也适用于长尾。
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
  { id: "lg-1", ts: "14:32:01.220", op: "plan", detail: `任务类型判定 ${PACK_TASK} · 阈值 ${RELEVANCE_THRESHOLD} · 目标预算 120k` },
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

/* ─────────────────── 推演链与模板（UC-14.4 附属 · 原型 isBrChain 分支）───────────────────
 *
 * 原型左栏「流动」分组第二个按钮「推演链与模板」（字节 16,228,577，徽标数字 3）此前在
 * `apps/web` 全仓 grep 命中 0——`isBrChain` 屏（16,311,110 起）整屏缺失。
 * 屏含两个子视图：`isChGraph`（决策链图：证据/方法/判断/分支/建议/实验/决策 七类节点 +
 * 已选节点详情 + 与模板的偏离对比）与 `isChTpl`（模板库：我的模板 3 + 组织模板 4）。
 * 本次按内容结构补齐（issue #818 问题 1），图编辑器简化为结构化节点列表，
 * 不复刻可拖拽 SVG 画布——后端图编辑能力不在本次「只改 UI 呈现」范围内。
 */

export type ChainNodeType = "evidence" | "counter-evidence" | "method" | "judgment" | "branch" | "suggestion" | "experiment" | "decision";

export const CHAIN_NODE_TYPE_LABEL: Record<ChainNodeType, string> = {
  evidence: "证据",
  "counter-evidence": "反对证据",
  method: "方法",
  judgment: "判断",
  branch: "分支条件",
  suggestion: "建议",
  experiment: "实验",
  decision: "决策",
};

export interface ChainNode {
  id: string;
  type: ChainNodeType;
  title: string;
  /** 置信度 · 人工调整过则带说明 */
  confidence?: string;
  /** 入边说明（支持 N · 削弱 N）*/
  inEdges?: string;
  author?: string;
  selected?: boolean;
  /** AI 不可写入此节点（决策类硬约束）*/
  aiWriteBlocked?: boolean;
}

export interface ChainChangeLogEntry {
  id: string;
  text: string;
  ts: string;
  actor: "人工" | "AI · 可回退";
}

export interface Chain {
  id: string;
  title: string;
  nodes: ChainNode[];
  /** 已选节点的改动记录（对应右侧详情面板）*/
  changeLog: ChainChangeLogEntry[];
  /** 与模板的关系：实例化自哪个模板 + 偏离处数 + 偏离说明 */
  templateRelation: { templateTitle: string; templateOwner: "我的模板" | "组织模板"; deviations: string[] };
}

/** 三条推演链（原型工具条：进入模式决策链 / 资质风险验证链 / 定价策略推演 + ＋新建链）*/
export const CHAINS: Chain[] = [
  {
    id: "chain-entry-mode",
    title: "进入模式决策链",
    nodes: [
      { id: "n-ev-1", type: "evidence", title: "6 条并购判例：可走简化通道", confidence: "0.7" },
      { id: "n-ev-2", type: "evidence", title: "监管年报：审批中位 11 个月", confidence: "0.9" },
      { id: "n-ev-3", type: "counter-evidence", title: "一例交割后资质失效，延误 9 个月", confidence: "0.3" },
      { id: "n-method-1", type: "method", title: "资质尽调清单 v3（12 项） · 组织层" },
      { id: "n-judgment-1", type: "judgment", title: "资质可转让但需重新备案，净省 4–6 个月", confidence: "0.62 · 人工下调 0.1", inEdges: "支持 2 · 削弱 1", author: "Ava，林可编辑过", selected: true },
      { id: "n-branch-1", type: "branch", title: "若尽调结论为「不可转」 · 人工加的" },
      { id: "n-suggest-1", type: "suggestion", title: "收购路径可行，把重新备案写进交割条件 · 主方案" },
      { id: "n-suggest-2", type: "suggestion", title: "转 EPC 合作，牺牲毛利换工期确定性 · 备选" },
      { id: "n-exp-1", type: "experiment", title: "两周尽调：12 项清单逐条比对" },
      { id: "n-decision-1", type: "decision", title: "两周内出尽调结论后再定路径 · 待周宁签字", aiWriteBlocked: true },
    ],
    changeLog: [
      { id: "cl-1", text: "林可 手动加了「若为否」分支和备选建议", ts: "7/25 15:02", actor: "人工" },
      { id: "cl-2", text: "Ava 把反对证据的权重从 0.5 降到 0.3，理由：来源为二手报道", ts: "7/25 14:48", actor: "AI · 可回退" },
    ],
    templateRelation: {
      templateTitle: "进入模式决策 v2",
      templateOwner: "我的模板",
      deviations: ["多了一个分支条件", "少了一步竞品对照"],
    },
  },
  {
    id: "chain-qualification-risk",
    title: "资质风险验证链",
    nodes: [
      { id: "n-q-ev-1", type: "evidence", title: "监管年报：牌照审批中位 11 个月", confidence: "0.8" },
      { id: "n-q-method-1", type: "method", title: "监管风险验证 · 强制插入实验步" },
      { id: "n-q-exp-1", type: "experiment", title: "跨部门合规访谈 · 覆盖三地监管口径" },
      { id: "n-q-decision-1", type: "decision", title: "待补：实验结论未回填", aiWriteBlocked: true },
    ],
    changeLog: [],
    templateRelation: { templateTitle: "监管风险验证", templateOwner: "我的模板", deviations: [] },
  },
  {
    id: "chain-pricing-strategy",
    title: "定价策略推演",
    nodes: [
      { id: "n-p-ev-1", type: "evidence", title: "电价历史曲线 2018–2020", confidence: "0.6" },
      { id: "n-p-judgment-1", type: "judgment", title: "第一版商业模式画布不含收益保底", confidence: "0.55", inEdges: "支持 6 · 削弱 4" },
      { id: "n-p-decision-1", type: "decision", title: "待验证 · 未签字", aiWriteBlocked: true },
    ],
    changeLog: [],
    templateRelation: { templateTitle: "定价策略推演 v1", templateOwner: "组织模板", deviations: ["已归档版本，仅供查阅"] },
  },
];

export interface ChainTemplate {
  id: string;
  title: string;
  /** 5 段骨架的简短标签，用于渲染缩略节点条 */
  skeleton: string[];
  status?: "在用" | "待提名";
  requirement: string;
  appliedCount: number;
  deviationNote?: string;
}

/** 我的模板 · 3（私有，改了不影响别人）*/
export const TEMPLATES_MINE: ChainTemplate[] = [
  { id: "tpl-mine-1", title: "进入模式决策 v2", skeleton: ["证据", "方法", "判断", "建议", "决策"], status: "在用", requirement: "适用：多路径战略选择。要求至少 1 条反对证据、1 个致命假设、决策必须人签字。", appliedCount: 3, deviationNote: "偏离 2 处" },
  { id: "tpl-mine-2", title: "监管风险验证", skeleton: ["证据", "方法", "判断", "分支", "决策"], status: "待提名", requirement: "适用：涉牌照与合规的判断。强制插入一步「实验」，不允许直接从判断跳到决策。", appliedCount: 1 },
];

/** 组织模板 · 4（已晋升，全员可套用；改动要走晋升队列）*/
export const TEMPLATES_ORG: { id: string; title: string; requirement: string; author: string; appliedCount: number; archived?: boolean }[] = [
  { id: "tpl-org-1", title: "市场进入四步推演", requirement: "市场吸引力 → 模式可行性 → 执行前提 → 决策", author: "周宁", appliedCount: 11 },
  { id: "tpl-org-2", title: "组织架构调整推演", requirement: "必须含一条「关键人反对」证据", author: "高琳", appliedCount: 6 },
  { id: "tpl-org-3", title: "并购尽调推演", requirement: "判断与决策之间强制插入实验步", author: "组织", appliedCount: 4 },
  { id: "tpl-org-4", title: "定价策略推演 v1", requirement: "已被 v2 取代，仅供查阅", author: "组织", appliedCount: 2, archived: true },
];

/** 模板库的两条设计规则说明 */
export const TEMPLATE_RULES = {
  scope: { title: "模板管什么、不管什么", body: "管结构与硬性要求（必须有反对证据、决策必须人签字）；不管结论。同一个模板在两个项目里可以推出相反的决策，这是对的。" },
  deviation: { title: "偏离不是错误", body: "链可以随时脱离模板。系统只标出偏离在哪，让你决定是回填模板还是本项目特例——反复出现的偏离通常意味着模板该升版了。" },
};
