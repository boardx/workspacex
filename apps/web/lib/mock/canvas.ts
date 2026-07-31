/**
 * canvas 能力域 · UI 先行原型的 mock 数据（07-canvas 四份 UC · 8 feature）
 *
 * ⚠ 全部是 mock，零后端。数量级 / 字段完整度贴近真实，供 sign-off 看信息密度。
 * ⚠ 契约缺的类型在此**集中一份**并注明「待迁入 packages/contracts」——
 *    真实落地时应从 `@repo/contracts` 派生，不在前端长期维护第二份。
 *
 * 已 passing、必须复用不另造的 phase-00 契约（此处只在注释里点名，不重抄结构）：
 *  · packages/contracts/src/artifact.ts —— artifact / version / segment / anchor；I-11 固定快照不可删/改/降级
 *  · packages/contracts/src/context-pack.ts —— AI 引用必须落在本次 Pack 的证据上（F12 已 passing）
 */

/* ══════════════════════════════ 屏切换（预览手段） ══════════════════════════════ */

export type CanvasScreen =
  | "template-admin" // UC-7.1 后台画布模板库 + 发布状态机 + mermaid 白名单（F101）
  | "template-editor" // UC-7.1 后台画布模板【编辑器】v2 重画：设计对话 / fabric.js⇄Markdown 双向同步 / 分区属性含每区 AI 权限 / 版本历史 / 使用填充率（F100/F101）
  | "segment-binding" // UC-7.1 议程环节绑定模板与 skill（F102）
  | "editor" // UC-7.3 组内协作编辑画布（F103/F104/F105）—— 复用既有编辑器组件
  | "ai-draft" // UC-7.2 AI 起草留白规则（F106）
  | "backflow"; // UC-7.4 画布回流知识图谱（F107）

export const CANVAS_SCREENS: { id: CanvasScreen; label: string; uc: string }[] = [
  { id: "template-admin", label: "画布模板库", uc: "UC-7.1 · F101" },
  { id: "template-editor", label: "模板编辑器", uc: "UC-7.1 · F100/F101" },
  { id: "segment-binding", label: "环节绑定", uc: "UC-7.1 · F102" },
  { id: "editor", label: "画布编辑器", uc: "UC-7.3 · F103-105" },
  { id: "ai-draft", label: "AI 起草留白", uc: "UC-7.2 · F106" },
  { id: "backflow", label: "回流知识图谱", uc: "UC-7.4 · F107" },
];

export function resolveCanvasScreen(raw: string | string[] | undefined): CanvasScreen {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return CANVAS_SCREENS.some((s) => s.id === v) ? (v as CanvasScreen) : "template-admin";
}

/**
 * 「环节」命名已由 Q-3 B① 裁定并在 F121 完成改名对齐：全仓单源为
 * `agendaSegment` / `agendaSegmentId`。此前并存的三个败选名已改名清除，
 * 由 `apps/api/tests/project/naming-single-source-gate.test.ts` 门控禁止再出现。
 */
export const AGENDA_SEGMENT_NAMING_NOTE =
  "「议程环节」字段命名单源：agendaSegment / agendaSegmentId（F121 已改名对齐）";

/* ══════════════════════════════ UC-7.1 · 模板注册表（F100/F101） ══════════════════════════════ */

/** 模板底层类型（[原型] canvas / mermaid 二分）*/
export type TemplateKind = "canvas" | "mermaid";
/** 发布状态机（[原型] 三段 + 归档，O-10）*/
export type PublishStatus = "草稿" | "试跑" | "已发布" | "已归档";
/** 可见性范围（对齐 00-core/uc-0-3 资源可见性字段）*/
export type Visibility = "全体成员" | "仅某组";

/**
 * 画布模板注册表的一行。⚠ 原名 `TemplateRow` —— 与契约 `interview.TemplateRow`
 * **同名但根本是两个实体**：那边是**访谈模板**行（`{templateId,name,usedCount,oneLiner,
 * questionCount,minutesRange}`），这边是**画布模板**行（`{key,displayName,cnName,kind,
 * status,version,visibility,usedBy,structure,builtin}`）。零字段重合。
 * ⇒ 改名而不是合并（无取值分歧，不需人类裁决）。
 */
