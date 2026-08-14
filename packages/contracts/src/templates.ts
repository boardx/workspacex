/**
 * 契约束 `templates` — ③ API 契约（**唯一事实源**）
 *
 * ADR-020：这一份生成四样东西，任何一样都不许手写第二份——
 *   ├─→ 后端 DTO + NestJS 全局 ValidationPipe 的运行时校验
 *   ├─→ 前端 client 类型
 *   ├─→ OpenAPI（对外文档 + 契约 diff 门控）
 *   └─→ 前端 mock 数据
 *
 * 覆盖 feature：**F17–F30**（14 件）
 * 依据 UC：`contracts/templates/usecases.md`（定义层 / 版本 / 实例层 / 回流层）
 * 领域模型：同目录 `domain.md`（I-1…I-28 + 缺 D-1…D-14）
 *
 * ## 三个必须先讲清的名字（D-03a，**全局权威**，三者不得共用一个名）
 *   · **16 项设计配置** → `design_facet` / `designFacetKey`，**恒 16**，**不随档位变**
 *   · **议程环节**       → `agenda_segment` / `agendaSegmentId`，基数随时长档位变（7/11/14/19…）
 *   · **9 个方法环节**   → `method_stage`（本束不引用）
 *   ⚠ 本束**同时**碰前两个，是最容易把它们混成一个的地方：
 *     蓝本的「完成度 n/N」数的是 **design_facet**，
 *     「议程 N 环节」数的是 **agenda_segment**，
 *     `listBlueprints` 一行里**两者都出现**——**不得串位**（D-03 / V4）。
 *
 * ## ⚠ 本文件刻意**没有**的东西（缺了是结论，不是遗漏）
 *   · **常量 `16`** —— `denominator` **由服务端从定义表派生返回**（I-5），
 *     「不许前端自己数、更不许任何一侧写 16 或 15」是逐字要求
 *   · **议程环节状态切换操作** —— 它在 `project` 束（`SOLE_AGENDA_SEGMENT_STATE_OPERATION`）。
 *     「三视角首屏的唯一驱动源」只有在**只有一个写入点**时才成立
 *   · **「降级 Skill 阻断发布」的失败码** —— 原型明写的那道门在 `usecases.md`
 *     的错误码表里**没有名字**（`KNOWN_CONTRACT_GAPS.T1`）。**本文件不发明它。**
 *
 * ⚠ **一个不会被任何路径抛出的错误码读起来像覆盖，而它什么都没覆盖。**
 *   `TemplateError` 的每一个成员都在下方某个操作的 `err` 里出现。
 */
import { z } from "zod";
import { ArtifactError } from "./artifact";
import { PermissionReason } from "./identity";
import { AgentRuntimeError } from "./agent-runtime";

/* ─────────────────────────── 枚举 ─────────────────────────── */

/** 蓝本状态。⚠ **归档不影响可达性**：已套用项目仍可实例化（I-7）——这是防现场跑挂的关键 */
export const BlueprintState = z.enum(["draft", "published", "archived"]);

/**
 * 时长档位。
 * ⚠ **自定义档位下的议程环节数推导规则未定**（D-7）⇒ `CUSTOM_TIER_RULE_UNDEFINED`，
 *   **宁可拒绝也不猜一个推导式**。
 */
export const DurationTier = z.enum(["half-day", "one-day", "two-day", "three-day", "custom"]);

/** 形式。⚠ `online` ⇒ **自动追加「破冰」「举手排队」两个议程环节**，切回时**对称移除**（I-16 / V5） */
export const SessionFormat = z.enum(["hybrid", "onsite", "online"]);

export const SessionLanguage = z.enum(["zh", "en", "bilingual"]);

/**
 * 模型策略的三条 lane（按场景分派）。
 * ⚠ `confidential` **只接受本地/自托管模型**——这是**隐私硬路由，不是性能偏好**，
 *   且**优先级高于配额降级**（I-21）：用量 90% 时机密调用仍走本地。
 */
export const ModelLane = z.enum(["onsite", "postSession", "confidential"]);

/**
 * 分组状态**三值封闭**（I-14 / V7）：第四态一律 `INVALID_GROUP_STATUS`。
 *
 * ⚠ **F25 修正**：本枚举此前取值为 `["未开始","进行中","已完成"]`——与 `domain.md` I-14
 *   的权威定义（`{录音就绪, 缺 N 人, 需介入}` / `{recording-ready, short-n, needs-intervention}`）
 *   不一致,是同一事实两处声明又漂移了一次（`AGENTS.md` 已警告的第六次）。`apps/web/lib/mock/tpl.ts`
 *   的 `GroupReadinessView` 才是与原型逐字对应的取值,本枚举据此改回与 domain.md / 原型一致,
 *   不是新增一个维度——`Group.status` 本来就只应该有一份口径。未见任何后端消费方依赖旧的
 *   中文字面值（`GroupStatus` 在本次修正前从未被 `apps/api` 引用）。
 */
export const GroupStatus = z.enum(["recording-ready", "short-n", "needs-intervention"]);

/** 蓝本可见性。⚠ 与 MCP 的授权范围**不是同一维度，禁止合并成同一字段**（uc-0-3 R7 / I-27） */
export const BlueprintVisibility = z.enum(["org-wide", "team-only"]);

/** 新建蓝本的三入口（A0） */
export const BlueprintOrigin = z.enum(["blank", "copy", "reverse-from-project"]);

/** 套用后初始化的**六类，恒 6**（`getInitializationPreview` 与 `applyBlueprint` **共用这一份**） */
export const InitializationCategory = z.enum([
  "议程环节",
  "分组",
  "角色分工",
  "材料清单",
  "会前任务",
  "画布与产出物",
]);

/**
 * 审计动作。⚠ **越权尝试也必须有安全审计记录**（V19/V18/V6），故它是可检索维度。
 * `套用`（F28 补）：套用蓝本新建项目本身也是一条可检索的审计动作——`uc-2-2#R6`
 * 逐字「套用蓝本…均写审计」，不能只审计发布/回滚/归档这类改蓝本本体的动作，
 * 漏掉「谁在什么时候拿这份蓝本建了项目」这条同样敏感、且是隔离性质核心断言的动作。
 */
export const BlueprintAuditAction = z.enum([
  "发布",
  "换档位",
  "改模型策略",
  "改配额",
  "删除",
  "复制",
  "归档",
  "回滚",
  "合并",
  "套用",
  "越权尝试",
]);

/* ─────────────────────────── 失败面 ─────────────────────────── */

/**
 * 本束的统一失败枚举。**每一个成员都在下方某个操作的 `err` 里出现**。
 *
 * ⚠ `REVERSE_MAPPING_PARTIAL` **不在这里**：`usecases.md` 自己标注它「告警非失败」。
 *   反向生成映射不全时蓝本**要建出来**，未映射项进 `unmappedDesignFacetKeys` 并计入完成度缺口——
 *   把它做成错误码会让「从已办过的项目反向生成」这条路径在最常见的情况下直接失败。
 */
