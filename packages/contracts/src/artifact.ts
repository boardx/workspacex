/**
 * 契约束 `artifact` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西，任何一样都不许手写第二份——
 *   ├─→ 后端 DTO + NestJS 全局 ValidationPipe 的运行时校验
 *   ├─→ 前端 client 类型
 *   ├─→ OpenAPI（对外文档 + 契约 diff 门控）
 *   └─→ 前端 mock 数据          ←── 这条是关键
 *
 * 覆盖 feature：F04 F05 F06 F07 F08（phase-00，合计 21 点）
 * 依据 UC：`uc-0-1 把 Studio 产出保存回项目`
 * 领域模型见 `phases/phase-00-shared-kernel/contracts/artifact/domain.md`
 * 用例接口见 同目录 `usecases.md`
 *
 * 核心不变量（domain.md 有断言方式）：
 *   · 原件不可变：artifact_version 写入对象存储后**永不覆盖**，更新走新版本
 *   · S3/PG 双 canonical：**原件 canonical 在 S3**，PG 只存指针 + SHA-256，
 *     PG 无法从指针恢复丢失的文件（灾备须同时恢复 PG + 对象存储 + 事件日志）
 *   · 固定快照绑定后上游变化不改写它（三模式绑定：草稿/实时关联/固定快照，D-30）
 *   · provenance_events append-only（血缘 + 越权尝试安全审计）
 */
import { z } from "zod";

/* ─────────────────────── 枚举（与 domain.md 一一对应）─────────────────────── */

/** Artifact 来源。任何来源最终都标准化为 Artifact，且 file-first 物化为真实文件（architecture 2.1） */
export const ArtifactSource = z.enum([
  "survey",        // 问卷 → responses.csv + schema.json
  "conversation",  // 对话 → messages.jsonl
  "interview",     // 访谈 → 音频 + transcript.jsonl + notes.md
  "prototype-run", // 原型 Studio 产出
  "research-run",  // 深度研究 → run + 网页快照 + 引用清单
  "upload",        // Word/PDF/PPT 等原文件
  "ai-generated",  // AI 生成 → 内容文件 + provenance.json（醒目标记 synthesized）
]);

/**
 * 三模式绑定（D-30）。**只有 `pinned`（固定快照）可被下游引用**（F07）。
 * ⚠ `pinned` 不可降级为 `live`/`draft`（A3）——已定版可能已被引用。
 */
export const BindingMode = z.enum([
  "draft",  // 仅创建者可见，项目侧不出现，不可被任何下游引用
  "live",   // 实时关联：项目侧随源变动，标注「实时 · 随源变动」
  "pinned", // 固定快照：冻结到某个不可变 artifact_version，定版后源改动不影响它
]);

/**
 * 摄取九态（+ REVIEW_PENDING）。架构第三节的可重放、幂等异步状态机。
 * RECEIVED→QUARANTINED→SCANNED→STORED→EXTRACTED→SEGMENTED→ENRICHED→INDEXED→READY
 * REVIEW_PENDING 是 INDEXED 之后的岔路（命中 PII/synth/低置信需人工复核）。
 * ⚠ 界面已建成于 `/projects/[id]/files` 的摄取抽屉（files-ingestion-ladder）。
 */
export const IngestionStatus = z.enum([
  "RECEIVED", "QUARANTINED", "SCANNED", "STORED", "EXTRACTED",
  "SEGMENTED", "ENRICHED", "INDEXED", "REVIEW_PENDING", "READY",
]);

/** 派生物类型。带 `derivedFrom` 指回原件版本，**不覆盖原件**（是独立文件） */
export const DerivedKind = z.enum([
  "ocr", "asr", "summary", "embedding", "visual-description",
]);

/** 引用锚点：每个 Segment 必须能回到原件的具体位置 */
export const AnchorKind = z.enum([
  "page", "bbox", "timecode", "message-id", "question-no", "image-region",
]);

