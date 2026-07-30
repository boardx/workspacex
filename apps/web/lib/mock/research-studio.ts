/**
 * 研究 Studio（M24 / 契约束 `research`）—— UI 先行原型的 mock 数据源。
 *
 * ⚠ 与既有 `lib/mock/research.ts` **无关**：那份服务 UC-0.2 Context Pack
 *   （「一次研究读了什么 / 丢了什么」）。本文件服务 UC-24.1…24.5
 *   （研究问题 · 证据表 · 候选洞察 · 深度对话 · 七项配置面板）。
 *   grep「研究场景|时间盒|桌面研究」在 research.ts 里 0 命中——本域从零开始。
 *
 * ## 数据都不是编的
 *   · 七项配置的枚举与默认值：`packages/contracts/src/research.ts`
 *     （`ResearchKind` / `ResearchDepth` / `SourceKind` / `Deliverable`）+ `uc-24-1` R3 的默认值表。
 *   · 对话/四段结果/证据表/冲突：`uc-24-2` R3 · `uc-24-3` R3.D · `uc-24-5` R3 的原型逐字示例。
 *   · 量级放大到「像真的」：证据表 12 行（原型给 3 行样例）、来源 14 条、任务 4 个。
 *
 * ## 契约里**故意没有**、集中在本文件的东西（全部「待迁入 packages/contracts」）
 *   · 中文展示标签（`ResearchKind` 的桌面研究/竞品拆解…）—— 契约只落短码，标签是派生展示层。
 *   · 状态文案（Q-10 未裁，契约是 `z.string()`）—— 本文件用原型逐字文案，**不收敛枚举**。
 *   · 去向文案（Q-12 未裁）· 来源简称映射（Q-7 未裁）—— 同上，只摆原型给的值。
 *   · 深度档位两串文案（Q-1 未裁：`note` 卡片文案 vs `DEPTH_L` 预览文案）—— 两串都摆，不选权威。
 *
 * ## 角色：owner / collaborator 两档（U-1 已裁 = B）
 *   研究实体的成员模型是「拥有者 + 协作者」，**不是**工作坊的四种项目角色
 *   （`project/domain.md` 第八节 U-1 推荐 B；原型研究管理区 16.099M–16.125M 里
 *   **没有任何成员/角色/邀请/共享控件**，负向印证了「研究没有四角色」）。
 *   ⚠ 观察者只读（各 UC R5 的 obs 出口=空集，N-10）是**项目语境**的投影，
 *   在本 Studio 里落成七态里的 `denied` 态，不是第三个视角。见 README「无法自洽的点」。
 */
import type { UiState } from "@/lib/ui-state";

/* ─────────────────────────── 视角 / 屏 的解析 ─────────────────────────── */

export const RS_VIEWS = [
  { id: "owner", label: "拥有者", note: "研究发起人 · 全部动作可用" },
  { id: "collaborator", label: "协作者", note: "可读可追问 · 出口/归档/判定按范围受限" },
] as const;
export type RsView = (typeof RS_VIEWS)[number]["id"];

export function resolveRsView(raw?: string | string[]): RsView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return RS_VIEWS.some((r) => r.id === v) ? (v as RsView) : "owner";
}

export const RS_SCREENS = ["list", "plan", "new", "detail", "live"] as const;
export type RsScreen = (typeof RS_SCREENS)[number];
export const RS_SCREEN_LABEL: Record<RsScreen, string> = {
  list: "研究 Studio 列表",
  plan: "研究计划详情",
  new: "新建深度研究",
  detail: "研究主题详情",
  live: "现场深度研究",
};
export const RS_SCREEN_UC: Record<RsScreen, string> = {
  list: "UC-24.3",
  plan: "UC-24.3",
  new: "UC-24.1",
  detail: "UC-24.2 / 24.4",
  live: "UC-24.5",
};
export function resolveRsScreen(raw?: string | string[]): RsScreen {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return RS_SCREENS.includes(v as RsScreen) ? (v as RsScreen) : "list";
}

