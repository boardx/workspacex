/**
 * 访谈能力域（itv）UI 先行原型 v2 的 mock 数据 —— 纯数据模块，不带 "use client"。
 *
 * ⚠ v1 主线画错了（见 ui-preview/itv-v2/V1-WAS-WRONG.md）。本文件按人类 2026-07-30
 *   裁决与真实原型（WorkspaceX Standalone.html）重建，主线是这条链：
 *
 *     访谈模板创建 → 套用模板新建访谈 → 质性访谈 / 虚拟用户画像推演访谈
 *       → 报告模板 → 洞察报告
 *
 * ⚠ 待迁入 packages/contracts —— 本文件是 UI 先行的临时事实源，签核回流后应改为从契约生成，
 *   并从 no-builtin-capability-lists.test.ts 的 DECLARED_MOCK_DEBT 里删除本文件条目。
 *
 * 角色模型（人类 2026-07-30 追加裁决）：访谈**没有**引导师/组长 —— 那是工作坊的角色。
 *   访谈自成一套成员模型，只有 研究员 / 受访者 / 观察者。**不复用 project 的四角色，
 *   也不复用 interview.ts 里 v1 造的 5 档 INTERVIEW_VIEWS（含 facilitator/groupLead）。**
 *   原型证据：访谈详情区 grep 引导师/组长 = 0 命中、无视角切换器；只出现「研究员」「受访者」。
 *   下面这份 ITV_VIEWS 是访谈语境自己的事实源，待迁入 packages/contracts（访谈成员形状）。
 */

/* ══════════════════════════════════════════════════════════════════════
 * 角色视角（访谈自有，非工作坊四角色）—— 视角切换是预览手段，不是权限实现
 * ⚠ 原型访谈屏本身没有视角切换器（happy path）；此切换器是本原型为逐角色核对而加，
 *   与旧原型「零异常态、零视角预览」的缺陷相反，属有意的差别。
 * ════════════════════════════════════════════════════════════════════ */
export type ItvView = "researcher" | "interviewee" | "observer";
export const ITV_VIEWS: { id: ItvView; label: string; note: string }[] = [
  { id: "researcher", label: "研究员", note: "可发起、标引述、指派说话人、确认洞察" },
  { id: "interviewee", label: "受访者", note: "只看自己的授权与撤回，看不到项目内部材料" },
  { id: "observer", label: "观察者", note: "仅在已发布且授权允许时只读脱敏结果" },
];
export function resolveItvView(raw: string | string[] | undefined): ItvView {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return ITV_VIEWS.some((r) => r.id === v) ? (v as ItvView) : "researcher";
}
/** 写操作（标引述、确认洞察、编辑模板）只对研究员开放 */
export function canWriteItv(view: ItvView): boolean {
  return view === "researcher";
}
/** 观察者与受访者只读 —— 驱动 denied 态说明 */
export function isReadOnlyItvView(view: ItvView): boolean {
  return view !== "researcher";
}

/* ══════════════════════════════════════════════════════════════════════
 * 0. 链路屏（左侧语义导航）—— 反映人类那条链，v1 缺的正是「模板」这一层与「报告模板」
 * ════════════════════════════════════════════════════════════════════ */
export type ItvScreen =
  | "library" // 访谈模板库（含每个模板绑定的报告模板）—— UC-6.1
  | "template-editor" // 模板编辑器（提纲 + 报告模板定义）—— UC-6.1
  | "new" // 套用模板新建访谈（选模板 → 选对象 → 生成提纲）—— UC-6.0/6.2
  | "interviews" // 访谈列表（跨项目 · 真人/数字人混排）—— UC-6.0
  | "design" // 研究设计（上下文 + 大纲 + 研究计划参数）—— UC-6.2
  | "record" // 质性访谈现场记录（三栏）—— UC-6.4
  | "virtual" // 虚拟用户画像推演访谈（专家设定/提问推演/采纳）—— UC-6.5 虚拟隔离
  | "insight"; // 洞察与报告（证据矩阵 + 报告模板 → 洞察报告）—— UC-6.5

export const ITV_SCREENS: {
  id: ItvScreen;
  label: string;
  step: string;
  uc: string;
  note: string;
}[] = [
  { id: "library", label: "访谈模板库", step: "①", uc: "UC-6.1", note: "模板决定提纲结构、每段时长和要收集的数据字段" },
  { id: "template-editor", label: "模板编辑器 · 报告模板", step: "①", uc: "UC-6.1", note: "编辑提纲，并为该模板定义配套报告模板" },
  { id: "new", label: "套用模板新建访谈", step: "②", uc: "UC-6.0/6.2", note: "选模板 → 选对象 → 生成提纲" },
  { id: "interviews", label: "访谈列表", step: "②", uc: "UC-6.0", note: "跨项目全部访谈 · 真人与数字人混排" },
  { id: "design", label: "研究设计", step: "③", uc: "UC-6.2", note: "上下文三要素 + 大纲 + 研究计划参数" },
  { id: "record", label: "质性访谈现场", step: "③", uc: "UC-6.4", note: "提纲 / 逐字稿 / AI 副驾驶 三栏" },
  { id: "virtual", label: "虚拟画像推演访谈", step: "③", uc: "UC-6.5", note: "对虚拟用户画像做文字推演 · 探索性 · 不计入强度" },
  { id: "insight", label: "洞察报告", step: "④⑤", uc: "UC-6.5", note: "证据矩阵 → 套报告模板出洞察报告" },
];