/** 最小检索单元的模态 */
export const SegmentKind = z.enum(["text", "message", "answer", "audio-span"]);

/**
 * ⚠ **2026-07-28（一致性复核 B-1 / X-2）：provenance 已提取为跨束共享契约。**
 *
 * 本束原先自建了一份 `ProvenanceEventType` / `ProvenanceEvent` / `queryProvenance`，
 * 而 identity 束也写同一张表却没有查询面——两束各造一个的话，
 * 「查审计」这件事对使用者是分裂的，之后合并是返工。
 *
 * ⇒ 三者统一到 `./provenance.ts`。本束只负责**声明自己写哪些事件类型**，
 *   不再自造查询接口。
 */
export {
  ProvenanceEventType,
  ProvenanceEvent,
  type ProvenanceEventTypeT,
} from "./provenance";

/** 本束会写入的事件类型（子集声明，供文档与测试核对；查询走共享契约） */
export const ARTIFACT_PROVENANCE_EVENTS = [
  "ingested", "transformed", "generated", "human-edited",
  "pinned", "bound", "unbound", "superseded",
  "evidence-withdrawn", "unauthorized-attempt",
] as const;

/** 下游引用用途——**只有固定快照可用于这五类**（F07 / AC1） */
export const DownstreamPurpose = z.enum([
  "report-final",     // 加入报告正式版
  "acceptance",       // 提交验收（还须经 UC-13.2 验收才获证据资格）
  "decision-reference", // 引用为决策依据
  "graph-writeback",  // 写回知识图谱
  "brain-promotion",  // 写回组织大脑
]);

/**
 * 失败模式全集。前端据此渲染异常态——**「失败长什么样」是契约的一半**。
 * 已有原型是 happy path 演示、零异常态，别继承这个缺陷。
 * ⚠ `ARTIFACT_NOT_FOUND` 兼任草稿越权：草稿仅创建者可见，其余角色（含管理员）
 *   一律返回 not-found 而非 forbidden（V4）——不得泄露资源是否存在。
 */
export const ArtifactError = z.enum([
  "NO_PROJECT_ROLE",           // 项目层无角色（判定属 identity 束，此处返回）
  "PROJECT_ROLE_INSUFFICIENT", // 角色存在但不能定版/绑定
  "STEP_CLOSED",               // 目标环节已关闭/已归档（E2）
  "STEP_REJECTS_ARTIFACT_TYPE",// 该环节不允许此类产出（R3 步骤2）
  "VERSION_CHANGED",           // 并发定版，版本已前进（E4/V6）
  "REQUIRES_PINNED",           // 下游引用需先定版为固定快照（E1/AC1/F07）
  "CANNOT_DOWNGRADE",          // 固定快照不可降级为实时关联/草稿（A3）
  "SNAPSHOT_IMMUTABLE",        // 试图修改/删除已定版快照（I-1/I-11/V8）
  "ARTIFACT_NOT_FOUND",        // 不存在，或草稿越权（V4：返回 404 而非 403）
  "MATERIALIZATION_FAILED",    // file-first 物化失败（非文件来源未能落成文件）
  "INGESTION_FAILED",          // 摄取流水线失败（含扫描/解析失败）
  "DEPENDENCY_UNAVAILABLE",    // 存储/网络/依赖不可用（E3：保留输入，安全重试，不静默）
]);

/* ─────────────────────────────── 实体 ─────────────────────────────── */

/** `artifacts` —— 逻辑对象。projectId 可空：Studio 可独立发起、不依赖项目（A1） */
export const Artifact = z.object({
  id: z.string(),
  orgId: z.string(),
  projectId: z.string().nullable(),
  source: ArtifactSource,
  title: z.string(),
  createdBy: z.string(),
  /** synthesized 来源醒目标记——不得在检索中伪装成一手证据（architecture） */
  synthesized: z.boolean(),
  /** 资源可见性范围。⚠ 必须沿数据链路传播到 segment/embedding/图节点（见 domain I-13，跨束） */
  scope: z.enum(["org-wide", "team-only"]),
}).strict();

