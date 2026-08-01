/**
 * Studio · 访谈 —— 列表 / 模板库 / 研究设计 / 受访者名单 / 证据矩阵 的 mock 数据
 * （UC-6.0 · UC-6.1 · UC-6.2 · UC-6.3 屏B · UC-6.5 · UC-6.7 访谈侧投影）
 *
 * ⚠ 纯数据模块，**不带 `"use client"`**——同时被服务端页面与客户端子组件 import。
 *    密度参照 `ui-preview/PROTOTYPE-DIGEST.md` 与各 UC 的 R8 原样清单：
 *    列表行携带七列信息、模板库五要素、大纲每段两层结构、名单 27 位取子集。
 *
 * ⚠⚠ **本文件里的枚举/阈值都是「待迁入 packages/contracts」的临时集中点**。
 *    phase-01 的契约束正由另一个 agent 并行建立；契约就绪后这些常量应改为
 *    `export { X } from "@repo/contracts/interview"`，组件不受影响。
 *    现阶段刻意集中成一份、不散落进组件，避免重演「同一事实声明在两处」。
 *
 *    已复用而非重定义的既有单一事实源：
 *      · 撤回链 SLA → `lib/withdrawal-flow.ts`
 *      · 现场转录 / 授权 / 洞察候选 / 研究问题 → `lib/mock/interview.ts`
 *      · 受访者四项同意位口径 → `lib/mock/entry.ts`（受访者屏）
 */

/* ═══════════════════════════════════════════════════════════════════════
 * UC-6.0 · 范围切换器（scope switcher）
 * R8：「不属于任何项目」是一等范围，不是兜底桶；project_id 可空。
 * R10 [待确认]：是否还有「全部」「按项目分组」档位——原型只显示两档，未探明。
 * ═════════════════════════════════════════════════════════════════════ */

export type ScopeKind = "research-project" | "none";

/**
 * 范围切换器的一档（展示层）。⚠ 原名 `InterviewScope` —— 与契约 `interview.InterviewScope`
 * **同名不同义**：契约那份是**范围值对象** `{kind, projectId, researchProjectId}`
 * （回答「这条访谈属于哪里」），这份是**切换器上的一个可点档位**
 * `{id, kind, label, count}`——带展示文案与该范围下的访谈计数，契约里两者都没有。
 * ⇒ 改名分离，无取值分歧（`kind` 的 `research-project` / `none` 与契约
 * `InterviewScopeKind` 同义，收敛时应改为从契约派生）。
 */
export interface InterviewScopeView {
  id: string;
  kind: ScopeKind;
  label: string;
  /** 该范围下的访谈数（跨项目汇总口径，R6 AC1）*/
  count: number;
}

export const INTERVIEW_SCOPES: InterviewScopeView[] = [
  { id: "rp-procurement", kind: "research-project", label: "研究项目 · 采购决策如何形成", count: 22 },
  { id: "unassigned", kind: "none", label: "不属于任何项目", count: 5 },
];

export function resolveScope(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return INTERVIEW_SCOPES.some((s) => s.id === v) ? (v as string) : INTERVIEW_SCOPES[0]!.id;
}

/** [待确认] 需在 sign-off 时裁决的范围档位——界面上以说明条呈现，不臆造实现 */
export const SCOPE_OPEN_QUESTIONS =
  "原型只见两档（当前研究项目 / 不属于任何项目）。是否还需要「全部」「按项目分组」等档位、以及进来先看哪一档（默认值），属 UC-6.0 R8/R10 的待确认项。";

/* ═══════════════════════════════════════════════════════════════════════
 * UC-6.0 · 列表与筛选 + 虚拟/真人混排强标记 + 挂到项目环节
 * ═════════════════════════════════════════════════════════════════════ */

export const INTERVIEW_FILTERS = [
  { key: "all", label: "全部标签" },
  { key: "client", label: "客户" },
  { key: "internal", label: "内部" },
  { key: "priority", label: "高优先级" },
  { key: "archived", label: "已归档" },
] as const;
export type InterviewFilterKey = (typeof INTERVIEW_FILTERS)[number]["key"];

