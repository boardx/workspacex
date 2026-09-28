/**
 * workflow-runtime.ts —— 通用 Workflow Runtime 的 API 契约单一事实源（ADR-020 / ADR-023 签核③）。
 *
 * 契约束：phases/phase-20-work-stack-foundation/contracts/workflow-runtime/
 * 依据：requirements/02-workflow-runtime.md R1–R12；ADR-118 第 1–9 条；ADR-116 第 3 条；ADR-120 第 1–3 条。
 *
 * 单源纪律（02 号文件 R7 最后一条）：SSE 信封、实例/阶段状态枚举、reasonCode 只在本文件定义一次，
 * 前后端共用；前端 mock 从本文件生成，不许手写。
 * 不变量（封闭枚举、seq 单调、版本固定……）的权威在同束 domain.md，本文件只描述形状。
 *
 * ⚠ 本文件暂未从 index.ts 导出（导出由独立步骤负责）。
 */
import { z } from "zod";

/* ── 基础标识 ─────────────────────────────────────────────────────────── */

/** Workflow key：小写 kebab，例如 `guided-research`、`research-to-brief`。 */
export const WorkflowKey = z.string().regex(/^[a-z][a-z0-9-]{1,62}$/);
/** Definition 版本号：正整数，发布后不可变（domain I-2）。 */
export const WorkflowDefinitionVersionNo = z.number().int().positive();
/** 图工厂注册键 `key:version`，同时用作 checkpoint_ns（domain I-9）。 */
export const WorkflowGraphRef = z.string().regex(/^[a-z][a-z0-9-]{1,62}:[1-9][0-9]*$/);
export const WorkflowStageId = z.string().regex(/^[a-z][a-z0-9_-]{0,62}$/);
/** 客户端幂等键；webhook 用 Idempotency-Key，pg-boss 用作业 id（domain I-6）。 */
export const WorkflowRequestId = z.string().min(8).max(200);
/** ADR-120 能力分类，形如 `crm.write`、`mail.send`；只写分类，不写供应商。 */
export const CapabilityCategory = z.string().regex(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_.]*$/);

/* ── 封闭枚举（新增成员须经 ADR；见 domain.md 第三节） ─────────────────── */

export const WorkflowDefinitionVersionStatus = z.enum(["draft", "published", "retired"]);

export const WorkflowInstanceStatus = z.enum([
  "running",
  "awaiting_gate_decision",
  "blocked_permission",
  "cancelling",
  "succeeded",
  "failed",
  "cancelled",
  "rejected",
  "needs_attention",
]);
export type WorkflowInstanceStatus = z.infer<typeof WorkflowInstanceStatus>;

/** 终态集合（02 号文件 R6）；终态不可再迁移（domain I-12）。 */
export const WORKFLOW_TERMINAL_STATUSES: readonly WorkflowInstanceStatus[] = Object.freeze([
  "succeeded",
  "failed",
  "cancelled",
  "rejected",
  "needs_attention",
]);

export const WorkflowStageStatus = z.enum([
  "pending",
  "running",
  "awaiting_gate_decision",
  "blocked_permission",
  "succeeded",
  "failed",
  "skipped",
  "rejected",
]);

/** 副作用类别（沿 MCP `sideEffect` 封顶语义；ADR-118 第 6 条）。 */
export const WorkflowSideEffectClass = z.enum(["none", "read", "write", "external_send"]);

export const WorkflowTriggerKind = z.enum(["manual", "schedule", "webhook"]);

export const WorkflowGateDecision = z.enum(["approved", "denied"]);

export const WorkflowEffectReceiptStatus = z.enum(["begun", "finalized", "reconciled", "unresolved"]);

/**
 * 统一错误码（HTTP 失败响应体的 `code`）。封闭；UI 靠它渲染异常态。
 * 对照 02 号文件 R4 的 A5/E2–E7 与 R5。
 */
