/**
 * 契约束 `files` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西，任何一样都不许手写第二份。
 * 覆盖 feature：见 `contracts/files/design-signoff.md` frontmatter `covers:`（权威）。
 * 依据：同目录 `usecases.md`（508 行，phase-01 最完整的一份）/ `domain.md`；
 * 需求 `requirements/22-files/uc-22-1…4`。
 *
 * ## 这个束没有 happy-path 原型可以继承
 * 四份 UC 的 R8 一致判定「原型确认缺失」：项目工作台 7 标签 + 项目设置 6 子标签
 * 已完整抽取，其中**没有任何文件浏览 / 目录树 / 版本列表 / 删除确认的界面**。
 * ⇒ **也就没有借口只写 happy path**。本文件的 `err` 覆盖七类失败模式，
 * 逐条对应 `usecases.md` 末尾的自查表。
 *
 * ## 🔴 本束最危险的三条（每一条都有过「全绿但空转」的先例形状）
 *   · **删除的部分失败不得标为完成、不得出回执**（N-17）。六类级联**缺一即验收不通过**。
 *   · **物化失败不阻断业务，但必须产生可见的失败记录**（V9·22-3）——
 *     **静默失败是本 UC 最危险的缺陷模式**：用户以为都在文件里了，交付时才发现缺。
 *   · **拒绝响应不得泄露资源是否存在**：可见性拒绝一律折叠为 `ARTIFACT_NOT_FOUND`，
 *     且与「真的不存在」**逐字节同响应**（状态码 + 响应体 + 响应头，N-25）。
 *
 * ## ⚠ 待人类裁决的分歧（本文件**不选边**）
 *   · **来源类型词表两套且对不上** —— 见 `KNOWN_CONTRACT_GAPS.FS1`。这是本束的头号分歧。
 *   · `IngestionRun` 的 `status`（线上）vs `state`（前端视图）—— **同名不同义已立纪律，
 *     两者不合并**，见 `KNOWN_CONTRACT_GAPS.FS2`。
 */
import { z } from "zod";
import { ArtifactError, IngestionStatus, DerivedKind, AnchorKind } from "./artifact";
import { PermissionReason } from "./identity";

/* ─────────────────────────── 枚举 ─────────────────────────── */

/**
 * 本束的失败面。分三段：
 *   ① 复用 phase-00 `artifact.ArtifactError`（**不重复定义**，`_sharedWithArtifact` 是门控）
 *   ② 与 `identity.PermissionReason` 同码同义（`_sharedWithIdentity`）
 *   ③ 本束新增 18 码（`usecases.md`「本束新增 18 码」表逐条，**这里不许多一条**）
 *
 * ⚠ 每一个成员都在下方某个操作的 `err` 里出现。
 * ⚠ **失败态不显示裸错误码**：界面统一「在哪一步失败 + 为什么 + 能做什么」三段式（R8·22-2）。
 *   契约只负责让每一种失败**可区分**；文案是界面的事。
 */
export const FilesError = z.enum([
  /* ── ① artifact 束同码同义（usecases.md 第一节逐条）──────────── */
  "NO_PROJECT_ROLE",
  "PROJECT_ROLE_INSUFFICIENT",
  "VERSION_CHANGED",
  "REQUIRES_PINNED",
  "CANNOT_DOWNGRADE",
  "SNAPSHOT_IMMUTABLE",
  /**
   * ⚠ 本束**收紧**：不仅是「404 非 403」，而是与「真的不存在」**逐字节同响应**
   * （状态码 + 响应体 + 响应头，N-25 / V6·22-1）。任何差异都是资源存在性泄露——
   * 包括响应时间上的差异，那一条契约表达不了，只能在验收里测。
   */
  "ARTIFACT_NOT_FOUND",
  "MATERIALIZATION_FAILED",
  "INGESTION_FAILED",
  /** ⚠ **不得把失败呈现为空列表**——空与失败必须可区分（uc-00-2 E3 / V9） */
  "DEPENDENCY_UNAVAILABLE",

  /* ── ③ 本束新增 18 码 ──────────────────────────────────────── */
  /** 扩展名/MIME 不在白名单。⚠ 白名单本身 **[待定 T-2]**；前端须逐个列出「哪个文件、哪一项、实际是什么」 */
  "FILE_TYPE_REJECTED",
  /** 单文件超上限。⚠ 必须**同时给当前值与上限值**；数值 **[待定 T-1]** */
  "FILE_TOO_LARGE",
  /** 单次批量超上限。出口：拆分 / 申请提额（提额路径是否提供 **[待定]**） */
  "BATCH_LIMIT_EXCEEDED",
  /** 解压后总量/层数/条目数超限。⚠ 且**未发生完整解压**——检查本身不能是攻击面 */
  "ARCHIVE_BOMB_DETECTED",
  /** 恶意扫描不通过。⚠ 已拒绝并留痕；**不得抹掉痕迹**（N-9） */
  "MALWARE_DETECTED",
  /** 实际字节类型 ≠ 扩展名。⚠ **不信任扩展名与 `Content-Type` 头**；有权者可「按检出类型继续」（写审计） */
  "MIME_MISMATCH",
  /** SHA-256 与对象字节不符。⚠ **不得悄悄给出损坏文件**（V8·22-1）：该行标失败 + 禁止下载 + 告警 */
  "INTEGRITY_CHECK_FAILED",
  /** 批量导出超阈值。⚠ **不得静默截断**（E2·22-1）；阈值 **[待定 T-10]** */
  "EXPORT_LIMIT_EXCEEDED",
  /** 短时效 URL 过期（N-24） */
  "DOWNLOAD_URL_EXPIRED",
  /** 一次性 URL 已用。⚠ **不得签发可转发的长期公开链接** */
  "DOWNLOAD_URL_CONSUMED",
  /** 加密/损坏/编码不支持。🔴 **原件仍可见可下载**（N-7 / AC3·22-2）——抽取失败不牵连原件 */
  "EXTRACTION_FAILED",
  /** 命中机密 ∨ PII 五类 ∨ 解析质量低。⚠ **不得静默入库**；阈值与审核人 **[待定 T-9]** */
  "REVIEW_REQUIRED",
  /** 生成物缺 `provenance.json` 七键之一。🔴 N-12，**不得进 READY** */
  "PROVENANCE_MISSING",
  /**
   * 产出文件名集合 ≠ 七类清单该行（N-10）。
   * ⚠ 与 `MATERIALIZATION_FAILED` **分开**——前者是**契约违反**，后者是**执行失败**。
   *   合并会让「实现少产出了一个文件」看起来像一次网络抖动。
   */
  "MATERIALIZATION_SPEC_VIOLATION",
  /** 对象处于 legal hold。🔴 **不得出具虚假回执**（N-19）：若为受访者撤回触发，须如实告知存在法定留存 */
  "LEGAL_HOLD_ACTIVE",
  /** 🔴 六类级联部分失败 —— **本束最危险的态**（N-17）。「部分失败 · 未出回执 · 重试级联」 */
  "DELETION_PARTIAL_FAILURE",
  /** 下游失效接口不可用（09-kg / 10-report / pgvector / 缓存）。⚠ 须标出**哪一类**未完成 */
  "CASCADE_TARGET_UNAVAILABLE",
  /** 🔴 agent 身份调删除 —— **agent 不得发起删除**（D-39 同源）。不面向用户 */
  "AGENT_CANNOT_DELETE",

  /**
   * 留存五参数非法。
   * ⚠ **它在 `usecases.md` 的 `setRetentionPolicy.err` 里出现，却不在那张「新增 18 码」表里。**
   *   ⇒ 本文件收下它（有出处），但把这处不一致登记为 `KNOWN_CONTRACT_GAPS.FS8`——
   *     「18 码」这个数字与实际列出的码**对不上**，签核时请一并裁。
   */
  "RETENTION_PARAM_INVALID",
]);

type FilesErrorT = z.infer<typeof FilesError>;
type ArtifactErrorT = z.infer<typeof ArtifactError>;
type PermissionReasonT = z.infer<typeof PermissionReason>;

/**
 * **跨束同码同义的编译期门控**（`pnpm --filter @repo/contracts run typecheck` 会红）。
 *
 * 交集类型只接受**两个枚举都有**的字面量：`artifact` 侧任何一次改名，这里立刻编译失败。
 * ⚠ 为什么不 import 枚举本身：`artifact` 是更内层的已签核束，
 *   直接 import 会让本束的失败面随它变动。要的是「同名是刻意的」的**证明**，不是依赖。
 */
const _sharedWithArtifact = [
  "NO_PROJECT_ROLE",
  "PROJECT_ROLE_INSUFFICIENT",
  "VERSION_CHANGED",
  "REQUIRES_PINNED",
  "CANNOT_DOWNGRADE",
  "SNAPSHOT_IMMUTABLE",
  "ARTIFACT_NOT_FOUND",
  "MATERIALIZATION_FAILED",
  "INGESTION_FAILED",
  "DEPENDENCY_UNAVAILABLE",
] as const satisfies readonly (ArtifactErrorT & FilesErrorT)[];

