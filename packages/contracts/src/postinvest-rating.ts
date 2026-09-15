/**
 * 契约束 `postinvest-rating` —— ③ API 契约（**唯一事实源**，ADR-020 / ADR-023）。Phase 16 F02。
 *
 * ## 签核来源
 * 翻译自 `phases/phase-16-postinvest-rating-agent/requirements/01-postinvest-rating-agent.md`
 * 的 R3 / R4 / R5 / R7 / R10 / R12，不发挥。束目录
 * `phases/phase-16-postinvest-rating-agent/contracts/postinvest-rating/design-signoff.md`
 * **未签核（status: pending，待人类）**——本文件是签核第 ③ 件的材料，不是签核本身。
 *
 * ## 唯一事实源 / 不许复述数值（R7-1）
 * S1/S2/S3 口径、总分公式、A–E 区间、每一档的颜色 token / 含义 / 投后管理建议、两条降级触发、
 * 数据质量处理表的阈值，**只**存在于 `skills/standard-finance/postinvest-rating/` 包内
 * （规则文档 + 确定性脚本 + 固定用例；PDF v1.0 是导入来源，包内 `PROVENANCE` 记录）。
 * 本契约只承载**枚举与形状**：`RatingGrade` 是五档的名字，`RatingGradeMeta` 是 API
 * 把「skill 包分级表里那一行」原样带回给前端的形状——前端不得另写一份颜色 / 文案映射
 * （R8 `rating-result-card` 明说「颜色 token 从 skill 包读取」）。本文件里出现任何一个
 * 分数阈值、比率阈值或分级文案，都是第二份事实源，一律视为违规。
 *
 * ## 本束编码的已定决定（R10，2026-09-15 人类采纳）
 * - **D1** 入口 `/agent/team2`：本契约不定义页面路由，工作台通过下面的 HTTP 操作取数；
 *   run 的创建 / 事件流 / 取消复用 `agent-runtime` / `streaming-transport` / `run-control`，
 *   本束只新增「评级记录」这一层业务实体与其操作，**不新开第二条执行链路**。
 * - **D2** 可信渠道白名单：组织级配置，种子值是本文件的 `TRUSTED_SOURCE_SEED_DOMAINS`
 *   （管理员可增删）；匹配规则 = 域名**精确 / 子域**匹配，不做路径级规则（`domains` 元素
 *   只允许裸域名，见 `TrustedSourceDomain`）。被评公司官网按项目登记，不在种子里。
 * - **D3** 偏差阈值（等级一致或差一级）是试点验收口径，不进契约——验收只断言机制。
 * - **D4** skill 包位置 `skills/standard-finance/postinvest-rating/`：`ScoreBreakdown.scriptVersion`
 *   与 `PostinvestRatingRecord.inputFiles[].sha256` 一起构成可复现性（R9「任何版本可原样重跑」）。
 * - **D5** 录音走 `files.ts` 的 `uploadArtifact` 原件上传，**不扩** `chat-file-upload` 白名单：
 *   `createRatingRun.in.inputFileIds` 统一收 artifact / attachment id，`inputFiles[].kind`
 *   由服务端识别；录音若误走聊天上传路径回 `AUDIO_NOT_ALLOWED_IN_CHAT_UPLOAD`。
 *
 * ## 与相邻束的边界
 * - HITL 降级确认（R3-11）：中断机制是 `deep-agent-hitl` 束（LangGraph `interrupt()`），
 *   本束只定义**这一种**确认的裁决入口 `decideRatingHitl`（approve / reject + 说明）。
 * - 沙箱失败码 `SCRIPT_FAILED_AFTER_RETRIES` / `SANDBOX_TIMEOUT` / `SANDBOX_UNAVAILABLE`
 *   的语义在 `skills.ts`（F962）已定义，本束在 `err` 里**引用同名值**表示 run 以该码进入
 *   `failed` 终态（R4 E3：不允许 LLM 心算补分）。
 * - 组织角色沿用 `identity.ts` 的 `OrgRole`（R5），本束不再定义角色枚举。
 */
