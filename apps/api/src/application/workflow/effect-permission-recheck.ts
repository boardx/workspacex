/**
 * WF04 —— `EffectPermissionRecheckPort` 的默认组合实现（domain I-13 四步顺序重查）。
 *
 * 四步里前两步直接复用 WF03 已有的 `WorkflowAccessPort`（同一张 org_memberships / agent_versions
 * 判据，避免「同一事实两处声明」）：
 *   1. 发起人仍是本组织成员 —— 否则 `initiator_not_member`。
 *   2. Agent 版本仍可运行本 Workflow —— 否则 `agent_permission_revoked`（覆盖 E4「Agent 工具策略
 *      不再允许」与 E6「被移出 workflowAllowlist」两种说法，判据相同）。
 * 后两步是 WF04 新增的 `EffectCapabilityAuthorityPort`（PG 实现见
 * infrastructure/workflow/pg-effect-capability-authority.ts）：
 *   3. 该能力分类未被撤销授权 —— 否则 `tool_authorization_revoked`。
 *   4. 阶段声明的 sideEffect 未超过该能力分类的封顶等级 —— 否则 `capability_exceeds_side_effect_cap`。
 */
import { withinSideEffectCap, type EffectPermissionInput, type EffectPermissionRecheckPort, type EffectPermissionResult, type WorkflowSideEffectClass } from "./effect-gateway";
import type { WorkflowAccessPort } from "./workflow-runtime-ports";

export interface CapabilityAuthorityCheck {
  authorized: boolean;
  sideEffectCap: WorkflowSideEffectClass;
}

/** MCP `sideEffect` 封顶与工具授权撤销的读端口（ToolExecutionAuthority 概念在 workflow 侧的落点）。 */
export interface EffectCapabilityAuthorityPort {
  /** 找不到该分类的配置行 = 未收紧，默认放行（`{authorized:true, sideEffectCap:"external_send"}`）。 */
  checkCapability(orgId: string, capabilityCategory: string): Promise<CapabilityAuthorityCheck>;
}

export class ComposedEffectPermissionRecheck implements EffectPermissionRecheckPort {
  constructor(private readonly access: WorkflowAccessPort, private readonly capability: EffectCapabilityAuthorityPort) {}

  async recheck(input: EffectPermissionInput): Promise<EffectPermissionResult> {
    const role = await this.access.orgRoleOf(input.orgId, input.initiatorUserId);
    if (!role) return { ok: false, reasonCode: "initiator_not_member" };

    const runnable = await this.access.runnableAgentVersion(input.orgId, input.initiatorUserId, input.agentId, input.workflowKey);
    if (!runnable) return { ok: false, reasonCode: "agent_permission_revoked" };

    const cap = await this.capability.checkCapability(input.orgId, input.capabilityCategory);
    if (!cap.authorized) return { ok: false, reasonCode: "tool_authorization_revoked" };
    if (!withinSideEffectCap(input.sideEffect, cap.sideEffectCap)) return { ok: false, reasonCode: "capability_exceeds_side_effect_cap" };

    return { ok: true };
  }
}
