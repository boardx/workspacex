import type { Locale } from "@/lib/i18n/locale";
import { translate, type MessageKey } from "@/lib/i18n/messages";
/**
 * WF08 —— 运行面板文案。key 集合与契约枚举同一件事：新增枚举值时 TS 报「缺 key」。
 */
import type { WorkflowSseEnvelope, WorkflowErrorCode, WorkflowInstanceStatus, WorkflowReasonCode, WorkflowStageView } from "@/lib/workflow-runtime-api";

const INSTANCE_STATUS_KEYS: Record<WorkflowInstanceStatus, MessageKey> = {
  running: "workflows.status.running",
  awaiting_gate_decision: "workflows.status.awaiting_gate_decision",
  blocked_permission: "workflows.status.blocked_permission",
  cancelling: "workflows.status.cancelling",
  succeeded: "workflows.status.succeeded",
  failed: "workflows.status.failed",
  cancelled: "workflows.status.cancelled",
  rejected: "workflows.status.rejected",
  needs_attention: "workflows.status.needs_attention",
};
export const INSTANCE_STATUS_TEXT = defaultText(INSTANCE_STATUS_KEYS);

const STAGE_STATUS_KEYS: Record<WorkflowStageView["status"], MessageKey> = {
  pending: "workflows.status.pending",
  running: "workflows.status.running",
  awaiting_gate_decision: "workflows.status.awaiting_gate_decision",
  blocked_permission: "workflows.status.blocked_permission",
  succeeded: "workflows.status.succeeded",
  failed: "workflows.status.failed",
  skipped: "workflows.status.skipped",
  rejected: "workflows.status.rejected",
};
export const STAGE_STATUS_TEXT = defaultText(STAGE_STATUS_KEYS);

const REASON_KEYS: Record<WorkflowReasonCode, MessageKey> = {
  initiator_not_member: "workflows.reason.initiator_not_member",
  agent_permission_revoked: "workflows.reason.agent_permission_revoked",
  tool_authorization_revoked: "workflows.reason.tool_authorization_revoked",
  capability_exceeds_side_effect_cap: "workflows.reason.capability_exceeds_side_effect_cap",
  effect_unreconciled: "workflows.reason.effect_unreconciled",
  checkpoint_missing: "workflows.reason.checkpoint_missing",
  stage_attempts_exhausted: "workflows.reason.stage_attempts_exhausted",
  workflow_lease_lost: "workflows.reason.workflow_lease_lost",
  cancel_requested: "workflows.reason.cancel_requested",
  gate_denied: "workflows.reason.gate_denied",
};
export const REASON_TEXT = defaultText(REASON_KEYS);

const ERROR_KEYS: Record<WorkflowErrorCode, MessageKey> = {
  workflow_not_found: "workflows.error.workflow_not_found",
  workflow_version_not_published: "workflows.error.workflow_version_not_published",
  workflow_not_allowed: "workflows.error.workflow_not_allowed",
  skill_version_unresolved: "workflows.error.skill_version_unresolved",
  trigger_input_invalid: "workflows.error.trigger_input_invalid",
  definition_invalid: "workflows.error.definition_invalid",
  state_version_conflict: "workflows.error.state_version_conflict",
  instance_terminal: "workflows.error.instance_terminal",
  gate_already_decided: "workflows.error.gate_already_decided",
  gate_not_open: "workflows.error.gate_not_open",
  not_designated_approver: "workflows.error.not_designated_approver",
  self_approval_forbidden: "workflows.error.self_approval_forbidden",
  deny_reason_required: "workflows.error.deny_reason_required",
  idempotency_key_reused: "workflows.error.idempotency_key_reused",
  webhook_signature_invalid: "workflows.error.webhook_signature_invalid",
  lease_conflict: "workflows.error.lease_conflict",
  stage_not_retryable: "workflows.error.stage_not_retryable",
};
export const ERROR_TEXT = defaultText(ERROR_KEYS);

export function describeWorkflowError(code: WorkflowErrorCode | null, locale: Locale = "zh-CN"): string {
  return translate(locale, code !== null && Object.hasOwn(ERROR_KEYS, code) ? ERROR_KEYS[code] : "workflows.error.generic");
}

/** E9：阶段失败分类（运行时写进 stage_failed 事件 data.failureKind）→ 用户可读说明。未知分类不展示。 */
const STAGE_FAILURE_KIND_KEYS: Record<string, MessageKey> = {
  provider_not_configured: "workflows.stageFailure.provider_not_configured",
  model_call_failed: "workflows.stageFailure.model_call_failed",
  skill_output_invalid: "workflows.stageFailure.skill_output_invalid",
  unknown: "workflows.stageFailure.unknown",
};
export const STAGE_FAILURE_KIND_TEXT = defaultText(STAGE_FAILURE_KIND_KEYS);

export function stageFailureKindText(kind: unknown, locale: Locale = "zh-CN"): string | null {
  return typeof kind === "string" && Object.hasOwn(STAGE_FAILURE_KIND_KEYS, kind) ? translate(locale, STAGE_FAILURE_KIND_KEYS[kind]!) : null;
}

type WorkflowSseEventType = Extract<WorkflowSseEnvelope, { type: "delta" }>["payload"]["event"];

/** 运行日志事件名 → 人话（日志区不上屏内部事件名）。 */
const EVENT_KEYS: Record<WorkflowSseEventType, MessageKey> = {
  instance_started: "workflows.event.instance_started",
  stage_started: "workflows.event.stage_started",
  stage_output_written: "workflows.event.stage_output_written",
  stage_succeeded: "workflows.event.stage_succeeded",
  stage_failed: "workflows.event.stage_failed",
  stage_retried: "workflows.event.stage_retried",
  gate_opened: "workflows.event.gate_opened",
  gate_decided: "workflows.event.gate_decided",
  effect_begun: "workflows.event.effect_begun",
  effect_finalized: "workflows.event.effect_finalized",
  effect_blocked: "workflows.event.effect_blocked",
  status_changed: "workflows.event.status_changed",
  cancel_requested: "workflows.event.cancel_requested",
};
export const EVENT_TEXT = defaultText(EVENT_KEYS);

function defaultText<K extends string>(keys: Record<K, MessageKey>): Record<K, string> {
  const text = {} as Record<K, string>;
  for (const key of Object.keys(keys) as K[]) text[key] = translate("zh-CN", keys[key]);
  return text;
}
export function workflowInstanceStatusText(status: WorkflowInstanceStatus, locale: Locale = "zh-CN"): string {
  return translate(locale, INSTANCE_STATUS_KEYS[status]);
}