const _sharedWithIdentity = [
  "NO_PROJECT_ROLE",
  "PROJECT_ROLE_INSUFFICIENT",
] as const satisfies readonly (PermissionReasonT & FilesErrorT)[];

/**
 * 🔴 **来源类型词表：本束刻意不给它一个枚举。**
 *
 * 两套词表并存且**对不上**（不是包含关系，是交叉）：
 *   · 契约侧 `artifact.ArtifactSource`（**已签核，7 值**）：
 *     `survey` `conversation` `interview` `prototype-run` `research-run` `upload` `ai-generated`
 *   · 界面侧 `apps/web/lib/mock/files.ts` 的 `SourceType`（**8 值**）：
 *     `file` `survey` `interview` `workshop` `research` `conversation` `canvas` `generated`
 *
 * 差异有三层，任何一层单独看都会被误当成笔误：
 *   ① **名字不同**：`upload`↔`file` · `research-run`↔`research` · `ai-generated`↔`generated`
 *   ② **8 值多出两类**：`workshop` / `canvas` —— **契约里没有对应物**
 *   ③ **7 值多出一类**：`prototype-run` —— **界面里没有对应物**
 * 而 `usecases.md` 自己在 A5·22-1 逐字写着「**八类来源节点恒显示**」——
 * 即用例文本站在 8 值那一侧，已签核的契约站在 7 值那一侧。
 *
 * ⚠ **这是待人类裁决的分歧，本文件不选一套。**
 *   选 7 值 ⇒ 工作坊与画布物化产出无处归类；选 8 值 ⇒ 修订**已签核**的 `artifact` 束。
 *   任何一边都不是实现者能定的。
 * ⚠ 因此下方凡涉及来源类型的字段一律用 `z.string()` + 本常量的引用，
 *   **这个宽松是一个待裁标记，不是设计**。裁决后收敛为单一枚举 + 机械门控。
 *   见 `KNOWN_CONTRACT_GAPS.FS1`。
 */
export const SOURCE_TYPE_VOCABULARY_DISPUTED = {
  contractSide: ["survey", "conversation", "interview", "prototype-run", "research-run", "upload", "ai-generated"],
  uiSide: ["file", "survey", "interview", "workshop", "research", "conversation", "canvas", "generated"],
  why: "usecases.md A5·22-1 says 八类恒显示 while the SIGNED artifact.ArtifactSource has 7 with different spellings; ruling required",
} as const;

/** 浏览视图。⚠ 两种视图**共用同一份数据**，`getArtifactTree` 只是它的结构投影 */
export const FileBrowseView = z.enum(["tree", "list"]);

/** 导出任务四态。⚠ 失败**不产生半截 zip**；临时对象被清理 */
export const ExportJobStatus = z.enum(["queued", "running", "done", "failed"]);

/** 预览渲染类型。⚠ `unsupported` **必须**显示「此类型不支持预览，请下载查看」+ 下载按钮 */
export const PreviewKind = z.enum(["pdf", "image", "audio", "text", "jsonl", "unsupported"]);

/**
 * 渲染模式。⚠ **未知类型一律 `isolated-attachment`**：
 * `Content-Disposition: attachment` + **隔离域名**，不在主域内联渲染
 * （防 XSS / SVG 脚本注入 / HTML 直接渲染）。
 */
export const PreviewRenderMode = z.enum(["inline", "isolated-attachment"]);

/** 版本的来源。⚠ 三种都产生**新版本**，没有一种是「原地改」 */
export const VersionChangeSource = z.enum(["upload", "materialize", "rerun"]);

/**
 * **六类级联**（架构首批门槛第 4 条）。**缺一即验收不通过。**
 *
 * ⚠ 断言方式是**六项逐一**，不是「级联跑完了」——一个只做前两项的实现
 *   在「跑完了」这种断言下全绿。
 */
export const CascadeKind = z.enum([
  /** ① 浏览器条目消失 */
  "browser-entry",
  /** ② 派生文件进队列 */
  "derived-files",
  /** ③ embedding 退出 pgvector */
  "pgvector",
  /** ④ FTS / Segment 退出召回 */
  "fts-segments",
  /** ⑤ `ontology_edges` 相关边失效（跨 09-kg，phase-02） */
  "ontology-edges",
  /** ⑥ 缓存与已构建 Context Pack 失效 */
  "context-pack-cache",
]);

/** 单类级联的结果。⚠ `pending` 与 `failed` **必须可区分**：一个还在跑，一个不会好了 */
export const CascadeResult = z.enum(["ok", "failed", "pending"]);

/** 物化触发源。⚠ **物化是同步契约，不是事后导出**——没有一种触发是「用户点导出」 */
export const MaterializeTrigger = z.enum(["created", "changed", "closed", "manual-rerun"]);

/** 物化产出的粒度（`getMaterializationSpec`） */
export const MaterializationGranularity = z.enum(["per-version", "per-session", "per-run"]);

/**
 * F39 人工复核处置（`resolveReviewPending`）。⚠ 与 `skills.ts` 的 `ReviewDecision`
 * （approve/reject，技能审核场景）**不是同一枚举**——值域不同（accept 而非 approve），
 * 场景也不同，不得合并成一个名字。
 */
export const ReviewResolutionDecision = z.enum(["accept", "reject"]);

/**
 * **禁止存在的路由**（本束）。交付物是**断言它不存在的测试**，不是接口。
 *
 * ⚠ `deleteVersion`（删除单个中间版本）**能否存在本身 [待定 T-4]**，
 *   所以它**不在**这张表里——把未裁的事写成禁令，与把它写成接口一样是替人裁决。
 *   界面已取了保守默认（版本列表只给「下载」不给「删除此版本」），
 *   但**那是原型 agent 的保守解，不是裁决**（`KNOWN_CONTRACT_GAPS.FS5`）。
 */
export const FILES_FORBIDDEN_ROUTES = [
  {
    route: "DELETE /artifacts/:artifactId/versions/:versionId",
    why: "artifact I-11：固定快照不可删不可改。已由 tests/no-forbidden-routes.test.ts 的两条正则守住（DELETE 与 PUT/PATCH 各一条）。⚠ T-4 若裁「可删中间版本」，动的是已签核的 artifact 束，不是在这里加一条路由。",
  },
] as const;

/**
 * **出站端口，本束调用、他模块实现**（`usecases.md` E 组 / F47 契约先行桩）。
 *
 * 🔴 **任一模块不提供失效接口，AC2 就无法达成**——这是本模块最大的外部风险
 *   （uc-22-4 R10 逐字）。
 * ⚠ 第 ② 个端口与 phase-00 `artifact.markEvidenceWithdrawn` **形状高度相似**，
 *   须一致性复核确认**是不是同一个**。是同一个却各写一份，就是第 N 次同一事实两处。
 *   见 `KNOWN_CONTRACT_GAPS.FS11` / coverage C-3。
 *
 * ## 为什么它们**不在** `operations` 里
 * `operations` 是**本束提供的 HTTP 面**；这两个是**本束调用**的东西，实现体在 phase-02。
 * 把它们写进 `operations` 会在 phase-01 凭空长出两条本仓不实现的路由，
 * 且 `contract-shape.test.ts` 的「每个操作都有 method/path」会逼人替 09-kg 编一个路由。
 * ⇒ 与 `UNTRUSTED_DOCUMENT_PORT` 同一处理：**是端口不是操作**。
 * `method` / `path` **刻意缺席**——它由提供方（09-kg / 10-report）在 phase-02 定，
 * 本束只定 `in` / `out` / `err` 三件的**形状**。
 *
 * ## `versionIds` 的 `.min(1)` 是刻意的
 * 空集调用会让「一条边都没失效」与「什么都没做」在响应上不可分辨——
 * 而这正是六类级联最危险的失败形状（一个只做前两项的实现在「跑完了」这种断言下全绿）。
 * ⇒ 契约上就不存在「拿空集去级联」这条路径。
 * ⚠ 但 `out` 仍分不清「本来就没有相关边」与「目标模块没干活」，
 *   见 `KNOWN_CONTRACT_GAPS.FS13`——**本文件不发明第三个字段来补它**。
 */
export const OUTBOUND_PORTS = {
  /**
   * ⑤ 图边失效（09-kg 提供）。`usecases.md` E 组第一条逐字。
   * ⚠ 对应 `CascadeKind.ontology-edges`——这个端口失败 ⟺ 该类级联 `failed`。
   */
  invalidateOntologyEdges: {
    providedBy: "09-kg (phase-02)",
    /** ⚠ 空集不得成为一次「成功」——见上方长注 */
    in: z.object({ artifactId: z.string().min(1), versionIds: z.array(z.string().min(1)).min(1) }).strict(),
    out: z.object({ invalidatedEdgeIds: z.array(z.string()) }).strict(),
    err: ["CASCADE_TARGET_UNAVAILABLE"] as const,
    /** 该端口在六类级联中的落点 */
    cascadeKind: "ontology-edges",
  },
  /**
   * 报告段落标「证据已撤回」（10-report / 13-deliv 提供）。D-19。
   * ⚠ **它不是六类之一**：六类级联外加的一条（`requestDeletion` 长注逐字「外加」），
   *   故 `cascadeKind: null`。把它算成第七类会让 `CascadeKind` 的封闭六值失真。
   * ⚠ **对内可见、对外不自动改写**：本端口只负责标注与通知，
   *   **不改已签字结论**——替换须人工确认（与 `artifact.markEvidenceWithdrawn` 同义）。
   */
  annotateWithdrawnEvidence: {
    providedBy: "10-report / 13-deliv (phase-02)",
    /** `reason` 的最短长度 UC **没写**；此处取 `requestDeletion.reason` 的 min(4) 以外的保守值 min(1)，差异登记在 `FS13` */
    in: z.object({ versionIds: z.array(z.string().min(1)).min(1), reason: z.string().min(1) }).strict(),
    out: z
      .object({ annotatedSectionIds: z.array(z.string()), notifiedApprovers: z.array(z.string()) })
      .strict(),
    err: ["CASCADE_TARGET_UNAVAILABLE"] as const,
    /** ⚠ null 是结论不是遗漏：报告段落标注**不在** `CascadeKind` 六值内 */
    cascadeKind: null,
  },
} as const;