export const WorkflowErrorCode = z.enum([
  "workflow_not_found", // 404：不存在或不可见（他组织/非成员一律 404，不是 403）
  "workflow_version_not_published", // 422：指定版本未发布或已下线
  "workflow_not_allowed", // 403：Agent 不在 workflowAllowlist / 发起人无 Agent 运行权限（E6）
  "skill_version_unresolved", // 422：Skill versionRange 无法解析（E5）
  "trigger_input_invalid", // 422：trigger 输入不符合 Definition 的 inputSchema
  "definition_invalid", // 422：发布校验失败（图工厂未注册 / 阶段与节点不一一对应 / Skill 引用不可解析）
  "state_version_conflict", // 409：expectedStateVersion 过期（E3），带 latestProjection
  "instance_terminal", // 409：对终态实例 cancel/retry/resume
  "gate_already_decided", // 409：人工门已被他人决定（A5/E13）
  "gate_not_open", // 409：阶段当前不在 awaiting_gate_decision
  "not_designated_approver", // 403：非指定审批人
  "self_approval_forbidden", // 403：allowSelfApproval=false 时发起人自批
  "deny_reason_required", // 422：deny 缺理由
  "idempotency_key_reused", // 409：同 requestId/Idempotency-Key 不同 payload 指纹（E7）
  "webhook_signature_invalid", // 401：签名错或时间戳超 5 分钟窗（E7）
  "lease_conflict", // 409：并发 resume 未拿到 lease（E2）
  "stage_not_retryable", // 409：阶段不处于 failed，或超出重试上限规则
]);
export type WorkflowErrorCode = z.infer<typeof WorkflowErrorCode>;

/**
 * 阶段 / 实例阻断原因（事件与 projection 中的 `reasonCode`）。封闭。
 * 不是 HTTP 错误码：它描述运行中发生的事，由面板提示条渲染（E1/E2/E4/E9/E11）。
 */
export const WorkflowReasonCode = z.enum([
  "initiator_not_member", // E4：发起人被移出组织
  "agent_permission_revoked", // E4：Agent 工具策略不再允许
  "tool_authorization_revoked", // E4：ToolExecutionAuthority 撤销授权
  "capability_exceeds_side_effect_cap", // E4：能力分类超过 MCP sideEffect 封顶
  "effect_unreconciled", // E1：begin 未 finalize 且无只读对账 → needs_attention
  "checkpoint_missing", // E11：checkpoint 丢失或损坏
  "stage_attempts_exhausted", // E9：超出重试上限
  "workflow_lease_lost", // E2：epoch 过期，副作用前 assertLease 失败
  "cancel_requested", // 取消后下一个副作用被 effect-gateway 拦下
  "gate_denied", // A4：人工门拒绝
]);
export type WorkflowReasonCode = z.infer<typeof WorkflowReasonCode>;

/* ── Definition 元数据（ADR-118 第 2 条：代码图工厂 + 版本化元数据） ─────── */

export const WorkflowSkillRef = z
  .object({ stableId: z.string().min(1), versionRange: z.string().min(1) })
  .strict();

export const WorkflowHumanGate = z
  .object({
    /** 指定审批人：按组织角色或具体成员，至少一项非空。 */
    approverRoles: z.array(z.string().min(1)).default([]),
    approverUserIds: z.array(z.string().min(1)).default([]),
    allowSelfApproval: z.boolean().default(false),
    /** A4：拒绝后回到的阶段；null = 实例置 rejected 终态。 */
    onDenyStageId: WorkflowStageId.nullable(),
  })
  .strict()
  .refine((g) => g.approverRoles.length + g.approverUserIds.length > 0, {
    message: "humanGate 至少指定一个审批角色或成员",
  });

export const WorkflowStageDefinition = z
  .object({
    stageId: WorkflowStageId,
    title: z.string().min(1),
    skills: z.array(WorkflowSkillRef),
    capabilityCategories: z.array(CapabilityCategory),
    sideEffect: WorkflowSideEffectClass,
    humanGate: WorkflowHumanGate.nullable(),
    maxAttempts: z.number().int().min(1).max(10),
  })
  .strict();

const WorkflowDefinitionVersionFields = z
  .object({
    key: WorkflowKey,
    version: WorkflowDefinitionVersionNo,
    /** 必须是代码注册表中已存在的图工厂（domain I-3）。 */
    graphRef: WorkflowGraphRef,
    title: z.string().min(1),
    /** trigger 输入的 JSON Schema（前端按它渲染表单）。 */
    inputSchema: z.record(z.string(), z.unknown()),
    stages: z.array(WorkflowStageDefinition).min(1),
  })
  .strict();

