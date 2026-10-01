/**
 * Agent 角色扩展 —— API 契约单一事实源（契约束 `agent-role`，Phase 20 AG01–AG07）。
 *
 * 依据：ADR-116 #3（Agent 即 DigitalHuman：角色能力是 `agent_versions` 冻结字段，不建实体/第二条版本链）、
 * ADR-118 #6/#9（effect-gateway 权限重查；Workflow 固定 Skill 版本，Agent 无需挂载）、ADR-119 #4
 * （只有 verified Skill 可被官方 Agent 绑定）、ADR-120 #1–#3（能力分类；toolPolicy 只声明分类、不携带授权、
 * 不继承写权限；拒绝后不换供应商重试）、PROP-WORK-STACK-001 修订 R1（头像先用插画 key 集）、
 * `phases/phase-20-work-stack-foundation/requirements/03-agent-role.md` R1–R12。
 *
 * ⚠ 草案，未签核：`contracts/agent-role/design-signoff.md` status 为 pending（2026-09-28 人类授权先开发后补签）。
 * 本文件不在 index.ts 中导出（导出由单独步骤负责）。
 *
 * 复用而非重述（同一事实不两处声明）：
 * - `CapabilityCategory` 取自 `./work-skill-meta`（⚠ `./workflow-runtime` 另有一份正则不同的定义，见 coverage.md 开放问题 Q1）。
 * - 头像 key 集取自 `./interview-expert-avatar` 的 `AvatarKey`（PROP §4.3「沿用封闭 key 集做法」）。
 * - Workflow 白名单拒绝码沿用 `./workflow-runtime` `WorkflowErrorCode` 的 `workflow_not_allowed`，本文件不另立。
 * - `AgentStarterPackEntry` 其余字段仍以 `./wave2-runtime` 为准；本文件只给出 toolPolicy 放宽后的形状与角色字段扩展。
 */
import { z } from "zod";
import { AGENT_INTERRUPT_KIND_TO_TOOL_NAME } from "./agent-interrupts";
import { AvatarKey } from "./interview-expert-avatar";
import { CapabilityCategory } from "./work-skill-meta";

const Id = z.string().min(1).max(255);

/* ── 一、值对象：冻结角色字段（AG01）──────────────────────────────────── */

/** Workflow 稳定编号，如 `W001`（requirements/work-stack-v2 实体编号）。 */
export const WorkflowStableId = z.string().regex(/^W\d{3}$/);
/** DigitalHuman 角色编号，如 `D002`；官方角色 Agent 的角色引用。 */
export const AgentRoleRef = z.string().regex(/^D\d{3}$/);

/** 头像（修订 R1）：只收插画 key；未来 artifactId 形态另开版本。null/未知 key → 前端回退首字母（A3）。 */
export const AgentAvatar = z.object({
  kind: z.literal("illustration"),
  key: AvatarKey,
  alt: z.string().min(1).max(120),
}).strict();

/**
 * ⚠ 开放问题 Q2：requirements R3 写 `research|product|sales|design|…`，PROP §4.3 写
 * `enterprise-general|method-expert|industry-expert|professional-role|deep-professional`。
 * 本草案按 requirements（本 phase 的直接输入）取值，待签核人裁决。
 */
/**
 * 批次 2 追加 `executive`（D001 高管战略）/ `customer_success`（D006 客户成功）/ `operations`（D007 项目运营）：
 * 沿用 requirements 的「职能名」取值风格，不引入 PROP 体系。DB 侧 CHECK 约束须同步（迁移 20260930130000）。
 */
export const AgentRoleCategory = z.enum(["research", "product", "sales", "design", "general", "executive", "customer_success", "operations"]);
export const AgentCatalogSource = z.enum(["official", "org"]);