export interface CanvasTemplateRow {
  /** 程序契约，不可改，跨模块唯一标识（[O-09]）*/
  key: string;
  /** 展示名（[O-09] 五处与 key 不同）*/
  displayName: string;
  /** 中文模板名（界面主标题）*/
  cnName: string;
  kind: TemplateKind;
  status: PublishStatus;
  version: string; // v3 / v0.4
  visibility: Visibility;
  /** 被 N 场使用（[原型] 必须真实统计，此处为 mock）*/
  usedBy: number;
  /** 结构摘要（[原型] 如「信息栏＋6 分区＋便签」）*/
  structure: string;
  /** [原型] 内置模板不可删（A3）*/
  builtin: boolean;
  /** 归档时若仍有环节绑定，提示影响面（O-10 ③）*/
  boundSegments?: number;
}

/**
 * 19 个《工作坊模板 A0》内置模板（[O-09] key + displayName 双列，五处差异逐字一致）。
 * ⚠ 待迁入 packages/contracts —— 真实来源是 fabric-markdown 源码的 `key:` 字段（164 单测钉住）。
 */
export const A0_TEMPLATES: CanvasTemplateRow[] = [
  { key: "persona", displayName: "persona", cnName: "用户画像", kind: "canvas", status: "已发布", version: "v3", visibility: "全体成员", usedBy: 41, structure: "信息栏＋6 分区＋便签", builtin: true },
  { key: "pestel", displayName: "pestel", cnName: "PESTEL 分析", kind: "canvas", status: "已发布", version: "v2", visibility: "全体成员", usedBy: 22, structure: "6 分区 · 政治/经济/社会/技术/环境/法律", builtin: true },
  { key: "swot", displayName: "swot", cnName: "SWOT 分析", kind: "canvas", status: "已发布", version: "v2", visibility: "全体成员", usedBy: 30, structure: "2×2 · 优势/劣势/机会/威胁", builtin: true },
  { key: "empathy", displayName: "empathy-map", cnName: "同理心地图", kind: "canvas", status: "已发布", version: "v4", visibility: "全体成员", usedBy: 18, structure: "4 象限＋中心人物", builtin: true },
  { key: "jtbd", displayName: "jtbd", cnName: "待完成工作画布 JTBD", kind: "canvas", status: "已发布", version: "v1", visibility: "全体成员", usedBy: 7, structure: "情境＋动机＋期望结果", builtin: true },
  { key: "journey-map", displayName: "user-journey", cnName: "用户旅程图", kind: "canvas", status: "已发布", version: "v3", visibility: "全体成员", usedBy: 26, structure: "阶段轴＋触点＋情绪曲线", builtin: true },
  { key: "value-proposition", displayName: "value-proposition", cnName: "价值主张画布", kind: "canvas", status: "已发布", version: "v2", visibility: "全体成员", usedBy: 15, structure: "客户侧 3＋价值侧 3", builtin: true },
  { key: "adlib", displayName: "adlib", cnName: "价值主张宣言 Ad-Lib", kind: "canvas", status: "已发布", version: "v1", visibility: "全体成员", usedBy: 5, structure: "填空式宣言 · 6 空", builtin: true },
  { key: "bmc", displayName: "business-model", cnName: "商业模式画布 BMC", kind: "canvas", status: "已发布", version: "v3", visibility: "全体成员", usedBy: 34, structure: "9 格 · 来自 A0 模板集第 18 页", builtin: true },
  { key: "mvp", displayName: "mvp", cnName: "MVP 实验画布", kind: "canvas", status: "已发布", version: "v1", visibility: "全体成员", usedBy: 9, structure: "假设＋实验＋度量＋阈值", builtin: true },
  { key: "freytag", displayName: "freytag", cnName: "戏剧结构金字塔", kind: "canvas", status: "已发布", version: "v1", visibility: "全体成员", usedBy: 3, structure: "5 幕曲线", builtin: true },
  { key: "burger", displayName: "burger-comm", cnName: "汉堡沟通模型", kind: "canvas", status: "已发布", version: "v2", visibility: "全体成员", usedBy: 6, structure: "3 层 · 肯定/建议/鼓励", builtin: true },
  { key: "three-horizons", displayName: "three-horizons", cnName: "三地平线模型", kind: "canvas", status: "已发布", version: "v1", visibility: "全体成员", usedBy: 4, structure: "H1/H2/H3 时间轴", builtin: true },
  { key: "hmw", displayName: "hmw", cnName: "HMW 问题陈述", kind: "canvas", status: "已发布", version: "v2", visibility: "全体成员", usedBy: 28, structure: "谁＋痛点＋我们可以怎样", builtin: true },
  { key: "golden-circle", displayName: "golden-circle", cnName: "黄金圈法则", kind: "canvas", status: "已发布", version: "v1", visibility: "全体成员", usedBy: 8, structure: "Why/How/What 同心圆", builtin: true },
  { key: "three-lenses", displayName: "three-lenses", cnName: "三视角模型", kind: "canvas", status: "已发布", version: "v1", visibility: "全体成员", usedBy: 5, structure: "商业/技术/人本 3 圈", builtin: true },
  { key: "storyboard", displayName: "storyboard", cnName: "故事板", kind: "canvas", status: "已发布", version: "v2", visibility: "全体成员", usedBy: 11, structure: "6 格分镜", builtin: true },
  { key: "ai-strategy", displayName: "ai-strategy", cnName: "AI 战略画布", kind: "canvas", status: "已发布", version: "v1", visibility: "全体成员", usedBy: 6, structure: "能力/数据/场景/护栏", builtin: true },
  { key: "ai-bmc", displayName: "ai-business-model", cnName: "AI 商业模型画布", kind: "canvas", status: "已发布", version: "v1", visibility: "全体成员", usedBy: 12, structure: "12 格·来自 A0 模板集第 19 页", builtin: true },
];