export function resolveScreen(raw: string | string[] | undefined): ItvScreen {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return ITV_SCREENS.some((s) => s.id === v) ? (v as ItvScreen) : "library";
}

/* ══════════════════════════════════════════════════════════════════════
 * 1. 范围模型（UC-6.0）—— 访谈是一等对象，独立发起、不依赖项目；project_id 可空
 *    「不属于任何项目」是一等档，不是兜底桶
 * ════════════════════════════════════════════════════════════════════ */
export type ScopeId = "rp-procurement" | "unassigned";
export const ITV_SCOPES: { id: ScopeId; label: string; kind: string }[] = [
  { id: "rp-procurement", label: "研究项目 · 采购决策如何形成", kind: "研究项目" },
  { id: "unassigned", label: "不属于任何项目", kind: "无项目" },
];
export function resolveScope(raw: string | string[] | undefined): ScopeId {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return ITV_SCOPES.some((s) => s.id === v) ? (v as ScopeId) : "rp-procurement";
}

/**
 * 访谈属于哪一类实体？（人类 2026-07-30：项目≈工作坊、研究项目、用户洞察 三类互相独立 Q-12=C）
 * 结论：访谈属于**用户洞察**这一类，与「工作坊（项目）」**平级**，不是挂在工作坊/项目下的标签页。
 * 原型证据：左栏 STUDIO 分组「研究 · 访谈 · 问卷 · 原型」——访谈是**顶层 Studio**（独立发起，
 *   不依赖项目）；工作坊/项目才有引导师/组长四角色（那些词只出现在工作坊区，访谈区 0 命中）。
 *   访谈产出的洞察汇总进项目工作台的「用户洞察」视图（原型：用户洞察 9 场 · 真人 7 · 数字人 2）。
 */
export const ITV_PLACEMENT_NOTE =
  "访谈属于「用户洞察」这一类，与工作坊（项目）平级、互相独立，不是工作坊下的标签页。" +
  "它是顶层 Studio（独立发起，不依赖项目）；范围可为某研究项目或「不属于任何项目」。" +
  "访谈没有引导师/组长（那是工作坊角色），成员模型只有 研究员/受访者/观察者。";

/* ══════════════════════════════════════════════════════════════════════
 * 2. 访谈模板库（UC-6.1）—— ① 提纲结构 ② 每段时长 ③ 要收集的数据字段
 *    v2 新增：每个访谈模板可绑定一个「报告模板」（人类原话：针对访谈模板定义报告模板）
 * ════════════════════════════════════════════════════════════════════ */
export type TemplateSource = "original" | "extracted";
export const TEMPLATE_SOURCE_LABEL: Record<TemplateSource, string> = {
  original: "原创",
  extracted: "从访谈抽取",
};

export interface DataField {
  key: string;
  label: string;
  /** 该字段成为证据矩阵的一列（UC-6.5） */
  becomesMatrixColumn: boolean;
}

export interface InterviewTemplate {
  id: string;
  name: string;
  /** 由实际套用次数统计得出，不可手填（UC-6.1 AC2） */
  usedCount: number;
  blurb: string;
  questionCount: number;
  /** 时长是区间，不是单值 */
  durationRange: string;
  tags: string[];
  source: TemplateSource;
  extractedFrom?: string[]; // extracted 模板可追溯到来源访谈
  dataFields: DataField[];
  /** 绑定的报告模板 id（v2 新增；可空 = 尚未定义报告模板） */
  reportTemplateId: string | null;
  segments: OutlineSegment[];
}

export const INTERVIEW_TEMPLATES: InterviewTemplate[] = [
  {
    id: "tpl-procure",
    name: "采购决策链",
    usedCount: 9,
    blurb: "谁拍板、谁能否决、卡在哪一步",
    questionCount: 12,
    durationRange: "45–60 分",
    tags: ["客户", "高优先级"],
    source: "original",
    dataFields: [
      { key: "role_in_chain", label: "决策链角色", becomesMatrixColumn: true },
      { key: "veto_point", label: "一票否决点", becomesMatrixColumn: true },
      { key: "blocker_step", label: "卡点环节", becomesMatrixColumn: true },
      { key: "trust_signal", label: "信任来源", becomesMatrixColumn: true },
    ],
    reportTemplateId: "rt-procure",
    segments: [], // 见 RESEARCH_DESIGN.segments（同一模板的落地示例）
  },
  {
    id: "tpl-jtbd",
    name: "JTBD 深访",
    usedCount: 14,
    blurb: "还原上一次真实购买的完整经过",
    questionCount: 9,
    durationRange: "60 分",
    tags: ["客户"],
    source: "original",
    dataFields: [
      { key: "trigger", label: "触发事件", becomesMatrixColumn: true },
      { key: "alternatives", label: "考虑过的替代", becomesMatrixColumn: true },
      { key: "hire_reason", label: "雇用理由", becomesMatrixColumn: true },
    ],
    reportTemplateId: "rt-jtbd",
    segments: [],
  },
  {
    id: "tpl-switch",
    name: "竞品切换动因",
    usedCount: 6,
    blurb: "为什么换、为什么没换",
    questionCount: 8,
    durationRange: "40 分",
    tags: ["内部"],
    source: "original",
    dataFields: [
      { key: "push", label: "离开推力", becomesMatrixColumn: true },
      { key: "pull", label: "新方案拉力", becomesMatrixColumn: true },
      { key: "anxiety", label: "切换焦虑", becomesMatrixColumn: true },
    ],
    reportTemplateId: null, // 故意留空：演示「模板尚未绑定报告模板」态
    segments: [],
  },
  {
    id: "tpl-onboard",
    name: "首月流失复盘",
    usedCount: 3,
    blurb: "新客户在头 30 天到底卡在哪",
    questionCount: 10,
    durationRange: "45 分",
    tags: ["客户", "高优先级"],
    source: "extracted",
    extractedFrom: ["访谈 04 · 业主 A", "访谈 07 · EPC B", "访谈 09 · 物流园区"],
    dataFields: [
      { key: "first_value", label: "首次见效时刻", becomesMatrixColumn: true },
      { key: "drop_point", label: "流失触发点", becomesMatrixColumn: true },
      { key: "support_gap", label: "支持缺口", becomesMatrixColumn: true },
    ],
    reportTemplateId: "rt-jtbd",
    segments: [],
  },
  {
    id: "tpl-compliance",
    name: "合规否决路径",
    usedCount: 2,
    blurb: "法务与合规在什么节点介入、卡住什么",
    questionCount: 7,
    durationRange: "50 分",
    tags: ["内部", "高优先级"],
    source: "extracted",
    extractedFrom: ["访谈 10 · Weber", "访谈 12 · 荷兰物流"],
    dataFields: [
      { key: "legal_entry", label: "法务介入时点", becomesMatrixColumn: true },
      { key: "hidden_gate", label: "隐形门槛", becomesMatrixColumn: true },
    ],
    reportTemplateId: null,
    segments: [],
  },
];

