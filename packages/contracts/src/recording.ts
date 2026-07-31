/**
 * 契约束 `recording` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西，任何一样都不许手写第二份——
 *   后端 DTO / 前端 client 类型 / OpenAPI / 前端 mock。
 *
 * 覆盖 feature：F69–F79（phase-01，11 个）
 * 依据 UC：`05-rec/uc-5-1`（采集与实时转写）· `uc-5-2`（说话人指派与声纹销毁）
 *         · `uc-5-3`（引述与打点）· `uc-5-4`（保留期与到期删除）
 * 领域不变量见 `phases/phase-01-run-a-project/contracts/recording/domain.md` 的 `I-n`。
 *
 * 核心不变量（本文件用形状去支撑，断言方式见 domain.md）：
 *   · **逐人 × 三项授权**（录音 / 转录 / AI 分析）：任一 `pending` ⇒ 开始录制不可用
 *     （`CONSENT_NOT_COMPLETED`，I-3 的接口投影）
 *   · 无 anchor 的转写段**拒绝入库**（I-1）；遮盖在**入库前**完成（I-20 / I-21）
 *   · `denied` 之后**不产生任何 Segment**；`paused` 在时间轴上**留缺口**，不拼接成连续假象（I-4 / I-5）
 *   · 重叠段 ⇒ `pending-manual` 且 `speakerChannelId = null`，**不静默归声道**（I-7）
 *   · 声纹 embedding 是**物理删除 + 审计事件**，不是打标记（I-15）；且**不按材料保留期处理**（I-18）
 *   · **部分成功一律不得报成功**（I-11 / I-13 / I-16 / I-34）
 */
import { z } from "zod";
import { PermissionReason } from "./identity";
import { ArtifactError } from "./artifact";
import { ContextPackReason } from "./context-pack";

/* ─────────────────────────── 枚举（对应 domain.md）─────────────────────────── */

/** 录制来源。三种协作容器都可起录（工作坊 / 访谈 / 对话线程） */
export const RecordingSourceType = z.enum(["workshop", "interview", "thread"]);

/**
 * 单路麦克风状态。
 * ⚠ **没有 `unknown`/`pending`**：这里表达的是「这一路现在采不采」，
 *   而「这个人授没授权」是**另一件事**（见 `ConsentItemState`）。
 *   把两者合并会让「已授权但此刻静音」与「没授权」不可分辨，而前者要留缺口、后者根本不该有轨。
 */
export const MicState = z.enum(["granted", "denied", "paused"]);

/**
 * 逐人 × 三项授权矩阵的**单元格状态**（uc-5-1 pre / 原型 P-12）。
 *
 * ⚠ **`pending` 是一等取值，不是「还没查到」**：`startRecording` 的门禁判据正是
 *   「任一单元格为 `pending` ⇒ 拒绝」。把 pending 折叠进 `denied` 会让界面
 *   说不出「去催授权」与「这个人明确拒绝了」的差别，而这两件事的出口完全不同。
 */
export const ConsentItemState = z.enum(["granted", "denied", "pending"]);

/** 三项授权。⚠ 与 `interview` 束受访者同意书的四位**不是同一个东西**：那里多一位 `attribution`（署名） */
export const RecordingConsentItem = z.enum(["record", "transcript", "ai_analysis"]);

/**
 * Segment 状态。
 * · `partial`        —— 尚未定稿的最后一段（「正在识别」）
 * · `final`          —— 可被引述
 * · `pending-manual` —— 重叠段，等人拆分（**唯一解除出口是 `splitOverlapSegment`**，uc-5-2 R7）
 * · `disputed`       —— 同一段被多人认领
 *
 * ⚠ `disputed` 在原型档案里 **0 命中**，是实现者替 UC 做的决定（ui-preview S-16）。
 *   它留在这里是因为 `usecases.md` 明写了 `markDispute` 与 `SEGMENT_DISPUTED_NOT_CITABLE`；
 *   若人类裁定它不是正式状态，删除处需**同时**删掉那个错误码，
 *   见 `KNOWN_CONTRACT_GAPS.C_REC_3`。
 */
export const SegmentStatus = z.enum(["partial", "final", "pending-manual", "disputed"]);

/** 引述的证据性质。⚠ 封闭性待裁（domain D-7），见 `KNOWN_CONTRACT_GAPS.C_REC_3` */
export const EvidenceNature = z.enum(["个人经历", "二手转述", "观点"]);

/** 打点来源。`ai` 产出恒为候选态，**不进证据库、不进报告、不进决策链**（I-24） */
export const AnnotationOrigin = z.enum(["human", "ai"]);

/** 打点状态。`candidate` **不混入人工打点计数**（I-25）；`ignored` 也留痕（I-27） */
export const AnnotationState = z.enum(["candidate", "confirmed", "ignored"]);

/** 下游消费方——引用一条打点/引述时必须声明用途 */
export const EvidenceConsumer = z.enum(["report", "canvas", "kg", "decision"]);

/** 物化产物的四种 kind（uc-5-1 R10，登记进 artifact 束，本束**不另建索引表**） */
export const RecordingArtifactKind = z.enum([
  "audio", "transcript", "notes", "whiteboard-photo",
]);

/** 保留期的解析来源。⚠ **没有 `default`**——组织默认值缺失就是 `RETENTION_POLICY_MISSING`（I-33 / E5） */
export const RetentionResolvedFrom = z.enum(["project", "org"]);

/**
 * PII 五类（O-39 可执行最小集）—— 转写落库前自动遮盖的类型全集（F72，domain.md §「PII（O-39）」）。
 *
 * ⚠ **只增不减，不是封闭枚举**（O-39 原文）：合规输入到位后允许新增第六类，但**现有五个不得删改名**——
 *   与 `SegmentStatus.disputed` 那种「封闭性待裁」不同，这条的方向是反过来的
 *   （见 `KNOWN_CONTRACT_GAPS.C_REC_3` 关于封闭性表达不出来的讨论；这里记录的是新增方向的约束）。
 * ⚠ `apps/web/lib/mock/rec.ts` 曾手写同一个联合类型（标注「契约缺枚举，待迁入」）——
 *   本次落地后那份改为 `z.infer<typeof C.PiiType>`，不再手抄（`lint-contract-source` 门控）。
 */
export const PiiType = z.enum(["email", "phone", "id-card", "bank-card", "address"]);

/**
 * 本束失败模式全集。**「失败长什么样」是契约的一半**——界面的异常态全靠它。
 *
 * ⚠ 四个「通用前置」失败（`UNAUTHENTICATED` / `NO_ORG_ROLE` / `NO_PROJECT_ROLE` /
 *   `RESOURCE_NOT_FOUND`）在 `usecases.md` 里约定为**每个用例默认带**，
 *   下面各操作的 `err` 只在有特殊语义时才重复列。契约里保留它们的字面量，
 *   是为了让中间件与前端能穷举同一套码。
 */