export type InterviewStatus = "running" | "done" | "prepping" | "draft";
export const INTERVIEW_STATUS_LABEL: Record<InterviewStatus, string> = {
  running: "执行", done: "完成", prepping: "筹备", draft: "草稿",
};

/**
 * 访谈列表行（展示层）。⚠ 原名 `InterviewRow` —— 与契约 `interview.InterviewRow`
 * **同名不同义**：契约是 `{interviewId,title,sourceKind,scope,tags,archived,whenAt}`，
 * 这份是渲染一行所需的 `{object,objectInitials,belongsTo,owner,status,progress,
 * metric,scopeId,projectId,virtual,tags,actions}`——含首字母、一句话进展、行尾动作按钮。
 * ⇒ 改名分离，无取值分歧。
 * ⚠ `lib/mock/itv.ts` 里另有一份同用途、字段不同的行模型（本仓「两套访谈界面并存」
 * 的一部分），那边也已改名——**两套并存本身是待收敛的债**，不属本次门控范围。
 */
export interface InterviewRowView {
  id: string;
  /** 对象（受访者/对象描述）——列表默认只显示描述，联系方式进详情（R9 隐私）*/
  object: string;
  objectInitials: string;
  /** 所属项目或研究项目 · 负责人 */
  belongsTo: string;
  owner: string;
  status: InterviewStatus;
  /** 一句话进展 */
  progress: string;
  /** 计量（时长 / 进度 / 引述数）*/
  metric: string;
  scopeId: string;
  /** null = 不属于任何项目（一等状态，中性徽标）*/
  projectId: string | null;
  /** 虚拟/数字人来源——必须在列表行就强标记（D-25），计数与真人分列 */
  virtual: boolean;
  tags: InterviewFilterKey[];
  /** 行尾动作按钮语义 */
  actions: ("open" | "live" | "insight" | "rerun")[];
}

export const INTERVIEW_ROWS: InterviewRowView[] = [
  {
    id: "i-wang", object: "业主 A · 采购总监", objectInitials: "王",
    belongsTo: "欧洲进入策略 · 林可", owner: "林可", status: "running",
    progress: "第 3 段进行中：替代方案与不作为。", metric: "38:20 / 60 分",
    scopeId: "rp-procurement", projectId: "p-europe", virtual: false,
    tags: ["client", "priority"], actions: ["open", "live"],
  },
  {
    id: "i-epc", object: "EPC B · 项目负责人", objectInitials: "李",
    belongsTo: "欧洲进入策略 · 高琪", owner: "高琪", status: "done",
    progress: "9 条引述已抽取，3 条支撑「资质可转让性」。", metric: "52 分钟 · 7/24 题",
    scopeId: "rp-procurement", projectId: "p-europe", virtual: false,
    tags: ["client"], actions: ["open", "insight"],
  },
  {
    id: "i-weber", object: "P-10 Weber · 采购总监", objectInitials: "W",
    belongsTo: "欧洲进入策略 · 林可", owner: "林可", status: "prepping",
    progress: "同意书待签（拒绝 AI 分析），授权链接已发。", metric: "计划 60 分 · 授权 3/4",
    scopeId: "rp-procurement", projectId: "p-europe", virtual: false,
    tags: ["client", "priority"], actions: ["open"],
  },
  {
    id: "i-de-persona", object: "DE 德国采购总监 · 数字人", objectInitials: "DE",
    belongsTo: "由 12 场真人访谈构造", owner: "Echo（AI）", status: "done",
    progress: "3 轮压力提问，用来预演真人问法，标为探索性。", metric: "28 分钟 · 探索性",
    scopeId: "rp-procurement", projectId: "p-europe", virtual: true,
    tags: ["client"], actions: ["open", "rerun"],
  },
  {
    id: "i-logistics", object: "某物流园区运营总监", objectInitials: "运",
    belongsTo: "不属于任何项目 · 林可", owner: "林可", status: "done",
    progress: "跨项目历史访谈，作储能采购决策链参考。", metric: "44 分钟 · 6 引述",
    scopeId: "unassigned", projectId: null, virtual: false,
    tags: ["priority"], actions: ["open", "insight"],
  },
  {
    id: "i-internal-cfo", object: "内部 · 财务口审批人", objectInitials: "财",
    belongsTo: "不属于任何项目 · 周衡", owner: "周衡", status: "draft",
    progress: "刚从「竞品切换动因」模板新建，大纲待确认。", metric: "草稿 · 未排期",
    scopeId: "unassigned", projectId: null, virtual: false,
    tags: ["internal"], actions: ["open"],
  },
  {
    id: "i-archived", object: "旧客户 · 采购委员会主席", objectInitials: "陈",
    belongsTo: "东南亚储能预研 · 高琪", owner: "高琪", status: "done",
    progress: "已归档；被 2 份报告引用，1 条引述已随撤回失效。",
    metric: "61 分钟 · 已归档",
    scopeId: "unassigned", projectId: null, virtual: false,
    tags: ["archived"], actions: ["open", "insight"],
  },
];