/** 头部计数与说明（原型：访谈模板 · 5） */
export const TEMPLATE_LIBRARY_HEADER = {
  count: INTERVIEW_TEMPLATES.length,
  blurb: "模板决定提纲结构、每段时长和要收集的数据字段；新建访谈时套用",
  sourceHint: "来自 3 场项目",
  tagFilters: ["全部标签", "客户", "内部", "高优先级", "已归档"],
};

/* ══════════════════════════════════════════════════════════════════════
 * 3. 报告模板（v2 新增核心）—— 人类原话：针对访谈模板定义报告模板，访谈结束后出洞察报告
 *    原型依据：问卷 Studio 的「报告模板 · 客户体验诊断」+ 访谈「研究报告 · 报告结构 10 段」
 *    骨架写死、内容留空；结论先行、每条结论必须挂证据；每章映射一个数据来源
 * ════════════════════════════════════════════════════════════════════ */
export type ChapterAuthoring = "human" | "ai";
export const CHAPTER_AUTHORING_LABEL: Record<ChapterAuthoring, string> = {
  human: "必须人写",
  ai: "AI 起草",
};

/** 章节数据来源的映射状态 —— 映射到某 RQ/数据字段/主题，或「缺来源」(发布被阻断) */
export type ChapterSourceState = "mapped" | "missing";

export interface ReportChapter {
  no: number;
  title: string;
  authoring: ChapterAuthoring;
  sourceState: ChapterSourceState;
  /** 映射到的数据来源（RQ / 数据字段 / 证据主题）；missing 时为缺什么 */
  source: string;
}

export interface ReportTemplate {
  id: string;
  name: string;
  /** 绑定它的访谈模板名（反向展示） */
  boundTemplateNames: string[];
  audienceOptions: string[];
  purposeOptions: string[];
  /** 报告开关（原型：受访者匿名 / 包含直接引语 / 展示反例与局限 / 嵌入音视频片段） */
  toggles: { key: string; label: string; on: boolean }[];
  rule: string;
  chapters: ReportChapter[];
}

export const REPORT_TEMPLATES: ReportTemplate[] = [
  {
    id: "rt-procure",
    name: "采购决策链 · 洞察报告",
    boundTemplateNames: ["采购决策链"],
    audienceOptions: ["客户高管", "项目团队", "产品与研发"],
    purposeOptions: ["支持路径决策", "对齐问题认知"],
    toggles: [
      { key: "anon", label: "受访者匿名", on: true },
      { key: "quotes", label: "包含直接引语", on: true },
      { key: "counter", label: "展示反例与局限", on: true },
      { key: "media", label: "嵌入音视频片段", on: false },
    ],
    rule: "报告的骨架写死、内容留空。结论先行、每条结论必须挂证据 —— 这是模板的作用，不是写作风格偏好。",
    chapters: [
      { no: 1, title: "研究背景", authoring: "human", sourceState: "mapped", source: "研究上下文三要素" },
      { no: 2, title: "研究对象与方法", authoring: "ai", sourceState: "mapped", source: "研究计划参数 + 参与者构成" },
      { no: 3, title: "参与者构成", authoring: "ai", sourceState: "mapped", source: "受访者名单（真人 12 · 虚拟单列）" },
      { no: 4, title: "核心发现", authoring: "human", sourceState: "mapped", source: "映射 RQ1–RQ3 · 证据矩阵强/弱格" },
      { no: 5, title: "支持证据", authoring: "ai", sourceState: "mapped", source: "映射 数据字段「决策链角色/卡点环节」" },
      { no: 6, title: "反例与差异", authoring: "human", sourceState: "mapped", source: "映射 矩阵「反例」格（唯一反例必留）" },
      { no: 7, title: "产品机会", authoring: "ai", sourceState: "missing", source: "缺：尚未确认候选洞察" },
      { no: 8, title: "专家推演（虚拟）", authoring: "ai", sourceState: "mapped", source: "虚拟推演单列 · 注明模型与日期" },
      { no: 9, title: "风险与限制", authoring: "ai", sourceState: "mapped", source: "映射 已知局限 + 样本量声明" },
      { no: 10, title: "后续研究问题", authoring: "human", sourceState: "missing", source: "缺：待研究员补写" },
    ],
  },
  {
    id: "rt-jtbd",
    name: "JTBD 深访 · 洞察报告",
    boundTemplateNames: ["JTBD 深访", "首月流失复盘"],
    audienceOptions: ["产品与研发", "项目团队"],
    purposeOptions: ["对齐问题认知", "支持路径决策"],
    toggles: [
      { key: "anon", label: "受访者匿名", on: false },
      { key: "quotes", label: "包含直接引语", on: true },
      { key: "counter", label: "展示反例与局限", on: true },
      { key: "media", label: "嵌入音视频片段", on: true },
    ],
    rule: "报告的骨架写死、内容留空。结论先行、每条结论必须挂证据。",
    chapters: [
      { no: 1, title: "一页纸结论", authoring: "human", sourceState: "mapped", source: "映射 三个 JTBD 与推进顺序" },
      { no: 2, title: "我们怎么得出这个结论", authoring: "ai", sourceState: "mapped", source: "方法与样本" },
      { no: 3, title: "触发—考虑—雇用 时间线", authoring: "ai", sourceState: "mapped", source: "映射 数据字段「触发事件/替代/雇用理由」" },
      { no: 4, title: "反例与差异", authoring: "human", sourceState: "mapped", source: "映射 矩阵「反例」格" },
      { no: 5, title: "机会与建议", authoring: "ai", sourceState: "missing", source: "缺：候选洞察未确认" },
    ],
  },
];

