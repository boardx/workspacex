/**
 * work-content.ts —— 三条内容线（研究 / 产品 / 销售）+ Board 运行卡投影 + 81 实体对账的
 * API 契约单一事实源（ADR-020 / ADR-023 签核③）。
 *
 * 契约束：phases/phase-20-work-stack-foundation/contracts/work-content/
 * 依据：requirements/05-content-lines.md R1–R12；ADR-116（Agent 即 DigitalHuman）、ADR-117（WorkSkillManifest）、
 * ADR-118（通用 Runtime；#6 effect-gateway 执行前重查权限；#9 Workflow 固定 Skill 版本）、ADR-119（G0–G5）、
 * ADR-120（能力分类）。
 *
 * 本文件**只新增内容线专属形状**；实例状态、错误码、SSE 信封、人工门 approve/deny 一律复用
 * `workflow-runtime.ts`（不复述、不另起枚举）；目录条目/通道/门状态复用 `work-skill-meta.ts` / `work-eval.ts`；
 * 角色白名单复用 `agent-role.ts`；Board 来源枚举复用 `board.ts` 的 `SourceKind`。
 * 不变量权威在同束 domain.md（I-C1～I-C14）。
 *
 * ⚠ 本文件暂未从 index.ts 导出（导出由独立步骤负责）。
 */
import { z } from "zod";
import { WORKFLOW_RUN_SOURCE_KIND } from "./board";
import {
  WorkflowInstanceStatus,
  WorkflowKey,
  WorkflowDefinitionVersionNo,
  WorkflowStageId,
  WorkflowRequestId,
  CapabilityCategory,
  WorkflowErrorBody,
} from "./workflow-runtime";
import { WorkflowStableId } from "./agent-role";

/* ── 基础标识（v2 实体编号；与 WORK-STACK-320-LIST.md 对齐） ─────────────── */

export const WorkSkillStableId = z.string().regex(/^S\d{3}$/);
export const DigitalHumanStableId = z.string().regex(/^D\d{3}$/);
export { WorkflowStableId };
/** sha256 十六进制 digest（pack 文件、产出、变更集共用格式）。 */
export const Sha256Digest = z.string().regex(/^[0-9a-f]{64}$/);
/** 证据引用：指向检索结果 / 知识条目 / 会议记录片段的不透明 ref。 */
export const EvidenceRef = z.string().min(1).max(512);

/** 三条内容线（包名为提案名，见 05 号 R1 系统边界）。 */
export const WorkContentLine = z.enum(["research", "product", "sales", "shared"]);

/* ── 封闭枚举（新增成员须经 ADR；见 domain.md 第三节） ─────────────────── */

/**
 * 内容线专属失败码。HTTP 通用错误（not_found / not_allowed / state_version_conflict …）
 * 一律用 workflow-runtime 的 WorkflowErrorCode，这里只放 05 号 R4 新出现的语义。
 */
export const WorkContentErrorCode = z.enum([
  "workflow_skill_pin_unresolved", // E2：注册时固定的 Skill 版本不在目录或门状态不达标 → 该 Workflow 不可用
  "workflow_not_allowlisted", // E3：角色 Agent 白名单外（HTTP 层映射到 runtime 的 workflow_not_allowed 403，body 带 handoffHint）
  "lead_decision_stale", // E4/A3：决定所绑定的 digest 已被上游重算
  "gate_item_not_found", // 决定卡条目不存在于该门
  "recipient_not_resolvable", // W013 G2：收件人只能由服务端解析，客户端不得指定
]);
export type WorkContentErrorCode = z.infer<typeof WorkContentErrorCode>;

/** Workflow 目录可用性（E2）。 */
export const WorkflowAvailability = z.enum(["available", "unavailable"]);

/**
 * 内容线产出的终局语义（叠加在 runtime 的 `succeeded` 之上，不新增实例状态，见 domain I-C9）：
 * `complete` 正常；`with_holds` = 05 号所说 completed_with_holds（A4 数据需求说明 / W011 部分 hold）。
 */
export const WorkContentOutcome = z.enum(["complete", "with_holds"]);