/* ─────────────────── 七项配置：枚举 + 中文标签（待迁入 packages/contracts 的只有标签）─── */

/** 研究类型。短码来自 `ResearchKind`（契约），标签是派生展示层。`[原型 @16,904,768B]` */
export const RS_KINDS = [
  { code: "desk", label: "桌面研究" },
  { code: "comp", label: "竞品拆解" },
  { code: "reg", label: "监管政策" },
  { code: "cust", label: "客户侧核实" },
] as const;
export const RS_KIND_DEFAULT = "desk"; // uc-24-1 R3 字段 3 默认

/**
 * 深度与时间盒。短码来自 `ResearchDepth`（契约）。
 * ⚠ **两串文案都摆着**（Q-1 未裁）：`note` 是选项卡片文案，`depthL` 是预览句文案。
 *   原型里它们是两个不同常量，措辞不同 `[原型 @16,905,029B]` vs `@16,904,089B]`。
 *   本文件**不选权威**——选了就是替 Q-1 裁。
 */
export const RS_DEPTHS = [
  { code: "fast", label: "快速扫读", note: "8 分钟 · 3 路 · 只要方向", depthL: "8 分钟 · 3 路检索", routes: 3 },
  { code: "std", label: "标准", note: "20 分钟 · 6 路 · 结论带出处", depthL: "20 分钟 · 6 路检索", routes: 6 },
  { code: "deep", label: "深挖", note: "45 分钟 · 12 路 · 交叉验证与冲突标注", depthL: "45 分钟 · 12 路并交叉验证", routes: 12 },
] as const;
export const RS_DEPTH_DEFAULT = "std";

/** 来源偏好五值。取值 = `SourceKind`（契约，中文全称）。默认选中前两项。 */
export const RS_SOURCES = ["官方与监管", "行业报告", "媒体报道", "内部洞察库", "本场转写"] as const;
export const RS_SOURCE_DEFAULT: readonly string[] = ["官方与监管", "行业报告"];
/** ⚠ 内部来源（勾选影响可见范围，X-B / 观察者脱敏） */
export const RS_INTERNAL_SOURCES: readonly string[] = ["内部洞察库", "本场转写"];

/** 交付形式四值 = `Deliverable`（契约）。默认选中「研究简报」。 */
export const RS_DELIVERABLES = ["研究简报", "证据表", "结论卡", "对比表"] as const;
export const RS_DELIVERABLE_DEFAULT: readonly string[] = ["研究简报"];

/** 挂到哪一组：全场共用 + 当前各组（`组名 · 场景`）。`[原型 @16,905,760B]` */
export const RS_GROUPS = [
  { ref: "all", label: "全场共用" },
  { ref: "g2", label: "第 2 组 · 电价机制" },
  { ref: "g3", label: "第 3 组 · 并网审批" },
  { ref: "g4", label: "第 4 组 · 本地化率" },
] as const;
export const RS_GROUP_DEFAULT = "all";

/** 决策节点。`n0` = 不挂节点，只存进洞察库（一等公民选项，R7.4）。默认 `n1`。`[原型 @16,906,274B]` */
export const RS_NODES = [
  { ref: "n1", label: "决策节点：资质可随股权转移？" },
  { ref: "n2", label: "决策节点：合资对象选谁" },
  { ref: "n3", label: "决策节点：首单商业模式" },
  { ref: "n0", label: "不挂节点，只存进洞察库" },
] as const;
export const RS_NODE_DEFAULT = "n1";