export function reportTemplateById(id: string | null): ReportTemplate | undefined {
  return id ? REPORT_TEMPLATES.find((r) => r.id === id) : undefined;
}

/* ══════════════════════════════════════════════════════════════════════
 * 4. 套用模板新建访谈 · 三步向导（UC-6.0 AC3 / UC-6.2）
 *    选模板 → 选对象 → 生成提纲
 * ════════════════════════════════════════════════════════════════════ */
export const WIZARD_STEPS = [
  { no: 1, key: "template", label: "选模板", hint: "模板自带要收集的数据字段与配套报告模板" },
  { no: 2, key: "objects", label: "选对象", hint: "从访谈对象表选人；带入部门、语言、背景与要问什么" },
  { no: 3, key: "outline", label: "生成提纲", hint: "按「模板 + 对象背景 + 研究上下文」生成大纲草案" },
] as const;

/** 向导第二步的候选对象（访谈对象表投影，UC-6.7） */
export interface WizardObject {
  id: string;
  name: string;
  role: string;
  language: string;
  background: string;
  relation?: string; // 上下级关系 → 默认拆场
}
export const WIZARD_OBJECTS: WizardObject[] = [
  { id: "P-10", name: "Weber", role: "采购总监 · Müller GmbH", language: "德语", background: "成熟用户 · 决策者", relation: "与 P-11 同公司（上级）" },
  { id: "P-11", name: "Kraus", role: "能源经理 · Müller GmbH", language: "德语", background: "成熟用户", relation: "P-10 的下属 · 需拆场" },
  { id: "P-12", name: "匿名", role: "物流园区运营 · 荷兰", language: "英语", background: "从未评估 · 要求匿名 · 需字幕" },
  { id: "P-14", name: "Lindqvist", role: "EPC 项目总监 · 瑞典", language: "英语", background: "成熟用户 · 供给侧" },
];

/** 向导第三步生成的大纲草案状态（AI 已按目标生成 · 待你确认） */
export const WIZARD_OUTLINE_STATUS = "AI 已按目标生成 · 待你确认";

/* ══════════════════════════════════════════════════════════════════════
 * 5. 访谈列表（UC-6.0）—— 真人访谈与数字人/虚拟画像**混排但强标记**，计数分列
 * ════════════════════════════════════════════════════════════════════ */
export type InterviewSource = "human" | "virtual";
export type InterviewStatus = "running" | "done" | "draft";
export const INTERVIEW_STATUS_LABEL: Record<InterviewStatus, string> = {
  running: "执行中",
  done: "完成",
  draft: "草稿",
};

export interface InterviewRow {
  id: string;
  subject: string;
  subjectInitial: string;
  belongsTo: string; // 所属项目/研究项目 · 负责人
  scope: ScopeId;
  status: InterviewStatus;
  source: InterviewSource;
  progress: string; // 一句话进展
  metric: string; // 计量
  templateName: string;
  actions: string[];
}

