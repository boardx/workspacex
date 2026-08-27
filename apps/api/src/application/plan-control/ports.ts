/**
 * Ports for the `plan-control` 契约束 (F973+) —— `chat_plan_ledgers` 账本读写与
 * `agent_runs` 的粗粒度状态读取（`PlanPhase` 派生所需，I-7）。
 *
 * 权威规格：phases/phase-01-run-a-project/contracts/plan-control/{domain,usecases,design-signoff}.md
 * 契约单一事实源：packages/contracts/src/plan-control.ts（`PlanStep`/`PlanControlError`/
 * `derivePlanPhase`/`evaluatePlanGate` 全部从那里 import，本文件不重复定义）。
 *
 * append-only 是数据库层面的保证（migration 20260826150000_f972_plan_control_ledger.sql
 * 的 BEFORE UPDATE 触发器 + REVOKE UPDATE），这里只是暴露一个「没有 update 方法」的接口——
 * 与 `provenance/ports.ts` 同一纪律。
 */
import type { OrgId } from "../../domain/org-id";
import type { PlanOrigin, PlanStep, RunStatusForPhase } from "@repo/contracts/plan-control";
import type { TenantSession } from "../ports/database.port";

/** 一条计划账本行（`domain.md` 一·1 `PlanLedger`），infrastructure 读出来的形状。 */
export interface PlanLedgerRow {
  readonly revision: number;
  readonly engineEpoch: number;
  readonly origin: PlanOrigin;
  readonly basedOnRevision: number | null;
  readonly steps: PlanStep[];
  readonly createdBy: string | null;
  readonly createdAt: string;
}

/** 孤儿约束（I-8）。 */
export interface OrphanedConstraintRow {
  readonly constraintId: string;
  readonly text: string;
  readonly orphanedAtRevision: number;
  readonly formerStepContent: string;
}

/** `getPlanLedger`/`derivePlanPhase` 需要的、关于该线程「活跃或最近一次」run 的粗粒度信息。 */
export interface PlanRunSnapshot {
  readonly runId: string;
  readonly status: RunStatusForPhase;
  /** DA-07b `awaiting_approval` 期间非空；映射 `derivePlanPhase` 的 `pendingToolCalls`。 */
  readonly pendingToolName: string | null;
  readonly createdAt: string;
  /** F975 UC-7 `confirmPlan`：续跑用哪个 agent，取自「产出这份计划的那次 run」用的 agent。 */
  readonly agentId: string;
  /** F976 UC-9：远端（LangGraph）run id，P-2 探针落点。创建阶段的短暂窗口内可能仍是 `null`。 */
  readonly remoteRunId: string | null;
  /** F976 UC-9/UC-13：这条 run 是否已被 `pausePlanRun` 打断过，及打断时刻。 */
  readonly pausedAt: string | null;
}

/**
 * `PlanLedgerRepository` —— append-only 账本的读写端口（`usecases.md` 端口表）。
 *
 * F973 范围：`getLatest`（UC-1 的读面）+ `appendEngineSnapshot`（UC-2）+
 * `listOrphanedConstraints`（UC-1 出参的一部分，F974 UC-4 才会真正产出行）。
 * 编辑类动作（UC-3/4/5/6）的写方法留给 F974 按需追加——接口在这里先只放
 * 当前两个 feature 实际用到的方法，不预先猜测未落地 UC 的形状。
 */
export interface PlanLedgerRepository {
  /** 当前 revision 最大的一行；线程还没有任何账本时返回 `null`（I-1 的「零计划」态）。 */
  getLatest(orgId: OrgId, threadId: string): Promise<PlanLedgerRow | null>;

  /** I-8：宿主 step 消失后仍可见的孤儿约束列表。 */
  listOrphanedConstraints(orgId: OrgId, threadId: string): Promise<OrphanedConstraintRow[]>;