/** 新建弹层的默认配置（uc-24-1 R7.5 —— 逐项机械抽取，画反即重做）。 */
export interface RsConfig {
  scene: string;
  question: string;
  kind: string;
  depth: string;
  sources: string[];
  deliverables: string[];
  groupRef: string;
  nodeRef: string;
}
export const RS_CONFIG_DEFAULT: RsConfig = {
  scene: "业主第一次评估储能投资，卡在并网时间不确定",
  question: "德国并网审批的真实中位时长是多少，材料返工会加多久",
  kind: RS_KIND_DEFAULT,
  depth: RS_DEPTH_DEFAULT,
  sources: [...RS_SOURCE_DEFAULT],
  deliverables: [...RS_DELIVERABLE_DEFAULT],
  groupRef: RS_GROUP_DEFAULT,
  nodeRef: RS_NODE_DEFAULT,
};

/** 「另一取值」的配置 —— 证明预览句是算出来的，不是写死的（N-12 / N-4）。 */
export const RS_CONFIG_ALT: RsConfig = {
  scene: "投委会要在两周内决定是否跟投这家 EPC",
  question: "这家 EPC 在建规模与交付履约记录能否独立核实",
  kind: "comp",
  depth: "deep",
  sources: ["官方与监管", "行业报告", "媒体报道", "内部洞察库"],
  deliverables: ["研究简报", "证据表", "对比表"],
  groupRef: "g3",
  nodeRef: "n2",
};

/**
 * 预览句拼接（uc-24-1 R3.3 逐字规则）。
 * ⚠ 深度用 `depthL`（预览串），不是 `note`（卡片串）—— 两串并存是 Q-1。
 * 断言应打在**性质**上（预览句含所选来源的全部名称），不是固定字符串。
 */
export function buildPreview(c: RsConfig): string {
  const kind = RS_KINDS.find((k) => k.code === c.kind)?.label ?? c.kind;
  const depthL = RS_DEPTHS.find((d) => d.code === c.depth)?.depthL ?? c.depth;
  const sources = c.sources.length ? c.sources.join(" / ") : "（未选来源）";
  const outs = c.deliverables.length ? c.deliverables.join(" ＋ ") : "（未选交付）";
  const node = c.nodeRef === "n0" ? "只存进洞察库，不回流决策节点" : "结论回流到所选决策节点并标注置信度";
  return `Scout 会按「${kind}」跑 ${depthL}，来源限定在 ${sources}，产出 ${outs}；${node}。`;
}

/* ─────────────────── UC-24.3 · Studio 研究列表 ─────────────────── */

export interface RsListItem {
  id: string;
  title: string;
  status: string; // ⚠ Q-10 未裁：用原型逐字文案，不收敛枚举
  evidence: number;
  evidenceTarget: number | null; // N-8：null → 渲染 —
  questions: number;
  insights: number;
  parallelRoutes: number;
  tags: string[];
  pinned: boolean;
  createdBy: string;
  archived: boolean;
}

/** 标签筛选行（uc-24-3 R3.A.2）。⚠ 首项 `全部` vs 项目侧 `全部标签` 的差异是 Q-9。 */
export const RS_LIST_TAGS = ["全部", "客户", "内部", "高优先级", "已归档"] as const;

export const RS_LIST_ITEMS: RsListItem[] = [
  {
    id: "r1", title: "德国工商储电价机制", status: "进行中",
    evidence: 41, evidenceTarget: 50, questions: 5, insights: 7, parallelRoutes: 3,
    tags: ["客户", "高优先级"], pinned: true, createdBy: "林可", archived: false,
  },
  {
    id: "r2", title: "欧洲并网审批流程", status: "已完成",
    evidence: 33, evidenceTarget: 30, questions: 4, insights: 6, parallelRoutes: 0,
    tags: ["客户"], pinned: false, createdBy: "林可", archived: false,
  },
  {
    id: "r3", title: "竞品欧洲布局拆解", status: "待复核",
    evidence: 18, evidenceTarget: 40, questions: 6, insights: 2, parallelRoutes: 2,
    tags: ["内部", "高优先级"], pinned: false, createdBy: "周迅", archived: false,
  },
  {
    id: "r4", title: "本地化率补贴口径（2023 版）", status: "已归档",
    evidence: 12, evidenceTarget: null, questions: 3, insights: 1, parallelRoutes: 0,
    tags: ["内部"], pinned: false, createdBy: "周迅", archived: true,
  },
];