import { z } from "zod";

/* ── 一、评级等级与分级表投影（R3-11、R7-1）──────────────────────────────── */

/** A–E 五档的**名字**。区间与含义在 skill 包里；这里只保证封闭性。 */
export const RatingGrade = z.enum(["A", "B", "C", "D", "E"]);
export type RatingGrade = z.infer<typeof RatingGrade>;

/**
 * API 回给前端的「分级表那一行」。四个字段逐字来自 skill 包（R12「结论卡四个字段与
 * skill 包分级表逐字一致」），本契约只约束它们**非空**，不约束内容。
 */
export const RatingGradeMeta = z
  .object({
    grade: RatingGrade,
    /** 设计 token 名（如 `rating.grade.a`），不是色值——色值在 skill 包 / 设计 token 单源。 */
    colorToken: z.string().min(1),
    /** 分级表「含义」列原文。 */
    meaning: z.string().min(1),
    /** 分级表「投后管理建议」列原文。 */
    advice: z.string().min(1),
  })
  .strict();
export type RatingGradeMeta = z.infer<typeof RatingGradeMeta>;

/* ── 二、数据质量标注 / 缺失原因 / 反馈类型（R3-3、R3-7、R3-13）────────────── */

/**
 * PDF「一、数据质量」表的标注集合（可多选）：
 * normal=正常 · incomplete=数据不完整 · estimated=数据暂估 ·
 * business_abnormal=公司经营异常（直接 E，需 HITL 确认） · suspected_abnormal=数据疑似异常（不降级）。
 * 触发阈值只在 skill 包里。
 */
export const DataQualityFlag = z.enum([
  "normal",
  "incomplete",
  "estimated",
  "business_abnormal",
  "suspected_abnormal",
]);
export type DataQualityFlag = z.infer<typeof DataQualityFlag>;

/**
 * 「数据缺失说明」表单的原因码（R3-3，人工确认事实，Agent 不得自行推断——R7-5）：
 * confidentiality_period=保密期（上市/并购） · relationship_broken=关系交恶 ·
 * major_litigation=重大诉讼 · lost_contact=失联 · suspended=停业 · bankrupt=破产 · other=其他（自由文本）。
 * 哪些码算「正常原因」/「异常原因」（R4 A1 的分支）由 skill 包的数据质量表决定，契约不分类。
 */
export const MissingDataReasonCode = z.enum([
  "confidentiality_period",
  "relationship_broken",
  "major_litigation",
  "lost_contact",
  "suspended",
  "bankrupt",
  "other",
]);
export type MissingDataReasonCode = z.infer<typeof MissingDataReasonCode>;

/** 表单整体：原因码（可多选）+ 自由文本 + 三个勾选（仅单体报表 / 仅经营报告 / 无上年对比）。 */
export const MissingDataReason = z
  .object({
    reasons: z.array(MissingDataReasonCode),
    /** 选了 `other` 时的说明；其余情况可省略。是否必填由应用层按 `reasons` 判，契约不用 refine（mock 生成器不吃 ZodEffects）。 */
    otherText: z.string().optional(),
    /** 仅有单体报表（R4 A3 → `incomplete`）。 */
    standaloneOnly: z.boolean(),
    /** 仅有经营报告（R4 A3 → `incomplete`）。 */
    operatingReportOnly: z.boolean(),
    /** 无上年对比数据（R4 A2 → 增长类按体量基础分）。 */
    noPriorYear: z.boolean(),
  })
  .strict();
export type MissingDataReason = z.infer<typeof MissingDataReason>;

