/**
 * 契约束 `canvas` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西（后端 DTO / 前端类型 / OpenAPI / mock），任何一样都不许手写第二份。
 *
 * 覆盖 feature：F100–F107（phase-01，8 个）
 * 依据 UC：`uc-7-1`（模板注册表）· `uc-7-2`（AI 起草与留白）· `uc-7-3`（协作与冲突裁决）
 *         · `uc-7-4`（回流知识图谱）
 * 领域不变量见 `phases/phase-01-run-a-project/contracts/canvas/domain.md` 的 `I-n`。
 *
 * ⚠ 已建成的 `/projects/[id]/canvas` 是 **mock 壳**（`canvas-stage` 静态占位，S-17），
 *   它对自己永远自洽；**别把它的 happy path 当成契约**。
 *
 * 核心不变量：
 *   · **AI 起草只填到六成**：留白是**一等状态**，`WhitespaceWarning` 非空时接口**仍成功返回**
 *     且内容真实写入（I-25）——「有意留白」与「AI 出错」必须可分辨，前者走 `warnings`、
 *     后者走 `err`，两者**不共用通道**
 *   · **来源链断即拒写回**（I-28 `SOURCE_CHAIN_BROKEN` / I-29 `NODE_NOT_CONFIRMED`，服务端闸门）
 *   · `preservedVersionId` 永不为空——冲突裁决三出口任意一个丢弃另一侧即数据损坏（I-17）
 *   · `exportSource` 的输出里**没有坐标**（I-9 / D-08 ②）
 */
import { z } from "zod";
import { PermissionReason } from "./identity";
import { ContextPackReason } from "./context-pack";

/* ─────────────────────────── 枚举（对应 domain.md）─────────────────────────── */

/** 模板生命周期。三段发布流程：draft → trial → published；published 可 archived，archived 可 restore */
export const TemplateStatus = z.enum(["draft", "trial", "published", "archived"]);

/** 模板可见性。⚠ 与 `identity.VisibilityScope` 是**同一套语义**（编译期断言见文件末尾） */
export const TemplateVisibility = z.enum(["org-wide", "team-only"]);

/**
 * 19 个内置《工作坊模板 A0》的 `key → displayName` —— **本仓这一列的唯一事实源**（O-09 / I-2）。
 *
 * ⚠ 三件事必须同时成立，否则本表就是缺陷而不是契约：
 *   ① **`key` 不在这里被创造**。key 的权威是 `@repo/fabric-markdown` 源码里
 *      `registerTemplate({ key: ... })` 的取值（19 个，一个都不许改，改了 164 个既有单测失效）。
 *      本表是**声明**，库是**派生源**，两者由 F100 的集合相等断言绑死（I-36）：
 *      `apps/api/tests/canvas/template-registry-19-key-displayname.test.ts`。
 *      少一个、多一个、改一个字母都会红，且断言逐 key 点名差集——
 *      **不是 `toHaveLength(19)`**，长度断言会挡住正当的 ADR 新增，且换成另外 19 个 key 照样绿。
 *   ② **`displayName` 只活在这里**。它承载 proto-03 的原型显示名，是展示层事实，
 *      不回灌进上游库源码——回灌就变成「同一事实声明在两处」。
 *   ③ **一切绑定 / 实例固化 / ```` ```canvas ```` 围栏 / 图谱回流 / 契约测试引用的是 key**（I-3）。
 *      改 `displayName` 不得影响任何既有绑定。
 *
 * 五处差异（其余 14 条 `displayName === key`）：
 *   `empathy`→`empathy-map` · `journey-map`→`user-journey` · `bmc`→`business-model` ·
 *   `burger`→`burger-comm` · `ai-bmc`→`ai-business-model`
 */
export const BUILTIN_CANVAS_TEMPLATES = {
  persona: "persona",
  pestel: "pestel",
  swot: "swot",
  empathy: "empathy-map",
  jtbd: "jtbd",
  "journey-map": "user-journey",
  "value-proposition": "value-proposition",
  adlib: "adlib",
  bmc: "business-model",
  mvp: "mvp",
  freytag: "freytag",
  burger: "burger-comm",
  "three-horizons": "three-horizons",
  hmw: "hmw",
  "golden-circle": "golden-circle",
  "three-lenses": "three-lenses",
  storyboard: "storyboard",
  "ai-strategy": "ai-strategy",
  "ai-bmc": "ai-business-model",
} as const satisfies Record<string, string>;

/** 内置模板 key 的联合类型。**不另写一份清单**——由上表推导 */
export type BuiltinTemplateKey = keyof typeof BUILTIN_CANVAS_TEMPLATES;

/**
 * 内置模板 key 的 zod 枚举。取值由 `BUILTIN_CANVAS_TEMPLATES` 推导，
 * **不重复枚举字面量**——第二份副本一律视为缺陷（ADR-023 / 本文件顶部的唯一事实源声明）。
 */
export const BuiltinTemplateKeyEnum = z.enum(
  Object.keys(BUILTIN_CANVAS_TEMPLATES) as [BuiltinTemplateKey, ...BuiltinTemplateKey[]],
);

/**
 * 展示层取名的唯一入口。**不要在别处写 `key === "empathy" ? "empathy-map" : key`**。
 * 非内置（组织自建）模板本表查不到 ⇒ 返回 `undefined`，由调用方用其自身的 `displayName` 字段。
 */
export function builtinDisplayName(key: string): string | undefined {
  return (BUILTIN_CANVAS_TEMPLATES as Record<string, string | undefined>)[key];
}

/**
 * mermaid 白名单的 12 类封闭枚举。
 * ⚠ 白名单**只关渲染、不关书写**（I-8）——本束**不提供**「删除已写的被禁类型代码块」的能力，
 *   那会违反「不丢内容」。被禁类型的代码块照常保存，只是不渲染。
 */
export const MermaidDiagramType = z.enum([
  "flowchart", "sequenceDiagram", "classDiagram", "stateDiagram",
  "erDiagram", "journey", "gantt", "pie",
  "quadrantChart", "mindmap", "timeline", "gitGraph",
]);

/** 改动分类。⚠ `classifyChange` 是**全函数**：判定表七行覆盖全部改动类型（I-15） */
export const ChangeClassification = z.enum(["sticky-level", "structural"]);

/** 冲突裁决的三出口。⚠ `compare` 是**中间态不是终态**——打开并排差异后仍要再选一侧 */
export const ConflictOutcome = z.enum(["compare", "keep-doc", "keep-canvas"]);

/** 结构性改动发生在哪一侧。**单侧改结构直接同步、不弹冲突条**；只有两侧同时改才产生冲突（I-16） */
export const ChangeSide = z.enum(["doc", "canvas"]);

/**
 * 画布级 AI 写权限模式（**不是全局**）。
 * · `direct`  —— AI 直接落笔进正文
 * · `suggest` —— AI 内容**不进正文**，逐条/批量接受后才进（I-26）
 * ⚠ 模式变更**记审计**。
 */
