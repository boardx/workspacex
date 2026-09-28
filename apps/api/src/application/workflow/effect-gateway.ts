/**
 * WF04 —— effect-gateway：外部副作用统一执行入口（requirements 02 R3 第 5 步；R4 E1/E2/E4；
 * ADR-118 第 6 条；domain I-13/I-14；UC-WR-I2/I3）。
 *
 * 顺序纪律（R3-5）：assertLease → 重查权限 → receipt.begin → 调用工具 → receipt.finalize（带
 * provenance）。任一步失败都不得调用工具：
 *   - lease 已丢失 → `WorkflowLeaseLostError`（E2），连权限重查都不做。
 *   - 权限重查失败 → 阶段 `blocked_permission` 带 `reasonCode`（E4），不 begin receipt、不调用工具。
 *   - receipt 已是 `replay`/`in_flight` → 直接返回首次响应 / 抛错，永不二次调用工具（I-14）。
 *
 * 已知限制（与 pg-workflow-lease-store.ts 头注一致的纪律）：`assertLease` 是 check-then-act，
 * 不是数据库级 fencing token；本文件在 begin 前后各断言一次以缩小窗口，与 run-instance.ts 的
 * `holdLease()` 用法同一立场，不假装完全消除竞态。
 */
import type { WorkflowReasonCode } from "@repo/contracts/workflow-runtime";
import { WorkflowSideEffectClass as WorkflowSideEffectClassSchema } from "@repo/contracts/workflow-runtime";
import type { z } from "zod";
import type { WorkflowLease, WorkflowLeaseStore, WorkflowReceiptKey, WorkflowReceiptScope, WorkflowReceiptStore } from "./workflow-ports";
import type { WorkflowEventStore } from "./workflow-runtime-ports";

export type WorkflowSideEffectClass = z.infer<typeof WorkflowSideEffectClassSchema>;

/** I-13 权限重查唯一能落到的四个阻断原因（E4）；顺序即重查顺序。 */
export type EffectBlockedReasonCode = Extract<
  WorkflowReasonCode,
  "initiator_not_member" | "agent_permission_revoked" | "tool_authorization_revoked" | "capability_exceeds_side_effect_cap"
>;

export interface EffectPermissionInput {
  orgId: string;
  instanceId: string;
  stageId: string;
  workflowKey: string;
  initiatorUserId: string;
  agentId: string;
  agentVersionId: string;
  capabilityCategory: string;
  sideEffect: WorkflowSideEffectClass;
}

export type EffectPermissionResult = { ok: true } | { ok: false; reasonCode: EffectBlockedReasonCode };

/** 执行前权限重查端口（发起人 ∩ Agent 权限 ∩ ToolExecutionAuthority ∩ MCP sideEffect 封顶，I-13）。 */
export interface EffectPermissionRecheckPort {
  recheck(input: EffectPermissionInput): Promise<EffectPermissionResult>;
}

/** 崩溃恢复只读对账端口（按能力分类注册；没有实现的分类视为不可对账 → unresolved，E1）。 */
export interface EffectReconcilePort {
  /** true=确认已生效可信为已完成、false=确认未生效、null=查不到结论——三者都不重放调用。 */
  reconcile(input: {
    orgId: string;
    instanceId: string;
    stageId: string;
    effectKey: string;
    capabilityCategory: string;
  }): Promise<boolean | null>;
}

export class EffectPermissionBlockedError extends Error {
  readonly reasonCode: EffectBlockedReasonCode;
  constructor(reasonCode: EffectBlockedReasonCode, readonly instanceId: string, readonly stageId: string, readonly effectKey: string) {
    super(`workflow effect ${instanceId}/${stageId}/${effectKey} blocked: ${reasonCode}`);
    this.name = "EffectPermissionBlockedError";
    this.reasonCode = reasonCode;
  }
}

/** begin 命中 `in_flight`（已 begin 未 finalize）：不得二次调用工具；恢复路径应改走 `reconcile`（E1）。 */
export class EffectInFlightError extends Error {
  constructor(readonly instanceId: string, readonly stageId: string, readonly effectKey: string) {
    super(`workflow effect ${instanceId}/${stageId}/${effectKey} is begun but not finalized; call reconcile(), do not retry`);
    this.name = "EffectInFlightError";
  }
}