export const INTERVIEW_LIST: InterviewRow[] = [
  {
    id: "iv-11",
    subject: "业主 A · 采购总监",
    subjectInitial: "王",
    belongsTo: "欧洲进入策略 · 林可",
    scope: "rp-procurement",
    status: "running",
    source: "human",
    progress: "第 3 段进行中：替代方案与不作为。",
    metric: "38:20 / 60 分",
    templateName: "采购决策链",
    actions: ["打开访谈", "进入现场"],
  },
  {
    id: "iv-08",
    subject: "EPC B · 项目负责人",
    subjectInitial: "李",
    belongsTo: "欧洲进入策略 · 高琪",
    scope: "rp-procurement",
    status: "done",
    source: "human",
    progress: "9 条引述已抽取，3 条支撑「资质可转让性」。",
    metric: "52 分钟 · 7/24",
    templateName: "采购决策链",
    actions: ["打开访谈", "看洞察"],
  },
  {
    id: "iv-14",
    subject: "德国采购总监 · 数字人",
    subjectInitial: "DE",
    belongsTo: "由 12 场真人访谈构造",
    scope: "rp-procurement",
    status: "done",
    source: "virtual",
    progress: "3 轮压力提问，用来预演真人问法，标为探索性。",
    metric: "28 分钟 · 探索性",
    templateName: "采购决策链",
    actions: ["打开访谈", "再跑一轮"],
  },
  {
    id: "iv-21",
    subject: "内部 · 客成负责人",
    subjectInitial: "赵",
    belongsTo: "不属于任何项目 · 你（研究员）",
    scope: "unassigned",
    status: "done",
    source: "human",
    progress: "探索性访谈，尚未挂到任何项目环节。",
    metric: "41 分钟 · 12/12",
    templateName: "JTBD 深访",
    actions: ["打开访谈", "挂到项目环节…"],
  },
  {
    id: "iv-23",
    subject: "本地 EPC · 项目总监（虚拟）",
    subjectInitial: "V2",
    belongsTo: "不属于任何项目 · 材料不足",
    scope: "unassigned",
    status: "draft",
    source: "virtual",
    progress: "仅 1 场二手转述构造，只能提问不能下结论。",
    metric: "置信上限 低 · 探索性",
    templateName: "合规否决路径",
    actions: ["打开访谈", "补材料"],
  },
];

/** 计数分列（原型：真人 N · 数字人 M；场次数 ≠ 人数） */
export function interviewCounts(scope: ScopeId) {
  const rows = INTERVIEW_LIST.filter((r) => r.scope === scope);
  return {
    total: rows.length,
    human: rows.filter((r) => r.source === "human").length,
    virtual: rows.filter((r) => r.source === "virtual").length,
  };
}

/* ══════════════════════════════════════════════════════════════════════
 * 6. 研究设计（UC-6.2）—— 上下文三要素 + 大纲（目标先/问法后 ≥2）+ 研究计划参数
 * ════════════════════════════════════════════════════════════════════ */
export interface OutlineSegment {
  no: string;
  minutes: number;
  goal: string;
  /** 每段至少两条开场问法（AC1）*/
  openers: string[];
  /** 质量提示：该段问法是否需改（照抄研究问题/诱导） */
  needsRewrite: boolean;
}

export interface ResearchDesign {
  status: string; // 页头「AI 已按目标生成 · 待你确认」
  context: { who: string; situation: string; decision: string };
  methodologyNotes: string[];
  segments: OutlineSegment[];
  qualityHint: string; // 「2 段还需你改问法」
  /** 研究计划参数四行；保留期读项目参数，禁止写死天数 */
  plan: {
    sessions: string;
    perSession: string;
    duration: string;
    retentionParamLabel: string; // 「材料保留期」这个参数名
    retentionValueSource: string; // 值来自项目参数（不写死天数）
    noTraining: boolean;
  };
}

export const RESEARCH_DESIGN: ResearchDesign = {
  status: WIZARD_OUTLINE_STATUS,
  context: {
    who: "德国中型制造业的采购总监与能源经理",
    situation: "储能采购评估卡在最后一步、迟迟不签",
    decision: "要不要在欧洲主推「工期承诺 + 收益保底」的打法",
  },
  methodologyNotes: [
    "研究问题不等于提给受访者的问题：内部问题（「卡点是不是责任无人承担？」）要改成经历型提问（「上一次评估到最后没往下走，当时最后一次会议是怎么结束的？」）。",
    "大纲是提示不是台本；现场按对方的话走，AI 会盯覆盖度。",
  ],
  segments: [
    {
      no: "01",
      minutes: 5,
      goal: "确认他在决策链上的位置，以及最近一次真实经历",
      openers: ["你在最近一次储能评估里负责哪一段？", "那次是谁最先提出要看这个方案的？"],
      needsRewrite: false,
    },
    {
      no: "02",
      minutes: 20,
      goal: "把从动心到签字（或黄掉）的每一步和卡点还原出来",
      openers: ["从最开始动心到最后一次会议，中间都经过了谁？", "哪一步花的时间最长，为什么？"],
      needsRewrite: false,
    },
    {
      no: "03",
      minutes: 20,
      goal: "识别一票否决点与真实反对意见",
      openers: ["卡点是不是责任无人承担？", "收益保底能不能让签字松动？"],
      needsRewrite: true, // 照抄了研究问题 / 把方案塞进提问 → 需改经历型
    },
    {
      no: "04",
      minutes: 10,
      goal: "补问遗漏，确认引用与后续联系授权",
      openers: ["还有什么我没问到但你觉得重要的？", "如果我们引用你刚才那句话，需要匿名吗？"],
      needsRewrite: true,
    },
  ],
  qualityHint: "2 段还需你改问法",
  plan: {
    sessions: "22 场（含 4 场多人访谈）",
    perSession: "1–3 人（同组织不超过 2 人）",
    duration: "60 分（多人场 90 分）",
    retentionParamLabel: "材料保留期",
    retentionValueSource: "读项目参数 · 默认 180 天（代码不写死天数，O-01）", // [threshold-ok:retentionMaterial] 这句本身就是在说「不写死」，是纪律说明不是取值
    noTraining: true,
  },
};

export function outlineTotalMinutes(): number {
  return RESEARCH_DESIGN.segments.reduce((s, seg) => s + seg.minutes, 0);
}