/**
 * `artifact_versions` —— **不可变版本**。
 * ⚠ canonical 双源：`objectStorageKey` 指向 S3 原件（canonical），
 *   PG 只存指针 + `contentHash`（SHA-256）+ MIME + 版本号。**PG 里没有文件体**。
 * 「固定快照」= 一条这样的记录，写入后永不覆盖（不是应用层布尔标记，domain I-1/I-4）。
 */
export const ArtifactVersion = z.object({
  id: z.string(),
  artifactId: z.string(),
  versionNumber: z.number().int().positive(),
  /** S3 对象存储 key —— 原件 canonical，写入后永不覆盖 */
  objectStorageKey: z.string(),
  /** SHA-256，可校验：下载字节重算须相等（domain I-3） */
  contentHash: z.string(),
  mime: z.string(),
  sizeBytes: z.number().int().nonnegative(),
  pinnedBy: z.string(),
  pinnedAt: z.string(),
  /** 定版时的 Context Pack 引用清单 id（见 UC-0.2）——支撑「这条结论当时看了什么」 */
  contextPackId: z.string().nullable(),
}).strict();

/** `segments` —— 最小检索单元。每个 segment 必须能回到原件（≥1 个 anchor，domain I-7） */
export const Segment = z.object({
  id: z.string(),
  artifactVersionId: z.string(),
  kind: SegmentKind,
  ordinal: z.number().int().nonnegative(),
}).strict();

/** `anchors` —— 回到原件的具体位置 */
export const Anchor = z.object({
  id: z.string(),
  segmentId: z.string(),
  kind: AnchorKind,
  /** 定位符：页码/时间码/消息 ID/题号等（按 kind 解释） */
  locator: z.string(),
}).strict();

/**
 * `derived_representations` —— 派生物是**独立文件**，带 `derivedFrom` 指回原件版本，
 * **不覆盖原件**（domain I-6）。OCR/ASR/摘要/embedding 都记录模型与版本。
 */
export const DerivedRepresentation = z.object({
  id: z.string(),
  derivedFrom: z.string(),       // 指回某个 artifact_version.id
  kind: DerivedKind,
  objectStorageKey: z.string(),  // 派生物同样是可下载文件
  model: z.string().nullable(),
  modelVersion: z.string().nullable(),
}).strict();



/**
 * 绑定关系 —— 三模式把 Artifact 挂到项目环节。
 * ⚠ 绑定必须存 `pinnedVersionId`（快照）而非仅 `artifactId`（F06 notes）：
 *   · pinned → `pinnedVersionId` 非空，冻结到该不可变版本
 *   · live   → `pinnedVersionId` 为 null，读取时解析到当前最新版本（随源变动）
 *   · draft  → **不产生项目侧绑定行**（仅创建者可见的草稿缓冲）
 */
export const Binding = z.object({
  id: z.string(),
  artifactId: z.string(),
  projectId: z.string(),
  agendaSegmentId: z.string(),
  mode: BindingMode,
  pinnedVersionId: z.string().nullable(),
}).strict();

/**
 * 项目侧「已回流的产出与版本」一行。
 * ⚠ 四字段（mode/version/pinnedBy/pinnedAt）非空（草稿除外，草稿根本不在此列表）——F06 / AC3 / R12 V3。
 */
export const BackflowEntry = z.object({
  bindingId: z.string(),
  artifactId: z.string(),
  title: z.string(),
  mode: BindingMode,
  version: z.number().int().positive(),
  pinnedBy: z.string(),
  pinnedAt: z.string(),
  /** 界面徽标：草稿 / 实时 · 随源变动 / 已定版 vN（R8） */
  badge: z.enum(["draft", "live", "pinned"]),
}).strict();