/** Studio 左栏研究三段（uc-24-3 R3.C）——三种不同状态各一条。 */
export const RS_SIDEBAR = [
  { title: "德国工商储电价机制", state: "● 进行中 · 证据 41 / 目标 50" },
  { title: "欧洲并网审批流程", state: "已完成 · 已产出简报" },
  { title: "竞品欧洲布局拆解", state: "待复核 · 3 条低置信" },
] as const;

/* ─────────────────── UC-24.3 · 研究计划三计数 + 证据表 ─────────────────── */

export interface RsEvidence {
  id: string;
  question: string; // 分组键
  claim: string;
  sourceShort: string; // ⚠ 简称（Q-7 未裁，与全称映射未定）
  confidence: number | null; // N-8：null → —；N-3：0.3 必须出现不被过滤
  disposition: string; // ⚠ Q-12 未裁：原型给 已引用 / 反对证据
}

export const RS_PLAN_QUESTIONS = [
  "审批周期真实中位时长？",
  "材料返工会加多久？",
  "资质是否随主体变更重新受理？",
  "各州差异有多大？",
  "行业报告与项目样本是否一致？",
];

/**
 * 证据表 12 行，按研究问题分组（原型给 3 行样例，此处放大到像真的）。
 * N-3：含 0.3 低置信行且带标注；N-8：一行 confidence=null 渲染 —。
 */
export const RS_PLAN_EVIDENCE: RsEvidence[] = [
  { id: "e1", question: RS_PLAN_QUESTIONS[0]!, claim: "审批周期中位数 11 个月", sourceShort: "监管年报", confidence: 0.9, disposition: "已引用" },
  { id: "e2", question: RS_PLAN_QUESTIONS[0]!, claim: "全国中位 11 个月，巴伐利亚与北威州相差近 4 个月", sourceShort: "行业", confidence: 0.7, disposition: "已引用" },
  { id: "e3", question: RS_PLAN_QUESTIONS[0]!, claim: "其余 12 条媒体报道 · 含 3 条低可信度已标注", sourceShort: "媒体", confidence: null, disposition: "参考" },
  { id: "e4", question: RS_PLAN_QUESTIONS[1]!, claim: "材料一次过可省约 6 周", sourceShort: "监管年报", confidence: 0.8, disposition: "已引用" },
  { id: "e5", question: RS_PLAN_QUESTIONS[1]!, claim: "「没人愿意为出问题签字」", sourceShort: "访谈 10 · Q3", confidence: 0.8, disposition: "已引用" },
  { id: "e6", question: RS_PLAN_QUESTIONS[1]!, claim: "电网影响评估提交时点决定返工窗口", sourceShort: "行业", confidence: 0.6, disposition: "已引用" },
  { id: "e7", question: RS_PLAN_QUESTIONS[2]!, claim: "一例交割后资质失效延误 9 个月", sourceShort: "判例检索", confidence: 0.3, disposition: "反对证据" },
  { id: "e8", question: RS_PLAN_QUESTIONS[2]!, claim: "仅 1 例判例说明交割后需重新备案，样本太少", sourceShort: "判例检索", confidence: 0.3, disposition: "反对证据" },
  { id: "e9", question: RS_PLAN_QUESTIONS[3]!, claim: "北威州平均比全国快 1.4 个月", sourceShort: "监管年报", confidence: 0.7, disposition: "已引用" },
  { id: "e10", question: RS_PLAN_QUESTIONS[3]!, claim: "巴伐利亚存在积压，个案超 15 个月", sourceShort: "媒体", confidence: 0.4, disposition: "参考" },
  { id: "e11", question: RS_PLAN_QUESTIONS[4]!, claim: "行业报告称平均 7 个月", sourceShort: "行业", confidence: 0.6, disposition: "反对证据" },
  { id: "e12", question: RS_PLAN_QUESTIONS[4]!, claim: "项目样本中位 9.5 个月", sourceShort: "内部洞察库", confidence: 0.8, disposition: "已引用" },
];

