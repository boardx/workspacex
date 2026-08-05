/**
 * 契约束 `skills` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西，任何一样都不许手写第二份——
 *   ├─→ 后端 DTO + NestJS 全局 ValidationPipe 的运行时校验
 *   ├─→ 前端 client 类型
 *   ├─→ OpenAPI（对外文档 + 契约 diff 门控）
 *   └─→ 前端 mock 数据
 *
 * 覆盖 feature：**F61–F68**（8 件）
 * 依据 UC：`contracts/skills/usecases.md`（六节：契约与门禁 / 绑定 / 临时挂载 / 版本 / 晋升 / 反馈）
 * 领域模型：同目录 `domain.md`
 *
 * ## 本束的三条不变量（改它们等于改产品）
 *   · **D-06：Skill = 声明式契约**（提示词模板 + 输入输出 schema + 数据范围），
 *     phase-1 **无沙箱** —— 所以没有任何「上传代码 / 执行代码」的操作，
 *     `runSecurityScan` 扫的是**声明式内容本身**（注入模式 / 越权数据范围 / 外泄倾向）
 *   · **双重门禁**：方法论审核（人工）+ 安全扫描（自动），且**提交人 ≠ 审核人**（F62）；
 *     任何绕过路径（直接置 `已启用`）⇒ `GATE_NOT_PASSED` **并写安全审计**
 *   · **版本快照不可变**：发新版 ⇒ `vN+1` 生效、`vN` **自动归档**、
 *     **已建实例锁版本**（F66 / I-6）——现场不因后台发版而漂移
 *
 * ## ⚠ 本文件刻意**没有**的东西（缺了是结论，不是遗漏）
 *   · 满意度最小样本量 —— **数值来自 `thresholds.ts`**（usecases.md:410 逐字），
 *     本文件只落「样本不足时不返回数值分数」这个形状
 *   · `saveAsOrgTemplate` —— **它在 `templates` 束**（`SOLE_SAVE_AS_ORG_TEMPLATE_OPERATION`）。
 *     两束的 usecases.md 都写了它，**两处声明就是第二份事实源**
 *   · 沙箱 / 运行时隔离 —— D-06 已裁 phase-1 无沙箱，不留半个接口
 *
 * ⚠ **一个不会被任何路径抛出的错误码读起来像覆盖，而它什么都没覆盖。**
 *   `SkillError` 的每一个成员都在下方某个操作的 `err` 里出现。
 */
import { z } from "zod";
import { ArtifactError } from "./artifact";
import { AgentRuntimeError } from "./agent-runtime";

/* ─────────────────────────── 枚举 ─────────────────────────── */

/**
 * Skill 生命周期。⚠ **只有 `已启用` 进可绑定池**——
 * 草稿 / 待审核 / 已停用**都不进**（`SKILL_NOT_ENABLED`）。
 */
export const SkillStatus = z.enum(["草稿", "待审核", "被退回", "已启用", "已停用"]);

/** 版本态。⚠ `待上线` 是 E5 的落点：复核通过但发版失败时提案停在这里，`vN` 保持生效 */
export const SkillVersionState = z.enum(["草稿", "待审核", "已生效", "已归档", "待上线"]);

/**
 * 来源标记。⚠ **由系统按入口打标，入参无此字段**（I-11 / V10）：
 * 试图写入或改写它 ⇒ `SOURCE_TAG_IMMUTABLE`。
 * ⚠ `CC` = 内置（`BUILTIN_NOT_DELETABLE` 的判据），**只能停用/隐藏，不能删**。
 */
export const SkillSource = z.enum(["自建", "晋升生成", "CC"]);

/** 安全扫描三档。⚠ `risk-pending-confirm` **不是错误**——转审核人裁决，确认理由留痕 */
export const SecurityScanVerdict = z.enum(["pass", "risk-pending-confirm", "reject"]);

/**
 * 绑定槽的类型。⚠ 往 skill 槽写画布模板 / agent 产物（或反之）⇒ `SLOT_KIND_MISMATCH`（I-15）。
 * **不是**一个「万能绑定字段」——那样两类东西会在同一列里互相顶替。
 */
export const SlotKind = z.enum(["skill", "canvas-template", "agent-output"]);

/** 四个入口**共用同一份可见性过滤判定**（I-14）。四处各写一遍就是第 N 次「同一事实多处声明」 */
export const SkillListEntry = z.enum(["library", "search", "binding-panel", "chat-mount"]);

/** 评价二值。⚠ 口径 `👍/(👍+👎)`，**不含未评价、不加权**（O-37） */
export const RatingVerdict = z.enum(["up", "down"]);

/** 聚合项的人工归类。⚠ 只有 `contract-solvable` 能生成改进提案（`NOT_CONTRACT_SOLVABLE`） */
export const SuggestionCategory = z.enum([
  "contract-solvable",
  "implementation-defect",
  "model-limited",
]);

/** 源知识状态变化（E5/E6/E7 联动） */
export const SourceKnowledgeState = z.enum(["待复核", "被推翻", "被撤销", "被替代"]);

/** 联动效果三档。⚠ `待复核` → **标注不自动停用**（domain D-j 待裁），`被推翻/被撤销` → 自动停用**不硬删** */
export const KnowledgeChangeEffect = z.enum(["annotate", "disable", "new-version"]);

/** 复核 / 审核的两个出口 */
export const ReviewDecision = z.enum(["approve", "reject"]);

/**
 * **组织管理员指派的评审职能**（F62；I-5/O-21）。
 *
 * ⚠ 两职能**不合并**：`methodology-reviewer` 只裁「批准发布 skill」，
 *   `security-reviewer` 只裁「工具白名单越权申请」（`agent-runtime` 束的会签，
 *   同一条纪律见 `KNOWN_CONTRACT_GAPS.S7`：本束 `REVIEWER_FUNCTION_MISMATCH`
 *   与 `agent-runtime.WRONG_REVIEW_FUNCTION` 同义不同码）。
 * ⚠ 两职能都**由组织管理员指派**，不是自助申领——本文件不建"申领"操作，
 *   指派动作属组织管理域（`identity`/`auth` 束），本束只消费指派结果。
 */
export const ReviewerFunction = z.enum(["methodology-reviewer", "security-reviewer"]);

/**
 * 停用收尾方式。
 * ⚠ **复用 phase-1 已建成的 `DisableDialog`**（立即中断 / 跑完当前一轮）——
 *   `usecases.md` 逐字「**同一事实不得再写一份**」。
 *   ⚠ 它与 `agent-runtime.DisableMode` 是**同一个闭集的两处声明**，
 *     已登记为 `KNOWN_CONTRACT_GAPS.S6`（收敛属修订两束，不在本文件顺手做）。
 */
export const DisableMode = z.enum(["interrupt", "drain"]);

/* ─────────────────────────── 失败面 ─────────────────────────── */

/**
 * 本束的统一失败枚举。**每一个成员都在下方某个操作的 `err` 里出现**。
 *
 * ⚠ `SAMPLE_INSUFFICIENT` **不在这里**：`usecases.md` 自己写着它「是**一种正常返回态**，
 *   不是错误」。把它写成错误码会让前端在一个正常的空样本上渲染失败态——
 *   本文件改为把它落在 `getSatisfaction.out` 的形状里（`value: null ⟺ insufficient`）。
 */
