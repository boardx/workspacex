/**
 * 契约束 `plan-permissions` —— 签核③（API 契约）落点。Phase 14 F06/F07/F08。
 *
 * 设计签核见 `phases/phase-14-agent-kernel-unification/contracts/plan-permissions/`
 * （`design-signoff.md` status: pending，待人类签核）。翻译自
 * `requirements/03-plan-mode-permissions.md` 的 R3/R4/R5/R6/R7，不发挥。
 *
 * ## 这是什么
 *
 * 计划确认（编辑 todo / 确认执行 / 取消）与工具风险分级授权（L0/L1/L2 三档 + 单次/
 * 本 run/以后三档授权粒度）的契约。`AgentKernelRunStatus`（`awaiting_plan_confirmation`/
 * `awaiting_tool_permission`）在 `streaming-transport.ts` 定义——本束**消费**该状态机，
 * 不重新定义（避免同一枚举两处声明）。
 */
import { z } from "zod";
import { AguiPlanTodo } from "./agui-state-events";

/* ── 一、工具风险分级（R5，固定白名单映射，本 phase 不支持组织自定义）──── */

export const ToolRiskLevel = z.enum(["L0", "L1", "L2"]);
export type ToolRiskLevel = z.infer<typeof ToolRiskLevel>;

/* ── 二、计划步骤（可编辑态，Plan Mode 卡片消费）──────────────────────── */

export const PlanStepDraft = z.object({
  planStepId: z.string(),
  /** 复用 AguiPlanTodo 的正文形状，附加计划编辑所需的 id/风险/依赖。 */
  todo: AguiPlanTodo,
  risk: ToolRiskLevel,
  /** 依赖的前置步骤 id；删除前置会让本步骤失去依赖（E2 校验对象）。 */
  dependsOnStepId: z.string().nullable(),
}).strict();
export type PlanStepDraft = z.infer<typeof PlanStepDraft>;

export const PlanConfirmationError = z.enum([
  "NOT_VISIBLE",
  "RUN_NOT_AWAITING_PLAN_CONFIRMATION",
  /** E2：删除必要前置步骤导致后续步骤失去依赖，内核识别并拒绝而非静默执行到中途失败。 */
  "PLAN_INVALID_AFTER_EDIT",
]);
export type PlanConfirmationError = z.infer<typeof PlanConfirmationError>;

export const GetPlanInput = z.object({ runId: z.string().min(1) }).strict();
export type GetPlanInput = z.infer<typeof GetPlanInput>;

export const GetPlanOutput = z.object({
  runId: z.string(),
  steps: z.array(PlanStepDraft),
}).strict();
export type GetPlanOutput = z.infer<typeof GetPlanOutput>;

export const EditPlanStepInput = z.object({
  runId: z.string().min(1),
  planStepId: z.string().min(1),
  /** 编辑正文；删除走 `deletePlanStep`，不是把 content 置空。 */
  content: z.string().refine((s) => s.trim() !== "", "content 不得为空白"),
}).strict();
export type EditPlanStepInput = z.infer<typeof EditPlanStepInput>;

export const DeleteKernelPlanStepInput = z.object({
  runId: z.string().min(1),
  planStepId: z.string().min(1),
}).strict();
export type DeleteKernelPlanStepInput = z.infer<typeof DeleteKernelPlanStepInput>;

export const ConfirmKernelPlanInput = z.object({
  runId: z.string().min(1),
  /** 直接确认 / 编辑后确认，均走本操作；编辑动作已通过上面两个操作先行落地。 */
  steps: z.array(PlanStepDraft),
}).strict();
export type ConfirmKernelPlanInput = z.infer<typeof ConfirmKernelPlanInput>;

/** R4 A1：取消，run 立即进入 `cancelled` 终态（streaming-transport 束定义）。 */
export const CancelPlanInput = z.object({ runId: z.string().min(1) }).strict();
export type CancelPlanInput = z.infer<typeof CancelPlanInput>;

/* ── 三、工具权限确认（R3 步骤 4-6，R5）───────────────────────────────── */