/** 组织自建 / 非发布态模板（覆盖草稿/试跑/归档三态 + 内置的假设树）*/
export const ORG_TEMPLATES: CanvasTemplateRow[] = [
  { key: "assumption-tree", displayName: "assumption-tree", cnName: "假设树", kind: "mermaid", status: "已发布", version: "v2", visibility: "全体成员", usedBy: 19, structure: "flowchart · 内置不可删", builtin: true },
  { key: "journey-procurement", displayName: "journey-procurement", cnName: "采购比选旅程（高琳自建）", kind: "canvas", status: "草稿", version: "v0.4", visibility: "仅某组", usedBy: 0, structure: "从 user-journey 复制后改的 5 阶段版", builtin: false },
  { key: "esg-scorecard", displayName: "esg-scorecard", cnName: "ESG 记分卡（试跑中）", kind: "canvas", status: "试跑", version: "v0.9", visibility: "仅某组", usedBy: 1, structure: "环境/社会/治理 3 分区 · 指定「欧洲市场进入」试跑", builtin: false },
  { key: "persona", displayName: "persona", cnName: "用户画像（旧版）", kind: "canvas", status: "已归档", version: "v2", visibility: "全体成员", usedBy: 23, structure: "发布 v3 时自动归档 · 已建实例记着 v2", builtin: true, boundSegments: 3 },
];

/** mermaid 图表类型白名单（[原型] 12 类 · 4 组 × 3，只关渲染不关书写）*/
export interface WhitelistType {
  key: string;
  label: string;
  on: boolean;
}
export const MERMAID_WHITELIST: WhitelistType[][] = [
  [
    { key: "flowchart", label: "flowchart", on: true },
    { key: "journey", label: "journey", on: true },
    { key: "mindmap", label: "mindmap", on: true },
  ],
  [
    { key: "quadrantChart", label: "quadrantChart", on: true },
    { key: "timeline", label: "timeline", on: true },
    { key: "pie", label: "pie", on: true },
  ],
  [
    { key: "classDiagram", label: "classDiagram", on: true },
    { key: "erDiagram", label: "erDiagram", on: true },
    { key: "sequenceDiagram", label: "sequenceDiagram", on: false }, // 关掉：仍可书写，画布提示「有 N 条被忽略」
  ],
  [
    { key: "gitGraph", label: "gitGraph", on: true },
    { key: "gantt", label: "gantt", on: true },
    { key: "xychart", label: "xychart", on: true },
  ],
];

/** 白名单关闭类型导致「有 N 条语法被忽略」——N = 文档里被忽略的代码块条数 */
export const IGNORED_SYNTAX_COUNT = 1;

/** 发布状态机的下一步动作（[原型] 草稿行 `[发布][试跑]` 并列——「未试跑不得发布」阻断属原型确认缺失，不做阻断）*/
export const PUBLISH_FLOW_NOTE =
  "三段流程：草稿（仅作者可见）→ 试跑（指定一个项目）→ 发布（全员可绑定）。原型草稿行 [发布][试跑] 并列、无阻断；「未试跑不得发布」属原型确认缺失，本原型不做硬阻断。";

