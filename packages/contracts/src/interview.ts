/**
 * 契约束 `interview` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西（后端 DTO / 前端类型 / OpenAPI / mock），任何一样都不许手写第二份。
 *
 * 覆盖 feature：F80–F99（phase-01，20 个）
 * 依据 UC：`uc-6-0`（范围与列表）· `uc-6-1`（模板）· `uc-6-2`（研究设计）
 *         · `uc-6-3`（受访者授权）· `uc-6-4`（现场）· `uc-6-5`（回流成洞察）
 *         · `uc-6-6`（自助门户）· `uc-6-7`（访谈对象表）
 * 领域不变量见 `phases/phase-01-run-a-project/contracts/interview/domain.md` 的 `I-n`。
 *
 * ## 主线（人类 2026-07-30 亲自纠正过一次）
 * 访谈模板创建 → 套用模板新建访谈 → 质性访谈 / **虚拟用户画像推演访谈**
 *   → 报告模板 → 洞察报告
 *
 * ## 两条最容易搞错的事
 *
 * ⚠ **访谈没有引导师/组长。** 它的角色是**研究员 / 受访者 / 观察者**一类
 *   （见 `SessionRole`），**不要套工作坊四角色**（`identity.ProjectRole` 的
 *   `facilitator` / `groupLead` / `member` / `observer`）。本文件因此**不 import**
 *   `ProjectRole`——不给下一个人「顺手复用一下」的机会。
 *
 * ⚠ **虚拟来源必须与真人来源可区分，且只有真人来源能把洞察标「强」**（I-28）。
 *   这不是按钮置灰，是**接口层拒绝**（`VIRTUAL_SOURCE_FORBIDDEN`）。
 *   列表的 `counts` 也因此是**两个独立字段**而不是一个总数（D-25 / V5）。
 *
 * 访谈属**用户洞察**类容器，与工作坊**平级**（Q-12 裁 C）——不是工作坊的子流程。
 */
import { z } from "zod";
import { ConsentItemKey, ConsentBits as SharedConsentBits } from "./consent-item";
import { ArtifactError } from "./artifact";
import { ContextPackReason } from "./context-pack";
import { OmissionReasonSchema } from "./context-pack";

/* ─────────────────────────── 枚举（对应 domain.md）─────────────────────────── */

/**
 * 访谈来源。**这是本束最硬的一条分界线**（I-28）。
 * · `human`   —— 真人受访者。**只有它能支撑「强」洞察、能进决策依据**
 * · `virtual` —— 虚拟用户画像推演访谈。是主线的一等公民（推演也要做），
 *                但它**不是证据**：标强 / 进决策依据一律接口层拒绝
 */
export const InterviewSourceKind = z.enum(["human", "virtual"]);

/**
 * 本场角色。**⚠ 不是 `identity.ProjectRole`**——访谈里**没有引导师、没有组长**。
 *
 * · `researcher`   —— 主持本场的研究员（`coResearcher` 可改，最终确认权归 `researcher`）
 * · `coResearcher` —— 联合主持
 * · `subject`      —— 受访者。**不持项目角色**，走一次性令牌（uc-6-3）
 * · `observer`     —— 观察者。⚠ **不可读对象表**（含联系方式与未发布的研究意图）
 * · `recorderAgent`—— 记录 agent（Echo）。⚠ **只能写转写，不写任何状态字段**（R5）
 */
export const SessionRole = z.enum([
  "researcher", "coResearcher", "subject", "observer", "recorderAgent",
]);

/** 列表范围切换器的三档 */
export const InterviewScopeKind = z.enum(["project", "research", "none"]);

/**
 * 数字专家访谈的唯一工作流状态。历史卡、详情、步骤和主操作只能投影这个字段，
 * 不得各自维护第二份布尔组合（Phase 04 / I-1）。
 */
export const DigitalInterviewStatus = z.enum([
  "draft",
  "topic_pending",
  "experts_pending",
  "questions_pending",
  "running",
  "report_pending",
  "completed",
  "failed",
]);

/** 大纲状态。⚠ 以 `pending_confirm` 进现场**由服务端拒绝**，不只是前端标记（I-10） */
export const OutlineStatus = z.enum(["pending_confirm", "confirmed"]);

/** 提纲段落完成态。⚠ **只有人能写**（I-6，`origin: ai` 一律 `AI_WRITE_FORBIDDEN`） */
export const OutlineSectionStatus = z.enum(["done", "deferred"]);

/**
 * 研究问题覆盖度（F92，uc-6-4 R3 步骤7 / AC1）。同样**只有人能写**。
 *
 * ⚠ **四取值，`not_applicable` 是独立第四态，不是 `uncovered` 的别名**：
 *   `not_applicable`（不适用本人）＝「这个 RQ 本就不该问这位受访者」，
 *   `uncovered`（尚未覆盖）＝「该问、还没问到」——两者在 UC-6.5 证据矩阵的
 *   下游解读完全不同（前者不计入"未覆盖"统计，见 A2）。合并这两个值会让
 *   "未覆盖" 的计数把"不适用"也算进去，产出失真的覆盖率。
 */
export const RqCoverageValue = z.enum(["covered", "partial", "uncovered", "not_applicable"]);

/**
 * 证据矩阵格子取值（**五取值**，uc-6-5 R3 step4 / AC4）——`强 / 弱 / 未提及 / 附和 / 反例`。
 * ⚠ `appeasement`（附和）与 `counterexample`（反例）是文档此前完全没有、且语义关键的
 *   两个取值：前者**不计入强度合计**（AC5，从众风险/非独立证据），后者**不可被合并主题、
 *   拆分主题或调整证据权重抹掉**（AC4/E4，`COUNTEREXAMPLE_WOULD_VANISH` 的守护对象）。
 *   五取值必须**两两不同**且在界面上有五种可辨识视觉——`appeasement`/`counterexample`
 *   不能长得像 `weak`（R8）。
 */
export const EvidenceStrength = z.enum([
  "strong", "weak", "not-mentioned", "appeasement", "counterexample",
]);

/**
 * 同意书四位。
 *
 * ⚠ **2026-08-05 coord-main 经人类授权裁决（issue #533）：与 `recording` 束收敛为同一份。**
 *   本处原本自己声明四位，`recording.RecordingConsentItem` 另外声明三项（少 `attribution`），
 *   前三位逐字相同却互不知情。裁决判定那是遗漏，两处合并到 `./consent-item`：
 *   本名字现在是 `ConsentItemKey` 的**别名**（同一个对象，不是内容相同的第二份声明）。
 *   ⇒ 原先「两者故意不合并」的说法**已被推翻**，`KNOWN_CONTRACT_GAPS.C_ITV_2` 同步改为已裁。
 */
export const ConsentKey = ConsentItemKey;

/** 建议来源。⚠ `human_observer` 的私密建议**不经 AI 加工原样呈现**并标出提出人 */
export const SuggestionOrigin = z.enum(["ai", "human_observer"]);

/**
 * `origin: "ai"` 建议的三个子类（F91，uc-6-4 R3 步骤6）。⚠ **不与 `SuggestionOrigin` 重复声明
 * 同一件事**——`origin` 答的是「谁产出的」（ai / human_observer），这里答的是「这条 ai 建议
 * 属于哪一类」；`origin: "human_observer"` 时本字段恒 `null`（观察员私密建议不再细分子类）。
 */
export const AiSuggestionKind = z.enum(["followup", "clarify", "counter_example"]);

/** 对建议的处置。⚠ 四出口 `[使用][编辑后用][稍后][忽略]` 语义各不相同（uc-6-4 R3 步骤6）：
 * `later` **留在待办不消失**，`dismiss` **留痕并回流 agent 改进**——两者不可合并成一个值。 */
export const SuggestionOutcome = z.enum(["adopt", "edit-adopt", "later", "dismiss"]);

/** 撤回发起方。`staff-assisted` = 代其发起并留痕 */
export const WithdrawalOrigin = z.enum(["portal", "staff-assisted"]);

/** 受访者自助请求的类型 */
export const SubjectRequestKind = z.enum(["transcript-copy", "erasure", "consent-change"]);

/** 联系方式的读取意图——**取到明文也写审计**，不只是被拒时写（I-21） */
export const ContactRevealPurpose = z.enum(["booking", "follow-up", "compliance"]);

/**
 * 本束失败模式全集（`usecases.md` 的统一失败枚举表逐条落地）。
 * ⚠ **拒绝响应不得泄露资源是否存在**：`NO_INTERVIEW_ACCESS` 同时用于「无权」与「不存在」，
 *   响应体必须**逐字节不可区分**（uc-6-0/E3 的枚举探测面）。
 */
export const InterviewError = z.enum([
  /** 无权 **或** 不存在。两者不可区分是**安全属性**不是文案疏漏 */
  "NO_INTERVIEW_ACCESS",
  /** 切换器里出现无权范围 ⇒ 该档位**不显示**（服务端过滤，不返回全量再前端过滤） */
  "SCOPE_NOT_VISIBLE",
  /** 挂载目标已删除/归档 ⇒ 挂载关系失效但**产出未丢失**（E1，不静默丢弃） */
  "STEP_CLOSED_OR_ARCHIVED",
  /** 🔗 与 phase-00 `artifact.ArtifactError` 同码同义（D-30） */
  "REQUIRES_PINNED",
  /** 试图写 `用过 N 次` ⇒ 该字段是统计值（I-8）。契约里**根本没有这个入参** */
  "TEMPLATE_STAT_READONLY",
  "TEMPLATE_VERSION_CHANGED",
  /** 抽取草案未确认即被引用（V3）——草案**不入库** */
  "TEMPLATE_DRAFT_NOT_CONFIRMED",
  /** 段落缺目标或问法 < 2（I-11）。⚠ **是否阻断进现场＝[待定 D-6]** */
  "OUTLINE_INCOMPLETE",
  /** 以 `pending_confirm` 进现场 ⇒ **服务端拒绝**，不只是前端标记（I-10） */
  "OUTLINE_NOT_CONFIRMED",
  /** 重新生成会覆盖已手改段落（A3）。取消则修改保留 */
  "OUTLINE_OVERWRITE_NEEDS_CONFIRM",
  /** 合计时长超研究计划参数。⚠ 提示文案必须引用**参数值**，不得写死 60（I-12） */
  "DURATION_EXCEEDS_PLAN",
  /** 保留期/控制方/联系人/合规邮箱任一缺失 ⇒ **不发授权链接**（E2）：
   *  发一份告知不完整的同意书**比不发更糟** */
  "RETENTION_PARAMS_MISSING",
  /** 令牌不存在/过期/已撤销/已使用 —— **四种共用一个码**，⚠ 不泄露任何访谈内容，
   *  也不提示「这个链接以前是有效的」 */
  "TOKEN_INVALID",
  /** 令牌越出本人数据切片（I-14），同时写安全审计 */
  "TOKEN_SCOPE_VIOLATION",
  /**
   * 员工试图写他人同意位（I-1）。
   * ⚠ **这一条对应的是「不应存在的接口」**：本束**不提供**任何写他人同意位的操作。
   *   它写在枚举里的唯一目的，是让门控能对「构造出来的写请求」断言被拒。
   */
  "CONSENT_STAFF_READONLY",
  /** 必需受访者未提交即开始 ⇒ 硬门禁（I-3）。**前端禁用而后端放行不算实现** */
  "CONSENT_REQUIRED",
  /** ⚠ **最严重的失败模式是「系统认为已授权但本人没提交」**——写库失败**绝不能显示成功** */
  "CONSENT_WRITE_FAILED",
  /** 以受访者最后一次提交为准，**不静默覆盖**（V14） */
  "CONSENT_VERSION_CONFLICT",
  /** `origin: ai` 写提纲完成态 / RQ 覆盖态 ⇒ 拒（I-6，「勾选权在你」） */
  "AI_WRITE_FORBIDDEN",
  /** 建议无来源时间码 ⇒ **生成端拒绝落库**（I-5） */
  "SUGGESTION_NO_SOURCE",
  /** 受访者端请求建议字段 ⇒ **服务端不下发**（I-34），响应体中不含该字段 */
  "SUGGESTION_NOT_FOR_SUBJECT",
  /** ⚠ 虚拟来源标强洞察 / 进决策依据 ⇒ **接口层拒绝，不是按钮置灰**（I-28） */
  "VIRTUAL_SOURCE_FORBIDDEN",
  /** 确认无来源的候选（I-29） */
  "INSIGHT_NO_EVIDENCE",
  /** 合并/调权会抹掉唯一反例 ⇒ 阻断（I-26 / E4） */
  "COUNTEREXAMPLE_WOULD_VANISH",
  /** 普遍性断言但独立受访者 < 5（I-27 / O-16）。错误 detail 带**实际人数** */
  "GENERALIZATION_UNSUPPORTED",
  /** 上下级被排进同场 ⇒ 默认拆场；强行同场需二次确认（I-25） */
  "SPLIT_SESSION_REQUIRED",
  /** 同组织人数超研究计划参数（E5） */
  "SAME_ORG_LIMIT",
  /** 无权限或 **agent 主体**请求明文联系方式 ⇒ 拒，**被拒也写审计**（I-21） */
  "CONTACT_PLAINTEXT_DENIED",
  /** 无联系方式即发授权链接 ⇒ 状态停在「待确认」（E1） */
  "CONTACT_REQUIRED",
  /** agent 试图直接外发预约 ⇒ 拒，**只生成草稿**（I-24 / D-28，外发邮件恒 R3） */
  "OUTBOUND_REQUIRES_HUMAN",
  /** 未归组对象的转写回流 ⇒ 回流目标缺失（A1） */
  "SUBJECT_NOT_GROUPED",
  /** ⚠ **撤回中是独立状态**，不是 404 也不是成功 */
  "WITHDRAWAL_IN_PROGRESS",
  /** ⚠ **物理删除未真正完成前不得发出回执**（E3）；材料保持不可读 + 告警重试 */
  "ERASURE_NOT_COMPLETE",
  /** 文字稿副本生成失败 ⇒ 可重试，**不静默失败**（E5） */
  "COPY_GENERATION_FAILED",
  /** 转写失败 ⇒ 单列可重试，逐字稿**留可见缺口**，**不静默丢段**（E8） */
  "TRANSCRIPTION_FAILED",
  /** ⚠ 副驾驶是**增强不是依赖**：不可用时**现场记录必须继续可用**（E9） */
  "COPILOT_UNAVAILABLE",
  /** 大纲/抽取/建议人选的 AI 不可用 ⇒ **保留上一版**，可手工继续 */
  "AI_GENERATION_UNAVAILABLE",
  /** 各 UC 的并发态统一码 */
  "CONCURRENT_MODIFICATION",
  /** 各 UC 通用：已保留当前输入与最后成功数据，可安全重试 */
  "DEPENDENCY_UNAVAILABLE",
  /** 数字专家访谈草稿缺名称或标签。主题只能由确认步骤写入。 */
  "DIGITAL_INTERVIEW_INPUT_INVALID",
  /** 数字专家访谈试图跳过确认步骤。 */
  "DIGITAL_INTERVIEW_STEP_INVALID",
  /** 同一幂等请求键携带了不同的规范化 payload。 */
  "IDEMPOTENCY_KEY_REUSED",
  /** 🔗 与 `context-pack.ContextPackReason` 同码同义：操作过程中权限被撤回 */
  "PERMISSION_REVOKED_MIDWAY",
]);