export const SkillError = z.enum([
  /* ── ① 与已签核束同码同义（下方 `_sharedWith*` 是编译期门控）───────── */
  /** 超时/网络/下游不可用。⚠ 已保留当前输入与最后成功数据，可安全重试 */
  "DEPENDENCY_UNAVAILABLE",

  /* ── ② 契约与门禁 ────────────────────────────────────────────── */
  /** 静态契约校验失败（必填缺 / schema 不可解析或不自洽 / 无失败兜底声明）。⚠ **不入库** */
  "CONTRACT_VALIDATION_FAILED",
  /** 数据范围越出提交人当前权限（I-12）。⚠ **不进待审核队列**（E1/V6） */
  "DATA_SCOPE_EXCEEDS_SUBMITTER",
  /** 上一条的具名子类，因界面文案不同故单列 */
  "RAW_TRANSCRIPT_NOT_AUTHORIZED",
  /** 安全扫描判 `reject` */
  "SECURITY_SCAN_REJECTED",
  /** 未过双门禁却尝试置为已启用/生效（I-23）。⚠ **写安全审计**（V2） */
  "GATE_NOT_PASSED",
  /** 提交人 = 审核人/复核人（I-4） */
  "SELF_REVIEW_FORBIDDEN",
  /** 组织内无第二名审核人（A4）。⚠ 与上一条**区分**：这是组织配置问题不是操作错误，且**明确阻断** */
  "NO_SECOND_REVIEWER",
  /** 用错职能裁决（I-5）：方法论审核人裁权限 / 安全评审人批 skill */
  "REVIEWER_FUNCTION_MISMATCH",
  /** 不存在**或可见性范围外**。⚠ I-14：**404 非 403**，不得泄露存在性 */
  "SKILL_NOT_FOUND",
  /** 绑定/挂载了非 `已启用` 的 skill */
  "SKILL_NOT_ENABLED",
  /** 并发改版/停用/编排（E5）。⚠ 乐观并发 `expectedVersion`，**不得静默覆盖** */
  "SKILL_VERSION_CHANGED",
  /** 试跑输出不符合 schema。⚠ **不入库**，返回失败原因 + **可复制日志**（E2/V7） */
  "TRIAL_RUN_SCHEMA_MISMATCH",
  /** 依赖模型被停用/不可用。⚠ **不得静默换模型**（V8 / UC-3.4 V6） */
  "MODEL_UNAVAILABLE",
  /** 依赖的 MCP 被隔离（UC-3.2 E2） */
  "MCP_ISOLATED",

  /* ── ③ 绑定与编排 ────────────────────────────────────────────── */
  /** 对存在任何引用的 skill 硬删。⚠ **永久拒绝 + 返回引用清单**（I-13/V3） */
  "HARD_DELETE_FORBIDDEN",
  /** 删 `source = CC` 的内置 skill。⚠ 内置不可删，只能停用/隐藏（A4/V7） */
  "BUILTIN_NOT_DELETABLE",
  /** 未先列引用清单就停用。⚠ 「**无清单不得停用**」（R7） */
  "REFERENCES_NOT_ENUMERATED",
  /** 往 skill 槽写画布模板/agent 产物（或反之）（I-15） */
  "SLOT_KIND_MISMATCH",
  /** 实例级写操作试图改模板本体（I-17）。⚠ 请走「另存为组织模板」 */
  "TEMPLATE_WRITEBACK_FORBIDDEN",
  /** 切模板/删环节但未逐条处置孤立绑定（I-26）。⚠ **确认前零写入** */
  "ORPHAN_BINDING_UNRESOLVED",
  /** 组员自行挂载 skill。⚠ **服务端拒绝 + 安全审计**，不是前端隐藏（V4） */
  "MEMBER_CANNOT_SELF_MOUNT",
  /** 临时挂载试图作用到别的线程/蓝本（I-18） */
  "MOUNT_SCOPE_VIOLATION",
  /** 挂载过多导致本轮上下文超预算。⚠ **不得静默丢弃某个 skill 的注入**（E2） */
  "CONTEXT_BUDGET_EXCEEDED",
  /** 待办同步到任务模块失败（E4）。⚠ **编排保存成功但不得静默丢失** */
  "TODO_SYNC_FAILED",

  /* ── ④ 反馈与晋升 ────────────────────────────────────────────── */
  /** 评价缺 skill 版本记录（I-20）。⚠ 该评价**只计 agent 级**，进数据质量报表，**不得随意归给某 skill** */
  "ATTRIBUTION_MISSING",
  /** 对 `实现层缺陷` / `模型能力所限` 类条目生成改进提案（V6） */
  "NOT_CONTRACT_SOLVABLE",
  /** 改进提案未经人工复核就上线（V3）。⚠ **写审计** */
  "PROPOSAL_NOT_REVIEWED",
  /** 同一 skill 并发两份改进提案（E6）。⚠ 已有待复核提案：合并 / 排队 */
  "PROPOSAL_CONFLICT",
  /** 破坏 schema 的改进未在复核界面被**显式确认**（E3/V8）。⚠ 须显著标出 + 列受影响引用 */
  "SCHEMA_BREAKING_UNACKNOWLEDGED",
  /** 复核通过但发版失败（E5）。⚠ 提案停「待上线」，`vN` **保持生效**，且必须**明确通知** */
  "RELEASE_FAILED_PENDING",
  /** 晋升未满足严格准入（无签字决策 / 复盘未判对）（D-32/V3）。⚠ **明确指出缺哪一条** */
  "PROMOTION_ADMISSION_FAILED",
  /** 三项必填缺任一（适用范围/有效期/复核负责人）（V4）。⚠ **skill 生成一并阻断** */
  "PROMOTION_REQUIRED_FIELDS_MISSING",
  /** AI 试图自行晋升入库（V5）。⚠ **安全审计** */
  "AI_SELF_PROMOTION_FORBIDDEN",
  /** 含客户机密的方法未过脱敏闸门（D-16/V7） */
  "REDACTION_GATE_REQUIRED",
  /** 试图写入/改写来源标记（I-11/V10）。⚠ 来源标记**由系统打标** */
  "SOURCE_TAG_IMMUTABLE",
  /** 操作过程中权限被撤回（E6）。⚠ **立即终止后续写操作** */
  "PERMISSION_REVOKED",
]);

type SkillErrorT = z.infer<typeof SkillError>;
type ArtifactErrorT = z.infer<typeof ArtifactError>;
type AgentRuntimeErrorT = z.infer<typeof AgentRuntimeError>;

/**
 * **跨束同码同义的编译期门控**（`typecheck` 会红）。
 *
 * 交集类型只接受**两个枚举都有**的字面量：任何一侧改名、拼错、
 * 或有人在本束「另起一份名字」，这里立刻不通过类型检查。
 *
 * ⚠ 为什么不 import 枚举本身：`artifact` 是 phase-00 已签核的更内层束，
 *   直接 import 会让本束的失败面随它变动。要的是「同名是刻意的」的**证明**，不是依赖。
 */
const _sharedWithArtifact = ["DEPENDENCY_UNAVAILABLE"] as const satisfies readonly (ArtifactErrorT &
  SkillErrorT)[];

/**
 * **与 `agent-runtime` 束同码同义的两条。**
 *
 * 本束与 `agent-runtime` 是**同一次签核批次**里的两个束，
 * 且共享两条流程纪律（「提交人 ≠ 审核人」「用错职能」）。
 * ⚠ 这两条如果各写各的名字，同一次拒绝在 agent 编辑器与 skill 编辑器上
 *   会显示成两种不同的东西——而它们是同一条组织纪律（O-21 / I-5）。
 */
const _sharedWithAgentRuntime = [
  "SELF_REVIEW_FORBIDDEN",
  "DEPENDENCY_UNAVAILABLE",
] as const satisfies readonly (AgentRuntimeErrorT & SkillErrorT)[];

/* ─────────────────────────── 实体 ─────────────────────────── */

/**
 * **D-06：Skill = 声明式契约**。三件套 + 失败兜底，phase-1 **无沙箱**。
 *
 * ⚠ 这里**没有** `code` / `entrypoint` / `runtime` 之类的字段：
 *   不是忘了，是 D-06 已裁「phase-1 无沙箱」。留一个空字段等于给下一个人一个入口。
 * ⚠ `fallbackDeclaration` 必填 —— 静态契约校验的三条之一就是「无失败兜底声明即拒」。
 */