export interface RsPlan {
  title: string;
  status: string;
  parallelRoutes: number;
  questionCount: number | null;
  evidenceCount: number | null;
  evidenceTarget: number | null; // N-8 主战场
  candidateInsightCount: number | null;
  questionNote: string; // 跨域注脚（project 环节）
  evidenceNote: string; // 跨域注脚（访谈引述）
  insightNote: string; // 跨域注脚（综合 Studio，Q-11）
}
export const RS_PLAN: RsPlan = {
  title: "德国工商储电价机制", status: "进行中", parallelRoutes: 3,
  questionCount: 5, evidenceCount: 41, evidenceTarget: 50, candidateInsightCount: 7,
  questionNote: "来自项目环节 2 的假设",
  evidenceNote: "含 6 条访谈引述",
  insightNote: "待送综合 Studio 验证",
};

/* ─────────────────── UC-24.2 · 详情：对话 + 四段结果 ─────────────────── */

export interface RsDialogRound {
  ask: string;
  answer: string;
  steps: string[]; // 执行步骤三条（机器可枚举）
}
export const RS_DIALOG: RsDialogRound[] = [
  {
    ask: "德国工商储的并网审批实际要多久？",
    answer:
      "先查了 Bundesnetzagentur 2025 年报与 BVES 会员调查，再逐州比对：全国中位 11 个月，巴伐利亚与北威州相差近 4 个月。有 3 条来源可信度偏低，我单独标了。",
    steps: [
      "检索 23 份材料 · 官方 6 / 行业 5 / 媒体 12",
      "交叉验证：3 条冲突已标为不确定",
      "抽取可规划变量：材料一次过 / 电网影响评估提交时点",
    ],
  },
  {
    ask: "资质随主体变更需不需要重新受理？",
    answer:
      "只找到 1 例判例说明交割后资质要重新备案，样本太少——这条我放进「争议 / 不确定」，不能作为报价依据。",
    steps: ["检索 8 份材料 · 官方 2 / 判例 1 / 媒体 5", "样本量不足：1 例 < 阈值，标为不确定", "未抽取到可规划变量"],
  },
  {
    ask: "各州差异能不能再细一点？",
    answer:
      "北威州平均比全国快 1.4 个月；巴伐利亚有积压，个案超 15 个月。差异来自电网公司排队，不是审批口径。",
    steps: ["检索 11 份材料 · 官方 4 / 行业 4 / 媒体 3", "交叉验证：无新增冲突", "抽取可规划变量：电网公司排队时长"],
  },
];

/** 段 ③ 外部来源表（14 条，含 3 条低置信）。N-3：低置信必须在其中且带标注。 */
export interface RsSource {
  category: string; // 简称类别（Q-7）
  name: string;
  confidence: number | null;
  low: boolean;
  fromTranscript?: boolean; // 本场转写 → 观察者脱敏（X-B）
}
export const RS_EXTERNAL_SOURCES: RsSource[] = [
  { category: "官方", name: "Bundesnetzagentur《Netzanschluss 年报 2025》", confidence: 0.9, low: false },
  { category: "官方", name: "BMWK 并网导则修订说明（2024）", confidence: 0.85, low: false },
  { category: "行业", name: "BVES 会员调查（2025）", confidence: 0.7, low: false },
  { category: "行业", name: "Wood Mackenzie 欧洲储能季报 Q1", confidence: 0.65, low: false },
  { category: "内部", name: "内部洞察库：华东并网项目复盘", confidence: 0.8, low: false },
  { category: "转写", name: "本场转写：EPC 负责人第 2 组发言", confidence: 0.6, low: false, fromTranscript: true },
  { category: "判例", name: "交割后资质重新备案判例（单例）", confidence: 0.3, low: true },
  { category: "媒体", name: "PV-Magazine：巴伐利亚积压报道", confidence: 0.3, low: true },
  { category: "媒体", name: "行业自媒体转述（未署名）", confidence: 0.25, low: true },
  { category: "媒体", name: "其余 12 条 · 含 3 条低可信度已标注", confidence: null, low: true },
];