export const RecordingError = z.enum([
  /* ── 通用前置 ────────────────────────────────────────────────── */
  "UNAUTHENTICATED",
  "NO_ORG_ROLE",
  /** 🔗 与 `identity.PermissionReason` 同码同义（编译期断言见文件末尾） */
  "NO_PROJECT_ROLE",
  "RESOURCE_NOT_FOUND",
  /** 幂等重放冲突：同 key 不同 body */
  "IDEMPOTENCY_KEY_CONFLICT",

  /* ── 采集（uc-5-1）────────────────────────────────────────────── */
  /** 组织默认保留期缺失 ⇒ **拒绝开始，不用隐含常量兜底**（E5 / I-33） */
  "RETENTION_POLICY_MISSING",
  "SESSION_ALREADY_RECORDING",
  /** 三项授权矩阵任一 `pending` ⇒ 该路不采集（原型 P-12） */
  "CONSENT_NOT_COMPLETED",
  "SOURCE_REF_NOT_FOUND",
  "TRACK_NOT_FOUND",
  "MIC_STATE_TRANSITION_INVALID",
  "NOT_TRACK_OWNER",
  /** 🔗 与 `context-pack.ContextPackReason` 同码同义：无锚点的引用不合格（I-1） */
  "ANCHOR_MISSING",
  "ANCHOR_OUT_OF_RANGE",
  "SESSION_ENDED",
  "SESSION_ALREADY_ENDED",
  "SESSION_NOT_FOUND",
  "MIC_NOT_GRANTED",
  /** 脱敏内核不可用 ⇒ **拒绝入库，不得明文落库**（I-21） */
  "PII_MASKING_UNAVAILABLE",
  "CURSOR_INVALID",
  /** 无权看 PII 原文 ⇒ 拒绝，且**同样写审计**（I-23） */
  "PII_REVEAL_FORBIDDEN",
  "PII_ORIGINAL_DESTROYED",
  "DECRYPTION_KEY_UNAVAILABLE",
  "FINDING_NOT_FOUND",

  /* ── 物化（跨束）─────────────────────────────────────────────── */
  "SESSION_NOT_ENDED",
  "MATERIALIZE_PARTIAL_FAILURE",
  "OBJECT_STORE_UNAVAILABLE",
  "ARTIFACT_REGISTRY_UNAVAILABLE",
  /** 🔗 与 `artifact.ArtifactError` 同码同义：试图覆盖原音频版本（artifact I-1） */
  "SNAPSHOT_IMMUTABLE",

  /* ── 说话人指派（uc-5-2）──────────────────────────────────────── */
  "ROSTER_UNAVAILABLE",
  "CHANNEL_ALREADY_ASSIGNED",
  "CHANNEL_VERSION_CHANGED",
  "PERSON_NOT_IN_ROSTER",
  "OVERLAP_SEGMENT_REQUIRES_SPLIT",
  /** 🔗 与 `context-pack.ContextPackReason` 同码同义：过程中权限被撤 ⇒ 立即终止写（E4） */
  "PERMISSION_REVOKED_MIDWAY",
  "SEGMENT_NOT_FOUND",
  "SPLIT_RANGES_INVALID",
  "SEGMENT_NOT_OVERLAP",
  "SEGMENT_NOT_LOW_CONFIDENCE",
  "SEGMENT_VERSION_CHANGED",
  "ASSIGNMENT_ALREADY_REVOKED",
  "ASSIGNMENT_NOT_FOUND",
  "BACKFILL_REVERT_PARTIAL_FAILURE",
  "DISPUTE_CLAIMS_TOO_FEW",

  /* ── 声纹销毁（uc-5-2 R7 / O-14）───────────────────────────────── */
  "ASSIGNMENT_NOT_COMPLETE",
  "DESTROY_PARTIAL_FAILURE",
  "CASCADE_INVALIDATION_FAILED",

  /* ── 引述与打点（uc-5-3）──────────────────────────────────────── */
  /** 四个「不可引述」码**必须可区分**——界面要给不同的「去校对」出口（E5） */
  "SEGMENT_PARTIAL_NOT_CITABLE",
  "SEGMENT_LOW_CONFIDENCE_NOT_CITABLE",
  "SEGMENT_PENDING_MANUAL_NOT_CITABLE",
  "SEGMENT_DISPUTED_NOT_CITABLE",
  "RQ_NOT_FOUND",
  "RQ_NOT_IN_PROJECT",
  "EVIDENCE_NATURE_INVALID",
  "QUOTE_WITHDRAWN",
  "QUOTE_NOT_FOUND",
  "ANNOTATION_KIND_INVALID",
  /** AI 打点缺 Pack ⇒ 拒绝（I-26）。上下文**只能**来自 Context API */
  "CONTEXT_PACK_REQUIRED",
  "CONTEXT_PACK_NOT_REPLAYABLE",
  /** 静态检查 + 运行时双重（V16）：不得直查 segments / 向量库 */
  "DIRECT_SEGMENT_ACCESS_FORBIDDEN",
  "ANNOTATION_ALREADY_DECIDED",
  "ANNOTATION_RATIONALE_WITHDRAWN",
  "ANNOTATION_NOT_FOUND",
  "AI_ANNOTATION_NOT_CONFIRMED",
  "EVIDENCE_WITHDRAWN",

  /* ── 保留期与到期删除（uc-5-4）────────────────────────────────── */
  "RETENTION_VALUE_OUT_OF_RANGE",
  "EXPIRY_ALREADY_FROZEN",
  "DELETION_TASK_FAILED",
  "MATERIAL_NOT_FOUND",

  /* ── 同意书渲染（uc-5-4 R3-3）─────────────────────────────────── */
  /** 任一模板变量缺失 ⇒ **不得发出授权链接**（I-39 / E6） */
  "CONSENT_TEMPLATE_VARIABLE_MISSING",
  "CONSENT_SNAPSHOT_IMMUTABLE",
  "CONSENT_NOT_SUBMITTED",
  "TEMPLATE_NOT_FOUND",
]);

/* ─────────────────────────────── 实体 ─────────────────────────────── */

/**
 * 逐人 × 三项的授权矩阵单元。
 * ⚠ 这是 `startRecording` 门禁的**唯一判据来源**：矩阵里任一 `pending` ⇒ 拒绝开始。
 *   「前端把按钮置灰」不构成这条约束的实现。
 */
export const ConsentMatrixCell = z.object({
  participantId: z.string(),
  item: RecordingConsentItem,
  state: ConsentItemState,
}).strict();