/* ─────────────────────────────── 值对象 ─────────────────────────────── */

/** 列表范围。`kind: "none"` = 不属于任何项目的独立访谈（它照样存在，不是异常） */
export const InterviewScope = z.object({
  kind: InterviewScopeKind,
  projectId: z.string().nullable(),
  researchProjectId: z.string().nullable(),
}).strict();

/** 列表行 */
export const InterviewRow = z.object({
  interviewId: z.string(),
  title: z.string(),
  /** ⚠ 真人 / 虚拟必须在**行级**可分辨，不能只在汇总里分 */
  sourceKind: InterviewSourceKind,
  scope: InterviewScope,
  tags: z.array(z.string()),
  archived: z.boolean(),
  whenAt: z.string().nullable(),
}).strict();

/** 数字专家访谈草稿的用户输入。trim 在契约边界完成，存储层不保存空白噪声。 */
export const DigitalInterviewDraftInput = z.object({
  name: z.string().trim().min(1),
  tags: z.array(z.string().trim().min(1)).min(1),
}).strict();

const validateUniqueExpertIds = (expertIds: readonly string[], context: z.RefinementCtx) => {
  if (new Set(expertIds).size !== expertIds.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "expertIds must be unique" });
  }
};

const DigitalInterviewExpertIds = z.array(z.string().min(1)).superRefine(validateUniqueExpertIds);

/** 已确认的基础访谈数据；创建时主题为空，直到显式确认主题。 */
export const DigitalInterview = DigitalInterviewDraftInput.extend({
  interviewId: z.string().min(1),
  topic: z.string().trim().min(1).nullable(),
  status: DigitalInterviewStatus,
  sourceQuickInterviewId: z.string().nullable(),
  selectedExpertIds: DigitalInterviewExpertIds,
  reportId: z.string().nullable(),
  version: z.number().int().positive(),
}).strict();

/** 历史访谈卡片。主操作是八态工作流的服务端投影，前端不得自行猜测。 */
export const DigitalInterviewPrimaryAction = z.enum([
  "confirm_topic", "confirm_experts", "confirm_questions", "continue_runs",
  "generate_report", "view_report", "retry",
]);

/** 当前步骤与主操作同源，领域投影不得另抄一份字符串联合。 */
export const DigitalInterviewStep = z.enum(["topic", "experts", "questions", "runs", "report"]);

/** 已确认的问题属于本场当前已确认的专家快照。 */
export const DigitalInterviewQuestion = z.object({
  questionId: z.string().min(1),
  expertId: z.string().min(1),
  order: z.number().int().positive(),
  text: z.string().trim().min(1),
  purpose: z.string().trim().min(1),
}).strict();

export const DigitalInterviewRunAnswer = z.object({
  questionId: z.string().min(1),
  question: z.string().min(1),
  answer: z.string().min(1),
}).strict();

export const DigitalInterviewExpertRun = z.object({
  expertId: z.string().min(1),
  displayName: z.string().min(1),
  status: z.enum(["running", "completed", "failed"]),
  completedQuestions: z.number().int().nonnegative(),
  totalQuestions: z.number().int().nonnegative(),
  answers: z.array(DigitalInterviewRunAnswer),
  errorCode: z.string().min(1).nullable(),
  updatedAt: z.string().datetime(),
}).strict();

/** 报告中的每条发现都必须能回到一位专家的一道问题及其原始回答。 */
export const DigitalInterviewReportFinding = z.object({
  findingId: z.string().min(1),
  title: z.string().trim().min(1),
  summary: z.string().trim().min(1),
  expertId: z.string().min(1),
  questionId: z.string().min(1),
  sourceAnswerId: z.string().min(1),
  exploratory: z.literal(true),
}).strict();

export const DigitalInterviewReport = z.object({
  reportId: z.string().min(1),
  title: z.string().trim().min(1),
  executiveSummary: z.string().trim().min(1),
  markdown: z.string().trim().min(1),
  findings: z.array(DigitalInterviewReportFinding).min(1),
  generatedAt: z.string().datetime(),
}).strict();

/**
 * Durable projection of an in-flight report. It is intentionally part of the workflow
 * recovery view: a browser may disappear while the model keeps running, then reconnect
 * and continue from the last event that was committed before it disconnected.
 */
export const DigitalInterviewReportGeneration = z.object({
  reportId: z.string().min(1),
  requestId: z.string().min(1),
  status: z.enum(["running", "failed"]),
  title: z.string().trim().min(1).nullable(),
  executiveSummary: z.string().trim().min(1).nullable(),
  markdown: z.string(),
  findings: z.array(DigitalInterviewReportFinding),
  errorCode: z.string().min(1).nullable(),
  updatedAt: z.string().datetime(),
}).strict();

const validateUniqueDigitalInterviewQuestions = (
  questions: readonly z.infer<typeof DigitalInterviewQuestion>[],
  context: z.RefinementCtx,
) => {
  const questionIds = new Set<string>();
  const orders = new Set<number>();
  questions.forEach((question, index) => {
    if (questionIds.has(question.questionId)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "questionId"], message: "questionId must be unique" });
    }
    if (orders.has(question.order)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [index, "order"], message: "order must be unique" });
    }
    questionIds.add(question.questionId);
    orders.add(question.order);
  });
};

const DigitalInterviewQuestionList = z.array(DigitalInterviewQuestion)
  .superRefine(validateUniqueDigitalInterviewQuestions);
const DigitalInterviewQuestionConfirmation = z.array(DigitalInterviewQuestion).min(1)
  .superRefine(validateUniqueDigitalInterviewQuestions);

/** 浏览器可直接消费的当前可见专家快照；它与专家目录复用同一个严格投影。 */
export const DigitalExpertCatalogRow = z.object({
  expertId: z.string().min(1),
  agentDefinitionId: z.string().min(1),
  agentVersion: z.string().min(1),
  initials: z.string().min(1),
  displayName: z.string().min(1),
  role: z.string().min(1),
  domains: z.array(z.string().min(1)).min(1),
  category: z.string().min(1),
  bio: z.string().min(1),
  location: z.string().min(1),
  typicalAdvice: z.string().min(1),
  age: z.number().int().nonnegative(),
  occupation: z.string().min(1),
  goals: z.array(z.string().min(1)),
  interests: z.array(z.string().min(1)),
  painPoints: z.array(z.string().min(1)),
  motivations: z.array(z.string().min(1)),
  influences: z.array(z.string().min(1)),
  personalityTraits: z.object({
    introvertExtrovert: z.number().int().min(1).max(10),
    analyticalCreative: z.number().int().min(1).max(10),
    busyTimeRich: z.number().int().min(1).max(10),
  }).strict(),
  serviceValue: z.string().min(1),
  materialContextPackId: z.string().min(1).nullable(),
  materialVersion: z.string().min(1).nullable(),
  materialBoundary: z.string().min(1),
  exploratory: z.literal(true),
}).strict().superRefine((value, context) => {
  if ((value.materialContextPackId === null) !== (value.materialVersion === null)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["materialVersion"],
      message: "materialContextPackId and materialVersion must both be null or both be present",
    });
  }
});

export const DigitalInterviewSkillDraftContext = z.discriminatedUnion("step", [
  z.object({ step: z.literal("topic"), topic: z.string().trim().min(1) }).strict(),
  z.object({ step: z.literal("experts"), expertIds: DigitalInterviewExpertIds }).strict(),
  z.object({ step: z.literal("questions"), questions: DigitalInterviewQuestionList }).strict(),
  z.object({ step: z.literal("runs"), instruction: z.string().trim().min(1) }).strict(),
  z.object({ step: z.literal("report"), instruction: z.string().trim().min(1) }).strict(),
]);

export const DigitalInterviewSkillPatch = z.union([
  z.object({ topic: z.string().trim().min(1) }).strict(),
  z.object({ expertIds: DigitalInterviewExpertIds }).strict(),
  z.object({ questions: DigitalInterviewQuestionList }).strict(),
  z.object({ instruction: z.string().trim().min(1) }).strict(),
]);

/** Skill 线程的持久消息。业务正文不进入 LangGraph checkpoint。 */
export const DigitalInterviewSkillMessage = z.object({
  messageId: z.string().min(1),
  skillThreadId: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  text: z.string().trim().min(1),
  createdAt: z.string().datetime(),
}).strict();

/** Skill 只能提出草稿 patch；确认步骤才会把内容写进工作流版本。 */
const DigitalInterviewSkillProposalBase = z.object({
  proposalId: z.string().min(1),
  sourceMessageId: z.string().min(1),
  targetStep: DigitalInterviewStep,
  baseRevisionId: z.string().min(1),
  patch: DigitalInterviewSkillPatch,
  createdAt: z.string().datetime(),
});

/** 每一生命周期状态都携带明确的审计时间/确认版本，避免把草稿误报为已确认数据。 */
export const DigitalInterviewSkillProposal = z.discriminatedUnion("status", [
  DigitalInterviewSkillProposalBase.extend({
    status: z.literal("proposed"),
    appliedAt: z.null(),
    rejectedAt: z.null(),
    committedVersionId: z.null(),
  }).strict(),
  DigitalInterviewSkillProposalBase.extend({
    status: z.literal("applied_to_draft"),
    appliedAt: z.string().datetime(),
    rejectedAt: z.null(),
    committedVersionId: z.null(),
  }).strict(),
  DigitalInterviewSkillProposalBase.extend({
    status: z.literal("rejected"),
    appliedAt: z.null(),
    rejectedAt: z.string().datetime(),
    committedVersionId: z.null(),
  }).strict(),
  DigitalInterviewSkillProposalBase.extend({
    status: z.literal("committed"),
    appliedAt: z.string().datetime(),
    rejectedAt: z.null(),
    committedVersionId: z.string().min(1),
  }).strict(),
  DigitalInterviewSkillProposalBase.extend({
    status: z.literal("stale"),
    appliedAt: z.null(),
    rejectedAt: z.null(),
    committedVersionId: z.null(),
  }).strict(),
]);