export const DelegationPolicy = z.object({
  allowedTargets: z.array(AgentRoleRef).max(32),
  /** ≤ `CALL_CHAIN_MAX_DEPTH`（apps/api/src/domain/agent/call-chain.ts，现值 2）；服务端再校验，契约只给硬上限。 */
  maxDepth: z.number().int().min(0).max(2),
  requireApproval: z.boolean(),
}).strict();

export const EscalationTarget = z.enum(["requester", "project_owner", "org_admin"]);
export const EscalationPolicy = z.object({
  rules: z.array(z.object({
    matter: z.string().min(1).max(200),
    target: EscalationTarget,
  }).strict()).max(64),
}).strict();

/** KPI 只声明不计算（R6：第 10 轮 Board 投影读取）。 */
export const AgentKpi = z.object({
  metric: z.string().regex(/^[a-z][a-z0-9_.]*$/).max(64),
  description: z.string().min(1).max(300),
}).strict();

/**
 * 数字人标签（如「销售」「调研」）：成员目录/聊天选人卡片按它筛选。
 * 单个标签去首尾空白后 1–20 字；一个 Agent 最多 10 个；重复的只保留第一次出现（大小写敏感）。
 * DB 侧 `agents.tags` / `agent_versions.tags`（迁移 20260929160000_agent_tags.sql）只 CHECK 个数上限。
 */
export const AGENT_TAG_MAX_LENGTH = 20;
export const AGENT_TAGS_MAX = 10;
export const AgentTag = z.string().trim().min(1).max(AGENT_TAG_MAX_LENGTH);
export const AgentTags = z.array(AgentTag)
  .transform((tags) => [...new Set(tags)])
  .pipe(z.array(z.string()).max(AGENT_TAGS_MAX));

/**
 * 新增冻结字段（全部进入 `SNAPSHOT_FROZEN_FIELDS`，I-2）。回填默认值见 `AGENT_ROLE_FIELD_DEFAULTS`。
 * `workflowAllowlist` 固定到 Workflow stableId；版本解析由 Runtime 按 Definition 发布状态决定（Q3）。
 */
export const AgentRoleFields = z.object({
  avatar: AgentAvatar.nullable(),
  roleCategory: AgentRoleCategory.nullable(),
  catalogSource: AgentCatalogSource,
  workflowAllowlist: z.array(WorkflowStableId).max(64),
  delegationPolicy: DelegationPolicy,
  escalationPolicy: EscalationPolicy,
  kpi: z.array(AgentKpi).max(16),
  tags: AgentTags,
}).strict();
export type AgentRoleFields = z.infer<typeof AgentRoleFields>;

/** 迁移回填 = 本常量（单一事实源，迁移测试逐字断言）。 */
export const AGENT_ROLE_FIELD_DEFAULTS: AgentRoleFields = {
  avatar: null,
  roleCategory: null,
  catalogSource: "org",
  workflowAllowlist: [],
  delegationPolicy: { allowedTargets: [], maxDepth: 0, requireApproval: true },
  escalationPolicy: { rules: [] },
  kpi: [],
  tags: [],
};

/** 快照新增冻结字段名（AG01 测试断言它们 ⊆ SNAPSHOT_FROZEN_FIELDS）。 */
export const AGENT_ROLE_FROZEN_FIELDS = [
  "avatar", "roleCategory", "catalogSource", "workflowAllowlist",
  "delegationPolicy", "escalationPolicy", "kpi", "tags",
] as const satisfies readonly (keyof AgentRoleFields)[];

/* ── 二、starter-pack toolPolicy 放宽（AG02）+ 官方角色包条目（AG03）──────── */

/** ADR-120 #2：只允许能力分类字符串；对象/凭证/供应商 ID 由 CapabilityCategory 形状拒绝。空数组仍合法（旧包兼容，R9）。 */
export const StarterPackToolPolicy = z.array(CapabilityCategory).max(64);

/*
 * DB CHECK（AG02 迁移）的正则必须与 `CapabilityCategory` 同源：迁移测试以
 * `StarterPackToolPolicy.safeParse` 与 CHECK 对同一组样本（`["knowledge.search"]` / `[{"token":"x"}]` /
 * 大写 / URL）断言判定一致，而不是在本文件再写一份正则字面量。
 */

