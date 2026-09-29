/**
 * WF04 —— effect-gateway：外部副作用统一执行入口（requirements 02 R3 第 5、10 步；R4 E1/E2/E4/
 * 取消；ADR-118 第 6 条；domain I-13/I-14；UC-WR-I2/I3）。
 *
 * 顺序纪律（R3-5，2026-09-28 修订）：assertLease → 重查权限 → 取消检查 → receipt.begin →
 * assertLease 复断言 → 取消检查（窄窗口复检）→ 调用工具 → receipt.finalize（带 provenance）。
 * 任一步失败都不得调用工具——UC-WR-I2 表里 `execute()` 的三种阻断结果都在这里：
 *   - lease 已丢失 → `WorkflowLeaseLostError`（E2），连权限重查都不做。
 *   - 权限重查失败 → 阶段 `blocked_permission` 带 `reasonCode`（E4），不 begin receipt、不调用工具。
 *   - 实例已 `cancelling`/已终态 → `EffectCancelledError`（R3-10）：`cancelling` 就地落成 `cancelled`；
 *     receipt 已是 `replay`/`in_flight` → 直接返回首次响应 / 抛错，永不二次调用工具（I-14）。
 *
 * 取消检查为什么挪到 begin 之前（原设计的教训，见 review #1/#3）：`cancelling`/已终态是「取消期间
 * 副作用被拦下」这条路径里最常见的命中——不是崩溃，是正常的 R3-10 场景。若先 begin 再检查取消，
 * 每一次这种正常取消都会新开一条 `begun` receipt，随后 `EffectCancelledError` 直接把它撇下：没有
 * 任何后续代码路径把这条 receipt 迁到 `reconciled`/`unresolved`（I-14 只认这两个终态），它就永久
 * 停在 `begun`，此后同一 `effectKey` 的任何调用都会撞 `EffectInFlightError`。把检查挪到 begin 之前
 * 从根上消掉这一类孤儿 receipt；begin 之后、调用工具之前仍留一次窄窗口复检（lease 之外唯一还可能
 * 让取消挤进来的间隙），命中时该 receipt 已经 begin 过，用 `resolveBegun(..., "unresolved")` 显式
 * 收尾，不让它停留在非终态。
 *
 * 已知限制（与 pg-workflow-lease-store.ts 头注一致的纪律）：`assertLease` 与取消检查都是
 * check-then-act，不是数据库级 fencing token；本文件在 begin 前后各断言一次、调用工具前再读一次
 * 实例状态以缩小窗口，与 run-instance.ts 的 `holdLease()`/`checkpointBoundary()` 用法同一立场，
 * 不假装完全消除竞态——run-instance.ts 的 `checkpointBoundary()` 只在阶段边界处拦截取消，本文件
 * 补的是同一阶段内、边界之间即将调用副作用前的那一次。
 */
import type { WorkflowReasonCode } from "@repo/contracts/workflow-runtime";
import { WorkflowSideEffectClass as WorkflowSideEffectClassSchema } from "@repo/contracts/workflow-runtime";
import type { z } from "zod";
import { isTerminal } from "./instance-projection";
import type { WorkflowLease, WorkflowLeaseStore, WorkflowReceiptKey, WorkflowReceiptRow, WorkflowReceiptScope, WorkflowReceiptStore } from "./workflow-ports";
import type { WorkflowInstanceRepository } from "./workflow-ports";
import type { WorkflowAppendResult, WorkflowEventStore } from "./workflow-runtime-ports";

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
  constructor(
    readonly instanceId: string,
    readonly stageId: string,
    readonly effectKey: string,
    /** 对账要按能力分类分派到正确的 `EffectReconcilePort` 实现，生产恢复路径靠这个字段就地重查。 */
    readonly capabilityCategory: string,
  ) {
    super(`workflow effect ${instanceId}/${stageId}/${effectKey} is begun but not finalized; call reconcile(), do not retry`);
    this.name = "EffectInFlightError";
  }
}

/**
 * UC-WR-I2 第三种阻断结果（R3-10；R4 E-list「取消」）：实例已 `cancelling`/已终态时，下一个副作用
 * 被本网关拦下，不调用 `work()`。`cancelling` 命中时本次调用顺带把实例落成 `cancelled`（与
 * run-instance.ts 的 `checkpointBoundary` 同一落点，但这里覆盖的是阶段内、边界之间才发生的取消）。
 */
export class EffectCancelledError extends Error {
  constructor(readonly instanceId: string, readonly stageId: string, readonly effectKey: string) {
    super(`workflow effect ${instanceId}/${stageId}/${effectKey} blocked: cancel_requested`);
    this.name = "EffectCancelledError";
  }
}