/* ══════════════════════════════════════════════════════════════════════
 * 7. 质性访谈现场记录（UC-6.4）—— 三栏：提纲(覆盖度) / 逐字稿 / AI 副驾驶
 * ════════════════════════════════════════════════════════════════════ */
export interface CoverageItem {
  rq: string;
  label: string;
  state: "done" | "partial" | "missing";
  evidence: string;
}
export const RECORD_COVERAGE: CoverageItem[] = [
  { rq: "RQ1", label: "决策链角色", state: "done", evidence: "3 条证据" },
  { rq: "RQ2", label: "卡在哪一步", state: "done", evidence: "5 条证据" },
  { rq: "RQ3", label: "什么证据敢签", state: "partial", evidence: "只问到一半" },
  { rq: "RQ4", label: "替代方案", state: "missing", evidence: "时间不够，没问" },
];

export interface TranscriptLine {
  time: string;
  speaker: string;
  text: string;
  /** 从众风险：下属在上级发言后附和 → 标非独立证据 */
  echo?: boolean;
  /** 拒绝 AI 分析：只以原文引述出现，不进任何归纳 */
  aiOptOut?: boolean;
}
export const RECORD_TRANSCRIPT: TranscriptLine[] = [
  { time: "00:31:04", speaker: "P-10 Weber", text: "签字这件事，没人愿意为万一出问题谁负责去背。", aiOptOut: true },
  { time: "00:31:22", speaker: "P-10 Weber", text: "我们法务只认合同，合同外的承诺一律不算。", aiOptOut: true },
  { time: "00:33:10", speaker: "P-11 Kraus", text: "对，我们也是这样，责任归属确实没人接。", echo: true },
  { time: "00:44:12", speaker: "研究员", text: "如果供应商愿意承担收益保底，签字问题会不会松动？" },
  { time: "00:44:30", speaker: "P-10 Weber", text: "松动一点，但董事会要的是能签字的责任条款，不是保底数字。", aiOptOut: true },
];

export const RECORD_COPILOT = {
  running: "34:12 · 后台运行中",
  themes: [
    { name: "责任无人承担", quotes: 3, strength: "中", note: "1 个具体流程" },
    { name: "法务是隐形门槛", quotes: 1, strength: "弱", note: "待追问" },
  ],
  echoNote: "待你判断：Kraus 的「对，我们也是这样」算不算独立证据？默认按附和处理，不计入强度。",
  biasWarnings: [
    "00:31:40「如果供应商愿意承担收益保底，签字问题会不会松动？」——把解决方案塞进了提问。",
    "00:44:12 连续两次用「是不是」开头，容易得到附和。",
  ],
  highValueFollowups: [
    "「法务第一次介入是什么时候」——直接打开了流程断点",
    "「有没有一次很快签下来的」——拿到了唯一反例",
  ],
  confirmNote: "确认后逐字稿才进正式证据库；未确认的内容不会被其他 Studio 检索到。",
};

/* ══════════════════════════════════════════════════════════════════════
 * 8. 虚拟用户画像推演访谈（UC-6.5 虚拟隔离）—— 对虚拟画像做**文字推演**，探索性
 *    三条硬约束：不计入证据强度 / 不能单独支撑决策 / 报告里单列章节
 *    ⚠ 只有真人来源能把洞察标「强」——虚拟一律标探索性、单独计数（任务硬约束）
 * ════════════════════════════════════════════════════════════════════ */
export type ConfidenceCap = "high" | "mid" | "low";
export const CONFIDENCE_CAP_LABEL: Record<ConfidenceCap, string> = {
  high: "置信上限 高",
  mid: "置信上限 中",
  low: "置信上限 低",
};

export type ExpertState = "enabled" | "insufficient";
export interface VirtualExpert {
  id: string;
  role: string;
  state: ExpertState;
  confidenceCap: ConfidenceCap;
  basis: string; // 构造依据（真实材料）
  stance?: string; // 立场偏好
  limits?: string; // 已知局限
  notFor?: string; // 不可用于
  insufficientHint?: string; // 材料不足说明
}

export const VIRTUAL_CONSTRUCT_RULE =
  "虚拟专家只能由已入库的真实材料构造：至少 2 场真人访谈或 3 条组织层判断。不允许凭空设定人格 —— 那是编故事，不是研究。每位专家都必须写明「已知局限」和「不可用于什么」。";

export const VIRTUAL_HARD_CONSTRAINTS = [
  "一，不计入证据强度：矩阵里单列一行，不与真人证据相加。",
  "二，不能单独支撑决策：任何引用它的判断必须同时有至少一条真人证据或被标为待验证。",
  "三，报告里单列章节并注明生成模型与日期，不混进访谈发现。",
];