/**
 * 反馈错误类型（R3-13 单选、必填）：
 * calc_error=明确算错 · mapping_error=对标错（字段抽取 / 口径映射） ·
 * misunderstanding=信息误解（转录 / 文档理解） · missing_info=信息缺失（补充新材料） ·
 * subjective=主观偏差（仅与印象不符）。
 * R7-6 铁律：`subjective` 只记录、不重算、不改规则、不改权重；其余四类必须重算并生成新版本。
 */
export const FeedbackType = z.enum([
  "calc_error",
  "mapping_error",
  "misunderstanding",
  "missing_info",
  "subjective",
]);
export type FeedbackType = z.infer<typeof FeedbackType>;

/** R7-6 的机械表达：`submitFeedback` 对这个类型的唯一合法 `outcome` 是 `recorded_only`。 */
export const RECORD_ONLY_FEEDBACK_TYPE: FeedbackType = "subjective";

/** `submitFeedback` 的分流结果。 */
export const FeedbackOutcome = z.enum(["recorded_only", "rerun_started"]);
export type FeedbackOutcome = z.infer<typeof FeedbackOutcome>;

/* ── 三、评级记录实体（R1「本用例结果」、R3-15/16、R7-7、R9 可复现）───────── */

/** `draft → confirmed` 单向；`confirmed` 不可逆（R7-7），再评只能新开版本。 */
export const RatingRecordStatus = z.enum(["draft", "confirmed"]);
export type RatingRecordStatus = z.infer<typeof RatingRecordStatus>;

/** 序列图三阶段（R3）：供给（人）→ 处理（Agent）→ 复核（人+Agent）。运行细粒度状态在 `streaming-transport` 束。 */
export const RatingRunPhase = z.enum(["supply", "processing", "review"]);
export type RatingRunPhase = z.infer<typeof RatingRunPhase>;

/** 依据行参与哪个分项；`quality` = 只用于数据质量判定；`none` = 仅定性佐证（如转录稿原句）。 */
export const ScoreComponent = z.enum(["S1", "S2", "S3", "quality", "none"]);
export type ScoreComponent = z.infer<typeof ScoreComponent>;

/**
 * 依据表的一行（R3-6「字段来源表」、R7-3 缺失记 `null` 不填零、R7-4 每个数值都有来源）。
 * `sourceLocator` 只能是实际读到的章节标题 / 表头 / 行标识 / 转录稿原句，或
 * `wx_document_parse` `structure.json` 给出的表格坐标——不得编造页码 / 单元格地址。
 */
export const EvidenceRow = z
  .object({
    field: z.string().min(1),
    /** 缺失 = `null`，绝不填零（零与缺失在报告里必须可区分）。 */
    value: z.number().nullable(),
    /** 统一后的单位（清洗后为「元」；比率类按脚本输出）。 */
    unit: z.string().min(1),
    sourceFileId: z.string().min(1),
    sourceLocator: z.string().min(1),
    scoreComponent: ScoreComponent,
  })
  .strict();
export type EvidenceRow = z.infer<typeof EvidenceRow>;

/**
 * 确定性脚本的输出投影（R3-8、R7-2）。`intermediates` 承载脚本每一步中间量
 * （体量档、增长率对数得分、现金自给月数……键名由脚本定义，契约不枚举——枚举了就是第二份口径）。
 */
export const ScoreBreakdown = z
  .object({
    s1: z.number().nullable(),
    s2: z.number().nullable(),
    s3: z.number().nullable(),
    total: z.number().nullable(),
    intermediates: z.record(z.string(), z.number().nullable()),
    /** skill 包脚本版本；与输入 SHA256 一起构成可复现性（R9）。 */
    scriptVersion: z.string().min(1),
  })
  .strict();
export type ScoreBreakdown = z.infer<typeof ScoreBreakdown>;

/** 服务端识别到的输入类型（R3-2 回显）。 */
export const RatingInputFileKind = z.enum(["statement", "audit_report", "recording", "unknown"]);
export type RatingInputFileKind = z.infer<typeof RatingInputFileKind>;