/** append 因 `instance_terminal`/`state_version_conflict` 落空：调用方必须视为「未发生」，不得继续。 */
export class EffectInstanceUnavailableError extends Error {
  constructor(readonly instanceId: string, readonly conflict: Extract<WorkflowAppendResult, { ok: false }>["conflict"]) {
    super(`workflow instance ${instanceId} rejected effect-gateway event append: ${conflict}`);
    this.name = "EffectInstanceUnavailableError";
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
  /** R3-10 的取消检查读这里的 `status`；同一份 WF01 仓储，与 WorkflowRuntimeService 共用一个实例即可。 */
  instances: WorkflowInstanceRepository;
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

type EventAppendOpts = Parameters<WorkflowEventStore["append"]>[3];
type EffectStageCmd = Pick<ExecuteEffectCommand, "orgId" | "instanceId" | "stageId" | "effectKey" | "capabilityCategory">;

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

    // R3-10：取消检查在 begin 之前做（见文件头注 2026-09-28 修订）——`cancelling`/已终态是这里最常见
    // 命中的正常路径，不是崩溃；先检查再 begin，就不会为一次正常取消新开一条永远等不到 finalize 的
    // `begun` receipt（I-14 孤儿态，review #1）。
    await this.assertNotCancelled(cmd);

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
      throw new EffectInFlightError(cmd.instanceId, cmd.stageId, cmd.effectKey, cmd.capabilityCategory);
    }

    await this.deps.leases.assertLease(lease); // 调用工具、写 receipt 前再断言一次，缩小 check-then-act 窗口
    // 窄窗口复检：上面的取消检查与这里的 begin 之间仍有极小的间隙可能被取消挤进来。此时 receipt 已经
    // begin 过——不能像上面那次检查一样直接让 EffectCancelledError 把它撇下（否则同样落成 I-14 孤儿
    // 态）,命中时必须先 resolveBegun("unresolved") 显式收尾（work() 从未被调用，谈不上"已对账确认
    // 完成"，只能标记为查不到结论的终态），再把原始的取消错误照常抛出给调用方。
    try {
      await this.assertNotCancelled(cmd);
    } catch (err) {
      if (err instanceof EffectCancelledError || err instanceof EffectInstanceUnavailableError) {
        await this.deps.receipts.resolveBegun(cmd.orgId, "effect", requestKeyOf(cmd), "unresolved");
      }
      throw err;
    }
    await this.appendOrThrow(cmd, {
      type: "effect_begun",
      stageId: cmd.stageId,
      reasonCode: null,
      data: { effectKey: cmd.effectKey, capabilityCategory: cmd.capabilityCategory },
    });

    const result = await work(cmd.args);
    const provenance = provenanceOf(cmd);
    await this.deps.receipts.finalize(key, { stableResponse: { result, provenance }, checkpointId: null, instanceId: cmd.instanceId });
    // work() 已经执行且 receipt 已 finalize（不可逆、不会重放）：即使这条审计事件因实例并发转终态而
    // 追加失败，副作用本身依然是「已执行」，不能把它报成失败——只记下这条落空，不重新抛错掩盖结果。
    await this.deps.events.append(cmd.orgId, cmd.instanceId, {
      type: "effect_finalized",
      stageId: cmd.stageId,
      reasonCode: null,
      data: { effectKey: cmd.effectKey, capabilityCategory: cmd.capabilityCategory },
    });
    return { kind: "executed", result, provenance };
  }

  /** R3-10/UC-WR-I2 第三种阻断：`cancelling` 就地落成 `cancelled` 并拦下；已终态（含已 `cancelled`）直接拦下。 */
  private async assertNotCancelled(cmd: EffectStageCmd): Promise<void> {
    const instance = await this.deps.instances.find(cmd.orgId, cmd.instanceId);
    if (!instance) return; // 找不到实例：不是本方法的职责，交给后续的 receipt/append 去暴露真实原因
    if (instance.status === "cancelling") {
      await this.appendOrThrow(
        cmd,
        { type: "status_changed", stageId: cmd.stageId, reasonCode: "cancel_requested", data: { status: "cancelled" } },
        { status: "cancelled", reasonCode: "cancel_requested" },
      );
      throw new EffectCancelledError(cmd.instanceId, cmd.stageId, cmd.effectKey);
    }
    if (instance.status === "cancelled") {
      throw new EffectCancelledError(cmd.instanceId, cmd.stageId, cmd.effectKey);
    }
    if (isTerminal(instance.status)) {
      throw new EffectInstanceUnavailableError(cmd.instanceId, "instance_terminal");
    }
  }

  /** run-instance.ts 的 `append` 同款纪律：`!ok` 一律当作「这次副作用没资格发生」抛出，不静默吞掉。 */
  private async appendOrThrow(cmd: Pick<EffectStageCmd, "orgId" | "instanceId">, event: Parameters<WorkflowEventStore["append"]>[2], opts?: EventAppendOpts) {
    const r = await this.deps.events.append(cmd.orgId, cmd.instanceId, event, opts);
    if (!r.ok) throw new EffectInstanceUnavailableError(cmd.instanceId, r.conflict);
    return r;
  }

  /**
   * 只读：该 effect 是否已经 begin 过（任一状态）。调用方据此判断「这一条的决定已在先前的进程里提交」，
   * 恢复路径不再用当下的业务前置条件（如 CT09 的 P2 审批人资格）去否定一个可能已经发生的副作用。
   */
  async effectReceiptStatus(cmd: Pick<ExecuteEffectCommand, "orgId" | "instanceId" | "stageId" | "effectKey">): Promise<WorkflowReceiptRow["status"] | null> {
    const row = await this.deps.receipts.find(cmd.orgId, "effect", requestKeyOf(cmd));
    return row?.status ?? null;
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
