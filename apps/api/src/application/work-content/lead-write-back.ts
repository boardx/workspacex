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
 * 终局：runtime 状态只用 `succeeded`；`completed_with_holds` = succeeded + outcome `with_holds`（I-C9）。
 */
import type { z } from "zod";
import type { CrmWriteItemOutcome, WorkContentOutcome } from "@repo/contracts/work-content";
import { W011 } from "../../domain/work-content/definitions/sales";
import { EffectInFlightError, withinSideEffectCap, type EffectGateway, type EffectReconcilePort } from "../workflow/effect-gateway";
import type { EffectCapabilityAuthorityPort } from "../workflow/effect-permission-recheck";
import type { WorkflowLease } from "../workflow/workflow-ports";
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
  status: "succeeded" | "rejected";
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
      await this.deps.events.append(
        cmd.orgId,
        cmd.instanceId,
        { type: "status_changed", stageId: "review", reasonCode: "gate_denied", data: { status: "rejected" } },
        { status: "rejected", reasonCode: "gate_denied" },
      );
      return { status: "rejected", outcome: null, items: results, manualChecklist: [], notified: false };
    }

    const manualChecklist: ManualChecklistRow[] = [];
    const cap = await this.deps.capability.checkCapability(cmd.orgId, CRM_WRITE);
    const writeAuthorized = cap.authorized && withinSideEffectCap(WRITE_STAGE.sideEffect, cap.sideEffectCap);

    for (const item of approved) {
      if (!writeAuthorized) {
        manualChecklist.push({ itemId: item.itemId, company: item.company, fields: item.fields });
        results.push({ itemId: item.itemId, outcome: "written_manual", conflictDiff: null });
        continue;
      }
      results.push(await this.writeOne(lease, cmd, item));
    }

    const notified = await this.notify(lease, cmd, results);
    const outcome: LeadWriteOutcome = results.some((r) => HOLD_OUTCOMES.has(r.outcome)) ? "with_holds" : "complete";
    await this.deps.events.append(
      cmd.orgId,
      cmd.instanceId,
      { type: "status_changed", stageId: null, reasonCode: null, data: { status: "succeeded", outcome } },
      { status: "succeeded", reasonCode: null },
    );
    return { status: "succeeded", outcome, items: results, manualChecklist, notified };
  }

  private async writeOne(lease: WorkflowLease, cmd: LeadWriteBackCommand, item: ApprovedLead): Promise<LeadItemResult> {
    if (!(await this.deps.eligibility.stillEligible(cmd.orgId, cmd.approverUserId, item.itemId))) {
      await this.deps.events.append(cmd.orgId, cmd.instanceId, {
        type: "effect_blocked",
        stageId: WRITE_STAGE.stageId,
        reasonCode: null,
        data: { effectKey: item.itemId, capabilityCategory: CRM_WRITE, itemOutcome: "forbidden" },
      });
      return { itemId: item.itemId, outcome: "forbidden", conflictDiff: null };
    }
    const effectKey = `crm:${item.itemId}`;
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
      if (!(err instanceof EffectInFlightError)) throw err;
      const reconciler: EffectReconcilePort = { reconcile: () => this.deps.crm.hasWrite(cmd.orgId, writeKey) };
      const r = await this.deps.gateway.reconcile(effectCmd, reconciler);
      // 读回确认已写 → written；查不到结论 → held（实例由网关落 needs_attention，不重放写入）。
      return { itemId: item.itemId, outcome: r === "reconciled" ? "written" : "held", conflictDiff: null };
    }
  }

  private async notify(lease: WorkflowLease, cmd: LeadWriteBackCommand, results: readonly LeadItemResult[]): Promise<boolean> {
    const cap = await this.deps.capability.checkCapability(cmd.orgId, NOTIFY_INAPP);
    if (!cap.authorized || !withinSideEffectCap(NOTIFY_STAGE.sideEffect, cap.sideEffectCap)) return false;
    if (!(await this.deps.notify.canRead(cmd.orgId, cmd.initiatorUserId, cmd.instanceId))) return false; // P4
    const summary: Record<string, number> = {};
    for (const r of results) summary[r.outcome] = (summary[r.outcome] ?? 0) + 1;
    await this.deps.gateway.execute(
      lease,
      {
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
        fingerprint: JSON.stringify(summary),
        args: { recipientUserId: cmd.initiatorUserId, summary },
        approvalRequestId: cmd.approvalRequestId,
      },
      async (args) => this.deps.notify.send({ orgId: cmd.orgId, recipientUserId: String(args.recipientUserId), instanceId: cmd.instanceId, summary }),
    );
    return true;
  }
}