/** 外部写入逐条结果（W011 阶段 7；E4/E5/A5）。 */
export const CrmWriteItemOutcome = z.enum([
  "written", // 恰好一次写入（receipt finalized）
  "conflict", // 乐观并发冲突，未覆盖（E4）
  "forbidden", // P2/P3 重查失败，未写（E5）
  "written_manual", // 组织未授权 crm.write，进人工核对清单（A5）
  "rejected", // G1 驳回，零副作用（E7）
  "held", // 单线索级错误不中断实例（E11）
]);

/** Board 运行卡状态徽标（R8）。列映射见 domain I-C11。 */
export const BoardRunBadge = z.enum(["in_progress", "awaiting_review", "done", "rejected", "failed"]);

/** Board 来源类型新增值——单源在 board.SourceKind（CT10 落地），这里只转出。 */
export { WORKFLOW_RUN_SOURCE_KIND } from "./board";

/* ── 产出 schema（结论必带证据：R7 / I-C6） ───────────────────────────── */

export const EvidencedClaim = z
  .object({
    claimId: z.string().min(1),
    text: z.string().min(1),
    evidenceRefs: z.array(EvidenceRef).min(1), // 空数组不合法：没有证据不得产出结论
    confidence: z.enum(["low", "medium", "high"]),
  })
  .strict();

/** W001 简报（S020 产出，经 S171 证据评审）。 */
export const ResearchBrief = z
  .object({
    kind: z.literal("research_brief"),
    title: z.string().min(1),
    claims: z.array(EvidencedClaim).min(1),
    risks: z.array(EvidencedClaim), // S010
    digest: Sha256Digest,
  })
  .strict();

/** A4：无可检索材料时的产出（不编造结论）。 */
export const DataNeedsStatement = z
  .object({
    kind: z.literal("data_needs_statement"),
    question: z.string().min(1),
    missing: z.array(z.string().min(1)).min(1),
    digest: Sha256Digest,
  })
  .strict();

/** W029 PRD 工件（S064→S065→S067→S068→S162）。 */
export const PrdArtifact = z
  .object({
    kind: z.literal("prd"),
    title: z.string().min(1),
    problem: EvidencedClaim,
    requirements: z.array(z.object({ id: z.string(), text: z.string(), priority: z.string() }).strict()).min(1),
    metrics: z.array(z.object({ name: z.string(), definition: z.string() }).strict()).min(1),
    digest: Sha256Digest,
  })
  .strict();

/** W013 新商机载荷：**只**允许这五个字段（V6）；amount/closeDate/stage 进 deferredProposals。 */
export const NewOpportunityPayload = z
  .object({
    accountId: z.string().min(1),
    name: z.string().min(1),
    initialStage: z.string().min(1),
    ownerId: z.string().min(1),
    sourceMeetingRef: z.string().min(1),
  })
  .strict();

export const DeferredProposal = z
  .object({ field: z.enum(["amount", "closeDate", "stage"]), proposedValue: z.string(), evidenceRefs: z.array(EvidenceRef) })
  .strict();

export const WorkContentOutput = z.discriminatedUnion("kind", [ResearchBrief, DataNeedsStatement, PrdArtifact]);

/* ── 决定卡（W011 G1 逐条 / W013 G1 三联）——在 runtime 门之上的逐条决定 ─── */

export const LeadDecisionItemView = z
  .object({
    itemId: z.string().min(1),
    company: z.string(),
    tier: z.string(), // S022
    triage: z.string(), // S025
    hygieneIssues: z.array(z.string()), // S034
    evidenceRefs: z.array(EvidenceRef),
    recordVersion: z.string().nullable(), // 阶段读到的 CRM 记录版本（乐观并发）
    itemDigest: Sha256Digest,
    outcome: CrmWriteItemOutcome.nullable(), // 执行后回填
    conflictDiff: z.record(z.string(), z.object({ before: z.unknown(), current: z.unknown() }).strict()).nullable(), // E4
  })
  .strict();