/**
 * F04 的唯一恢复读模型。确认操作和所有持久 Skill 写都返回完整视图，因此浏览器不会从
 * localStorage 或未确认的 dirty buffer 推断状态。
 */
export const DigitalInterviewWorkflowView = DigitalInterview.extend({
  scope: InterviewScope,
  currentStep: DigitalInterviewStep,
  revisionId: z.string().min(1),
  topicVersionId: z.string().min(1).nullable(),
  expertSnapshotVersionId: z.string().min(1).nullable(),
  questionVersionId: z.string().min(1).nullable(),
  expertCandidates: z.array(DigitalExpertCatalogRow),
  questions: DigitalInterviewQuestionList,
  questionCandidates: DigitalInterviewQuestionList,
  expertRuns: z.array(DigitalInterviewExpertRun),
  report: DigitalInterviewReport.nullable().optional(),
  reportGeneration: DigitalInterviewReportGeneration.nullable().optional(),
  skillThreadId: z.string().min(1),
  skillMessages: z.array(DigitalInterviewSkillMessage),
  skillProposals: z.array(DigitalInterviewSkillProposal),
}).strict();

/*
 * `skillProposals` is the sole proposal fact source. Consumers derive active proposals by filtering
 * `status === "applied_to_draft"` and `baseRevisionId === revisionId`; no duplicate active object list exists.
 */

export const DigitalInterviewHistoryRow = DigitalInterviewDraftInput.extend({
  interviewId: z.string().min(1),
  topic: z.string().trim().min(1).nullable(),
  kind: z.enum(["quick", "batch"]),
  status: DigitalInterviewStatus,
  expertCount: z.number().int().nonnegative(),
  completedExpertCount: z.number().int().nonnegative(),
  primaryAction: DigitalInterviewPrimaryAction,
  updatedAt: z.string().datetime(),
}).strict();

export const QuickDigitalInterviewMessage = z.object({
  messageId: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1),
  exploratory: z.literal(true),
  sourcePointers: z.array(z.string().min(1)),
  createdAt: z.string().datetime(),
}).strict();

export const QuickDigitalInterview = z.object({
  interviewId: z.string().min(1),
  expert: DigitalExpertCatalogRow,
  messages: z.array(QuickDigitalInterviewMessage),
  version: z.number().int().positive(),
}).strict();

/** 快捷访谈转批量后冻结的原始问答素材；正文与来源指针不得在转换时改写。 */
export const DigitalInterviewSourceMaterial = z.object({
  sourceMessageId: z.string().min(1),
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1),
  sourcePointers: z.array(z.string().min(1)),
}).strict();

export const ConvertedDigitalInterview = DigitalInterview.extend({
  sourceMaterials: z.array(DigitalInterviewSourceMaterial),
}).strict();

/** 模板列表行——**名称/用过N次/一句话/题数/时长区间** 五要素 */
export const TemplateRow = z.object({
  templateId: z.string(),
  name: z.string(),
  /** ⚠ **统计值，只读**（I-8）。任何写它的入参在契约里根本不存在 */
  usedCount: z.number().int().nonnegative(),
  oneLiner: z.string(),
  questionCount: z.number().int().nonnegative(),
  minutesRange: z.object({
    min: z.number().int().nonnegative(), max: z.number().int().nonnegative(),
  }).strict(),
}).strict();

/** 模板要收集的数据字段。⚠ **套用时最常被漏的第三样**——它是证据矩阵能成列的前提 */
export const TemplateField = z.object({
  fieldId: z.string(),
  name: z.string(),
  kind: z.string(),
  required: z.boolean(),
}).strict();

/**
 * 提纲段落。
 * ⚠ **`objective` 必须序列化在 `openers` 之前**（I-11）——顺序是契约的一部分，不是排版。
 *   一个先看到问法再看到目标的研究员，会照着问法念而不是照着目标问。
 */
export const OutlineSection = z.object({
  sectionId: z.string(),
  objective: z.string(),
  openers: z.array(z.string()),
  minutes: z.number().int().nonnegative(),
  order: z.number().int().nonnegative(),
  status: OutlineSectionStatus.nullable(),
}).strict();

/** 研究计划参数。⚠ `retentionDays` 是**只读投影**，改它要去改项目的「材料保留期」（单源，I-12） */
export const ResearchPlanParams = z.object({
  /** ⚠ 只读。⚠ 提示文案必须引用它，**不得写死任何天数** */
  retentionDays: z.number().int().positive(),
  plannedMinutes: z.number().int().positive(),
  sameOrgLimit: z.number().int().positive(),
  /** ⚠ 状态**必须能被下游转写与 AI 管线读取**（V4），否则这个开关只是装饰 */
  trainingProhibited: z.boolean(),
  dataController: z.string(),
  contactName: z.string(),
  complianceEmail: z.string(),
}).strict();

/** 同意书四项的逐字措辞。⚠ **措辞与降级语义逐字属契约**（AC3），不是可改的文案 */
export const ConsentItemCopy = z.object({
  key: ConsentKey,
  label: z.string(),
  /** 取消该项时**当场显示**的降级说明。逐字属契约 */
  optOutConsequence: z.string(),
}).strict();

/**
 * 四位同意。⚠ **四位全 false 是合法完整结果**，不是失败态，访谈照常可进行。
 * ⚠ shape 不在这里手写——那会是同一份事实的第 N 份副本（#533）。见 `./consent-item`。
 */
export const ConsentBits = SharedConsentBits;

/**
 * 本场七开关。⚠ 前六默认开、第七 `showAiSuggestionsToSubjects` **默认关**；
 * 关闭时服务端**不下发**建议字段（I-34）——不是前端隐藏。
 */
export const SevenSwitches = z.object({
  liveTranscript: z.boolean(),
  copilotSuggestions: z.boolean(),
  speakingBalanceAlert: z.boolean(),
  rqCoverageTracking: z.boolean(),
  quoteExtraction: z.boolean(),
  observerNotes: z.boolean(),
  showAiSuggestionsToSubjects: z.boolean(),
}).strict();

/**
 * 副驾驶建议（F91，uc-6-4 R3 步骤6）。
 * ⚠ **I-5**：`sourceSegmentId` + `sourceTimecode` 均非空 ⇒ **生成端拒绝落库**——无来源
 *   不落库不是「界面不显示」，是生成端在写入之前就拒绝这次写入。
 * ⚠ `reason`（理由）与来源一样是硬约束（notes 原文「每条建议无来源不得给出」），非空。
 * ⚠ `rqId`/`priority` 只有 `aiSuggestionKind: "followup"` 才可能非 null——澄清/反例/观察员
 *   私密建议不绑定 RQ、不分优先级，这不是遗漏，是这三类本身没有这个维度。
 */
export const CopilotSuggestion = z.object({
  suggestionId: z.string(),
  origin: SuggestionOrigin,
  /** 见 `AiSuggestionKind` 头注：`origin: "human_observer"` 时恒 `null`。 */
  aiSuggestionKind: AiSuggestionKind.nullable(),
  text: z.string(),
  reason: z.string().min(1),
  sourceSegmentId: z.string().min(1),
  sourceTimecode: z.string().min(1),
  rqId: z.string().nullable(),
  priority: z.enum(["high", "normal"]).nullable(),
  /** `human_observer` 时非空并标出提出人；该来源**不经 AI 加工原样呈现** */
  proposedBy: z.string().nullable(),
}).strict();

/** RQ 覆盖 */
export const RqCoverage = z.object({
  rqId: z.string(),
  label: z.string(),
  value: RqCoverageValue,
  /** ⚠ 只有人能写（I-6） */
  writerOrigin: z.literal("human"),
}).strict();

/** 引述 */
export const Quote = z.object({
  quoteId: z.string(),
  segmentId: z.string(),
  text: z.string(),
  subjectId: z.string(),
  rqId: z.string().nullable(),
}).strict();

/**
 * 洞察。
 * ⚠ `strong` **只有真人来源能标**（I-28）；`sourceKind` 在洞察上是**派生的一等字段**，
 *   不是靠追溯来源现算——现算意味着来源被撤后这条洞察的强度会静默变化。
 */
export const Insight = z.object({
  insightId: z.string(),
  text: z.string(),
  sourceKind: InterviewSourceKind,
  strong: z.boolean(),
  evidenceQuoteIds: z.array(z.string()),
  /** 入库时**固化**的来源快照 id */
  pinnedSourceSnapshotId: z.string().nullable(),
}).strict();

/** 证据矩阵。⚠ 头部含 `sessionCount` 与 `subjectCount` **两个数**，不能只给一个 */
export const EvidenceMatrix = z.object({
  sessionCount: z.number().int().nonnegative(),
  subjectCount: z.number().int().nonnegative(),
  rows: z.array(z.object({
    themeId: z.string(),
    cells: z.array(z.object({
      subjectId: z.string(),
      quoteIds: z.array(z.string()),
      /** ⚠ 五取值本值（AC4）。`counterexample` 字段与 `strength === "counterexample"` 必须同义——
       *  两处声明会漂移，见 `computeCellStrength`（domain 层）把两者绑定为同一次计算的两个视图。 */
      strength: EvidenceStrength,
      /** ⚠ **唯一反例**是 `COUNTEREXAMPLE_WOULD_VANISH` 的守护对象 */
      counterexample: z.boolean(),
    }).strict()),
  }).strict()),
}).strict();

/** 访谈对象。⚠ `contact` **恒为 mask**——明文只有 `revealContact` 一条路 */
export const Subject = z.object({
  subjectId: z.string(),
  displayName: z.string(),
  roleTitle: z.string(),
  orgName: z.string().nullable(),
  groupId: z.string().nullable(),
  /** 恒掩码。观察者连这一行都读不到（对象表含未发布的研究意图） */
  contactMask: z.string(),
  sourceKind: InterviewSourceKind,
}).strict();

/** 受访者自助请求 */
export const SubjectRequest = z.object({
  requestId: z.string(),
  kind: SubjectRequestKind,
  status: z.string(),
  /** ⚠ **不能只给一句「已提交」就没有下文**（V6）：预计完成时间随流水线推进更新 */
  etaAt: z.string().nullable(),
}).strict();

/** 撤回五步中的一步。⚠ 第 03 步**标失效不删除**；第 04 步**只产生复核任务**，禁止自动改写结论 */
export const WithdrawalStep = z.object({
  no: z.number().int().positive(),
  state: z.string(),
  dueAt: z.string().nullable(),
}).strict();

/* ───────────────────────────── 操作 ───────────────────────────── */