export const DeclarativeContract = z
  .object({
    promptTemplate: z.string().min(1),
    /** JSON Schema 文本。⚠ 不可解析或不自洽 ⇒ `CONTRACT_VALIDATION_FAILED`，**不入库** */
    inputSchema: z.string().min(1),
    outputSchema: z.string().min(1),
    /** ⚠ 以**提交人当前权限**为上界（R9），服务端判定；越权项**直接判校验失败** */
    dataScope: z.array(z.string()),
    /** ⚠ 声明读原始转写需单独授权（`RAW_TRANSCRIPT_NOT_AUTHORIZED`） */
    readsRawTranscript: z.boolean(),
    fallbackDeclaration: z.string().min(1),
  })
  .strict();

/** 安全扫描发现项。⚠ `risk-pending-confirm` 时逐条转给审核人，**确认理由留痕** */
export const RiskItem = z
  .object({
    riskItemId: z.string(),
    kind: z.enum(["prompt-injection", "scope-elevation", "data-exfiltration", "unauthorized-mcp"]),
    detail: z.string(),
  })
  .strict();

/** 试跑记录。⚠ 失败**不入库**——所以这个实体只在成功路径上出现 */
export const TrialRun = z
  .object({
    trialRunId: z.string(),
    versionId: z.string(),
    input: z.string(),
    output: z.string(),
    durationMs: z.number().int().nonnegative(),
    tokens: z.number().int().nonnegative(),
    /** 本次实际命中的数据范围。⚠ 它是「声明的范围」与「实际读到的东西」之间的对账面 */
    hitDataScope: z.array(z.string()),
  })
  .strict();

/** 列表项。⚠ `satisfaction` 为 `null` ⇒ 样本不足，前端显示「样本不足」**而非百分比**（I-21） */
export const SkillListItem = z
  .object({
    skillId: z.string(),
    name: z.string(),
    duty: z.string(),
    source: SkillSource,
    status: SkillStatus,
    visibility: z.enum(["org-wide", "team-only"]),
    currentVersionId: z.string().nullable(),
    /** ⚠ null ⟺ 样本不足。**不得为了填满界面而给一个 0%** */
    satisfaction: z.number().nullable(),
  })
  .strict();

/** 绑定。⚠ **必须记 `versionId`**（I-8），否则现场会随发新版漂移 */
export const SkillBinding = z
  .object({
    bindingId: z.string(),
    /** 二者恰有其一非空：实例级绑定挂 project，模板级绑定挂 template */
    projectId: z.string().nullable(),
    templateId: z.string().nullable(),
    /** ⚠ D-03a：议程环节字段名恒为 `agendaSegment*`，**禁止裸 `stage`** */
    agendaSegmentId: z.string(),
    slotKind: SlotKind,
    skillId: z.string(),
    /** ⚠ **必须到版本粒度** */
    versionId: z.string(),
    deliverRoles: z.array(z.string()),
    trigger: z.string(),
  })
  .strict();

/** 线程临时挂载。⚠ 只对当前这条对话生效，**不改蓝本、不改实例编排**（I-18/V2） */
export const ThreadSkillMount = z
  .object({
    mountId: z.string(),
    threadId: z.string(),
    skillId: z.string(),
    versionId: z.string(),
    mountedAt: z.string(),
    /** ⚠ 摘除**不回溯历史消息角标**（I-19/V3）——所以摘除是打时间戳，不是删行 */
    removedAt: z.string().nullable(),
  })
  .strict();

/**
 * **Studio 侧「另存为组织模板」的唯一实现在 `templates` 束。**
 *
 * `skills/usecases.md` 与 `templates/usecases.md` **都写了 `saveAsOrgTemplate`**。
 * 两处各声明一遍就是本仓第 N 次「同一事实声明在两处」——
 * 本束**不声明它**，只钉住它在哪里。
 *
 * ⚠ 与 `project.ts` 的 `SOLE_MOUNT_OPERATION` 同形：一个字符串常量 + 一条不新增路由的纪律。
 */
export const SOLE_SAVE_AS_ORG_TEMPLATE_OPERATION = "templates.saveAsOrgTemplate" as const;

/**
 * **禁止存在的路由**（本束）。
 * 交付物是**一条断言它不存在的测试**，不是一个接口。
 */
export const SKILLS_FORBIDDEN_ROUTES = [
  {
    route: "POST /skills/:skillId/enable",
    why:
      "I-23 双重门禁：`已启用` **只能由 `reviewSkillVersion` 的 approve 分支产生**。" +
      "一条直达的启用路由就是那条绕过路径本身——而 `GATE_NOT_PASSED` 是给" +
      "「有人从别的入口试图置为已启用」准备的告警，不是给一个官方后门准备的返回值。",
  },
] as const;

/* ─────────────────────────── 操作 ─────────────────────────── */

