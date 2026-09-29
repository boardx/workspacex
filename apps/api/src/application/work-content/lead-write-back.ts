/**
 * CT09 —— W011「线索到合格」G1 之后的写回段（`05-content-lines.md` R3 步骤 8；R4 A5/E4/E5/E6/E7；
 * usecases.md W011 逐条结果；domain I-C8/I-C9）。
 *
 * 顺序（每条已批准线索）：
 *   P2 重查审批人资格（G1 之后被撤销 → `forbidden`，不调用网关，E5）
 *   → effect-gateway.execute（内含 P3 写权限重查、receipt begin/finalize，I-13/I-14）
 *   → 工具体内按阶段读到的记录版本做乐观并发写入（版本已变 → `conflict`，读回当前值，不覆盖，E4）。
 * 崩溃恢复（E6）：网关报 `EffectInFlightError` → 走 `reconcile`，读回租户 CRM 判断该条是否已写，
 *   绝不二次调用写入。
 * 组织未授权 `crm.write`（ADR-120 默认只读）→ 全部批准条目 `written_manual` + 人工核对清单（A5）。
 * 全部驳回 → 零副作用，实例 `rejected`（gate_denied，E7）。
 * P3 在写前被网关拒绝 → 该条 `forbidden`，继续下一条（E5）。
 * 单条工具异常（非租约/取消/实例不可用）→ 读回对账：确认已写 → `written`，否则 `held`（E11，不中断实例）。
 * 任一条 `held`（对账无结论）→ 实例保持网关落的 needs_attention，不追加 succeeded。
 * 终局：runtime 状态只用 `succeeded`；`completed_with_holds` = succeeded + outcome `with_holds`（I-C9）。
 *
 * 2026-09-29 review 修订：
 * - 终局追加（succeeded / rejected）前先断言 lease（僵尸 worker 不得落终态），再按实例当前
 *   stateVersion 做 CAS：期间被取消 / 转 needs_attention / 被他人推进 → 不覆盖（R3-10、I-12），
 *   `cancelling` 就地落 `cancelled` 并抛 `EffectCancelledError`；其余抛 `EffectInstanceUnavailableError`。
 * - P2 在「该条 effect 尚无 receipt」时才重查：先前进程已 begin/finalize 的条目，其决定已提交，
 *   恢复时交给网关 replay / reconcile 判定真实结果，不因 G1 后撤销资格而谎报 forbidden（E5×E6）。
 * - P2 的 effect_blocked 与网关 P3 用同一个 effectKey（`crm:<itemId>`）。
 * - 通知 effect 的指纹按实例确定（不随汇总变化）：恢复重算出不同汇总时 replay 首次结果，不抛
 *   idempotency_key_reused 卡死实例；通知至多一次。
 */
import type { z } from "zod";
import type { CrmWriteItemOutcome, WorkContentOutcome } from "@repo/contracts/work-content";
import { W011 } from "../../domain/work-content/definitions/sales";
import {
  EffectCancelledError,
  EffectInFlightError,
  EffectInstanceUnavailableError,
  EffectPermissionBlockedError,
  withinSideEffectCap,
  type EffectGateway,
  type EffectReconcilePort,
} from "../workflow/effect-gateway";
import { WorkflowLeaseLostError } from "../workflow/workflow-errors";
import type { WorkflowInstanceRepository, WorkflowLeaseStore } from "../workflow/workflow-ports";
import type { EffectCapabilityAuthorityPort } from "../workflow/effect-permission-recheck";
import type { WorkflowLease } from "../workflow/workflow-ports";
import type { WorkflowInstanceStatus, WorkflowReasonCode } from "@repo/contracts/workflow-runtime";
import { WORKFLOW_TERMINAL_STATUSES } from "@repo/contracts/workflow-runtime";
import type { WorkflowEventStore } from "../workflow/workflow-runtime-ports";