/** 一条采集轨。`denied` 的轨**不产生任何 Segment**（I-4） */
export const Track = z.object({
  trackId: z.string(),
  sessionId: z.string(),
  participantId: z.string().nullable(),
  micState: MicState,
}).strict();

/** `paused` 在时间轴上留下的缺口。**显式标出而不是拼接成连续假象**（I-5 / E2） */
export const GapRange = z.object({
  fromMs: z.number().int().nonnegative(),
  toMs: z.number().int().nonnegative(),
}).strict();

/**
 * 转写段的锚点。⚠ **无锚点拒绝入库**（I-1）——两种形态择一，都缺就是 `ANCHOR_MISSING`。
 * 用可空字段而不是 `z.union`：union 的 mock 生成器只取第一支，
 * 而这个判别是应用层强制的（同 context-pack 束 `Anchor` 的做法）。
 */
export const SegmentAnchor = z.object({
  startMs: z.number().int().nonnegative().nullable(),
  endMs: z.number().int().nonnegative().nullable(),
  messageId: z.string().nullable(),
}).strict();

/**
 * 脱敏命中。⚠ **遮盖在入库前完成**，原文单独加密存储（I-20 / I-21）。
 * `span` 是**遮盖后文本**里占位符的位置（界面就地渲染「已自动遮盖：… · 查看原文需权限」要用它），
 * 不是原文里的位置——原文位置在遮盖后已不可还原，也不该被返回体带出去。
 */
export const PiiFinding = z.object({
  findingId: z.string(),
  type: PiiType,
  span: z.object({
    start: z.number().int().nonnegative(),
    end: z.number().int().nonnegative(),
  }).strict(),
}).strict();

/**
 * 转写段。
 * ⚠ `resolvedSpeaker` **由 `SpeakerAssignment` 解析而来，不是 Segment 上的存储字段**（I-10）；
 *   未指派时为 `null`，界面渲染「出处待补」——**不是空字符串，也不是「未知」这种编出来的人名**。
 */
export const Segment = z.object({
  id: z.string(),
  sessionId: z.string(),
  trackId: z.string(),
  anchor: SegmentAnchor,
  /** 重叠段恒为 null（I-7）：**不得在此静默归给某个声道** */
  speakerChannelId: z.string().nullable(),
  resolvedSpeaker: z.string().nullable(),
  status: SegmentStatus,
  /** 阈值本身 [待定 D-1]；「命中即挂标记」是结构性断言，可立即验收 */
  lowConfidence: z.boolean(),
  /** **遮盖后**的文本。原文走 `revealPii`（独立授权动作） */
  text: z.string(),
  piiFindings: z.array(PiiFinding),
}).strict();

/** 匿名声道。`candidates ⊆ roster(sessionId)`（I-9），**不存在跨场次声纹比对**（I-12） */
export const SpeakerChannel = z.object({
  channelId: z.string(),
  label: z.string(),
  durationRatio: z.number(),
  firstSeenMs: z.number().int().nonnegative(),
  sampleSegmentIds: z.array(z.string()),
}).strict();

/** 候选人。`source` 恒为 `roster`——**不得回落到任何跨场次来源**（I-9 / `ROSTER_UNAVAILABLE`） */
export const SpeakerCandidate = z.object({
  personId: z.string(),
  displayName: z.string(),
  source: z.literal("roster"),
}).strict();

/** 引述。未指派说话人**可以**入库，出处显示「出处待补」（E1） */
export const Quote = z.object({
  quoteId: z.string(),
  segmentId: z.string(),
  anchor: SegmentAnchor,
  rqId: z.string().nullable(),
  evidenceNature: EvidenceNature,
}).strict();

/**
 * AI 打点的依据。⚠ **缺 `contextPackId` 即拒绝**（I-26）：
 * 「这条候选凭什么」必须可重放，否则确认它的人无从判断。
 */
export const AnnotationRationale = z.object({
  contextPackId: z.string(),
  segmentIds: z.array(z.string()),
  retrievalReasons: z.array(z.string()),
}).strict();

/** 保留期解析结果。⚠ **一律读参数，不写常量**（I-32）；O-01 给出默认值**不放松**这一条 */
export const RetentionResolution = z.object({
  resolvedDays: z.number().int().positive(),
  resolvedFrom: RetentionResolvedFrom,
  resolvedAt: z.string(),
}).strict();

/* ───────────────────────────── 操作 ───────────────────────────── */