export interface RsResult {
  keyFindings: string[];
  disputed: string[];
  conclusion: string | null;
  isDataRequest: boolean;
}
export const RS_RESULT: RsResult = {
  keyFindings: [
    "德国并网审批全国中位 11 个月",
    "材料一次过可省约 6 周",
    "州际差异主要来自电网公司排队，不是审批口径",
  ],
  disputed: [
    "行业媒体称 2026 年起将压缩到 6 个月，但监管方尚未发布正式文件。此条按「不确定」保留，不进洞察库。",
    "资质是否随主体变更重新受理：仅 1 例判例，样本太少，保留为争议项，不作为报价依据。",
  ],
  conclusion:
    "以监管年报为准，德国工商储并网审批按 11 个月中位数规划，材料一次过可压缩约 6 周；对巴伐利亚项目额外预留积压缓冲。低置信与争议项已单列，不进洞察库。",
  isDataRequest: false,
};

/* ─────────────────── UC-24.4 · 结论出口三按钮 + 门控阻断 ─────────────────── */

/** 结论区三个出口动作（uc-24-4 R2 逐字）。⚠ 与对话面三动作是两组，不合并（Q-16）。 */
export const RS_CONCLUSION_ACTIONS = ["加入洞察库", "补充资料", "标为关键问题"] as const;
/** 对话面三同族动作（uc-24-4 R2 逐字，`isRes` 分支）。 */
export const RS_LIVE_CONCLUSION_ACTIONS = ["存为洞察", "加入报告", "开一场深度研究"] as const;

/**
 * 入库门控三种阻断（对应契约 `ResearchError` 三码）+ 一种部分成功。
 * ⚠ 必须画成「点了被拒 + 说明」，不是「按钮灰掉」（灰按钮在 API 层挡不住任何东西）。
 */
export const RS_PROMOTE_BLOCKS: Record<string, { code: string; title: string; detail: string; fix: string }> = {
  "no-source": {
    code: "NO_EXTERNAL_SOURCE",
    title: "结论没有挂外部来源，不能进洞察库",
    detail: "项目侧规则逐字：结论必须挂着外部来源才能进洞察库。当前结论段 ③ 外部来源为空。",
    fix: "下一步：点「补充资料」让 Scout 补一路外部来源，或改本研究的来源偏好配置。",
  },
  disputed: {
    code: "EVIDENCE_IS_DISPUTED",
    title: "这条在「争议 / 不确定」段，永不入库",
    detail: "段 ② 的条目按 N-2 永不入洞察库——它是被标记的争议项，不是弱结论。",
    fix: "下一步：先补证据把它移出争议段，或作为反对证据随主结论一起带过去。",
  },
  conflict: {
    code: "CONFLICT_PENDING_HUMAN",
    title: "涉及未判定冲突，等人判定后才能入库",
    detail: "两条结论互相矛盾且尚未由人判定。系统不替人拍板（N-5 / N-6）。",
    fix: "下一步：到「现场深度研究」的冲突待判定区做出判定，再回来入库。",
  },
};

/** 部分成功：入库成功 + 决策节点回流失败（uc-24-4 E2 / DECISION_NODE_GONE）。 */
export const RS_PROMOTE_PARTIAL = {
  insight: "候选洞察已入库 · 待送综合 Studio 验证",
  backflow: { ok: false, reason: "DECISION_NODE_GONE" as const, node: "n2 合资对象选谁" },
  note: "入库已经发生，不会回滚；仅决策节点回流失败，原因可读、可重试。",
};

/* ─────────────────── UC-24.5 · 现场深度研究与冲突判定 ─────────────────── */