export const RatingInputFile = z
  .object({
    fileId: z.string().min(1),
    filename: z.string().min(1),
    /** 原件 SHA-256（十六进制小写）。 */
    sha256: z.string().regex(/^[0-9a-f]{64}$/),
    kind: RatingInputFileKind,
  })
  .strict();
export type RatingInputFile = z.infer<typeof RatingInputFile>;

/** 报告产物种类（R3-11）：pdf=评级报告 · xlsx=指标与得分明细 · png=趋势图。 */
export const RatingReportKind = z.enum(["pdf", "xlsx", "png"]);
export type RatingReportKind = z.infer<typeof RatingReportKind>;

export const RatingReport = z
  .object({
    artifactId: z.string().min(1),
    kind: RatingReportKind,
    /** R4 E9：生成成功但读取校验失败 ⇒ `false`，前端标「未验证」且不显示为可下载。 */
    verified: z.boolean(),
  })
  .strict();
export type RatingReport = z.infer<typeof RatingReport>;

/** 修正历史的一条（R3-15；同一内容另写入组织记忆，本契约不描述记忆侧形状）。 */
export const RatingCorrection = z
  .object({
    feedbackId: z.string().min(1),
    type: FeedbackType,
    /** 修正前后值：文本快照（数值 / 口径 / 等级都可能变，统一为字符串，`null` = 该侧无值）。 */
    before: z.string().nullable(),
    after: z.string().nullable(),
    basis: z.string().min(1),
    createdAt: z.string(),
  })
  .strict();
export type RatingCorrection = z.infer<typeof RatingCorrection>;

export const PostinvestRatingRecord = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1),
    /** 同一项目内从 1 起递增；反馈重算 +1，旧版本只读保留（R3-15、R4 A5）。 */
    version: z.number().int().min(1),
    status: RatingRecordStatus,
    /** 无法评级（R4 A1：无财务报表）时为 `null`；此时 `scores.total` 亦为 `null`。 */
    grade: RatingGrade.nullable(),
    gradeMeta: RatingGradeMeta.nullable(),
    flags: z.array(DataQualityFlag),
    scores: ScoreBreakdown,
    evidence: z.array(EvidenceRow),
    /** 不确定性 Tab 的条目：缺失字段、估算项、解析警告、「首次评级，无趋势判断」等。 */
    uncertainties: z.array(z.string()),
    /** R7-9：丢弃的非白名单来源条数（A7 未配置白名单 / 未检索时为 0）。 */
    discardedOffWhitelistCount: z.number().int().nonnegative(),
    inputFiles: z.array(RatingInputFile),
    reports: z.array(RatingReport),
    /** 产生本版本的 agent run（`agent-runtime` 束）。 */
    runId: z.string().min(1),
    createdAt: z.string(),
    confirmedBy: z.string().min(1).optional(),
    confirmedAt: z.string().optional(),
    corrections: z.array(RatingCorrection),
  })
  .strict();
export type PostinvestRatingRecord = z.infer<typeof PostinvestRatingRecord>;

/* ── 四、可信渠道白名单（R3-10、R7-9、D2）──────────────────────────────── */

/**
 * 白名单元素：裸域名（小写，无协议 / 路径 / 端口 / 通配符）。匹配 = 精确或子域
 * （`ir.example.com` 命中 `example.com`）。写入不合规 ⇒ `WHITELIST_INVALID_DOMAIN`。
 */
export const TrustedSourceDomain = z
  .string()
  .min(1)
  .regex(/^(?=.{1,253}$)(?!-)[a-z0-9-]+(?<!-)(\.(?!-)[a-z0-9-]+(?<!-))+$/);
export type TrustedSourceDomain = z.infer<typeof TrustedSourceDomain>;