export const operations = {
  /* ── 一、采集与实时转写（uc-5-1）──────────────────────────────── */

  /**
   * startRecording —— 开始录制。
   * ⚠ **本操作是三项授权矩阵的硬门禁**：任一在场者的任一项为 `pending`
   *   ⇒ `CONSENT_NOT_COMPLETED`，那一路不采集。前端禁用而后端放行不算实现。
   * ⚠ 组织默认保留期缺失 ⇒ `RETENTION_POLICY_MISSING`，**不用隐含常量兜底**（E5）。
   */
  startRecording: {
    method: "POST", path: "/recording/sessions",
    in: z.object({
      sourceType: RecordingSourceType,
      sourceRefId: z.string(),
      projectId: z.string(),
      trackPlan: z.array(z.object({ participantId: z.string().nullable() }).strict()),
      idempotencyKey: z.string(),
    }).strict(),
    out: z.object({
      sessionId: z.string(),
      tracks: z.array(z.object({
        trackId: z.string(), micState: MicState,
      }).strict()),
      /** 生效保留期在**开始时就解析出来并回给界面**——不是事后才知道存多久 */
      retention: z.object({
        resolvedDays: z.number().int().positive(),
        resolvedFrom: RetentionResolvedFrom,
        expiresAt: z.string(),
      }).strict(),
    }).strict(),
    err: [
      "RETENTION_POLICY_MISSING", "SESSION_ALREADY_RECORDING", "CONSENT_NOT_COMPLETED",
      "SOURCE_REF_NOT_FOUND", "NO_PROJECT_ROLE", "IDEMPOTENCY_KEY_CONFLICT",
    ] as const,
  },

  /**
   * getConsentMatrix —— 逐人 × 三项授权矩阵（`startRecording` 门禁的可视化对手方）。
   *
   * ⚠ **`usecases.md` 没有显式列出这个读端口**，但 `CONSENT_NOT_COMPLETED` 的界面出口
   *   （「谁的哪一项还没到」）没有它就无从渲染，只能靠前端自己拼——那就是第二份判据。
   *   本操作是**本束替 UC 补的形状**，登记在 `KNOWN_CONTRACT_GAPS.C_REC_1`。
   */
  getConsentMatrix: {
    method: "GET", path: "/recording/sessions/:sessionId/consent-matrix",
    in: z.object({ sessionId: z.string() }).strict(),
    out: z.object({
      cells: z.array(ConsentMatrixCell),
      /** 恒等于「存在任一 `pending`」——门禁判据只有一处，界面不自行推导 */
      blocksStart: z.boolean(),
    }).strict(),
    err: ["SESSION_NOT_FOUND", "NO_PROJECT_ROLE"] as const,
  },

  /**
   * setMicState —— 设置本路麦克风状态。
   * ⚠ `denied` 之后**不得产生任何 Segment**（I-4）；`paused` **留缺口**、已产生的转写段
   *   **不回收**、重开后续接同一条转写（A2 / I-5）。**不得静默继续采集。**
   */
  setMicState: {
    method: "POST", path: "/recording/tracks/:trackId/mic-state",
    in: z.object({
      trackId: z.string(),
      micState: MicState,
      reason: z.string().nullable(),
      idempotencyKey: z.string(),
    }).strict(),
    out: z.object({
      trackId: z.string(),
      micState: MicState,
      gapRanges: z.array(GapRange),
    }).strict(),
    err: [
      "TRACK_NOT_FOUND", "MIC_STATE_TRANSITION_INVALID", "NOT_TRACK_OWNER",
      "IDEMPOTENCY_KEY_CONFLICT",
    ] as const,
  },

  /**
   * ingestSegment —— 摄取一条转写段。
   * ⚠ `overlap: true` ⇒ `status = pending-manual` 且 `speakerChannelId = null`（I-7 / O-13）。
   * ⚠ 遮盖在**入库前**完成；脱敏内核不可用一律 `PII_MASKING_UNAVAILABLE`，**不得明文落库**（I-21）。
   */
  ingestSegment: {
    method: "POST", path: "/recording/sessions/:sessionId/segments",
    in: z.object({
      sessionId: z.string(),
      trackId: z.string(),
      anchor: SegmentAnchor,
      rawText: z.string(),
      asrConfidence: z.number(),
      diarization: z.object({
        channelId: z.string().nullable(),
        overlap: z.boolean(),
      }).strict(),
      idempotencyKey: z.string(),
    }).strict(),
    out: z.object({
      segmentId: z.string(),
      status: SegmentStatus,
      speakerChannelId: z.string().nullable(),
      lowConfidence: z.boolean(),
      text: z.string(),
      piiFindings: z.array(PiiFinding),
    }).strict(),
    err: [
      "ANCHOR_MISSING", "ANCHOR_OUT_OF_RANGE", "SESSION_ENDED", "MIC_NOT_GRANTED",
      "PII_MASKING_UNAVAILABLE", "TRACK_NOT_FOUND", "IDEMPOTENCY_KEY_CONFLICT",
    ] as const,
  },

  /**
   * readTranscriptStream —— 读取转写流 / 全文检索。
   * ⚠ 观察者只读且说话人**掩码到角色标签**（S-11）——服务端投影，不是前端隐藏。
   * ⚠ 响应体**也**受契约校验（`contract-design.md` §五-6）。
   */
  readTranscriptStream: {
    method: "GET", path: "/recording/sessions/:sessionId/segments",
    in: z.object({
      sessionId: z.string(),
      cursor: z.string().optional(),
      limit: z.number().int().positive().optional(),
      q: z.string().optional(),
      /** 恒 true：本端口**不提供**未遮盖读取，那条路只有 `revealPii` */
      includeMasked: z.literal(true),
    }).strict(),
    out: z.object({
      segments: z.array(Segment),
      nextCursor: z.string().nullable(),
      latencyMs: z.number().int().nonnegative(),
    }).strict(),
    err: ["NO_PROJECT_ROLE", "SESSION_NOT_FOUND", "CURSOR_INVALID"] as const,
  },

  /** endRecording —— 结束录制，返回物化任务 id（物化本身是独立操作，见下） */
  endRecording: {
    method: "POST", path: "/recording/sessions/:sessionId/end",
    in: z.object({ sessionId: z.string(), idempotencyKey: z.string() }).strict(),
    out: z.object({
      sessionId: z.string(),
      endedAt: z.string(),
      durationMs: z.number().int().nonnegative(),
      materializeJobId: z.string(),
    }).strict(),
    err: [
      "SESSION_ALREADY_ENDED", "SESSION_NOT_FOUND", "NO_PROJECT_ROLE",
      "IDEMPOTENCY_KEY_CONFLICT",
    ] as const,
  },

  /**
   * revealPii —— 查看 PII 原文（**独立授权动作**）。
   * ⚠ 管理员**不天然拥有**该权限（对齐 identity D-18）。
   * ⚠ **被拒也写审计**（I-23）——`auditEventId` 在成功路径返回，拒绝路径由服务端另写。
   */
  revealPii: {
    method: "POST", path: "/recording/pii-findings/:findingId/reveal",
    in: z.object({ findingId: z.string(), justification: z.string() }).strict(),
    out: z.object({
      type: PiiType, plaintext: z.string(), auditEventId: z.string(),
    }).strict(),
    err: [
      "PII_REVEAL_FORBIDDEN", "PII_ORIGINAL_DESTROYED",
      "DECRYPTION_KEY_UNAVAILABLE", "FINDING_NOT_FOUND",
    ] as const,
  },

  /* ── 二、录制产物物化（uc-5-1 R10 · 跨束）──────────────────────── */

  /**
   * materializeRecordingArtifacts —— 物化并登记到文件平面。
   * ⚠ **跨束**：登记走 artifact 束的 `artifacts` + `artifact_versions`，
   *   本束**不另建索引表**（I-28）。转写稿是派生物，带 `derivedFrom` 指回原音频版本，**不覆盖原件**。
   * ⚠ `MATERIALIZE_PARTIAL_FAILURE`：**部分成功不得报成功**——已登记的保留，未登记的可重试。
   */
  materializeRecordingArtifacts: {
    method: "POST", path: "/recording/sessions/:sessionId/materialize",
    in: z.object({ sessionId: z.string(), idempotencyKey: z.string() }).strict(),
    out: z.object({
      artifacts: z.array(z.object({
        kind: RecordingArtifactKind,
        artifactId: z.string(),
        versionId: z.string(),
        contentHash: z.string(),
        derivedFrom: z.string().nullable(),
      }).strict()),
    }).strict(),
    err: [
      "SESSION_NOT_ENDED", "MATERIALIZE_PARTIAL_FAILURE", "OBJECT_STORE_UNAVAILABLE",
      "ARTIFACT_REGISTRY_UNAVAILABLE", "SNAPSHOT_IMMUTABLE", "IDEMPOTENCY_KEY_CONFLICT",
    ] as const,
  },

  /* ── 三、说话人指派（uc-5-2）──────────────────────────────────── */

  /**
   * listChannelsAndCandidates —— 匿名声道与候选人。
   * ⚠ `candidates ⊆ roster(sessionId)`（I-9）。在场名单取不到 ⇒ `ROSTER_UNAVAILABLE`，
   *   **不得回落到任何跨场次来源**——那正是「跨场次声纹比对」的后门（I-12）。
   */
  listChannelsAndCandidates: {
    method: "GET", path: "/recording/sessions/:sessionId/speaker-candidates",
    in: z.object({ sessionId: z.string() }).strict(),
    out: z.object({
      channels: z.array(SpeakerChannel),
      candidates: z.array(SpeakerCandidate),
      /** 三个待办计数。为 0 时显示真实空态，**不隐藏入口** */
      pending: z.object({
        unassignedChannels: z.number().int().nonnegative(),
        overlapSegments: z.number().int().nonnegative(),
        lowConfidenceSegments: z.number().int().nonnegative(),
      }).strict(),
    }).strict(),
    err: ["SESSION_NOT_FOUND", "ROSTER_UNAVAILABLE"] as const,
  },

  /**
   * assignChannel —— 整声道指派（一次覆盖全部段落）。
   * ⚠ **回填是指向同一条映射记录的引用，不是复制副本**（I-10 / I-11）——
   *   所以 `backfilledRefs` 只给「哪类、多少条」，不给内容。
   */
  assignChannel: {
    method: "POST", path: "/recording/sessions/:sessionId/assignments",
    in: z.object({
      sessionId: z.string(),
      channelId: z.string(),
      personId: z.string(),
      expectedChannelVersion: z.number().int().nonnegative(),
      idempotencyKey: z.string(),
    }).strict(),
    out: z.object({
      assignmentId: z.string(),
      affectedSegmentCount: z.number().int().nonnegative(),
      backfilledRefs: z.array(z.object({
        kind: z.string(), count: z.number().int().nonnegative(),
      }).strict()),
    }).strict(),
    err: [
      "CHANNEL_ALREADY_ASSIGNED", "CHANNEL_VERSION_CHANGED", "PERSON_NOT_IN_ROSTER",
      "OVERLAP_SEGMENT_REQUIRES_SPLIT", "PERMISSION_REVOKED_MIDWAY", "IDEMPOTENCY_KEY_CONFLICT",
    ] as const,
  },

  /** overrideSegmentSpeaker —— 单段例外修正 */
  overrideSegmentSpeaker: {
    method: "POST", path: "/recording/segments/:segmentId/speaker-override",
    in: z.object({
      segmentId: z.string(), personId: z.string(), reason: z.string(),
    }).strict(),
    out: z.object({
      overrideId: z.string(), segmentId: z.string(), resolvedSpeaker: z.string(),
    }).strict(),
    err: [
      "OVERLAP_SEGMENT_REQUIRES_SPLIT", "PERSON_NOT_IN_ROSTER", "SEGMENT_NOT_FOUND",
    ] as const,
  },

  /**
   * splitOverlapSegment —— 拆分重叠段。
   * ⚠ **这是 `pending-manual` 的唯一解除出口**，且必须由人完成并留痕（uc-5-2 R7）。
   */
  splitOverlapSegment: {
    method: "POST", path: "/recording/segments/:segmentId/splits",
    in: z.object({
      segmentId: z.string(),
      splits: z.array(z.object({
        startMs: z.number().int().nonnegative(),
        endMs: z.number().int().nonnegative(),
        personId: z.string().nullable(),
      }).strict()),
    }).strict(),
    out: z.object({
      segmentIds: z.array(z.string()), parentSegmentId: z.string(),
    }).strict(),
    err: ["SPLIT_RANGES_INVALID", "SEGMENT_NOT_OVERLAP", "SEGMENT_NOT_FOUND"] as const,
  },

  /**
   * correctSegmentText —— 逐字稿校对：低置信改词。
   *
   * ⚠ **这是个闸门**：`out.status = "final"` 且 `lowConfidence = false` 之后，
   *   该段才可被 `markQuote` 引述、才算进正式证据库。**确认之前它进不了引述**
   *   （`SEGMENT_LOW_CONFIDENCE_NOT_CITABLE`）。这两件事是同一条不变量的两面，
   *   不许一边放行一边挡。
   * ⚠ 修正文本**同样要过遮盖**（I-21）——人手打进去的字里一样会有身份证号。
   */
  correctSegmentText: {
    method: "POST", path: "/recording/segments/:segmentId/corrections",
    in: z.object({
      segmentId: z.string(), correctedText: z.string(), reason: z.string(),
      idempotencyKey: z.string(),
    }).strict(),
    out: z.object({
      segmentId: z.string(),
      status: z.literal("final"),
      lowConfidence: z.literal(false),
      revisionId: z.string(),
    }).strict(),
    err: [
      "SEGMENT_NOT_LOW_CONFIDENCE", "PII_MASKING_UNAVAILABLE",
      "SEGMENT_VERSION_CHANGED", "IDEMPOTENCY_KEY_CONFLICT",
    ] as const,
  },

  /**
   * revokeAssignment —— 撤销指派。
   * ⚠ 撤销后所有回填处**同步退回「出处待补」**，不留脏数据；
   *   部分回退失败 ⇒ `BACKFILL_REVERT_PARTIAL_FAILURE`，**不得报成功**（I-11）。
   */
  revokeAssignment: {
    method: "POST", path: "/recording/assignments/:assignmentId/revoke",
    in: z.object({ assignmentId: z.string(), reason: z.string() }).strict(),
    out: z.object({
      assignmentId: z.string(),
      revokedAt: z.string(),
      revertedRefs: z.array(z.object({
        kind: z.string(), count: z.number().int().nonnegative(),
      }).strict()),
    }).strict(),
    err: [
      "ASSIGNMENT_ALREADY_REVOKED", "ASSIGNMENT_NOT_FOUND", "BACKFILL_REVERT_PARTIAL_FAILURE",
    ] as const,
  },

  /**
   * markDispute —— 标记争议（同一段被多人认领）。
   * ⚠ `disputed` 的正式性 **[待定 D-9]**，见 `KNOWN_CONTRACT_GAPS.C_REC_3`。
   */
  markDispute: {
    method: "POST", path: "/recording/segments/:segmentId/dispute",
    in: z.object({ segmentId: z.string(), claims: z.array(z.string()) }).strict(),
    out: z.object({
      segmentId: z.string(),
      status: z.literal("disputed"),
      claims: z.array(z.string()),
    }).strict(),
    err: ["SEGMENT_NOT_FOUND", "DISPUTE_CLAIMS_TOO_FEW"] as const,
  },

  /* ── 四、声纹销毁（uc-5-2 R7 · O-14 · 本束最硬的一条）────────────── */

  /**
   * destroyVoiceprints —— 指派完成即销毁本场声纹 embedding。
   * ⚠ 销毁是**物理删除 + 审计事件**，不是打标记（I-15）；
   *   级联失效任何以它为输入的派生物与缓存（I-16），级联失败 ⇒ **整体判失败**。
   * ⚠ 销毁后重跑 diarization 只产生**新的派生版本**，旧特征不复活（I-17）。
   */
  destroyVoiceprints: {
    method: "POST", path: "/recording/sessions/:sessionId/voiceprints/destroy",
    in: z.object({
      sessionId: z.string(), trigger: z.literal("assignment-completed"),
    }).strict(),
    out: z.object({
      destroyedCount: z.number().int().nonnegative(), auditEventId: z.string(),
    }).strict(),
    err: [
      "ASSIGNMENT_NOT_COMPLETE", "DESTROY_PARTIAL_FAILURE", "CASCADE_INVALIDATION_FAILED",
    ] as const,
  },

  /**
   * sweepVoiceprints —— 兜底销毁（本场结束后第 7 天，**无条件**）。
   * ⚠ 到期删除任务的作用域**不含** embedding —— 它的存活期远短于材料保留期（I-18）。
   *   两条链分开正是为了防止「材料保留 180 天 ⇒ 声纹也留 180 天」这个默认继承。
   */
  sweepVoiceprints: {
    method: "POST", path: "/recording/voiceprints/sweep",
    in: z.object({ asOf: z.string() }).strict(),
    out: z.object({
      sessions: z.array(z.object({
        sessionId: z.string(),
        destroyedCount: z.number().int().nonnegative(),
        auditEventId: z.string(),
      }).strict()),
    }).strict(),
    err: ["DESTROY_PARTIAL_FAILURE", "CASCADE_INVALIDATION_FAILED"] as const,
  },

  /* ── 五、引述与打点（uc-5-3）──────────────────────────────────── */

  /**
   * markQuote —— 标为引述。
   * ⚠ 四个拒绝码**必须可区分**：界面要给出**不同的「去校对」出口**（E5）。
   *   合并成一个 `SEGMENT_NOT_CITABLE` 会让「去拆分」「去校对」「去指派」三个动作变成一句废话。
   * ⚠ **不得先入库再说。** 未指派说话人的引述**可以**入库，出处显示「出处待补」（E1）。
   */
  markQuote: {
    method: "POST", path: "/recording/segments/:segmentId/quotes",
    in: z.object({
      segmentId: z.string(),
      selectionSpan: z.object({
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
      }).strict().nullable(),
      rqId: z.string().nullable(),
      evidenceNature: EvidenceNature,
    }).strict(),
    out: Quote,
    err: [
      "SEGMENT_PARTIAL_NOT_CITABLE", "SEGMENT_LOW_CONFIDENCE_NOT_CITABLE",
      "SEGMENT_PENDING_MANUAL_NOT_CITABLE", "SEGMENT_DISPUTED_NOT_CITABLE",
      "ANCHOR_MISSING", "RQ_NOT_FOUND", "EVIDENCE_NATURE_INVALID",
    ] as const,
  },

  /** bindQuoteToRq —— 绑定引述到研究问题 */
  bindQuoteToRq: {
    method: "POST", path: "/recording/quotes/:quoteId/rq",
    in: z.object({ quoteId: z.string(), rqId: z.string() }).strict(),
    out: z.object({
      quoteId: z.string(), rqId: z.string(), coverageDelta: z.number().int(),
    }).strict(),
    err: ["RQ_NOT_IN_PROJECT", "QUOTE_WITHDRAWN", "QUOTE_NOT_FOUND"] as const,
  },

  /** createHumanAnnotation —— 人工打点。恒 `confirmed`，直接进证据库 */
  createHumanAnnotation: {
    method: "POST", path: "/recording/sessions/:sessionId/annotations",
    in: z.object({
      sessionId: z.string(),
      anchorAt: z.number().int().nonnegative().nullable(),
      segmentId: z.string().nullable(),
      kind: z.string(),
      note: z.string().nullable(),
    }).strict(),
    out: z.object({
      annotationId: z.string(),
      origin: z.literal("human"),
      state: z.literal("confirmed"),
    }).strict(),
    err: ["ANCHOR_MISSING", "ANNOTATION_KIND_INVALID"] as const,
  },

  /**
   * createAiAnnotationCandidate —— AI 产生打点候选。
   * ⚠ 上下文**只能**来自 Context API 取的 Pack；直查 `segments` / 向量库
   *   由**静态检查 + 运行时双重**拦截（V16 / `DIRECT_SEGMENT_ACCESS_FORBIDDEN`）。
   * ⚠ 候选态**不进证据库、不进报告、不进决策链**（I-24），**不混入人工打点计数**（I-25）。
   */
  createAiAnnotationCandidate: {
    method: "POST", path: "/recording/sessions/:sessionId/annotations/ai",
    in: z.object({
      sessionId: z.string(), contextPackId: z.string(), agentName: z.string(),
    }).strict(),
    out: z.object({
      annotationId: z.string(),
      origin: z.literal("ai"),
      state: z.literal("candidate"),
      agentName: z.string(),
      rationale: AnnotationRationale,
    }).strict(),
    err: [
      "CONTEXT_PACK_REQUIRED", "CONTEXT_PACK_NOT_REPLAYABLE", "DIRECT_SEGMENT_ACCESS_FORBIDDEN",
    ] as const,
  },

  /**
   * decideAiAnnotation —— 确认 / 编辑后确认 / 忽略。
   * ⚠ **忽略也留痕**（I-27）；依据片段被撤回后候选自动失效、**不可再确认**。
   */
  decideAiAnnotation: {
    method: "POST", path: "/recording/annotations/:annotationId/decision",
    in: z.object({
      annotationId: z.string(),
      decision: z.enum(["confirm", "edit-confirm", "ignore"]),
      edits: z.string().nullable(),
      reason: z.string().nullable(),
    }).strict(),
    out: z.object({
      annotationId: z.string(), state: AnnotationState, decisionId: z.string(),
    }).strict(),
    err: [
      "ANNOTATION_ALREADY_DECIDED", "ANNOTATION_RATIONALE_WITHDRAWN", "ANNOTATION_NOT_FOUND",
    ] as const,
  },

  /**
   * referenceEvidenceDownstream —— 下游引用一条打点 / 引述。
   * ⚠ `AI_ANNOTATION_NOT_CONFIRMED` 是 I-24 的**门**；
   *   `EVIDENCE_WITHDRAWN` 时标「证据已撤回」，**不静默删除**。
   */
  referenceEvidenceDownstream: {
    method: "POST", path: "/recording/evidence/references",
    in: z.object({
      annotationId: z.string().nullable(),
      quoteId: z.string().nullable(),
      consumer: EvidenceConsumer,
    }).strict(),
    out: z.object({ ok: z.literal(true), ref: z.string() }).strict(),
    err: ["AI_ANNOTATION_NOT_CONFIRMED", "EVIDENCE_WITHDRAWN"] as const,
  },

  /* ── 六、保留期与到期删除（uc-5-4）────────────────────────────── */

  /**
   * resolveRetention —— 解析生效的材料保留期。
   * ⚠ **一律读参数，不写常量**（I-32）。组织默认值缺失 ⇒ 拒绝，**不用隐含常量兜底**（E5 / I-33）。
   */
  resolveRetention: {
    method: "GET", path: "/recording/retention/resolve",
    in: z.object({ projectId: z.string(), orgId: z.string() }).strict(),
    out: RetentionResolution,
    err: ["RETENTION_POLICY_MISSING", "RETENTION_VALUE_OUT_OF_RANGE"] as const,
  },

  /**
   * freezeMaterialExpiry —— 材料落库并**固化**到期时间。
   * ⚠ 到期时间 = 落库时间 + 生效保留期，**在材料上固化**；事后改参数**不追溯**（I-31）。
   * ⚠ `trainingProhibited` 恒 true 且**必须能被下游转写与 AI 管线读取**——
   *   否则这个开关只是装饰。
   */
  freezeMaterialExpiry: {
    method: "POST", path: "/recording/materials/:materialId/expiry",
    in: z.object({
      materialId: z.string(),
      storedAt: z.string(),
      retentionResolution: RetentionResolution,
    }).strict(),
    out: z.object({
      materialId: z.string(),
      expiresAt: z.string(),
      resolvedFrom: RetentionResolvedFrom,
      resolvedDays: z.number().int().positive(),
      trainingProhibited: z.literal(true),
    }).strict(),
    err: ["EXPIRY_ALREADY_FROZEN", "RETENTION_POLICY_MISSING"] as const,
  },

  /**
   * runExpiryDeletion —— 到期删除（定时任务）。
   * ⚠ 先**逻辑失效**（退出检索、报告段落标「证据已撤回」）再**物理删除**。
   * ⚠ 删到**文件层**：音频 / `transcript.jsonl` / `notes.md` / 白板照片必须**真的消失**（I-35，跨束）。
   * ⚠ **不可删对象豁免**：快照、绑定关系、审计留痕不受触及（I-36）——
   *   与 phase-00 I-11 的冲突见 `KNOWN_CONTRACT_GAPS.C_REC_2`。
   * ⚠ 失败时材料**保持不可读**、告警重试、**不产出删除证明**（I-34 / E7）。
   */
  runExpiryDeletion: {
    method: "POST", path: "/recording/retention/expire",
    in: z.object({ asOf: z.string() }).strict(),
    out: z.object({
      logicallyDisabled: z.array(z.string()),
      physicallyDeleted: z.array(z.string()),
      certificates: z.array(z.object({
        materialId: z.string(), certificateId: z.string(),
      }).strict()),
    }).strict(),
    err: [
      "DELETION_TASK_FAILED", "OBJECT_STORE_UNAVAILABLE", "CASCADE_INVALIDATION_FAILED",
    ] as const,
  },

  /** getMaterialRetention —— 查询某份转写的保留期与删除时间。⚠ 界面缺口 [待定 D-11] */
  getMaterialRetention: {
    method: "GET", path: "/recording/materials/:materialId/retention",
    in: z.object({ materialId: z.string() }).strict(),
    out: z.object({
      expiresAt: z.string(),
      resolvedDays: z.number().int().positive(),
      resolvedFrom: RetentionResolvedFrom,
      trainingProhibited: z.boolean(),
      deletionCertificateId: z.string().nullable(),
    }).strict(),
    err: ["MATERIAL_NOT_FOUND", "NO_PROJECT_ROLE"] as const,
  },

  /* ── 七、同意书渲染（uc-5-4 R3-3 · 消费方在 interview 束）──────── */

  /**
   * renderConsentText —— 渲染同意书文案。
   * ⚠ **禁止硬编码任何天数**。任一模板变量缺失 ⇒ **不得发出授权链接**（I-39 / E6）——
   *   发一份告知不完整的同意书**比不发更糟**。
   */
  renderConsentText: {
    method: "POST", path: "/recording/consent/render",
    in: z.object({ projectId: z.string(), templateId: z.string() }).strict(),
    out: z.object({
      renderedText: z.string(),
      /** 四个渲染变量，缺一即 `CONSENT_TEMPLATE_VARIABLE_MISSING` */
      variables: z.object({
        retentionDays: z.number().int().positive(),
        dataController: z.string(),
        contactName: z.string(),
        complianceEmail: z.string(),
      }).strict(),
    }).strict(),
    err: [
      "CONSENT_TEMPLATE_VARIABLE_MISSING", "RETENTION_POLICY_MISSING", "TEMPLATE_NOT_FOUND",
    ] as const,
  },

  /**
   * freezeConsentSnapshot —— 固化已提交同意书的渲染快照。
   * ⚠ 试图回溯改写已提交快照 ⇒ `CONSENT_SNAPSHOT_IMMUTABLE`（I-38）。
   *   受访者当时看到的那份字，事后**任何人都不能改**——包括「把 180 天改成新值」这种善意修正。
   */
  freezeConsentSnapshot: {
    method: "POST", path: "/recording/consent/:consentId/snapshot",
    in: z.object({
      consentId: z.string(),
      renderedText: z.string(),
      variables: z.object({
        retentionDays: z.number().int().positive(),
        dataController: z.string(),
        contactName: z.string(),
        complianceEmail: z.string(),
      }).strict(),
    }).strict(),
    out: z.object({
      instanceId: z.string(), contentHash: z.string(), submittedAt: z.string(),
    }).strict(),
    err: ["CONSENT_SNAPSHOT_IMMUTABLE", "CONSENT_NOT_SUBMITTED"] as const,
  },
} as const;

