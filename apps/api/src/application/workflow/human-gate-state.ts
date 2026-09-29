/**
 * WF05 —— 人工门状态（requirements 02 R3 第 6/7 步；R4 A4/A5/E13；domain I-17）。纯函数，无 I/O。
 *
 * 门没有独立的表：它的全部事实都在事件日志里（I-10「先写事件」）——
 *   - `gate_opened`（data: gateId / attempt / effectPreview）：运行时 worker 走到带 humanGate 的阶段时写；
 *   - `gate_decided`（data: gateId / decision / decidedBy / reason / onDenyStageId）：approve / deny 写。
 * projection、审批命令、worker 都从同一份事件派生门状态，不存在第二份副本。库里另有唯一索引兜底
 * 「每个 gate 至多一个 decision」（迁移 wf05_workflow_human_gate）。
 */
import type { WorkflowDefinitionVersionView, WorkflowInstanceProjection } from "@repo/contracts/workflow-runtime";
import type { WorkflowActor } from "./workflow-ports";
import type { WorkflowStoredEvent } from "./workflow-runtime-ports";

export type WorkflowGateView = NonNullable<WorkflowInstanceProjection["openGate"]>;
export type GateEffectPreview = WorkflowGateView["effectPreview"];
type StageDefinition = WorkflowDefinitionVersionView["stages"][number];
export type HumanGateDefinition = NonNullable<StageDefinition["humanGate"]>;

export interface GateState {
  gateId: string;
  stageId: string;
  attempt: number;
  effectPreview: GateEffectPreview;
  openedAt: string;
  decision: "approved" | "denied" | null;
  decidedBy: string | null;
  decidedAt: string | null;
  reason: string | null;
  onDenyStageId: string | null;
}

/** gateId 由 (stageId, attempt) 确定：同一阶段同一次尝试只有一个门，崩溃重进不会开出第二个。 */
export function gateIdOf(stageId: string, attempt: number): string {
  return `${stageId}-gate-${attempt}`;
}

export function deriveGates(events: readonly WorkflowStoredEvent[]): Map<string, GateState> {
  const gates = new Map<string, GateState>();
  for (const e of events) {
    const gateId = typeof e.data.gateId === "string" ? e.data.gateId : null;
    if (!gateId || !e.stageId) continue;
    if (e.type === "gate_opened" && !gates.has(gateId)) {
      gates.set(gateId, {
        gateId,
        stageId: e.stageId,
        attempt: typeof e.data.attempt === "number" ? e.data.attempt : 1,
        effectPreview: e.data.effectPreview as GateEffectPreview,
        openedAt: e.createdAt,
        decision: null,
        decidedBy: null,
        decidedAt: null,
        reason: null,
        onDenyStageId: null,
      });
    } else if (e.type === "gate_decided") {
      const g = gates.get(gateId);
      if (!g || g.decision) continue; // I-17：只认第一个决定
      g.decision = e.data.decision === "denied" ? "denied" : "approved";
      g.decidedBy = typeof e.data.decidedBy === "string" ? e.data.decidedBy : null;
      g.decidedAt = e.createdAt;
      g.reason = typeof e.data.reason === "string" ? e.data.reason : null;
      g.onDenyStageId = typeof e.data.onDenyStageId === "string" ? e.data.onDenyStageId : null;
    }
  }
  return gates;
}

export function humanGateOf(definition: WorkflowDefinitionVersionView, stageId: string): HumanGateDefinition | null {
  return definition.stages.find((s) => s.stageId === stageId)?.humanGate ?? null;
}

/**
 * 实例级伪角色：`approverRoles` 含它时，本实例的发起人是指定审批人（内容线 Workflow 的 G 门默认
 * 「批准人 = 发起人」，如 W029 §5 阶段 13 `prdOwnerUserId ?? initiatorUserId`；CT05/CT06）。
 * 仍受 `allowSelfApproval` 约束。
 */
export const WORKFLOW_INITIATOR_APPROVER_ROLE = "workflow_initiator";