/** D2 种子清单（组织初始化时写入；管理员可增删）。被评公司官网按项目登记，不在此列。 */
export const TRUSTED_SOURCE_SEED_DOMAINS = [
  "cninfo.com.cn", // 巨潮资讯
  "sse.com.cn", // 上交所
  "szse.cn", // 深交所
  "bse.cn", // 北交所
  "hkexnews.hk", // 港交所披露易
  "csrc.gov.cn", // 证监会
  "gsxt.gov.cn", // 国家企业信用信息公示系统
  "stats.gov.cn", // 国家统计局
] as const;

export const TrustedSourceWhitelist = z
  .object({
    domains: z.array(TrustedSourceDomain),
    /** 最近一次修改者；仅有种子、从未被管理员改过时为 `null`。 */
    updatedBy: z.string().min(1).nullable(),
    updatedAt: z.string(),
  })
  .strict();
export type TrustedSourceWhitelist = z.infer<typeof TrustedSourceWhitelist>;

/* ── 五、失败面（穷举；R4 E1–E9、R5）────────────────────────────────────── */

export const PostinvestRatingError = z.enum([
  /** R5 / E8：非项目成员或组织角色不允许该动作（compliance 只读、admin 不能采纳以外的写）。 */
  "NO_PROJECT_ROLE",
  /** R2 / E8：所属组织看不到「海创汇」入口（`isAgentsNavVisibleForOrg`）；控制器对外裸 404。 */
  "ORG_NOT_ELIGIBLE",
  "RECORD_NOT_FOUND",
  /** R7-7：`confirmed` 不可逆——再确认 / 再反馈都拒。 */
  "RECORD_ALREADY_CONFIRMED",
  /** R5「管理员不是超级用户」：admin 不能替项目成员点采纳。 */
  "ADMIN_CANNOT_CONFIRM",
  /** R4 A1：只有录音没有报表——本操作层面的拒绝面；服务端也可选择接受并出「数据需求说明」记录。 */
  "NO_FINANCIAL_STATEMENT",
  /** R4 E1：`wx_document_parse` 失败且关键字段全部来自失败文件。 */
  "PARSE_FAILED",
  /** R4 E3：与 `skills.ts` 同名值——评分脚本非零退出，run `failed`，不心算补分。 */
  "SCRIPT_FAILED_AFTER_RETRIES",
  "SANDBOX_TIMEOUT",
  "SANDBOX_UNAVAILABLE",
  /** R4 E4：`deep-agent-service` 不可用（与 `kernel-gateway.ts` 同名值）。 */
  "KERNEL_UNAVAILABLE",
  /** `decideRatingHitl`：run 当前不在等待降级 / 本期上期确认。 */
  "RUN_NOT_AWAITING_HITL",
  /** D2：不是裸域名（带协议 / 路径 / 通配符 / 大写）。 */
  "WHITELIST_INVALID_DOMAIN",
  /** R3-13：错误类型是单选必填，缺了不收。 */
  "FEEDBACK_TYPE_REQUIRED",
  /** D5：录音不走 `chat-file-upload`，误投时明确拒绝并指向 `files.uploadArtifact`。 */
  "AUDIO_NOT_ALLOWED_IN_CHAT_UPLOAD",
]);
export type PostinvestRatingError = z.infer<typeof PostinvestRatingError>;

/* ── 六、操作入参 / 出参 ──────────────────────────────────────────────── */

/**
 * 创建一次评级 run（R3-1 ~ R3-4）。`projectId` 与 `newProjectName` 二选一：
 * 后者只有组织 `lead` 可用（R5「只有 lead 能建项目」）；两者皆无 / 皆有由应用层拒绝
 * （不用 refine：mock 生成器不吃 ZodEffects）。
 */
export const CreateRatingRunInput = z
  .object({
    projectId: z.string().min(1).optional(),
    newProjectName: z.string().min(1).optional(),
    /** 报表 / 报告的 attachment id 与录音的 artifact id 混装；服务端按来源识别 `kind`。 */
    inputFileIds: z.array(z.string().min(1)),
    missingData: MissingDataReason,
  })
  .strict();