export const AiWriteMode = z.enum(["direct", "suggest"]);

/** skill 运行模式 */
export const SkillRunMode = z.enum(["once", "always-on"]);

/**
 * 留白两规则的告警类型。
 * ⚠ **这是「有意留白」的载体，不是错误**：`warnings` 非空时接口成功返回（I-25）。
 *   把它塞进 `err` 会让「AI 只填了六成」与「AI 挂了」变成同一件事，
 *   而前者是产品要的行为、后者是故障。
 */
export const WhitespaceRule = z.enum(["section-full", "missing-citation"]);

/** 各组画布在左栏的状态。⚠ `落后` **当且仅当** `missingRequiredSections` 非空（I-20），不横向比较 */
export const GroupCanvasStatus = z.enum(["进行中", "你在这组", "只读", "落后"]);

/** 本项目画布的同步状态 */
export const CanvasSyncStatus = z.enum(["已同步", "待同步", "画布领先"]);

/** 节点确认的三态（组长视角） */
export const NodeConfirmStatus = z.enum(["已确认", "冲突", "待确认"]);

/** claim 在图谱里的三态。⚠ **互斥结论自动标 `contested` 且不自动择一**（I-30） */
export const ClaimStatus = z.enum(["accepted", "contested", "proposed"]);

/**
 * 本束失败模式全集。前端据此渲染 R8 要求的七态之一。
 * ⚠ 拒绝响应**不得泄露资源是否存在**：越权读别组画布与「真的不存在」都返回 `INSTANCE_NOT_FOUND`。
 */
export const CanvasError = z.enum([
  /** 🔗 与 `identity.PermissionReason` 同码同义（编译期断言见文件末尾）。判定属 identity 束，此处透传 */
  "NO_PROJECT_ROLE",
  /** 写别组画布 ⇒ **服务端拒绝**，不是工具条置灰（uc-7-3 A2） */
  "NOT_IN_GROUP",
  "ROLE_INSUFFICIENT",
  "TEMPLATE_NOT_FOUND",
  "TEMPLATE_KEY_CONFLICT",
  /** ⚠ O-10：**只挡新增绑定，不挡存量实例化** */
  "TEMPLATE_ARCHIVED",
  "BUILTIN_TEMPLATE_UNDELETABLE",
  "SEGMENT_TEMPLATE_LIMIT",
  /** ⚠ **[待定 D-b]**：档案未证实该阻断存在。裁决为「不阻断」时**此码删除**，见 KNOWN_CONTRACT_GAPS */
  "TEMPLATE_NOT_TRIALED",
  "SKILL_NOT_BOUND",
  /** 越权读也返回它（不泄露存在性） */
  "INSTANCE_NOT_FOUND",
  "VERSION_CHANGED",
  /** 待裁决期间的**结构性**写被拒；便签级写**不受此限**（I-18）——现场不能因一条冲突全组停手 */
  "CONFLICT_PENDING_ADJUDICATION",
  "CONFLICT_ALREADY_RESOLVED",
  /** 未经组长确认的节点写回大脑 ⇒ **服务端闸门**（I-29），前端置灰不构成实现 */
  "NODE_NOT_CONFIRMED",
  /** 来源链断裂 ⇒ **拒绝写回**（I-28） */
  "SOURCE_CHAIN_BROKEN",
  "AI_ROUND_NOT_FOUND",
  /** 该轮之后还有他人改动 ⇒ 拒绝直接回滚（本束替 UC 做的判断，见 KNOWN_CONTRACT_GAPS） */
  "AI_ROUND_SUPERSEDED",
  /** 🔗 起草取不到上下文 ⇒ 画布内容不变、可重试；**不得降级为直查**（E2 / V10 / I-27） */
  "CONTEXT_PACK_UNAVAILABLE",
  "DEPENDENCY_UNAVAILABLE",
  /** 实时通道不可用（**非致命**）：降级为轮询，⚠ **不得伪装已同步**（V14） */
  "REALTIME_DEGRADED",
  /** 过程中权限被撤：终止后续写，未提交输入留本地草稿（E4） */
  "AUTHORIZATION_REVOKED",
]);

/* ─────────────────────────────── 值对象 ─────────────────────────────── */

/** 模板分区定义。`capacity` 可空——留白规则①对 `null` 容量的分区**目前断言不出来**（[待定 D-a]） */
export const SectionDef = z.object({
  sectionId: z.string(),
  name: z.string(),
  order: z.number().int().nonnegative(),
  required: z.boolean(),
  capacity: z.number().int().positive().nullable(),
}).strict();

/** 便签。⚠ 匿名成员也能贴，`authorRef` 用临时身份标记，且该标记在导出与审计中**可追溯**（V12） */
export const Sticky = z.object({
  stickyId: z.string(),
  sectionId: z.string().nullable(),
  text: z.string(),
  color: z.string().nullable(),
  size: z.string().nullable(),
  authorRef: z.string(),
  /** AVA 角标：AI 落笔的便签必须可分辨 */
  aiGenerated: z.boolean(),
  /** 缺引述的草稿标「无来源 · 待补」，**不计入完成度分子**（I-23） */
  citationRef: z.string().nullable(),
}).strict();

/**
 * 留白告警。
 * ⚠ **这是成功响应的一部分**（`draftFromContextPack.out.warnings`），不是错误。
 *   「AI 只填了六成、留了四成给人」是产品要的行为；把它做成失败会让现场以为 AI 坏了。
 */
export const WhitespaceWarning = z.object({
  rule: WhitespaceRule,
  sectionId: z.string().nullable(),
  stickyId: z.string().nullable(),
  message: z.string(),
}).strict();

/** 改动描述符——`classifyChange` 的输入，也是结构性写的载荷 */
export const ChangeDescriptor = z.object({
  kind: z.string(),
  targetId: z.string().nullable(),
  payload: z.string().nullable(),
}).strict();

/** 冲突两侧的摘要——并排差异视图渲染它 */
export const ChangeSummary = z.object({
  versionId: z.string(),
  authorRef: z.string(),
  at: z.string(),
  summary: z.string(),
}).strict();

/** 来源链一条完整回溯。⚠ 任一环缺失即 `SOURCE_CHAIN_BROKEN`，**拒绝写回** */
export const NodeProvenance = z.object({
  groupId: z.string(),
  sourceStickyId: z.string(),
  quote: z.string(),
  segmentId: z.string(),
  anchor: z.string(),
  transcriptFileRef: z.string(),
}).strict();

/* ───────────────────────────── 操作 ───────────────────────────── */