/** 摄取运行态——供 `/projects/[id]/files` 摄取抽屉渲染九态阶梯 */
export const IngestionRun = z.object({
  id: z.string(),
  artifactId: z.string(),
  status: IngestionStatus,
  /** 幂等键 = content_hash + pipeline_version + parser_version（架构：重复摄取幂等） */
  idempotencyKey: z.string(),
  pipelineVersion: z.string(),
  /** 失败态的原因；REVIEW_PENDING 的触发原因（PII/synth/低置信） */
  note: z.string().nullable(),
}).strict();

/* ───────────────────────────── 操作 ───────────────────────────── */

/**
 * 每个操作 = { method, path, in, out, err }。
 * `err` 穷举失败模式——界面的异常态全靠它。
 */
export const operations = {
  /**
   * saveDraft —— R3 步骤1：把当前内容写入草稿缓冲。
   * ⚠ 自动保存只走这里：**永不改变已有绑定、永不产生固定快照**（R7）。
   * file-first：非文件来源在此物化为真实文件（responses.csv/messages.jsonl/...）。
   */
  saveDraft: {
    method: "POST", path: "/artifacts/draft",
    in: z.object({
      artifactId: z.string().optional(), // 首次保存可空，由系统建 Artifact
      orgId: z.string(),
      projectId: z.string().nullable(),
      source: ArtifactSource,
      title: z.string(),
    }).strict(),
    out: z.object({
      artifactId: z.string(),
      autosavedAt: z.string(),
      /** 物化产出的文件 key（file-first：draft 也必须有真实文件） */
      materializedKeys: z.array(z.string()),
    }).strict(),
    err: ["MATERIALIZATION_FAILED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * pinVersion —— R3 步骤3（固定快照）/ A2（实时关联升级为定版）：
   * 对当前内容做**不可变复制**，生成 artifact@vN，固化 SHA-256，记录定版人/时间/Context Pack。
   * ⚠ 并发定版只产生一个新版本号，另一方收到 VERSION_CHANGED（E4/V6）。
   */
  pinVersion: {
    method: "POST", path: "/artifacts/:artifactId/versions",
    in: z.object({
      artifactId: z.string(),
      /** 乐观并发：客户端认为的当前最新版本号；不匹配即 VERSION_CHANGED */
      expectedHeadVersion: z.number().int().nonnegative(),
    }).strict(),
    out: z.object({
      versionId: z.string(),
      versionNumber: z.number().int().positive(),
      contentHash: z.string(),
      objectStorageKey: z.string(),
    }).strict(),
    err: [
      "PROJECT_ROLE_INSUFFICIENT", "VERSION_CHANGED",
      "MATERIALIZATION_FAILED", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * bindToProjectStep —— R3 步骤2-4：把 Artifact 以某模式挂到项目环节。
   * pre: 调用者在该项目该环节有写权限（两层交集，判定属 identity 束）。
   * pinned 模式要求 `sourceVersionId` 指向一个已存在的不可变版本。
   */
  bindToProjectStep: {
    method: "POST", path: "/artifacts/:artifactId/bindings",
    in: z.object({
      artifactId: z.string(),
      projectId: z.string(),
      agendaSegmentId: z.string(),
      mode: BindingMode,
      /** pinned 模式必填：要冻结到哪个版本 */
      sourceVersionId: z.string().optional(),
    }).strict(),
    out: Binding,
    err: [
      "NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT",
      "STEP_CLOSED", "STEP_REJECTS_ARTIFACT_TYPE",
      "ARTIFACT_NOT_FOUND", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * upgradeBinding —— A2/A3：实时关联升级为固定快照。
   * ⚠ **只能升级不能降级**：pinned → live/draft 一律 CANNOT_DOWNGRADE。
   */
  upgradeBinding: {
    method: "POST", path: "/artifacts/bindings/:bindingId/upgrade",
    in: z.object({ bindingId: z.string(), expectedHeadVersion: z.number().int().nonnegative() }).strict(),
    out: Binding,
    err: [
      "CANNOT_DOWNGRADE", "VERSION_CHANGED",
      "PROJECT_ROLE_INSUFFICIENT", "ARTIFACT_NOT_FOUND",
    ] as const,
  },

  /**
   * listBackflow —— 项目侧「已回流的产出与版本」（F06 / AC3）。
   * ⚠ **草稿不出现在此列表**（草稿仅创建者可见）；每条四字段非空。
   */
  listBackflow: {
    method: "GET", path: "/projects/:projectId/backflow",
    in: z.object({ projectId: z.string(), agendaSegmentId: z.string().optional() }).strict(),
    // 空态返回 []，不生成伪数据（V5）
    out: z.array(BackflowEntry),
    err: ["NO_PROJECT_ROLE"] as const,
  },

  /**
   * referenceForDownstream —— **下游引用资格门控**（F07，本用例价值核心）。
   * ⚠ 只有指向**固定快照**（不可变 artifact_version）的引用才被允许；
   *   对 live/draft 一律 REQUIRES_PINNED，并提供一键定版入口（错误 detail 带 artifactId）。
   *
   * ⚠ **2026-07-29（F07 实现记录）：`in` 里只有 `versionId`，而 `versionId` 恒指向一条
   * 不可变版本行——按字面读，本操作永远 eligible，`REQUIRES_PINNED` 不可达，整道门空转。**
   * 实现取的是另一读法：资格是**绑定**的属性不是版本的属性（`live` 解析到 head、`draft`
   * 不上项目侧），故判据为「存在一条 `pinned` 绑定恰好钉住这个版本」。分歧已报未猜，
   * 见 `apps/api/src/domain/artifact/downstream-eligibility.ts` 的模块头。
   *
   * ⚠ `out` 是本文件里**唯一 `.strict()` 的 out**：门控的失败方向是「多返回了字段」
   * （例如把 `artifactId` 顺手塞进成功响应），zod 默认剥离未知键会让这个方向的断言全是瞎的。
   * 其余约 30 个 out 尚未 strict——那是跨束改动，单列。
   */
  referenceForDownstream: {
    method: "POST", path: "/artifacts/versions/:versionId/references",
    in: z.object({
      versionId: z.string(),
      purpose: DownstreamPurpose,
      referencedBy: z.object({ kind: z.string(), id: z.string() }).strict(),
    }).strict(),
    out: z.object({ referenceId: z.string(), eligible: z.boolean() }).strict(),
    err: ["REQUIRES_PINNED", "SNAPSHOT_IMMUTABLE", "ARTIFACT_NOT_FOUND"] as const,
  },

  /**
   * getIngestionStatus —— 摄取九态抽屉（`files-ingestion-ladder`）。
   * 重跑摄取只生成新派生版本，不修改旧结果（幂等）。
   */
  getIngestionStatus: {
    method: "GET", path: "/artifacts/:artifactId/ingestion",
    in: z.object({ artifactId: z.string() }).strict(),
    out: IngestionRun,
    err: ["ARTIFACT_NOT_FOUND", "INGESTION_FAILED"] as const,
  },



  /**
   * markEvidenceWithdrawn —— E5：快照支撑的上游证据被撤回。
   * ⚠ **不修改快照内容**；改为在引用处标注「证据已撤回」，并通知拍板人复核
   *   （不自动改已签字结论）。写一条 evidence-withdrawn 的 provenance 事件。
   */
  markEvidenceWithdrawn: {
    method: "POST", path: "/artifacts/versions/:versionId/evidence-withdrawn",
    in: z.object({ versionId: z.string(), reason: z.string() }).strict(),
    out: z.object({
      /** 被标注「证据已撤回」的下游引用 */
      annotatedReferences: z.array(z.string()),
      /** 被通知复核的拍板人 */
      notifiedApprovers: z.array(z.string()),
      provenanceEventId: z.string(),
    }).strict(),
    err: ["ARTIFACT_NOT_FOUND", "DEPENDENCY_UNAVAILABLE"] as const,
  },
} as const;

export type Operations = typeof operations;
export type OperationName = keyof Operations;