export type Operations = typeof operations;
export type OperationName = keyof Operations;

/* ────────────── 跨束「同码同义」的编译期门控（硬要求 ②）────────────── */

type PermissionReasonT = z.infer<typeof PermissionReason>;
type ArtifactErrorT = z.infer<typeof ArtifactError>;
type ContextPackReasonT = z.infer<typeof ContextPackReason>;
type RecordingErrorT = z.infer<typeof RecordingError>;

/**
 * **同名即同义，且由 `tsc` 守着。**
 *
 * 交集类型 `(A & B)[]` 的成员只能是**两侧都存在**的字面量。
 * 任何一侧改名/删除，这里立刻编译失败——而不是等到联调时两个服务各自返回一半的码。
 * 这是本仓「同一事实不得声明在两处」的机械落点：副本允许存在，漂移不允许。
 */
export const RECORDING_SHARED_WITH_IDENTITY = [
  "NO_PROJECT_ROLE",
] as const satisfies readonly (PermissionReasonT & RecordingErrorT)[];

export const RECORDING_SHARED_WITH_ARTIFACT = [
  "SNAPSHOT_IMMUTABLE",
] as const satisfies readonly (ArtifactErrorT & RecordingErrorT)[];

export const RECORDING_SHARED_WITH_CONTEXT_PACK = [
  "ANCHOR_MISSING",
  "PERMISSION_REVOKED_MIDWAY",
] as const satisfies readonly (ContextPackReasonT & RecordingErrorT)[];