/* ══════════════════════════════ UC-7.1 · 画布模板【编辑器】（F100/F101）—— v2 重画 ══════════════════════════════ */
/**
 * 后台画布模板编辑器（原型 `isAdCvEdit` 15800335，编辑器覆盖 15800878–15829400）。
 * v1 整屏未画、且被 README 误报「原型里根本不存在」。本块按四大块逐字复原：
 *   ① 设计对话（4 轮 + 上传 .md/.canvas/.mmd/大图，15802822–15807464）
 *   ② 画布 fabric.js ⇄ Markdown 双向同步（15808189–15814733）
 *   ③ 结构检查器：信息栏字段 / 分区（导出为 ## 段落）/ 分区属性含【每区 AI 权限】（15815266–15823987）
 *   ④ 版本历史 + 使用填充率 + 诊断（15824817–15829400）
 * ⚠ 全 mock，零后端。真实落地时模板结构应从 packages/contracts 的画布模板契约派生。
 */

/** 模板编辑器头部（原型：用户画像 / persona / v3 已发布 · 有未发布改动）*/
export const TEMPLATE_EDITOR_HEAD = {
  name: "用户画像",
  key: "persona",
  publishedVersion: "v3",
  hasUnpublished: true, // 「有未发布改动」→ v4 草稿
  visibility: "全体成员" as Visibility,
  draftVersion: "v4",
};

/** ① 设计对话（原型 4 轮 + 大图解析）—— from = ai | user；kind = text | upload */
export interface DesignDialogTurn {
  from: "ai" | "user";
  text: string;
  /** 用户上传的画布文件（原型：我们线下有一版 A0 大图 → persona-A0-2024.canvas.md 已解析）*/
  parsed?: { file: string; result: string };
}
export const DESIGN_DIALOG: DesignDialogTurn[] = [
  { from: "ai", text: "这张画布填完，要让人看见哪几类信息？一类一句就行，我来切分区。" },
  { from: "user", text: "这个人是谁、他想达成什么、卡在哪、平时怎么做事、谁能影响他。" },
  { from: "ai", text: "切成 信息栏 ＋ 5 个分区 了，每区配了一句引导提问。「谁能影响他」我写成「影响因素」——右边可以直接改。" },
  { from: "user", text: "我们线下有一版 A0 大图，按它来。", parsed: { file: "persona-A0-2024.canvas.md", result: "已解析 · 6 个二级标题 → 6 区 · 已套用" } },
  { from: "ai", text: "按大图补了「动机」区，共 6 区。右边已用 fabric.js 渲染出来了，直接拖着改，改动会写回 Markdown。" },
];
export const DESIGN_DIALOG_UPLOAD_HINT = "上传画布文件 .md / .canvas / .mmd / 大图照片";
export const DESIGN_DIALOG_QUICK = ["哪一区大家最填不出来", "用真实材料试填"];

/** ② 双向同步状态（原型：画布·fabric.js ⇄ Markdown · 3 秒前）*/
export const CANVAS_MARKDOWN_SYNC = {
  lastSync: "3 秒前",
  note: "画布用 fabric.js 渲染，改分区名、提问、便签都会即时写回左边的 Markdown；反过来改 Markdown 也会重建画布。",
  mermaidNote: "mermaid 围栏里的节点＝分区，缩进＝层级，画布里的改动写回同一段围栏。",
  dualUse: "一份 Markdown 两种用法：现场用 fabric.js 渲染成能贴便签的画布，写进报告时按 mermaid 出图。不各自维护两套。",
  /** persona.md 的 mermaid 围栏（导出预览）*/
  mermaid: `\`\`\`mermaid
flowchart TB
  info[信息栏 · 5 字段]
  info --> z1[目标和需求]
  info --> z2[痛点和挑战]
  info --> z3[行为与偏好]
  info --> z4[影响因素]
  info --> z5[动机]
  info --> z6[关键场景]
\`\`\``,
};

/** ③ 信息栏字段（原型：姓名 / 年龄 / 区域 / 职位 / 行业）*/
export const INFO_BAR_FIELDS = ["姓名", "年龄", "区域", "职位", "行业"];