export type CrmItemOutcome = z.infer<typeof CrmWriteItemOutcome>;
export type LeadWriteOutcome = z.infer<typeof WorkContentOutcome>;

/** 租户 CRM（不是平台运营 CRM，05 号「Workflow 落点」）的写端口：带版本的乐观并发写入。 */
export interface TenantCrmPort {
  read(orgId: string, recordId: string): Promise<{ version: string; fields: Record<string, unknown> } | null>;
  /** 版本相符才写；`writeKey` 随记录落库，供崩溃恢复读回判定（E6）。 */
  writeIfVersion(input: {
    orgId: string;
    recordId: string;
    expectedVersion: string | null;
    fields: Record<string, unknown>;
    writeKey: string;
  }): Promise<{ ok: true; version: string } | { ok: false; current: { version: string; fields: Record<string, unknown> } | null }>;
  /** 该 writeKey 是否已经落在租户 CRM 上（只读对账用）。 */
  hasWrite(orgId: string, writeKey: string): Promise<boolean>;
}

/** P2：审批人在写回前仍具备 W011 规定的审批资格（队列经理 / RevOps / 本人线索）。 */
export interface LeadApproverEligibilityPort {
  stillEligible(orgId: string, approverUserId: string, itemId: string): Promise<boolean>;
}

/** 站内通知端口；P4 收件人读权限由 `canRead` 核实。 */
export interface InAppNotifyPort {
  canRead(orgId: string, recipientUserId: string, instanceId: string): Promise<boolean>;
  send(input: { orgId: string; recipientUserId: string; instanceId: string; summary: Record<string, number> }): Promise<{ notificationId: string }>;
  /** 只读对账：该实例是否已给发起人发过站内通知（崩溃恢复不重发，E6）。 */
  hasSent(orgId: string, instanceId: string): Promise<boolean>;
}

export interface ApprovedLead {
  itemId: string;
  company: string;
  decision: "approve" | "reject";
  /** 阶段读到的 CRM 记录版本（null = 新建）。 */
  recordVersion: string | null;
  fields: Record<string, unknown>;
  itemDigest: string;
}

export interface LeadWriteBackCommand {
  orgId: string;
  instanceId: string;
  initiatorUserId: string;
  agentId: string;
  agentVersionId: string;
  approverUserId: string;
  approvalRequestId: string;
  items: readonly ApprovedLead[];
}

export interface LeadItemResult {
  itemId: string;
  outcome: CrmItemOutcome;
  conflictDiff: Record<string, { before: unknown; current: unknown }> | null;
}

export interface ManualChecklistRow {
  itemId: string;
  company: string;
  fields: Record<string, unknown>;
}

export interface LeadWriteBackResult {
  /** `needs_attention`：有条目对账查不到结论（held），实例停在 needs_attention，不推进到 succeeded。 */
  status: "succeeded" | "rejected" | "needs_attention";
  outcome: LeadWriteOutcome | null;
  items: LeadItemResult[];
  manualChecklist: ManualChecklistRow[];
  notified: boolean;
}

export interface LeadWriteBackDeps {
  gateway: EffectGateway;
  capability: EffectCapabilityAuthorityPort;
  eligibility: LeadApproverEligibilityPort;
  crm: TenantCrmPort;
  notify: InAppNotifyPort;
  events: WorkflowEventStore;
  /** 终局追加前的 lease 围栏（与网关同一份 lease store）。 */
  leases: WorkflowLeaseStore;
  /** 终局 CAS 读实例当前 status / stateVersion（与网关同一份仓储）。 */
  instances: WorkflowInstanceRepository;
}

const WRITE_STAGE = W011.stages.find((s) => s.stageId === "write_back")!;
const NOTIFY_STAGE = W011.stages.find((s) => s.stageId === "notify")!;
const CRM_WRITE = WRITE_STAGE.capabilityCategories![0]!;
const NOTIFY_INAPP = NOTIFY_STAGE.capabilityCategories![0]!;
const HOLD_OUTCOMES: ReadonlySet<CrmItemOutcome> = new Set(["conflict", "forbidden", "held", "written_manual"]);