/** 真人 / 虚拟分列计数（D-25：不能混入同一计数）*/
export function interviewCounts(scopeId: string): { real: number; virtual: number } {
  const rows = INTERVIEW_ROWS.filter((r) => r.scopeId === scopeId);
  return {
    real: rows.filter((r) => !r.virtual).length,
    virtual: rows.filter((r) => r.virtual).length,
  };
}

/** 「挂到项目环节…」可选目标（复用 studio.ts 同款语义；此处独立以免耦合原型域）*/
export const ATTACH_STAGES = [
  { id: "st-3", label: "欧洲市场进入 · 环节 3「商业模式共创」" },
  { id: "st-4", label: "欧洲市场进入 · 环节 4「一线访谈」" },
  { id: "st-5", label: "欧洲市场进入 · 成果沉淀 · 决策报告" },
  { id: "st-x", label: "东南亚储能预研 · 环节 1「市场扫描」" },
] as const;

/* ═══════════════════════════════════════════════════════════════════════
 * UC-6.1 · 访谈模板库
 * R8：每行五要素 名称｜用过 N 次｜一句话说明｜题数｜时长区间；[编辑][用它新建]。
 * 时长是区间；用过 N 次是统计值不可手填；标注来源（原创 / 从访谈抽取）。
 * ═════════════════════════════════════════════════════════════════════ */

export interface InterviewTemplate {
  id: string;
  name: string;
  /** 统计值——由实际套用次数累计，不可手填（R7）*/
  usedCount: number;
  desc: string;
  questionCount: number;
  durationMin: number;
  durationMax: number;
  tags: InterviewFilterKey[];
  /** 来源：原创 vs 从已办访谈反向抽取（草案确认后入库）*/
  source: "original" | "extracted";
  /** 从哪几场访谈抽取（source==="extracted" 时可溯源）*/
  extractedFrom?: string[];
  /** extracted 且尚未确认 → 草案，不在正式库列表默认显示为可用 */
  draft?: boolean;
}

export const INTERVIEW_TEMPLATES: InterviewTemplate[] = [
  {
    id: "tpl-procurement-chain", name: "采购决策链", usedCount: 9,
    desc: "谁拍板、谁能否决、卡在哪一步", questionCount: 12, durationMin: 45, durationMax: 60,
    tags: ["client", "priority"], source: "original",
  },
  {
    id: "tpl-jtbd", name: "JTBD 深访", usedCount: 14,
    desc: "还原上一次真实购买的完整经过", questionCount: 9, durationMin: 60, durationMax: 60,
    tags: ["client"], source: "original",
  },
  {
    id: "tpl-switch", name: "竞品切换动因", usedCount: 6,
    desc: "为什么换、为什么没换", questionCount: 8, durationMin: 40, durationMax: 40,
    tags: ["client", "internal"], source: "original",
  },
  {
    id: "tpl-compliance", name: "合规红线摸底", usedCount: 3,
    desc: "数据出境、法务一票否决点、审批链路", questionCount: 10, durationMin: 45, durationMax: 60,
    tags: ["internal", "priority"], source: "extracted",
    extractedFrom: ["欧洲进入策略 · 采购总监深访", "东南亚储能预研 · 法务访谈", "内部 · 财务口审批人"],
  },
  {
    id: "tpl-lighthouse", name: "本地灯塔项目说服力", usedCount: 2,
    desc: "本地案例对董事会信任的作用与门槛", questionCount: 7, durationMin: 40, durationMax: 50,
    tags: ["client"], source: "extracted",
    extractedFrom: ["欧洲进入策略 · EPC 项目负责人", "欧洲进入策略 · 业主 A 采购总监"],
    draft: true,
  },
];