/** 按组织角色、具体成员或发起人伪角色被指定（R3-7「校验审批人资格」）。 */
export function isDesignatedApprover(gate: HumanGateDefinition, actor: WorkflowActor, initiatorUserId?: string): boolean {
  if (gate.approverUserIds.includes(actor.userId) || gate.approverRoles.includes(actor.orgRole)) return true;
  return initiatorUserId !== undefined && actor.userId === initiatorUserId && gate.approverRoles.includes(WORKFLOW_INITIATOR_APPROVER_ROLE);
}

export type GateEligibility = { ok: true } | { ok: false; code: "not_designated_approver" | "self_approval_forbidden" };

/** E13：非指定 → 403 not_designated_approver；发起人默认不能自批 → 403 self_approval_forbidden。 */
export function gateEligibility(gate: HumanGateDefinition, actor: WorkflowActor, initiatorUserId: string): GateEligibility {
  if (!isDesignatedApprover(gate, actor, initiatorUserId)) return { ok: false, code: "not_designated_approver" };
  if (actor.userId === initiatorUserId && !gate.allowSelfApproval) return { ok: false, code: "self_approval_forbidden" };
  return { ok: true };
}

/** 该用户是否是本实例任一已开门的指定审批人（Q1：审批人对实例有只读可见性）。 */
export function isApproverOfAnyGate(
  definition: WorkflowDefinitionVersionView,
  events: readonly WorkflowStoredEvent[],
  actor: WorkflowActor,
): boolean {
  for (const g of deriveGates(events).values()) {
    const def = humanGateOf(definition, g.stageId);
    if (def && isDesignatedApprover(def, actor)) return true;
  }
  return false;
}

export function gateView(
  g: GateState,
  definition: WorkflowDefinitionVersionView,
  viewer: WorkflowActor,
  instance: { initiatorUserId: string; status: string },
): WorkflowGateView {
  const def = humanGateOf(definition, g.stageId);
  const eligible = def ? gateEligibility(def, viewer, instance.initiatorUserId).ok : false;
  return {
    gateId: g.gateId,
    stageId: g.stageId,
    effectPreview: { ...g.effectPreview, payloadPreview: { ...g.effectPreview.payloadPreview } },
    decision: g.decision,
    decidedBy: g.decidedBy,
    decidedAt: g.decidedAt,
    reason: g.reason,
    viewerCanDecide: eligible && g.decision === null && instance.status === "awaiting_gate_decision",
  };
}

/**
 * gate_opened 的默认副作用预览（阶段未提供自定义预览时）：只含定义元数据，不含任何运行期参数，
 * 天然不会带出密钥/凭证（I-15）。
 */
export function defaultGatePreview(stage: StageDefinition): GateEffectPreview {
  const capabilityCategory = stage.capabilityCategories[0] ?? "workflow.gate";
  return {
    capabilityCategory,
    targetSystem: capabilityCategory.split(".")[0]!,
    summary: stage.title,
    payloadPreview: { stageId: stage.stageId, sideEffect: stage.sideEffect },
  };
}

/**
 * A4：拒绝后要跳过的阶段集合。onDenyStageId 指向门所在阶段**之后**的阶段时，门阶段（含）到目标（不含）
 * 之间的阶段全部 skipped；指向之前的阶段（回退）需要新 attempt，属于「从阶段重试」（WF08），
 * 本迭代的 deny 对它按 null 处理——实例 rejected（见 gate-commands.ts denyTarget）。
 */
export function skippedByDenial(definition: WorkflowDefinitionVersionView, gates: Iterable<GateState>): Set<string> {
  const order = definition.stages.map((s) => s.stageId);
  const skipped = new Set<string>();
  for (const g of gates) {
    if (g.decision !== "denied" || !g.onDenyStageId) continue;
    const from = order.indexOf(g.stageId);
    const to = order.indexOf(g.onDenyStageId);
    if (from < 0 || to <= from) continue;
    for (let i = from; i < to; i++) skipped.add(order[i]!);
  }
  return skipped;
}

/** deny 的去向：前向 onDenyStageId → 继续 running；null 或回退 → 实例 rejected。 */
export function forwardDenyTarget(definition: WorkflowDefinitionVersionView, stageId: string): string | null {
  const target = humanGateOf(definition, stageId)?.onDenyStageId ?? null;
  if (!target) return null;
  const order = definition.stages.map((s) => s.stageId);
  return order.indexOf(target) > order.indexOf(stageId) ? target : null;
}
