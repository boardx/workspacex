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
export const AgentRoleCategory = z.enum(["research", "product", "sales", "design", "general"]);
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
};

/** 快照新增冻结字段名（AG01 测试断言它们 ⊆ SNAPSHOT_FROZEN_FIELDS）。 */
export const AGENT_ROLE_FROZEN_FIELDS = [
  "avatar", "roleCategory", "catalogSource", "workflowAllowlist",
  "delegationPolicy", "escalationPolicy", "kpi",
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
  catalogSource: AgentCatalogSource,
  workflows: z.array(z.object({ stableId: WorkflowStableId, name: z.string() }).strict()),
  readiness: CapabilityReadiness,
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

/* ── 六、operations ───────────────────────────────────────────────────── */

export const operations = {
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
  getAgentDirectoryCard: {
    method: "GET", path: "/agents/directory/:agentId",
    in: z.object({ agentId: Id }).strict(),
    out: AgentDirectoryCard,
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
} as const;