/* ═══════════════════════════════════════════════════════════════════════
 * UC-6.2 · 研究设计（三步向导 + 上下文三要素 + 大纲 + 研究计划参数）
 * ═════════════════════════════════════════════════════════════════════ */

/** 三步向导 */
export const WIZARD_STEPS = [
  { id: "template", label: "选模板" },
  { id: "subjects", label: "选对象" },
  { id: "outline", label: "生成提纲" },
] as const;
export type WizardStepId = (typeof WIZARD_STEPS)[number]["id"];

/** 上下文三要素（谁｜在什么处境｜要做什么决定）*/
export const RESEARCH_CONTEXT = {
  who: "远洋新能源采购委员会的关键决策人（采购/财务/法务三方）",
  situation: "评估过三家储能方案、最后都没签，卡在收益兜底与责任归属上",
  decision: "判断进入欧洲市场时应主打「本地灯塔项目 + 可自审计」还是「低价快铺」",
} as const;

/** 方法论声明（两条必须常驻，原文，AC3）*/
export const METHODOLOGY_STATEMENTS = [
  {
    id: "rq-not-question",
    title: "研究问题 ≠ 提给受访者的问题",
    body: "内部问题（『卡点是不是责任无人承担？』）要改成经历型提问（『上一次评估到最后没往下走，当时最后一次会议是怎么结束的？』）。",
  },
  {
    id: "outline-not-script",
    title: "大纲是提示不是台本",
    body: "现场按对方的话走，AI 会盯覆盖度。—— 这是 UC-6.4 覆盖度作为「结果度量」而非「必答清单」的理由。",
  },
] as const;

export interface OutlineSegment {
  no: number;
  minutes: number;
  /** 该段目标：要问出什么（写在问法前面，顺序不可颠倒，AC1）*/
  goal: string;
  /** 开场问法（≥2 条）*/
  openings: string[];
  /** 质量提示：该段是否还需改问法（原型示例 `2 段还需你改问法`）*/
  needsRework?: boolean;
  /** 命中「照抄研究问题」→ 给经历型改写示例（E1）*/
  leadingRewrite?: { from: string; to: string };
}

export const OUTLINE_SEGMENTS: OutlineSegment[] = [
  {
    no: 1, minutes: 5,
    goal: "确认他在决策链上的位置，以及最近一次真实经历",
    openings: [
      "你在最近一次储能评估里负责哪一段？",
      "那次是谁最先提出要看这个方案的？",
    ],
  },
  {
    no: 2, minutes: 20,
    goal: "把从动心到签字（或黄掉）的每一步和卡点还原出来",
    openings: [
      "从最开始动心到最后一次会议，中间都经过了谁？",
      "哪一步花的时间最长，为什么？",
    ],
  },
  {
    no: 3, minutes: 20,
    goal: "识别一票否决点与真实反对意见",
    openings: [
      "上一次评估到最后没往下走，当时最后一次会议是怎么结束的？",
      "卡点是不是责任无人承担？", // 故意照抄研究问题 → 触发 E1
    ],
    needsRework: true,
    leadingRewrite: {
      from: "卡点是不是责任无人承担？",
      to: "签字那一步，最后是谁来拍的板？如果没人拍，通常卡在谁那里？",
    },
  },
  {
    no: 4, minutes: 10,
    goal: "补问遗漏，确认引用与后续联系授权",
    openings: [
      "还有什么我没问到但你觉得重要的？",
      "如果我们引用你刚才那句话，需要匿名吗？",
    ],
    needsRework: true,
  },
];

export function outlineTotalMinutes(): number {
  return OUTLINE_SEGMENTS.reduce((s, seg) => s + seg.minutes, 0);
}
export function outlineReworkCount(): number {
  return OUTLINE_SEGMENTS.filter((s) => s.needsRework).length;
}