export const VIRTUAL_EXPERTS: VirtualExpert[] = [
  {
    id: "V1",
    role: "德国中型制造企业 · 能源经理",
    state: "enabled",
    confidenceCap: "mid",
    basis: "访谈 09 / 10 ＋ 组织层「审批 11 个月」「资质需重新备案」",
    stance: "时间确定性 > 单价；怕停产，不怕贵",
    limits: "样本全部来自 50–200 人企业，不代表大型工业客户",
    notFor: "价格弹性的定量结论、法务条款的实际接受度",
  },
  {
    id: "V2",
    role: "本地 EPC · 项目总监",
    state: "insufficient",
    confidenceCap: "low",
    basis: "仅 1 场二手转述 ＋ 行业报告 · 材料不足，只能提问不能下结论",
    insufficientHint: "这一位主要用来生成「该去问真人什么」，其推演结论一律标为待验证，不进证据矩阵。",
  },
  {
    id: "V3",
    role: "并网审批 · 前监管人员",
    state: "enabled",
    confidenceCap: "mid",
    basis: "监管年报 ＋ 6 条并购判例 · 只回答流程类问题",
    stance: "审批延误多由资料返工造成，不可归责于任何一方",
    limits: "只覆盖流程合规，不覆盖商业动机",
    notFor: "商业谈判策略、价格接受度",
  },
  {
    id: "V4",
    role: "保险核保 · 收益保底产品",
    state: "insufficient",
    confidenceCap: "low",
    basis: "材料不足 2 项，尚未启用",
    insufficientHint: "缺：真实核保案例 ≥2；组织层判断 ≥3。补齐后才能启用。",
  },
];

export interface RqQuestion {
  question: string;
  rq: string;
  progress: string; // 「3 位专家已推演」/「未推演」
}
export const VIRTUAL_QUESTIONS: RqQuestion[] = [
  { question: "工期延误的责任，实际由谁承担？", rq: "RQ2", progress: "3 位专家已推演" },
  { question: "收益保底会不会反而降低信任？", rq: "RQ3", progress: "未推演" },
  { question: "谁在采购里能一票否决？", rq: "RQ1", progress: "2 位专家已推演" },
];

export interface DeductionResult {
  expertId: string;
  expertRole: string;
  steps: string; // 「推理 12 步 · 8.4s」
  stance: string;
  reason: string;
  inference: string;
  citation: string;
  uncertain: string; // 强制字段「不确定」
  refutable: string; // 强制字段「会被推翻」
}
export const VIRTUAL_DEDUCTION: DeductionResult = {
  expertId: "V1",
  expertRole: "德国能源经理",
  steps: "推理 12 步 · 8.4s",
  stance: "合同上写谁承担都没用，实际承担的是我 —— 因为停产损失不可能索赔回来。",
  reason: "延误的直接成本是产线停摆，而合同违约金上限通常是合同额的 5–10%，远低于停产一周的损失。",
  inference: "所以我会优先选「能承诺工期并愿意共担停产风险」的供应商，而不是最便宜的。",
  citation: "访谈 10 · Weber 00:31:22「我们法务只认合同」／ 组织层：审批中位数 11 个月",
  uncertain: "没有材料能说明他们是否真的为此付过溢价 —— 这是推理，不是观察到的行为。",
  refutable: "若有一例客户明知工期风险仍选低价，这条立场即失效。",
};

export const VIRTUAL_DISAGREEMENT = [
  { expert: "V1", claim: "实际由业主承担，合同条款只是形式" },
  { expert: "V2", claim: "EPC 会接受有限共担，但要换来排他与预付" },
  { expert: "V3", claim: "责任在流程：审批延误不可归责于任何一方 —— 与 V1 直接冲突" },
];

export interface AdoptCandidate {
  expertId: string;
  tag: string; // 「与访谈 10 一致」/「与 V1 冲突 · 无真人证据」
  claim: string;
  note?: string;
  actions: string[];
}
export const VIRTUAL_ADOPT_QUEUE: AdoptCandidate[] = [
  {
    expertId: "V1",
    tag: "RQ2 · 与访谈 10 一致",
    claim: "业主实际承担延误损失，合同违约金不足以覆盖停产",
    actions: ["采纳为待验证假设", "变成访谈提问", "丢弃"],
  },
  {
    expertId: "V3",
    tag: "与 V1 冲突 · 无真人证据支持",
    claim: "审批延误属于不可归责事件，双方都不承担",
    note: "这条只有推理支持。按约束二，它不能作为决策依据；建议作为访谈 13 的必问题去证伪。",
    actions: ["加入访谈 13 必问", "派 Scout 查判例"],
  },
  {
    expertId: "V2",
    tag: "置信上限低 · 材料不足",
    claim: "EPC 愿意共担但要排他与预付",
    actions: ["只作为提问"],
  },
];

export const VIRTUAL_ADOPTED_DESTINATIONS = [
  "虚拟 → 待验证假设：4 条已进项目层，标注「仅推演」，证据强度 0",
  "提纲 → 2 条已变成访谈 13 的必问题（v5）",
  "报告 → 单列第 8 段「专家推演（虚拟）」· 注明模型与日期（草稿）",
];

/* ══════════════════════════════════════════════════════════════════════
 * 9. 洞察与报告（UC-6.5）—— 证据矩阵（五取值）→ 套报告模板 → 洞察报告
 * ════════════════════════════════════════════════════════════════════ */
export type Evidence = "strong" | "weak" | "none" | "echo" | "counter";
export const EVIDENCE_LABEL: Record<Evidence, string> = {
  strong: "强",
  weak: "弱",
  none: "未提及",
  echo: "附和",
  counter: "反例",
};
/** 视觉编码：色 + 形双通道（含色盲）；附和/反例不能长得像弱（UI sign-off 重点） */
export const EVIDENCE_GLYPH: Record<Evidence, string> = {
  strong: "●",
  weak: "◐",
  none: "–",
  echo: "≈",
  counter: "✕",
};