export const TemplateError = z.enum([
  /* ── ① 与已签核束同码同义（下方 `_sharedWith*` 是编译期门控）───────── */
  /** 项目层无角色。⚠ 判定属 `identity` 束，此处**透传**（R5） */
  "NO_PROJECT_ROLE",
  /** 并发编辑 / 并发发布。⚠ **冲突粒度按单个设计配置项**，不整份锁死（E4/E2） */
  "VERSION_CHANGED",
  /** 依赖不可用（模型网关 / 存储 / 任务模块）。⚠ 已保留当前输入与最后成功数据，可安全重试 */
  "DEPENDENCY_UNAVAILABLE",
  /** 机密调用被路由到非本地模型（I-21）。⚠ **这是硬路由违规，不是配额问题** */
  "CONFIDENTIAL_ROUTE_VIOLATION",

  /* ── ② 本束（`usecases.md` 错误码表 + 各用例 err 行）──────────────── */
  /** 组织层无角色（R5，`identity` 判定后透传） */
  "NO_ORG_ROLE",
  /** 角色不够：观察者不得写；组员不得改筹备 */
  "ROLE_INSUFFICIENT",
  /** 非蓝本维护者试图合并（uc-2-3 A1/V5）。⚠ 维护者的定义**未裁**（D-1 → `T2`） */
  "NOT_BLUEPRINT_MAINTAINER",
  /** 不存在**或越权可见**。⚠ 两者**必须不可区分**，不得泄露资源存在性 */
  "BLUEPRINT_NOT_FOUND",
  /** 可见性范围外（team-only）。⚠ 须标明为**组织层**限制（对照 uc-0-3 V3） */
  "BLUEPRINT_NOT_VISIBLE",
  /** 必填配置项未完成（AC3b）。⚠ **与原型冲突，D-9 待裁** → `T3`；detail 带 `missingKeys[]` */
  "REQUIRED_CONFIG_INCOMPLETE",
  /** 未试跑就发布（AC3a）。⚠ **不产生版本号** */
  "TRIAL_RUN_REQUIRED",
  /** 用已归档版本**新增绑定**（I-7）。⚠ **存量实例化不受此拒** */
  "BLUEPRINT_VERSION_ARCHIVED",
  /** 用草稿蓝本套用（R3 步骤1「选一个**已发布**的蓝本」） */
  "BLUEPRINT_NOT_PUBLISHED",
  /** 删除已被套用的蓝本（I-8 / O-18①）。⚠ detail 带 `referencingProjectCount`，请改用归档 */
  "BLUEPRINT_IN_USE",
  /** 回滚到进行中项目正用的版本。⚠ **必须列出项目清单，不得只给一句失败**（A1/V7） */
  "ROLLBACK_TARGET_IN_USE",
  /** 六类写入部分失败（E2）。⚠ **已整体回滚**，detail **必须指明失败的类别名** */
  "INITIALIZATION_FAILED",
  /** 矩阵格 → 待办同步失败（E3）。⚠ **不得静默不一致**；重试幂等不产生重复卡 */
  "TASK_SYNC_FAILED",
  /** 回提未填理由（V4/I-11）。⚠ 「每条沉淀都要写一句为什么」 */
  "RATIONALE_REQUIRED",
  /** 偏离清单为空（A3）。⚠ **真实空态，不强行凑条目** */
  "NO_DEVIATIONS",
  /** 待审改动的基准版本已过时（R7）。⚠ **不自动失效**，由维护者判断是否仍适用 */
  "CHANGE_REQUEST_STALE",
  /** 草稿自动保存失败（E3/V12）。⚠ **不得把「未保存」显示成「已自动保存」** */
  "AUTOSAVE_FAILED",
  /** 操作过程中权限被撤回（E5/E3）。⚠ 未提交内容留在本地草稿 */
  "PERMISSION_REVOKED_MIDWAY",
  /** 换档位是**破坏性变更**：未确认时先返回将被增删的议程环节清单（R8） */
  "TIER_CHANGE_NEEDS_CONFIRMATION",
  /** 自定义档位下的环节数推导规则未定（D-7）。⚠ **宁可拒绝也不猜一个推导式** */
  "CUSTOM_TIER_RULE_UNDEFINED",
  /** 三条 lane 的 `ModelRef` 不在本组织**已启用模型**清单内（D-07） */
  "MODEL_NOT_ENABLED",
  /** 归档 / 删除的二次确认未给出。⚠ 确认框须提示「有 N 个项目 / N 个议程环节仍绑定此蓝本」 */
  "NEEDS_CONFIRMATION",
  /** AI 生成主题/背景时来源不足（R7/V8）。⚠ **不得伪造**；AI 产出未经人确认**不落为最终值** */
  "AI_SOURCES_INSUFFICIENT",
  /** 分组状态第四态（I-14/V7） */
  "INVALID_GROUP_STATUS",
  /** 每组必须有一个场景与一位组长 */
  "GROUP_LEADER_REQUIRED",
  /** 换工作流模板未确认。⚠ 必须先返回 `impact` 并要求确认，**不得静默替换环节链或丢弃已生成待办**（A5/V9f） */
  "TEMPLATE_SWITCH_NEEDS_CONFIRMATION",
  /** ⚠ **为 D-11 裁决预留的码，当前不应触发**——「项目已开始后是否禁止换」未裁 */
  "TEMPLATE_SWITCH_FORBIDDEN_AFTER_START",
  /** `roleKey` 不在角色表派生的列集内（I-28）。⚠ 列集**不硬编码** */
  "UNKNOWN_ROLE_KEY",
]);

type TemplateErrorT = z.infer<typeof TemplateError>;
type ArtifactErrorT = z.infer<typeof ArtifactError>;
type PermissionReasonT = z.infer<typeof PermissionReason>;
type AgentRuntimeErrorT = z.infer<typeof AgentRuntimeError>;

/**
 * **跨束同码同义的编译期门控**（`typecheck` 会红）。
 *
 * 交集类型只接受**两个枚举都有**的字面量：任何一侧改名、拼错、
 * 或有人在本束「另起一份名字」，这里立刻不通过类型检查。
 *
 * ⚠ 为什么不 import 枚举本身：`identity` / `artifact` 是 phase-00 已签核的更内层束，
 *   直接 import 会让本束的失败面随它变动。要的是「同名是刻意的」的**证明**，不是依赖。
 */
const _sharedWithIdentity = ["NO_PROJECT_ROLE"] as const satisfies readonly (PermissionReasonT &
  TemplateErrorT)[];

const _sharedWithArtifact = [
  "NO_PROJECT_ROLE",
  "VERSION_CHANGED",
  "DEPENDENCY_UNAVAILABLE",
] as const satisfies readonly (ArtifactErrorT & TemplateErrorT)[];

/**
 * **与 `agent-runtime` 束同码同义的两条。**
 *
 * `CONFIDENTIAL_ROUTE_VIOLATION` 尤其要钉住：**同一条隐私硬路由有两个执行点**——
 * 蓝本侧选 lane（本束）与网关侧独立拦截（`agent-runtime.routeModelCall`）。
 * ⚠ 网关侧若不能独立拒绝，I-21 就是空的（coverage 缺口 7 逐字）。
 * 两侧用两个不同的码，则「同一次违规」在两处会被读成两件事。
 */
const _sharedWithAgentRuntime = [
  "CONFIDENTIAL_ROUTE_VIOLATION",
  "VERSION_CHANGED",
  "DEPENDENCY_UNAVAILABLE",
] as const satisfies readonly (AgentRuntimeErrorT & TemplateErrorT)[];

/* ─────────────────────────── 实体 ─────────────────────────── */

/**
 * **16 项设计配置**的定义（D-03a：`design_facet`，**恒 16，不随档位变**）。
 *
 * ⚠ 它是**分母与必填的唯一事实源**（I-5）：
 *   `denominator` **必须由服务端从这张表派生**，「不许前端自己数、
 *   更不许任何一侧写 16 或 15」是 `usecases.md:56` 的逐字要求。
 *   —— 所以本文件里**没有**任何 `16` 这个数。
 * ⚠ 名字：`domain.md` / 现有代码叫 `ConfigItem*`，D-03a 的正名是 `design_facet`。
 *   本文件用正名，两名并存已登记为 `KNOWN_CONTRACT_GAPS.T4`。
 */
export const DesignFacetDefinition = z
  .object({
    designFacetKey: z.string(),
    label: z.string(),
    /** ⚠ 门槛判定语句恒为「存在 `required = true` 且未完成的项 ⇒ 阻断」（I-6），**与具体是哪几项无关** */
    required: z.boolean(),
    ordinal: z.number().int().nonnegative(),
  })
  .strict();

/** 完成度。⚠ `done / denominator`，**两者都由服务端给**（口径 O-32④） */
export const Completeness = z
  .object({
    done: z.number().int().nonnegative(),
    /** ⚠ **派生自定义表**，不是常量 */
    denominator: z.number().int().positive(),
  })
  .strict();

/** 议程环节引用（D-03a：`agenda_segment`）。⚠ **不是** `design_facet` */
export const AgendaSegmentRef = z
  .object({
    agendaSegmentId: z.string(),
    title: z.string(),
    /** 非 null ⇒ 由某条设置自动加入（例：`format-setting`），切回时**对称移除** */
    addedBy: z.string().nullable(),
    /** ⚠ 「可选自动增删 / 必留只压缩时间」是 **[Backlog] 口径，D-8 待裁** → `T5` */
    optional: z.boolean(),
  })
  .strict();

/**
 * 蓝本列表行。
 * ⚠ **`agendaSegmentCount` 与 `completeness` 是两个独立字段，不得串位**（D-03 / V4）——
 *   一个数议程环节（随档位变），一个数设计配置（恒 16）。
 * ⚠ 满意度：`sampleSize` 低于阈值时**不返回数值分数**（I-19），故 `satisfaction` 可为 null。
 * ⚠ 行操作**由服务端派生**：`appliedProjectCount > 0` ⇒ 返回 `archive`，**不返回 `delete`**（I-8）。
 */