/**
 * 研究计划参数（四行；数据保留一行两语义）
 * ⚠ 保留天数**从项目参数渲染**（材料保留期），代码里不写死——见 UC-5.4 / O-01。
 *    此处的 180 是「项目参数的示例取值」，属 mock 数据不是代码常量；组件只引用本字段。
 */
export const RESEARCH_PLAN = {
  suggestedSessions: "22 场（含 4 场多人访谈）",
  perSessionPeople: "1–3 人（同组织不超过 2 人）",
  duration: "60 分（多人场 90 分）",
  /** 从项目「材料保留期」参数渲染 */
  retentionParam: { label: "数据保留", days: 180, source: "项目参数 · 材料保留期" },
  /** 独立开关，与保留期同面板 */
  noTraining: true,
} as const;

/** 大纲当前状态：AI 生成 → 待你确认（未确认不得进现场，AC5）*/
export type OutlineState = "ai-generated-pending" | "confirmed";
export const OUTLINE_STATE_LABEL: Record<OutlineState, string> = {
  "ai-generated-pending": "AI 已按目标生成 · 待你确认",
  confirmed: "已确认 · 可进入现场",
};

/* ═══════════════════════════════════════════════════════════════════════
 * UC-6.3 屏B / UC-6.7 访谈侧 · 受访者名单与角色（27 位取子集）
 * 同意书三态：全部已授权 / 拒绝 AI 分析 / 待签（只读展示，无勾选控件）
 * ═════════════════════════════════════════════════════════════════════ */

export type ConsentState = "all" | "refuse-ai" | "pending";
export const CONSENT_STATE_LABEL: Record<ConsentState, string> = {
  all: "全部已授权", "refuse-ai": "拒绝 AI 分析", pending: "待签",
};
export const CONSENT_STATE_TONE: Record<ConsentState, "primary" | "warning" | "outline"> = {
  all: "primary", "refuse-ai": "warning", pending: "outline",
};

export interface Respondent {
  id: string;
  /** 显示名——匿名/拒绝实名者用代称 */
  name: string;
  roleTitle: string;
  type: string;
  source: string;
  language: string;
  consent: ConsentState;
  /** 同意书提交时间（consent!==pending 时有）*/
  submittedAt?: string;
  tags: string[];
  /** 关系标签（含拆场标记）*/
  relations?: string;
  /** 联系方式：默认遮盖，[查看] 需权限且写审计（R8 [设计]）*/
  contactMasked: string;
  contactFull: string;
  needsCaption?: boolean;
}

export const RESPONDENTS: Respondent[] = [
  {
    id: "P-04", name: "业主 A · 采购总监", roleTitle: "采购总监 · 远洋物流园",
    type: "成熟用户", source: "行业协会", language: "中文", consent: "all",
    submittedAt: "07-26 14:12", tags: ["决策者"], contactMasked: "138 •••• 2049", contactFull: "138 8827 2049",
  },
  {
    id: "P-07", name: "EPC B · 项目负责人", roleTitle: "项目负责人 · 中德 EPC",
    type: "成熟用户", source: "客户引荐", language: "中文", consent: "all",
    submittedAt: "07-25 09:40", tags: ["执行方"], contactMasked: "159 •••• 6613", contactFull: "159 3301 6613",
  },
  {
    id: "P-09", name: "某区域采购负责人", roleTitle: "区域采购 · 华东",
    type: "从未评估", source: "冷启邀约", language: "中文", consent: "all",
    submittedAt: "07-27 20:03", tags: ["观望者"], contactMasked: "137 •••• 8890", contactFull: "137 2245 8890",
  },
  {
    id: "P-10", name: "Weber", roleTitle: "采购总监 · Müller GmbH",
    type: "成熟用户", source: "行业协会", language: "德语", consent: "refuse-ai",
    submittedAt: "07-28 08:15", tags: ["决策者"], relations: "与 P-11 同公司",
    contactMasked: "+49 •••• •••• 41", contactFull: "+49 151 2277 41",
  },
  {
    id: "P-11", name: "Kraus", roleTitle: "采购专员 · Müller GmbH",
    type: "成熟用户", source: "行业协会", language: "德语", consent: "all",
    submittedAt: "07-28 08:41", tags: ["执行者"], relations: "P-10 的下属 · 已拆场",
    contactMasked: "+49 •••• •••• 07", contactFull: "+49 160 8841 07",
  },
  {
    id: "P-12", name: "匿名", roleTitle: "物流园区运营 · 荷兰",
    type: "从未评估", source: "冷启邀约", language: "英语", consent: "pending",
    tags: ["要求匿名", "需字幕"], relations: undefined,
    contactMasked: "+31 •••• •••• 88", contactFull: "+31 6 4412 5588", needsCaption: true,
  },
];