export interface RsLiveTask {
  time: string;
  question: string;
  proposer: string; // N-9：提出方留痕
  metric: string; // ⚠ 双语义（Q-17）：无冲突→来源数；有冲突→冲突数
  status: string; // 运行中 / 已就绪 / 待判定
  conflicts: number;
  failed?: boolean;
}
export const RS_LIVE_TASKS: RsLiveTask[] = [
  { time: "12:31", question: "德国三家 EPC 在建规模能否查到", proposer: "第 2 组提出", metric: "运行中", status: "运行中", conflicts: 0 },
  { time: "12:05", question: "并网审批时长的项目样本中位数", proposer: "第 3 组提出", metric: "9 来源", status: "已就绪", conflicts: 0 },
  { time: "11:40", question: "本地化率 40% 的补贴口径原文", proposer: "引导师提出", metric: "3 来源", status: "已就绪", conflicts: 0 },
  { time: "11:12", question: "资质随主体变更是否需重新受理", proposer: "第 2 组提出", metric: "冲突 2 处", status: "待判定", conflicts: 2 },
];

export interface RsConflict {
  id: string;
  statement: string;
  suggestion: string; // ⚠ N-6：一段文字，不是预选值
  actions: readonly string[];
}
/** 冲突判定三动作（uc-24-5 R3.6 逐字）。⚠ 三项平权、无预选、无倒计时（N-6）。 */
export const RS_CONFLICT_ACTIONS = ["以样本为准", "再补一路检索", "上台讨论"] as const;
export const RS_CONFLICTS: RsConflict[] = [
  {
    id: "c1",
    statement: "行业报告说平均 7 个月，项目样本中位 9.5 个月。",
    suggestion: "建议以样本为准，报告标为参考。",
    actions: RS_CONFLICT_ACTIONS,
  },
  {
    id: "c2",
    statement: "一份 EPC 宣传材料称在建 1.2GW，另一路核实到并网备案仅 0.7GW。",
    suggestion: "建议以并网备案为准，宣传口径存疑。",
    actions: RS_CONFLICT_ACTIONS,
  },
];

/** 现场任务头部两个数（uc-24-5 R3.2）。派生自 tasks，不硬编码。 */
export function liveCounts(tasks: RsLiveTask[]) {
  return {
    total: tasks.length,
    ready: tasks.filter((t) => t.status === "已就绪").length,
    conflicts: tasks.reduce((a, t) => a + t.conflicts, 0),
  };
}

/* ─────────────────── 视角 → 出口动作是否可用（预览投影，非权限实现）────────── */

/**
 * collaborator 视角下受限的动作集合（uc-24-4 / 24-5 R5 的 `[设计]`）。
 * ⚠ 这是**预览投影**：真实权限在服务端。owner 全开；observer 只读走 `denied` 态。
 */
export const RS_COLLABORATOR_RESTRICTED: readonly string[] = ["加入洞察库", "标为关键问题"];
export function actionAllowed(view: RsView, action: string): boolean {
  if (view === "owner") return true;
  return !RS_COLLABORATOR_RESTRICTED.includes(action);
}

/** 每屏的 empty 引导文案（空态不得编造示例，A3）。 */
export const RS_EMPTY_HINT: Record<RsScreen, string> = {
  list: "还没有研究 —— 点右上「＋ 新建研究」开始第一场",
  plan: "这个研究计划还没有证据 —— 先让 Scout 跑一轮",
  new: "还没有可挂的决策节点 —— 只能选「不挂节点，只存进洞察库」",
  detail: "零来源：段 ④ 是数据需求说明，不是结论",
  live: "本场还没有研究任务 —— 点「＋ 发起研究」把现场的问题交给 Scout",
};

export function stateFromQuery(raw: string | string[] | undefined): UiState {
  const v = Array.isArray(raw) ? raw[0] : raw;
  const all: UiState[] = ["default", "loading", "empty", "invalid", "dep-failed", "denied", "success"];
  return all.includes(v as UiState) ? (v as UiState) : "default";
}