/** 分区属性（原型：段落标题 / 导出为 / 引导提问 / 便签上限 / 便签颜色 / 必填 / 每区 AI 权限）*/
export interface TemplateZone {
  num: string; // 01
  name: string; // 目标和需求
  heading: string; // 导出为 ## 段落标题
  prompt: string; // 引导提问（显示在框里）
  stickyMax: number; // 便签上限
  color: string; // 便签颜色（hex，仅呈现）
  required: boolean; // 必填（空着不能提交产出）
  /** 每区 AI 权限（原型 15823358–15823987「AI 能不能动这一区」）*/
  aiAddSticky: boolean; // 允许 AI 补便签
  aiEditHuman: boolean; // 允许 AI 改人写的便签
  /** 使用填充率 · 近 6 场项目（原型 15828 区，null = 新区无数据）*/
  fillRate: number | null;
}
export const TEMPLATE_ZONES: TemplateZone[] = [
  { num: "01", name: "痛点和挑战", heading: "## 痛点和挑战", prompt: "他现在卡在哪？哪一步最费劲？", stickyMax: 8, color: "#E8556B", required: true, aiAddSticky: true, aiEditHuman: false, fillRate: 96 },
  { num: "02", name: "目标和需求", heading: "## 目标和需求", prompt: "他想达成什么？成功长什么样？", stickyMax: 8, color: "#17A97C", required: true, aiAddSticky: true, aiEditHuman: false, fillRate: 88 },
  { num: "03", name: "行为与偏好", heading: "## 行为与偏好", prompt: "他平时怎么做事？习惯用什么？", stickyMax: 6, color: "#4B3BE8", required: false, aiAddSticky: true, aiEditHuman: false, fillRate: 61 },
  { num: "04", name: "影响因素", heading: "## 影响因素", prompt: "谁能否决他的采购决定？", stickyMax: 6, color: "#B87333", required: false, aiAddSticky: true, aiEditHuman: true, fillRate: 17 },
  { num: "05", name: "动机", heading: "## 动机", prompt: "他为什么现在要做这件事？", stickyMax: 5, color: "#0E8F7C", required: false, aiAddSticky: true, aiEditHuman: false, fillRate: null },
  { num: "06", name: "关键场景", heading: "## 关键场景", prompt: "这些需求最常在什么场景下出现？", stickyMax: 5, color: "#6E6E76", required: false, aiAddSticky: false, aiEditHuman: false, fillRate: null },
];
export const TEMPLATE_LAYOUT_OPTIONS = ["2 列", "3 列", "4 列"];
export const TEMPLATE_LAYOUT_CURRENT = "3 列";

/** ④ 版本历史（原型：v4 未发布 / v3 当前发布版·11 个项目在用 / v2 已归档·3 个历史画布仍引用）*/
export interface TemplateVersion {
  version: string;
  note: string;
  by: string;
  when: string;
  status: "未发布" | "当前发布版" | "已归档";
  usage?: string; // 11 个项目在用 / 3 个历史画布仍引用
  /** 已用出去的画布锁在自己的版本上 → 可对比 / 回滚（回滚仅对未发布草稿开放）*/
  canRollback: boolean;
}
export const TEMPLATE_VERSIONS: TemplateVersion[] = [
  { version: "v4", note: "把「影响因素」的提问改成具体问句；新增必填标记", by: "高琳", when: "12 分钟前", status: "未发布", canRollback: false },
  { version: "v3", note: "从 4 区扩到 6 区，拆出「动机」和「影响因素」", by: "林可", when: "2025-11", status: "当前发布版", usage: "11 个项目在用", canRollback: false },
  { version: "v2", note: "初版 4 区", by: "—", when: "—", status: "已归档", usage: "3 个历史画布仍引用", canRollback: true },
];
export const TEMPLATE_VERSION_LOCK_NOTE = "已用出去的画布锁在自己的版本上——发布新版不会改动历史画布，回滚只影响未发布草稿。";

/** 使用填充率 · 近 6 场项目 + 一条诊断（原型 15828–15830）*/
export const TEMPLATE_USAGE = {
  scope: "近 6 场项目",
  /** 诊断：填充率最低的一区，AI 给的改法（已进 v4 草稿）*/
  diagnosis: {
    zone: "影响因素",
    text: "6 场里 5 场是空的——大概率不是用户没想法，是提问太抽象。",
    suggestion: "Ava 建议改成「谁能否决他的采购决定？」，这条改动已经放进 v4 草稿。",
  },
};