export const LeadDecisionInput = z
  .object({
    instanceId: z.string().min(1),
    gateId: z.string().min(1),
    requestId: WorkflowRequestId,
    expectedStateVersion: z.number().int().positive(),
    decisions: z
      .array(
        z
          .object({
            itemId: z.string().min(1),
            itemDigest: Sha256Digest, // 批准绑定 digest（R7）
            decision: z.enum(["approve", "reject", "retier"]),
            newTier: z.string().optional(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const MeetingFollowupDecisionInput = z
  .object({
    instanceId: z.string().min(1),
    gateId: z.string().min(1),
    requestId: WorkflowRequestId,
    expectedStateVersion: z.number().int().positive(),
    recordDigest: Sha256Digest, // S028
    framingDecision: z.enum(["create_new", "merge_existing", "no_opportunity"]), // S023 三选一
    changeSetDigest: Sha256Digest, // S029
    decision: z.enum(["approve", "reject"]),
  })
  .strict();

/* ── 目录（Workflow 可用性 + 81 实体对账） ─────────────────────────────── */

export const WorkflowSkillPin = z
  .object({ skillId: WorkSkillStableId, semanticVersion: z.string().min(1) })
  .strict();

export const WorkflowCatalogItem = z
  .object({
    workflowId: WorkflowStableId,
    key: WorkflowKey,
    version: WorkflowDefinitionVersionNo,
    title: z.string(),
    line: WorkContentLine,
    skillPins: z.array(WorkflowSkillPin),
    stages: z.array(z.object({ stageId: WorkflowStageId, title: z.string() }).strict()),
    gates: z.array(z.object({ gateId: z.string(), stageId: WorkflowStageId, requiresDualSign: z.boolean() }).strict()),
    effects: z.array(CapabilityCategory),
    availability: WorkflowAvailability,
    unavailableReason: z.literal("workflow_skill_pin_unresolved").nullable(),
    unresolvedPins: z.array(WorkflowSkillPin), // availability=available 时必为空（I-C4）
  })
  .strict();

export const Phase1ReconciliationEntity = z
  .object({
    id: z.union([WorkSkillStableId, WorkflowStableId, DigitalHumanStableId]),
    kind: z.enum(["skill", "workflow", "agent"]),
    visibleCount: z.number().int().nonnegative(), // 必须恰为 1（V2）
    gateStatusPresent: z.boolean(),
  })
  .strict();

export const Phase1Reconciliation = z
  .object({
    expected: z.object({ skill: z.literal(58), workflow: z.literal(19), agent: z.literal(4) }).strict(),
    entities: z.array(Phase1ReconciliationEntity),
    missing: z.array(z.string()),
    unexpected: z.array(z.string()), // 例：W017 出现即进这里
    ok: z.boolean(),
  })
  .strict();

/* ── Board 只读运行卡（CT10） ──────────────────────────────────────────── */

export const BoardRunCardAgent = z
  .object({ agentId: z.string(), digitalHumanId: DigitalHumanStableId.nullable(), displayName: z.string(), avatarUrl: z.string().nullable() })
  .strict();

export const BoardWorkflowRunCard = z
  .object({
    id: z.string().min(1), // 卡 ID = `workflow_run:<instanceId>`，两视图一致
    sourceKind: z.literal(WORKFLOW_RUN_SOURCE_KIND),
    instanceId: z.string().min(1),
    title: z.string(), // Workflow 名 + 发起对象
    instanceStatus: WorkflowInstanceStatus,
    column: z.enum(["in_progress", "review", "done"]),
    badge: BoardRunBadge,
    initiatorUserId: z.string(),
    agents: z.array(BoardRunCardAgent), // 发起 Agent + 转交链；A1 时为空
    draggable: z.literal(false),
    href: z.string(), // 跳实例详情
  })
  .strict();

/* ── operations ─────────────────────────────────────────────────────────── */

export const operations = {
  /** UC-WC-1：Workflow 目录（含不可用原因）。CT02/CT05/CT08。 */
  listWorkflowCatalog: {
    method: "GET",
    path: "/workflows/catalog",
    in: z.object({ line: WorkContentLine.optional(), agentId: z.string().optional() }).strict(),
    out: z.object({ items: z.array(WorkflowCatalogItem) }).strict(),
    err: [] as const,
  },

  /** UC-WC-2：单个 Workflow 目录详情。 */
  getWorkflowCatalogEntry: {
    method: "GET",
    path: "/workflows/catalog/:workflowId",
    in: z.object({ workflowId: WorkflowStableId }).strict(),
    out: WorkflowCatalogItem,
    err: ["workflow_not_found"] as const,
  },

  /** UC-WC-3：读实例产出（简报 / 数据需求说明 / PRD）。CT03/CT06。 */
  getInstanceOutput: {
    method: "GET",
    path: "/workflow-instances/:instanceId/output",
    in: z.object({ instanceId: z.string().min(1) }).strict(),
    out: z
      .object({
        instanceId: z.string(),
        outcome: WorkContentOutcome,
        output: WorkContentOutput.nullable(),
        crmItems: z.array(LeadDecisionItemView), // 非销售线为空
        manualChecklist: z.array(z.string()), // A5 / W013 决策 6
        deferredProposals: z.array(DeferredProposal),
      })
      .strict(),
    err: ["workflow_not_found"] as const,
  },

  /** UC-WC-4：W011 G1 线索决定卡读取。CT09。 */
  getLeadDecisionCard: {
    method: "GET",
    path: "/workflow-instances/:instanceId/gates/:gateId/lead-items",
    in: z.object({ instanceId: z.string().min(1), gateId: z.string().min(1) }).strict(),
    out: z.object({ stateVersion: z.number().int(), items: z.array(LeadDecisionItemView) }).strict(),
    err: ["workflow_not_found", "gate_not_open"] as const,
  },

  /** UC-WC-5：W011 G1 逐条决定（批准/驳回/改层级）。CT09。 */
  decideLeadItems: {
    method: "POST",
    path: "/workflow-instances/:instanceId/gates/:gateId/lead-decisions",
    in: LeadDecisionInput,
    out: z.object({ stateVersion: z.number().int(), items: z.array(LeadDecisionItemView) }).strict(),
    err: [
      "workflow_not_found",
      "gate_not_open",
      "not_designated_approver",
      "self_approval_forbidden",
      "state_version_conflict",
      "idempotency_key_reused",
      "lead_decision_stale",
      "gate_item_not_found",
    ] as const,
  },

  /** UC-WC-6：W013 G1 三联决定（绑定 recordDigest+framingDecision+changeSetDigest）。 */
  decideMeetingFollowup: {
    method: "POST",
    path: "/workflow-instances/:instanceId/gates/:gateId/meeting-followup-decision",
    in: MeetingFollowupDecisionInput,
    out: z
      .object({ stateVersion: z.number().int(), newOpportunity: NewOpportunityPayload.nullable(), deferredProposals: z.array(DeferredProposal) })
      .strict(),
    err: [
      "workflow_not_found",
      "gate_not_open",
      "not_designated_approver",
      "state_version_conflict",
      "lead_decision_stale",
    ] as const,
  },

  /** UC-WC-7：Board 运行卡（先权限过滤再投影）。CT10。 */
  listBoardRunCards: {
    method: "GET",
    path: "/board/workflow-run-cards",
    in: z.object({ projectId: z.string().optional() }).strict(),
    out: z.object({ cards: z.array(BoardWorkflowRunCard) }).strict(),
    err: [] as const,
  },

  /** UC-WC-8：81 实体对账（运营 / CI）。CT11。 */
  getPhase1Reconciliation: {
    method: "GET",
    path: "/admin/work-stack/phase1/reconciliation",
    in: z.object({}).strict(),
    out: Phase1Reconciliation,
    err: [] as const,
  },
} as const;

/** 白名单外发起时 403 body 的附加提示（E3：可转交，不静默降级）。 */
export const WorkflowNotAllowlistedHint = z
  .object({
    code: z.literal("workflow_not_allowlisted"),
    requestedWorkflowId: WorkflowStableId,
    handoffCandidates: z.array(DigitalHumanStableId), // 例：D011 请求 W030 → ["D003"]
  })
  .strict();

/**
 * E3 的 403 失败体：`workflowRuntime.startInstance` 的 `WorkflowErrorBody`（code = workflow_not_allowed）
 * 附 `allowlistHint`。只在「Agent 可运行但 Workflow 不在其已发布白名单内」时出现。
 */
export const WorkflowNotAllowedErrorBody = WorkflowErrorBody.extend({
  allowlistHint: WorkflowNotAllowlistedHint,
}).strict();