function diffOf(before: Record<string, unknown>, current: Record<string, unknown> | null): Record<string, { before: unknown; current: unknown }> {
  const out: Record<string, { before: unknown; current: unknown }> = {};
  const keys = new Set([...Object.keys(before), ...Object.keys(current ?? {})]);
  for (const k of keys) {
    const b = before[k];
    const c = current?.[k];
    if (JSON.stringify(b) !== JSON.stringify(c)) out[k] = { before: b, current: c };
  }
  return out;
}

export class LeadWriteBackService {
  constructor(private readonly deps: LeadWriteBackDeps) {}

  async run(lease: WorkflowLease, cmd: LeadWriteBackCommand): Promise<LeadWriteBackResult> {
    const approved = cmd.items.filter((i) => i.decision === "approve");
    const results: LeadItemResult[] = cmd.items
      .filter((i) => i.decision === "reject")
      .map((i) => ({ itemId: i.itemId, outcome: "rejected" as const, conflictDiff: null }));

    if (approved.length === 0) {
      await this.finish(lease, cmd, { type: "status_changed", stageId: "review", reasonCode: "gate_denied", data: { status: "rejected" } }, "rejected", "gate_denied");
      return { status: "rejected", outcome: null, items: results, manualChecklist: [], notified: false };
    }

    const manualChecklist: ManualChecklistRow[] = [];
    const cap = await this.deps.capability.checkCapability(cmd.orgId, CRM_WRITE);
    const writeAuthorized = cap.authorized && withinSideEffectCap(WRITE_STAGE.sideEffect, cap.sideEffectCap);

    // 对账无结论（held）时网关已把实例落成 needs_attention（终态，I-12）：此后网关拒绝一切副作用，
    // 剩余条目不再尝试、同记 held（未写），不抛错中断；实例不推进到 succeeded，也不发通知。
    let unreconciled = false;
    for (const item of approved) {
      if (!writeAuthorized) {
        manualChecklist.push({ itemId: item.itemId, company: item.company, fields: item.fields });
        results.push({ itemId: item.itemId, outcome: "written_manual", conflictDiff: null });
        continue;
      }
      if (unreconciled) {
        results.push({ itemId: item.itemId, outcome: "held", conflictDiff: null });
        continue;
      }
      const r = await this.writeOne(lease, cmd, item);
      if (r.outcome === "held") unreconciled = true;
      results.push(r);
    }

    const outcome: LeadWriteOutcome = results.some((r) => HOLD_OUTCOMES.has(r.outcome)) ? "with_holds" : "complete";
    if (unreconciled) return { status: "needs_attention", outcome, items: results, manualChecklist, notified: false };
    const notified = await this.notify(lease, cmd, results);
    if (notified === "unresolved") return { status: "needs_attention", outcome, items: results, manualChecklist, notified: false };
    await this.finish(lease, cmd, { type: "status_changed", stageId: null, reasonCode: null, data: { status: "succeeded", outcome } }, "succeeded", null);
    return { status: "succeeded", outcome, items: results, manualChecklist, notified };
  }