/* ─────────────────────── 已知契约缺陷（如实登记）─────────────────────── */

/**
 * 已知契约缺陷。与 `auth` / `identity` 束同一约定：
 * **写下来的洞是可以被下一个人看见的洞，被顺手补上的洞会变成没人评审过的第二份契约。**
 */
export const KNOWN_CONTRACT_GAPS = {
  /**
   * **`getConsentMatrix` 是本束替 UC 补的端口，不在 `usecases.md` 里。**
   *
   * `usecases.md` 定义了 `CONSENT_NOT_COMPLETED`（任一 `pending` 即拒绝开始），
   * 却没有任何端口能读出**矩阵本身**。于是界面要渲染「谁的哪一项还没到、去催谁」
   * 只有两条路：前端自己从别处拼（第二份判据），或者干脆只显示一句「授权未完成」
   * （用户不知道该找谁）。
   *
   * 本束取第三条：**补一个只读端口，并把它标出来**。形状（`cells` + `blocksStart`）
   * 是推断的，`blocksStart` 与「存在任一 pending」的等价关系是本束写的，不是 UC 写的。
   * 需人类在签核时确认；若不认可，删掉本端口而**保留** `CONSENT_NOT_COMPLETED`
   * 并另行指明界面的数据来源。
   */
  C_REC_1: "getConsentMatrix is an inferred read port; usecases.md defines the gate but no way to render it",

  /**
   * 🔴 **保留期到期删除 与 phase-00 已签的 I-11「快照不可删」正面冲突。未解，不自行裁决。**
   *
   * · 本束 `runExpiryDeletion` 的 I-35 要求删到**文件层**：音频 / `transcript.jsonl` /
   *   `notes.md` / 白板照片「必须**真的消失**」。
   * · phase-00 `artifact` I-11 要求固定快照**不可删、不可改、不可降级**，
   *   `tests/no-forbidden-routes.test.ts` 已把 `DELETE /artifacts/:id/versions` 写成禁止路由。
   * · 本束 I-36 写了「不可删对象豁免：快照、绑定关系、审计留痕不受触及」——
   *   **但那不是解，那是把冲突改写成了两句都对的话**：一份被定版引用的录音，
   *   到期时它同时是「必须真的消失的材料」与「不受触及的快照」。
   *
   * 三种可能的裁法（**都需要人类签核，本束不选**）：
   *   ① 快照优先：被引用过的材料永不到期删除 ⇒ 「180 天后消失」对受访者是**假承诺**
   *   ② 删除优先：物理删除 + 快照转墓碑（保留 hash 与元数据，内容不可读）
   *      ⇒ 需要 artifact 束新增墓碑态，是跨束契约变更
   *   ③ 分层：只有「法定留存清单」内的材料豁免 ⇒ 依赖 `thresholds.legalHoldCategories`
   *      （🔴 已登记为真阻塞项，值未定）
   *
   * ⇒ 在裁决落地前，`runExpiryDeletion` 的 `physicallyDeleted` 对**被快照引用的材料**
   *   行为未定义。实现方**不得**自选一种当验收线。
   */
  C_REC_2: "retention-expiry physical deletion vs phase-00 artifact I-11 immutable-snapshot: DIRECT CONFLICT, unresolved",

  /**
   * **三个枚举的封闭性表达不出来**（domain D-7 / D-8 / D-9）。
   *
   * `SegmentStatus.disputed` / `EvidenceNature` / 人工打点的 `kind`：
   * zod 能写 `z.enum([...])`，写不了「这个枚举是封闭的，新增必须走 ADR」。
   * 尤其 `disputed` 在原型档案里 **0 命中**——它是实现者替 UC 做的决定（ui-preview S-16），
   * 而 `SEGMENT_DISPUTED_NOT_CITABLE` 已经依赖它。裁定它不成立时**两处要一起删**。
   *
   * ⚠ 人工打点的 `kind` 目前是 `z.string()` 而不是枚举——`ANNOTATION_KIND_INVALID`
   * 因此在契约层**不可达**（任何字符串都合法），只能由应用层判。这是 `.strict()`
   * 挡不住的方向：strict 挡多余字段，不挡开放取值。
   */
  C_REC_3: "closedness of SegmentStatus.disputed / EvidenceNature / annotation kind is unassertable; annotation kind is an open string",

  /**
   * **数值阈值三项契约表达不了**（DER 混淆率 / 重叠漏检率 / 低置信触发阈值）。
   *
   * 契约只能表达「命中即挂 `lowConfidence`」，表达不了「多少算命中」。
   * O-13 已裁为非阻断，实现方**不得**自选一个数当验收线。
   * 同理：加密密钥策略（`keyRef` 轮换/托管/权限）与删除证明的格式签名，
   * 前者是部署形态不是 API 形状，后者缺合规输入——契约现在只能断言「有/无」。
   */
  C_REC_4: "numeric thresholds (DER / overlap-miss / low-confidence) and deletion-certificate format are out of contract's expressive range",

  /**
   * **「显式变更审批 + 通知受访者」流程没有归属束。**
   *
   * uc-5-4 R3-2 说追溯调整保留期须走显式变更审批并通知受访者，但没说它落在哪个模块。
   * 本束**没有**为它开端口——开了就等于替产品决定了它归 recording，而它更像 org-admin
   * 或 17-gov 的东西。⇒ 目前**没有任何束提供这条路径**，追溯调整在系统里无路可走。
   */
  C_REC_5: "the 'explicit change approval + notify subjects' flow for retroactive retention changes has no owning bundle",
} as const;