export interface ExecuteEffectCommand {
  orgId: string;
  instanceId: string;
  stageId: string;
  workflowKey: string;
  effectKey: string;
  capabilityCategory: string;
  sideEffect: WorkflowSideEffectClass;
  initiatorUserId: string;
  agentId: string;
  agentVersionId: string;
  /** 请求载荷指纹：同 effectKey 不同参数 → idempotency_key_reused（复用 WorkflowReceiptStore 语义）。 */
  fingerprint: string;
  args: Record<string, unknown>;
  /** 触发这次副作用的审批决定（人工门经过时才有），写入 provenance。 */
  approvalRequestId?: string | null;
}

export interface EffectProvenance {
  initiatorUserId: string;
  agentId: string;
  agentVersionId: string;
  approvalRequestId: string | null;
}

export type EffectWork = (args: Record<string, unknown>) => Promise<Record<string, unknown>>;

export type ExecuteEffectOutcome =
  | { kind: "executed"; result: Record<string, unknown>; provenance: EffectProvenance }
  | { kind: "replayed"; result: Record<string, unknown>; provenance: EffectProvenance };

export type ReconcileOutcome = "reconciled" | "unresolved" | "not_begun" | "already_resolved";

export interface EffectGatewayDeps {
  leases: WorkflowLeaseStore;
  receipts: WorkflowReceiptStore;
  permission: EffectPermissionRecheckPort;
  events: WorkflowEventStore;
  reconcile?: EffectReconcilePort;
}

function requestKeyOf(cmd: Pick<ExecuteEffectCommand, "instanceId" | "stageId" | "effectKey">): string {
  return `${cmd.instanceId}/${cmd.stageId}/${cmd.effectKey}`;
}

function provenanceOf(cmd: Pick<ExecuteEffectCommand, "initiatorUserId" | "agentId" | "agentVersionId" | "approvalRequestId">): EffectProvenance {
  return {
    initiatorUserId: cmd.initiatorUserId,
    agentId: cmd.agentId,
    agentVersionId: cmd.agentVersionId,
    approvalRequestId: cmd.approvalRequestId ?? null,
  };
}

function isProvenance(v: unknown): v is EffectProvenance {
  return typeof v === "object" && v !== null && "initiatorUserId" in v;
}

export class EffectGateway {
  constructor(private readonly deps: EffectGatewayDeps) {}

  /**
   * UC-WR-I2。`lease` 必须是调用方当前持有的那份（epoch 是它的身份）；`work` 只在真正需要执行
   * （非 replay）时才被调用，且全程至多调用一次（I-14 由 begin 的 begun/replay/in_flight 三态保证）。
   */
  async execute(lease: WorkflowLease, cmd: ExecuteEffectCommand, work: EffectWork): Promise<ExecuteEffectOutcome> {
    await this.deps.leases.assertLease(lease); // E2：任何副作用前先断言，失败不产生任何写
    const permission = await this.deps.permission.recheck({
      orgId: cmd.orgId,
      instanceId: cmd.instanceId,
      stageId: cmd.stageId,
      workflowKey: cmd.workflowKey,
      initiatorUserId: cmd.initiatorUserId,
      agentId: cmd.agentId,
      agentVersionId: cmd.agentVersionId,
      capabilityCategory: cmd.capabilityCategory,
      sideEffect: cmd.sideEffect,
    });
    if (!permission.ok) {
      await this.blockStage(cmd, permission.reasonCode);
      throw new EffectPermissionBlockedError(permission.reasonCode, cmd.instanceId, cmd.stageId, cmd.effectKey);
    }

    const key: WorkflowReceiptKey = { orgId: cmd.orgId, scope: "effect", requestKey: requestKeyOf(cmd), fingerprint: cmd.fingerprint };
    const begin = await this.deps.receipts.begin(key);
    if (begin.kind === "replay") {
      const provenance = isProvenance((begin.stableResponse as { provenance?: unknown } | null)?.provenance)
        ? ((begin.stableResponse as { provenance: EffectProvenance }).provenance)
        : provenanceOf(cmd);
      const result = ((begin.stableResponse as { result?: Record<string, unknown> } | null)?.result) ?? {};
      return { kind: "replayed", result, provenance };
    }
    if (begin.kind === "in_flight") {
      // 崩溃/并发恢复路径命中未 finalize 的 begin：绝不重放调用（E1/I-14）；调用方应改走 reconcile()。
      throw new EffectInFlightError(cmd.instanceId, cmd.stageId, cmd.effectKey);
    }

    await this.deps.leases.assertLease(lease); // 调用工具、写 receipt 前再断言一次，缩小 check-then-act 窗口
    await this.deps.events.append(cmd.orgId, cmd.instanceId, {
      type: "effect_begun",
      stageId: cmd.stageId,
      reasonCode: null,
      data: { effectKey: cmd.effectKey, capabilityCategory: cmd.capabilityCategory },
    });

    const result = await work(cmd.args);
    const provenance = provenanceOf(cmd);
    await this.deps.receipts.finalize(key, { stableResponse: { result, provenance }, checkpointId: null, instanceId: cmd.instanceId });
    await this.deps.events.append(cmd.orgId, cmd.instanceId, {
      type: "effect_finalized",
      stageId: cmd.stageId,
      reasonCode: null,
      data: { effectKey: cmd.effectKey, capabilityCategory: cmd.capabilityCategory },
    });
    return { kind: "executed", result, provenance };
  }