/** 出站端口名。⚠ 由 `OUTBOUND_PORTS` 派生，**不另列一份名字清单** */
export type OutboundPortName = keyof typeof OUTBOUND_PORTS;

/**
 * 🔴 **`wrapDocumentAsData` 是端口不是 HTTP 操作**（架构第三节）。
 *
 * **文档内容与文件名都是不可信数据，不得被 agent 当作系统指令**：
 *   ① 必须包裹为数据，**不得直接拼进 system prompt**
 *   ② **文件名同样是攻击面**
 *   ③「忽略以上指令」「你现在是…」等模式不改变 agent 行为
 *   ④ agent 依据文档内容发起的高影响操作走 R2/R3 风险分级的人工确认（D-27/D-28）
 *
 * ⚠ **红队样本通过率必须 100%** —— 这是一组红队用例，不是普通单测。
 * ⚠ 它不在 `operations` 里，因为**它没有 HTTP 面**：暴露成端点等于给攻击者一个探针。
 */
export const UNTRUSTED_DOCUMENT_PORT = "wrapDocumentAsData" as const;

/* ─────────────────────────── 实体 ─────────────────────────── */

/**
 * 浏览器里的一个节点。
 * ⚠ `sourceType` 是**字符串不是枚举**——见 `SOURCE_TYPE_VOCABULARY_DISPUTED`。
 */
export const FileNode = z
  .object({
    artifactId: z.string(),
    name: z.string(),
    /** ⚠ 待裁词表（`SOURCE_TYPE_VOCABULARY_DISPUTED`），**不是**已定的枚举 */
    sourceType: z.string(),
    /** null = 「未归入环节」。⚠ 该节点**必须存在且不可隐藏**——否则通用上传的文件会从树上消失 */
    agendaSegmentId: z.string().nullable(),
    sizeBytes: z.number().int().nonnegative(),
    confidential: z.boolean(),
    /** ⚠ 摄取九态：**线上真值**，与前端视图态不合并（见 `FS2`） */
    ingestionStatus: IngestionStatus,
    /** `STORED` 之后即 true。⚠ 与 `retrievable` 是**两个独立布尔**（N-7） */
    originalDownloadable: z.boolean(),
    /** `READY` 之前恒 false */
    retrievable: z.boolean(),
    updatedAt: z.string(),
  })
  .strict();

/** 树节点。一级 = 来源类型，二级 = `agenda_segment`（含「未归入环节」） */
export const TreeNode = z
  .object({
    /** ⚠ 待裁词表；`level: 2` 时是 segment id 或 `null` 的哨兵值 */
    key: z.string(),
    label: z.string(),
    level: z.union([z.literal(1), z.literal(2)]),
    count: z.number().int().nonnegative(),
  })
  .strict();

/** 命中的锚点。⚠ 复用 `artifact.AnchorKind`，不抄一份 */
export const SearchAnchor = z.object({ kind: AnchorKind, value: z.string() }).strict();

/** 已导出到组织外的记录。⚠ 回执必须**如实说明该边界**并列出它（N-19 / V9·22-4） */
export const ExportRecord = z
  .object({ jobId: z.string(), exportedAt: z.string(), exportedBy: z.string(), itemCount: z.number().int().nonnegative() })
  .strict();

/** 引用。用于删除影响面：谁在引用这份材料 */
export const Ref = z.object({ kind: z.string(), id: z.string(), label: z.string() }).strict();

/**
 * O-01 留存五参数（**单点配置，项目级可覆盖**）。
 *
 * ⚠ **不得硬编码**：05-rec / 06-itv / 04-agent / 17-gov / 21-mcp
 *   共同消费**同一份**配置（N-20）。任何一个模块自己写一个天数，就是第 N 次同一事实两处。
 * ⚠ 五参数的**名称**取自 O-01；`auth.AUTH_POLICY.orgRetentionDays: 180` 是
 *   `materialDays` 的**默认值**在 phase-00 的落点——两者的关系见 `FS7`。
 */
export const RetentionParams = z
  .object({
    materialDays: z.number().int().positive(),
    derivedDays: z.number().int().positive(),
    logDays: z.number().int().positive(),
    trashGraceDays: z.number().int().positive(),
    backupDays: z.number().int().positive(),
  })
  .strict();

/* ─────────────────────────── 操作 ─────────────────────────── */