export const ToolPermissionRequest = z.object({
  runId: z.string(),
  toolCallId: z.string(),
  toolName: z.string(),
  risk: z.literal("L2"),
  /** agent 想做什么、为什么——不需要用户去猜。 */
  intent: z.string(),
  rationale: z.string(),
  /** 完整命令/入参内容，不是截断摘要（R6 后置条件）。 */
  command: z.string(),
}).strict();
export type ToolPermissionRequest = z.infer<typeof ToolPermissionRequest>;

/** 四选一：仅本次 / 本次 run 内都允许 / 以后都允许 / 拒绝。 */
export const ToolPermissionDecisionKind = z.enum(["once", "run", "forever", "deny"]);
export type ToolPermissionDecisionKind = z.infer<typeof ToolPermissionDecisionKind>;

export const DecideToolPermissionInput = z.object({
  runId: z.string().min(1),
  toolCallId: z.string().min(1),
  decision: ToolPermissionDecisionKind,
}).strict();
export type DecideToolPermissionInput = z.infer<typeof DecideToolPermissionInput>;

export const ToolPermissionDecisionError = z.enum([
  "NOT_VISIBLE",
  "RUN_NOT_AWAITING_TOOL_PERMISSION",
  /** 竞态：该工具调用已被裁决或 run 已终态。 */
  "TOOL_CALL_ALREADY_DECIDED",
]);
export type ToolPermissionDecisionError = z.infer<typeof ToolPermissionDecisionError>;

/**
 * 「以后都允许」的运行时持久化记录（R5：组织同类操作运行时持久化，无后台管理界面——
 * 本 phase 只做写入与生效判断，不含查看/撤销/批量管理，见 00-overview Out of Scope）。
 */
export const StandingToolGrant = z.object({
  orgId: z.string(),
  toolName: z.string(),
  grantedByUserId: z.string(),
  grantedAt: z.string(),
}).strict();
export type StandingToolGrant = z.infer<typeof StandingToolGrant>;

/* ── 四、操作 ──────────────────────────────────────────────────────────── */

export const operations = {
  getPlan: {
    method: "GET",
    path: "/agent-runs/:runId/plan",
    in: GetPlanInput,
    out: GetPlanOutput,
    err: ["NOT_VISIBLE"] as const,
  },
  editPlanStep: {
    method: "PATCH",
    path: "/agent-runs/:runId/plan/:planStepId",
    in: EditPlanStepInput,
    out: GetPlanOutput,
    err: ["NOT_VISIBLE", "RUN_NOT_AWAITING_PLAN_CONFIRMATION"] as const,
  },
  deletePlanStep: {
    method: "DELETE",
    path: "/agent-runs/:runId/plan/:planStepId",
    in: DeleteKernelPlanStepInput,
    out: GetPlanOutput,
    err: ["NOT_VISIBLE", "RUN_NOT_AWAITING_PLAN_CONFIRMATION", "PLAN_INVALID_AFTER_EDIT"] as const,
  },
  confirmPlan: {
    method: "POST",
    path: "/agent-runs/:runId/plan/confirm",
    in: ConfirmKernelPlanInput,
    out: z.object({ runId: z.string() }).strict(),
    err: ["NOT_VISIBLE", "RUN_NOT_AWAITING_PLAN_CONFIRMATION"] as const,
  },
  cancelPlan: {
    method: "POST",
    path: "/agent-runs/:runId/plan/cancel",
    in: CancelPlanInput,
    out: z.object({ runId: z.string() }).strict(),
    err: ["NOT_VISIBLE", "RUN_NOT_AWAITING_PLAN_CONFIRMATION"] as const,
  },
  decideToolPermission: {
    method: "POST",
    path: "/agent-runs/:runId/tool-calls/:toolCallId/decision",
    in: DecideToolPermissionInput,
    out: z.object({ runId: z.string(), toolCallId: z.string() }).strict(),
    err: ["NOT_VISIBLE", "RUN_NOT_AWAITING_TOOL_PERMISSION", "TOOL_CALL_ALREADY_DECIDED"] as const,
  },
};