export const BlueprintRow = z
  .object({
    blueprintId: z.string(),
    name: z.string(),
    state: BlueprintState,
    versionNumber: z.number().int().nonnegative(),
    /** 议程环节数（`agenda_segment`） */
    agendaSegmentCount: z.number().int().nonnegative(),
    durationTier: DurationTier,
    appliedProjectCount: z.number().int().nonnegative(),
    /** ⚠ null ⟺ 样本不足 */
    satisfaction: z.number().nullable(),
    /** 设计配置完成度（`design_facet`） */
    completeness: Completeness,
    /** ⚠ 服务端派生，**前端不得自行决定能不能删** */
    availableActions: z.array(z.enum(["archive", "delete", "copy", "rollback"])),
  })
  .strict();

/** 模型策略三条 lane */
export const ModelStrategy = z
  .object({
    onsite: z.string(),
    postSession: z.string(),
    /** ⚠ 只接受本地/自托管模型（I-21），且**优先级高于配额降级** */
    confidential: z.string(),
  })
  .strict();

/**
 * 配额与降级。
 * ⚠ **`hardStop` 不是可配项，恒为 false**：达阈值只降级 + 在对话流可见提示，
 *   **不得中断现场**（「现场卡住比多花钱贵。」）。降级必须**可见**，不得静默（V11）。
 * ⚠ 与组织/成员/Agent 三级阈值的取舍未定（D-3）——本用例只落**蓝本级** → `T6`。
 */
export const QuotaPolicy = z
  .object({
    perSessionTokenBudget: z.number().int().positive(),
    downgradeAtRatio: z.number().positive(),
    /** ⚠ 用 `z.literal(false)` 而不是 `boolean`：它**不是可配项**，类型层面就不给写 true 的机会 */
    hardStop: z.literal(false),
  })
  .strict();

/** 初始化一览的一条。⚠ 一览与实际写入**共用同一份契约**（I-17），否则 AC2 是自证的空转 */
export const InitItem = z
  .object({
    category: InitializationCategory,
    key: z.string(),
    label: z.string(),
  })
  .strict();

/** 分组。⚠ 每组必须有一个场景与一位组长（`GROUP_LEADER_REQUIRED`） */
export const Group = z
  .object({
    groupId: z.string(),
    name: z.string(),
    scenario: z.string(),
    /** ⚠ null ⇒ `GROUP_LEADER_REQUIRED`，不是「稍后再说」 */
    leaderUserId: z.string().nullable(),
    status: GroupStatus,
  })
  .strict();

/**
 * 观察/访谈对象表的一行（六列：对象/部门角色/联系方式/背景与要问什么/方式/状态）。
 *
 * ⚠ **F25 修正**：本 schema 此前是 `{subjectId, name, role, org, contact, note}`——
 *   六列里缺了「方式」「状态」两列，多了原型没有的 `org`，与 `uc-2-2` R8 / V9 逐字要求的
 *   六列名字对不上（同一事实两处声明又漂移了一次）。`apps/web/lib/mock/tpl.ts` 的
 *   `InterviewSubject` 视图类型（`name/role/contact/focus/method/status`）与原型逐字一致,
 *   本 schema 据此改正。未见任何后端消费方依赖旧字段（本次修正前从未被 `apps/api` 引用）；
 *   本类型与 `interview` 束（06-itv）自己的 `Subject` 实体是两个不同的东西——那边是预约/
 *   转写回流的完整领域实体，这里只是筹备页表格的一行结构（本 feature 只落结构与填写）。
 */
export const InterviewSubject = z
  .object({
    subjectId: z.string(),
    /** 对象 */
    name: z.string(),
    /** 部门角色 */
    role: z.string(),
    /** 联系方式 */
    contact: z.string(),
    /** 背景与要问什么 */
    focus: z.string(),
    /** 方式 */
    method: z.string(),
    /** 状态 */
    status: z.string(),
  })
  .strict();

/** 编排矩阵格（议程环节 × 角色） */
export const OrchestrationCell = z
  .object({
    cellId: z.string(),
    agendaSegmentId: z.string(),
    /** ⚠ 来自角色表**派生的列集**（I-28），不硬编码；未知值 ⇒ `UNKNOWN_ROLE_KEY` */
    roleKey: z.string(),
    content: z.string(),
    /** ⚠ 「绑定」列与 UC-3.2（`skills` 束）读写**同一份数据**（I-25），不是两份副本 */
    canvasTemplateId: z.string().nullable(),
    skillIds: z.array(z.string()),
  })
  .strict();

/** 一条待审改动。⚠ 四要素**缺一即失败**（AC1）：来源项目 / 提出人 / 时间 / 理由 */
export const ChangeRequest = z
  .object({
    changeRequestId: z.string(),
    blueprintId: z.string(),
    designFacetKey: z.string(),
    beforeValue: z.string(),
    afterValue: z.string(),
    /** ⚠ 四要素，**每一项都非空** */
    sourceProjectId: z.string().min(1),
    proposedBy: z.string().min(1),
    proposedAt: z.string().min(1),
    rationale: z.string().min(1),
    baseVersionId: z.string(),
  })
  .strict();

/**
 * **议程环节状态切换的唯一写入点在 `project` 束。**
 *
 * `templates/usecases.md` 也写了一个 `setAgendaStageStatus`，但
 * `project` 束已有 `advanceAgendaSegment`（推进 / 提前结束 / 跳过 / 合并，
 * 且带「服务端主动收回临时提权」这条已签核的副作用）。
 *
 * ⚠ 「三视角首屏读的是**同一个状态源**」（I-24 / V9c）**只有在只有一个写入点时才成立**。
 *   本束**不声明第二个**——第二个写入点必然绕开 `revokedTemporaryGrants` 那条副作用，
 *   而那条副作用的验证面会从 1 处变 N 处。
 * ⚠ 与 `project.ts` 的 `SOLE_MOUNT_OPERATION` 同形。
 */
export const SOLE_AGENDA_SEGMENT_STATE_OPERATION = "project.advanceAgendaSegment" as const;

/**
 * **禁止存在的路由**（本束）。
 * 交付物是**一条断言它不存在的测试**，不是一个接口。
 */
export const TEMPLATES_FORBIDDEN_ROUTES = [
  {
    route: "PATCH /workflow-templates/:templateId/from-instance",
    why:
      "I-17：实例改动**不回写模板本体**。唯一出口是 `saveAsOrgTemplate`（新建一份），" +
      "以及 UC-2.3 的回提链路（提交 → 维护者合并）。" +
      "一条「把实例同步回模板」的路由会让蓝本悄悄变成最后一场的样子——" +
      "而 `TEMPLATE_WRITEBACK_FORBIDDEN` 这个码正是为了让这种尝试**被看见**，" +
      "不是为了给它留一个官方入口。",
  },
] as const;

/* ─────────────────────────── 操作 ─────────────────────────── */