export type RespondentKind = "human" | "virtual";
export interface MatrixColumn {
  id: string; // P-04 等
  kind: RespondentKind;
  consentOptOut?: boolean; // 拒绝 AI 分析
}
export const MATRIX_COLUMNS: MatrixColumn[] = [
  { id: "P-04", kind: "human" },
  { id: "P-07", kind: "human" },
  { id: "P-09", kind: "human" },
  { id: "P-10", kind: "human", consentOptOut: true },
  { id: "P-11", kind: "human" },
  { id: "P-12", kind: "human" },
  { id: "V1", kind: "virtual" }, // 虚拟列必须强标记，单列不相加
];

export interface MatrixRow {
  theme: string;
  cells: Record<string, Evidence>;
}
export const MATRIX_ROWS: MatrixRow[] = [
  {
    theme: "责任归属无人承担",
    cells: { "P-04": "strong", "P-07": "strong", "P-09": "none", "P-10": "strong", "P-11": "echo", "P-12": "counter", V1: "weak" },
  },
  {
    theme: "法务是隐形门槛",
    cells: { "P-04": "none", "P-07": "weak", "P-09": "strong", "P-10": "strong", "P-11": "none", "P-12": "none", V1: "none" },
  },
  {
    theme: "本地案例决定信任",
    cells: { "P-04": "strong", "P-07": "strong", "P-09": "weak", "P-10": "weak", "P-11": "strong", "P-12": "none", V1: "none" },
  },
  {
    theme: "测算不可信",
    cells: { "P-04": "weak", "P-07": "none", "P-09": "strong", "P-10": "none", "P-11": "weak", "P-12": "strong", V1: "weak" },
  },
];

export const MATRIX_HEADER = {
  sessions: 9,
  respondents: 12, // 场次数 ≠ 人数
  virtualCount: 3, // 虚拟单独计数，不并入人数
  actions: ["合并主题", "拆分主题", "调整证据权重", "按用户类型对比", "单人 vs 多人场"],
};

export const MATRIX_WRITING_GUARDS = {
  emotionVsEvidence:
    "「测算不可信」只有 2 位强证据，但表述最激烈。矩阵里它比「本地案例」弱得多 —— 报告里不能写成「用户普遍认为」。",
  attribution:
    "P-11 对「责任归属」是在 P-10（其上级）发言后附和，标记为从众风险，不计入强度；P-12 提供了唯一反例，报告必须保留。",
  /** O-16：普遍性断言的强证据下限 = 独立受访者 5 人（附和/虚拟不计入） */
  universalClaimThreshold: 5,
};

/** 强证据独立受访者计数（附和 echo 与虚拟 V* 不计入） —— 驱动写作约束提示 */
export function strongIndependentCount(row: MatrixRow): number {
  return MATRIX_COLUMNS.filter(
    (c) => c.kind === "human" && row.cells[c.id] === "strong",
  ).length;
}

/** 候选洞察（AI 产出带机器角标；无来源不可确认；虚拟不能标强） */
export interface InsightCandidate {
  id: string;
  text: string;
  sourceKind: "human" | "survey" | "virtual" | "desk";
  strength: "strong" | "weak" | "exploratory";
  status: "confirmed" | "pending" | "counter-kept";
  evidence: string; // 时间码 + 说话人 + 场次
  canMarkStrong: boolean; // 虚拟来源恒为 false（服务端强制的界面投影）
}
export const INSIGHT_CANDIDATES: InsightCandidate[] = [
  {
    id: "ins-1",
    text: "采购停在责任归属，而不是价格：委员会需要一份能签字的责任条款。",
    sourceKind: "human",
    strength: "strong",
    status: "confirmed",
    evidence: "P-10 · 00:31:22 · 访谈 10（4/12 位 · 3 场）",
    canMarkStrong: true,
  },
  {
    id: "ins-2",
    text: "法务介入时点决定谈判节奏：越晚介入，返工越多。",
    sourceKind: "human",
    strength: "weak",
    status: "pending",
    evidence: "3/12 位 · 含 1 位附和（不计入强度）",
    canMarkStrong: true,
  },
  {
    id: "ins-3",
    text: "收益归因不清可能是复购最大阻碍 —— 三个数字人与画像都提到「达不到承诺谁负责」。尚无真人证据。",
    sourceKind: "virtual",
    strength: "exploratory",
    status: "pending",
    evidence: "数字人／画像 · 探索性 · 尚无真人证据",
    canMarkStrong: false, // 虚拟来源不能标强（接口层拒绝，此处仅投影）
  },
  {
    id: "ins-4",
    text: "P-12 所在小团队直接由运营负责人拍板，不存在委员会 —— 唯一反例，报告必须保留。",
    sourceKind: "human",
    strength: "weak",
    status: "counter-kept",
    evidence: "P-12 · 反例（不可被合并主题抹掉）",
    canMarkStrong: true,
  },
];

/** 来源分布（真人/问卷/深研/虚拟分列；只有真人能标强） */
export const INSIGHT_SOURCE_MIX = {
  note: "只有真人来源能把洞察标成「强」。虚拟来源单独计数，避免用 AI 生成的共识说服自己。",
  items: [
    { label: "用户洞察 · 真人", count: 5, canStrong: true },
    { label: "问卷", count: 4, canStrong: true },
    { label: "深度研究（外部资料）", count: 3, canStrong: true },
    { label: "数字人／画像（探索性）", count: 3, canStrong: false },
  ],
};

/** 洞察报告出口（套报告模板生成） */
export const INSIGHT_REPORT_EXPORTS = ["生成报告草稿", "导出 PDF", "送入综合 Studio"];
