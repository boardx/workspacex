/**
 * CT09 测试替身（DB-free：本目录在 tests/support/db-free-tests.ts 白名单里）。
 * 端口语义逐条对齐 PG 实现（receipt begin 三态 / lease epoch / 事件追加终态拒绝），但全部在进程内。
 * 「进程」= 一组 store 的持久态；杀进程 = 丢弃服务实例与 lease，保留 store 与租户 CRM 桩。
 */
import type { WorkflowInstanceStatus, WorkflowReasonCode } from "@repo/contracts/workflow-runtime";
import { WORKFLOW_TERMINAL_STATUSES } from "@repo/contracts/workflow-runtime";
import { EffectGateway } from "../../src/application/workflow/effect-gateway";
import { ComposedEffectPermissionRecheck, type CapabilityAuthorityCheck, type EffectCapabilityAuthorityPort } from "../../src/application/workflow/effect-permission-recheck";
import { WorkflowLeaseLostError, WorkflowUseCaseError } from "../../src/application/workflow/workflow-errors";
import type {
  PinnedWorkflowInstance,
  WorkflowInstanceRepository,
  WorkflowLease,
  WorkflowLeaseStore,
  WorkflowReceiptBegin,
  WorkflowReceiptKey,
  WorkflowReceiptRow,
  WorkflowReceiptScope,
  WorkflowReceiptStore,
} from "../../src/application/workflow/workflow-ports";
import type { WorkflowAccessPort, WorkflowAppendResult, WorkflowEventInput, WorkflowEventStore } from "../../src/application/workflow/workflow-runtime-ports";
import type { InAppNotifyPort, LeadApproverEligibilityPort, TenantCrmPort } from "../../src/application/work-content/lead-write-back";

type Row = WorkflowReceiptRow & { fingerprint: string };

export class MemReceipts implements WorkflowReceiptStore {
  rows = new Map<string, Row>();
  private k(orgId: string, scope: WorkflowReceiptScope, requestKey: string) {
    return `${orgId}|${scope}|${requestKey}`;
  }
  async begin(key: WorkflowReceiptKey): Promise<WorkflowReceiptBegin> {
    const id = this.k(key.orgId, key.scope, key.requestKey);
    const row = this.rows.get(id);
    if (!row) {
      this.rows.set(id, { status: "begun", fingerprint: key.fingerprint, instanceId: null, checkpointId: null, stableResponse: null });
      return { kind: "begun" };
    }
    if (row.fingerprint !== key.fingerprint) throw new WorkflowUseCaseError("idempotency_key_reused", "reused");
    // 与 PgWorkflowReceiptStore 一致：reconciled 与 finalized 同走 replay。
    if (row.status === "finalized" || row.status === "reconciled") return { kind: "replay", stableResponse: row.stableResponse, checkpointId: row.checkpointId, instanceId: row.instanceId };
    return { kind: "in_flight", instanceId: row.instanceId };
  }
  async finalize(key: WorkflowReceiptKey, r: { stableResponse: unknown; checkpointId: string | null; instanceId: string | null }) {
    const row = this.rows.get(this.k(key.orgId, key.scope, key.requestKey))!;
    if (row.status !== "finalized") Object.assign(row, { status: "finalized", ...r });
    return row.stableResponse;
  }
  async find(orgId: string, scope: WorkflowReceiptScope, requestKey: string) {
    return this.rows.get(this.k(orgId, scope, requestKey)) ?? null;
  }
  async resolveBegun(orgId: string, scope: WorkflowReceiptScope, requestKey: string, outcome: "reconciled" | "unresolved") {
    const row = this.rows.get(this.k(orgId, scope, requestKey));
    if (row?.status === "begun") row.status = outcome;
  }
}

export class MemLeases implements WorkflowLeaseStore {
  epoch = new Map<string, { holder: string; epoch: number }>();
  async acquire(i: { orgId: string; instanceId: string; holder: string }): Promise<WorkflowLease> {
    const cur = this.epoch.get(i.instanceId);
    const next = { holder: i.holder, epoch: (cur?.epoch ?? 0) + 1 };
    this.epoch.set(i.instanceId, next);
    return { orgId: i.orgId, instanceId: i.instanceId, ...next };
  }
  async assertLease(l: WorkflowLease) {
    const cur = this.epoch.get(l.instanceId);
    if (!cur || cur.epoch !== l.epoch || cur.holder !== l.holder) throw new WorkflowLeaseLostError(l.instanceId, l.epoch, cur?.epoch ?? null);
  }
  async renew(l: WorkflowLease) {
    await this.assertLease(l);
  }
  async release() {}
}

export class MemInstances implements WorkflowInstanceRepository, Pick<WorkflowEventStore, "append"> {
  instances = new Map<string, PinnedWorkflowInstance & { reasonCode: WorkflowReasonCode | null }>();
  events: WorkflowEventInput[] = [];
  /** 追加该状态的 status_changed 前进程被杀（测恢复）。 */
  crashBeforeStatus: WorkflowInstanceStatus | null = null;
  /** 追加第 n 条事件之前执行（模拟并发取消等外部状态变化）。 */
  beforeAppend: ((event: WorkflowEventInput) => void) | null = null;
  async create(i: PinnedWorkflowInstance) {
    this.instances.set(i.instanceId, { ...i, reasonCode: null });
  }
  async find(_orgId: string, id: string) {
    return this.instances.get(id) ?? null;
  }
  async append(
    _orgId: string,
    id: string,
    event: WorkflowEventInput,
    opts?: { expectedStateVersion?: number; status?: WorkflowInstanceStatus; reasonCode?: WorkflowReasonCode | null },
  ): Promise<WorkflowAppendResult> {
    this.beforeAppend?.(event);
    if (opts?.status && opts.status === this.crashBeforeStatus) {
      this.crashBeforeStatus = null;
      throw new ProcessKilled();
    }
    const inst = this.instances.get(id);
    if (!inst) return { ok: false, conflict: "workflow_not_found" };
    if (WORKFLOW_TERMINAL_STATUSES.includes(inst.status)) return { ok: false, conflict: "instance_terminal" };
    if (opts?.expectedStateVersion !== undefined && opts.expectedStateVersion !== inst.stateVersion) return { ok: false, conflict: "state_version_conflict" };
    this.events.push(event);
    inst.stateVersion += 1;
    if (opts?.status) {
      inst.status = opts.status;
      inst.reasonCode = opts.reasonCode ?? null;
    }
    return { ok: true, seq: this.events.length, stateVersion: inst.stateVersion, status: inst.status };
  }
}