export const operations = {
  /* ───── 一、契约建立与门禁（F61 / F62）───── */

  /**
   * UC-3.1 R3 步骤 1：新建草稿 / 导入契约。
   * 落 `草稿` 态（**仅作者与能力维护者可见**）。
   * ⚠ 静态契约校验与数据范围越权检查**在服务端**，以**提交人当前权限**为上界（R9）。
   * ⚠ 越权项直接判校验失败，**不进待审核队列**——进了队列，审核人就会替提交人背这个书。
   * ⚠ `source` **由系统按入口打标，入参无此字段**（I-11）。
   */
  createSkillDraft: {
    method: "POST",
    path: "/skills",
    in: z
      .object({
        orgId: z.string(),
        name: z.string().min(1),
        duty: z.string().min(1),
        contract: DeclarativeContract,
        visibility: z.enum(["org-wide", "team-only"]),
        modelRef: z.string(),
      })
      .strict(),
    out: z
      .object({
        skillId: z.string(),
        versionId: z.string(),
        /** ⚠ 系统打标；入参里没有它，写它 ⇒ `SOURCE_TAG_IMMUTABLE` */
        source: SkillSource,
        status: SkillStatus,
      })
      .strict(),
    err: [
      "CONTRACT_VALIDATION_FAILED",
      "DATA_SCOPE_EXCEEDS_SUBMITTER",
      "RAW_TRANSCRIPT_NOT_AUTHORIZED",
      "SOURCE_TAG_IMMUTABLE",
      "MODEL_UNAVAILABLE",
      "DEPENDENCY_UNAVAILABLE",
      "PERMISSION_REVOKED",
    ] as const,
  },

  /**
   * 门禁第一道（自动）。
   * 扫描对象是**声明式内容本身**：提示词注入模式、越权数据范围申请、
   * 敏感字段外泄倾向、对未授权 MCP 工具的引用。
   * ⚠ `risk-pending-confirm` **不是错误**——风险项逐条转给审核人，**确认理由留痕**。
   */
  runSecurityScan: {
    method: "POST",
    path: "/skill-versions/:versionId/security-scan",
    in: z.object({ versionId: z.string() }).strict(),
    out: z.object({ verdict: SecurityScanVerdict, findings: z.array(RiskItem) }).strict(),
    err: ["SECURITY_SCAN_REJECTED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * UC-3.1 R3 步骤 4：试跑。
   * ⚠ **失败不入库**，返回失败原因与**可复制日志**（模型原文与差异）。
   * ⚠ 超 10 秒转可离开页面的后台任务并保留结果（R9）。
   * ⚠ 试跑样例输入若含客户数据，按 UC-20.3 机密路由选模型（跨 `agent-runtime` 束）。
   */
  runTrialRun: {
    method: "POST",
    path: "/skill-versions/:versionId/trial-run",
    in: z.object({ versionId: z.string(), sampleInput: z.string() }).strict(),
    out: z
      .object({
        /** null ⇒ 已转后台任务，见 `asyncTaskId` */
        trialRun: TrialRun.nullable(),
        asyncTaskId: z.string().nullable(),
      })
      .strict(),
    err: ["TRIAL_RUN_SCHEMA_MISMATCH", "MODEL_UNAVAILABLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 提交进人工门禁。⚠ 扫描未过即拒——两道门是**并列**的，不是「先提交再补扫描」 */
  submitSkillForReview: {
    method: "POST",
    path: "/skill-versions/:versionId/submit",
    in: z.object({ versionId: z.string(), expectedVersion: z.string() }).strict(),
    out: z.object({ status: SkillStatus, versionState: SkillVersionState }).strict(),
    err: [
      "CONTRACT_VALIDATION_FAILED",
      "SECURITY_SCAN_REJECTED",
      "SKILL_VERSION_CHANGED",
    ] as const,
  },

  /**
   * 门禁第二道（人工）。
   * ⚠ **两道全过才能启用**（AC2）。任何绕过路径（直接置 `已启用`）
   *   返回 `GATE_NOT_PASSED` 并**写安全审计**——见 `SKILLS_FORBIDDEN_ROUTES`。
   * ⚠ **两职能不合并**：安全评审人调用本用例返回 `REVIEWER_FUNCTION_MISMATCH`（I-5/V14）。
   * ⚠ 提交人 = 审核人 ⇒ `SELF_REVIEW_FORBIDDEN`；组织内无第二人 ⇒ `NO_SECOND_REVIEWER`
   *   **明确阻断**（A4）——两码分开，因为前者是操作错误、后者是组织配置问题。
   */
  reviewSkillVersion: {
    method: "POST",
    path: "/skill-versions/:versionId/review",
    in: z
      .object({
        versionId: z.string(),
        decision: ReviewDecision,
        reason: z.string().min(1),
        /** `risk-pending-confirm` 的风险项逐条确认；⚠ 确认理由随 `reason` 一起留痕 */
        riskAcks: z.array(z.string()),
      })
      .strict(),
    out: z
      .object({
        skillStatus: SkillStatus,
        versionState: SkillVersionState,
        reviewRecordId: z.string(),
      })
      .strict(),
    err: [
      "SELF_REVIEW_FORBIDDEN",
      "NO_SECOND_REVIEWER",
      "REVIEWER_FUNCTION_MISMATCH",
      "GATE_NOT_PASSED",
      "SKILL_VERSION_CHANGED",
      "PERMISSION_REVOKED",
    ] as const,
  },

  /**
   * 四入口共用的可见性过滤。
   * ⚠ **四个入口必须共用同一份过滤判定**（I-14）。四处各写一遍就是第 N 次「同一事实多处声明」。
   * ⚠ 空结果返回 `[]` 并由前端渲染真实空态，**不生成示例 skill**（A1/V10）。
   */
  listSkills: {
    method: "GET",
    path: "/skills",
    in: z
      .object({
        orgId: z.string(),
        entry: SkillListEntry,
        source: SkillSource.nullable(),
        status: SkillStatus.nullable(),
        visibility: z.enum(["org-wide", "team-only"]).nullable(),
        q: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({ items: z.array(SkillListItem), total: z.number().int().nonnegative() })
      .strict(),
    err: ["SKILL_NOT_FOUND", "PERMISSION_REVOKED"] as const,
  },

  /**
   * AC1：**每个 skill 都有可看的输入输出契约与最近一次试跑结果**——两者都在这里返回。
   * ⚠ `latestTrialRun` 为 null 是**真实空态**（还没跑过），不是失败。
   */
  getSkillDetail: {
    method: "GET",
    path: "/skills/:skillId",
    in: z.object({ skillId: z.string() }).strict(),
    out: z
      .object({
        skill: SkillListItem,
        currentVersionId: z.string().nullable(),
        contract: DeclarativeContract,
        latestTrialRun: TrialRun.nullable(),
        gateResults: z
          .object({
            securityScan: SecurityScanVerdict.nullable(),
            methodologyReviewPassed: z.boolean(),
          })
          .strict(),
        satisfaction: z.number().nullable(),
        /** 晋升生成的 skill 才有；⚠ **双向可达**（I-22） */
        promotionKnowledgeItemId: z.string().nullable(),
      })
      .strict(),
    err: ["SKILL_NOT_FOUND"] as const,
  },

  /* ───── 二、绑定到环节与角色（F63 / F64）───── */

  /**
   * R3 步骤 1：套工作流模板。
   * 一次性写入环节链、绑定与三角色分工，**此后实例与模板本体解耦**。
   * ⚠ 已有实例改动时**必须先返回将丢失的清单并要求确认**，确认前不执行（V6）。
   * ⚠ 切模板属「最终确认」动作 ⇒ **须主持人确认**（O-03）。
   */
  applyWorkflowTemplate: {
    method: "POST",
    path: "/projects/:projectId/workflow-template",
    in: z
      .object({
        projectId: z.string(),
        workflowTemplateId: z.string(),
        templateVersion: z.number().int().positive(),
        /** ⚠ 为 false 时**零写入**，只返回 `ORPHAN_BINDING_UNRESOLVED` 让人先处置 */
        hostConfirmed: z.boolean(),
      })
      .strict(),
    out: z
      .object({
        projectId: z.string(),
        /** 例如「来自后台 v2」——⚠ 它是**引用**不是拷贝，此后不随模板漂移 */
        sourceTemplateVersion: z.number().int().positive(),
        bindings: z.array(SkillBinding),
      })
      .strict(),
    err: [
      "ORPHAN_BINDING_UNRESOLVED",
      "SKILL_NOT_ENABLED",
      "DEPENDENCY_UNAVAILABLE",
      "PERMISSION_REVOKED",
    ] as const,
  },

  /**
   * R3 步骤 3–6：绑定一个槽。
   * ⚠ 绑定**必须记 `versionId`**（I-8），否则现场会随发新版漂移。
   * ⚠ 超 6 个 skill：**提示不阻断**（V7）——返回 `warnings[]`，**不是错误码**。
   *   （把提示做成错误码，引导师就会在现场被一个建议卡住。）
   */
  upsertSegmentBinding: {
    method: "PUT",
    path: "/skill-bindings",
    in: z
      .object({
        projectId: z.string().nullable(),
        templateId: z.string().nullable(),
        agendaSegmentId: z.string(),
        slotKind: SlotKind,
        skillId: z.string().nullable(),
        versionId: z.string().nullable(),
        deliverRoles: z.array(z.string()),
        trigger: z.string(),
        expectedVersion: z.string(),
      })
      .strict(),
    out: z
      .object({
        binding: SkillBinding,
        /** ⚠ 提示不阻断：超 6 个 skill 等情形进这里，**不进 err** */
        warnings: z.array(z.string()),
      })
      .strict(),
    err: [
      "SKILL_NOT_ENABLED",
      "SKILL_NOT_FOUND",
      "SLOT_KIND_MISMATCH",
      "TEMPLATE_WRITEBACK_FORBIDDEN",
      "SKILL_VERSION_CHANGED",
      "PERMISSION_REVOKED",
    ] as const,
  },

  /** A3/E-孤立绑定：**纯读，零写入**。⚠ 没有绑定条目被静默丢弃（AC6/V6） */
  previewOrphanBindings: {
    method: "POST",
    path: "/projects/:projectId/orphan-bindings/preview",
    in: z
      .object({
        projectId: z.string(),
        changeKind: z.enum(["switch-template", "remove-segment"]),
        targetId: z.string(),
      })
      .strict(),
    out: z
      .object({
        lostBindings: z.array(SkillBinding),
        lostRoleCells: z.array(
          z.object({ agendaSegmentId: z.string(), roleKey: z.string() }).strict(),
        ),
      })
      .strict(),
    err: ["PERMISSION_REVOKED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** ⚠ 逐条处置，**没有「全部忽略」这个动作**——那正是静默丢弃的另一种写法 */
  confirmOrphanDisposition: {
    method: "POST",
    path: "/projects/:projectId/orphan-bindings/disposition",
    in: z
      .object({
        projectId: z.string(),
        dispositions: z.array(
          z
            .object({
              bindingId: z.string(),
              action: z.enum(["migrate", "delete"]),
              toAgendaSegmentId: z.string().nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
    out: z.object({ applied: z.number().int().nonnegative() }).strict(),
    err: ["ORPHAN_BINDING_UNRESOLVED", "SKILL_VERSION_CHANGED"] as const,
  },

  /**
   * R3 步骤 5：角色格 → 待办（跨束边）。
   * ⚠ 每个非空角色格 → **恰一条待办**（I-16），`assignee` **恒为人**、agent 记 `executor`（D-39）。
   * ⚠ 同步失败**编排仍保存成功**，但必须返回 `failed` 让界面显示「N 条待办未同步」并可重试（E4/V12）。
   *   —— 所以 `failed` 是**成功响应的一部分**，不是错误码的替代品。
   */
  generateRoleTodos: {
    method: "POST",
    path: "/projects/:projectId/role-todos",
    in: z.object({ projectId: z.string() }).strict(),
    out: z
      .object({
        created: z.array(z.string()),
        failed: z.array(
          z.object({ agendaSegmentId: z.string(), roleKey: z.string() }).strict(),
        ),
      })
      .strict(),
    err: ["TODO_SYNC_FAILED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * R3 步骤 7：现场按环节自动挂载。
   * ⚠ `reason` 是**契约的一部分**——AC1 要求「能看到因什么环节载入」。
   * ⚠ 依赖失败时该条标「依赖失败」并**明确告知**，**不静默跳过、不换模型**（E2）。
   * ⚠ 组员侧只读：本用例返回的 `mounts` 对组员**无任何写入口**；直调写接口被拒（V5）。
   */
  resolveMountedSkills: {
    method: "GET",
    path: "/projects/:projectId/mounted-skills",
    in: z
      .object({
        projectId: z.string(),
        agendaSegmentId: z.string(),
        role: z.string(),
        groupId: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({
        mounts: z.array(
          z
            .object({
              skillId: z.string(),
              versionId: z.string(),
              trigger: z.string(),
              /** 例：「因环节 03 载入」。⚠ 不是可选的展示文案 */
              reason: z.string().min(1),
              /** 非 null ⇒ 该条标「依赖失败」并说明原因，**不从列表里消失** */
              disabledReason: z.string().nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
    err: [
      "SKILL_NOT_FOUND",
      "MODEL_UNAVAILABLE",
      "MCP_ISOLATED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** A5/V8：未被任何环节绑定的 skill。⚠ 空 ⇒ 真实空态 */
  listIdleSkills: {
    method: "GET",
    path: "/skills/idle",
    in: z.object({ orgId: z.string() }).strict(),
    out: z.object({ idle: z.array(z.string()) }).strict(),
    err: ["PERMISSION_REVOKED"] as const,
  },

  /* ───── 三、对话内临时加减（F65）───── */

  /**
   * R3 步骤 1：选择器可选池。
   * ⚠ 依赖不可用的 skill **在池中显示为不可选并说明原因**（V6）——
   *   是 `mountable[].disabledReason`，**不是过滤掉**。过滤掉会让人以为它不存在。
   */
  listMountableSkills: {
    method: "GET",
    path: "/threads/:threadId/mountable-skills",
    in: z.object({ threadId: z.string() }).strict(),
    out: z
      .object({
        /** ⚠ 置顶且**只读**，标「本议程环节已绑定」 */
        boundBySegment: z.array(
          z.object({ skillId: z.string(), versionId: z.string() }).strict(),
        ),
        mountable: z.array(
          z
            .object({
              skillId: z.string(),
              versionId: z.string(),
              /** 非 null ⇒ 不可选**并说明原因**，仍出现在池里 */
              disabledReason: z.string().nullable(),
            })
            .strict(),
        ),
      })
      .strict(),
    err: ["MEMBER_CANNOT_SELF_MOUNT", "SKILL_NOT_FOUND", "PERMISSION_REVOKED"] as const,
  },

  /**
   * 临时挂载。
   * ⚠ 只对当前这条对话生效，**不改蓝本、不改实例编排**（I-18/V2）。
   * ⚠ 超预算时**明确要求取舍**，**不静默丢弃某个 skill 的注入**（E2）。
   * ⚠ 临时挂载**不构成提权**：其数据范围仍受三层权限约束（R9）。
   * ⚠ 前置：引导师，或组长且引导师已下放该权限（domain D-h）。
   */
  mountSkillToThread: {
    method: "POST",
    path: "/threads/:threadId/skill-mounts",
    in: z
      .object({
        threadId: z.string(),
        skillIds: z.array(z.string()).min(1),
        expectedVersion: z.string(),
      })
      .strict(),
    out: z.object({ mounts: z.array(ThreadSkillMount) }).strict(),
    err: [
      "MEMBER_CANNOT_SELF_MOUNT",
      "MOUNT_SCOPE_VIOLATION",
      "SKILL_NOT_ENABLED",
      "CONTEXT_BUDGET_EXCEEDED",
      "SKILL_VERSION_CHANGED",
      "PERMISSION_REVOKED",
    ] as const,
  },

  /** ⚠ 摘除**不回溯历史消息角标**（I-19/V3）——所以返回的是 `removedAt` 而不是「已删除」 */
  unmountSkillFromThread: {
    method: "DELETE",
    path: "/threads/:threadId/skill-mounts/:mountId",
    in: z.object({ threadId: z.string(), mountId: z.string() }).strict(),
    out: z.object({ mountId: z.string(), removedAt: z.string() }).strict(),
    err: ["SKILL_VERSION_CHANGED", "PERMISSION_REVOKED"] as const,
  },

  /**
   * 复盘（AC1）：本场临时挂载 vs 绑定的差异
   *
   * ## 🟡 `version` 于 #467 补上，**该字段所在契约面待人类补签**
   *
   * `mountSkillToThread.in.expectedVersion` 是**必填**的乐观锁版本号，而在此之前
   * **没有任何操作产出过它** —— 也就是说，照签核后的契约原样实现，任何调用方都
   * 无法合法地发起第一次挂载。这与 #513 在 `chat.getAgentPanel` 上遇到的是**同一型**
   * 缺口（写端口带版本号、读端口没有 ⇒ 刷新一次页面就无从填起），处置照同一个先例：
   * 把服务端**本来就能算出**的同一个值在读端口下发一次，不新增用户可见语义、
   * 不另起 design-delta，并**登记为待人类补签**。
   * 人类回来后要么补签、要么要求改形状。**没有任何 `design-signoff.md` 被改动**
   * ——签核是人的动作，agent 不得代做。
   */
  listThreadDeviations: {
    method: "GET",
    path: "/threads/:threadId/skill-deviations",
    in: z.object({ threadId: z.string() }).strict(),
    out: z
      .object({
        temporary: z.array(ThreadSkillMount),
        addedVsBinding: z.array(z.string()),
        removedVsBinding: z.array(z.string()),
        /**
         * 🟡 #467，**待人类补签**（见本操作文件头）。
         *
         * 本线程挂载列表的乐观锁版本号，**与 `mountSkillToThread.in.expectedVersion`
         * 是同一个概念、同一个事实源**（服务端对该线程挂载列表求出的指纹），
         * 不是第二个版本号。⚠ 调用方**不得自行拼一个**：口径变一次两侧就各算各的，
         * 而不匹配会表现成「随机 409」——那是最难查的一类故障。
         */
        version: z.string(),
      })
      .strict(),
    err: ["PERMISSION_REVOKED"] as const,
  },

  /**
   * 把临时挂载回提。
   * ⚠ `org-template` 走 **`templates.saveAsOrgTemplate`**（`SOLE_SAVE_AS_ORG_TEMPLATE_OPERATION`），
   *   **不回写模板本体**（I-17）——本操作只负责把意图转过去，不自己实现另存。
   */
  submitMountBackToTemplate: {
    method: "POST",
    path: "/thread-skill-mounts/:mountId/submit-back",
    in: z
      .object({
        mountId: z.string(),
        target: z.enum(["org-template", "project-instance", "ignore"]),
      })
      .strict(),
    out: z.object({ workflowTemplateId: z.string().nullable() }).strict(),
    err: ["TEMPLATE_WRITEBACK_FORBIDDEN", "PERMISSION_REVOKED"] as const,
  },

  /* ───── 四、版本与停用（F66）───── */

  /**
   * 发新版。
   * ⚠ **不覆盖当前生效版本**；新版本**不豁免门禁**：照走 `runSecurityScan` + `reviewSkillVersion`。
   * ⚠ 审核通过后 `vN+1` 生效、**`vN` 自动归档**（I-6）；
   *   数据范围扩大的改版须在审核界面**显著标出**。
   */
  publishNewVersion: {
    method: "POST",
    path: "/skills/:skillId/versions",
    in: z
      .object({
        skillId: z.string(),
        contract: DeclarativeContract,
        expectedHeadVersion: z.string(),
        /** 破坏 schema 时必须为 true，否则 `SCHEMA_BREAKING_UNACKNOWLEDGED` */
        schemaBreakingAck: z.boolean(),
      })
      .strict(),
    out: z
      .object({
        versionId: z.string(),
        versionNumber: z.number().int().positive(),
        contentHash: z.string(),
        state: SkillVersionState,
      })
      .strict(),
    err: [
      "CONTRACT_VALIDATION_FAILED",
      "DATA_SCOPE_EXCEEDS_SUBMITTER",
      "SKILL_VERSION_CHANGED",
      "SCHEMA_BREAKING_UNACKNOWLEDGED",
      "PERMISSION_REVOKED",
    ] as const,
  },

  /**
   * 停用前置（AC4）。
   * ⚠ **无清单不得停用**（R7）：`disableSkill` 未携带本用例产出的 `referenceSnapshotId`
   *   ⇒ `REFERENCES_NOT_ENUMERATED`。
   * ⚠ 三类**可空但必须显式返回**——空数组与「这一类我没查」必须可分辨。
   */
  listReferences: {
    method: "GET",
    path: "/skills/:skillId/references",
    in: z.object({ skillId: z.string() }).strict(),
    out: z
      .object({
        referenceSnapshotId: z.string(),
        inFlightProjects: z.array(z.string()),
        templateBindings: z.array(z.string()),
        agentMounts: z.array(z.string()),
        /** 规模大时转异步并给进度（R9）；非 null 时上面三项是**部分结果** */
        asyncTaskId: z.string().nullable(),
      })
      .strict(),
    err: ["SKILL_NOT_FOUND", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 停用。
   * ⚠ `mode` **复用 phase-1 已建成的 `DisableDialog`**（立即中断 / 跑完当前一轮）——
   *   `usecases.md` 逐字「同一事实不得再写一份」。
   * ⚠ 停用后：新蓝本/新项目/新对话选不到它；**进行中的按锁定版本跑完**（AC1/V1）。
   * ⚠ `replacementSkillId` 只做「**推荐**替代」，改指**仍需引导师确认，不自动执行**（A3）。
   */
  disableSkill: {
    method: "POST",
    path: "/skills/:skillId/disable",
    in: z
      .object({
        skillId: z.string(),
        referenceSnapshotId: z.string(),
        mode: DisableMode,
        archive: z.boolean(),
        /** ⚠ 推荐而非执行：服务端**不**据此改任何绑定 */
        replacementSkillId: z.string().nullable(),
      })
      .strict(),
    out: z.object({ status: SkillStatus, archived: z.boolean() }).strict(),
    err: [
      "REFERENCES_NOT_ENUMERATED",
      "BUILTIN_NOT_DELETABLE",
      "SKILL_VERSION_CHANGED",
      "PERMISSION_REVOKED",
    ] as const,
  },

  /** 恢复。⚠ 重新进可绑定池；**历史引用不受影响**（V8） */
  restoreSkill: {
    method: "POST",
    path: "/skills/:skillId/restore",
    in: z.object({ skillId: z.string() }).strict(),
    out: z.object({ status: SkillStatus }).strict(),
    err: ["SKILL_NOT_FOUND", "PERMISSION_REVOKED"] as const,
  },

  /**
   * **只有失败出口的用例。**
   *
   * 存在任何引用（含历史项目）即**永久拒绝**并**返回引用清单**；`source = CC` 一律拒绝。
   * 删除请求走合规删除流程（17-gov / UC-17.2），**不在本束**。
   *
   * ⚠ `out` 是 `z.never()`：**没有成功形状**这件事本身要写进契约。
   *   写成 `{ deleted: boolean }` 会让下游生成一个「有时能删」的客户端类型。
   * ⚠ 与 N-5 的紧张关系（「不提供 API」优于「提供但恒拒」）已登记为
   *   `KNOWN_CONTRACT_GAPS.S1` —— `usecases.md` 明写了这个用例，**本文件照它落**，
   *   但这是一条**需要签核人复看的**结构选择。
   */
  hardDeleteSkill: {
    method: "DELETE",
    path: "/skills/:skillId",
    in: z.object({ skillId: z.string() }).strict(),
    out: z.never(),
    err: ["HARD_DELETE_FORBIDDEN", "BUILTIN_NOT_DELETABLE"] as const,
  },

  /** 蓝本侧显式升级。⚠ **默认不自动跟随**（提示不阻断）；升级需引导师确认 */
  upgradeBindingToVersion: {
    method: "POST",
    path: "/skill-bindings/:bindingId/upgrade",
    in: z.object({ bindingId: z.string(), toVersionId: z.string() }).strict(),
    out: SkillBinding,
    err: ["SKILL_NOT_ENABLED", "SKILL_VERSION_CHANGED", "PERMISSION_REVOKED"] as const,
  },

  /* ───── 五、晋升生成（F67，phase-1 只做接收端）───── */

  /**
   * UC-P1 接收端（**触发端在 14-brain / phase-3**）。
   * ⚠ **自动生成 ≠ 自动发布**：落 `待审核`，绕过被拒（I-23/V2）。
   * ⚠ 转写不完整时**留空并标待补，不得臆造 schema**；
   *   数据范围取**最小必要**，**不继承提名人全部权限**。
   * ⚠ **不得静默失败**：Skill 库不可写时晋升操作**明确失败并给重试入口**（E8/V11）。
   * ⚠ 「同一自然人在同一条晋升链上只行使一次裁决」——做了晋升审批者不能再审本 skill（I-5）。
   */
  receivePromotedSkill: {
    method: "POST",
    path: "/skills/promoted",
    in: z
      .object({
        orgId: z.string(),
        knowledgeItemId: z.string(),
        /** ⚠ 严格准入的两条依据（D-32），缺任一 ⇒ `PROMOTION_ADMISSION_FAILED` */
        signedDecisionId: z.string(),
        reviewConclusionId: z.string(),
        /** ⚠ **可以是残缺的**——不完整处留空并标待补，**不臆造** */
        draftContract: DeclarativeContract.partial(),
        /** 三项必填，缺任一 ⇒ `PROMOTION_REQUIRED_FIELDS_MISSING` */
        applicableScope: z.string().min(1),
        validUntil: z.string().min(1),
        reviewOwnerId: z.string().min(1),
        /** 含机密者必须已过脱敏闸门（D-16/V7） */
        redactedOnly: z.boolean(),
      })
      .strict(),
    out: z
      .object({ skillId: z.string(), versionId: z.string(), status: SkillStatus, source: SkillSource })
      .strict(),
    err: [
      "PROMOTION_ADMISSION_FAILED",
      "PROMOTION_REQUIRED_FIELDS_MISSING",
      "AI_SELF_PROMOTION_FORBIDDEN",
      "REDACTION_GATE_REQUIRED",
      "SOURCE_TAG_IMMUTABLE",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** 「来自组织大脑」区块的数据源；⚠ **双向可达**（I-22） */
  getPromotionProvenance: {
    method: "GET",
    path: "/skills/:skillId/promotion-provenance",
    in: z.object({ skillId: z.string() }).strict(),
    out: z
      .object({
        knowledgeItemId: z.string(),
        signedDecisionId: z.string(),
        reviewConclusionId: z.string(),
        applicableScope: z.string(),
        validUntil: z.string(),
        reviewOwnerId: z.string(),
      })
      .strict(),
    err: ["SKILL_NOT_FOUND"] as const,
  },

  /**
   * E5/E6/E7 联动。
   * · `待复核` → **标注「源方法已过期」，不自动停用**（⚠ domain D-j 待裁 → `S2`）
   * · `被推翻` / `被撤销` → 自动转 `已停用`，**不硬删**，进行中项目不受影响（AC3/V8）
   * · `被替代` → 发新版、旧版归档、**已建实例锁版本**（V9）
   */
  onSourceKnowledgeStateChanged: {
    method: "POST",
    path: "/skills/source-knowledge-changed",
    in: z
      .object({
        knowledgeItemId: z.string(),
        newState: SourceKnowledgeState,
        replacedByKnowledgeId: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({
        effect: KnowledgeChangeEffect,
        skillId: z.string(),
        versionId: z.string().nullable(),
      })
      .strict(),
    err: ["SKILL_NOT_FOUND", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 按 `source = 晋升生成` 筛出全部 */
  listPromotedSkills: {
    method: "GET",
    path: "/skills/promoted",
    in: z.object({ orgId: z.string() }).strict(),
    out: z.object({ items: z.array(SkillListItem) }).strict(),
    err: ["PERMISSION_REVOKED"] as const,
  },

  /* ───── 六、改进反馈与版本触发（F68）───── */

  /**
   * 阶段一：采集与归因。
   * ⚠ 评价**不公开署名**（D-40 同源）；同一人对同一消息重复评价**只计一次**
   *   （V13，幂等键 `(messageId, raterId)`）。
   * ⚠ 缺 `skillVersionId` 的评价**不计入任何 skill 满意度**并进数据质量报表（I-20/V9）——
   *   `ATTRIBUTION_MISSING` 因此是**记录后仍返回的**告警型失败，不是丢弃。
   */
  rateMessage: {
    method: "POST",
    path: "/messages/:messageId/rating",
    in: z
      .object({
        messageId: z.string(),
        verdict: RatingVerdict,
        reason: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({
        ratingId: z.string(),
        attribution: z
          .object({
            agentId: z.string(),
            skillId: z.string().nullable(),
            /** ⚠ null ⇒ 本条只计 agent 级，**不得随意归给某 skill** */
            skillVersionId: z.string().nullable(),
          })
          .strict(),
      })
      .strict(),
    err: ["ATTRIBUTION_MISSING", "PERMISSION_REVOKED"] as const,
  },

  /**
   * 满意度。
   * ⚠ 口径 `👍/(👍+👎)`，**不含未评价、不加权**（O-37）。
   * ⚠ **最小样本量的数值来自 `packages/contracts/src/thresholds.ts`**（usecases.md:410 逐字），
   *   **不在本束硬编码**——写第二份就是第 N 次「同一事实声明在两处」。
   * ⚠ 样本不足是**正常返回态**：`value === null ⟺ insufficient === true`。
   *   把它做成错误码会让前端在正常空样本上渲染失败态。
   */
  getSatisfaction: {
    method: "GET",
    path: "/skills/:skillId/satisfaction",
    in: z.object({ skillId: z.string(), window: z.string().nullable() }).strict(),
    out: z
      .object({
        /** ⚠ null ⟺ 样本不足。**不返回 0 也不返回估算值** */
        value: z.number().nullable(),
        sampleSize: z.number().int().nonnegative(),
        insufficient: z.boolean(),
      })
      .strict(),
    err: ["SKILL_NOT_FOUND", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 聚合建议。
   * ⚠ 聚合键是**结构性判据** `(skillId, versionId, agentId, 人工归类标签)`（O-35），
   *   **不用相似度打分**——相似度不可复现，第二次跑出来的分组会不一样。
   * ⚠ `thumbsDownCount` 与 `caseCount` **分别标注口径，不得混用**（原型 👎9 / 12 案例）。
   * ⚠ 建议文案由 AI 产出，**必须带机器产出标记并可展开原始案例核对**（I-27）。
   */
  listSuggestions: {
    method: "GET",
    path: "/skill-suggestions",
    in: z.object({ orgId: z.string(), skillId: z.string().nullable() }).strict(),
    out: z
      .object({
        items: z.array(
          z
            .object({
              id: z.string(),
              target: z.string(),
              issueLabel: z.string(),
              /** ⚠ 与下一项**口径不同**：这是「👎 的条数」 */
              thumbsDownCount: z.number().int().nonnegative(),
              /** ⚠ 这是「涉及的案例数」。两者混用会让「9 还是 12」变成一个谜 */
              caseCount: z.number().int().nonnegative(),
              cohortText: z.string(),
              adviceText: z.string(),
              category: SuggestionCategory.nullable(),
              /** ⚠ 恒 true：文案由 AI 产出，**必须可见地标出来** */
              machineGenerated: z.literal(true),
            })
            .strict(),
        ),
      })
      .strict(),
    err: ["PERMISSION_REVOKED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** ⚠ 归类是**人工动作**（O-35 的「人工归类标签」），不是模型输出 */
  classifySuggestion: {
    method: "PUT",
    path: "/skill-suggestions/:suggestionId/category",
    in: z.object({ suggestionId: z.string(), category: SuggestionCategory }).strict(),
    out: z.object({ suggestionId: z.string(), category: SuggestionCategory }).strict(),
    err: ["PERMISSION_REVOKED"] as const,
  },

  /** ⚠ 含客户机密的案例按权限门控：无权者**只见计数与脱敏摘要**（E2/V10） */
  listSuggestionCases: {
    method: "GET",
    path: "/skill-suggestions/:suggestionId/cases",
    in: z.object({ suggestionId: z.string(), page: z.number().int().nonnegative() }).strict(),
    out: z
      .object({
        cases: z.array(
          z
            .object({
              messageExcerpt: z.string(),
              skillVersionId: z.string(),
              agendaSegmentId: z.string(),
              projectId: z.string(),
              reason: z.string().nullable(),
              /** true ⇒ `messageExcerpt` 已脱敏（无权看原文） */
              redacted: z.boolean(),
            })
            .strict(),
        ),
        total: z.number().int().nonnegative(),
      })
      .strict(),
    err: ["PERMISSION_REVOKED"] as const,
  },

  /**
   * 生成改进提案。
   * ⚠ 前置：聚合项 `category = contract-solvable`；否则 `NOT_CONTRACT_SOLVABLE`
   *   （只提供软件反馈通道 / 换模型入口）。
   * ⚠ 提案生成模型不可用时**明确失败**，**不得产出半截 diff 当成提案**（E4）。
   * ⚠ 含机密案例送模型时走自托管模型（UC-20.3，跨 `agent-runtime` 束）。
   */
  generateImprovementProposal: {
    method: "POST",
    path: "/skill-suggestions/:suggestionId/proposal",
    in: z.object({ suggestionId: z.string() }).strict(),
    out: z
      .object({
        proposalId: z.string(),
        /** vN+1 草稿 */
        versionId: z.string(),
        diff: z.string(),
        schemaBreaking: z.boolean(),
        machineGenerated: z.literal(true),
      })
      .strict(),
    err: [
      "NOT_CONTRACT_SOLVABLE",
      "PROPOSAL_CONFLICT",
      "MODEL_UNAVAILABLE",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** ⚠ AI 起草 / 人工修改**分段留痕**——`humanEdits` 是那条痕的可断言投影 */
  editProposal: {
    method: "PATCH",
    path: "/skill-proposals/:proposalId",
    in: z.object({ proposalId: z.string(), patch: z.string() }).strict(),
    out: z
      .object({ proposalId: z.string(), humanEdits: z.number().int().nonnegative() })
      .strict(),
    err: ["PROPOSAL_CONFLICT", "PERMISSION_REVOKED"] as const,
  },

  /**
   * 人工复核门禁。
   * ⚠ 复核通过后：`vN+1` 上线、`vN` **自动归档**、**已建实例锁版本**（V7）。
   * ⚠ 发版失败 ⇒ `vN` **保持生效**、提案停「待上线」可重试，**且必须有明确通知**（E5/V11）。
   * ⚠ 前置：`methodology-reviewer` ∧ **≠ 提交人**。
   */
  reviewProposal: {
    method: "POST",
    path: "/skill-proposals/:proposalId/review",
    in: z
      .object({
        proposalId: z.string(),
        decision: ReviewDecision,
        reason: z.string().min(1),
        schemaBreakingAck: z.boolean(),
      })
      .strict(),
    out: z
      .object({ released: z.boolean(), versionState: SkillVersionState })
      .strict(),
    err: [
      "SELF_REVIEW_FORBIDDEN",
      "PROPOSAL_NOT_REVIEWED",
      "SCHEMA_BREAKING_UNACKNOWLEDGED",
      "RELEASE_FAILED_PENDING",
      "PERMISSION_REVOKED",
    ] as const,
  },

  /** A6：闭环四个计数。⚠ 四个都要有——只报「发了几版」看不出这个闭环有没有在转 */
  getLoopMetrics: {
    method: "GET",
    path: "/skills/loop-metrics",
    in: z.object({ orgId: z.string(), month: z.string() }).strict(),
    out: z
      .object({
        feedbackCount: z.number().int().nonnegative(),
        proposalCount: z.number().int().nonnegative(),
        releasedCount: z.number().int().nonnegative(),
        /** ⚠ 可为 null：两端任一端样本不足时**不给差值**（同 `getSatisfaction` 的纪律） */
        satisfactionDelta: z.number().nullable(),
      })
      .strict(),
    err: ["PERMISSION_REVOKED", "DEPENDENCY_UNAVAILABLE"] as const,
  },
} as const;

/**
 * 本束落地时撞到的契约缺口，逐条登记在契约自己身上。
 *
 * ⚠ 这不是 TODO 列表，是**需要人类签核才能补**的东西
 * （`design-signoff.md` 的 `status` 只能由人类改，agent 不许动）。
 */
export const KNOWN_CONTRACT_GAPS = {
  /**
   * **`hardDeleteSkill` 是「提供但恒拒」，与 N-5 的裁决方向相反。**
   * N-5（phase-00 已裁）判「不提供该 API」优于「提供但恒拒」，理由是攻击面为零
   * 且不存在「拒绝逻辑写错了」这种失效。而 `skills/usecases.md` 明写了这个用例
   * 并要求它**返回引用清单**——那需要一个真实端点。
   * ⇒ 本文件按 `usecases.md` 落（`out: z.never()`），但两条纪律在此处**方向相反**，
   *   请签核人复看：要么确认这是有意的例外，要么把它改成一条禁止路由。
   */
  S1: "hardDeleteSkill is modelled as an always-failing endpoint per usecases.md, which contradicts N-5's ruling that 'do not provide the API' beats 'provide but always reject'; flagged for the signer",
  /**
   * **`待复核` 状态下是否自动停用未裁**（domain D-j）。
   * 本文件落 `effect: "annotate"`（标注「源方法已过期」，不自动停用），
   * 因为那是 `usecases.md` 正文写的一侧；但该行自己带着「⚠ domain D-j 待裁决」。
   */
  S2: "whether a skill whose source knowledge turns 待复核 should auto-disable is unruled (domain D-j); modelled as annotate-only per the usecases.md prose",
  /**
   * **组长能否自行挂载 skill，取决于「引导师是否已下放该权限」，而下放动作没有接口。**
   * `mountSkillToThread` 的前置逐字写着「引导师，或组长且引导师已下放该权限（domain D-h）」，
   * 而本束**没有任何操作能下放它**。⇒ 该前置今天**不可满足**，
   * `MEMBER_CANNOT_SELF_MOUNT` 因此对组长恒成立。加操作 = 签核后新增。
   */
  S3: "mountSkillToThread's precondition mentions a facilitator delegating mount rights to a group lead, but no operation grants that delegation; the precondition is currently unsatisfiable",
  /**
   * **满意度最小样本量在 `thresholds.ts` 里还是 `known: false`。**
   * `usecases.md:410` 把数值指向阈值登记表，而登记表尚未给出该项。
   * ⇒ `getSatisfaction.out.insufficient` 的**判据**今天取不到值——
   * 形状可实现，「几条算够」不可判定。**本文件不替它编一个数。**
   */
  S4: "the minimum sample size for satisfaction is delegated to thresholds.ts, where it is not yet a resolved value; the shape is contracted but the predicate cannot be evaluated",
  /**
   * **`saveAsOrgTemplate` 在两束的 `usecases.md` 里各写了一遍。**
   * 本束**不声明它**，只留 `SOLE_SAVE_AS_ORG_TEMPLATE_OPERATION` 指向 `templates` 束。
   * ⇒ 两份 UC 文档仍是两处声明，**文档侧的收敛需要签核人做**（agent 不改 UC）。
   */
  S5: "saveAsOrgTemplate is specified in BOTH skills/usecases.md and templates/usecases.md; this bundle declares only a pointer, but the duplicated prose still needs to be reconciled by the signer",
  /**
   * **`DisableMode`（interrupt | drain）现在有三处声明**：本束、`agent-runtime` 束、
   * 以及已建成的 `DisableDialog` 组件。`usecases.md` 自己写着「同一事实不得再写一份」，
   * 而三处各有一份 —— 收敛为单一事实源属**跨束修订**，不在本文件顺手做。
   */
  S6: "the interrupt|drain closed set is now declared in this bundle, in agent-runtime, and in the built DisableDialog component; converging them is a cross-bundle amendment",
  /**
   * **`REVIEWER_FUNCTION_MISMATCH`（本束）与 `WRONG_REVIEW_FUNCTION`（`agent-runtime` 束）
   * 是同一条纪律的两个名字。**
   * 两束都在说「方法论审核人 ≠ 安全评审人」（I-5 / O-21），字面量却不同。
   * ⇒ 同一次拒绝在两个编辑器上会显示成两种不同的东西。统一命名属修订两束，需签核。
   */
  S7: "REVIEWER_FUNCTION_MISMATCH here and WRONG_REVIEW_FUNCTION in agent-runtime encode the same rule (methodology reviewer is not the security reviewer) under two different literals",
  /**
   * **`MODEL_UNAVAILABLE`（本束）与 `MODEL_DEPENDENCY_FAILED`（`agent-runtime` 束）同上。**
   * 两者都表示「依赖模型不可用 ⇒ 明确失败，不得静默换模型」。
   * ⚠ 本文件**没有**把它改名对齐：改错误码字面量属修订已写就的 UC，不是实现动作。
   */
  S8: "MODEL_UNAVAILABLE here and MODEL_DEPENDENCY_FAILED in agent-runtime encode the same failure; not renamed here because changing an error literal amends an already-written UC",
} as const;