/* ══════════════════════════════ UC-7.1 · 议程环节绑定（F102） ══════════════════════════════ */

export interface SegmentBinding {
  id: string;
  order: string; // 03
  title: string; // 假设风暴
  duration: string; // 45m
  current: boolean;
  /** 绑定的模板（最多两个，[Backlog] E1）*/
  templates: { key: string; displayName: string; version: string }[];
  /** 本环节可用 skill（[原型] 议程环节级白名单）*/
  skills: { id: string; label: string; kind: "运行" | "已开" }[];
}

/** proto-08「设计思维标准五步」议程环节链（[原型]，模板+skill 绑在议程环节上）*/
export const SEGMENT_BINDINGS: SegmentBinding[] = [
  { id: "seg-01", order: "01", title: "对齐目标", duration: "20m", current: false, templates: [{ key: "golden-circle", displayName: "golden-circle", version: "v1" }], skills: [{ id: "sk-md", label: "Markdown ⇄ 画布", kind: "运行" }] },
  { id: "seg-02", order: "02", title: "现状共识", duration: "30m", current: false, templates: [{ key: "empathy", displayName: "empathy-map", version: "v4" }, { key: "swot", displayName: "swot", version: "v2" }], skills: [{ id: "sk-voice", label: "语音转便签", kind: "已开" }] },
  { id: "seg-03", order: "03", title: "假设风暴", duration: "45m", current: true, templates: [{ key: "hmw", displayName: "hmw", version: "v2" }], skills: [{ id: "sk-hyp", label: "提取假设 → 假设树", kind: "运行" }, { id: "sk-voice", label: "语音转便签", kind: "已开" }] },
  { id: "seg-04", order: "04", title: "分组共创", duration: "50m", current: false, templates: [{ key: "bmc", displayName: "business-model", version: "v3" }], skills: [{ id: "sk-md", label: "Markdown ⇄ 画布", kind: "运行" }] },
  { id: "seg-05", order: "05", title: "收敛投票", duration: "25m", current: false, templates: [], skills: [] },
  { id: "seg-06", order: "06", title: "行动项", duration: "20m", current: false, templates: [], skills: [] },
];

/* ══════════════════════════════ UC-7.2 · AI 起草留白（F106） ══════════════════════════════ */

/** 引述三件套（转录片段 id + 时间码 + 原文）—— 缺任一即标「无来源·待补」*/
/**
 * 引述三件套（展示层）。⚠ 原名 `Quote` —— 契约里 `Quote` 被声明**两次**
 * （`interview.ts` `{quoteId,segmentId,text,subjectId,rqId}`、`recording.ts` 另一份），
 * 而这里是画布草稿便签上渲染的 `{segmentId,timecode,text}`——带**时间码**，
 * 契约两份都没有这个字段。⇒ 改名分离。
 * 🔴 契约侧同名重复本身是个问题，见 `@/lib/contract-divergences` 的 `CONTRACT_SIDE_ISSUES`。
 */
export interface QuoteView {
  segmentId: string; // transcript segment id（可回到 22-files transcript.jsonl）
  timecode: string; // 12:05
  text: string; // 原文
}

export interface DraftSticky {
  id: string;
  text: string;
  byAva: boolean;
  /** 有引述 = 已填；null = 无来源·待补，不计入完成度分子（规则②）*/
  quote: QuoteView | null;
}

export interface DraftSection {
  id: string;
  label: string; // ## 段落
  required: boolean;
  /** 该分区可容纳格数（规则① 至少留一格空 = stickies.length < capacity）*/
  capacity: number;
  stickies: DraftSticky[];
}