/** 官方角色包条目在 `AgentStarterPackEntry` 之上追加的字段；`toolPolicy` 替换为 `StarterPackToolPolicy`。 */
export const AgentRolePackEntryExtension = z.object({
  roleRef: AgentRoleRef,
  roleLabel: z.string().min(1).max(64),
  toolPolicy: StarterPackToolPolicy,
  role: AgentRoleFields.omit({ catalogSource: true }), // catalogSource 由导入端点按包来源写入，包内不可自称 official
}).strict();

/** 导入端点（沿用 `POST /admin/agents/starter-pack-imports`）新增失败码，追加到 `AgentStarterImportError`。 */
export const AgentRoleImportError = z.enum([
  "AGENT_STARTER_TOOL_POLICY_INVALID", // E1：非分类值；附 stableName + 字段路径
  "UNRESOLVED_WORKFLOW_REF",           // E2：白名单引用未注册 Workflow
  "UNRESOLVED_SKILL_REF",              // E2：skillVersions 不存在或非 verified（ADR-119 #4）
]);
export const AgentRoleImportFailureDetail = z.object({
  code: AgentRoleImportError,
  stableName: z.string(),
  path: z.string(),
  missingIds: z.array(z.string()).default([]),
}).strict();

/* ── 三、HITL：escalate 中断载荷（AG06）─────────────────────────────── */

/** `AgentInterruptKind` 须追加 `escalate`，工具名映射在 agent-interrupts.ts 的 `AGENT_INTERRUPT_KIND_TO_TOOL_NAME` 里一处追加。 */
export const ESCALATE_INTERRUPT_KIND = "escalate" as const;
export const ESCALATE_TOOL_NAME = AGENT_INTERRUPT_KIND_TO_TOOL_NAME[ESCALATE_INTERRUPT_KIND]; // Q5：命名待签核；映射单源在 agent-interrupts.ts
export const EscalatePayload = z.object({
  matter: z.string().min(1).max(200),
  reason: z.string().min(1).max(2000),
  target: EscalationTarget,
  contextRefs: z.array(Id).max(32),
}).strict();
export const EscalateDecision = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("resolve"), decisionText: z.string().min(1).max(4000) }).strict(),
  z.object({ decision: z.literal("reject"), reason: z.string().min(1).max(2000) }).strict(),
]);

/* ── 四、handoff（AG07）──────────────────────────────────────────────── */

/** 交接包：只含引用 ID，不含摘录全文（I-9）。字段 `.strict()` 使多带字段即拒。 */
export const HandoffPacket = z.object({
  originalQuestion: z.string().min(1).max(8000),
  confirmedScope: z.string().max(4000),
  evidenceRefs: z.array(Id).max(64),
  openItems: z.array(z.string().min(1).max(500)).max(32),
}).strict();

export const HandoffNotAllowedReason = z.enum([
  "target_not_in_allowed_targets", "target_not_published", "target_disabled", "depth_exceeded",
]);
export type HandoffNotAllowedReason = z.infer<typeof HandoffNotAllowedReason>;

/**
 * E5 拒绝时聊天可见的文案（中文，不含原因码；「原线程继续，提示用户可手动联系人」）。
 * 单一事实源：API 交回 Agent 的工具结果与前端 handoff 卡片共用这一份，不在两处各写一套。
 */
/**
 * 每一句转交拒绝文案都含这半句（E5：原线程继续）——前端据此从工具结果里认出拒绝并截出给用户看的那句，
 * 无论结果后面有没有跟着只给模型看的指令（真实工具体有、loopback 替身没有）。
 */
export const HANDOFF_REFUSAL_MARK = "当前对话会继续";