  /**
   * 终局状态追加：lease 围栏 + stateVersion CAS。不覆盖期间发生的取消 / 终态（R3-10、I-12）。
   * lease 断言与 CAS 之间仍有极窄窗口；CAS 保证即便僵尸 worker 挤进窗口，也只能在实例状态未被
   * 任何人改动时落终态——不会覆盖新持有者或取消方已落的状态。
   */
  private async finish(
    lease: WorkflowLease,
    cmd: LeadWriteBackCommand,
    event: Parameters<WorkflowEventStore["append"]>[2],
    status: WorkflowInstanceStatus,
    reasonCode: WorkflowReasonCode | null,
  ): Promise<void> {
    await this.deps.leases.assertLease(lease);
    const inst = await this.deps.instances.find(cmd.orgId, cmd.instanceId);
    if (!inst) throw new EffectInstanceUnavailableError(cmd.instanceId, "workflow_not_found");
    if (inst.status === "cancelling") {
      const c = await this.deps.events.append(
        cmd.orgId,
        cmd.instanceId,
        { type: "status_changed", stageId: event.stageId, reasonCode: "cancel_requested", data: { status: "cancelled" } },
        { expectedStateVersion: inst.stateVersion, status: "cancelled", reasonCode: "cancel_requested" },
      );
      if (!c.ok) throw new EffectInstanceUnavailableError(cmd.instanceId, c.conflict);
      throw new EffectCancelledError(cmd.instanceId, event.stageId ?? "", "terminal");
    }
    if (inst.status === "cancelled") throw new EffectCancelledError(cmd.instanceId, event.stageId ?? "", "terminal");
    if (WORKFLOW_TERMINAL_STATUSES.includes(inst.status)) throw new EffectInstanceUnavailableError(cmd.instanceId, "instance_terminal");
    const r = await this.deps.events.append(cmd.orgId, cmd.instanceId, event, { expectedStateVersion: inst.stateVersion, status, reasonCode });
    if (!r.ok) throw new EffectInstanceUnavailableError(cmd.instanceId, r.conflict);
  }

  private async writeOne(lease: WorkflowLease, cmd: LeadWriteBackCommand, item: ApprovedLead): Promise<LeadItemResult> {
    const effectKey = `crm:${item.itemId}`;
    // E5×E6：先前进程已 begin 过这一条 → 决定已提交，P2 不再否定它；真实结果由网关 replay / reconcile 给出。
    const prior = await this.deps.gateway.effectReceiptStatus({ orgId: cmd.orgId, instanceId: cmd.instanceId, stageId: WRITE_STAGE.stageId, effectKey });
    if (prior === null && !(await this.deps.eligibility.stillEligible(cmd.orgId, cmd.approverUserId, item.itemId))) {
      await this.deps.events.append(cmd.orgId, cmd.instanceId, {
        type: "effect_blocked",
        stageId: WRITE_STAGE.stageId,
        reasonCode: null,
        data: { effectKey, capabilityCategory: CRM_WRITE, itemOutcome: "forbidden" },
      });
      return { itemId: item.itemId, outcome: "forbidden", conflictDiff: null };
    }
    const writeKey = `${cmd.instanceId}/${effectKey}`;
    const effectCmd = {
      orgId: cmd.orgId,
      instanceId: cmd.instanceId,
      stageId: WRITE_STAGE.stageId,
      workflowKey: W011.key,
      effectKey,
      capabilityCategory: CRM_WRITE,
      sideEffect: WRITE_STAGE.sideEffect,
      initiatorUserId: cmd.initiatorUserId,
      agentId: cmd.agentId,
      agentVersionId: cmd.agentVersionId,
      fingerprint: item.itemDigest,
      args: { recordId: item.itemId, expectedVersion: item.recordVersion, fields: item.fields },
      approvalRequestId: cmd.approvalRequestId,
    };
    try {
      const done = await this.deps.gateway.execute(lease, effectCmd, async () => {
        const w = await this.deps.crm.writeIfVersion({
          orgId: cmd.orgId,
          recordId: item.itemId,
          expectedVersion: item.recordVersion,
          fields: item.fields,
          writeKey,
        });
        return w.ok ? { status: "written", version: w.version } : { status: "conflict", current: w.current };
      });
      if (done.result.status === "conflict") {
        const current = (done.result.current as { fields: Record<string, unknown> } | null)?.fields ?? null;
        return { itemId: item.itemId, outcome: "conflict", conflictDiff: diffOf(item.fields, current) };
      }
      return { itemId: item.itemId, outcome: "written", conflictDiff: null };
    } catch (err) {
      // P3：网关已落 effect_blocked；按契约是该条 forbidden，不中断其它条（E5）。
      if (err instanceof EffectPermissionBlockedError) return { itemId: item.itemId, outcome: "forbidden", conflictDiff: null };
      // 租约丢失 / 取消 / 实例不可用是实例级事实，不能降级成单条结果。
      if (err instanceof EffectCancelledError || err instanceof EffectInstanceUnavailableError || err instanceof WorkflowLeaseLostError) throw err;
      // EffectInFlightError（崩溃恢复）与单条工具异常（E11）同走只读对账，绝不二次调用写入。
      const reconciler: EffectReconcilePort = { reconcile: () => this.deps.crm.hasWrite(cmd.orgId, writeKey) };
      const r = await this.deps.gateway.reconcile(effectCmd, reconciler);
      // 读回确认已写 → written；查不到结论 → held（实例由网关落 needs_attention，不重放写入）。
      return { itemId: item.itemId, outcome: r === "reconciled" ? "written" : "held", conflictDiff: null };
    }
  }