/** HMW 三分区的 AI 起草结果（覆盖：留一格空 / 填满触发提示 / 无来源待补）*/
export const DRAFT_SECTIONS: DraftSection[] = [
  {
    id: "sec-people", label: "谁", required: true, capacity: 4,
    stickies: [
      { id: "d1", text: "工商业园区业主：自投自用", byAva: true, quote: { segmentId: "seg-2#0142", timecode: "12:05", text: "我们园区自己投自己用，回本压力全在业主身上" } },
      { id: "d2", text: "第三方投资商 EMC 模式", byAva: true, quote: { segmentId: "seg-2#0188", timecode: "18:22", text: "有一批是纯 EMC 投资商，不自用" } },
    ], // 2/4 · 留了 2 格空
  },
  {
    id: "sec-pain", label: "痛点", required: true, capacity: 3,
    stickies: [
      { id: "d3", text: "回本周期看不清，不敢投", byAva: true, quote: { segmentId: "seg-2#0210", timecode: "21:40", text: "最大的问题是回本周期算不清，董事会不敢批" } },
      { id: "d4", text: "并网审批各州不一，工期难承诺", byAva: true, quote: { segmentId: "seg-2#0233", timecode: "24:11", text: "并网审批每个州都不一样，工期根本没法给客户承诺" } },
      { id: "d5", text: "运维响应慢导致停机损失", byAva: true, quote: null }, // 无来源·待补 —— 填满 3/3 且缺引述，双规则同时被突破
    ],
  },
  {
    id: "sec-hmw", label: "我们可以怎样", required: true, capacity: 4,
    stickies: [
      { id: "d6", text: "怎样把回本测算做进销售话术", byAva: true, quote: { segmentId: "seg-2#0251", timecode: "26:03", text: "要是销售一开口就能把回本讲清楚就好了" } },
    ], // 1/4 · 缺料风险外的正常留白
  },
];

/** 留白提示（规则被突破时非阻断提示，贴在分区上；[清一格] 一键留白）*/
/**
 * 留白提示（展示层）。⚠ 原名 `WhitespaceWarning` —— 与契约 `canvas.WhitespaceWarning`
 * **同名不同义**：契约那份是 `{rule: WhitespaceRule, sectionId, stickyId, message}`，
 * 这份是渲染用的 `{sectionId, kind, message}`，`kind` 直接存中文标签。
 * 两个 `kind` 与契约 `WhitespaceRule` **1:1 对应**（已填满 ↔ `section-full`、
 * 缺引述 ↔ `missing-citation`），不构成取值分歧，所以只改名、不进待裁清单。
 * ⚠ 契约那份还带 `stickyId`（定位到具体便签），这里没有——收敛时要补上。
 */
export interface WhitespaceWarningView {
  sectionId: string;
  kind: "已填满" | "缺引述";
  message: string;
}
export function computeWhitespaceWarnings(sections: DraftSection[]): WhitespaceWarningView[] {
  const out: WhitespaceWarningView[] = [];
  for (const s of sections) {
    if (s.stickies.length >= s.capacity) {
      out.push({ sectionId: s.id, kind: "已填满", message: `本分区已被 AI 填满（${s.stickies.length}/${s.capacity}），建议留一格给现场` });
    }
    if (s.stickies.some((k) => k.quote === null)) {
      out.push({ sectionId: s.id, kind: "缺引述", message: "本分区有草稿缺原始引述，已标「无来源·待补」，不计入完成度" });
    }
  }
  return out;
}
/** 完成度 = 已完成项 / 已定义项（O-32）；分母 = 模板分区定义条数；「无来源·待补」不计入分子 */
export function computeCompletion(sections: DraftSection[]): { done: number; defined: number } {
  const defined = sections.length;
  const done = sections.filter((s) => s.stickies.some((k) => k.quote !== null)).length;
  return { done, defined };
}

/** AVA 轮次级回滚（D-10）：本轮落笔明细，可原子撤回到落笔前 */
export const AVA_ROUND_CHANGES = [
  { id: "r1", kind: "sticky" as const, where: "## 谁", detail: "＋便签「工商业园区业主：自投自用」" },
  { id: "r2", kind: "sticky" as const, where: "## 痛点", detail: "＋便签「回本周期看不清，不敢投」" },
  { id: "r3", kind: "sticky" as const, where: "## 我们可以怎样", detail: "＋便签「怎样把回本测算做进销售话术」" },
  { id: "r4", kind: "edge" as const, where: "n1 → n2", detail: "连线标签改为「需验证」" },
];

/* ══════════════════════════════ UC-7.4 · 回流知识图谱（F107） ══════════════════════════════ */

/** 节点三态（[原型] 事实关系屏 · 映射 claims.status accepted/contested/proposed）*/
export type NodeStatus = "已确认" | "冲突" | "待确认";

/** 来源链（[原型] 每条关系带 来源组 + 来源模块 + 证据量 + 时间码；链断即拒绝写回）*/
export interface SourceChain {
  group: string; // 第 3 组
  module: string; // 研究模块
  evidenceCount: number; // 9 来源
  timecode: string; // 12:05
  /** 一路回到 22-files transcript.jsonl 的片段 id（100% 可定位，AC3）*/
  segmentId: string;
  broken?: boolean; // 链断：不得写回
}