export function handoffNotAllowedCopy(reason: z.infer<typeof HandoffNotAllowedReason>, targetRole: string): string {
  const tail = `${HANDOFF_REFUSAL_MARK}；如需要，可以直接联系对应负责人。`;
  switch (reason) {
    case "target_not_in_allowed_targets":
      return `该角色不能转交给 ${targetRole}，未发起转交。${tail}`;
    case "depth_exceeded":
      return `转交层级已达上限，不能再继续转交给 ${targetRole}。${tail}`;
    case "target_not_published":
      return `本组织还没有可用的 ${targetRole} 角色，未发起转交。${tail}`;
    case "target_disabled":
      return `${targetRole} 角色目前已停用，未发起转交。${tail}`;
  }
}

/** E8：接收方对发起人无权读的引用固定显示的文案（ui.md §四）。 */
export const HANDOFF_SOURCE_UNAVAILABLE_COPY = "无法展示此来源";

/**
 * CONTRACT §11 `request-handoff` 的内核工具名（Python `tools.py` 的 `@tool def request_handoff`；
 * 原生准入表经生成物同步到 Python 侧）。每次调用都中断，由网关按 run 钉住的 `delegationPolicy` 判定。
 */
export const REQUEST_HANDOFF_TOOL_NAME = "request_handoff" as const;

/** Agent 发出的 request-handoff 参数：目标角色 + 交接包（只引用，不含摘录）。 */
export const RequestHandoffArgs = z.object({
  targetRole: AgentRoleRef,
  packet: HandoffPacket,
}).strict();

/** Handoff 聚合状态（domain.md）：`requested → confirmed | cancelled | rejected`。 */
export const HandoffStatus = z.enum(["requested", "confirmed", "cancelled", "rejected"]);

/**
 * 接收方重读的一条引用（E8）：以**发起人**身份重查读权限。无权 / 不存在 ⇒ `readable:false`，
 * 不带任何内容（不泄露存在性）；前端固定显示「无法展示此来源」。
 */
export const HandoffEvidenceItem = z.discriminatedUnion("readable", [
  z.object({ ref: Id, readable: z.literal(true), mime: z.string().max(255) }).strict(),
  z.object({ ref: Id, readable: z.literal(false) }).strict(),
]);

/** 聊天 handoff 卡片的读模型（只给发起人本人）。 */
export const HandoffView = z.object({
  handoffId: Id,
  sourceThreadId: Id,
  /** 发出转交请求的 Agent（卡片以它的消息呈现：头像 + 名字）。 */
  sourceAgentId: Id,
  targetRole: AgentRoleRef,
  targetAgentId: Id.nullable(),
  targetName: z.string().nullable(),
  status: HandoffStatus,
  packet: HandoffPacket,
  depth: z.number().int().min(1).max(2),
  /** `rejected` 时的原因（确认时复核失败）；其余状态为 null。 */
  notAllowedReason: HandoffNotAllowedReason.nullable(),
  newThreadId: Id.nullable(),
  createdAt: z.string(),
}).strict();

export const AgentRoleErrorCode = z.enum([
  "UNAUTHENTICATED",
  "AGENT_NOT_FOUND",            // 404：不存在/跨组织/visibility 不覆盖（E9，不泄露存在性）
  "ROLE_INSUFFICIENT",          // 403：非管理员写
  "OFFICIAL_ROLE_FIELDS_LOCKED",// 403/409：组织管理员改官方 Agent 白名单/策略（R5，须克隆）
  "HANDOFF_NOT_ALLOWED",        // 403：附 HandoffNotAllowedReason（E5）
  "HANDOFF_NOT_FOUND",
  "INTERRUPT_KIND_MISMATCH",    // 422：沿用 decision-guard 既有码（E6）
  "ESCALATION_DECIDER_FORBIDDEN", // 403：非目标人决策（E6）
  "VERSION_CHANGED",            // 409：沿用 agent-runtime 乐观并发码
  "VALIDATION_FAILED",
]);

/* ── 五、读模型 ───────────────────────────────────────────────────────── */