/** 头部计数（22 场次 · 27 位受访者）*/
export const ROSTER_SUMMARY = { sessions: 22, respondents: 27 } as const;

/** 本场角色 */
export const SESSION_ROLES = [
  { id: "host", name: "林可", role: "主持人" },
  { id: "cohost", name: "周宁", role: "联合主持" },
  { id: "observer", name: "高琳", role: "观察员 · 隐藏" },
  { id: "recorder", name: "Echo", role: "记录 ＋ 实时中译" },
] as const;

/** 多人访谈设置 · 七个开关（默认值来自原型；最后一项默认关）*/
export const MULTIPARTY_SWITCHES = [
  { id: "see-identity", label: "参与者可看到彼此身份", on: true },
  { id: "allow-discuss", label: "允许互相讨论", on: true },
  { id: "host-rollcall", label: "主持人轮流点名", on: true },
  { id: "live-caption", label: "显示实时字幕", on: true },
  { id: "hide-observer", label: "隐藏观察员", on: true },
  { id: "observer-private", label: "观察员可向主持人私密建议", on: true },
  { id: "show-ai-suggestions", label: "向受访者展示 AI 建议", on: false },
] as const;

/** [AI 建议人选] 候选卡——出现在表下方而非直接插入行；三出口；不自动填联系方式 */
export interface CandidateSuggestion {
  id: string;
  name: string;
  reason: string;
  source: string;
}
export const AI_CANDIDATE_SUGGESTIONS: CandidateSuggestion[] = [
  {
    id: "cand-1", name: "某储能 EPC 商务负责人（待核实）",
    reason: "现有名单缺「执行方视角」的价格与质保谈判亲历者，可补足 RQ4 预算窗口的对立面。",
    source: "行业数据库 · 近 12 个月中德储能 EPC 招标公示（MCP：行业数据库，已授权）",
  },
  {
    id: "cand-2", name: "荷兰某物流园区能源经理（待核实）",
    reason: "P-12 拒签风险高，需一位同类型备份；该人所在园区已落地本地灯塔项目，正对 RQ3。",
    source: "冷启名单 · 行业协会公开名录",
  },
];

/* ═══════════════════════════════════════════════════════════════════════
 * UC-6.5 · 主题 × 受访者 证据矩阵（五取值）+ 写作约束
 * R8：五种格子必须五种可辨识视觉；附和/反例不能长得像弱。列头点开看同意位。
 * ═════════════════════════════════════════════════════════════════════ */

export type Evidence = "strong" | "weak" | "none" | "echo" | "counter";
export const EVIDENCE_LABEL: Record<Evidence, string> = {
  strong: "强", weak: "弱", none: "未提及", echo: "附和", counter: "反例",
};
/** 五种可辨识视觉（色 + 形，兼顾色盲：附和用虚线、反例用叉、强用实心）*/
export const EVIDENCE_STYLE: Record<Evidence, { tone: string; glyph: string; hint: string }> = {
  strong: { tone: "bg-primary text-primary-foreground", glyph: "●", hint: "独立强证据" },
  weak: { tone: "bg-warning/40 text-background-foreground", glyph: "◐", hint: "弱信号，待补证" },
  none: { tone: "bg-muted text-muted-foreground", glyph: "–", hint: "未提及" },
  echo: { tone: "border border-dashed border-warning text-warning-foreground bg-warning/10", glyph: "≈", hint: "附和 · 从众风险，不计入强度" },
  counter: { tone: "bg-destructive/15 text-destructive border border-destructive", glyph: "✕", hint: "反例 · 报告必须保留" },
};