export const operations = {
  /* ══ A 组 · 浏览与交付（uc-22-1）═══════════════════════════ */

  /**
   * `listProjectArtifacts` —— **列表/树的唯一读入口**
   *
   * 🔴 **权限过滤在 SQL/RLS 层完成**，不在应用层；
   *   应用连接**不得使用表 owner 身份**——PG 表 owner 默认不受 RLS 限制，
   *   用 owner 连接等于 RLS 形同虚设，而所有 RLS 测试仍会全绿。
   * ⚠ 无权见到的**不出现、不占位、不显示「已隐藏 N 项」**——计数本身即信息泄露。
   * ⚠ 但**来源类型节点恒显示**（空的标为空）。两条不冲突：
   *   前者是权限过滤后不留占位，后者是枚举恒显示。
   * ⚠ 空态返回全部来源节点 `count:0`，**不生成任何示例数据**（V5·22-1）。
   * ⚠ 对象存储不可用时**仍 200 返回元数据**（元数据来自 PG），仅下载/预览降级（V7·22-1）。
   * ⚠ **筛选条件必须可组合、可从 URL 还原**——「把一个视图发给同事」是它的验收形式。
   */
  listProjectArtifacts: {
    method: "GET",
    path: "/projects/:projectId/artifacts",
    in: z
      .object({
        projectId: z.string(),
        view: FileBrowseView,
        filters: z
          .object({
            /** ⚠ 待裁词表 */
            sourceType: z.array(z.string()),
            agendaSegmentId: z.array(z.string()),
            timeRange: z.object({ from: z.string(), to: z.string() }).strict().nullable(),
            uploader: z.object({ type: z.enum(["user", "agent"]), id: z.string() }).strict().nullable(),
            confidential: z.boolean().nullable(),
            ingestionState: z.array(IngestionStatus),
          })
          .strict()
          .nullable(),
        cursor: z.string().nullable(),
        pageSize: z.number().int().positive().nullable(),
      })
      .strict(),
    out: z
      .object({
        nodes: z.array(FileNode),
        /**
         * 每个来源类型的计数。⚠ 键的词表**未定**（`SOURCE_TYPE_VOCABULARY_DISPUTED`），
         * 故写成数组而不是 `Record<SourceType, number>`——
         * 写成 Record 就必须先选一套键，而那正是待裁的事。
         */
        sourceCounts: z.array(z.object({ sourceType: z.string(), count: z.number().int().nonnegative() }).strict()),
        cursor: z.string().nullable(),
        /** false = 对象存储不可用，仅下载/预览降级。⚠ 列表**仍是 200**，不是空列表 */
        downloadAvailable: z.boolean(),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * `getArtifactTree` —— zip 导出 round-trip 的**比对基准**
   *
   * ⚠ **「未归入环节」节点必须存在且不可隐藏**——否则通用上传的文件会从树上消失，
   *   而「文件不见了」在界面上与「本来就没上传成功」不可分辨。
   * ⚠ zip 内部目录结构 **≡ 本操作的结构**（`createExportJob`），
   *   两处各写一份就会漂移，且只有客户解压时才发现。
   */
  getArtifactTree: {
    method: "GET",
    path: "/projects/:projectId/artifact-tree",
    in: z.object({ projectId: z.string() }).strict(),
    out: z.object({ tree: z.array(TreeNode) }).strict(),
    err: ["NO_PROJECT_ROLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * `searchArtifacts` —— FTS 一等检索通道
   *
   * ⚠ **含机密标记文件的命中片段是否展示 [待定 T-6]**：
   *   展示则片段脱离「整份走本地模型」的路由约束；不展示则搜索对机密材料等于失效。
   *   ⇒ 契约暂按 **fail-closed（不展示片段，只出文件名）**，`snippet` 可空。
   * ⚠ **界面已先表了一半态**：搜索框已建成，但**没有第八种状态可切**来表达这件事。
   *   ⇒ 这条不定，搜索对机密材料**要么失效、要么泄露，而且两种情况在界面上都不可见地存在**。
   *   `snippet` 何时可空，**签核前不要当成已定**（`FS4`）。
   */
  searchArtifacts: {
    method: "GET",
    path: "/projects/:projectId/artifacts/search",
    in: z.object({ projectId: z.string(), q: z.string().min(1) }).strict(),
    out: z
      .object({
        hits: z.array(
          z
            .object({ node: FileNode, snippet: z.string().nullable(), anchor: SearchAnchor.nullable() })
            .strict(),
        ),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * `previewArtifactVersion`
   *
   * ⚠ `unsupported` **必须**显示「此类型不支持预览，请下载查看」+ 下载按钮，
   *   **不得显示空白或转圈**——转圈是一种谎称「马上就好」的失败态。
   * ⚠ 未知类型一律 `isolated-attachment`（隔离域名），不在主域内联渲染。
   * ⚠ 派生物未就绪时标「生成中」，并**如实说明检索侧尚未可召回**（E5·22-1）。
   */
  previewArtifactVersion: {
    method: "GET",
    path: "/artifact-versions/:versionId/preview",
    in: z.object({ versionId: z.string() }).strict(),
    out: z
      .object({
        kind: PreviewKind,
        renderMode: PreviewRenderMode,
        meta: z.object({ mime: z.string(), sizeBytes: z.number().int().nonnegative() }).strict(),
        anchorSupport: z.boolean(),
        /** true = 派生物生成中；界面标「生成中」并说明检索侧尚未可召回 */
        derivedGenerating: z.boolean(),
      })
      .strict(),
    err: ["ARTIFACT_NOT_FOUND", "INTEGRITY_CHECK_FAILED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * `issueDownloadUrl`
   *
   * 🔴 **短时效 + 绑定 principal + 一次性**，**不得签发可转发的长期公开链接**（N-24）。
   *   ⇒ `oneTime` 是 `z.literal(true)`：契约上就不存在「可重复使用的链接」这种取值。
   * ⚠ 下载动作写 `provenance_events`——它是 N-19「回执须如实说明已出域内容」的数据来源。
   * ⚠ **观察者是否有下载权 [待定 T-6]**，`pre` 的完整形式取决于该裁决。
   *   界面**已先表了一半态**：拒绝态截图画的是「观察者不进结果集」，
   *   但下载按钮的结构被保留、门只留了一处待接。**看起来像已经定了，其实没有**（`FS3`）。
   */
  issueDownloadUrl: {
    method: "POST",
    path: "/artifact-versions/:versionId/download-url",
    in: z.object({ versionId: z.string(), purpose: z.enum(["download", "export"]) }).strict(),
    out: z
      .object({
        url: z.string(),
        expiresAt: z.string(),
        /** 回指 `identity.authorize` 的判定，使「为什么给你下」可回溯 */
        permissionDecisionId: z.string(),
        /** ⚠ **恒 true**——不存在可转发的长期链接这种取值 */
        oneTime: z.literal(true),
      })
      .strict(),
    err: [
      "ARTIFACT_NOT_FOUND",
      "INTEGRITY_CHECK_FAILED",
      "DEPENDENCY_UNAVAILABLE",
      "DOWNLOAD_URL_EXPIRED",
      "DOWNLOAD_URL_CONSUMED",
    ] as const,
  },

  /**
   * `createExportJob` —— 批量导出为 zip
   *
   * ⚠ zip 内部目录结构 **≡ `getArtifactTree`**；根目录附 `manifest.json`
   *   （每条含 `artifact_id` / `version` / `sha256` / 来源类型 / 生成时间 / 机密标记）。
   * ⚠ **导出本身写审计**——它是删除回执里「已出域内容」那一段的数据来源。
   * ⚠ **超阈值拒绝，不静默截断**（E2·22-1）：静默截断会让客户拿到一份看起来完整的交付物。
   */
  createExportJob: {
    method: "POST",
    path: "/projects/:projectId/export-jobs",
    in: z
      .object({
        projectId: z.string(),
        /** 二选一：显式集合 或 树节点。⚠ 两者**不得同时非空** */
        artifactIds: z.array(z.string()).nullable(),
        treeNodeId: z.string().nullable(),
      })
      .strict(),
    out: z.object({ jobId: z.string(), status: ExportJobStatus }).strict(),
    err: ["NO_PROJECT_ROLE", "EXPORT_LIMIT_EXCEEDED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** `getExportJob`。⚠ 失败**不产生半截 zip**，`downloadUrl` 恒为 null */
  getExportJob: {
    method: "GET",
    path: "/export-jobs/:jobId",
    in: z.object({ jobId: z.string() }).strict(),
    out: z
      .object({
        jobId: z.string(),
        status: ExportJobStatus,
        downloadUrl: z.string().nullable(),
        expiresAt: z.string().nullable(),
        /** 失败原因；`status !== "failed"` 时为 null */
        failureReason: z.string().nullable(),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "EXPORT_LIMIT_EXCEEDED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * `renameArtifact` —— **目录与文件名是契约**
   *
   * 🔴 **禁止随手重构**：改名/改目录层级必须走迁移——保留旧路径的**重定向或别名**
   *   并记入变更日志（N-23 / V11·22-1）。
   *   理由：客户已下载的 zip、已发出的引用链接、已归档的交付物都依赖它。
   *   ⇒ `out` 里 `aliasFrom` / `aliasTo` / `changeLogId` **三件齐全**，
   *     少任何一件这条纪律就变回一句口号。
   */
  renameArtifact: {
    method: "POST",
    path: "/artifacts/:artifactId/rename",
    in: z.object({ artifactId: z.string(), newName: z.string().min(1), reason: z.string().min(1) }).strict(),
    out: z.object({ aliasFrom: z.string(), aliasTo: z.string(), changeLogId: z.string() }).strict(),
    err: ["ARTIFACT_NOT_FOUND", "PROJECT_ROLE_INSUFFICIENT"] as const,
  },

  /** `resolveArtifactAlias` —— 旧路径的重定向解析。**没有它，改名纪律就只是一条注释** */
  resolveArtifactAlias: {
    method: "GET",
    path: "/artifact-aliases/resolve",
    in: z.object({ projectId: z.string(), path: z.string() }).strict(),
    out: z.object({ artifactId: z.string(), currentPath: z.string() }).strict(),
    err: ["ARTIFACT_NOT_FOUND", "NO_PROJECT_ROLE"] as const,
  },

  /* ══ B 组 · 上传与摄取（uc-22-2）════════════════════════════ */

  /**
   * `uploadArtifact` —— 上传材料（两个入口）
   *
   * 🔴 **前端预检只是体验优化，服务端必须完整重做全部校验。** 观察者调此接口 403。
   * ⚠ **入口一**（材料准备某行）自动绑该行 `agendaSegmentId`；**入口二**（文件页/拖拽）为 `null`。
   *   `agendaSegmentId` 归属该项目由**服务端校验，不信任客户端**。
   * ⚠ 机密勾选**默认继承项目级默认值**，界面须显示继承来的值而非空白复选框（O-17）。
   * ⚠ **幂等命中不得静默**：既不静默去重、也不静默重复入库，必须给二选一，
   *   **默认「使用已有」**（A3·22-2）。⇒ `onDuplicate` 可空但 `duplicateHit` 必须回传。
   * ⚠ 先写 PG 元数据 + **transactional outbox**，再由 worker 消费——
   *   不允许「边传边处理、失败就丢」的同步实现。
   * ⚠ 对象存储写入失败 ⇒ 事务不提交，**不产生幽灵版本**；
   *   反向 PG 提交失败 ⇒ 临时对象被清理（V11·22-2）。
   */
  uploadArtifact: {
    method: "POST",
    path: "/projects/:projectId/artifacts/upload",
    in: z
      .object({
        projectId: z.string(),
        agendaSegmentId: z.string().nullable(),
        files: z.array(
          z.object({ filename: z.string().min(1), sizeBytes: z.number().int().nonnegative(), sha256: z.string() }).strict(),
        ),
        confidential: z.boolean(),
        /** ⚠ 复用组织层可见性词表；**不为文件另造一套** */
        visibilityScope: z.enum(["org-wide", "team-only"]),
        /** null = 未选择；服务端**必须**返回 `duplicateHit` 让用户二选一，**不得替他选** */
        onDuplicate: z.enum(["use-existing", "as-new-version"]).nullable(),
      })
      .strict(),
    out: z
      .object({
        runs: z.array(
          z
            .object({
              ingestionRunId: z.string(),
              artifactId: z.string().nullable(),
              /** null = 无重复。非 null 时**必须**给用户二选一，默认「使用已有」 */
              duplicateHit: z
                .object({ artifactId: z.string(), versionNumber: z.number().int().positive(), sha256: z.string() })
                .strict()
                .nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
    err: [
      "NO_PROJECT_ROLE",
      "PROJECT_ROLE_INSUFFICIENT",
      "FILE_TYPE_REJECTED",
      "FILE_TOO_LARGE",
      "BATCH_LIMIT_EXCEEDED",
      "ARCHIVE_BOMB_DETECTED",
      "MALWARE_DETECTED",
      "MIME_MISMATCH",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * `getIngestionRun`
   *
   * 🔴 `originalDownloadable` 与 `retrievable` 是**两个独立布尔**（N-7）：
   *   `STORED` 之后原件即可下载，`READY` 之前不进检索召回。**合成一个布尔就说不清了。**
   * ⚠ 字段名是 `status` 不是 `state` —— 见 `KNOWN_CONTRACT_GAPS.FS2`：
   *   线上状态机（`artifact.IngestionStatus`）与前端视图态是**同名不同义**的两件事，
   *   本仓已为「同名不同义」立过纪律，**两者不合并**。
   */
  getIngestionRun: {
    method: "GET",
    path: "/ingestion-runs/:ingestionRunId",
    in: z.object({ ingestionRunId: z.string() }).strict(),
    out: z
      .object({
        ingestionRunId: z.string(),
        /** ⚠ **线上真值**。前端视图态在 `getIngestionUiState`，不在这里 */
        status: IngestionStatus,
        history: z.array(IngestionStatus),
        originalDownloadable: z.boolean(),
        retrievable: z.boolean(),
      })
      .strict(),
    err: ["ARTIFACT_NOT_FOUND", "INGESTION_FAILED"] as const,
  },

  /**
   * `getIngestionUiState` —— 九态的**界面出口**
   *
   * 🔴 **没有出口的中间态等于黑洞**（uc-22.2 R7）：`exits` **不得为空数组**。
   *   一个只有文案没有出口的状态，用户唯一能做的事是等，而他不知道要等多久。
   * ⚠ `label` 非空——**失败态不显示裸错误码**。
   */
  getIngestionUiState: {
    method: "GET",
    path: "/ingestion-runs/:ingestionRunId/ui-state",
    in: z.object({ ingestionRunId: z.string() }).strict(),
    out: z
      .object({
        /** ⚠ 前端视图态。**刻意与 `status` 分开**（FS2） */
        state: IngestionStatus,
        label: z.string().min(1),
        /** ⚠ **不得为空数组**：没有出口的中间态等于黑洞 */
        exits: z.array(z.object({ key: z.string(), label: z.string() }).strict()),
        originalDownloadable: z.boolean(),
        retrievable: z.boolean(),
      })
      .strict(),
    err: ["ARTIFACT_NOT_FOUND", "INGESTION_FAILED"] as const,
  },

  /**
   * `retryIngestionStep`
   *
   * ⚠ **重试必须幂等**：不得产生多份重复转录（N-6 / V12·22-2）。
   * ⚠ **重跑摄取只生成新派生版本，不修改旧结果**（旧行 `updated_at` 不变）——
   *   「旧行时间戳未变」正是这条的验收形式。
   */
  retryIngestionStep: {
    method: "POST",
    path: "/ingestion-runs/:ingestionRunId/retry",
    in: z.object({ ingestionRunId: z.string(), step: IngestionStatus.nullable() }).strict(),
    out: z.object({ ingestionRunId: z.string(), status: IngestionStatus }).strict(),
    err: ["ARTIFACT_NOT_FOUND", "INGESTION_FAILED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** `replayIngestionRun` —— worker 崩溃后重放。⚠ **重放不产生重复 Segment** */
  replayIngestionRun: {
    method: "POST",
    path: "/ingestion-runs/:ingestionRunId/replay",
    in: z.object({ ingestionRunId: z.string() }).strict(),
    out: z.object({ ingestionRunId: z.string(), status: IngestionStatus }).strict(),
    err: ["ARTIFACT_NOT_FOUND", "INGESTION_FAILED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * `resolveReviewPending` —— 人工复核
   *
   * 🔴 **触发判据（结构性，本束已定）**：机密标记 ∨ PII 五类
   *   （邮箱/手机号/身份证号/银行卡号/详细住址，O-39）∨ 解析质量低于阈值
   *   ⇒ **必入 `REVIEW_PENDING`，不得静默入库**。**阈值数值 [待定 T-9]**。
   *   这正是 phase-00 `artifact` 束 coverage 缺口 ⑦ 说的「先做结构性断言，阈值后填」的落地。
   * ⚠ **审核人具体是谁 [待定 T-9]** ⇒ `pre` 不完整（`FS6`）。
   */
  resolveReviewPending: {
    method: "POST",
    path: "/artifacts/:artifactId/review-pending/resolve",
    in: z
      .object({ artifactId: z.string(), decision: ReviewResolutionDecision, note: z.string() })
      .strict(),
    out: z
      .object({ state: z.enum(["READY", "rejected"]), provenanceEventId: z.string() })
      .strict(),
    err: ["ARTIFACT_NOT_FOUND", "PROJECT_ROLE_INSUFFICIENT", "REVIEW_REQUIRED", "PROVENANCE_MISSING"] as const,
  },

  /**
   * `requestAiFillMissingMaterial` —— 让 AI 补齐缺料
   *
   * 🔴 产物**强制**标记为 AI 生成 + `synthesized` + `provenance.json`，
   *   **默认落 `REVIEW_PENDING`，人接受前不召回**（D-27 同源）。
   *   ⇒ `out.state` 是 `z.literal("REVIEW_PENDING")`：契约上就不存在「直接就绪」这条路径。
   * 🔴 agent **不得**绕过扫描与限制，**不得**自行把机密标记勾为否。
   */
  requestAiFillMissingMaterial: {
    method: "POST",
    path: "/projects/:projectId/artifacts/ai-fill",
    in: z.object({ projectId: z.string(), agendaSegmentId: z.string(), requirement: z.string().min(1) }).strict(),
    out: z
      .object({
        artifactId: z.string(),
        ingestionRunId: z.string(),
        /** ⚠ **恒为 REVIEW_PENDING**——AI 产物不存在「直接就绪」这条路径 */
        state: z.literal("REVIEW_PENDING"),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "PROVENANCE_MISSING", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /* ══ C 组 · 物化（uc-22-3）═════════════════════════════════ */

  /**
   * `materializeSource` —— **系统事件驱动，不是用户点导出**
   *
   * 🔴 **物化是同步契约，不是事后导出**：业务对象产生即生成/更新对应文件版本，
   *   **不需要用户点任何「导出」按钮**。时限 **[待定 T-3]**——
   *   ⚠ **界面上是空缺，不是占位**：上传弹层与摄取抽屉里没有把「多久算物化完成」显示出来，
   *     因为没有权威数值。**别把「界面上没这个字段」误读成「不需要这个字段」**。
   * ⚠ **原件同步 ≠ 派生物同步**：「同步契约」约束的是**原件可见性**（`STORED` 即可见可下载），
   *   **派生物允许异步**并标 `generating`。两者不冲突，但契约必须分开说。
   * ⚠ 产出**送入 UC-22.2 的同一条持久队列**，**不另建入库路径**；优先级**低于**用户主动上传。
   * ⚠ 三分支：`content_hash` 相同 ⇒ **不新增版本**，只更新最后核对时间（V10·22-3）。
   * ⚠ 可见性**继承业务对象并与全部引用来源取最严结果**；无法判定时 **fail-closed**（N-14）。
   * 🔴 **物化失败不阻断业务，但必须产生可见的失败记录** —— 见 `listMaterializationFailures`。
   * ⚠ 部分成功：某个网页快照抓取失败 ⇒ `citations.json` 仍产出并标 `snapshot_failed`，
   *   **不因为一个来源抓不到就整场不物化**（A5·22-3）。
   */
  materializeSource: {
    method: "POST",
    path: "/materializations",
    in: z
      .object({
        /** ⚠ 待裁词表（`SOURCE_TYPE_VOCABULARY_DISPUTED`） */
        sourceType: z.string(),
        sourceRef: z.string(),
        projectId: z.string(),
        agendaSegmentId: z.string().nullable(),
        trigger: MaterializeTrigger,
      })
      .strict(),
    out: z
      .object({
        artifactIds: z.array(z.string()),
        fileNames: z.array(z.string()),
        /** false ⟺ `content_hash` 未变（V10·22-3：**不新增版本**，只更新核对时间） */
        versionBumped: z.boolean(),
        /** 部分成功标记，例如网页快照抓取失败。⚠ 空数组 = 全部成功 */
        partialFailures: z.array(z.object({ sourceRef: z.string(), reason: z.string() }).strict()),
      })
      .strict(),
    err: [
      "MATERIALIZATION_FAILED",
      "MATERIALIZATION_SPEC_VIOLATION",
      "PROVENANCE_MISSING",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * `getMaterializationSpec` —— 契约自查
   *
   * 🔴 **固定文件名是契约，实现不得少产出任何一个**（N-10）；少了就是
   *   `MATERIALIZATION_SPEC_VIOLATION` 而不是 `MATERIALIZATION_FAILED`。
   * ⚠ 产物格式必须是**开放可归档**的（JSONL / JSON / CSV / 音频 / 图片），
   *   **不得**用私有二进制或需本产品才能打开的格式——
   *   「对象存储里那棵树本身就是一份可离线打开的交付物」。
   * ⚠ `err: []` 是**刻意的**：它是一次纯查表，没有失败面。
   */
  getMaterializationSpec: {
    method: "GET",
    path: "/materialization-specs/:sourceType",
    in: z.object({ sourceType: z.string() }).strict(),
    out: z
      .object({ requiredFileNames: z.array(z.string()), granularity: MaterializationGranularity })
      .strict(),
    err: [] as const,
  },

  /**
   * `listMaterializationFailures`
   *
   * 🔴 **不存在「业务对象存在但浏览器里什么都没有」的静默态**（V9·22-3）。
   *   失败记录要出现在**文件浏览器对应位置**，带原因与重试。
   *   ⇒ 这个操作存在本身就是那条纪律的交付物：没有它，静默失败无从被发现。
   */
  listMaterializationFailures: {
    method: "GET",
    path: "/projects/:projectId/materialization-failures",
    in: z.object({ projectId: z.string(), sourceType: z.string().nullable() }).strict(),
    out: z
      .object({
        failures: z.array(
          z
            .object({
              sourceRef: z.string(),
              sourceType: z.string(),
              reason: z.string(),
              occurredAt: z.string(),
              /** ⚠ 恒 true：不可重试的物化失败等于一条没有出口的记录 */
              retryable: z.literal(true),
            })
            .strict(),
        ),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE"] as const,
  },

  /* ══ D 组 · 版本、派生物、删除传播（uc-22-4）═══════════════ */

  /**
   * `listVersions`
   *
   * 🔴 **旧版仍可下载**——这是证据平面不可变性的**用户可见形式**；
   *   旧版本对象在新版本上传后**字节未变**（`ETag`/`LastModified` 不变，V1·22-4）。
   *   ⇒ `downloadable` 是 `z.literal(true)`：契约上不存在「旧版不可下载」这种取值。
   */
  listVersions: {
    method: "GET",
    path: "/artifacts/:artifactId/file-versions",
    in: z.object({ artifactId: z.string() }).strict(),
    out: z
      .object({
        versions: z.array(
          z
            .object({
              versionNumber: z.number().int().positive(),
              createdAt: z.string(),
              creator: z
                .object({ type: z.enum(["user", "agent"]), id: z.string(), agentRunId: z.string().nullable() })
                .strict(),
              sizeBytes: z.number().int().nonnegative(),
              sha256: z.string(),
              changeSource: VersionChangeSource,
              /** ⚠ **恒 true**（V1·22-4） */
              downloadable: z.literal(true),
            })
            .strict(),
        ),
      })
      .strict(),
    err: ["ARTIFACT_NOT_FOUND", "NO_PROJECT_ROLE"] as const,
  },

  /**
   * `uploadNewVersion`
   *
   * ⚠ **版本回滚 = 把旧版内容作为新版本再上传**（新建 v4 内容等同 v2），
   *   **不是**把 v2 重新置为当前版（A1·22-4，与 O-18 同构）。
   *   ⇒ 契约里**没有** `setCurrentVersion` 这种操作，这是结论不是遗漏。
   * ⚠ 上传新版本时旧版本正在被下载 ⇒ 下载正常完成（**永不覆盖**，E7·22-4）。
   * ⚠ 路由是 `/file-versions` 不是 `/versions`：
   *   `POST /artifacts/:artifactId/versions` **已被 phase-00 `artifact.pinVersion` 占用**，
   *   两个束路由冲突会被 `contract-shape.test.ts` 的跨束唯一性断言当场抓住。
   */
  uploadNewVersion: {
    method: "POST",
    path: "/artifacts/:artifactId/file-versions",
    in: z
      .object({
        artifactId: z.string(),
        filename: z.string().min(1),
        sizeBytes: z.number().int().nonnegative(),
        sha256: z.string(),
        /** 乐观并发。⚠ 不带它就是「最后写入者赢」，而版本线上那意味着悄悄覆盖 */
        expectedHeadVersion: z.number().int().positive(),
      })
      .strict(),
    out: z
      .object({
        versionId: z.string(),
        versionNumber: z.number().int().positive(),
        duplicateHit: z.boolean(),
      })
      .strict(),
    err: [
      "VERSION_CHANGED",
      "FILE_TYPE_REJECTED",
      "FILE_TOO_LARGE",
      "MALWARE_DETECTED",
      "MIME_MISMATCH",
      "SNAPSHOT_IMMUTABLE",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * `listDerived`
   *
   * ⚠ `derivedFrom` 指向**具体 `artifactVersionId`**，不是 `artifactId`（N-15）——
   *   指到 artifact 上就说不清这份 OCR 是从哪一版出来的。
   * ⚠ 除 embedding 外**都必须物化为独立可下载文件**。
   */
  listDerived: {
    method: "GET",
    path: "/artifacts/:artifactId/derived",
    in: z.object({ artifactId: z.string() }).strict(),
    out: z
      .object({
        derived: z.array(
          z
            .object({
              id: z.string(),
              kind: DerivedKind,
              /** ⚠ **版本级**，不是 artifact 级（N-15） */
              derivedFrom: z.string(),
              generatorModel: z.string(),
              generatorVersion: z.string(),
              pipelineVersion: z.string(),
              /** ⚠ 除 embedding 外恒 true */
              materialized: z.boolean(),
            })
            .strict(),
        ),
      })
      .strict(),
    err: ["ARTIFACT_NOT_FOUND", "EXTRACTION_FAILED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * `rerunDerivation`
   *
   * ⚠ 重跑产生**新派生版本**，旧派生版本**保留可下载**（便于对比 OCR 质量改进）；
   *   **原件哈希不变**（V3·22-4）——`originalSha256Unchanged` 让这条在响应里可断言。
   */
  rerunDerivation: {
    method: "POST",
    path: "/artifact-versions/:versionId/derived/rerun",
    in: z.object({ versionId: z.string(), kind: DerivedKind }).strict(),
    out: z
      .object({
        derivedId: z.string(),
        /** ⚠ 恒 true：重跑碰了原件就是一次证据平面事故 */
        originalSha256Unchanged: z.literal(true),
      })
      .strict(),
    err: ["ARTIFACT_NOT_FOUND", "EXTRACTION_FAILED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * `previewDeleteImpact` —— **删除前必须让人看见代价**
   *
   * ⚠ `exportedOutOfOrg` 在这里就要出现，不是等回执时才说——
   *   已导出到组织外的内容**无法回收**，那是删除决策的输入不是结果。
   */
  previewDeleteImpact: {
    method: "GET",
    path: "/artifacts/:artifactId/delete-impact",
    in: z.object({ artifactId: z.string() }).strict(),
    out: z
      .object({
        versionCount: z.number().int().nonnegative(),
        derivedCount: z.number().int().nonnegative(),
        segmentCount: z.number().int().nonnegative(),
        referencingClaims: z.array(Ref),
        referencingReportSections: z.array(Ref),
        legalHold: z.boolean(),
        exportedOutOfOrg: z.array(ExportRecord),
      })
      .strict(),
    err: ["ARTIFACT_NOT_FOUND", "PROJECT_ROLE_INSUFFICIENT", "AGENT_CANNOT_DELETE"] as const,
  },

  /**
   * `requestDeletion` —— 发起删除
   *
   * 🔴 **agent 不得发起删除**（D-39 同源）；组员/观察者 403。
   * 🔴 **六类级联缺一即验收不通过**（见 `CascadeKind`）。外加：引用它的报告段落
   *   标「证据已撤回」（D-19：对内可见，对外不自动改写，需人工确认后替换）。
   * ⚠ **逻辑失效不能等 worker**——必须在同步事务或极短异步内完成，
   *   否则 300s SLA 无法保证。
   * ⚠ `confirmedImpact: z.literal(true)` + `reason` 最短 4 字：
   *   二次确认与填原因在契约上不可绕。
   * ⚠ **部分撤回**按 `scope` 裁剪级联子集（撤回「AI 分析」不删录音）。**映射表 [待定 T-8]**
   *   ⇒ `scope` 收字符串而不是枚举，这是待裁标记不是设计。
   */
  requestDeletion: {
    method: "POST",
    path: "/artifacts/:artifactId/deletion-requests",
    in: z
      .object({
        artifactId: z.string(),
        reason: z.string().min(4),
        /** ⚠ 撤回范围映射表 **[待定 T-8]**；null = 全量 */
        scope: z.string().nullable(),
        confirmedImpact: z.literal(true),
      })
      .strict(),
    out: z
      .object({
        taskId: z.string(),
        logicalInvalidationDeadline: z.string(),
        physicalDeletionDeadline: z.string(),
      })
      .strict(),
    err: [
      "ARTIFACT_NOT_FOUND",
      "PROJECT_ROLE_INSUFFICIENT",
      "AGENT_CANNOT_DELETE",
      "LEGAL_HOLD_ACTIVE",
      "SNAPSHOT_IMMUTABLE",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** `getDeletionTask` —— 五步流程的单条查询。⚠ `receiptId` 非空 ⟺ 物理删除完成（N-18） */
  getDeletionTask: {
    method: "GET",
    path: "/deletion-tasks/:taskId",
    in: z.object({ taskId: z.string() }).strict(),
    out: z
      .object({
        taskId: z.string(),
        artifactRef: z.string(),
        step: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
        stepTimestamps: z.array(z.object({ step: z.number().int().positive(), at: z.string() }).strict()),
        status: z.enum(["pending", "running", "done", "partial-failure"]),
        /** ⚠ **六项逐一**（`CascadeKind`）。少一项就是少一条验收路径 */
        cascadeResults: z.array(z.object({ kind: CascadeKind, result: CascadeResult }).strict()),
        /** ⚠ 非空 ⟺ 物理删除完成（N-18）。部分失败时**恒为 null** */
        receiptId: z.string().nullable(),
        overdue: z.boolean(),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT"] as const,
  },

  /**
   * `listTrashQueue` —— 待删除队列
   *
   * ⚠ 宽限期内对象**在浏览器中不再出现**，仅合规负责人在此可见（E6·22-1）。
   * ⚠ 「合规负责人」这个角色**在四值项目角色枚举中缺位** —— 见 `KNOWN_CONTRACT_GAPS.FS9`。
   *   ⇒ 契约面的 `pre` 今天写不完整，本文件**不发明第五个项目角色**。
   */
  listTrashQueue: {
    method: "GET",
    path: "/projects/:projectId/trash-queue",
    in: z
      .object({ projectId: z.string(), status: z.enum(["pending", "running", "done", "partial-failure"]).nullable() })
      .strict(),
    out: z.object({ taskIds: z.array(z.string()) }).strict(),
    err: ["NO_PROJECT_ROLE", "PROJECT_ROLE_INSUFFICIENT"] as const,
  },

  /**
   * `retryCascade`
   *
   * 🔴 **部分失败的删除不得标为完成、不得出回执**（N-17）；
   *   超 30 天未完成触发升级告警。
   */
  retryCascade: {
    method: "POST",
    path: "/deletion-tasks/:taskId/retry-cascade",
    in: z.object({ taskId: z.string() }).strict(),
    out: z
      .object({
        status: z.enum(["pending", "running", "done", "partial-failure"]),
        cascadeResults: z.array(z.object({ kind: CascadeKind, result: CascadeResult }).strict()),
      })
      .strict(),
    err: ["DELETION_PARTIAL_FAILURE", "CASCADE_TARGET_UNAVAILABLE", "LEGAL_HOLD_ACTIVE"] as const,
  },

  /**
   * `revokeDeletion` —— 撤销删除
   *
   * ⚠ **是否提供撤销出口 [待定 T-5]**：它与对受访者的「已删除」承诺**可能直接冲突**。
   * ⚠ **界面在这条上自相矛盾，须一并裁定**：删除确认屏**没有**撤销入口
   *   （原型 agent 取的保守默认），而待删除队列组件里**已经有** revoke / revoked 两个 testid。
   *   ⇒ **同一件事在两个屏上表了相反的态。**
   * ⚠ 裁决为「不提供撤销」时，须**同时**删除本操作、那两个 testid、
   *   以及 coverage 反向检查里标出的那个孤儿操作——三处一起删，少一处就留下一个孤儿。
   *   见 `KNOWN_CONTRACT_GAPS.FS10`。
   */
  revokeDeletion: {
    method: "POST",
    path: "/deletion-tasks/:taskId/revoke",
    in: z.object({ taskId: z.string(), reason: z.string().min(1) }).strict(),
    out: z.object({ status: z.enum(["pending", "running", "done", "partial-failure"]) }).strict(),
    err: ["DELETION_PARTIAL_FAILURE", "CASCADE_TARGET_UNAVAILABLE", "LEGAL_HOLD_ACTIVE"] as const,
  },

  /** `applyLegalHold`。⚠ **只有**合规负责人；全程留痕（角色缺位见 `FS9`） */
  applyLegalHold: {
    method: "POST",
    path: "/artifacts/:artifactId/legal-hold",
    in: z.object({ artifactId: z.string(), reason: z.string().min(1) }).strict(),
    out: z.object({ holdId: z.string(), appliedBy: z.string(), appliedAt: z.string() }).strict(),
    err: ["PROJECT_ROLE_INSUFFICIENT", "ARTIFACT_NOT_FOUND"] as const,
  },

  /** `releaseLegalHold`。⚠ 解除同样全程留痕——解除比施加更需要问责 */
  releaseLegalHold: {
    method: "POST",
    path: "/artifacts/:artifactId/legal-hold/release",
    in: z.object({ artifactId: z.string(), reason: z.string().min(1) }).strict(),
    out: z.object({ holdId: z.string(), releasedBy: z.string(), releasedAt: z.string() }).strict(),
    err: ["PROJECT_ROLE_INSUFFICIENT", "ARTIFACT_NOT_FOUND"] as const,
  },

  /**
   * `getDeletionReceipt`
   *
   * 🔴 **不得出具虚假回执**（N-19）：已导出到组织外的内容无法回收时，
   *   回执必须**如实说明该边界**并列出导出记录（来自 `createExportJob` 的审计）。
   *   ⇒ `uncoverableStatement` 是**必填非空字符串**：没有可说的边界时写「无」，
   *     而不是让这个字段消失——字段消失读起来像「已全部覆盖」。
   * ⚠ **回执格式与是否需可验证签名 [待定 T-7]**（O-39 明标「必须等外部输入」）。
   */
  getDeletionReceipt: {
    method: "GET",
    path: "/deletion-tasks/:taskId/receipt",
    in: z.object({ taskId: z.string() }).strict(),
    out: z
      .object({
        objectRefs: z.array(z.string()),
        hashes: z.array(z.string()),
        deletedAt: z.string(),
        executor: z.string(),
        /** 六类级联的覆盖情况。⚠ 部分失败时**根本走不到这里**（N-17） */
        coverage: z.array(z.object({ kind: CascadeKind, result: CascadeResult }).strict()),
        exportedOutOfOrg: z.array(ExportRecord),
        /** ⚠ **必填非空**：无边界时写「无」，不让字段消失 */
        uncoverableStatement: z.string().min(1),
      })
      .strict(),
    err: ["DELETION_PARTIAL_FAILURE", "LEGAL_HOLD_ACTIVE"] as const,
  },

  /**
   * `getRetentionPolicy` —— O-01 留存五参数
   *
   * ⚠ **不得硬编码**：05-rec / 06-itv / 04-agent / 17-gov / 21-mcp
   *   共同消费**同一份**配置（N-20）。这个操作就是那份配置的唯一读入口。
   */
  getRetentionPolicy: {
    method: "GET",
    path: "/retention-policy",
    in: z.object({ orgId: z.string(), projectId: z.string().nullable() }).strict(),
    out: RetentionParams,
    err: ["PROJECT_ROLE_INSUFFICIENT"] as const,
  },

  /** `setRetentionPolicy`。⚠ 组织默认由管理员配；项目级覆盖由项目负责人配（D-14） */
  setRetentionPolicy: {
    method: "PUT",
    path: "/retention-policy",
    in: z.object({ projectId: z.string(), params: RetentionParams.partial() }).strict(),
    out: RetentionParams,
    err: ["PROJECT_ROLE_INSUFFICIENT", "RETENTION_PARAM_INVALID"] as const,
  },
} as const;

/**
 * 本束的契约缺口，逐条登记在契约自己身上。
 *
 * ⚠ 这不是 TODO 列表，是**需要人类签核才能补**的东西。
 */
export const KNOWN_CONTRACT_GAPS = {
  /**
   * 🔴 **来源类型词表两套且对不上 —— 本束头号分歧，本文件不选边。**
   * 契约侧 `artifact.ArtifactSource`（**已签核**，7 值）vs 界面侧 `SourceType`（8 值）：
   * 名字不同（`upload`↔`file` / `research-run`↔`research` / `ai-generated`↔`generated`）、
   * 8 值多出 `workshop` `canvas`、7 值多出 `prototype-run`。
   * 而 `usecases.md` A5·22-1 逐字写「**八类**来源节点恒显示」——用例文本站在 8 值那侧。
   * ⇒ 本文件所有来源类型字段用 `z.string()`，并把两套词表并排存进
   *   `SOURCE_TYPE_VOCABULARY_DISPUTED`。**那个宽松是待裁标记不是设计。**
   *   裁 8 值 ⇒ 修订**已签核**的 `artifact` 束（重签）；裁 7 值 ⇒ 工作坊与画布物化产出无处归类。
   */
  FS1: "SOURCE TYPE VOCABULARY CONFLICT (top dispute): SIGNED artifact.ArtifactSource has 7 values, apps/web mock SourceType has 8, spellings differ, each side has values the other lacks, and usecases.md A5 says '八类'. Deliberately NOT resolved here; every source-type field is z.string() plus SOURCE_TYPE_VOCABULARY_DISPUTED",
  /**
   * **`IngestionRun` 的 `status`（线上）与 `state`（前端视图）是同名不同义的两件事。**
   * 本仓已为「同名不同义」立过纪律（第 8 次刚清完），**两者不合并**：
   * `getIngestionRun.out.status` 是状态机真值，`getIngestionUiState.out.state` 是界面态。
   * ⚠ 今天两者的 zod 类型**恰好相同**（都是 `artifact.IngestionStatus`），
   *   这让「不合并」看起来像多此一举——**它不是**。界面态一旦需要
   *   「生成中」「已降级」这类线上状态机没有的值，两者就会分叉，
   *   而那时若已合并成一个字段，分叉会以静默的方式发生。
   */
  FS2: "IngestionRun.status (state machine truth) and the UI-facing .state are same-name-different-meaning and MUST NOT be merged; they happen to share a zod type today, which is exactly why someone will try to merge them",
  /**
   * **观察者是否有下载权 [待定 T-6]，而界面已先表了一半态。**
   * 拒绝态截图画的是「观察者只见已发布已脱敏」，但**下载按钮的结构被保留**，
   * 原型 agent 明确说明「没有把『观察者不能下载』硬编码进组件逻辑，等裁决后只改一处 gate」。
   * ⇒ **界面看起来像已经定了，其实没有**。这条不定，F31/F32 的 RLS 验收断言写不出。
   */
  FS3: "T-6 unruled (may an observer download?); the prototype kept the download button structure with a single un-wired gate, so the UI reads as decided when it is not — the RLS acceptance assertions cannot be written until it is ruled",
  /**
   * **机密文件命中的正文片段给不给非授权者看 [待定 T-6]。**
   * 展示则片段脱离「整份走本地模型」的路由约束；不展示则搜索对机密材料等于失效。
   * 契约暂按 fail-closed（`snippet` 可空），而**界面上没有第八种状态可切**来表达这件事。
   * ⇒ 这条不定，搜索对机密材料**要么失效、要么泄露，且两种情况在界面上都不可见地存在**。
   */
  FS4: "T-6 unruled (do confidential-file hits expose text snippets?); contract is fail-closed (nullable snippet) but the UI has no state to express either branch, so both failure and leak are invisible",
  /**
   * **能否删除单个中间版本 [待定 T-4]，而界面已替 UC 取了保守默认。**
   * 版本列表每个历史版本都给了「下载」但没给「删除此版本」——
   * **这是原型 agent 取的保守解，不是裁决**。
   * 裁决若反向，本契约须补一个 `deleteVersion` 用例，并处理
   * 「v2 曾被某条 Claim 引用则该 Claim 悬空」的证据链完整性问题。
   * ⇒ 故 `FILES_FORBIDDEN_ROUTES` 里**没有**把它写成禁令。
   */
  FS5: "T-4 unruled (may an individual intermediate version be deleted?); the prototype's conservative default is not a ruling, so it is neither an operation nor a forbidden route here",
  /**
   * **`REVIEW_PENDING` 的审核人是谁、阈值是多少 [待定 T-9]。**
   * 触发判据的**结构性部分**（机密 ∨ PII 五类 ∨ 解析质量低）本束已定，
   * 但 `resolveReviewPending.pre` 的完整形式取决于该裁决。
   * ⚠ 这正是 phase-00 `artifact` 束 coverage 缺口 ⑦「先做结构性断言，阈值后填」的延续。
   */
  FS6: "T-9 unruled: who the REVIEW_PENDING reviewer is, and the parse-quality threshold; only the structural trigger is settled",
  /**
   * **O-01 留存五参数与 `auth.AUTH_POLICY.orgRetentionDays: 180` 的关系没有出处。**
   * `AUTH_POLICY` 的长注写着 180 取自「O-01 的材料保留期」，且**刻意不在 SQL 里出现**；
   * 而本束的 `RetentionParams.materialDays` 是**同一个数**的可配置形式。
   * ⇒ 两处**必须**是同一份事实：`AUTH_POLICY` 是默认值，本束是按组织/项目的覆盖。
   *   但**没有任何门控**保证 `materialDays` 的默认取自 `AUTH_POLICY.orgRetentionDays`——
   *   这是第 N 次「同一事实两处」正在长出来的样子。
   */
  FS7: "no gate ties RetentionParams.materialDays back to auth.AUTH_POLICY.orgRetentionDays (180), although the latter's own comment says it comes from O-01's material retention period — a second declaration site in the making",
  /**
   * **`usecases.md` 说「本束新增 18 码」，但列出的码与实际用到的对不上。**
   * `RETENTION_PARAM_INVALID` 出现在 `setRetentionPolicy.err` 里，
   * **却不在那张 18 行的表内**。本文件收下它（有出处），但这处不一致须一并裁：
   * 要么表补一行（19 码），要么该操作换码。
   * ⚠ 数出来的数字写进标题，就会有人拿数字当封闭性断言（`toHaveLength`），
   *   而那条断言会在正当新增时变红、在漏写时变绿。
   */
  FS8: "usecases.md claims '18 new codes' but RETENTION_PARAM_INVALID appears in setRetentionPolicy.err without being in that table; the count and the list disagree",
  /**
   * **「合规负责人」在四值项目角色枚举中缺位。**
   * `listTrashQueue` / `retryCascade` / `revokeDeletion` / `applyLegalHold` /
   * `releaseLegalHold` 五个操作的 `pre` 都写着「合规负责人」，
   * 而 `identity.ProjectRole` 是封闭四值、`identity.OrgRole` 里的 `compliance` 是**组织角色**。
   * ⇒ 本文件**不发明第五个项目角色**，五处 `err` 停在 `PROJECT_ROLE_INSUFFICIENT`。
   *   ⚠ 与 `org-admin.KNOWN_CONTRACT_GAPS.OA2` 是**同一个缺口**，两束各自撞到。
   */
  FS9: "the 'compliance owner' actor required by five operations here has no home in the closed four-value identity.ProjectRole; identity.OrgRole has `compliance` but that is an org role. Same gap as org-admin OA2",
  /**
   * 🔴 **撤销删除：同一件事在两个屏上表了相反的态，且 [待定 T-5]。**
   * 删除确认屏没有撤销入口（原型的保守默认），而待删除队列组件里**已经有**
   * `files-trash-revoke` / `files-trash-revoked` 两个 testid。
   * ⇒ 裁「不提供撤销」时须**同时**删三处：本操作、那两个 testid、coverage 里的孤儿操作。
   *   少删一处就留下一个「界面上有按钮、后端没有接口」或反过来的孤儿。
   */
  FS10: "T-5 unruled AND the UI self-contradicts: the delete-confirm screen offers no revoke entry while the trash-queue component already ships revoke/revoked testids; ruling 'no revoke' requires deleting three things at once",
  /**
   * **两个跨阶段出站端口今天不存在，而 AC2 依赖它们。**
   * `invalidateOntologyEdges`（09-kg）与 `annotateWithdrawnEvidence`（10-report / 13-deliv）
   * 都属 phase-02。**任一模块不提供失效接口，AC2 就无法达成**——
   * 这是本模块最大的外部风险（uc-22-4 R10 逐字）。
   * ⚠ 且第二个端口与 phase-00 `artifact.markEvidenceWithdrawn` **形状高度相似**，
   *   须一致性复核确认**是不是同一个**。
   */
  FS11: "the two outbound cascade ports (09-kg edge invalidation, 10-report withdrawn-evidence annotation) are phase-02 and do not exist; AC2 cannot be met without them, and the second may be a duplicate of the SIGNED artifact.markEvidenceWithdrawn",
  /**
   * **六个 `[待定]` 数值让多条验收断言今天写不成可执行的形式。**
   * T-1 单文件上限 · T-2 类型白名单 · T-3 物化时限 · T-8 部分撤回映射表 ·
   * T-10 导出阈值，以及摄取超时阈值。
   * ⚠ **界面上是空缺，不是占位**：上传弹层与摄取抽屉里没有把这些数显示出来，
   *   因为没有权威数值。**别把「界面上没有这个字段」误读成「不需要这个字段」**。
   */
  FS12: "six [待定] numbers (T-1 file size cap, T-2 type allowlist, T-3 materialization deadline, T-8 partial-withdrawal cascade map, T-10 export threshold, ingestion timeout) leave several acceptance assertions unexecutable; their absence from the UI is a hole, not a decision",
  /**
   * 🔴 **两个出站端口的 `out` 分不清「本来就没有」与「目标模块没干活」。**
   * `invalidatedEdgeIds: []` 与 `annotatedSectionIds: []` 都是合法的成功响应，
   * 而它们同时也是「09-kg 收到请求后什么都没做」的响应——**逐字节相同**。
   * ⇒ 六类级联第 ⑤ 项会在这种情况下记 `ok`，回执照出，而边其实还在图里。
   * ⚠ 本文件**不发明第三个字段**（如 `matchedEdgeCount` / `targetScanned`）来补它：
   *   那是 09-kg 的响应形状，属 phase-02 的设计，替他定就是替人裁决。
   *   ⇒ F47 的契约测试对此**只断言形状，不断言语义**，缺口留在这里等一致性复核。
   * ⚠ `annotateWithdrawnEvidence.in.reason` 的最短长度 UC 未写；本文件取 min(1)，
   *   而调用侧 `requestDeletion.reason` 是 min(4)——**两处约束不一致**，一并裁。
   */
  FS13: "both outbound ports' out cannot distinguish 'no matching edges/sections existed' from 'the phase-02 module did nothing' — byte-identical responses, so cascade ⑤ records ok and the receipt is issued while the edges may still be live. Deliberately NOT patched with an invented third field (that is 09-kg's response shape). Also: reason min length is min(1) here vs min(4) on the calling requestDeletion",
} as const;