export const CapabilityReadiness = z.enum(["ready", "missing", "unknown"]);

/** 成员可见的目录卡片——不含授权详情（R5：成员只见「可用/能力未就绪」）。 */
export const AgentDirectoryCard = z.object({
  agentId: Id,
  versionId: Id,
  name: z.string(),
  initials: z.string(),
  roleLabel: z.string(),
  avatar: AgentAvatar.nullable(),
  roleCategory: AgentRoleCategory.nullable(),
  /** 已发布版本的标签（空数组 = 未打标签；前端回退 roleCategory）。 */
  tags: z.array(z.string()),
  catalogSource: AgentCatalogSource,
  workflows: z.array(z.object({ stableId: WorkflowStableId, name: z.string() }).strict()),
  readiness: CapabilityReadiness,
}).strict();

/**
 * 成员详情页补充读模型（AG04 follow-up，`/agent/[id]`）：只读、同目录卡片同一可见性判定（E9 一律 404）。
 * 不含授权详情（R5）：技能只给 ID（名字由成员可读的技能端点换），转交对象只列本组织目录里可见的角色。
 * `duty` 为空 = 未登记职责一句话（与名字/角色标签相同的占位值也视为空，不回显）。
 */
export const PendingSkillBinding = z.object({
  stableId: z.string().regex(/^S\d{3}$/),
  stableName: z.string().min(1),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.enum(["awaiting_verification", "missing_version"]),
  skillId: z.string().min(1).optional(),
  versionId: z.string().min(1).optional(),
  displayName: z.string().min(1).optional(),
}).strict();
export type PendingSkillBinding = z.infer<typeof PendingSkillBinding>;
export const AuthoredSkillBinding = PendingSkillBinding.pick({ stableId: true, stableName: true, contentDigest: true }).strict();
export type AuthoredSkillBinding = z.infer<typeof AuthoredSkillBinding>;

export const AgentDirectoryProfile = z.object({
  agentId: Id,
  duty: z.string().nullable(),
  /** Agent 行上直接挂载的技能（`agents.skill_mounts`）。 */
  mountedSkillIds: z.array(z.string()).max(64),
  /** 已发布版本钉住的技能版本（`agent_versions.skill_version_ids`）。 */
  pinnedSkillVersionIds: z.array(z.string()).max(64),
  /** Exact published pins, including versions older than the catalog current version. */
  pinnedSkills: z.array(z.object({ skillId: z.string(), versionId: z.string() }).strict()).max(64),
  /** Unverified/missing declared capabilities are informational, never executable pins. */
  pendingSkillBindings: z.array(PendingSkillBinding).max(64),
  /** 委派策略允许转交、且当前在目录中可见的角色。 */
  delegationTargets: z.array(z.object({
    agentId: Id,
    name: z.string(),
    initials: z.string(),
    roleLabel: z.string(),
    avatar: AgentAvatar.nullable(),
  }).strict()).max(32),
  requireApprovalForHandoff: z.boolean(),
}).strict();

/** 管理详情「角色」区块：含分类 → 已授权工具/缺失清单。 */
export const AgentRoleAdminView = z.object({
  agentId: Id,
  draft: AgentRoleFields,
  published: AgentRoleFields.nullable(),
  editable: z.boolean(), // catalogSource=official ⇒ false（白名单/策略只读）
  toolPolicy: z.array(CapabilityCategory),
  capabilityReadiness: z.array(z.object({
    category: CapabilityCategory,
    status: CapabilityReadiness,
    grantedToolNames: z.array(z.string()),
    isWrite: z.boolean(),
  }).strict()),
  version: z.number().int().nonnegative(),
}).strict();

/**
 * 官方数字人「待启用」要约（picker-ux，2026-09-30 人类反馈「看不到新增的数字人」）。
 * 官方角色包的导入仍是管理员动作（UC-3，本读模型不改变它）；这里只让成员/管理员在选人处
 * **看得到**本组织尚未启用的官方数字人，管理员一键启用走既有 `importAgentStarterPack`。
 * ⚠ 草案，未签核（additive 只读端点，待 agent-role 契约束补签）。
 */