export interface GraphNode {
  id: string;
  label: string;
  status: NodeStatus;
  source: SourceChain;
  /** 组长已确认才可写回组织大脑 */
  leadConfirmed: boolean;
}

export const FACT_NODES: GraphNode[] = [
  { id: "gn1", label: "回本周期是采购决策的头号阻力", status: "已确认", leadConfirmed: true, source: { group: "第 3 组", module: "研究模块", evidenceCount: 9, timecode: "12:05", segmentId: "seg-3#0142" } },
  { id: "gn2", label: "EMC 模式可跨园区复制", status: "冲突", leadConfirmed: true, source: { group: "第 2 组", module: "现场画布", evidenceCount: 4, timecode: "24:11", segmentId: "seg-2#0233" } },
  { id: "gn3", label: "EMC 合同标准化足以降门槛", status: "冲突", leadConfirmed: false, source: { group: "第 1 组", module: "现场画布", evidenceCount: 2, timecode: "31:08", segmentId: "seg-1#0301" } },
  { id: "gn4", label: "并网审批差异是主要工期风险", status: "已确认", leadConfirmed: true, source: { group: "第 3 组", module: "研究模块", evidenceCount: 6, timecode: "24:11", segmentId: "seg-3#0233" } },
  { id: "gn5", label: "运维响应慢造成停机损失", status: "待确认", leadConfirmed: false, source: { group: "第 4 组", module: "AI 起草", evidenceCount: 0, timecode: "—", segmentId: "", broken: true } },
];

/** 互斥结论：gn2 与 gn3 支持与反驳边并存，自动标冲突、不自动择一 */
export const CONFLICT_PAIR = { support: "gn2", refute: "gn3", exits: ["上台讨论", "标为不确定"] as const };

/** 推演流水线：9 方法环节 × 4 场景（[原型] 进度 14/36 格 · 4 场景 × 9 环节）*/
export type MethodCellStatus = "已完成" | "正在讨论" | "冲突停滞" | "建议下一步" | "未开始";
export const METHOD_STAGES = [
  "01 PESTEL 趋势", "02 SWOT 竞争", "03 用户画像", "04 旅程图", "05 HMW 定义",
  "06 解决方案", "07 MVP", "08 UI 原型", "09 PRD 需求",
];
export const PIPELINE_SCENARIOS = ["德国自用", "法国 EMC", "北欧工商业", "南欧安装商"];
/** [row=场景][col=方法环节] 的格状态；进度 = 已完成格数 */
export const PIPELINE_GRID: MethodCellStatus[][] = [
  ["已完成", "已完成", "已完成", "正在讨论", "建议下一步", "未开始", "未开始", "未开始", "未开始"],
  ["已完成", "已完成", "正在讨论", "冲突停滞", "未开始", "未开始", "未开始", "未开始", "未开始"],
  ["已完成", "已完成", "已完成", "已完成", "正在讨论", "未开始", "未开始", "未开始", "未开始"],
  ["已完成", "已完成", "已完成", "建议下一步", "未开始", "未开始", "未开始", "未开始", "未开始"],
];

/** [设计·待确认] 模板 ↔ 方法环节映射（本文档首次提出，档案未直接给出）*/
export const TEMPLATE_TO_STAGE_NOTE =
  "[设计·待确认] 03 用户画像→persona · 04 旅程图→journey-map(辅 empathy) · 05 HMW→hmw · 01 PESTEL→pestel · 02 SWOT→swot · 06 解决方案→bmc/ai-bmc · 07 MVP→mvp。档案未直接给出，需产品确认。";

/** 本组小树（[未探明] 组级图谱屏——档案只探明全场，此为原创设计）*/
export const GROUP_TREE = [
  { id: "t1", label: "致命假设：EMC 可复制", status: "冲突" as NodeStatus, children: 3 },
  { id: "t2", label: "回本测算做进话术", status: "已确认" as NodeStatus, children: 1 },
  { id: "t3", label: "标准化 EMC 合同", status: "待确认" as NodeStatus, children: 0 },
];

/** 批量确认清单（[原型待补] 引导师 [批量确认] 点开后的勾选清单）*/
export const BATCH_CONFIRM_ITEMS = FACT_NODES.filter((n) => n.leadConfirmed && n.status !== "待确认");