/**
 * 形状层可判的发布前置（domain I-3 的静态部分；「图工厂已注册 / 与图节点一一对应」需代码注册表，由 api 判）：
 * graphRef 必须等于 `key:version`（它同时是 checkpoint_ns）；stageId 不重复；
 * humanGate.onDenyStageId 必须指向本定义内的阶段。
 */
function refineDefinitionVersion(
  d: { key: string; version: number; graphRef: string; stages: { stageId: string; humanGate: { onDenyStageId: string | null } | null }[] },
  ctx: z.RefinementCtx,
): void {
  if (d.graphRef !== `${d.key}:${d.version}`) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["graphRef"], message: "graphRef 必须等于 `key:version`" });
  }
  const ids = new Set<string>();
  d.stages.forEach((st, i) => {
    if (ids.has(st.stageId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["stages", i, "stageId"], message: `重复的 stageId: ${st.stageId}` });
    }
    ids.add(st.stageId);
  });
  d.stages.forEach((st, i) => {
    const target = st.humanGate?.onDenyStageId;
    if (target != null && !ids.has(target)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["stages", i, "humanGate", "onDenyStageId"],
        message: `onDenyStageId 指向不存在的阶段: ${target}`,
      });
    }
  });
}

export const WorkflowDefinitionVersionInput = WorkflowDefinitionVersionFields.superRefine(refineDefinitionVersion);
export type WorkflowDefinitionVersionInput = z.infer<typeof WorkflowDefinitionVersionInput>;
export type WorkflowStageDefinition = z.infer<typeof WorkflowStageDefinition>;

export const WorkflowDefinitionVersionView = WorkflowDefinitionVersionFields.extend({
  status: WorkflowDefinitionVersionStatus,
  publishedAt: z.string().nullable(),
})
  .strict()
  .superRefine(refineDefinitionVersion);
export type WorkflowDefinitionVersionView = z.infer<typeof WorkflowDefinitionVersionView>;
export type PinnedSkillVersion = z.infer<typeof PinnedSkillVersion>;

/* ── 实例 projection（只来自业务行，不读 channel_values；domain I-8） ───────── */

export const PinnedSkillVersion = z
  .object({ stageId: WorkflowStageId, stableId: z.string().min(1), version: z.string().min(1) })
  .strict();

export const WorkflowGateView = z
  .object({
    gateId: z.string().min(1),
    stageId: WorkflowStageId,
    /** 待执行副作用预览（gate_opened 事件内容；不含密钥/凭证，domain I-15）。 */
    effectPreview: z
      .object({
        capabilityCategory: CapabilityCategory,
        targetSystem: z.string().min(1),
        summary: z.string().min(1),
        payloadPreview: z.record(z.string(), z.unknown()),
      })
      .strict(),
    decision: WorkflowGateDecision.nullable(),
    decidedBy: z.string().nullable(),
    decidedAt: z.string().nullable(),
    reason: z.string().nullable(),
    /** 当前查看者能否决定（前端据此启用按钮；E13）。 */
    viewerCanDecide: z.boolean(),
  })
  .strict();

export const WorkflowStageView = z
  .object({
    stageId: WorkflowStageId,
    title: z.string().min(1),
    status: WorkflowStageStatus,
    attempt: z.number().int().positive(),
    pinnedSkills: z.array(PinnedSkillVersion),
    /** 业务产出链接（workflow_stage_outputs 指针）。 */
    outputs: z.array(z.object({ outputId: z.string(), label: z.string(), href: z.string() }).strict()),
    reasonCode: WorkflowReasonCode.nullable(),
    startedAt: z.string().nullable(),
    finishedAt: z.string().nullable(),
  })
  .strict();

export const WorkflowEffectProvenance = z
  .object({
    effectKey: z.string().min(1),
    stageId: WorkflowStageId,
    capabilityCategory: CapabilityCategory,
    status: WorkflowEffectReceiptStatus,
    initiatorUserId: z.string(),
    agentId: z.string(),
    agentVersionId: z.string(),
    skillVersion: PinnedSkillVersion.nullable(),
    gateId: z.string().nullable(),
    finalizedAt: z.string().nullable(),
  })
  .strict();