export const OfficialRolePackOffer = z.object({
  packId: z.string(),
  packVersion: z.string(),
  /** 调用者是否组织管理员（= 能否一键启用）。 */
  canEnable: z.boolean(),
  /** 本组织尚未导入的官方角色（已导入的不在此列——它们以正常目录卡片出现）。 */
  pending: z.array(z.object({
    roleRef: AgentRoleRef,
    name: z.string(),
    roleLabel: z.string(),
    avatar: AgentAvatar.nullable(),
    roleCategory: AgentRoleCategory,
    tags: z.array(z.string()),
    workflowAllowlist: z.array(WorkflowStableId),
  }).strict()),
  /**
   * 一键启用时须先导入的 Skill 起步包（官方角色的 Workflow 所需；导入后由既有 follow-up 发布内置
   * Workflow）。客户端按序调既有 `importSkillStarterPack`，再导入本角色包——启用后数字人即可用。
   */
  requiredSkillPacks: z.array(z.object({ packId: z.string(), packVersion: z.string() }).strict()),
  /** Only untouched, provenance-checked official versions are offered for explicit admin upgrade. */
  upgrades: z.array(z.object({ agentId: Id, expectedPublishedVersionId: Id, name: z.string(), currentVersion: z.string(), targetVersion: z.string(), readySkillCount: z.number().int().nonnegative(), pendingSkillCount: z.number().int().nonnegative() }).strict()).optional(),
}).strict();
export type OfficialRolePackOffer = z.infer<typeof OfficialRolePackOffer>;

/* ── 六、operations ───────────────────────────────────────────────────── */

export const OfficialRoleUpgradeInput = z.object({
  packVersion: z.string().min(1).max(64),
  expectedOrgId: Id,
  selections: z.array(z.object({ agentId: Id, expectedPublishedVersionId: Id }).strict()).min(1).max(7)
    .refine((items) => new Set(items.map((i) => i.agentId)).size === items.length, "duplicate agent selection"),
  idempotencyKey: z.string().min(1).max(255),
}).strict();
export const OfficialRoleUpgradeResult = z.object({
  packVersion: z.string(), agentIds: z.array(Id), versionIds: z.array(Id), upgradedAt: z.string(),
}).strict();