export const operations = {
  /* ───── 一、定义层（蓝本设计与发布）───── */

  /**
   * 配置项定义表 —— **分母与必填的唯一事实源**。
   * ⚠ `denominator` **必须由服务端从表派生返回**，
   *   「不许前端自己数、更不许任何一侧写 16 或 15」（I-5 逐字）。
   */
  listDesignFacetDefinitions: {
    method: "GET",
    path: "/design-facet-definitions",
    in: z.object({ orgId: z.string() }).strict(),
    out: z
      .object({
        items: z.array(DesignFacetDefinition),
        /** ⚠ 恒等于 `items.length`，但**由服务端算**——前端自己数就是第二份事实 */
        denominator: z.number().int().positive(),
      })
      .strict(),
    err: ["NO_ORG_ROLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 新建三入口（A0）。
   * 「从已办过的项目反向生成」把源项目实际用过的问卷/画布/素材**映射回各项设计配置**；
   * **未能映射的项留空并计入完成度缺口**（V13）。
   * ⚠ 映射结果是 **AI/机器产出**，必须标识并展示来源（R7 通用条）。
   * ⚠ 映射不全是**告警不是失败**——所以它在 out 里，不在 err 里。
   */
  createBlueprint: {
    method: "POST",
    path: "/blueprints",
    in: z
      .object({
        orgId: z.string(),
        name: z.string().min(1),
        origin: BlueprintOrigin,
        /** `copy` 时是源蓝本 id；`reverse-from-project` 时是源项目 id；`blank` 时为 null */
        sourceId: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({
        blueprintId: z.string(),
        /** ⚠ 反向生成时未能映射的项 —— **留空并计入完成度缺口**，不猜 */
        unmappedDesignFacetKeys: z.array(z.string()),
        /** ⚠ 恒 true 当且仅当 `origin = reverse-from-project`：**AI 产出必须被标识** */
        machineGenerated: z.boolean(),
      })
      .strict(),
    err: [
      "NO_ORG_ROLE",
      "ROLE_INSUFFICIENT",
      "BLUEPRINT_NOT_FOUND",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 逐项独立保存 + 完成度派生。
   * ⚠ **冲突粒度是单个设计配置项，不是整份蓝本**（E4）：
   *   两人改**不同**项互不覆盖（V17）；改**同一项**才 `VERSION_CHANGED`。
   * ⚠ 草稿自动保存只走这里，`autosavedAt` 必须是**真实写入时刻**；
   *   写失败时**必须**返回 `AUTOSAVE_FAILED`，界面不得继续显示「已自动保存」（V12）。
   */
  updateDesignFacet: {
    method: "PUT",
    path: "/blueprints/:blueprintId/design-facets/:designFacetKey",
    in: z
      .object({
        blueprintId: z.string(),
        designFacetKey: z.string(),
        value: z.string(),
        /** ⚠ 乐观并发，**粒度 = 单项** */
        expectedItemRevision: z.string(),
      })
      .strict(),
    out: z
      .object({
        itemRevision: z.string(),
        completed: z.boolean(),
        completeness: Completeness,
        /** ⚠ **真实写入时刻**。它不是「我们打算保存的时间」 */
        autosavedAt: z.string(),
      })
      .strict(),
    err: [
      "BLUEPRINT_NOT_FOUND",
      "ROLE_INSUFFICIENT",
      "VERSION_CHANGED",
      "AUTOSAVE_FAILED",
      "PERMISSION_REVOKED_MIDWAY",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 换时长档位 —— 与**议程环节表**联动（不是与 16 项设计配置联动）。
   * ⚠ `confirmed: false` ⇒ `TIER_CHANGE_NEEDS_CONFIRMATION` + **将被增删的议程环节清单**
   *   （换档位是破坏性变更，R8）。
   * ⚠ 已填内容**不得静默丢弃**：被移除的可选环节进 `recoverable`，
   *   提示「切回该档位可恢复」（A1）。
   * ⚠ 「可选自动增删 / 必留只压缩时间」是 **[Backlog] 口径**（D-8，签核时需人类定稿 → `T5`）——
   *   本契约**只落形状**（`added` / `removed` / `recoverable` 三个数组），
   *   **不落「哪些是可选、哪些是必留」的判据**。
   */
  setDurationTier: {
    method: "PUT",
    path: "/blueprints/:blueprintId/duration-tier",
    in: z
      .object({
        blueprintId: z.string(),
        tier: DurationTier,
        confirmed: z.boolean(),
        expectedVersion: z.string(),
      })
      .strict(),
    out: z
      .object({
        agendaSegmentCount: z.number().int().nonnegative(),
        added: z.array(AgendaSegmentRef),
        removed: z.array(AgendaSegmentRef),
        /** ⚠ 「切回该档位可恢复」——被移除的可选环节**不消失** */
        recoverable: z.array(AgendaSegmentRef),
      })
      .strict(),
    err: [
      "BLUEPRINT_NOT_FOUND",
      "ROLE_INSUFFICIENT",
      "TIER_CHANGE_NEEDS_CONFIRMATION",
      "CUSTOM_TIER_RULE_UNDEFINED",
      "VERSION_CHANGED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 形式与语言。
   * ⚠ `format = "online"` ⇒ **自动追加「破冰」「举手排队」两个议程环节**，
   *   标记 `addedBy: "format-setting"`；切回 `hybrid`/`onsite` **对称移除**并提示（I-16 / V5）。
   *   「对称」是可断言的：加过什么就移除什么，**不是「移除所有 optional 的」**。
   */
  setFormatAndLanguage: {
    method: "PUT",
    path: "/blueprints/:blueprintId/format",
    in: z
      .object({
        blueprintId: z.string(),
        format: SessionFormat,
        language: SessionLanguage,
        expectedVersion: z.string(),
      })
      .strict(),
    out: z
      .object({
        agendaSegmentCount: z.number().int().nonnegative(),
        autoAdded: z.array(AgendaSegmentRef),
        autoRemoved: z.array(AgendaSegmentRef),
      })
      .strict(),
    err: [
      "BLUEPRINT_NOT_FOUND",
      "ROLE_INSUFFICIENT",
      "VERSION_CHANGED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 三条按场景分派的模型策略。
   * ⚠ `confidential` lane **只接受本地/自托管模型**，否则 `CONFIDENTIAL_ROUTE_VIOLATION`——
   *   这是**隐私硬路由，不是性能偏好**（对齐 D-17 闭源/自托管二分）。
   * ⚠ 网关侧（`agent-runtime.routeModelCall`）**必须能独立拒绝**，
   *   否则 I-21 只是「应用层不去选云端模型」这句空话（coverage 缺口 7）。
   */
  setModelStrategy: {
    method: "PUT",
    path: "/blueprints/:blueprintId/model-strategy",
    in: z
      .object({
        blueprintId: z.string(),
        lanes: ModelStrategy,
        expectedVersion: z.string(),
      })
      .strict(),
    out: ModelStrategy,
    err: [
      "BLUEPRINT_NOT_FOUND",
      "ROLE_INSUFFICIENT",
      "MODEL_NOT_ENABLED",
      "CONFIDENTIAL_ROUTE_VIOLATION",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 配额与降级。
   * ⚠ **`hardStop` 恒为 false**：达阈值只降级 + 在对话流可见提示，**不得中断现场**。
   * ⚠ 降级必须**可见**，不得静默（V11）。
   */
  setQuotaPolicy: {
    method: "PUT",
    path: "/blueprints/:blueprintId/quota-policy",
    in: z
      .object({
        blueprintId: z.string(),
        perSessionTokenBudget: z.number().int().positive(),
        downgradeAtRatio: z.number().positive(),
        expectedVersion: z.string(),
      })
      .strict(),
    out: QuotaPolicy,
    err: ["BLUEPRINT_NOT_FOUND", "ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 「套用后会初始化什么」六类一览。
   * ⚠ **本用例与 `applyBlueprint` 共用同一份契约**（R11 第 6 项明写）——
   *   「一览」与「实际写入」若各算各的，AC2「逐项对得上」就是**自证的空转**（I-17）。
   *   落地形式：两者的 `categories` / `items` 都用本文件这一份 `InitItem` 与
   *   `InitializationCategory`，且**一览必须由同一个 planner 产出**。
   * ⚠ 一览随配置**实时变化**（V9）。
   */
  getInitializationPreview: {
    method: "GET",
    path: "/blueprints/:blueprintId/initialization-preview",
    in: z
      .object({
        blueprintId: z.string(),
        versionId: z.string().nullable(),
        tier: DurationTier.nullable(),
      })
      .strict(),
    out: z
      .object({
        /** ⚠ **恒 6 类**——空类也要出现，否则「这次没有分组」与「我们不初始化分组」不可分辨 */
        categories: z.array(InitializationCategory),
        items: z.array(InitItem),
      })
      .strict(),
    err: ["BLUEPRINT_NOT_FOUND", "BLUEPRINT_NOT_VISIBLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 只读预览。⚠ **不改变草稿状态、不产生版本**（R3 第 7 步） */
  previewParticipantView: {
    method: "GET",
    path: "/blueprints/:blueprintId/participant-view",
    in: z.object({ blueprintId: z.string() }).strict(),
    out: z
      .object({
        blueprintId: z.string(),
        /** 以**组员可见性**渲染当前草稿 */
        visibleAgendaSegments: z.array(AgendaSegmentRef),
        visibleMaterials: z.array(z.string()),
      })
      .strict(),
    err: ["BLUEPRINT_NOT_FOUND", "ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 试跑一场（发布前置条件之一）。
   * ⚠ 试跑实例**不计入「用过 N 次」**（I-22）。
   * ⚠ **[待人类裁决]**「已试跑」的判定：创建实例即算，还是需跑完/需产出（D-6 → `T7`）。
   *   **按「创建即算」实现会让 AC3a 这道门槛形同虚设**——所以 out 里给的是
   *   `trialRunId` + `trialRunDone` 两个字段而不是一个布尔：判据定下来之前，
   *   `trialRunDone` 由谁置真是**未定的**，把它折叠掉就再也问不出这个问题了。
   */
  startTrialRun: {
    method: "POST",
    path: "/blueprints/:blueprintId/trial-runs",
    in: z.object({ blueprintId: z.string() }).strict(),
    out: z.object({ trialRunId: z.string(), trialRunDone: z.boolean() }).strict(),
    err: ["BLUEPRINT_NOT_FOUND", "ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 发布新版本 —— 门槛 + 事务性。
   *
   * · 门槛判定语句恒为「**存在 `required = true` 且未完成的项 ⇒ 阻断**」（I-6），
   *   **与具体是哪几项无关**。
   * · **生成 v(n+1) 与旧版归档必须同事务**（E6）：不得出现「新版已生成但旧版仍为当前版」或反之。
   * · **失败不占版本号**（I-3 / V18）。
   *
   * ⚠ `REQUIRED_CONFIG_INCOMPLETE` 是 **[Backlog] 口径且与原型冲突**（D-9）：
   *   原型里 `15/16`、`12/16`、`9/16` 的蓝本**均为已发布**。
   *   O-18⑤ 的和解（「那些缺的项 `required = false`」）是**推测性**的，需人类确认 → `T3`。
   * 🔴 **原型明写的那道门是「绑定 Skill 有『组织层已降级未替换』⇒ 阻断发布」**
   *   （`ui.md` panel-14 / designer-invalid / publish-confirm 三处），
   *   而 `usecases.md` 的错误码表里**没有它的名字**。
   *   ⇒ 本操作的 `err` **表达不了那道门**。**本文件不发明这个码** → `KNOWN_CONTRACT_GAPS.T1`。
   */
  publishBlueprintVersion: {
    method: "POST",
    path: "/blueprints/:blueprintId/versions",
    in: z
      .object({
        blueprintId: z.string(),
        expectedCurrentVersionNumber: z.number().int().nonnegative(),
      })
      .strict(),
    out: z
      .object({
        versionId: z.string(),
        versionNumber: z.number().int().positive(),
        changedDesignFacetKeys: z.array(z.string()),
        /** ⚠ 与新版生成**同事务**；null 仅在首版时合法 */
        archivedVersionId: z.string().nullable(),
      })
      .strict(),
    err: [
      "BLUEPRINT_NOT_FOUND",
      "ROLE_INSUFFICIENT",
      "REQUIRED_CONFIG_INCOMPLETE",
      "TRIAL_RUN_REQUIRED",
      "VERSION_CHANGED",
      "PERMISSION_REVOKED_MIDWAY",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /* ───── 二、版本与锁定 ───── */

  /**
   * 列蓝本。
   * ⚠ **`agendaSegmentCount` 与 `completeness` 是两个独立字段，不得串位**（D-03 / V4）。
   * ⚠ 行操作由服务端派生：`appliedProjectCount > 0` ⇒ `archive`，**不返回 `delete`**（I-8）。
   */
  listBlueprints: {
    method: "GET",
    path: "/blueprints",
    in: z
      .object({
        orgId: z.string(),
        state: BlueprintState.nullable(),
        visibleToMe: z.boolean().nullable(),
      })
      .strict(),
    out: z.array(BlueprintRow),
    err: ["NO_ORG_ROLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /** 复制。⚠ 新蓝本与源蓝本**不共享版本线**；改新蓝本不影响源蓝本（V5） */
  copyBlueprint: {
    method: "POST",
    path: "/blueprints/:blueprintId/copy",
    in: z.object({ blueprintId: z.string() }).strict(),
    out: z
      .object({
        newBlueprintId: z.string(),
        /** ⚠ 草稿态、无版本号、用过 0 次、满意度空 —— 四件都要**真实为空**，不继承 */
        state: BlueprintState,
        versionNumber: z.number().int().nonnegative(),
        appliedProjectCount: z.number().int().nonnegative(),
        satisfaction: z.null(),
      })
      .strict(),
    err: ["BLUEPRINT_NOT_FOUND", "ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 归档。
   * ⚠ 确认框须提示「有 N 个项目 / N 个议程环节仍绑定此蓝本」。
   * ⚠ **归档不影响可达性**：已套用项目仍可实例化（I-7）——这是防现场跑挂的关键。
   */
  archiveBlueprint: {
    method: "POST",
    path: "/blueprints/:blueprintId/archive",
    in: z.object({ blueprintId: z.string(), confirmed: z.boolean() }).strict(),
    out: z
      .object({
        archived: z.literal(true),
        referencingProjectCount: z.number().int().nonnegative(),
        referencingAgendaSegmentCount: z.number().int().nonnegative(),
      })
      .strict(),
    err: [
      "BLUEPRINT_NOT_FOUND",
      "ROLE_INSUFFICIENT",
      "NEEDS_CONFIRMATION",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 删除 —— **引用计数门控**。
   * ⚠ 前置：该蓝本**从未被任何项目套用过**。
   * ⚠ **删除接口不得存在任何强制参数可绕过引用计数判定**（V7b / I-8）——
   *   所以 in 里只有 `blueprintId` 与 `confirmed`，**没有** `force` / `cascade` / `skipChecks`。
   */
  deleteBlueprint: {
    method: "DELETE",
    path: "/blueprints/:blueprintId",
    in: z.object({ blueprintId: z.string(), confirmed: z.boolean() }).strict(),
    out: z.object({ deleted: z.literal(true) }).strict(),
    err: [
      "BLUEPRINT_IN_USE",
      "BLUEPRINT_NOT_FOUND",
      "ROLE_INSUFFICIENT",
      "NEEDS_CONFIRMATION",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 回滚 = **新建一个内容等同旧版的新版本**（O-18②）。
   * ⚠ 版本号**只增不减，历史线性**：v5 回到 v3 的内容 ⇒ 产生 **v6（内容 = v3）**，
   *   记 `rolledBackFrom: v3`；**不存在「当前版本指针被改回 v3」的状态**。
   * ⚠ `ROLLBACK_TARGET_IN_USE` 必须在 detail 里**列出正在用它的进行中项目**（A1）——
   *   只给一句失败，方法负责人无从判断该不该继续。
   */
  rollbackToVersion: {
    method: "POST",
    path: "/blueprints/:blueprintId/rollback",
    in: z
      .object({
        blueprintId: z.string(),
        targetVersionId: z.string(),
        expectedCurrentVersionNumber: z.number().int().nonnegative(),
      })
      .strict(),
    out: z
      .object({
        newVersionId: z.string(),
        newVersionNumber: z.number().int().positive(),
        rolledBackFrom: z.string(),
      })
      .strict(),
    err: [
      "ROLLBACK_TARGET_IN_USE",
      "BLUEPRINT_NOT_FOUND",
      "ROLE_INSUFFICIENT",
      "VERSION_CHANGED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 设可见性范围。
   * ⚠ 与 MCP 的授权范围（`agent-runtime.ToolAuthScope`）**不是同一维度，
   *   禁止合并成同一字段**（uc-0-3 R7 / I-27）。两者取值看起来相似，答的问题不同：
   *   一个是「谁能看到这份方法」，一个是「谁能让 agent 调这台服务器」。
   */
  setBlueprintVisibility: {
    method: "PUT",
    path: "/blueprints/:blueprintId/visibility",
    in: z
      .object({
        blueprintId: z.string(),
        visibility: BlueprintVisibility,
        teamId: z.string().nullable(),
      })
      .strict(),
    out: z
      .object({
        blueprintId: z.string(),
        visibility: BlueprintVisibility,
        teamId: z.string().nullable(),
      })
      .strict(),
    err: ["BLUEPRINT_NOT_FOUND", "ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 审计检索。
   * ⚠ **越权尝试也必须有安全审计记录**（V19/V18/V6）——所以 `越权尝试` 是 `action` 的一个取值。
   * 🔗 **跨束**：phase-00 `artifact` 的 `queryProvenance` 与 `identity` 的审计写入是同一件事的另外两处。
   *   **应是统一的审计查询面，不要每束各造一个**（coverage 缺口 ⑦）→ `KNOWN_CONTRACT_GAPS.T8`。
   */
  queryBlueprintAudit: {
    method: "GET",
    path: "/blueprints/audit",
    in: z
      .object({
        blueprintId: z.string().nullable(),
        actorId: z.string().nullable(),
        action: BlueprintAuditAction.nullable(),
        since: z.string().nullable(),
        until: z.string().nullable(),
      })
      .strict(),
    out: z.array(
      z
        .object({
          eventId: z.string(),
          blueprintId: z.string(),
          actorId: z.string(),
          action: BlueprintAuditAction,
          at: z.string(),
        })
        .strict(),
    ),
    err: ["NO_ORG_ROLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /* ───── 三、实例层（套用与筹备）───── */

  /**
   * 套用蓝本新建项目 —— **本束最重的一次写**。
   *
   * · **六类写入要么全部成功、要么整体回滚**，不得建出「有议程没分组」的半成品（E2/V12）。
   *   `INITIALIZATION_FAILED` 的 detail **必须指明失败的类别名**。
   * · **幂等**：同一 `idempotencyKey` 重复提交（双击 / 重试）只建出**一个**项目（V13）。
   * · 写入的是 `blueprintVersionId` 的**引用**（**不是深拷贝**），此后不随蓝本发布漂移（I-1/I-4）。
   * · 项目也可停在「只选了蓝本、主题与分组还没定」的低准备度状态（A2）——
   *   **套用不要求同时完成定题**。
   *
   * ⚠ 路径挂在 `/blueprints/:blueprintId/apply` 而不是 `POST /projects`：
   *   容器创建的唯一入口在 `project` 束（`project.createProject`，一条创建路径 + 蓝本可选参数）。
   *   两处都能建项目，就有两处要维护「`projects` 一行 + 子类型表一行」那条原子性 → `T9`。
   */
  applyBlueprint: {
    method: "POST",
    path: "/blueprints/:blueprintId/apply",
    in: z
      .object({
        orgId: z.string(),
        blueprintId: z.string(),
        versionId: z.string().nullable(),
        tier: DurationTier.nullable(),
        projectName: z.string().min(1),
        /** ⚠ 幂等键**必填**：双击与重试是同一件事的两种触发方式 */
        idempotencyKey: z.string().min(1),
      })
      .strict(),
    out: z
      .object({
        projectId: z.string(),
        /** ⚠ **引用**不是拷贝 */
        blueprintVersionId: z.string(),
        /** 六类各自的写入计数。⚠ 与 `getInitializationPreview` **逐项对得上**（AC2 / I-17） */
        initialized: z.array(
          z
            .object({
              category: InitializationCategory,
              count: z.number().int().nonnegative(),
            })
            .strict(),
        ),
      })
      .strict(),
    err: [
      "BLUEPRINT_NOT_FOUND",
      "BLUEPRINT_NOT_VISIBLE",
      "BLUEPRINT_NOT_PUBLISHED",
      "BLUEPRINT_VERSION_ARCHIVED",
      "INITIALIZATION_FAILED",
      "NO_ORG_ROLE",
      "ROLE_INSUFFICIENT",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 项目筹备页四子标签。
   * ⚠ 计数必须与后端**实际条目数**一致，改数据后同步刷新（V6）。
   * ⚠ 不套蓝本的空项目：四子标签**真实空态，不生成示例分组或示例议程**（V15）。
   */
  getProjectPrep: {
    method: "GET",
    path: "/projects/:projectId/prep",
    in: z.object({ projectId: z.string() }).strict(),
    out: z
      .object({
        tabs: z.array(
          z
            .object({
              key: z.enum(["topic-grouping", "agenda", "materials", "pre-tasks"]),
              label: z.string(),
              count: z.number().int().nonnegative(),
            })
            .strict(),
        ),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 定题 —— **单点继承**。
   * ⚠ **整场只有一个主题、一段背景**（I-13）：`syncedTo` 的三处读的是**同一个 `topicId`**，
   *   系统中**不存在第二份主题/背景记录**（V5）。
   * ⚠ AI 生成的主题/背景**必须标识为机器产出并挂来源**；来源不足时 `AI_SOURCES_INSUFFICIENT`，
   *   **不得伪造**（R7/V8）。AI 产出未经人确认**不落为最终值**。
   */
  saveAndSyncTopic: {
    method: "PUT",
    path: "/projects/:projectId/topic",
    in: z
      .object({
        projectId: z.string(),
        title: z.string().min(1),
        background: z.string(),
        expectedTopicRevision: z.string(),
        /** 非 null ⇒ 本次内容来自 AI，`sources` **必须非空**，否则 `AI_SOURCES_INSUFFICIENT` */
        aiGenerated: z.object({ sources: z.array(z.string()).min(1) }).strict().nullable(),
      })
      .strict(),
    out: z
      .object({
        topicId: z.string(),
        /** ⚠ 三处读的是**同一个 `topicId`** —— 这里返回的是「同步到了哪些视图」，不是三份副本 */
        syncedTo: z.array(z.enum(["grouping", "agenda", "ai-context"])),
      })
      .strict(),
    err: [
      "NO_PROJECT_ROLE",
      "ROLE_INSUFFICIENT",
      "VERSION_CHANGED",
      "AI_SOURCES_INSUFFICIENT",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 分组编排。
   * ⚠ `GroupStatus` **三值封闭**，第四态一律 `INVALID_GROUP_STATUS`（I-14 / V7）。
   * ⚠ 每组必须有一个场景与一位组长（`GROUP_LEADER_REQUIRED`）。
   * ⚠ `[AI 按背景均衡分组]` 的结果是**建议，需人确认后生效**（V8）——
   *   所以本操作收的是**已确认的最终分组**，不是「请 AI 分一下」。
   */
  updateGrouping: {
    method: "PUT",
    path: "/projects/:projectId/grouping",
    in: z
      .object({
        projectId: z.string(),
        groupCount: z.number().int().positive().nullable(),
        groups: z.array(Group),
        expectedRevision: z.string(),
      })
      .strict(),
    out: z.array(Group),
    err: [
      "NO_PROJECT_ROLE",
      "ROLE_INSUFFICIENT",
      "VERSION_CHANGED",
      "INVALID_GROUP_STATUS",
      "GROUP_LEADER_REQUIRED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 观察/访谈对象表（六列）。
   * ⚠ 本用例只落**结构与填写**；预约 / 提纲 / 转写回流属 06-itv（`interview` 束）。
   */
  updateInterviewSubjects: {
    method: "PUT",
    path: "/projects/:projectId/groups/:groupId/interview-subjects",
    in: z
      .object({
        projectId: z.string(),
        groupId: z.string(),
        subjects: z.array(InterviewSubject),
        expectedRevision: z.string(),
      })
      .strict(),
    out: z.array(InterviewSubject),
    err: [
      "NO_PROJECT_ROLE",
      "ROLE_INSUFFICIENT",
      "VERSION_CHANGED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** 读工作流编排（环节链 + 矩阵） */
  getWorkflowOrchestration: {
    method: "GET",
    path: "/projects/:projectId/orchestration",
    in: z.object({ projectId: z.string() }).strict(),
    out: z
      .object({
        template: z
          .object({
            templateId: z.string(),
            name: z.string(),
            sourceVersion: z.number().int().positive(),
          })
          .strict(),
        segmentChain: z.array(AgendaSegmentRef),
        matrix: z.array(OrchestrationCell),
      })
      .strict(),
    err: ["NO_PROJECT_ROLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 换工作流模板。
   * ⚠ `confirmed: false` ⇒ 必须先返回 `impact` 并要求确认，
   *   **不得静默替换环节链或丢弃已生成待办**（A5 / V9f）。
   * ⚠ **[待人类裁决]** 具体处置策略与「项目已开始后是否禁止换」未定（D-11）——
   *   `TEMPLATE_SWITCH_FORBIDDEN_AFTER_START` 是**为该裁决预留的码，当前不应触发**。
   *   留着它是因为它一旦被裁定就要有落点；**但没有任何实现路径今天可以抛它** → `T10`。
   */
  switchWorkflowTemplate: {
    method: "POST",
    path: "/projects/:projectId/workflow-template/switch",
    in: z
      .object({ projectId: z.string(), templateId: z.string(), confirmed: z.boolean() })
      .strict(),
    out: z
      .object({
        impact: z
          .object({
            droppedCells: z.number().int().nonnegative(),
            affectedTasks: z.number().int().nonnegative(),
            lostSegments: z.array(AgendaSegmentRef),
          })
          .strict(),
        /** ⚠ `confirmed: false` 时恒为 false 且**零写入** */
        applied: z.boolean(),
      })
      .strict(),
    err: [
      "TEMPLATE_SWITCH_NEEDS_CONFIRMATION",
      "TEMPLATE_SWITCH_FORBIDDEN_AFTER_START",
      "NO_PROJECT_ROLE",
      "ROLE_INSUFFICIENT",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 另存为组织模板 —— **产物是「工作流模板」，不是新蓝本**（O-02）。
   * ⚠ **不需要蓝本维护者审核**（它没有改动定义层）；它与 UC-2.3 的回提是两条不同路径。
   * ⚠ `skills/usecases.md` 也写了同名用例；**唯一实现在这里**
   *   （`skills.SOLE_SAVE_AS_ORG_TEMPLATE_OPERATION` 指向本操作）。
   */
  saveAsOrgTemplate: {
    method: "POST",
    path: "/projects/:projectId/save-as-org-template",
    in: z.object({ projectId: z.string(), name: z.string().min(1) }).strict(),
    out: z.object({ workflowTemplateId: z.string() }).strict(),
    err: ["NO_PROJECT_ROLE", "ROLE_INSUFFICIENT", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 编辑矩阵格（议程环节 × 角色）。
   * ⚠ 字段名写全 `agendaSegmentId`，**禁止裸 `stage`**（D-03a）。
   * ⚠ 「绑定」列与 UC-3.2（`skills` 束）读写**同一份数据**（I-25），**不是两份副本**。
   * ⚠ `roleKey` ∈ **角色表派生的列集**（不硬编码，I-28）；未知值 ⇒ `UNKNOWN_ROLE_KEY`。
   */
  updateMatrixCell: {
    method: "PUT",
    path: "/projects/:projectId/orchestration/cells",
    in: z
      .object({
        projectId: z.string(),
        agendaSegmentId: z.string(),
        roleKey: z.string(),
        content: z.string(),
        canvasTemplateId: z.string().nullable(),
        skillIds: z.array(z.string()),
        expectedRevision: z.string(),
      })
      .strict(),
    out: z
      .object({ cellId: z.string(), syncedTaskIds: z.array(z.string()) })
      .strict(),
    err: [
      "NO_PROJECT_ROLE",
      "ROLE_INSUFFICIENT",
      "UNKNOWN_ROLE_KEY",
      "TASK_SYNC_FAILED",
      "VERSION_CHANGED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 🔗 矩阵格同步为待办（F27 的核心，跨模块契约）。
   * ⚠ **格 ↔ 待办卡是可追溯的一一对应**（I-23）：改格联动更新、删格不留孤儿卡、
   *   重试幂等**不产生重复卡**。
   * ⚠ 生成的待办**负责人恒为人**（该格对应的角色），agent 记「执行者」（D-39 / I-26）。
   * ⚠ 同步失败**必须可见并可重试**，不得出现「格子已填但任务里没卡」的静默不一致（E3）。
   * ⚠ **[待人类裁决]** 一格是一条待办还是可含多条（D-10）——
   *   **这条直接决定「3×3 = 恰好 9 条」这个断言成不成立** → `T11`。
   */
  syncMatrixToTasks: {
    method: "POST",
    path: "/projects/:projectId/orchestration/sync-tasks",
    in: z
      .object({
        projectId: z.string(),
        cellIds: z.array(z.string()),
        idempotencyKey: z.string().min(1),
      })
      .strict(),
    out: z
      .object({
        created: z.array(z.string()),
        updated: z.array(z.string()),
        /** ⚠ 删格 ⇒ 对应卡进这里，**不留孤儿卡** */
        removed: z.array(z.string()),
      })
      .strict(),
    err: ["TASK_SYNC_FAILED", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /* 🔗 议程环节状态切换 —— **本束不提供操作**，见 `SOLE_AGENDA_SEGMENT_STATE_OPERATION`。
   * 「三种视角首屏同时切到新环节，且读的是**同一个状态源**」（I-24 / V9c）
   * 只有在**只有一个写入点**时才成立。 */

  /* ───── 四、回流层（UC-2.3，整份为 [Backlog] 口径）───── */

  /**
   * 算本场偏离。
   * · diff 基准 = **项目绑定的蓝本版本快照**，**按设计配置定义表逐项遍历**（**不硬编码 16**）。
   * · 议程环节的增删改归到第 2 项「流程 Agenda」名下。
   * · 未改动项**不出现**在清单里（V2）。
   * · `NO_DEVIATIONS` ⇒ **真实空态，不强行凑条目**（A3）。
   * ⚠ **[待人类裁决]** 是否覆盖矩阵**格级**改动、粒度到格还是环节行（D-14）→ `T12`。
   */
  computeDeviations: {
    method: "GET",
    path: "/projects/:projectId/blueprint-deviations",
    in: z.object({ projectId: z.string() }).strict(),
    out: z
      .object({
        deviations: z.array(
          z
            .object({
              designFacetKey: z.string(),
              beforeValue: z.string(),
              afterValue: z.string(),
            })
            .strict(),
        ),
        baseVersionId: z.string(),
      })
      .strict(),
    err: [
      "NO_PROJECT_ROLE",
      "ROLE_INSUFFICIENT",
      "NO_DEVIATIONS",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 提交回蓝本 —— **提交 ≠ 生效**。
   * ⚠ **不直接改蓝本内容、不生成新版本**（I-10 / V3）：只新增 pending 记录。
   * ⚠ 每条携带**来源项目 + 时间 + 提出人 + 理由 + 原值/新值**（AC1 四要素，**缺一即失败**）。
   * ⚠ 未勾选的偏离项**不产生任何蓝本侧记录**。
   * ⚠ 提出人须被明确告知「已提交，等待 <维护者> 审阅」，**不得让他误以为已生效**（A1）——
   *   所以 out 带 `pendingNotice`，而不是一个看起来像成功的 `{ ok: true }`。
   */
  submitBlueprintChangeRequest: {
    method: "POST",
    path: "/projects/:projectId/blueprint-change-requests",
    in: z
      .object({
        projectId: z.string(),
        selections: z.array(
          z
            .object({
              designFacetKey: z.string(),
              /** ⚠ 非空 —— 「每条沉淀都要写一句为什么」 */
              rationale: z.string().min(1),
            })
            .strict(),
        ),
      })
      .strict(),
    out: z
      .object({
        changeRequestIds: z.array(z.string()),
        /** ⚠ 例：「已提交，等待 <维护者> 审阅」——**必须明示尚未生效** */
        pendingNotice: z.string().min(1),
      })
      .strict(),
    err: [
      "RATIONALE_REQUIRED",
      "NO_PROJECT_ROLE",
      "ROLE_INSUFFICIENT",
      "VERSION_CHANGED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /**
   * 看待审改动。
   * ⚠ 同一处被多场改过时**并排显示各自理由**，**不自动择一、不按时间覆盖**（I-12 / V6）——
   *   所以 `siblingsOnSameKey` 是响应的一部分，不是前端自己去分组。
   */
  listPendingChanges: {
    method: "GET",
    path: "/blueprints/:blueprintId/pending-changes",
    in: z.object({ blueprintId: z.string() }).strict(),
    out: z.array(
      z
        .object({
          changeRequest: ChangeRequest,
          siblingsOnSameKey: z.array(ChangeRequest),
        })
        .strict(),
    ),
    err: ["BLUEPRINT_NOT_FOUND", "NO_ORG_ROLE", "DEPENDENCY_UNAVAILABLE"] as const,
  },

  /**
   * 合并一条待审改动。
   * ⚠ **只有蓝本维护者能合并**——含**提出回提的引导师本人**在内的非维护者调用
   *   一律拒绝**并写审计**（V5）。
   * ⚠ 接受后改动进入蓝本**草稿**，发布仍走 `publishBlueprintVersion` 的门槛。
   * ⚠ 合并后蓝本字段必须**可反查到来源项目 + 提出人 + 时间 + 理由原文**，
   *   四者**缺一即失败**（AC1 / V1）。
   * ⚠ 基准版本已过时 ⇒ `CHANGE_REQUEST_STALE`，**不自动失效**，由维护者判断是否仍适用（R7）。
   * ⚠ **维护者的定义未裁**（D-1）→ `T2`：`NOT_BLUEPRINT_MAINTAINER` 的**判据**今天取不到。
   */
  mergePendingChange: {
    method: "POST",
    path: "/blueprint-change-requests/:changeRequestId/merge",
    in: z.object({ changeRequestId: z.string() }).strict(),
    out: z
      .object({
        blueprintDraftUpdated: z.literal(true),
        /** ⚠ 四要素**缺一即失败**——所以它们在 out 里是必填而不是 nullable */
        traceable: z
          .object({
            sourceProjectId: z.string().min(1),
            proposedBy: z.string().min(1),
            proposedAt: z.string().min(1),
            rationale: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    err: [
      "NOT_BLUEPRINT_MAINTAINER",
      "CHANGE_REQUEST_STALE",
      "BLUEPRINT_NOT_FOUND",
      "VERSION_CHANGED",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
  },

  /** 驳回一条待审改动。⚠ 理由留痕；驳回**不删除**记录（否则「谁提过什么」不可回答） */
  rejectPendingChange: {
    method: "POST",
    path: "/blueprint-change-requests/:changeRequestId/reject",
    in: z
      .object({ changeRequestId: z.string(), reason: z.string().min(1) })
      .strict(),
    out: z
      .object({ changeRequestId: z.string(), rejectedAt: z.string() })
      .strict(),
    err: [
      "NOT_BLUEPRINT_MAINTAINER",
      "BLUEPRINT_NOT_FOUND",
      "PERMISSION_REVOKED_MIDWAY",
      "DEPENDENCY_UNAVAILABLE",
    ] as const,
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
   * 🔴 **原型明写的发布门槛没有错误码。**
   * `ui.md` 三处（panel-14 / designer-invalid / publish-confirm）逐字给出：
   * 「绑定 Skill 有『组织层已降级未替换』⇒ **阻断发布**」，
   * 并把它称作「**界面真正演示的发布门槛**」。
   * 而 `usecases.md` 的 `TemplateError` 表与 `publishBlueprintVersion.err`
   * **都没有它**。⇒ 本操作的失败面**表达不了那道门**。
   * **本文件不发明这个码**（发明一个码等于替签核人做决定）。
   */
  T1: "the prototype-explicit publish gate (a bound skill that is org-level degraded and unreplaced blocks publishing, ui.md panel-14 / designer-invalid / publish-confirm) has NO error code in usecases.md; publishBlueprintVersion.err cannot express it",
  /**
   * **「蓝本维护者」的定义未裁**（D-1）。
   * `NOT_BLUEPRINT_MAINTAINER` 的码存在、`mergePendingChange` 的前置写着它，
   * **但「谁是维护者」这个判据在契约里没有落点**——`Blueprint.maintainerIds`
   * 在 `domain.md:49` 自己标着「[待定 —— 需人类裁决]」。裁定前不得写死。
   */
  T2: "who counts as a blueprint maintainer is unruled (domain D-1); the error code and precondition exist but the predicate has no source",
  /**
   * **AC3b「必填项未完成不得发布」与原型直接冲突**（D-9）。
   * 原型里 `15/16`、`12/16`、`9/16` 的蓝本**均为已发布**。
   * O-18⑤ 的和解「那些缺的项 `required = false`」是**推测性**的。
   * ⇒ `REQUIRED_CONFIG_INCOMPLETE` 落在契约里，但**它是否真的会被抛出**取决于
   * 定义表里 `required = true` 的项有几个——而那张表今天还没有数据。
   * ⚠ `domain.md` 逐字：「**D-9 与 D-10 请在签核时优先看**」。
   */
  T3: "AC3b (cannot publish with unfinished required facets) directly contradicts the prototype, where 15/16, 12/16 and 9/16 blueprints are all published; O-18(5)'s reconciliation is speculative and must be confirmed",
  /**
   * **`design_facet` 是 D-03a 的正名，而 `domain.md` / 现有代码叫 `ConfigItem*`。**
   * 本文件用正名（`DesignFacetDefinition` / `designFacetKey`），
   * 因为 D-03a 自称全局权威且本束是它点名的引用方。
   * ⚠ 但 `REVIEW-ARCHITECT.md` P-11 已查明：三个正名**代码零采用或近零采用**，
   * 且 `templates` 束「已签，11 处契约端口名」用的是败选名。
   * ⇒ 契约与 UC 文档现在**用两套名字**，收敛是一次改名迁移，不是本文件能单方完成的。
   * 同理，`usecases.md` 通篇写 `agendaStage*`，本文件用 D-03a 的 `agendaSegment*`。
   */
  T4: "this bundle uses D-03a's canonical names (design_facet / agenda_segment) while domain.md, usecases.md and existing code still use ConfigItem* / agendaStage*; converging them is a rename migration",
  /**
   * **「可选自动增删 / 必留只压缩时间」是 [Backlog] 口径，D-8 待裁。**
   * 原型只说「环节表随之变化」，**没有可选/必留之分，也没有压缩时间的说法**。
   * ⇒ `setDurationTier` 落了 `added` / `removed` / `recoverable` 三个数组的**形状**，
   * **没有落「哪些是可选、哪些是必留」的判据**；`AgendaSegmentRef.optional` 这个字段
   * 在判据定下来之前**没有可信的取值来源**。
   */
  T5: "the 'optional segments are auto added/removed, mandatory ones only get compressed' rule is Backlog-only prose (D-8); the shape is contracted but the optional/mandatory predicate has no prototype source",
  /**
   * **组织/成员/Agent 三级配额阈值与蓝本级的取舍未定**（D-3）。
   * `setQuotaPolicy` 只落**蓝本级**。哪一级赢、是否取交集，未裁。
   */
  T6: "how blueprint-level quota interacts with org / member / agent level thresholds is unruled (D-3); only the blueprint level is contracted here",
  /**
   * **「已试跑」的判定未裁**（D-6）。创建实例即算，还是需跑完/需产出？
   * ⚠ `domain.md` 逐字：「**现按『创建即算』实现会让门槛形同虚设**」。
   * ⇒ `startTrialRun.out` 给的是 `trialRunId` + `trialRunDone` **两个字段**，
   * 谁把 `trialRunDone` 置真是未定的；折叠成一个布尔就再也问不出这个问题了。
   */
  T7: "what counts as 'has been trial-run' is unruled (D-6); implementing it as 'creating the instance counts' would make the AC3a gate vacuous, so the flag is kept separate from the id",
  /**
   * **审计查询面在三个束里各有一个。**
   * 本束 `queryBlueprintAudit`、phase-00 `artifact.queryProvenance`、
   * `identity` 的审计写入、以及 `agent-runtime.queryAuditTimeline` / `queryOrgAudit`。
   * `usecases.md` 逐字：「**应是统一的审计查询面，不要每束各造一个**」（缺口 ⑦）。
   * ⇒ 本文件仍声明了它（否则蓝本审计无处可查），但这是**已知的第 N 处副本**。
   */
  T8: "audit querying now exists in this bundle, in artifact.queryProvenance and in agent-runtime's two audit operations; usecases.md itself says these should be one unified query surface",
  /**
   * **建项目有两个入口**：`project.createProject`（带可选 `blueprintVersionId`）
   * 与本束 `applyBlueprint`。两者都要维护「`projects` 一行 + 子类型表一行」的原子性
   * （project I-P34）。本文件把路径挂在 `/blueprints/:id/apply` 以避开路由冲突，
   * **但语义重叠仍在**——两处各写一遍，漏掉的那一遍不会有任何东西报警。
   */
  T9: "project creation has two entry points (project.createProject with an optional blueprintVersionId, and templates.applyBlueprint); both must uphold the two-row atomicity of I-P34",
  /**
   * **`TEMPLATE_SWITCH_FORBIDDEN_AFTER_START` 今天没有任何路径会抛它**（D-11 未裁）。
   * `usecases.md` 逐字「是为该裁决预留的码，**当前不应触发**」。
   * ⚠ 这与本文件头注「一个不会被抛出的码读起来像覆盖」正面冲突——
   * 它留在枚举里是因为 UC 明确要求，**但它是一条已知的空码**。
   */
  T10: "TEMPLATE_SWITCH_FORBIDDEN_AFTER_START is reserved for an unruled decision (D-11) and, per usecases.md, must not fire today; it is a knowingly unreachable member of the error enum",
  /**
   * **一格是一条待办还是可含多条，未裁**（D-10）。
   * ⚠ **这条直接决定 I-23 的断言**：「3×3 = 恰好 9 条待办」在「一格多条」口径下就是错的。
   * ⇒ `syncMatrixToTasks.out` 返回三个 id 数组而不是计数，因为计数会诱导出那条断言。
   */
  T11: "whether one matrix cell yields exactly one todo or may yield several is unruled (D-10); it decides whether I-23's '3x3 = exactly 9 todos' assertion holds",
  /**
   * **偏离 diff 是否覆盖矩阵格级改动、粒度到格还是环节行，未裁**（D-14）。
   * ⇒ `computeDeviations.out.deviations` 现在**只按 `designFacetKey` 逐项返回**；
   * 若裁为覆盖格级，返回项要多一个粒度维度——那是签核后新增。
   */
  T12: "whether deviation diffs cover matrix-cell-level changes, and at what granularity, is unruled (D-14); deviations are currently keyed only by designFacetKey",
  /**
   * **`setDurationTier.in.expectedVersion` 没有任何契约操作把它读出来。**
   * `listBlueprints.out`（`BlueprintRow`）不含蓝本行级的乐观并发令牌，也没有
   * `getBlueprint` 单条读操作。任何要求 `expectedVersion` 的蓝本行级写操作
   * （`setDurationTier` / `setFormatAndLanguage` / `setModelStrategy` / `setQuotaPolicy`）
   * 都有这同一个缺口——本文件签核时没有配一条读它的路径。
   * ⇒ F177（BP-03）的后端实现真实、可测（真库测试直接读该值构造合法请求），
   * 但今天没有客户端能合法拿到第一个 `expectedVersion`；真正前端接线要等这个
   * 读路径缺口被补上（新增 `getBlueprint` 或把它塞进 `listBlueprints.out`，
   * 两者都是新增契约面，需走 delta 重签，不是本文件能单方补的）。
   */
  T13: "setDurationTier.in.expectedVersion (and the same shape for setFormatAndLanguage/setModelStrategy/setQuotaPolicy) has no read path — listBlueprints.out doesn't carry a blueprint-level revision token and there is no getBlueprint operation; a caller cannot legitimately obtain the first expectedVersion",
} as const;