/** 租户 CRM 桩：版本号即写入计数；`crashAfterWrites` 模拟写入落库后、receipt finalize 前进程被杀。 */
export class CrmStub implements TenantCrmPort {
  records = new Map<string, { version: string; fields: Record<string, unknown>; writeKeys: string[] }>();
  writes = 0;
  crashAfterWrites: number | null = null;
  /** 进程已死：此后本进程内对 CRM 的任何调用都不会返回（新进程由 runProcess 复位）。 */
  dead = false;
  /** 下一次写入抛普通工具错误（E11）；`afterWrite` = 写已落库后才抛（超时类）。 */
  failNext: { afterWrite: boolean } | null = null;
  seed(recordId: string, version: string, fields: Record<string, unknown>) {
    this.records.set(recordId, { version, fields, writeKeys: [] });
  }
  private alive() {
    if (this.dead) throw new ProcessKilled();
  }
  async read(_orgId: string, recordId: string) {
    this.alive();
    const r = this.records.get(recordId);
    return r ? { version: r.version, fields: r.fields } : null;
  }
  async writeIfVersion(i: { recordId: string; expectedVersion: string | null; fields: Record<string, unknown>; writeKey: string }) {
    this.alive();
    const fail = this.failNext;
    if (fail && !fail.afterWrite) {
      this.failNext = null;
      throw new Error("crm 503");
    }
    const cur = this.records.get(i.recordId) ?? null;
    if ((cur?.version ?? null) !== i.expectedVersion) return { ok: false as const, current: cur ? { version: cur.version, fields: cur.fields } : null };
    this.writes += 1;
    const version = `v${Number((cur?.version ?? "v0").slice(1)) + 1}`;
    this.records.set(i.recordId, { version, fields: { ...(cur?.fields ?? {}), ...i.fields }, writeKeys: [...(cur?.writeKeys ?? []), i.writeKey] });
    if (this.crashAfterWrites !== null && this.writes >= this.crashAfterWrites) {
      this.crashAfterWrites = null;
      this.dead = true;
      throw new ProcessKilled();
    }
    if (fail?.afterWrite) {
      this.failNext = null;
      throw new Error("crm timeout after commit");
    }
    return { ok: true as const, version };
  }
  async hasWrite(_orgId: string, writeKey: string) {
    this.alive();
    return [...this.records.values()].some((r) => r.writeKeys.includes(writeKey));
  }
}

export class ProcessKilled extends Error {}

export class Eligibility implements LeadApproverEligibilityPort {
  revoked = new Set<string>();
  async stillEligible(_o: string, _u: string, itemId: string) {
    return !this.revoked.has(itemId);
  }
}

export class NotifyStub implements InAppNotifyPort {
  sent: { recipientUserId: string; summary: Record<string, number> }[] = [];
  readable = true;
  /** 发送成功后、receipt finalize 前进程被杀（测恢复时通知不重发、不因汇总变化卡死）。 */
  crashAfterSend = false;
  async canRead() {
    return this.readable;
  }
  async hasSent() {
    return this.sent.length > 0;
  }
  async send(i: { recipientUserId: string; summary: Record<string, number> }) {
    this.sent.push(i);
    if (this.crashAfterSend) {
      this.crashAfterSend = false;
      throw new ProcessKilled();
    }
    return { notificationId: `n-${this.sent.length}` };
  }
}

export class Grants implements EffectCapabilityAuthorityPort {
  map = new Map<string, CapabilityAuthorityCheck>();
  /** 每个分类被查询的次数（第 n 次查询 = 第 n 个时点的授权状态）。 */
  calls = new Map<string, number>();
  /** 返回非 undefined 即覆盖该次查询结果（模拟两条写之间授权被撤销，测 P3）。 */
  override: ((category: string, callNo: number) => CapabilityAuthorityCheck | undefined) | null = null;
  async checkCapability(_o: string, category: string) {
    const n = (this.calls.get(category) ?? 0) + 1;
    this.calls.set(category, n);
    const o = this.override?.(category, n);
    if (o) return o;
    return this.map.get(category) ?? { authorized: true, sideEffectCap: "read" as const }; // ADR-120 #2 默认只读
  }
}

export const allowAll: WorkflowAccessPort = {
  orgRoleOf: async () => "member",
  runnableAgentVersion: async (_o, _u, agentId) => `${agentId}-v1`,
};

export function makeGateway(receipts: MemReceipts, leases: MemLeases, instances: MemInstances, grants: Grants): EffectGateway {
  const events = instances as unknown as WorkflowEventStore;
  return new EffectGateway({ receipts, leases, events, instances, permission: new ComposedEffectPermissionRecheck(allowAll, grants) });
}