  /**
   * UC-WR-I3。恢复路径对崩溃时刻停在 `begun` 的 effect receipt 做只读对账，不重新调用工具。
   * `reconciler` 缺省时用构造时传入的 `deps.reconcile`；两者都没有 → 视为「无法对账」→ unresolved。
   */
  async reconcile(
    cmd: { orgId: string; instanceId: string; stageId: string; effectKey: string; capabilityCategory: string },
    reconciler?: EffectReconcilePort,
  ): Promise<ReconcileOutcome> {
    const requestKey = requestKeyOf(cmd);
    const row = await this.deps.receipts.find(cmd.orgId, "effect" satisfies WorkflowReceiptScope, requestKey);
    if (!row) return "not_begun";
    if (row.status !== "begun") return "already_resolved";

    const impl = reconciler ?? this.deps.reconcile;
    const confirmed = impl
      ? await impl.reconcile({
          orgId: cmd.orgId,
          instanceId: cmd.instanceId,
          stageId: cmd.stageId,
          effectKey: cmd.effectKey,
          capabilityCategory: cmd.capabilityCategory,
        })
      : null;
    const outcome: "reconciled" | "unresolved" = confirmed === true ? "reconciled" : "unresolved";
    await this.deps.receipts.resolveBegun(cmd.orgId, "effect", requestKey, outcome);

    if (outcome === "reconciled") {
      await this.deps.events.append(cmd.orgId, cmd.instanceId, {
        type: "effect_finalized",
        stageId: cmd.stageId,
        reasonCode: null,
        data: { effectKey: cmd.effectKey, capabilityCategory: cmd.capabilityCategory, reconciled: true },
      });
    } else {
      await this.deps.events.append(
        cmd.orgId,
        cmd.instanceId,
        {
          type: "effect_blocked",
          stageId: cmd.stageId,
          reasonCode: "effect_unreconciled",
          data: { effectKey: cmd.effectKey, capabilityCategory: cmd.capabilityCategory },
        },
        { status: "needs_attention", reasonCode: "effect_unreconciled" },
      );
    }
    return outcome;
  }

  private async blockStage(cmd: Pick<ExecuteEffectCommand, "orgId" | "instanceId" | "stageId" | "effectKey" | "capabilityCategory">, reasonCode: EffectBlockedReasonCode): Promise<void> {
    await this.deps.events.append(
      cmd.orgId,
      cmd.instanceId,
      {
        type: "effect_blocked",
        stageId: cmd.stageId,
        reasonCode,
        data: { effectKey: cmd.effectKey, capabilityCategory: cmd.capabilityCategory },
      },
      { status: "blocked_permission", reasonCode },
    );
  }
}

/** ADR-118 沿用的 MCP `sideEffect` 封顶顺序：none < read < write < external_send。 */
const SIDE_EFFECT_ORDER: readonly WorkflowSideEffectClass[] = ["none", "read", "write", "external_send"];

function sideEffectRank(value: WorkflowSideEffectClass): number {
  return SIDE_EFFECT_ORDER.indexOf(value);
}

export function withinSideEffectCap(requested: WorkflowSideEffectClass, cap: WorkflowSideEffectClass): boolean {
  return sideEffectRank(requested) <= sideEffectRank(cap);
}
