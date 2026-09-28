/**
 * WF03 —— Workflow 运行时（start / resume / cancel / 事件日志 / SSE）的应用层端口。
 * 实现在 infrastructure/workflow；application 只声明形状（洋葱架构）。
 */
import type { WorkflowInstanceStatus, WorkflowReasonCode, WorkflowSseEnvelope } from "@repo/contracts/workflow-runtime";
import type { PinnedWorkflowInstance, WorkflowLease } from "./workflow-ports";

export type WorkflowEventType = Extract<WorkflowSseEnvelope, { type: "delta" }>["payload"]["event"];

export interface WorkflowEventInput {
  type: WorkflowEventType;
  stageId: string | null;
  reasonCode: WorkflowReasonCode | null;
  data: Record<string, unknown>;
}

export interface WorkflowStoredEvent extends WorkflowEventInput {
  seq: number;
  stateVersion: number;
  createdAt: string;
}

/** 实例行 + 运行期可变列（status / stateVersion / reasonCode / 时间戳）。 */
export interface WorkflowInstanceState extends PinnedWorkflowInstance {
  reasonCode: WorkflowReasonCode | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowStageOutputRow {
  stageId: string;
  attempt: number;
  outputId: string;
  label: string;
  content: Record<string, unknown>;
}

export type WorkflowAppendResult =
  | { ok: true; seq: number; stateVersion: number; status: WorkflowInstanceStatus }
  | { ok: false; conflict: "state_version_conflict" | "instance_terminal" | "workflow_not_found" };

/**
 * 事件日志 + 状态机（I-10/I-11/I-12）。每次状态变化与其事件在**同一事务**里落库：
 * 锁实例行 → 校验 → status/reasonCode 改写且 stateVersion+1 → 追加 seq=last+1 的事件。
 */
export interface WorkflowEventStore {
  append(
    orgId: string,
    instanceId: string,
    event: WorkflowEventInput,
    opts?: { expectedStateVersion?: number; status?: WorkflowInstanceStatus; reasonCode?: WorkflowReasonCode | null },
  ): Promise<WorkflowAppendResult>;
  /** seq > afterSeq 的事件，按 seq 升序，至多 limit 条。 */
  listAfter(orgId: string, instanceId: string, afterSeq: number, limit: number): Promise<WorkflowStoredEvent[]>;
  /**
   * 一致快照：实例行（加共享锁，追加者需等本事务结束）、全部事件、全部阶段产出。
   * projection 只从这里构建，不读 checkpoint channel_values（I-8）。
   */
  loadSnapshot(
    orgId: string,
    instanceId: string,
  ): Promise<{ instance: WorkflowInstanceState; events: WorkflowStoredEvent[]; outputs: WorkflowStageOutputRow[] } | null>;
}

export interface WorkflowStageOutputStore {
  /** 幂等：(instance, stage, attempt) 已有行时返回既有行（created=false），绝不改写。 */
  put(orgId: string, instanceId: string, row: WorkflowStageOutputRow): Promise<{ row: WorkflowStageOutputRow; created: boolean }>;
  find(orgId: string, instanceId: string, stageId: string, attempt: number): Promise<WorkflowStageOutputRow | null>;
}

/** 启动前的准入判定（E6）与可见性判定所需的组织角色。 */
export interface WorkflowAccessPort {
  orgRoleOf(orgId: string, userId: string): Promise<"admin" | "member" | null>;
  /** 发起人可运行的已发布 Agent 版本；不可运行返回 null（→ workflow_not_allowed）。 */
  runnableAgentVersion(orgId: string, userId: string, agentId: string, workflowKey: string): Promise<string | null>;
}

/** 把拿到 lease 的实例交给运行时 worker（进程内后台执行或测试里同步执行）。 */
export interface WorkflowRunDispatcher {
  dispatch(lease: WorkflowLease): void;
}
