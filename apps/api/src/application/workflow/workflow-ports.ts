/**
 * Workflow Runtime 应用层端口（WF01）。实现由 infrastructure/workflow 提供（PG）；
 * 本文件只声明依赖形状，application 不 import infrastructure。
 */
import type { PinnedSkillVersion, WorkflowDefinitionVersionView, WorkflowInstanceStatus } from "@repo/contracts/workflow-runtime";
import type { WorkflowGraphCatalog } from "../../domain/workflow/definition-version";

export type { WorkflowGraphCatalog };

export interface WorkflowDefinitionRepository {
  /** 组织是否可见该 key 的 Definition（不可见 = workflow_not_found）。 */
  definitionExists(orgId: string, key: string): Promise<boolean>;
  findVersion(orgId: string, key: string, version: number): Promise<WorkflowDefinitionVersionView | null>;
  /** 最新 published 版本号；无则 null。 */
  latestPublishedVersion(orgId: string, key: string): Promise<number | null>;
  /** 写入一条 published 版本；实现必须拒绝覆盖已存在的 (org,key,version)（I-2）。 */
  insertPublished(orgId: string, view: WorkflowDefinitionVersionView): Promise<void>;
}

/** 解析 Skill 引用为已发布版本（按组织可见性）；不可解析返回 null。 */
export interface SkillVersionResolverPort {
  resolve(orgId: string, stableId: string, versionRange: string): Promise<string | null>;
}

export interface PinnedWorkflowInstance {
  instanceId: string;
  orgId: string;
  workflowKey: string;
  definitionVersion: number;
  graphRef: string;
  pinnedSkills: readonly PinnedSkillVersion[];
  agentId: string;
  agentVersionId: string;
  initiatorUserId: string;
  triggerKind: "manual" | "schedule" | "webhook";
  status: WorkflowInstanceStatus;
  stateVersion: number;
}

export interface WorkflowInstanceRepository {
  /** 创建后 definitionVersion / pinnedSkills 不再改变（I-4）；实现不得提供修改它们的路径。 */
  /** WF03：同一事务写 seq=1 的 `instance_started` 事件（data.input = triggerInput），I-11「先有事件」。 */
  create(instance: PinnedWorkflowInstance, opts?: { triggerInput?: Record<string, unknown> }): Promise<void>;
  find(orgId: string, instanceId: string): Promise<PinnedWorkflowInstance | null>;
}

/** 调用者身份（由 interface 层从会话解析后传入；application 不自己读会话）。 */
export interface WorkflowActor {
  userId: string;
  orgRole: "admin" | "member";
}

export interface WorkflowClock {
  nowIso(): string;
}

/* ── WF02：统一 receipt / lease（ADR-118；domain I-6/I-7/I-16） ─────────────── */

export type WorkflowReceiptScope = "command" | "effect";

export interface WorkflowReceiptKey {
  orgId: string;
  scope: WorkflowReceiptScope;
  /** command：requestId / Idempotency-Key / pg-boss 作业 id；effect：`instanceId/stageId/effectKey`。 */
  requestKey: string;
  /** 请求载荷指纹；同 key 不同指纹 = idempotency_key_reused（E7）。 */
  fingerprint: string;
}

export type WorkflowReceiptBegin =
  /** 首次：本调用拥有这条 receipt，应执行并 finalize。 */
  | { kind: "begun" }
  /** 已 finalize：直接返回首次稳定响应（A1）。 */
  | { kind: "replay"; stableResponse: unknown; checkpointId: string | null; instanceId: string | null }
  /** 已 begin 未 finalize（崩溃/并发）：调用方不得盲目重放外部调用（E1/I-14）。 */
  | { kind: "in_flight"; instanceId: string | null };

export interface WorkflowReceiptStore {
  /** 幂等：同 key 同指纹重复 begin 不新建行；不同指纹抛 WorkflowUseCaseError(idempotency_key_reused)。 */
  begin(key: WorkflowReceiptKey): Promise<WorkflowReceiptBegin>;
  /**
   * 幂等：首次把 begun 置 finalized 并记录 stableResponse / checkpointId；已 finalized 时返回**首次**的
   * stableResponse（不覆盖，I-7）。返回值永远是库里那份稳定响应。
   */
  finalize(
    key: WorkflowReceiptKey,
    result: { stableResponse: unknown; checkpointId: string | null; instanceId: string | null },
  ): Promise<unknown>;
}

/** 一次成功获取的 lease；epoch 是它的身份。 */
export interface WorkflowLease {
  orgId: string;
  instanceId: string;
  holder: string;
  epoch: number;
}

export interface WorkflowLeaseStore {
  /**
   * epoch CAS 获取（I-16/E2）：无 lease 或旧 lease 已过期且观察到的 epoch 未被他人推进时 epoch+1；
   * 否则抛 WorkflowUseCaseError(lease_conflict)。
   */
  acquire(input: { orgId: string; instanceId: string; holder: string; ttlMs: number }): Promise<WorkflowLease>;
  /** 任何副作用前调用：epoch 已被推进、持有者已变或已过期 → 抛 WorkflowLeaseLostError，不产生外部调用。 */
  assertLease(lease: WorkflowLease): Promise<void>;
  /** 持有者主动释放（人工门挂起等）；已失去 lease 时静默。 */
  release(lease: WorkflowLease): Promise<void>;
}