export const operations = {
  /* ── 一、模板注册表与发布（F100 F101）───────────────────────────── */

  /**
   * ## 🟡 本操作**尚未经人类签核**（#496），状态：**待补签**
   *
   * 2026-08-04，人类不在场，coord-main 依其授权原文「我离开的情况下你不要等我的决定」
   * 代为裁决**先做**，并同时把本操作**登记为待补签**：issue #496 就是这条 design-delta
   * 的记录。人类回来后要么在束级 `design-signoff.md` 第 ③ 节补签，要么**推翻并回退**
   * 本操作及其全部实现。
   *
   * ⚠ 在补签之前，**不得**把它当作已签核事实去继续扩展（例如据此再造 updateTemplate /
   *   newVersion）。签核状态只由人类在 `design-signoff.md` 里改，**agent 不动那个文件**
   *   （授权宪章层级 3）。这段注释是那个状态在代码里的**可见形态**，不是签核本身。
   *
   * ---
   *
   * createTemplate —— 三段发布流程**之前**的那一段：把一行造出来。
   *
   * ## 为什么它必须存在
   *
   * 其余五个注册表操作（list / publish / trial / archive / restore）**全部**作用于一个
   * 已经存在的 `:key`，而 `publishTemplate.in` 是 `{key, version, visibility}`——不带
   * `displayName` / `sections` / `underlyingType`，且 `err` 含 `TEMPLATE_NOT_FOUND`：
   * 它读一行、改状态，**不造一行**。于是「新增可视化模板」这一步在本契约下
   * **无论怎么实现都交付不了**，模板只能靠 SQL 种进去（见
   * `apps/api/tests/canvas/template-lifecycle-http.test.ts` 的文件头）。
   *
   * ## 新建即 `draft`，**不绕开**既有发布流程
   *
   * `out.status` 是 `z.literal("draft")`：新建出来的模板还不能用，必须再走
   * `publishTemplate`（可选先 `trialTemplate`）。`publishTemplate` 的注释自陈是
   * 「三段发布流程的第三段」，本操作补的正是第一段——它**加**一段，不**替**任何一段。
   *
   * ⚠ 因此**不得**把 `publishTemplate` 改造成「不存在就创建」的 upsert：那会让
   *   `publishTemplate.err` 里的 `TEMPLATE_NOT_FOUND` 变成**不可达**，而本文件
   *   `KNOWN_CONTRACT_GAPS.C_CANVAS_3` 逐字写着「不可达的错误码正是门控空转的形状」。
   *
   * ## `TEMPLATE_KEY_CONFLICT` 在本操作之前是**不可达的**
   *
   * 它自 canvas 束落地起就在 `CanvasError` 闭集里（第 156 行），却**不出现在任何一个
   * 操作的 `err` 里**——全仓仅此一处提及。也就是说本束一直带着一个自己点名要避免的东西。
   * 本操作是它唯一的产生方：`key` 在本组织已被占用 ⇒ `TEMPLATE_KEY_CONFLICT`。
   *
   * ## `out.version` 是 `z.literal(1)`，而不是一个正整数
   *
   * 本操作只会铸出 v1。铸 v2 需要的是「基于既有模板开新版」——那是另一个操作，
   * 契约里**没有**，本次也**不发明**（缺口如实报在 #496，不用一个宽类型把它盖住）。
   * 写成 `z.number().int().positive()` 会让「这个端口能造任意版本」看起来成立，
   * 而实现永远只回 1，这正是响应体与契约悄悄分家的方式。
   * ⇒ 哪天真要支持开新版，`z.literal(1)` 会当场逼出一次契约改动，而那**本来就该**
   *   是一次契约改动。
   *
   * ## `in` 里为什么没有 `orgId`
   *
   * 与其余四个写操作一致：组织取自会话主体（principal），不由请求体自报。
   * `listTemplates` 的 `orgId` 在 query 上是读路径的既有形状，两者不对齐是既有事实，
   * 不在本操作里顺手改别人的入参。
   *
   * ## `ownerTeamId` 的缺口（C_CANVAS_8）
   *
   * `visibility: "team-only"` 需要「归哪个团队」，而契约里**没有**这一栏——与
   * `listTemplates.out` / `publishTemplate.in` 的同一处缺口逐字同型。实现取创建者自己的
   * 团队；创建者无团队时该行对**所有人**不可见（fail-closed，见迁移文件头）。
   * 这是缺口的**后果**，如实登记在 `KNOWN_CONTRACT_GAPS.C_CANVAS_8`，不发明一个字段。
   */
  createTemplate: {
    method: "POST", path: "/canvas/templates",
    in: z.object({
      key: z.string().min(1),
      displayName: z.string().min(1),
      underlyingType: z.string().min(1),
      sections: z.array(SectionDef),
      visibility: TemplateVisibility,
    }).strict(),
    out: z.object({
      key: z.string(),
      displayName: z.string(),
      /** 只铸 v1 —— 见上方「为什么是 z.literal(1)」。 */
      version: z.literal(1),
      /** 新建即草稿：必须再经 `publishTemplate` 才可用。 */
      status: z.literal("draft"),
      /** 组织自建的模板永远不是内置的。内置清单的权威是 `BUILTIN_CANVAS_TEMPLATES`。 */
      builtin: z.literal(false),
      visibility: TemplateVisibility,
      underlyingType: z.string(),
      sections: z.array(SectionDef),
    }).strict(),
    err: ["TEMPLATE_KEY_CONFLICT", "ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * listTemplates —— 后台模板库 / 绑定选择器**共用一个端口**。
   * ⚠ `forBinding: true` 时**必须过滤掉 `draft` 与 `archived`**（I-5）。
   *   共用端口正是为了避免「后台一份过滤、绑定面板另一份过滤」的第二处声明。
   * ⚠ `usageCount` 必须**真实统计，不得估算**。
   */
  listTemplates: {
    method: "GET", path: "/canvas/templates",
    in: z.object({
      orgId: z.string(),
      filter: z.enum(["all", "published", "draft", "archived"]).optional(),
      forBinding: z.boolean().optional(),
    }).strict(),
    out: z.object({
      templates: z.array(z.object({
        key: z.string(),
        displayName: z.string(),
        version: z.number().int().positive(),
        status: TemplateStatus,
        builtin: z.boolean(),
        visibility: TemplateVisibility,
        underlyingType: z.string(),
        sections: z.array(SectionDef),
        usageCount: z.number().int().nonnegative(),
      }).strict()),
    }).strict(),
    err: ["NO_PROJECT_ROLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** publishTemplate —— 三段发布流程的第三段。发布新版本时旧版自动归档；**已建实例不被改动**（I-4） */
  publishTemplate: {
    method: "POST", path: "/canvas/templates/:key/publish",
    in: z.object({
      key: z.string(),
      version: z.number().int().positive(),
      visibility: TemplateVisibility,
    }).strict(),
    out: z.object({
      key: z.string(),
      version: z.number().int().positive(),
      status: z.literal("published"),
      archivedVersions: z.array(z.object({
        key: z.string(), version: z.number().int().positive(),
      }).strict()),
    }).strict(),
    err: [
      "TEMPLATE_NOT_FOUND", "ROLE_INSUFFICIENT", "TEMPLATE_NOT_TRIALED", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** trialTemplate —— 试跑。⚠ `projectId` **唯一**，不接受多选 */
  trialTemplate: {
    method: "POST", path: "/canvas/templates/:key/trial",
    in: z.object({
      key: z.string(), version: z.number().int().positive(), projectId: z.string(),
    }).strict(),
    out: z.object({
      key: z.string(), version: z.number().int().positive(), status: z.literal("trial"),
    }).strict(),
    err: ["TEMPLATE_NOT_FOUND", "ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * archiveTemplate —— 归档（O-10 语义）。
   * ⚠ `stillBoundSegmentCount` **是契约的一部分**：归档确认框必须显示
   *   「有 N 个 `agenda_segment` 仍绑定此模板」。**返回 0 与不返回是两回事**。
   * ⚠ 归档**不禁止**存量绑定的实例化——实现成「归档即禁止实例化」会让一场正在进行的
   *   工作坊切到该环节时直接失败，这是 O-10 唯一要防的事。
   */
  archiveTemplate: {
    method: "POST", path: "/canvas/templates/:key/archive",
    in: z.object({
      key: z.string(),
      version: z.number().int().positive(),
      /** false = 只做预检不写库，供确认框显示影响面 */
      confirmed: z.boolean(),
    }).strict(),
    out: z.object({
      status: z.literal("archived"),
      stillBoundSegmentCount: z.number().int().nonnegative(),
    }).strict(),
    err: [
      "TEMPLATE_NOT_FOUND", "ROLE_INSUFFICIENT",
      "BUILTIN_TEMPLATE_UNDELETABLE", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** restoreTemplate —— [恢复] */
  restoreTemplate: {
    method: "POST", path: "/canvas/templates/:key/restore",
    in: z.object({ key: z.string(), version: z.number().int().positive() }).strict(),
    out: z.object({ status: z.enum(["draft", "published"]) }).strict(),
    err: ["TEMPLATE_NOT_FOUND", "ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * setMermaidWhitelist —— 组织级渲染白名单。
   * ⚠ **只关渲染、不关书写**（I-8）。本端口**没有**「删除已写的被禁类型代码块」的能力，
   *   缺它是刻意的：那会违反「不丢内容」。
   */
  setMermaidWhitelist: {
    method: "POST", path: "/canvas/orgs/:orgId/mermaid-whitelist",
    in: z.object({
      orgId: z.string(), enabled: z.array(MermaidDiagramType),
    }).strict(),
    out: z.object({ enabled: z.array(MermaidDiagramType) }).strict(),
    err: ["ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /* ── 二、议程环节绑定与实例化（F102）──────────────────────────── */

  /** bindTemplateToSegment —— 绑定。⚠ 同一议程环节**最多绑两个模板**（I-6） */
  bindTemplateToSegment: {
    method: "POST", path: "/canvas/agenda-segments/:agendaSegmentId/template-bindings",
    in: z.object({
      agendaSegmentId: z.string(),
      templateKey: z.string(),
      templateVersion: z.number().int().positive(),
    }).strict(),
    out: z.object({
      bindingId: z.string(),
      templateKey: z.string(),
      boundTemplateVersion: z.number().int().positive(),
    }).strict(),
    err: [
      "TEMPLATE_NOT_FOUND", "TEMPLATE_ARCHIVED", "SEGMENT_TEMPLATE_LIMIT",
      "ROLE_INSUFFICIENT", "VERSION_CHANGED", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** bindSkillToSegment —— 组员**不可自行加挂**（uc-7-4 R7） */
  bindSkillToSegment: {
    method: "POST", path: "/canvas/agenda-segments/:agendaSegmentId/skill-bindings",
    in: z.object({
      agendaSegmentId: z.string(), skillKey: z.string(), runMode: SkillRunMode,
    }).strict(),
    out: z.object({ bindingId: z.string() }).strict(),
    err: ["ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * instantiateForSegment —— 现场切议程环节，为每个分组各出一张画布。
   * ⚠ **不接受 `TEMPLATE_ARCHIVED`**——归档模板的存量绑定照常实例化（I-5 / O-10 ②）。
   * ⚠ **幂等重放**：同 `idempotencyKey` 返回**同一批** `instanceId`。
   *   现场网络抖动重试是常态，做不到幂等会给每组开出两张空画布。
   */
  instantiateForSegment: {
    method: "POST", path: "/canvas/agenda-segments/:agendaSegmentId/instances",
    in: z.object({
      agendaSegmentId: z.string(),
      groupIds: z.array(z.string()),
      idempotencyKey: z.string(),
    }).strict(),
    out: z.object({
      instances: z.array(z.object({
        instanceId: z.string(),
        groupId: z.string(),
        templateKey: z.string(),
        templateVersion: z.number().int().positive(),
        sourceArtifactId: z.string(),
      }).strict()),
    }).strict(),
    err: ["ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /* ── 三、三段互转、几何归区与布局快照（F103 F104）───────────────── */

  /** renderCanvas —— Markdown/mermaid → DiagramModel → fabric 对象。`ignoredBlocks` 保证**不丢内容** */
  renderCanvas: {
    method: "GET", path: "/canvas/instances/:instanceId/render",
    in: z.object({
      instanceId: z.string(), versionId: z.string().optional(),
    }).strict(),
    out: z.object({
      diagramModel: z.string(),
      sections: z.array(SectionDef),
      stickies: z.array(Sticky),
      /** 被白名单挡下的块**照常保留原文**，只是不渲染（I-8） */
      ignoredSyntaxCount: z.number().int().nonnegative(),
      ignoredBlocks: z.array(z.object({
        type: z.string(),
        rawLineRange: z.object({
          from: z.number().int().nonnegative(), to: z.number().int().nonnegative(),
        }).strict(),
      }).strict()),
    }).strict(),
    err: ["INSTANCE_NOT_FOUND", "NO_PROJECT_ROLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** getSource —— [源码] 视图 */
  getSource: {
    method: "GET", path: "/canvas/instances/:instanceId/source",
    in: z.object({
      instanceId: z.string(), versionId: z.string().optional(),
    }).strict(),
    out: z.object({
      markdown: z.string(), versionId: z.string(), contentHash: z.string(),
    }).strict(),
    err: ["INSTANCE_NOT_FOUND", "NO_PROJECT_ROLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** updateSource —— 源码可直接手改，改完解析回画布 */
  updateSource: {
    method: "PUT", path: "/canvas/instances/:instanceId/source",
    in: z.object({
      instanceId: z.string(),
      markdown: z.string(),
      expectedHeadVersion: z.number().int().nonnegative(),
    }).strict(),
    out: z.object({
      versionId: z.string(),
      contentHash: z.string(),
      diagramModel: z.string(),
      ignoredSyntaxCount: z.number().int().nonnegative(),
    }).strict(),
    err: [
      "NOT_IN_GROUP", "VERSION_CHANGED", "CONFLICT_PENDING_ADJUDICATION",
      "AUTHORIZATION_REVOKED", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * exportSource —— 画布对象 → Markdown（**几何归区在此发生**）。
   * ⚠ **输出里没有坐标**（I-9）。`stickyPositions` 只作为归区判定的**输入**存在，
   *   判定完就被丢弃。任何把坐标塞进 `markdown` 的实现都违反 D-08 ②。
   * ⚠ `nearestFallback: true` = 该便签落在所有分区框外、按最近框归入——
   *   界面据此给**可撤销的归区提示**（E2d）。
   */
  exportSource: {
    method: "POST", path: "/canvas/instances/:instanceId/export-source",
    in: z.object({
      instanceId: z.string(),
      stickyPositions: z.array(z.object({
        stickyId: z.string(), x: z.number(), y: z.number(),
      }).strict()),
    }).strict(),
    out: z.object({
      markdown: z.string(),
      assignments: z.array(z.object({
        stickyId: z.string(), sectionId: z.string(), nearestFallback: z.boolean(),
      }).strict()),
    }).strict(),
    err: [
      "NOT_IN_GROUP", "VERSION_CHANGED", "CONFLICT_PENDING_ADJUDICATION",
      "AUTHORIZATION_REVOKED", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * saveLayoutSnapshot —— [另存布局快照]。
   * ⚠ 快照是**独立于文本的旁路数据**，只影响本次打开的初始排布，**不参与 Markdown 往返**（I-12）。
   * ⚠ 保留份数与保留期**读留存策略的「材料保留期」，不硬编码**（O-01）；
   *   被产出/决策引用的版本属不可删对象，不受保留期约束。
   */
  saveLayoutSnapshot: {
    method: "POST", path: "/canvas/instances/:instanceId/layout-snapshots",
    in: z.object({
      instanceId: z.string(),
      layout: z.string(),
      derivedFromVersionId: z.string(),
    }).strict(),
    out: z.object({
      snapshotArtifactId: z.string(),
      snapshotVersionId: z.string(),
      derivedFrom: z.string(),
    }).strict(),
    err: ["NOT_IN_GROUP", "VERSION_CHANGED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /* ── 四、协作、并发与冲突裁决（F105）──────────────────────────── */

  /**
   * classifyChange —— 判定表，**服务端唯一实现**。
   * ⚠ 这是**全函数**：七行覆盖全部改动类型（I-15）。前端不得自行归类；
   *   返回 `undefined` / 抛异常都算违反不变量——所以本操作的 `err` 里**没有** `undefined` 出口。
   * ⚠ **归属分区变更（跨区移动）归便签级**——早期稿本两处口径打架，O-32 已按「改动作用的对象」裁定。
   */
  classifyChange: {
    method: "POST", path: "/canvas/instances/:instanceId/classify-change",
    in: z.object({
      instanceId: z.string(), change: ChangeDescriptor,
    }).strict(),
    out: z.object({ classification: ChangeClassification }).strict(),
    err: ["INSTANCE_NOT_FOUND"] as const,
  },

  /**
   * applyStickyChange —— 便签级 LWW。
   * ⚠ **不弹冲突条**，但 `supersededRevisionId` 必须能查到被覆盖的那次（I-19）。
   * ⚠ **待裁决期间此端口照常可用**（I-18）——所以 `err` 里**故意没有**
   *   `CONFLICT_PENDING_ADJUDICATION`。现场不能因为一条结构性冲突就全组停手。
   */
  applyStickyChange: {
    method: "POST", path: "/canvas/instances/:instanceId/sticky-changes",
    in: z.object({
      instanceId: z.string(),
      stickyId: z.string(),
      patch: z.object({
        text: z.string().optional(),
        color: z.string().optional(),
        size: z.string().optional(),
        position: z.object({ x: z.number(), y: z.number() }).strict().optional(),
        sectionId: z.string().optional(),
      }).strict(),
      clientTs: z.string(),
    }).strict(),
    out: z.object({
      stickyId: z.string(),
      appliedTs: z.string(),
      supersededRevisionId: z.string().nullable(),
    }).strict(),
    err: [
      "NOT_IN_GROUP", "INSTANCE_NOT_FOUND", "AUTHORIZATION_REVOKED", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * applyStructuralChange —— 结构性写。
   * ⚠ **单侧改结构直接同步、不弹冲突条**；只有两侧同时改才产生 `conflictId`（I-16）。
   * ⚠ `out` 的两支互斥：产生冲突时 `versionId` 为 null 而 `conflictId` 非空，反之亦然。
   *   用可空字段而非 `z.union`——union 会让 mock 生成器只取第一支，
   *   而「冲突这一支长什么样」正是界面最需要 mock 的东西。
   */
  applyStructuralChange: {
    method: "POST", path: "/canvas/instances/:instanceId/structural-changes",
    in: z.object({
      instanceId: z.string(),
      change: ChangeDescriptor,
      side: ChangeSide,
      expectedHeadVersion: z.number().int().nonnegative(),
    }).strict(),
    out: z.object({
      versionId: z.string().nullable(),
      conflictId: z.string().nullable(),
      docSide: ChangeSummary.nullable(),
      canvasSide: ChangeSummary.nullable(),
    }).strict(),
    err: [
      "NOT_IN_GROUP", "VERSION_CHANGED", "CONFLICT_PENDING_ADJUDICATION",
      "AUTHORIZATION_REVOKED", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * resolveConflict —— 三出口。
   * ⚠ **`preservedVersionId` 非空是 D-09 的价值核心**（I-17）：
   *   三个出口任意一个丢弃另一侧即**数据损坏**。所以它在 schema 里是**非空字符串**，
   *   不是 `.nullable()`——契约层就不给「丢掉另一侧」留位置。
   * ⚠ `outcome: "compare"` 返回「差异视图已就绪」，冲突**不消失**，仍要再选一侧。
   * ⚠ **幂等重放**：重复裁决同一 `conflictId` 返回 `CONFLICT_ALREADY_RESOLVED`
   *   并带既有 `preservedVersionId`，**不重复建版本**。
   * ⚠ **部分成功**：采纳侧写入与另一侧存版本必须在**同一事务**里；只成功一半 = 丢内容。
   */
  resolveConflict: {
    method: "POST", path: "/canvas/conflicts/:conflictId/resolve",
    in: z.object({ conflictId: z.string(), outcome: ConflictOutcome }).strict(),
    out: z.object({
      adoptedVersionId: z.string(),
      preservedVersionId: z.string(),
    }).strict(),
    err: [
      "CONFLICT_ALREADY_RESOLVED", "ROLE_INSUFFICIENT",
      "INSTANCE_NOT_FOUND", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** listGroupCanvases —— 左栏「本环节各组画布」。⚠ `stalled` 阈值**默认 5 分钟、可配置**（O-32） */
  listGroupCanvases: {
    method: "GET", path: "/canvas/agenda-segments/:agendaSegmentId/canvases",
    in: z.object({ agendaSegmentId: z.string() }).strict(),
    out: z.object({
      canvases: z.array(z.object({
        instanceId: z.string(),
        groupName: z.string(),
        templateKey: z.string(),
        stickyCount: z.number().int().nonnegative(),
        status: GroupCanvasStatus,
        stalled: z.boolean(),
      }).strict()),
    }).strict(),
    err: ["NO_PROJECT_ROLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** listProjectCanvases —— 左栏「本项目画布」 */
  listProjectCanvases: {
    method: "GET", path: "/canvas/projects/:projectId/canvases",
    in: z.object({ projectId: z.string() }).strict(),
    out: z.object({
      canvases: z.array(z.object({
        instanceId: z.string(),
        name: z.string(),
        structureSummary: z.string(),
        syncStatus: CanvasSyncStatus,
      }).strict()),
    }).strict(),
    err: ["NO_PROJECT_ROLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * computeCompleteness —— 完成度。
   * ⚠ `defined` **严格等于**模板 `sections` 条数（I-21）；
   *   `status: "落后"` **当且仅当** `missingRequiredSections` 非空（I-20）——**不与其他组横向比较**。
   * ⚠ 「无来源 · 待补」的草稿**不计入分子** `done`（I-23）——这条把留白与「已完成」区分开。
   */
  computeCompleteness: {
    method: "GET", path: "/canvas/instances/:instanceId/completeness",
    in: z.object({ instanceId: z.string() }).strict(),
    out: z.object({
      done: z.number().int().nonnegative(),
      defined: z.number().int().nonnegative(),
      missingRequiredSections: z.array(z.string()),
    }).strict(),
    err: ["INSTANCE_NOT_FOUND", "NO_PROJECT_ROLE"] as const,
  },

  /* ── 五、AI 起草、角标与轮次回滚（F106）───────────────────────── */

  /**
   * draftFromContextPack —— 一轮 AI 起草（**本束的价值核心**）。
   *
   * ⚠ **「只填到六成」是一等状态，不是半成品**：`warnings` 非空时接口**仍成功返回**
   *   且内容真实写入（I-25）。留白与「AI 出错」走**两条不同通道**——
   *   前者在 `out.warnings` 里、后者在 `err` 里，**永不共用**。
   *   把留白报成错误会让现场以为 AI 挂了并去重试，重试出的还是六成。
   * ⚠ **只经 Context API 取 Pack，不得直查** `segments` / 向量库 / 对象存储（I-27）。
   * ⚠ **只取本组，不跨组混用**（A1 / V8）；拒绝「交给 AI 分析」的受访者片段
   *   **不进输入**（O-05，前置过滤，不是出口遮盖）。
   * ⚠ **部分成功**：一轮内若有便签写入失败，整轮回滚为「未落笔」——
   *   不接受「补了 2 张、第 3 张失败」的半成品。
   * ⚠ `applied` 与 `suggested` 由画布的 `aiWriteMode` 决定，**恰好一个非空**。
   */
  draftFromContextPack: {
    method: "POST", path: "/canvas/instances/:instanceId/ai-rounds",
    in: z.object({
      instanceId: z.string(),
      agentId: z.string(),
      contextPackRequest: z.object({
        groupId: z.string(), taskType: z.string(),
      }).strict(),
      idempotencyKey: z.string(),
    }).strict(),
    out: z.object({
      roundId: z.string(),
      contextPackId: z.string(),
      /** `direct` 模式下非空 */
      applied: z.array(Sticky),
      /** `suggest` 模式下非空；**AI 内容不进正文**直到被接受（I-26） */
      suggested: z.array(Sticky),
      /** ⚠ 非空**不代表失败**——这是有意留白的证据 */
      warnings: z.array(WhitespaceWarning),
      baseVersionId: z.string(),
      appliedVersionId: z.string().nullable(),
    }).strict(),
    err: [
      "CONTEXT_PACK_UNAVAILABLE", "NOT_IN_GROUP",
      "AUTHORIZATION_REVOKED", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * validateWhitespaceRules —— 留白两规则（**纯函数**，Node 可跑）。
   * ⚠ `err` 为空数组是**刻意的**：纯函数没有失败模式。
   *   空 `err` 与「作者忘了写 err」由 `contract-shape.test.ts` 区分（缺字段才失败）。
   * ⚠ 规则①「每个分区至少留一格空」对 `capacity == null` 的分区**目前断言不出来**（[待定 D-a]）。
   */
  validateWhitespaceRules: {
    method: "POST", path: "/canvas/whitespace-rules/validate",
    in: z.object({
      markdown: z.string(), sections: z.array(SectionDef),
    }).strict(),
    out: z.object({ warnings: z.array(WhitespaceWarning) }).strict(),
    err: [] as const,
  },

  /**
   * rollbackAiRound —— 轮次级一键回滚。
   * ⚠ **原子性**（I-24）：回滚后源码与落笔前**逐字节一致**，不留半撤销状态。
   *   底座是 file-first——回滚 = 指回前一个不可变版本，原版本永不覆盖。
   * ⚠ **回滚的边界是本束替 UC 做的判断**：UC 只写「一键回滚到该轮落笔前状态」，
   *   没说这轮之后有人工改动时怎么办。本契约取 `AI_ROUND_SUPERSEDED`（拒绝直接回滚），
   *   避免把别人的改动一起吞掉。若产品要的是「强制回滚」，需要另一个显式端口 + 二次确认。
   *   见 `KNOWN_CONTRACT_GAPS.C_CANVAS_2`。
   */
  rollbackAiRound: {
    method: "POST", path: "/canvas/ai-rounds/:roundId/rollback",
    in: z.object({ roundId: z.string() }).strict(),
    out: z.object({
      restoredVersionId: z.string(), contentHash: z.string(),
    }).strict(),
    err: [
      "AI_ROUND_NOT_FOUND", "AI_ROUND_SUPERSEDED", "ROLE_INSUFFICIENT",
      "CONFLICT_PENDING_ADJUDICATION", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** setAiWriteMode —— **画布级**（不是全局）。模式变更**记审计** */
  setAiWriteMode: {
    method: "POST", path: "/canvas/instances/:instanceId/ai-write-mode",
    in: z.object({ instanceId: z.string(), mode: AiWriteMode }).strict(),
    out: z.object({ instanceId: z.string(), mode: AiWriteMode }).strict(),
    err: ["ROLE_INSUFFICIENT", "INSTANCE_NOT_FOUND", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** acceptSuggestion —— `suggest` 模式下逐条/批量接受 */
  acceptSuggestion: {
    method: "POST", path: "/canvas/instances/:instanceId/accept-suggestions",
    in: z.object({
      instanceId: z.string(), suggestionIds: z.array(z.string()),
    }).strict(),
    out: z.object({
      acceptedStickyIds: z.array(z.string()), versionId: z.string(),
    }).strict(),
    err: [
      "NOT_IN_GROUP", "VERSION_CHANGED",
      "CONFLICT_PENDING_ADJUDICATION", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /* ── 六、回流知识图谱（F107）──────────────────────────────────── */

  /** listSegmentSkills —— 左栏第三区（议程环节级白名单） */
  listSegmentSkills: {
    method: "GET", path: "/canvas/agenda-segments/:agendaSegmentId/skills",
    in: z.object({ agendaSegmentId: z.string() }).strict(),
    out: z.object({
      skills: z.array(z.object({
        skillKey: z.string(),
        displayName: z.string(),
        runMode: SkillRunMode,
        lastRunAt: z.string().nullable(),
      }).strict()),
    }).strict(),
    err: ["NO_PROJECT_ROLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** runSegmentSkill —— ⚠ **未绑定即拒绝**（I-32），**不是前端不显示** */
  runSegmentSkill: {
    method: "POST", path: "/canvas/agenda-segments/:agendaSegmentId/skill-runs",
    in: z.object({
      agendaSegmentId: z.string(),
      instanceId: z.string(),
      skillKey: z.string(),
      idempotencyKey: z.string(),
    }).strict(),
    out: z.object({
      /** 超 10 秒转可离开页面的后台任务，靠它回查 */
      taskId: z.string(),
      roundId: z.string().nullable(),
    }).strict(),
    err: [
      "SKILL_NOT_BOUND", "CONTEXT_PACK_UNAVAILABLE", "NOT_IN_GROUP",
      "AUTHORIZATION_REVOKED", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * confirmNode —— 组长确认，节点进本组小树。
   * ⚠ **来源链断即拒**（I-28）：节点回溯不到来源转录一律 `SOURCE_CHAIN_BROKEN`。
   */
  confirmNode: {
    method: "POST", path: "/canvas/instances/:instanceId/node-claims",
    in: z.object({
      instanceId: z.string(), nodeRef: z.string(), status: NodeConfirmStatus,
    }).strict(),
    out: z.object({
      claimId: z.string(), status: ClaimStatus, provenance: NodeProvenance,
    }).strict(),
    err: [
      "SOURCE_CHAIN_BROKEN", "ROLE_INSUFFICIENT", "VERSION_CHANGED", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * mergeIntoPlenaryGraph —— 汇入全场图谱。
   * ⚠ **互斥结论自动标 `contested` 且不自动择一**（I-30）：出口仅
   *   `[上台讨论]` / `[标为不确定]`——**本束不提供「系统择一」的端口**。
   */
  mergeIntoPlenaryGraph: {
    method: "POST", path: "/canvas/projects/:projectId/plenary-graph/merge",
    in: z.object({
      projectId: z.string(), claimIds: z.array(z.string()),
    }).strict(),
    out: z.object({
      merged: z.number().int().nonnegative(), contested: z.array(z.string()),
    }).strict(),
    err: ["ROLE_INSUFFICIENT", "SOURCE_CHAIN_BROKEN", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * batchConfirmAndWriteBackToBrain —— [批量确认] → 写回组织大脑。
   * ⚠ **`NODE_NOT_CONFIRMED` 是服务端闸门**（I-29）：直接调接口绕过界面也必须被拒。
   *   「前端把按钮置灰」不构成这条约束的实现。
   * ⚠ **部分成功是这里的常态**：返回 `written` + `rejected` 两个列表，
   *   **不接受「整批失败」也不接受「静默跳过」**——被拒的每一条都要带原因，界面逐条显示。
   * ⚠ **并发**（V9）：靠 `expectedRevision` 乐观并发，失败方收 `VERSION_CHANGED`。
   */
  batchConfirmAndWriteBackToBrain: {
    method: "POST", path: "/canvas/projects/:projectId/brain-writeback",
    in: z.object({
      projectId: z.string(),
      claimIds: z.array(z.string()),
      expectedRevision: z.number().int().nonnegative(),
    }).strict(),
    out: z.object({
      written: z.array(z.string()),
      rejected: z.array(z.object({
        claimId: z.string(),
        /** ⚠ 逐条原因用**本束错误码枚举**，不是自由文本——界面要按码分派出口 */
        reason: CanvasError,
      }).strict()),
    }).strict(),
    err: [
      "NODE_NOT_CONFIRMED", "SOURCE_CHAIN_BROKEN", "ROLE_INSUFFICIENT",
      "VERSION_CHANGED", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** getNodeProvenance —— 来源链反查。观察者只见已发布且脱敏的聚合 */
  getNodeProvenance: {
    method: "GET", path: "/canvas/claims/:claimId/provenance",
    in: z.object({ claimId: z.string() }).strict(),
    out: NodeProvenance,
    err: ["NO_PROJECT_ROLE", "SOURCE_CHAIN_BROKEN", "DEPENDENCY_UNAVAILABLE"] as const,
  },
} as const;

export type Operations = typeof operations;
export type OperationName = keyof Operations;

/* ────────────── 跨束「同码同义」的编译期门控（硬要求 ②）────────────── */

type PermissionReasonT = z.infer<typeof PermissionReason>;
type ContextPackReasonT = z.infer<typeof ContextPackReason>;
type CanvasErrorT = z.infer<typeof CanvasError>;

/**
 * 交集类型 `(A & B)[]` 的成员只能是**两侧都存在**的字面量：
 * 任何一侧改名/删除，`tsc` 立刻红。副本允许存在，漂移不允许。
 */
export const CANVAS_SHARED_WITH_IDENTITY = [
  "NO_PROJECT_ROLE",
] as const satisfies readonly (PermissionReasonT & CanvasErrorT)[];

/**
 * ⚠ **与 context-pack 束的交集是空的，这是刻意留空而不是漏了。**
 *
 * `usecases.md` 把「过程中权限被撤」命名为 `AUTHORIZATION_REVOKED`，
 * 而 `context-pack` / `recording` 两束叫 `PERMISSION_REVOKED_MIDWAY`——
 * **同义不同名**。本束**不擅自改名去凑同码**（那是改别人签过的 UC），
 * 也不假装它们无关：登记在 `KNOWN_CONTRACT_GAPS.C_CANVAS_7`。
 *
 * 空数组仍写出来，是为了让「这里本该有交集」这件事在代码里可见——
 * 删掉这行，下一个人只会以为 canvas 与 context-pack 没有共享失败面。
 */
export const CANVAS_SHARED_WITH_CONTEXT_PACK = [
] as const satisfies readonly (ContextPackReasonT & CanvasErrorT)[];

/* ─────────────────────── 已知契约缺陷（如实登记）─────────────────────── */

export const KNOWN_CONTRACT_GAPS = {
  /**
   * 🔴 **三粒度 AI 权限的求交语义未定，本契约表达不了它。**
   *
   * 系统里存在**三处**互不相同的 AI 权限声明：
   *   ① **每区 AI 权限（模板级）** —— `SectionDef` 上本该有的「这个分区允许 AI 写吗」
   *   ② **项目级三开关** —— 项目设置里的 AI 能力总闸
   *   ③ **画布级默认** —— 本文件的 `setAiWriteMode`（`direct` / `suggest`）
   *
   * `usecases.md` 只定义了 ③。①②在其它束/需求文档里各自出现，
   * **三者相遇时怎么求交没有任何地方写过**：是取最严？是模板级优先？
   * 项目级关掉时画布级 `direct` 还成不成立？分区级允许而项目级禁止时呢？
   *
   * ⇒ 本契约**只实现 ③**，`SectionDef` 上**没有** AI 权限字段——
   *   加一个就等于替产品选了一种求交语义，而那正是本仓「同一事实两处声明」的高发形状。
   *   实现方**不得**自选一种当验收线。需人类裁决后统一到**单一事实源 + 机械门控**。
   */
  C_CANVAS_1: "three-granularity AI write permission (section/project/canvas) has no defined intersection semantics; only canvas-level is contracted",

  /**
   * **`AI_ROUND_SUPERSEDED` 是本束替 UC 做的判断，不是 UC 写的。**
   *
   * UC 只写「一键回滚到该轮落笔前状态」，**没说这轮之后有人工改动时怎么办**。
   * 两种可能：拒绝回滚（保住别人的改动）／强制回滚（吞掉别人的改动）。
   * 本契约取前者。若产品要后者，需要**另一个显式端口 + 二次确认**，不是把这个码删掉。
   * 请在签核时确认。
   */
  C_CANVAS_2: "AI_ROUND_SUPERSEDED (refuse rollback when later human edits exist) is this bundle's judgement, not the UC's",

  /**
   * **`TEMPLATE_NOT_TRIALED` 的存在性待定（[待定 D-b]）。**
   *
   * 原型档案未证实「未试跑不许发布」这个阻断存在。
   * 裁决为「不阻断」时，**此码要从 `CanvasError` 与 `publishTemplate.err` 两处一起删**——
   * 只删一处会留下一个不可达的错误码，而不可达的错误码正是「门控空转」的形状。
   */
  C_CANVAS_3: "TEMPLATE_NOT_TRIALED gate is unverified in the prototype archive (D-b); if ruled non-blocking the code must be deleted from BOTH places",

  /**
   * **审计事件的查询面不在本束。**
   *
   * `usecases.md` 第八节要求本束写 4 组共 12+ 类审计事件（模板六类 / 画布三类 /
   * AI 三类 / 回流三类 + 越权尝试），但**没有任何操作能读回它们**。
   * 本束刻意**不另造一个审计查询面**——phase-00 `provenance` 束已有统一查询面，
   * 两套会漂移。⇒ 后果照实说：canvas 侧审计**写得下、查不着**，
   * 直到 `provenance.queryProvenance` 支持本束的事件类型。
   */
  C_CANVAS_4: "canvas writes 12+ audit event types but exposes no query surface; deliberately deferred to the shared provenance bundle, which does not yet cover them",

  /**
   * **`[待定 D-e]` 材料清单 与 `[待定 D-d]` 方法环节格回填，两个端口都缺。**
   *
   * · AC1 要求 `instantiateForSegment` 一并下发「材料清单」，形态未定 ⇒ 本端口不含它。
   * · V5b 要求回流后回填「方法环节格」状态，对应表未确认 ⇒ 本组端口不含它。
   * 两处都是**缺着而不是编一个**。加上去会让契约看起来覆盖了那条链路，而它是空的。
   */
  C_CANVAS_5: "material-list on instantiate (D-e) and method-cell backfill after writeback (D-d) are both absent, shape undetermined",

  /**
   * **`ChangeDescriptor.kind` / `payload` 是开放字符串，判定表的七行断言不出来。**
   *
   * I-15 要求 `classifyChange` 是**全函数**（七行覆盖全部改动类型），
   * 但 `kind: z.string()` 意味着契约层永远存在「第八种输入」。
   * `.strict()` 挡多余字段，不挡开放取值——这是它挡不住的方向。
   * ⇒ 全函数性只能由 domain 的判定表 + 应用层穷举保证，契约给不出机械门控。
   */
  C_CANVAS_6: "ChangeDescriptor.kind is an open string, so classifyChange's totality (I-15, seven rows) is unassertable at the contract layer",

  /**
   * **「过程中权限被撤回」在三个束里有两个名字。**
   *
   * · canvas（本束，按 `usecases.md` 逐字）：`AUTHORIZATION_REVOKED`
   * · context-pack（phase-00，已签）与 recording：`PERMISSION_REVOKED_MIDWAY`
   *
   * 语义**完全相同**（立即终止后续写、已完成步骤按审计保留、未提交输入留本地草稿）。
   * 本束**没有**擅自改名去凑同码——那等于改一份人类签过的 UC。
   * 后果照实说：跨束的「权限中途被撤」处理逻辑**无法用一条编译期断言绑住**，
   * 前端也要认两个码。收敛需人类裁一个名字，两侧一起改。
   */
  C_CANVAS_7: "mid-flight authorization revocation is named AUTHORIZATION_REVOKED here but PERMISSION_REVOKED_MIDWAY in context-pack/recording; same meaning, two names, no compile-time tie",

  /**
   * 🟡 **`createTemplate` 本身待人类补签（#496），且它带出两个次级缺口。**
   *
   * ① **没有 `ownerTeamId`。** `visibility: "team-only"` 要求「归哪个团队」，而本束的
   *    `listTemplates.out` / `publishTemplate.in` / `createTemplate.in` 三处都没有这一栏
   *    （与 `identity` 束 `CapabilityListing` 的同一处缺口逐字同型）。实现取创建者自己的
   *    团队；**创建者无团队时该行对所有人不可见**（fail-closed，见 canvas 模板注册表迁移
   *    的文件头）。这是缺口的后果，不是一个可以靠默认值糊过去的实现细节。
   *
   * ② **没有「基于既有模板开新版」。** 因此 `createTemplate.out.version` 是
   *    `z.literal(1)`——本操作只铸 v1。v2 只能由一个本契约尚不存在的操作产生，
   *    在它被签核之前，「改模板」这件事在产品上做不出来。
   *
   * ⚠ 补签时这两条要一起裁：签了 `createTemplate` 却不裁 ①，会得到一个
   *   「建完就看不见」的 team-only 模板。
   */
  C_CANVAS_8: "createTemplate is pending human sign-off (#496); it also exposes two sub-gaps: no ownerTeamId for team-only visibility (fail-closed to invisible), and no operation to mint a version beyond v1",
} as const;