export const WorkflowInstanceProjection = z
  .object({
    instanceId: z.string().min(1),
    orgId: z.string().min(1),
    workflowKey: WorkflowKey,
    definitionVersion: WorkflowDefinitionVersionNo,
    agentId: z.string().min(1),
    agentVersionId: z.string().min(1),
    initiatorUserId: z.string().min(1),
    triggerKind: WorkflowTriggerKind,
    status: WorkflowInstanceStatus,
    stateVersion: z.number().int().positive(),
    reasonCode: WorkflowReasonCode.nullable(),
    stages: z.array(WorkflowStageView),
    openGate: WorkflowGateView.nullable(),
    effects: z.array(WorkflowEffectProvenance),
    lastSeq: z.number().int().nonnegative(),
    viewerCapabilities: z
      .object({ canCancel: z.boolean(), canRetryStage: z.boolean(), canResume: z.boolean() })
      .strict(),
    createdAt: z.string(),
    updatedAt: z.string(),
  })
  .strict();
export type WorkflowInstanceProjection = z.infer<typeof WorkflowInstanceProjection>;

export const WorkflowInstanceSummary = WorkflowInstanceProjection.pick({
  instanceId: true,
  workflowKey: true,
  definitionVersion: true,
  agentId: true,
  status: true,
  stateVersion: true,
  reasonCode: true,
  createdAt: true,
  updatedAt: true,
}).strict();

/** 统一失败响应体。state_version_conflict 必带 latestProjection（E3）；gate_already_decided 带 decidedGate（A5）。 */
export const WorkflowErrorBody = z
  .object({
    code: WorkflowErrorCode,
    message: z.string(),
    latestProjection: WorkflowInstanceProjection.optional(),
    decidedGate: WorkflowGateView.optional(),
    missingSkills: z.array(z.string()).optional(),
  })
  .strict();

/* ── SSE 信封（ADR-118 第 3 条；domain I-10/I-11） ───────────────────────── */

export const WorkflowEventType = z.enum([
  "instance_started",
  "stage_started",
  "stage_output_written",
  "stage_succeeded",
  "stage_failed",
  "stage_retried",
  "gate_opened",
  "gate_decided",
  "effect_begun",
  "effect_finalized",
  "effect_blocked",
  "status_changed",
  "cancel_requested",
]);

export const WorkflowSseEnvelope = z.discriminatedUnion("type", [
  z
    .object({
      instanceId: z.string().min(1),
      seq: z.number().int().nonnegative(),
      type: z.literal("snapshot"),
      stateVersion: z.number().int().positive(),
      payload: WorkflowInstanceProjection,
    })
    .strict(),
  z
    .object({
      instanceId: z.string().min(1),
      seq: z.number().int().positive(),
      type: z.literal("delta"),
      stateVersion: z.number().int().positive(),
      payload: z
        .object({
          event: WorkflowEventType,
          stageId: WorkflowStageId.nullable(),
          reasonCode: WorkflowReasonCode.nullable(),
          data: z.record(z.string(), z.unknown()),
        })
        .strict(),
    })
    .strict(),
]);
export type WorkflowSseEnvelope = z.infer<typeof WorkflowSseEnvelope>;

/* ── 触发器 payload ─────────────────────────────────────────────────────── */

/** pg-boss 作业 payload（泛化 `workspacex-scheduled-run`；原 agent-run 形状不变）。 */
export const WorkflowScheduledJobPayload = z
  .object({ kind: z.literal("workflow"), triggerId: z.string().min(1) })
  .strict();

/** webhook 头部名单源（R9：HMAC-SHA256 + 5 分钟窗）。 */
export const WORKFLOW_WEBHOOK_HEADERS = Object.freeze({
  signature: "x-workspacex-signature",
  timestamp: "x-workspacex-timestamp",
  idempotencyKey: "idempotency-key",
});
export const WORKFLOW_WEBHOOK_TIMESTAMP_WINDOW_SECONDS = 300;

/* ── operations ─────────────────────────────────────────────────────────── */

const ExpectedStateVersion = z.number().int().positive();