  private async notify(lease: WorkflowLease, cmd: LeadWriteBackCommand, results: readonly LeadItemResult[]): Promise<boolean | "unresolved"> {
    const cap = await this.deps.capability.checkCapability(cmd.orgId, NOTIFY_INAPP);
    if (!cap.authorized || !withinSideEffectCap(NOTIFY_STAGE.sideEffect, cap.sideEffectCap)) return false;
    if (!(await this.deps.notify.canRead(cmd.orgId, cmd.initiatorUserId, cmd.instanceId))) {
      // P4：收件人已无读权限 → 不发，但留审计事件，跳过可追溯。
      await this.deps.events.append(cmd.orgId, cmd.instanceId, {
        type: "effect_blocked",
        stageId: NOTIFY_STAGE.stageId,
        reasonCode: null,
        data: { effectKey: "notify:initiator", capabilityCategory: NOTIFY_INAPP, skipped: "recipient_cannot_read" },
      });
      return false;
    }
    const summary: Record<string, number> = {};
    for (const r of results) summary[r.outcome] = (summary[r.outcome] ?? 0) + 1;
    const notifyCmd = {
      orgId: cmd.orgId,
      instanceId: cmd.instanceId,
      stageId: NOTIFY_STAGE.stageId,
      workflowKey: W011.key,
      effectKey: "notify:initiator",
      capabilityCategory: NOTIFY_INAPP,
      sideEffect: NOTIFY_STAGE.sideEffect,
      initiatorUserId: cmd.initiatorUserId,
      agentId: cmd.agentId,
      agentVersionId: cmd.agentVersionId,
      // 按实例确定：恢复时汇总可能不同（如条目改判），不能让它变成 idempotency_key_reused 卡死实例。
      fingerprint: `${cmd.instanceId}/notify:initiator`,
      args: { recipientUserId: cmd.initiatorUserId, summary },
      approvalRequestId: cmd.approvalRequestId,
    };
    try {
      await this.deps.gateway.execute(lease, notifyCmd, async (args) =>
        this.deps.notify.send({ orgId: cmd.orgId, recipientUserId: String(args.recipientUserId), instanceId: cmd.instanceId, summary }),
      );
      return true;
    } catch (err) {
      if (!(err instanceof EffectInFlightError)) throw err;
      // 先前进程发送后未 finalize：只读对账，绝不重发。查不到结论 → 网关落 needs_attention，这里如实抛出。
      const r = await this.deps.gateway.reconcile(notifyCmd, { reconcile: () => this.deps.notify.hasSent(cmd.orgId, cmd.instanceId) });
      // 查不到结论 → 网关已把实例落 needs_attention（终态）；如实上报，不追加 succeeded。
      return r === "reconciled" ? true : "unresolved";
    }
  }
}
