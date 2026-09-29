/**
 * WF08 —— 运行面板文案。key 集合与契约枚举同一件事：新增枚举值时 TS 报「缺 key」。
 */
import type { WorkflowErrorCode, WorkflowInstanceStatus, WorkflowReasonCode, WorkflowStageView } from "@/lib/workflow-runtime-api";

export const INSTANCE_STATUS_TEXT: Record<WorkflowInstanceStatus, string> = {
  running: "运行中",
  awaiting_gate_decision: "等待审批",
  blocked_permission: "权限阻断",
  cancelling: "取消中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
  rejected: "被拒",
  needs_attention: "需人工处理",
};

export const STAGE_STATUS_TEXT: Record<WorkflowStageView["status"], string> = {
  pending: "未开始",
  running: "运行中",
  awaiting_gate_decision: "等待审批",
  blocked_permission: "权限阻断",
  succeeded: "已完成",
  failed: "失败",
  skipped: "已跳过",
  rejected: "被拒",
};

export const REASON_TEXT: Record<WorkflowReasonCode, string> = {
  initiator_not_member: "发起人已不在组织内",
  agent_permission_revoked: "Agent 工具策略不再允许该操作",
  tool_authorization_revoked: "工具授权已被撤销",
  capability_exceeds_side_effect_cap: "该能力超出了副作用上限",
  effect_unreconciled: "有一个副作用无法确认是否已执行，需人工核对",
  checkpoint_missing: "运行检查点丢失，需人工处理",
  stage_attempts_exhausted: "该阶段重试次数已用尽",
  workflow_lease_lost: "运行租约已失效",
  cancel_requested: "已请求取消",
  gate_denied: "审批被拒绝",
};

export const ERROR_TEXT: Record<WorkflowErrorCode, string> = {
  workflow_not_found: "运行不存在或你无权查看",
  workflow_version_not_published: "该 Workflow 版本未发布或已下线",
  workflow_not_allowed: "你没有运行该 Workflow 的权限",
  skill_version_unresolved: "所需 Skill 版本无法解析",
  trigger_input_invalid: "输入不符合要求",
  definition_invalid: "Workflow 定义无效",
  state_version_conflict: "状态已被他人更新，已刷新为最新",
  instance_terminal: "运行已结束，无法再操作",
  gate_already_decided: "该审批已被他人决定",
  gate_not_open: "当前没有待决的审批",
  not_designated_approver: "你不是指定审批人",
  self_approval_forbidden: "不允许发起人自行审批",
  deny_reason_required: "拒绝时必须填写理由",
  idempotency_key_reused: "重复提交，请刷新后重试",
  webhook_signature_invalid: "签名无效",
  lease_conflict: "运行正被其他进程处理，请稍后再试",
  stage_not_retryable: "该阶段当前不可重试",
};

export function describeWorkflowError(code: WorkflowErrorCode | null): string {
  return code === null ? "操作失败，请稍后重试" : ERROR_TEXT[code];
}