  /**
   * UC-2 `ingestEnginePlanSnapshot` 的唯一写入点。永远被接受（I-6）：
   * `revision` 与 `engineEpoch` 都在上一版基础上 +1（线程从未有账本时视为 -1，即从 0 起）。
   * `origin='engine'` 的新行 `constraints` 恒为空数组（I-9，由调用方保证，见
   * `ingest-engine-plan-snapshot.ts` 的 use case）。
   */
  appendEngineSnapshot(input: {
    readonly orgId: OrgId;
    readonly threadId: string;
    readonly steps: PlanStep[];
  }): Promise<{ readonly revision: number; readonly engineEpoch: number }>;

  /**
   * F974 —— the four edit use cases (UC-3/4/5/6) all share this one write shape:
   * a new `origin='user'` revision, `engineEpoch` UNCHANGED (only engine writes bump it,
   * I-6), `basedOnRevision` carried from the caller's already-validated `PLAN_REVISION_CHANGED`
   * check. Takes an explicit `TenantSession` so the caller can run it inside the SAME
   * transaction as the audit write (`ProvenanceWriter.appendWithin`) -- I-13's fail-closed
   * audit requirement means "the ledger row exists but nobody can prove it was authorised"
   * must not be a reachable state, and that is only true if both writes commit atomically.
   */
  appendUserEditWithin(session: TenantSession, input: {
    readonly orgId: OrgId;
    readonly threadId: string;
    readonly basedOnRevision: number;
    readonly engineEpoch: number;
    readonly steps: PlanStep[];
    readonly createdBy: string;
  }): Promise<{ readonly revision: number }>;

  /** Same-transaction read, for the check-then-write the four edit use cases all need. */
  getLatestWithin(session: TenantSession, threadId: string): Promise<PlanLedgerRow | null>;

  /** UC-4 (I-8): a deleted step's constraints become orphans, in the SAME transaction. */
  insertOrphanedConstraintsWithin(session: TenantSession, input: {
    readonly orgId: OrgId;
    readonly threadId: string;
    readonly orphanedAtRevision: number;
    readonly formerStepContent: string;
    readonly constraints: ReadonlyArray<{ readonly constraintId: string; readonly text: string }>;
  }): Promise<void>;

  /** UC-6: removing an orphaned constraint is a real DELETE (I-8's "not silent" only covers
   * the step-deletion path; explicitly asking to remove one is the user's own undo). Returns
   * whether a row was actually deleted -- UC-6 treats "already gone" as a no-op success. */
  deleteOrphanedConstraintWithin(
    session: TenantSession, orgId: OrgId, threadId: string, constraintId: string,
  ): Promise<boolean>;
}

/**
 * `agent_runs` 的粗粒度读面——`PlanPhase` 派生（I-7）唯一需要的信号来源。
 * 不暴露 `agent_runs` 全部字段：本束只关心 (status, pendingToolName, createdAt)。
 */
export interface PlanRunStatusReader {
  /** 该线程「最近一条」run（若存在），按 `created_at DESC` 取第一条。 */
  getLatestRun(orgId: OrgId, threadId: string): Promise<PlanRunSnapshot | null>;

  /**
   * F976 —— P-2 探针的写入点。`execute-run.ts` 的 `ModelCallInput.onRemoteRunStarted`
   * 回调在远端 run 创建成功后立即调用它。可重复调用是安全的（同一 `runId` 幂等覆盖）。
   */
  recordRemoteRunId(orgId: OrgId, runId: string, remoteRunId: string): Promise<void>;

  /** UC-9 `pausePlanRun` 的落点：标记这条本地 run 行「已被暂停」，不改写 `status`。 */
  markRunPaused(orgId: OrgId, runId: string): Promise<void>;
}

export const PLAN_LEDGER_REPOSITORY = Symbol("PlanLedgerRepository");
export const PLAN_RUN_STATUS_READER = Symbol("PlanRunStatusReader");