export const workflowRuntime = {
  /** UC-WR-1：管理员发布 Definition 版本（WF01）。 */
  publishDefinitionVersion: {
    method: "POST",
    path: "/workflows/:key/versions",
    in: WorkflowDefinitionVersionInput,
    out: WorkflowDefinitionVersionView,
    err: ["workflow_not_found", "definition_invalid"] as const,
  },

  /** UC-WR-2：列出对某 Agent 可运行的 Workflow（「运行 Workflow」入口；E6 不可运行者不返回）。 */
  listRunnableWorkflows: {
    method: "GET",
    path: "/agents/:agentId/runnable-workflows",
    in: z.object({ agentId: z.string().min(1) }).strict(),
    out: z
      .object({
        items: z.array(
          z
            .object({
              key: WorkflowKey,
              version: WorkflowDefinitionVersionNo,
              title: z.string(),
              inputSchema: z.record(z.string(), z.unknown()),
            })
            .strict(),
        ),
      })
      .strict(),
    err: ["workflow_not_found"] as const,
  },

  /** UC-WR-3：start（WF03）；201。同 requestId 重放返回首次稳定响应（A1）。 */
  startInstance: {
    method: "POST",
    path: "/workflows/:key/instances",
    in: z
      .object({
        key: WorkflowKey,
        version: WorkflowDefinitionVersionNo.optional(),
        agentId: z.string().min(1),
        requestId: WorkflowRequestId,
        input: z.record(z.string(), z.unknown()),
      })
      .strict(),
    out: z
      .object({
        instanceId: z.string().min(1),
        status: WorkflowInstanceStatus,
        stateVersion: z.number().int().positive(),
        definitionVersion: WorkflowDefinitionVersionNo,
        pinnedSkills: z.array(PinnedSkillVersion),
      })
      .strict(),
    err: [
      "workflow_not_found",
      "workflow_version_not_published",
      "workflow_not_allowed",
      "skill_version_unresolved",
      "trigger_input_invalid",
      "idempotency_key_reused",
    ] as const,
  },

  /** UC-WR-4：读实例 projection（面板 & SSE 降级轮询）。他组织/无关成员 404。 */
  getInstance: {
    method: "GET",
    path: "/workflow-instances/:instanceId",
    in: z.object({ instanceId: z.string().min(1) }).strict(),
    out: WorkflowInstanceProjection,
    err: ["workflow_not_found"] as const,
  },

  /** UC-WR-5：「我的运行」列表，按状态筛选。 */
  listMyInstances: {
    method: "GET",
    path: "/workflow-instances",
    in: z
      .object({
        status: z.array(WorkflowInstanceStatus).optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(100).default(20),
      })
      .strict(),
    out: z.object({ items: z.array(WorkflowInstanceSummary), nextCursor: z.string().nullable() }).strict(),
    err: [] as const,
  },

  /** UC-WR-6：SSE 事件流；`lastEventId` 来自 Last-Event-ID 头（E10）。每条 data 为 WorkflowSseEnvelope。 */
  streamInstanceEvents: {
    method: "GET",
    path: "/workflow-instances/:instanceId/events",
    in: z
      .object({ instanceId: z.string().min(1), lastEventId: z.number().int().nonnegative().optional() })
      .strict(),
    out: WorkflowSseEnvelope,
    err: ["workflow_not_found"] as const,
  },

  /** UC-WR-7：cancel（带 expectedStateVersion；E3）。 */
  cancelInstance: {
    method: "POST",
    path: "/workflow-instances/:instanceId/cancel",
    in: z
      .object({ instanceId: z.string().min(1), expectedStateVersion: ExpectedStateVersion, requestId: WorkflowRequestId })
      .strict(),
    out: z.object({ instanceId: z.string(), status: WorkflowInstanceStatus, stateVersion: z.number().int() }).strict(),
    err: ["workflow_not_found", "state_version_conflict", "instance_terminal"] as const,
  },

  /** UC-WR-8：resume（面板「继续」；worker 接管同一用例）。lease 以 epoch CAS 获取（E2）。 */
  resumeInstance: {
    method: "POST",
    path: "/workflow-instances/:instanceId/resume",
    in: z
      .object({ instanceId: z.string().min(1), expectedStateVersion: ExpectedStateVersion, requestId: WorkflowRequestId })
      .strict(),
    out: z.object({ instanceId: z.string(), status: WorkflowInstanceStatus, stateVersion: z.number().int() }).strict(),
    err: ["workflow_not_found", "state_version_conflict", "instance_terminal", "lease_conflict"] as const,
  },

  /** UC-WR-9：从某阶段重试，产生新 attempt，旧 attempt 业务行保留（E9）。 */
  retryStage: {
    method: "POST",
    path: "/workflow-instances/:instanceId/stages/:stageId/retry",
    in: z
      .object({
        instanceId: z.string().min(1),
        stageId: WorkflowStageId,
        expectedStateVersion: ExpectedStateVersion,
        requestId: WorkflowRequestId,
      })
      .strict(),
    out: z
      .object({ instanceId: z.string(), stageId: WorkflowStageId, attempt: z.number().int().positive(), stateVersion: z.number().int() })
      .strict(),
    err: ["workflow_not_found", "state_version_conflict", "stage_not_retryable", "instance_terminal"] as const,
  },

  /** UC-WR-10：待我审批列表。 */
  listMyApprovals: {
    method: "GET",
    path: "/workflow-approvals",
    in: z.object({ includeDecided: z.boolean().default(false) }).strict(),
    out: z
      .object({
        items: z.array(
          z
            .object({
              instanceId: z.string(),
              workflowKey: WorkflowKey,
              definitionVersion: WorkflowDefinitionVersionNo,
              agentId: z.string(),
              initiatorUserId: z.string(),
              gate: WorkflowGateView,
            })
            .strict(),
        ),
      })
      .strict(),
    err: [] as const,
  },

  /** UC-WR-11：approve（WF05）。执行前仍由 effect-gateway 重查权限（domain I-13）。 */
  approveGate: {
    method: "POST",
    path: "/workflow-instances/:instanceId/gates/:gateId/approve",
    in: z
      .object({
        instanceId: z.string().min(1),
        gateId: z.string().min(1),
        expectedStateVersion: ExpectedStateVersion,
        requestId: WorkflowRequestId,
      })
      .strict(),
    out: z.object({ gate: WorkflowGateView, status: WorkflowInstanceStatus, stateVersion: z.number().int() }).strict(),
    err: [
      "workflow_not_found",
      "state_version_conflict",
      "gate_already_decided",
      "gate_not_open",
      "not_designated_approver",
      "self_approval_forbidden",
      "idempotency_key_reused",
    ] as const,
  },

  /** UC-WR-12：deny（必填理由；无 effect receipt；走 onDeny）。 */
  denyGate: {
    method: "POST",
    path: "/workflow-instances/:instanceId/gates/:gateId/deny",
    in: z
      .object({
        instanceId: z.string().min(1),
        gateId: z.string().min(1),
        expectedStateVersion: ExpectedStateVersion,
        requestId: WorkflowRequestId,
        reason: z.string().trim().min(1).max(2000),
      })
      .strict(),
    out: z.object({ gate: WorkflowGateView, status: WorkflowInstanceStatus, stateVersion: z.number().int() }).strict(),
    err: [
      "workflow_not_found",
      "state_version_conflict",
      "gate_already_decided",
      "gate_not_open",
      "not_designated_approver",
      "self_approval_forbidden",
      "deny_reason_required",
      "idempotency_key_reused",
    ] as const,
  },

  /** UC-WR-13：webhook 触发（WF06）。调用方只拿 {instanceId,status}（R5）。 */
  triggerWebhook: {
    method: "POST",
    path: "/workflow-triggers/:triggerId/webhook",
    in: z
      .object({
        triggerId: z.string().min(1),
        signature: z.string().min(1),
        timestamp: z.number().int().positive(),
        idempotencyKey: WorkflowRequestId,
        payload: z.record(z.string(), z.unknown()),
      })
      .strict(),
    out: z.object({ instanceId: z.string(), status: WorkflowInstanceStatus }).strict(),
    err: [
      "webhook_signature_invalid",
      "idempotency_key_reused",
      "workflow_not_found",
      "workflow_not_allowed",
      "skill_version_unresolved",
      "trigger_input_invalid",
    ] as const,
  },
} as const;