export type CreateRatingRunInput = z.infer<typeof CreateRatingRunInput>;

export const CreateRatingRunOutput = z
  .object({
    runId: z.string().min(1),
    /** 创建即占位一条 `draft` 记录（版本号已分配），页面据此在 A6 回来时恢复。 */
    recordId: z.string().min(1),
  })
  .strict();
export type CreateRatingRunOutput = z.infer<typeof CreateRatingRunOutput>;

export const GetRatingRecordInput = z.object({ recordId: z.string().min(1) }).strict();
export type GetRatingRecordInput = z.infer<typeof GetRatingRecordInput>;

export const ListRatingRecordsInput = z
  .object({
    projectId: z.string().min(1),
  })
  .strict();
export type ListRatingRecordsInput = z.infer<typeof ListRatingRecordsInput>;

/** 版本链（R8 `rating-version-list`），按 `version` 升序，每项是完整记录。 */
export const ListRatingRecordsOutput = z
  .object({
    projectId: z.string().min(1),
    versions: z.array(PostinvestRatingRecord),
  })
  .strict();
export type ListRatingRecordsOutput = z.infer<typeof ListRatingRecordsOutput>;

export const SubmitRatingFeedbackInput = z
  .object({
    recordId: z.string().min(1),
    /** 针对依据表第几行（0 起）；对整体结论的反馈省略。 */
    evidenceRowIndex: z.number().int().nonnegative().optional(),
    type: FeedbackType,
    basis: z.string().min(1),
    /** 「信息缺失」类可附新材料。 */
    attachmentFileIds: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type SubmitRatingFeedbackInput = z.infer<typeof SubmitRatingFeedbackInput>;

/**
 * `outcome` 与 `type` 的对应是 R7-6 铁律：`subjective` ⇒ `recorded_only` 且无 `newRecordId`；
 * 其余四类 ⇒ `rerun_started` 且 `newRecordId` 指向版本 +1 的新 `draft`（E7：即使结论未变也新建）。
 * 这条跨字段不变量由应用层保证并在测试里断言（`tests/postinvest-rating.test.ts`）。
 */
export const SubmitRatingFeedbackOutput = z
  .object({
    feedbackId: z.string().min(1),
    outcome: FeedbackOutcome,
    newRecordId: z.string().min(1).optional(),
  })
  .strict();
export type SubmitRatingFeedbackOutput = z.infer<typeof SubmitRatingFeedbackOutput>;

export const ConfirmRatingRecordInput = z.object({ recordId: z.string().min(1) }).strict();
export type ConfirmRatingRecordInput = z.infer<typeof ConfirmRatingRecordInput>;

export const UpdateTrustedSourceWhitelistInput = z
  .object({
    /** 全量替换（管理员编辑面小，不做增量 diff）。 */
    domains: z.array(TrustedSourceDomain),
  })
  .strict();
export type UpdateTrustedSourceWhitelistInput = z.infer<typeof UpdateTrustedSourceWhitelistInput>;

/** HITL 关卡的裁决（R3-11 降级 / 直接 E 确认；R4 A4 本期上期指定也走同一入口）。 */
export const RatingHitlDecision = z.enum(["approve", "reject"]);
export type RatingHitlDecision = z.infer<typeof RatingHitlDecision>;

export const DecideRatingHitlInput = z
  .object({
    runId: z.string().min(1),
    decision: RatingHitlDecision,
    /** 用户说明（驳回时尤其需要：为什么触发依据不属实）。 */
    note: z.string().optional(),
  })
  .strict();
export type DecideRatingHitlInput = z.infer<typeof DecideRatingHitlInput>;

/* ── 七、操作 ──────────────────────────────────────────────────────────── */

export const operations = {
  createRatingRun: {
    method: "POST",
    path: "/postinvest-ratings/runs",
    in: CreateRatingRunInput,
    out: CreateRatingRunOutput,
    err: [
      "NO_PROJECT_ROLE",
      "ORG_NOT_ELIGIBLE",
      "NO_FINANCIAL_STATEMENT",
      "AUDIO_NOT_ALLOWED_IN_CHAT_UPLOAD",
      "KERNEL_UNAVAILABLE",
      "SANDBOX_UNAVAILABLE",
    ] as const,
  },
  getRatingRecord: {
    method: "GET",
    path: "/postinvest-ratings/records/:recordId",
    in: GetRatingRecordInput,
    out: PostinvestRatingRecord,
    err: ["NO_PROJECT_ROLE", "ORG_NOT_ELIGIBLE", "RECORD_NOT_FOUND"] as const,
  },
  listRatingRecords: {
    method: "GET",
    path: "/postinvest-ratings/records",
    in: ListRatingRecordsInput,
    out: ListRatingRecordsOutput,
    err: ["NO_PROJECT_ROLE", "ORG_NOT_ELIGIBLE"] as const,
  },
  /**
   * 反馈分流（R3-13/14/15）。重算失败面（`PARSE_FAILED` / 沙箱三码 / `KERNEL_UNAVAILABLE`）
   * 出现在这里而不是 `createRatingRun`，因为重算是同步启动的新 run，而首评的失败在
   * run 事件流里呈现（`streaming-transport` 束）。
   */
  submitFeedback: {
    method: "POST",
    path: "/postinvest-ratings/records/:recordId/feedback",
    in: SubmitRatingFeedbackInput,
    out: SubmitRatingFeedbackOutput,
    err: [
      "NO_PROJECT_ROLE",
      "ORG_NOT_ELIGIBLE",
      "RECORD_NOT_FOUND",
      "RECORD_ALREADY_CONFIRMED",
      "FEEDBACK_TYPE_REQUIRED",
      "PARSE_FAILED",
      "SCRIPT_FAILED_AFTER_RETRIES",
      "SANDBOX_TIMEOUT",
      "SANDBOX_UNAVAILABLE",
      "KERNEL_UNAVAILABLE",
    ] as const,
  },
  /** `draft → confirmed`，不可逆（R3-16、R7-7）；admin 不能代点（R5）。 */
  confirmRatingRecord: {
    method: "POST",
    path: "/postinvest-ratings/records/:recordId/confirm",
    in: ConfirmRatingRecordInput,
    out: PostinvestRatingRecord,
    err: [
      "NO_PROJECT_ROLE",
      "ORG_NOT_ELIGIBLE",
      "RECORD_NOT_FOUND",
      "RECORD_ALREADY_CONFIRMED",
      "ADMIN_CANNOT_CONFIRM",
    ] as const,
  },
  getTrustedSourceWhitelist: {
    method: "GET",
    path: "/postinvest-ratings/trusted-sources",
    in: z.object({}).strict(),
    out: TrustedSourceWhitelist,
    err: ["NO_PROJECT_ROLE", "ORG_NOT_ELIGIBLE"] as const,
  },
  /** 组织 admin 专用（R5）；非 admin 与其它写权不足统一 `NO_PROJECT_ROLE`。 */
  updateTrustedSourceWhitelist: {
    method: "PUT",
    path: "/postinvest-ratings/trusted-sources",
    in: UpdateTrustedSourceWhitelistInput,
    out: TrustedSourceWhitelist,
    err: ["NO_PROJECT_ROLE", "ORG_NOT_ELIGIBLE", "WHITELIST_INVALID_DOMAIN"] as const,
  },
  decideRatingHitl: {
    method: "POST",
    path: "/postinvest-ratings/runs/:runId/hitl-decision",
    in: DecideRatingHitlInput,
    out: z.object({ runId: z.string().min(1), decision: RatingHitlDecision }).strict(),
    err: ["NO_PROJECT_ROLE", "ORG_NOT_ELIGIBLE", "RUN_NOT_AWAITING_HITL", "KERNEL_UNAVAILABLE"] as const,
  },
} as const;