export const operations = {
  /* ── Phase 04 · 数字专家访谈基础 ─────────────────────────────── */

  /** 保存草稿不触发专家生成；后续步骤必须由显式确认操作推进。 */
  createDigitalInterviewDraft: {
    method: "POST", path: "/interviews/digital",
    in: DigitalInterviewDraftInput.extend({
      scope: InterviewScope,
      requestId: z.string().min(1),
    }).strict(),
    out: DigitalInterviewWorkflowView,
    err: ["DIGITAL_INTERVIEW_INPUT_INVALID", "IDEMPOTENCY_KEY_REUSED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 刷新或重新进入页面时恢复同一状态和版本。 */
  getDigitalInterview: {
    method: "GET", path: "/interviews/digital/:interviewId",
    in: z.object({ interviewId: z.string() }).strict(),
    out: DigitalInterviewWorkflowView,
    err: ["NO_INTERVIEW_ACCESS", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 主题只在显式确认时持久化，并推进到专家确认。 */
  confirmDigitalInterviewTopic: {
    method: "POST", path: "/interviews/digital/:interviewId/topic/confirm",
    in: z.object({
      interviewId: z.string().min(1),
      topic: z.string().trim().min(1),
      expectedVersion: z.number().int().positive(),
      requestId: z.string().min(1),
    }).strict(),
    out: DigitalInterviewWorkflowView,
    err: ["NO_INTERVIEW_ACCESS", "DIGITAL_INTERVIEW_STEP_INVALID", "CONCURRENT_MODIFICATION", "IDEMPOTENCY_KEY_REUSED", "PERMISSION_REVOKED_MIDWAY", "AI_GENERATION_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 确认至少一名专家后，才允许生成并编辑该场的问题集合。 */
  confirmDigitalInterviewExperts: {
    method: "POST", path: "/interviews/digital/:interviewId/experts/confirm",
    in: z.object({
      interviewId: z.string().min(1),
      expertIds: z.array(z.string().min(1)).min(1).superRefine(validateUniqueExpertIds),
      addedExperts: z.array(DigitalExpertCatalogRow).default([]),
      expectedVersion: z.number().int().positive(),
      requestId: z.string().min(1),
    }).strict(),
    out: DigitalInterviewWorkflowView,
    err: ["NO_INTERVIEW_ACCESS", "DIGITAL_INTERVIEW_STEP_INVALID", "CONCURRENT_MODIFICATION", "IDEMPOTENCY_KEY_REUSED", "PERMISSION_REVOKED_MIDWAY", "AI_GENERATION_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 每位已确认专家至少一题；确认后工作流才能进入运行阶段。 */
  confirmDigitalInterviewQuestions: {
    method: "POST", path: "/interviews/digital/:interviewId/questions/confirm",
    in: z.object({
      interviewId: z.string().min(1),
      questions: DigitalInterviewQuestionConfirmation,
      expectedVersion: z.number().int().positive(),
      requestId: z.string().min(1),
    }).strict(),
    out: DigitalInterviewWorkflowView,
    err: ["NO_INTERVIEW_ACCESS", "DIGITAL_INTERVIEW_STEP_INVALID", "CONCURRENT_MODIFICATION", "IDEMPOTENCY_KEY_REUSED", "PERMISSION_REVOKED_MIDWAY", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 所有专家运行终止后，由用户显式确认回答并生成可追溯报告。 */
  generateDigitalInterviewReport: {
    method: "POST", path: "/interviews/digital/:interviewId/report/generate",
    in: z.object({
      interviewId: z.string().min(1),
      expectedVersion: z.number().int().positive(),
      requestId: z.string().min(1),
    }).strict(),
    out: DigitalInterviewWorkflowView,
    err: ["NO_INTERVIEW_ACCESS", "DIGITAL_REPORT_NOT_READY", "DIGITAL_REPORT_SOURCE_INVALID", "CONCURRENT_MODIFICATION", "IDEMPOTENCY_KEY_REUSED", "PERMISSION_REVOKED_MIDWAY", "AI_GENERATION_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 用户消息和由它生成的 proposal 立即持久化，并推进同一访谈 aggregate version。 */
  appendDigitalInterviewSkillMessage: {
    method: "POST", path: "/interviews/digital/:interviewId/skill/messages",
    in: z.object({
      interviewId: z.string().min(1),
      currentStep: DigitalInterviewStep,
      text: z.string().trim().min(1),
      draftContext: DigitalInterviewSkillDraftContext,
      expectedVersion: z.number().int().positive(),
      requestId: z.string().min(1),
    }).strict().superRefine((value, context) => {
      if (value.currentStep !== value.draftContext.step) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["draftContext", "step"],
          message: "draftContext.step must match currentStep",
        });
      }
    }),
    out: DigitalInterviewWorkflowView,
    err: ["NO_INTERVIEW_ACCESS", "CONCURRENT_MODIFICATION", "IDEMPOTENCY_KEY_REUSED", "PERMISSION_REVOKED_MIDWAY", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 应用 proposal 只持久化其草稿状态，但仍推进同一访谈 aggregate version。 */
  applyDigitalInterviewSkillProposal: {
    method: "POST", path: "/interviews/digital/:interviewId/skill/proposals/:proposalId/apply",
    in: z.object({
      interviewId: z.string().min(1),
      proposalId: z.string().min(1),
      expectedVersion: z.number().int().positive(),
      requestId: z.string().min(1),
    }).strict(),
    out: DigitalInterviewWorkflowView,
    err: ["NO_INTERVIEW_ACCESS", "DIGITAL_INTERVIEW_STEP_INVALID", "CONCURRENT_MODIFICATION", "IDEMPOTENCY_KEY_REUSED", "PERMISSION_REVOKED_MIDWAY", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 拒绝 proposal 要保留生命周期审计，并推进同一访谈 aggregate version。 */
  rejectDigitalInterviewSkillProposal: {
    method: "POST", path: "/interviews/digital/:interviewId/skill/proposals/:proposalId/reject",
    in: z.object({
      interviewId: z.string().min(1),
      proposalId: z.string().min(1),
      expectedVersion: z.number().int().positive(),
      requestId: z.string().min(1),
    }).strict(),
    out: DigitalInterviewWorkflowView,
    err: ["NO_INTERVIEW_ACCESS", "DIGITAL_INTERVIEW_STEP_INVALID", "CONCURRENT_MODIFICATION", "IDEMPOTENCY_KEY_REUSED", "PERMISSION_REVOKED_MIDWAY", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** Studio 首屏历史列表；可见性在服务端完成。 */
  listDigitalInterviews: {
    method: "GET", path: "/interviews/digital",
    in: z.object({ status: DigitalInterviewStatus.optional() }).strict(),
    out: z.object({ items: z.array(DigitalInterviewHistoryRow) }).strict(),
    err: ["DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** Studio 首屏数字专家目录；只返回当前调用者可见且可运行的 Agent。 */
  listDigitalExperts: {
    method: "GET", path: "/interviews/digital/experts",
    in: z.object({ domain: z.string().trim().min(1).optional() }).strict(),
    out: z.object({ items: z.array(DigitalExpertCatalogRow) }).strict(),
    err: ["DEPENDENCY_UNAVAILABLE"] as const,
  },

  startQuickDigitalInterview: {
    method: "POST", path: "/interviews/digital/quick",
    in: z.object({ expertId: z.string().min(1), requestId: z.string().min(1) }).strict(),
    out: QuickDigitalInterview,
    err: ["NO_INTERVIEW_ACCESS", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  getQuickDigitalInterview: {
    method: "GET", path: "/interviews/digital/quick/:interviewId",
    in: z.object({ interviewId: z.string().min(1) }).strict(),
    out: QuickDigitalInterview,
    err: ["NO_INTERVIEW_ACCESS", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  appendQuickDigitalInterviewMessage: {
    method: "POST", path: "/interviews/digital/quick/:interviewId/messages",
    in: z.object({
      interviewId: z.string().min(1), text: z.string().trim().min(1),
      expectedVersion: z.number().int().positive(),
    }).strict(),
    out: QuickDigitalInterview,
    err: ["NO_INTERVIEW_ACCESS", "CONCURRENT_MODIFICATION", "PERMISSION_REVOKED_MIDWAY", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  convertQuickInterviewToBatch: {
    method: "POST", path: "/interviews/digital/quick/:interviewId/convert",
    in: DigitalInterviewDraftInput.extend({
      topic: z.string().trim().min(1),
      interviewId: z.string().min(1), expectedVersion: z.number().int().positive(),
    }).strict(),
    out: ConvertedDigitalInterview,
    err: ["NO_INTERVIEW_ACCESS", "CONCURRENT_MODIFICATION", "DIGITAL_INTERVIEW_INPUT_INVALID", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /* ── A 组 · 范围与列表（uc-6-0）───────────────────────────────── */

  /**
   * listInterviews —— 跨项目列表 + 范围过滤。
   * ⚠ 空态必须区分「本范围无访谈」与「无权查看本范围」（**文案不同**，V7），
   *   且**不生成示例访谈**。
   * ⚠ `counts` **必须是真人/虚拟两个独立字段，不得合并**（D-25 / V5）——
   *   合并后「我们访了 30 个人」里有多少是推演出来的，就再也答不出来了。
   */
  listInterviews: {
    method: "GET", path: "/interviews",
    in: z.object({
      scope: InterviewScope,
      filters: z.object({
        tags: z.array(z.string()).nullable(),
        archived: z.boolean().nullable(),
      }).strict().optional(),
      cursor: z.string().optional(),
      limit: z.number().int().positive().optional(),
    }).strict(),
    out: z.object({
      items: z.array(InterviewRow),
      nextCursor: z.string().nullable(),
      counts: z.object({
        human: z.number().int().nonnegative(),
        virtual: z.number().int().nonnegative(),
      }).strict(),
      /** 区分两种空态：true = 本范围确实没有；false + 空 items = 无权（走 err） */
      emptyBecauseNoData: z.boolean(),
    }).strict(),
    err: ["SCOPE_NOT_VISIBLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * getInterview —— 按 ID 直读。
   * ⚠ **项目负责人不因职位自动获得跨项目/无项目访谈的读权**（R5）。
   *   管理员的项目层读取**写审计且对项目负责人可见**（对齐 identity D-18）。
   */
  getInterview: {
    method: "GET", path: "/interviews/:interviewId",
    in: z.object({ interviewId: z.string() }).strict(),
    out: z.object({
      interviewId: z.string(),
      title: z.string(),
      sourceKind: InterviewSourceKind,
      scope: InterviewScope,
      outlineId: z.string().nullable(),
      outlineStatus: OutlineStatus.nullable(),
      appliedTemplateVersionId: z.string().nullable(),
      startedAt: z.string().nullable(),
    }).strict(),
    err: ["NO_INTERVIEW_ACCESS"] as const,
  },

  /**
   * attachToProjectStep —— 挂载到项目环节。
   * ⚠ `pinnedVersionId` 必须指向**固定快照**，否则 `REQUIRES_PINNED`（D-30，跨束同码）。
   */
  attachToProjectStep: {
    method: "POST", path: "/interviews/:interviewId/attachments",
    in: z.object({
      interviewId: z.string(),
      projectId: z.string(),
      agendaSegmentId: z.string(),
      pinnedVersionId: z.string(),
    }).strict(),
    out: z.object({
      attachmentId: z.string(),
      interviewId: z.string(),
      projectId: z.string(),
      agendaSegmentId: z.string(),
      pinnedVersionId: z.string(),
    }).strict(),
    err: [
      "NO_INTERVIEW_ACCESS", "STEP_CLOSED_OR_ARCHIVED",
      "REQUIRES_PINNED", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * detachFromProjectStep —— 解除挂载。
   * ⚠ **产出仍在**（回到「不属于任何项目」）；挂载/解除**都写审计**，
   *   范围切换（读操作）**不写**。
   */
  detachFromProjectStep: {
    method: "POST", path: "/interviews/attachments/:attachmentId/detach",
    in: z.object({ attachmentId: z.string() }).strict(),
    out: z.object({
      attachmentId: z.string(), detachedAt: z.string(), interviewStillExists: z.literal(true),
    }).strict(),
    err: ["NO_INTERVIEW_ACCESS", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /* ── B 组 · 模板（uc-6-1）─────────────────────────────────────── */

  /** listTemplates —— ⚠ 空模板库给**两个出口**（新建 / 从已有访谈抽取），**不预置示例模板**（V7） */
  listTemplates: {
    method: "GET", path: "/interviews/templates",
    in: z.object({
      filters: z.object({ tag: z.string().nullable() }).strict().optional(),
      cursor: z.string().optional(),
    }).strict(),
    out: z.object({ items: z.array(TemplateRow) }).strict(),
    err: ["DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** getTemplate —— 详情。入库后可列出**来源访谈**（反向抽取来的模板） */
  getTemplate: {
    method: "GET", path: "/interviews/templates/:templateId",
    in: z.object({ templateId: z.string() }).strict(),
    out: z.object({
      templateId: z.string(),
      versionId: z.string(),
      versionNumber: z.number().int().positive(),
      name: z.string(),
      goal: z.string(),
      sections: z.array(z.object({
        name: z.string(),
        minutes: z.number().int().nonnegative(),
        order: z.number().int().nonnegative(),
      }).strict()),
      dataFields: z.array(TemplateField),
      tags: z.array(z.string()),
      usedCount: z.number().int().nonnegative(),
      sourceInterviewIds: z.array(z.string()),
    }).strict(),
    err: ["NO_INTERVIEW_ACCESS", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * createTemplate —— 新建。
   * ⚠ **不接受 `usedCount` 入参**——契约里根本没有这个字段（I-8）。
   *   `TEMPLATE_STAT_READONLY` 是给「构造出来的写请求」准备的断言对象。
   */
  createTemplate: {
    method: "POST", path: "/interviews/templates",
    in: z.object({
      name: z.string(),
      goal: z.string(),
      sections: z.array(z.object({
        name: z.string(),
        minutes: z.number().int().nonnegative(),
        order: z.number().int().nonnegative(),
      }).strict()),
      dataFields: z.array(TemplateField),
      tags: z.array(z.string()),
    }).strict(),
    out: z.object({
      templateId: z.string(),
      versionId: z.string(),
      versionNumber: z.number().int().positive(),
    }).strict(),
    err: [
      "TEMPLATE_STAT_READONLY", "TEMPLATE_VERSION_CHANGED", "CONCURRENT_MODIFICATION",
      "AI_GENERATION_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** updateTemplate —— ⚠ **产生新版本**，已建访谈不受影响（A2 / I-9） */
  updateTemplate: {
    method: "PUT", path: "/interviews/templates/:templateId",
    in: z.object({
      templateId: z.string(),
      expectedVersionNumber: z.number().int().positive(),
      name: z.string(),
      goal: z.string(),
      sections: z.array(z.object({
        name: z.string(),
        minutes: z.number().int().nonnegative(),
        order: z.number().int().nonnegative(),
      }).strict()),
      dataFields: z.array(TemplateField),
      tags: z.array(z.string()),
    }).strict(),
    out: z.object({
      templateId: z.string(),
      versionId: z.string(),
      versionNumber: z.number().int().positive(),
    }).strict(),
    err: [
      "TEMPLATE_STAT_READONLY", "TEMPLATE_VERSION_CHANGED", "CONCURRENT_MODIFICATION",
      "AI_GENERATION_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * applyTemplate —— 套用模板新建访谈（**主线第二步**）。
   * ⚠ 一次性带入**三样**：分段 + 每段时长 + **要收集的数据字段**。
   *   第三样最常被漏——它是 UC-6.5 证据矩阵能成列的前提。
   */
  applyTemplate: {
    method: "POST", path: "/interviews/templates/:templateId/apply",
    in: z.object({
      templateId: z.string(),
      versionId: z.string().nullable(),
      targetInterviewId: z.string().nullable(),
    }).strict(),
    out: z.object({
      interviewId: z.string(),
      appliedTemplateVersionId: z.string(),
      sections: z.array(z.object({
        name: z.string(),
        minutes: z.number().int().nonnegative(),
        order: z.number().int().nonnegative(),
      }).strict()),
      /** ⚠ 缺它就等于没套用完 */
      dataFields: z.array(TemplateField),
    }).strict(),
    err: [
      "TEMPLATE_DRAFT_NOT_CONFIRMED", "NO_INTERVIEW_ACCESS", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * extractTemplateDraft —— 从已有访谈反向抽取模板草案。
   * ⚠ 结果是**草案**，确认后才入库（V3）。
   * ⚠ 输入受 O-05 约束：**拒绝 AI 分析者的片段不进抽取输入**（I-4）。
   */
  extractTemplateDraft: {
    method: "POST", path: "/interviews/templates/extract",
    in: z.object({ sourceInterviewIds: z.array(z.string()) }).strict(),
    out: z.object({
      draftId: z.string(),
      sections: z.array(z.object({
        name: z.string(),
        minutes: z.number().int().nonnegative(),
        order: z.number().int().nonnegative(),
      }).strict()),
      dataFields: z.array(TemplateField),
      sourceInterviewIds: z.array(z.string()),
    }).strict(),
    err: [
      "AI_GENERATION_UNAVAILABLE", "NO_INTERVIEW_ACCESS", "TEMPLATE_DRAFT_NOT_CONFIRMED",
    ] as const,
  },

  /** confirmTemplateDraft —— 确认后才入库 */
  confirmTemplateDraft: {
    method: "POST", path: "/interviews/templates/drafts/:draftId/confirm",
    in: z.object({ draftId: z.string(), edits: z.string().nullable() }).strict(),
    out: z.object({
      templateId: z.string(),
      versionId: z.string(),
      versionNumber: z.number().int().positive(),
    }).strict(),
    err: [
      "TEMPLATE_DRAFT_NOT_CONFIRMED", "NO_INTERVIEW_ACCESS", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * checkQuestionQuality —— 诱导性/照抄体检。
   * ⚠ **是提示不是阻断**：`findings` 非空时接口**成功返回**，`err` 里没有「不合格」这种码。
   */
  checkQuestionQuality: {
    method: "POST", path: "/interviews/question-quality/check",
    in: z.object({
      text: z.string(), kind: z.enum(["template", "outline"]),
    }).strict(),
    out: z.object({
      findings: z.array(z.object({
        span: z.object({
          start: z.number().int().nonnegative(), end: z.number().int().nonnegative(),
        }).strict(),
        issue: z.string(),
        suggestion: z.string(),
      }).strict()),
    }).strict(),
    err: ["AI_GENERATION_UNAVAILABLE"] as const,
  },

  /* ── C 组 · 研究设计（uc-6-2）─────────────────────────────────── */

  /**
   * createInterviewFromWizard —— 三步向导。
   * ⚠ 第一步可选「从空白开始」（A2，`templateId` 可空）。
   * ⚠ 无模板/无对象时各步显示**真实空态与创建入口**，**不生成示例大纲**。
   * ⚠ `sourceKind` 决定这是质性访谈还是**虚拟用户画像推演访谈**——
   *   两条主线共用这一个入口，但产出的证据资格从此分野（I-28）。
   */
  createInterviewFromWizard: {
    method: "POST", path: "/interviews/wizard",
    in: z.object({
      scope: InterviewScope,
      sourceKind: InterviewSourceKind,
      templateId: z.string().nullable(),
      subjectIds: z.array(z.string()),
      context: z.object({
        who: z.string(), situation: z.string(), decision: z.string(),
      }).strict(),
    }).strict(),
    out: z.object({
      interviewId: z.string(),
      outlineId: z.string(),
      outlineStatus: z.literal("pending_confirm"),
    }).strict(),
    err: [
      "SPLIT_SESSION_REQUIRED", "SAME_ORG_LIMIT",
      "AI_GENERATION_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * generateOutline —— AI 生成大纲。
   * ⚠ 生成失败**保留上一版大纲，不清空**。
   * ⚠ 输入**只经 Context API**（I-33），并受 O-05 过滤（I-4）。
   * ⚠ `force: true` 才覆盖已手改段落；否则 `OUTLINE_OVERWRITE_NEEDS_CONFIRM`，
   *   取消则修改保留（A3）。
   */
  generateOutline: {
    method: "POST", path: "/interviews/:interviewId/outline/generate",
    in: z.object({
      interviewId: z.string(), force: z.boolean().optional(),
    }).strict(),
    out: z.object({
      outlineId: z.string(),
      sections: z.array(OutlineSection),
      status: z.literal("pending_confirm"),
    }).strict(),
    err: [
      "OUTLINE_OVERWRITE_NEEDS_CONFIRM", "AI_GENERATION_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** updateOutlineSection —— 逐段手改 */
  updateOutlineSection: {
    method: "PUT", path: "/interviews/outline-sections/:sectionId",
    in: z.object({
      sectionId: z.string(),
      objective: z.string().nullable(),
      openers: z.array(z.string()).nullable(),
      minutes: z.number().int().nonnegative().nullable(),
    }).strict(),
    out: z.object({
      outlineId: z.string(),
      sections: z.array(OutlineSection),
      status: OutlineStatus,
    }).strict(),
    err: [
      "OUTLINE_INCOMPLETE", "DURATION_EXCEEDS_PLAN",
      "CONCURRENT_MODIFICATION", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** confirmOutline —— 逐段确认。⚠ 未确认即进现场由 `startSession` **服务端拒绝**（I-10） */
  confirmOutline: {
    method: "POST", path: "/interviews/outlines/:outlineId/confirm",
    in: z.object({ outlineId: z.string() }).strict(),
    out: z.object({
      outlineId: z.string(),
      sections: z.array(OutlineSection),
      status: z.literal("confirmed"),
    }).strict(),
    err: [
      "OUTLINE_INCOMPLETE", "DURATION_EXCEEDS_PLAN",
      "CONCURRENT_MODIFICATION", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** readResearchPlanParams —— ⚠ `retentionDays` 是**只读投影**（单源在项目参数，I-12） */
  readResearchPlanParams: {
    method: "GET", path: "/interviews/:interviewId/research-plan",
    in: z.object({ interviewId: z.string() }).strict(),
    out: ResearchPlanParams,
    err: [
      "RETENTION_PARAMS_MISSING", "CONCURRENT_MODIFICATION", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * updateResearchPlanParams —— ⚠ **`in` 里没有 `retentionDays`**：
   * 改它要去改项目的「材料保留期」。契约层就不给第二个写入口（I-12 的机械落点）。
   */
  updateResearchPlanParams: {
    method: "PUT", path: "/interviews/:interviewId/research-plan",
    in: z.object({
      interviewId: z.string(),
      plannedMinutes: z.number().int().positive(),
      sameOrgLimit: z.number().int().positive(),
      trainingProhibited: z.boolean(),
      dataController: z.string(),
      contactName: z.string(),
      complianceEmail: z.string(),
    }).strict(),
    out: ResearchPlanParams,
    err: [
      "RETENTION_PARAMS_MISSING", "CONCURRENT_MODIFICATION", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /* ── D 组 · 受访者授权（uc-6-3）───────────────────────────────── */

  /**
   * issueSigningToken —— 发授权链接（7 天、一次性）。
   * ⚠ 四个渲染变量（保留期/数据控制方/联系人/合规邮箱）任一缺失 ⇒ `RETENTION_PARAMS_MISSING`，
   *   **不发**。发一份告知不完整的同意书**比不发更糟**（E2）。
   */
  issueSigningToken: {
    method: "POST", path: "/interviews/:interviewId/signing-tokens",
    in: z.object({ interviewId: z.string(), subjectId: z.string() }).strict(),
    out: z.object({
      tokenId: z.string(), url: z.string(), expiresAt: z.string(),
    }).strict(),
    err: [
      "RETENTION_PARAMS_MISSING", "CONTACT_REQUIRED",
      "NO_INTERVIEW_ACCESS", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * getConsentPage —— 受访者打开授权页。
   * ⚠ 四项措辞与降级语义**逐字属契约**（AC3）：取消「交给 AI 做分析」当场显示
   *   「你的话只会以原文引述出现，不参与任何自动归纳」；取消署名当场显示
   *   「一律写成『某物流园区运营总监』」。
   * ⚠ `TOKEN_INVALID` 覆盖不存在/过期/已撤销/已使用四种，**不泄露任何访谈内容**。
   */
  getConsentPage: {
    method: "GET", path: "/interviews/consent/:token",
    in: z.object({ token: z.string() }).strict(),
    out: z.object({
      session: z.object({
        subjectAlias: z.string(),
        whenAt: z.string(),
        durationMinutes: z.number().int().nonnegative(),
      }).strict(),
      /** 恒四条，与 `ConsentKey` 一一对应 */
      items: z.array(ConsentItemCopy),
      controller: z.object({
        org: z.string(), contactName: z.string(), complianceEmail: z.string(),
      }).strict(),
      snapshotId: z.string(),
    }).strict(),
    err: ["TOKEN_INVALID"] as const,
  },

  /**
   * submitConsent —— 提交（含 `[全部拒绝]`）。
   * ⚠ **四位全 false 是合法完整结果**，不是失败态，访谈照常可进行。
   * ⚠ 写失败必须**显式对受访者可见**且保留选择（`CONSENT_WRITE_FAILED`）——
   *   **不得显示成功**。最严重的失败模式是「系统认为已授权但本人没提交」。
   * ⚠ 提交同时：签署令牌作废（一次性）+ 签发**门户长效令牌**（I-13）。
   */
  submitConsent: {
    method: "POST", path: "/interviews/consent/:token/submit",
    in: z.object({ token: z.string(), bits: ConsentBits }).strict(),
    out: z.object({
      submissionId: z.string(),
      submittedAt: z.string(),
      snapshotId: z.string(),
      portalToken: z.object({
        tokenId: z.string(), url: z.string(), expiresAt: z.string(),
      }).strict(),
    }).strict(),
    err: [
      "TOKEN_INVALID", "CONSENT_WRITE_FAILED",
      "CONSENT_VERSION_CONFLICT", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * getConsentMirror —— 研究员侧**只读**镜像。
   * ⚠ **本束不提供任何写他人同意位的操作。** `CONSENT_STAFF_READONLY` 存在的唯一目的，
   *   是让门控能对「构造出来的写请求」断言被拒（I-1 / V4）。
   */
  getConsentMirror: {
    method: "GET", path: "/interviews/:interviewId/consent-mirror",
    in: z.object({ interviewId: z.string() }).strict(),
    out: z.object({
      rows: z.array(z.object({
        subjectId: z.string(),
        bits: ConsentBits,
        submittedAt: z.string().nullable(),
        consentStatus: z.string(),
      }).strict()),
      /** 形如 `"3/4"`——研究员任何时刻都要能看到这个数 */
      grantedOfFour: z.string(),
    }).strict(),
    err: ["NO_INTERVIEW_ACCESS"] as const,
  },

  /**
   * configureSessionRolesAndSwitches —— 本场角色 + 七开关。
   * ⚠ 角色用 `SessionRole`（研究员/联合主持/受访者/观察者/记录 agent），
   *   **不是工作坊四角色**。
   * ⚠ 第七开关 `showAiSuggestionsToSubjects` **默认关**；关闭时服务端**不下发**（I-34）。
   */
  configureSessionRolesAndSwitches: {
    method: "PUT", path: "/interviews/:interviewId/session-config",
    in: z.object({
      interviewId: z.string(),
      roles: z.array(z.object({
        subjectId: z.string(), role: SessionRole,
      }).strict()),
      switches: SevenSwitches,
    }).strict(),
    out: z.object({
      roles: z.array(z.object({
        subjectId: z.string(), role: SessionRole,
      }).strict()),
      switches: SevenSwitches,
    }).strict(),
    err: ["NO_INTERVIEW_ACCESS", "CONCURRENT_MODIFICATION"] as const,
  },

  /**
   * startSession —— **开始访谈的硬门禁**。
   * ⚠ **前端禁用 + 服务端拒绝两侧都要验收**。界面出口是 `[去授权]`，
   *   **不存在「仍要开始」的绕过按钮**——所以本操作没有任何 `force` 入参。
   * ⚠ 多人场部分人未授权：其余人可正常进行，未授权者标
   *   「授权未完成，不会被录音或转写」（E5）。
   */
  startSession: {
    method: "POST", path: "/interviews/:interviewId/start",
    in: z.object({ interviewId: z.string() }).strict(),
    out: z.object({
      startedAt: z.string(),
      /** 未授权但仍在场者——他们不被录音/转写，但访谈照常 */
      excludedSubjectIds: z.array(z.string()),
    }).strict(),
    err: [
      "CONSENT_REQUIRED", "OUTLINE_NOT_CONFIRMED",
      "NO_INTERVIEW_ACCESS", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * requestWithdrawal —— 五步撤回编排（与 uc-6-6 共用底座）。
   * ⚠ **部分撤回**只对被撤项执行，其余同意位不受影响。
   * ⚠ 第 03 步**标失效不删除**；对外已发布内容走**人工确认后替换**（D-19，两个方向都禁止静默）。
   * ⚠ 第 04 步**只能产生一条给拍板人的复核任务**，禁止自动改写结论；
   *   超时的后果是**催办，不是自动化**（E4）。
   * ⚠ 访谈进行中收紧某项：**即时生效**，正在跑的 AI 归纳任务**中止**，不等到访谈结束。
   */
  requestWithdrawal: {
    method: "POST", path: "/interviews/withdrawals",
    in: z.object({
      subjectId: z.string(),
      scope: z.array(ConsentKey),
      reason: z.string().nullable(),
      origin: WithdrawalOrigin,
    }).strict(),
    out: z.object({
      withdrawalId: z.string(),
      /** 恒五步 */
      steps: z.array(WithdrawalStep),
    }).strict(),
    err: [
      "TOKEN_SCOPE_VIOLATION", "WITHDRAWAL_IN_PROGRESS", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** getWithdrawalStatus —— 撤回进度 */
  getWithdrawalStatus: {
    method: "GET", path: "/interviews/withdrawals/:withdrawalId",
    in: z.object({ withdrawalId: z.string() }).strict(),
    out: z.object({ steps: z.array(WithdrawalStep) }).strict(),
    err: ["DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * issueDeletionReceipt —— 出删除回执。
   * ⚠ **物理删除未真正完成前不得发出回执**（E3）——`ERASURE_NOT_COMPLETE`
   *   是这条不变量的唯一守门人。回执一旦发出就是对受访者的承诺。
   */
  issueDeletionReceipt: {
    method: "POST", path: "/interviews/withdrawals/:withdrawalId/receipt",
    in: z.object({ withdrawalId: z.string() }).strict(),
    out: z.object({
      scope: z.array(ConsentKey),
      completedAt: z.string(),
      verifiableId: z.string(),
    }).strict(),
    err: ["ERASURE_NOT_COMPLETE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /* ── E 组 · 现场（uc-6-4）─────────────────────────────────────── */

  /**
   * getStageState —— 顶部状态条 + 三栏。
   * ⚠ `授权 N/4` 与「X 不参与 AI 分析」**常驻**——让研究员任何时刻知道
   *   这个人的话能不能给 AI。
   * ⚠ 空态：新开一场无发言时三栏各显示**真实空态**，不生成示例建议或假逐字稿。
   */
  getStageState: {
    method: "GET", path: "/interviews/:interviewId/stage",
    in: z.object({ interviewId: z.string() }).strict(),
    out: z.object({
      elapsed: z.number().int().nonnegative(),
      remaining: z.number().int(),
      /** ⚠ 转写失败条目**单列可重试**，逐字稿留可见缺口，**不静默丢段**（E8） */
      transcriptionFailed: z.number().int().nonnegative(),
      proofreadPending: z.number().int().nonnegative(),
      recording: z.boolean(),
      translating: z.string().nullable(),
      auth: z.object({
        grantedOfFour: z.string(),
        /** 常驻显示：这些人的话不参与 AI 分析 */
        aiOptOutNames: z.array(z.string()),
      }).strict(),
      roster: z.array(z.object({
        subjectId: z.string(), displayName: z.string(), role: SessionRole,
      }).strict()),
      outlineProgress: z.string(),
      sections: z.array(OutlineSection),
      rq: z.array(RqCoverage),
    }).strict(),
    err: ["NO_INTERVIEW_ACCESS", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * setOutlineSectionStatus —— **只有人能写**。
   * ⚠ 记录 agent（Echo）**只能写转写，不写任何状态字段**（R5）——
   *   `writerOrigin` 固定为 `"human"` 正是这条的接口投影。
   */
  setOutlineSectionStatus: {
    method: "POST", path: "/interviews/outline-sections/:sectionId/status",
    in: z.object({
      sectionId: z.string(), status: OutlineSectionStatus,
    }).strict(),
    out: z.object({
      sectionId: z.string(),
      status: OutlineSectionStatus,
      writerOrigin: z.literal("human"),
    }).strict(),
    err: ["AI_WRITE_FORBIDDEN", "CONCURRENT_MODIFICATION", "NO_INTERVIEW_ACCESS"] as const,
  },

  /** setRqCoverage —— 同上，只有人能写 */
  setRqCoverage: {
    method: "POST", path: "/interviews/:interviewId/rq-coverage",
    in: z.object({
      interviewId: z.string(), rqId: z.string(), value: RqCoverageValue,
    }).strict(),
    out: RqCoverage,
    err: ["AI_WRITE_FORBIDDEN", "CONCURRENT_MODIFICATION", "NO_INTERVIEW_ACCESS"] as const,
  },

  /**
   * evaluateSpeakingBalance —— 发言均衡私下提醒。
   * ⚠ 触发需**同时**满足「连续发言 ≥ 阈值（默认 240 秒，可配）」与「他人举手/未答」。
   *   只满足时长而无人举手时**不触发**——否则会在正常长叙述时反复打断研究员
   *   （后台反馈「打断时机过早 👎9」的教训，O-36）。
   * ⚠ **私下 = 只在研究员这一栏出现，不广播、不对受访者可见**（V5 ③）。
   */
  evaluateSpeakingBalance: {
    method: "GET", path: "/interviews/:interviewId/speaking-balance",
    in: z.object({ interviewId: z.string() }).strict(),
    out: z.object({
      alert: z.object({
        continuousSeconds: z.number().int().nonnegative(),
        pendingSpeakerId: z.string(),
        text: z.string(),
      }).strict().nullable(),
    }).strict(),
    err: ["NO_INTERVIEW_ACCESS"] as const,
  },

  /** inviteSpeaker —— 私下邀请某人发言 */
  inviteSpeaker: {
    method: "POST", path: "/interviews/:interviewId/invite-speaker",
    in: z.object({ interviewId: z.string(), subjectId: z.string() }).strict(),
    out: z.object({ invitedAt: z.string(), broadcast: z.literal(false) }).strict(),
    err: ["NO_INTERVIEW_ACCESS"] as const,
  },

  /**
   * listCopilotSuggestions —— 副驾驶建议。
   * ⚠ **副驾驶不可用时现场记录必须继续可用**（转录、提纲勾选、标引述、覆盖度全部照常，E9）——
   *   所以 `COPILOT_UNAVAILABLE` 只影响本端口，不影响 `getStageState`。
   * ⚠ 观察员的人类私密建议走同一栏但 `origin: human_observer`，
   *   **不经 AI 加工原样呈现**并标出提出人。
   * ⚠ 受访者端：`showAiSuggestionsToSubjects` 关闭时**响应体不含该字段**（I-34）。
   */
  listCopilotSuggestions: {
    method: "GET", path: "/interviews/:interviewId/copilot-suggestions",
    in: z.object({
      interviewId: z.string(), since: z.string().optional(),
    }).strict(),
    out: z.object({ items: z.array(CopilotSuggestion) }).strict(),
    err: [
      "SUGGESTION_NO_SOURCE", "SUGGESTION_NOT_FOR_SUBJECT", "COPILOT_UNAVAILABLE",
    ] as const,
  },

  /** actOnSuggestion —— 采纳 / 编辑后采纳 / 忽略 */
  actOnSuggestion: {
    method: "POST", path: "/interviews/copilot-suggestions/:suggestionId/act",
    in: z.object({
      suggestionId: z.string(),
      outcome: SuggestionOutcome,
      editedText: z.string().nullable(),
    }).strict(),
    out: z.object({
      suggestionId: z.string(), outcome: SuggestionOutcome, actedAt: z.string(),
    }).strict(),
    err: ["SUGGESTION_NO_SOURCE", "COPILOT_UNAVAILABLE"] as const,
  },

  /**
   * endAndTranscribe —— 结束并转写。
   * ⚠ 结束页**立刻**返回 5 个 RQ 的覆盖态（AC1）；
   *   转写失败条目**单列可重试，不静默丢段**（E8）。
   */
  endAndTranscribe: {
    method: "POST", path: "/interviews/:interviewId/end",
    in: z.object({ interviewId: z.string() }).strict(),
    out: z.object({
      coverageSummary: z.array(RqCoverage),
      pending: z.object({
        transcriptionFailed: z.number().int().nonnegative(),
        proofread: z.number().int().nonnegative(),
      }).strict(),
    }).strict(),
    err: ["TRANSCRIPTION_FAILED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /* ── F 组 · 回流成洞察（uc-6-5）───────────────────────────────── */

  /**
   * buildInterviewContextPack —— **per-speaker 前置过滤**（本束合规核心，F93）。
   * ⚠ **过滤发生在这里，不在出口**：`ai_analysis = false` 的受访者片段
   *   **根本不进 `items`**（I-4 / O-05）。出口遮盖是错的实现：模型已经读过了。
   * ⚠ `omissions` 只记**类别与条数**，不泄露被排除者的内容。
   * ⚠ 🔗 `omissions[].reason` 的枚举是 **context-pack 束的单源**（phase-00 已收敛为 7 类），
   *   本束**直接 import 它，不再造一份**——这正是本仓「同一事实两处声明」的高发点。
   */
  buildInterviewContextPack: {
    method: "POST", path: "/interviews/:interviewId/context-pack",
    in: z.object({
      interviewId: z.string(),
      purpose: z.enum(["copilot", "insight", "outline", "template-extract"]),
    }).strict(),
    out: z.object({
      contextPackId: z.string(),
      items: z.array(z.object({
        itemId: z.string(), segmentId: z.string(), subjectId: z.string(),
      }).strict()),
      omissions: z.array(z.object({
        /** ⚠ **引用 context-pack 束的单源枚举**，本束不重列七类 */
        reason: OmissionReasonSchema,
        count: z.number().int().nonnegative(),
      }).strict()),
    }).strict(),
    err: ["DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * extractQuotes —— 人工抽引述。
   * ⚠ **对 `ai_analysis = false` 的受访者，这个用例照样返回原文**——
   *   限制的是**经模型的处理**，不是研究员的判断。这条最容易被过度实现成「一律不给看」。
   */
  extractQuotes: {
    method: "POST", path: "/interviews/:interviewId/quotes",
    in: z.object({
      interviewId: z.string(),
      segmentIds: z.array(z.string()),
      rqBinding: z.string().nullable(),
    }).strict(),
    out: z.object({ quotes: z.array(Quote) }).strict(),
    err: ["NO_INTERVIEW_ACCESS"] as const,
  },

  /**
   * generateCandidateInsights —— 生成候选洞察。
   * ⚠ 候选**不直接入库**；本次归纳的**排除名单写入留痕**（V2 ⑤）。
   * ⚠ 失败时已抽引述保留，**不产出半截洞察**（E11 / V11）。
   * ⚠ 全员拒绝 AI 分析时退化为「只出引述、不出候选洞察」并**显式说明**（E8）——
   *   `candidates: []` + `degradedToQuotesOnly: true`，不是一个错误。
   */
  generateCandidateInsights: {
    method: "POST", path: "/interviews/insights/candidates",
    in: z.object({
      interviewId: z.string().nullable(),
      themeScope: z.string().nullable(),
      contextPackId: z.string(),
    }).strict(),
    out: z.object({
      candidates: z.array(Insight),
      /** 排除名单**写入留痕**，不是静默跳过 */
      excludedSubjectIds: z.array(z.string()),
      degradedToQuotesOnly: z.boolean(),
    }).strict(),
    err: [
      "INSIGHT_NO_EVIDENCE", "AI_GENERATION_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** confirmInsight —— ⚠ 每条洞察**至少挂 1 条证据**；入库时**固化来源快照** */
  confirmInsight: {
    method: "POST", path: "/interviews/insights/:candidateId/confirm",
    in: z.object({
      candidateId: z.string(), edits: z.string().nullable(),
    }).strict(),
    out: Insight,
    err: [
      "INSIGHT_NO_EVIDENCE", "CONCURRENT_MODIFICATION", "REQUIRES_PINNED",
    ] as const,
  },

  /** getEvidenceMatrix —— ⚠ 头部含 `sessionCount` 与 `subjectCount` **两个数** */
  getEvidenceMatrix: {
    method: "GET", path: "/interviews/evidence-matrix",
    in: z.object({ scope: InterviewScope }).strict(),
    out: EvidenceMatrix,
    err: ["NO_INTERVIEW_ACCESS", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * mergeThemes —— ⚠ **AI 不得自动合并主题**：合并/拆分/调权都是人的显式动作，
   * 留痕且**可回滚**（A3 / V12）。
   * ⚠ `[合并主题]` 前应预览「合并会让哪些格子消失」，尤其提示是否会抹掉唯一 `反例`——
   *   `preview: true` 走预检不写库，`vanishingCells` 就是那份预览。
   */
  mergeThemes: {
    method: "POST", path: "/interviews/themes/merge",
    in: z.object({
      themeIds: z.array(z.string()),
      preview: z.boolean(),
    }).strict(),
    out: z.object({
      mergedThemeId: z.string().nullable(),
      vanishingCells: z.array(z.object({
        themeId: z.string(), subjectId: z.string(), counterexample: z.boolean(),
      }).strict()),
      revertToken: z.string().nullable(),
    }).strict(),
    err: ["COUNTEREXAMPLE_WOULD_VANISH", "CONCURRENT_MODIFICATION"] as const,
  },

  /** splitThemes —— 人的显式动作，留痕可回滚 */
  splitThemes: {
    method: "POST", path: "/interviews/themes/:themeId/split",
    in: z.object({
      themeId: z.string(), intoLabels: z.array(z.string()),
    }).strict(),
    out: z.object({
      themeIds: z.array(z.string()), revertToken: z.string(),
    }).strict(),
    err: ["COUNTEREXAMPLE_WOULD_VANISH", "CONCURRENT_MODIFICATION"] as const,
  },

  /** adjustEvidenceWeight —— 同上。⚠ 调权同样可能抹掉唯一反例 */
  adjustEvidenceWeight: {
    method: "POST", path: "/interviews/evidence/:quoteId/weight",
    in: z.object({ quoteId: z.string(), weight: z.number() }).strict(),
    out: z.object({ quoteId: z.string(), weight: z.number(), revertToken: z.string() }).strict(),
    err: ["COUNTEREXAMPLE_WOULD_VANISH", "CONCURRENT_MODIFICATION"] as const,
  },

  /**
   * markStrongInsight —— **虚拟隔离的接口层门**（V3）。
   * ⚠ **只有真人来源能标强**。虚拟来源一律 `VIRTUAL_SOURCE_FORBIDDEN`——
   *   **接口层拒绝，不是按钮置灰**（AC3）。
   */
  markStrongInsight: {
    method: "POST", path: "/interviews/insights/:insightId/mark-strong",
    in: z.object({ insightId: z.string() }).strict(),
    out: z.object({ ok: z.literal(true) }).strict(),
    err: ["VIRTUAL_SOURCE_FORBIDDEN", "REQUIRES_PINNED"] as const,
  },

  /**
   * referenceForDecision —— 引用为决策依据。
   * ⚠ 同上：虚拟推演**不能作为强证据**，也不能进决策依据（I-28）。
   */
  referenceForDecision: {
    method: "POST", path: "/interviews/insights/:insightId/decision-reference",
    in: z.object({ insightId: z.string(), decisionId: z.string() }).strict(),
    out: z.object({ ok: z.literal(true) }).strict(),
    err: ["VIRTUAL_SOURCE_FORBIDDEN", "REQUIRES_PINNED"] as const,
  },

  /**
   * checkGeneralizationClaim —— 写作约束。
   * ⚠ 阈值 **5**（普遍性断言）与 **8**（跨组织不可逆聚合）是**全仓单一门槛**（O-16 / D-16），
   *   本束**只引用不重新声明**——所以契约里没有这两个数字，只有判定结果。
   * ⚠ 提示文案必须给出**实际的独立受访者数**。
   */
  checkGeneralizationClaim: {
    method: "POST", path: "/interviews/themes/:themeId/generalization-check",
    in: z.object({ themeId: z.string(), draftText: z.string() }).strict(),
    out: z.object({
      blocked: z.boolean(),
      independentSubjects: z.number().int().nonnegative(),
      suggestion: z.string().nullable(),
    }).strict(),
    err: ["GENERALIZATION_UNSUPPORTED"] as const,
  },

  /* ── G 组 · 受访者自助门户（uc-6-6）───────────────────────────── */

  /**
   * getPortalView —— 门户主视图。
   * ⚠ 默认是**只读展示 + 三个显式动作入口**，不把编辑态作为默认态（A3）。
   * ⚠ 令牌失效时**响应体不含任何访谈内容**（V9）。
   */
  getPortalView: {
    method: "GET", path: "/interviews/portal/:portalToken",
    in: z.object({ portalToken: z.string() }).strict(),
    out: z.object({
      bits: ConsentBits,
      submittedAt: z.string(),
      snapshot: z.object({
        snapshotId: z.string(), renderedText: z.string(),
      }).strict(),
      requests: z.array(SubjectRequest),
      controller: z.object({
        org: z.string(), contactName: z.string(), complianceEmail: z.string(),
      }).strict(),
    }).strict(),
    err: ["TOKEN_INVALID", "TOKEN_SCOPE_VIOLATION"] as const,
  },

  /**
   * updateConsentFromPortal —— 本人改同意位。
   * ⚠ **收紧即时生效并触发撤回流；放宽不追溯**——
   *   不得为「补齐」去重新转写已删除的音频（R7）。
   * ⚠ 每次变更**追加一条历史版本，不覆盖**（I-16）；研究员侧只读镜像同步更新。
   */
  updateConsentFromPortal: {
    method: "POST", path: "/interviews/portal/:portalToken/consent",
    in: z.object({ portalToken: z.string(), bits: ConsentBits }).strict(),
    out: z.object({
      submissionId: z.string(),
      submittedAt: z.string(),
      /** 收紧时非空 */
      triggeredWithdrawalId: z.string().nullable(),
    }).strict(),
    err: ["TOKEN_INVALID", "CONSENT_WRITE_FAILED", "WITHDRAWAL_IN_PROGRESS"] as const,
  },

  /**
   * requestTranscriptCopy —— 索取本人逐字稿副本。
   * ⚠ 副本**只含本人发言**：不含他人发言、研究员笔记、AI 建议、主题与洞察；
   *   他人 PII 保持遮盖。
   * ⚠ **[待定 D-8]**：本人 PII 是否对本人解遮盖；交付方式与时限。见 KNOWN_CONTRACT_GAPS。
   */
  requestTranscriptCopy: {
    method: "POST", path: "/interviews/portal/:portalToken/transcript-copy",
    in: z.object({ portalToken: z.string() }).strict(),
    out: z.object({
      requestId: z.string(),
      status: z.string(),
      /** 短时效、一次性链接 */
      downloadUrl: z.string().nullable(),
      expiresAt: z.string().nullable(),
    }).strict(),
    err: [
      "COPY_GENERATION_FAILED", "TOKEN_SCOPE_VIOLATION", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * requestErasure —— 请求删除。
   * ⚠ 返回体**必须含四段说明**：会删 / 不会删 / 时限 / 不可逆——**缺任一段视为失败**（V10）。
   * ⚠ 「不会删」的清单依赖 **[待定 D-9] 法定留存清单**（合规外部输入）。
   *   **不得承诺「全部消失」而实际做不到。**
   */
  requestErasure: {
    method: "POST", path: "/interviews/portal/:portalToken/erasure",
    in: z.object({
      portalToken: z.string(), acknowledged: z.literal(true),
    }).strict(),
    out: z.object({
      requestId: z.string(),
      willDelete: z.array(z.string()),
      /** ⚠ 依赖法定留存清单（[待定 D-9]）。空数组**不等于**「全部会删」 */
      willNotDelete: z.array(z.string()),
      slaText: z.string(),
      irreversible: z.literal(true),
    }).strict(),
    err: ["TOKEN_SCOPE_VIOLATION", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * listSubjectRequests —— ⚠ 每条请求返回**状态与预计完成时间**，且随流水线推进更新——
   * **不能只给一句「已提交」就没有下文**（V6）。
   */
  listSubjectRequests: {
    method: "GET", path: "/interviews/portal/:portalToken/requests",
    in: z.object({ portalToken: z.string() }).strict(),
    out: z.object({ items: z.array(SubjectRequest) }).strict(),
    err: ["TOKEN_SCOPE_VIOLATION", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /* ── H 组 · 访谈对象表（uc-6-7）───────────────────────────────── */

  /**
   * listSubjects —— 对象表。
   * ⚠ **观察者不可读对象表**（它含联系方式与未发布的研究意图）。
   * ⚠ 空表给 `[AI 建议人选]` 与 `[＋ 加对象]` 两个出口，**不预置示例对象**。
   * ⚠ `contact` **恒为 mask**——明文只有 `revealContact` 一条路。
   */
  listSubjects: {
    method: "GET", path: "/interviews/subjects",
    in: z.object({
      groupId: z.string().nullable(),
      interviewId: z.string().nullable(),
      filters: z.string().nullable(),
      cursor: z.string().nullable(),
    }).strict(),
    out: z.object({ items: z.array(Subject) }).strict(),
    err: [
      "NO_INTERVIEW_ACCESS", "CONCURRENT_MODIFICATION", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** createSubject */
  createSubject: {
    method: "POST", path: "/interviews/subjects",
    in: z.object({
      displayName: z.string(),
      roleTitle: z.string(),
      orgName: z.string().nullable(),
      groupId: z.string().nullable(),
      contact: z.string().nullable(),
      sourceKind: InterviewSourceKind,
    }).strict(),
    out: Subject,
    err: [
      "NO_INTERVIEW_ACCESS", "CONCURRENT_MODIFICATION", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** updateSubject */
  updateSubject: {
    method: "PUT", path: "/interviews/subjects/:subjectId",
    in: z.object({
      subjectId: z.string(),
      displayName: z.string().nullable(),
      roleTitle: z.string().nullable(),
      orgName: z.string().nullable(),
      groupId: z.string().nullable(),
      contact: z.string().nullable(),
    }).strict(),
    out: Subject,
    err: [
      "NO_INTERVIEW_ACCESS", "CONCURRENT_MODIFICATION", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * revealContact —— 取联系方式明文。
   * ⚠ **agent 主体一律拒绝**（`CONTACT_PLAINTEXT_DENIED`）——这不是权限配置能开的。
   * ⚠ **取到明文也写审计**（不只是被拒时写，I-21）。
   */
  revealContact: {
    method: "POST", path: "/interviews/subjects/:subjectId/reveal-contact",
    in: z.object({
      subjectId: z.string(), purpose: ContactRevealPurpose,
    }).strict(),
    out: z.object({ plaintext: z.string(), auditEventId: z.string() }).strict(),
    err: ["CONTACT_PLAINTEXT_DENIED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * exportSubjects —— 导出对象表。
   * ⚠ **默认不含联系方式**；含联系方式的导出是**独立授权动作**——
   *   所以 `includeContact` 只能是 `false`，契约层不给这个口子。
   */
  exportSubjects: {
    method: "POST", path: "/interviews/subjects/export",
    in: z.object({
      scope: InterviewScope, includeContact: z.literal(false),
    }).strict(),
    out: z.object({ fileId: z.string() }).strict(),
    err: ["CONTACT_PLAINTEXT_DENIED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * suggestCandidates —— AI 建议人选。
   * ⚠ **不在表中直接生成行**（候选态）；**候选中不含联系方式明文**；
   *   经人确认后才写入（I-23）。
   * ⚠ AI 服务不可用时**手工加对象仍可用**（V12）——所以 `AI_GENERATION_UNAVAILABLE`
   *   只落在本端口，不落在 `createSubject`。
   */
  suggestCandidates: {
    method: "POST", path: "/interviews/subjects/suggest",
    in: z.object({ groupId: z.string() }).strict(),
    out: z.object({
      candidates: z.array(z.object({
        candidateId: z.string(),
        name: z.string().nullable(),
        roleTitle: z.string(),
        reason: z.string(),
        sources: z.array(z.string()),
        origin: z.literal("ai"),
        /** 重复人选**合并提示**而不是产生重复行；合并需人工确认且保留两条来源记录（E2） */
        duplicateOfSubjectId: z.string().nullable(),
      }).strict()),
    }).strict(),
    err: ["AI_GENERATION_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** acceptCandidate —— 经人确认后写入 */
  acceptCandidate: {
    method: "POST", path: "/interviews/subjects/candidates/:candidateId/accept",
    in: z.object({
      candidateId: z.string(), edits: z.string().nullable(),
    }).strict(),
    out: Subject,
    err: ["CONCURRENT_MODIFICATION", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * draftBookingInvite —— 生成预约草稿。
   * ⚠ **draft 阶段零外发调用**（I-24 / D-28，外发邮件恒 R3）。
   */
  draftBookingInvite: {
    method: "POST", path: "/interviews/subjects/:subjectId/booking-draft",
    in: z.object({
      subjectId: z.string(), slots: z.array(z.string()),
    }).strict(),
    out: z.object({
      draftId: z.string(), text: z.string(), slots: z.array(z.string()),
    }).strict(),
    err: ["OUTBOUND_REQUIRES_HUMAN", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * sendBookingInvite —— 外发。
   * ⚠ **只能由人类主体触发**；agent 试图直接外发一律 `OUTBOUND_REQUIRES_HUMAN`。
   */
  sendBookingInvite: {
    method: "POST", path: "/interviews/booking-drafts/:draftId/send",
    in: z.object({ draftId: z.string() }).strict(),
    out: z.object({ sentAt: z.string(), auditEventId: z.string() }).strict(),
    err: ["OUTBOUND_REQUIRES_HUMAN", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * routeTranscriptToGroup —— 转写回流到组。
   * ⚠ 回流携带**来源资源、版本、触发者、时间与可见范围**；正式引用绑**固定快照**（I-30）。
   * ⚠ `ai_analysis = false` 的对象：回流内容**不参与本组推演模板的自动填充**，
   *   只能以原文引述出现（V8）。
   * ⚠ 撤回后表上**保留该行**但状态为「已撤回」，内容已退出检索——
   *   **不得因为表上还有这一行就以为数据还在**（V9 / E7）。
   */
  routeTranscriptToGroup: {
    method: "POST", path: "/interviews/:interviewId/route-transcript",
    in: z.object({ interviewId: z.string(), subjectId: z.string() }).strict(),
    out: z.object({
      groupId: z.string(),
      artifactRefs: z.array(z.object({
        artifactId: z.string(), versionId: z.string(),
      }).strict()),
      /** true = 该对象拒绝 AI 分析，内容只以原文引述出现，不进自动填充 */
      quotesOnly: z.boolean(),
    }).strict(),
    err: [
      "SUBJECT_NOT_GROUPED", "REQUIRES_PINNED", "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },
} as const;

export type Operations = typeof operations;
export type OperationName = keyof Operations;

/* ────────────── 跨束「同码同义」的编译期门控（硬要求 ②）────────────── */

type ArtifactErrorT = z.infer<typeof ArtifactError>;
type ContextPackReasonT = z.infer<typeof ContextPackReason>;
type InterviewErrorT = z.infer<typeof InterviewError>;

/**
 * 交集类型 `(A & B)[]` 的成员只能是**两侧都存在**的字面量。
 * 任何一侧改名/删除，`tsc` 立刻红。
 */
export const INTERVIEW_SHARED_WITH_ARTIFACT = [
  "REQUIRES_PINNED",
] as const satisfies readonly (ArtifactErrorT & InterviewErrorT)[];

export const INTERVIEW_SHARED_WITH_CONTEXT_PACK = [
  "PERMISSION_REVOKED_MIDWAY",
] as const satisfies readonly (ContextPackReasonT & InterviewErrorT)[];

/**
 * ⚠ **访谈没有引导师/组长**（人类 2026-07-30 亲自纠正）。
 *
 * 这条断言把它变成会红的东西：`SessionRole` 与 `identity.ProjectRole` 的交集**必须为空**。
 * 有人「顺手把 facilitator 加进 SessionRole 对齐一下」时，`AssertNever` 立刻编译失败。
 *
 * ⚠ 用 `AssertNever` 而不是 `[] as const satisfies readonly never[]`：
 *   后者写法**空数组永远通过**，是一条空转的断言。
 */
type AssertNever<T extends never> = T;
export type SessionRoleMustNotOverlapProjectRole = AssertNever<
  z.infer<typeof SessionRole> & ("facilitator" | "groupLead" | "member")
>;

/* ─────────────────────── 已知契约缺陷（如实登记）─────────────────────── */

export const KNOWN_CONTRACT_GAPS = {
  /**
   * 🔴 **报告模板 → 洞察报告 这一段主线在本束没有任何端口。**
   *
   * 人类给的主线是：模板创建 → 套用新建访谈 → 质性/虚拟推演访谈 → **报告模板 → 洞察报告**。
   * 前三段在 `usecases.md` 里有完整用例（B/C/D/E/F 组），**后两段一条都没有**：
   * 全文没有 `reportTemplate` / `insightReport` 之类的用例，只有 `Insight` 与
   * `EvidenceMatrix` 这两个中间产物。
   *
   * 本束**没有发明它们**——发明等于替产品设计整个报告产品，而那是另一次签核。
   * ⇒ 后果照实说：主线的最后两段在契约层**不存在**，
   *   `Insight` 之后到「一份洞察报告」之间**无路可走**。
   */
  C_ITV_1: "the last two stages of the main line (report template -> insight report) have NO use cases in usecases.md and no ports here; not invented",

  /**
   * **[已裁 —— 2026-08-05，coord-main 经人类授权，issue #533]**
   *
   * ⚠ 这条不删，保留是为了能看出**裁过什么**：原文记的是「同意位有两套：本束四位
   * vs `recording` 束三项，前三位同名同义却是两份独立声明，改了名字谁也不报警」，
   * 并断言「recording 不需要 `attribution`，这是合理的」。
   *
   * **裁决推翻了那句「合理」**：严格子集 + 逐字相同的三项 = 遗漏的形状，不是设计的形状；
   * 且工作坊/线程录音同样产出可引述片段，同样需要问「能不能署名引述你」。
   * ⇒ 两处收敛为 `./consent-item` 的 `CONSENT_ITEMS`（四项），
   *   `ConsentKey` 与 `RecordingConsentItem` 都是它的别名；
   *   门控见 `apps/api/tests/rec/consent-items-single-source.test.ts`。
   */
  C_ITV_2: "RESOLVED 2026-08-05 (#533): consent items converged to ONE four-member source (contracts/src/consent-item.ts); interview + recording are aliases of it",

  /**
   * **`[待定 D-6]`：`OUTLINE_INCOMPLETE` 是否阻断进现场，未裁。**
   *
   * 本契约把它挂在 `updateOutlineSection` / `confirmOutline` 上（写时校验），
   * 而 `startSession` 的 `err` 里**只有 `OUTLINE_NOT_CONFIRMED`，没有它**。
   * 这等于**默认取了「不阻断」**——一份「2 段还需你改问法」的大纲，
   * 只要被确认过就能进现场。
   *
   * 这是本束替 UC 做的选择，请签核时确认。取「阻断」时要把它加进 `startSession.err`。
   */
  C_ITV_3: "D-6 undecided: OUTLINE_INCOMPLETE is currently write-time only, so startSession does NOT block on it — this is a default chosen by the contract",

  /**
   * **`[待定 D-16]` 模板可见范围三档 / `[待定 D-8]` 本人 PII 解遮盖 / `[待定 D-9]` 法定留存清单。**
   *
   * · 模板可见范围三档未定 ⇒ `createTemplate` / `updateTemplate` 的 `in` 里**没有
   *   visibility 字段**。编一个（比如照抄 `org-wide | team-only`）会让契约看起来
   *   覆盖了那件事，而它是空的。
   * · 本人 PII 是否对本人解遮盖、交付方式与时限未定 ⇒ `requestTranscriptCopy.out`
   *   的 `downloadUrl` / `expiresAt` 都可空，**没有任何字段表达遮盖策略**。
   * · 法定留存清单（🔴 已在 `thresholds.legalHoldCategories` 登记为真阻塞）未定 ⇒
   *   `requestErasure.out.willNotDelete` 的内容**算不出来**。
   *   **不得承诺「全部消失」而实际做不到。**
   */
  C_ITV_4: "D-16 (template visibility tiers), D-8 (self PII unmasking + delivery), D-9 (legal hold list) are all undecided; the corresponding fields are absent or uncomputable rather than invented",

  /**
   * **`checkQuestionQuality` 的「诱导性」判据是跨模块借证（uc-6-1/E1 自标 [设计]）。**
   *
   * 「诱导」二字在原型档案里只命中**问卷**侧；访谈侧只有 `2 段还需你改问法`。
   * 同理 `extractTemplateDraft` 整个建立在标签页括注「来自 3 场项目」
   * 一个**语义未定的字符串**上（uc-6-1/A3 自标 [设计]）。
   * 两处的端口形状都是推的，需人类确认。
   */
  C_ITV_5: "question-quality 'leading question' criterion and reverse template extraction are both borrowed from the survey side / an undefined label string; shapes are designed, not derived",

  /**
   * **`Insight.sourceKind` 的传播规则没写在任何地方。**
   *
   * 一条洞察挂了 5 条引述，其中 4 条来自真人、1 条来自虚拟推演——
   * 这条洞察的 `sourceKind` 是什么？能不能标强？
   * I-28 只说「虚拟来源不能标强」，**没说混合来源怎么算**。
   *
   * 本契约把 `sourceKind` 做成 `Insight` 上的**存储字段**而不是现算，
   * 是为了让这个判定有一个可审计的落点；但**判定规则本身缺失**。
   * 最安全的默认（任一虚拟即整条不可标强）是本束的推测，**不是 UC 写的**。
   */
  C_ITV_6: "no rule for Insight.sourceKind when evidence mixes human and virtual sources; 'any virtual taints the whole insight' is this bundle's guess",

  /**
   * **`CONSENT_STAFF_READONLY` 在契约里不可达。**
   *
   * 本束**刻意不提供**任何写他人同意位的操作（I-1），所以这个码
   * 不出现在任何 `operations[*].err` 里。它只存在于 `InterviewError` 枚举中，
   * 供门控对「构造出来的写请求」断言被拒。
   *
   * 与 `identity` 束「不提供 `DELETE /organizations` 而不是提供但恒拒」是同一手法，
   * 但那边有 `no-forbidden-routes.test.ts` 守着「路由表里不该有它」。
   * ⇒ 本束的对应禁止路由**已加进那份测试**；若将来有人加了
   * `POST /interviews/:id/consent-mirror/:subjectId` 之类的写口，那道门会红。
   */
  C_ITV_7: "CONSENT_STAFF_READONLY is unreachable by design (no staff-write port exists); its guard is the forbidden-routes test, not an err list",
} as const;