export interface MatrixColumn {
  id: string;
  /** 虚拟来源列必须强标记 */
  virtual?: boolean;
}
export const MATRIX_COLUMNS: MatrixColumn[] = [
  { id: "P-04" }, { id: "P-07" }, { id: "P-09" },
  { id: "P-10" }, { id: "P-11" }, { id: "P-12" },
  { id: "DE-虚拟", virtual: true },
];

export interface MatrixRow {
  theme: string;
  cells: Record<string, Evidence>;
  /** 写作约束提示（挂在具体主题上）*/
  note?: string;
}
export const MATRIX_ROWS: MatrixRow[] = [
  {
    theme: "责任归属无人承担",
    cells: { "P-04": "strong", "P-07": "strong", "P-09": "none", "P-10": "strong", "P-11": "echo", "P-12": "counter", "DE-虚拟": "strong" },
    note: "P-11 对『责任归属』是在其上级 P-10 发言后附和，标为从众风险不计入强度；P-12 提供唯一反例，报告必须保留。",
  },
  {
    theme: "法务是隐形门槛",
    cells: { "P-04": "none", "P-07": "weak", "P-09": "strong", "P-10": "strong", "P-11": "none", "P-12": "none", "DE-虚拟": "weak" },
  },
  {
    theme: "本地案例决定信任",
    cells: { "P-04": "strong", "P-07": "strong", "P-09": "weak", "P-10": "weak", "P-11": "strong", "P-12": "none", "DE-虚拟": "strong" },
  },
  {
    theme: "测算不可信",
    cells: { "P-04": "weak", "P-07": "none", "P-09": "strong", "P-10": "none", "P-11": "weak", "P-12": "strong", "DE-虚拟": "none" },
    note: "『测算不可信』只有 2 位强证据但表述最激烈——比『本地案例』弱得多，报告不能写成「用户普遍认为」。",
  },
];

export const MATRIX_SUMMARY = { sessions: 9, respondents: 12 } as const;

/** 写作约束（原文，必须在界面出现，不是写在文档里）*/
export const WRITING_CONSTRAINTS = [
  {
    id: "no-minority-as-universal",
    title: "别把少数高情绪当普遍结论",
    body: "『测算不可信』只有 2 位强证据，但表述最激烈。矩阵里它比『本地案例』弱得多——报告里不能写成「用户普遍认为」。",
  },
  {
    id: "attribution",
    title: "观点归属",
    body: "P-11 对『责任归属』是在 P-10（其上级）发言后附和，标记为从众风险、不计入强度；P-12 提供了唯一反例，报告必须保留。",
  },
] as const;

/** 触发「普遍性断言」写作约束的强证据数下限（O-16）= 独立受访者 5 人 */
export const UNIVERSAL_CLAIM_MIN_INDEPENDENT = 5;

/* ═══════════════════════════════════════════════════════════════════════
 * 访谈详情 · 六标签（R8 信息架构，本域跨 UC 共用）
 * ═════════════════════════════════════════════════════════════════════ */

export const DETAIL_TABS = [
  { id: "design", label: "研究设计", uc: "UC-6.2" },
  { id: "respondents", label: "受访者", uc: "UC-6.3 / 6.7" },
  { id: "virtual", label: "虚拟", uc: "phase-3 · 16-persona" },
  { id: "expert", label: "专家推演", uc: "phase-3 · 16-persona" },
  { id: "record", label: "记录", uc: "UC-6.4 / 5.x" },
  { id: "insight", label: "洞察与报告", uc: "UC-6.5" },
] as const;
export type DetailTabId = (typeof DETAIL_TABS)[number]["id"];

export function resolveDetailTab(raw: string | string[] | undefined): DetailTabId {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return DETAIL_TABS.some((t) => t.id === v) ? (v as DetailTabId) : "design";
}

/** 详情页头信息（复用现场会话标题口径）*/
export const DETAIL_HEADER = {
  title: "欧洲储能进入策略 · 采购总监深访",
  belongsTo: "研究项目 · 采购决策如何形成",
  attachHint: "产出留在研究项目 · 采购决策如何形成；需要时再挂到某个项目环节。",
  autosave: "34:12",
} as const;