export const operations = {
  upgradeOfficialRoles: {
    method: "POST", path: "/admin/agents/official-role-upgrades", in: OfficialRoleUpgradeInput,
    out: OfficialRoleUpgradeResult,
    err: ["UNAUTHENTICATED", "VALIDATION_FAILED", "AGENT_STARTER_IMPORT_ADMIN_REQUIRED", "OFFICIAL_ROLE_UPGRADE_CONFLICT"] as const,
  },
  /** AG04：成员目录。只返回已发布且 visibility 覆盖调用者的 Agent。 */
  listAgentDirectory: {
    method: "GET", path: "/agents/directory",
    in: z.object({
      roleCategory: AgentRoleCategory.optional(),
      q: z.string().max(100).optional(),
    }).strict(),
    out: z.object({ items: z.array(AgentDirectoryCard) }).strict(),
    err: ["UNAUTHENTICATED", "VALIDATION_FAILED"] as const,
  },
  /** 官方数字人待启用要约（见 `OfficialRolePackOffer`）。 */
  getOfficialRolePackOffer: {
    method: "GET", path: "/agents/official-role-pack/offer",
    in: z.object({}).strict(),
    out: OfficialRolePackOffer,
    err: ["UNAUTHENTICATED"] as const,
  },
  getAgentDirectoryCard: {
    method: "GET", path: "/agents/directory/:agentId",
    in: z.object({ agentId: Id }).strict(),
    out: AgentDirectoryCard,
    err: ["UNAUTHENTICATED", "AGENT_NOT_FOUND"] as const,
  },
  /** AG04 follow-up：成员详情页补充信息（职责、技能引用、可转交对象）。 */
  getAgentDirectoryProfile: {
    method: "GET", path: "/agents/directory/:agentId/profile",
    in: z.object({ agentId: Id }).strict(),
    out: AgentDirectoryProfile,
    err: ["UNAUTHENTICATED", "AGENT_NOT_FOUND"] as const,
  },
  /** AG04 管理详情角色区块。 */
  getAgentRoleAdmin: {
    method: "GET", path: "/admin/agents/:agentId/role",
    in: z.object({ agentId: Id }).strict(),
    out: AgentRoleAdminView,
    err: ["UNAUTHENTICATED", "AGENT_NOT_FOUND", "ROLE_INSUFFICIENT"] as const,
  },
  /** AG01：编辑草稿角色字段（仅 catalogSource=org）；发布走既有发布审核。 */
  updateAgentRoleDraft: {
    method: "PATCH", path: "/admin/agents/:agentId/role",
    in: z.object({
      agentId: Id,
      expectedVersion: z.number().int().nonnegative(),
      patch: AgentRoleFields.omit({ catalogSource: true }).partial(),
    }).strict(),
    out: AgentRoleAdminView,
    err: [
      "UNAUTHENTICATED", "AGENT_NOT_FOUND", "ROLE_INSUFFICIENT", "OFFICIAL_ROLE_FIELDS_LOCKED",
      "VERSION_CHANGED", "VALIDATION_FAILED",
    ] as const,
  },
  /** AG06：目标人对 escalate 中断决策（kind 与身份由 decision-guard 校验）。 */
  decideEscalation: {
    method: "POST", path: "/agent-interrupts/:interruptId/escalation-decision",
    in: z.object({ interruptId: Id, decision: EscalateDecision }).strict(),
    out: z.object({ interruptId: Id, status: z.enum(["resolved", "rejected"]) }).strict(),
    err: [
      "UNAUTHENTICATED", "AGENT_NOT_FOUND", "ESCALATION_DECIDER_FORBIDDEN",
      "INTERRUPT_KIND_MISMATCH", "VALIDATION_FAILED",
    ] as const,
  },
  /** AG07：发起人确认 Agent 发出的 request-handoff；成功在接收方新开线程。 */
  confirmHandoff: {
    method: "POST", path: "/agent-handoffs/:handoffId/confirm",
    in: z.object({ handoffId: Id }).strict(),
    out: z.object({ handoffId: Id, targetAgentId: Id, newThreadId: Id }).strict(),
    err: [
      "UNAUTHENTICATED", "HANDOFF_NOT_FOUND", "HANDOFF_NOT_ALLOWED", "VALIDATION_FAILED",
    ] as const,
  },
  cancelHandoff: {
    method: "POST", path: "/agent-handoffs/:handoffId/cancel",
    in: z.object({ handoffId: Id }).strict(),
    out: z.object({ handoffId: Id, status: z.literal("cancelled") }).strict(),
    err: ["UNAUTHENTICATED", "HANDOFF_NOT_FOUND"] as const,
  },
  /**
   * AG07：线程上的 handoff 卡片数据（只返回调用者本人发起的）。`requested` = 该线程里 Agent 发出、
   * 仍待确认或已处理的转交；`origin` = 该线程若由转交新开，其交接包与以发起人身份重读的引用（E8）。
   */
  listThreadHandoffs: {
    method: "GET", path: "/agent-handoffs",
    in: z.object({ threadId: Id }).strict(),
    out: z.object({
      requested: z.array(HandoffView),
      origin: z.object({ handoff: HandoffView, evidence: z.array(HandoffEvidenceItem) }).strict().nullable(),
    }).strict(),
    err: ["UNAUTHENTICATED", "VALIDATION_FAILED"] as const,
  },
} as const;
