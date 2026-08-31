/**
 * Ports for the `board` 契约束 (F01) -- the `tasks` table and its dedicated status-change
 * audit trail. `TenantSession`-flavoured, same shape as `plan-control/ports.ts`, so the
 * status write and the audit write can be made to commit inside ONE transaction (see
 * `change-task-status.ts`).
 *
 * No existing audit table was reused here: `provenance_events` (F08) is scoped to
 * artifact/content provenance, and `tenant_isolation_audit` (F02) is a kernel self-check
 * table, not an application-level event log -- neither is a home for "who moved this card
 * from X to Y and why". A dedicated `task_status_audit` table is the honest fit.
 */
import type { OrgId } from "../../domain/org-id";
import type { TaskStatus } from "../../domain/board/task-status";
import type { SourceKind } from "../../domain/board/source-kind";
import type { RiskLevel } from "../../domain/board/risk-level";
import type { RawTaskRow } from "../../domain/board/card-render";
import type { ProjectRole } from "../../domain/identity/roles";
import type { TenantSession } from "../ports/database.port";

export interface TaskRow {
  readonly id: string;
  readonly orgId: string;
  readonly projectId: string | null;
  readonly status: TaskStatus;
  /** R5 write-path guard needs these to decide "is this actor allowed to touch this card"
   *  without a second round-trip -- see `board.controller.ts`'s `changeStatus`. */
  readonly ownerUserId: string | null;
  readonly executor: string | null;
}

export interface TaskRepository {
  /** Same-transaction read, for the check-then-write `changeTaskStatus` needs. */
  getByIdWithin(session: TenantSession, taskId: string): Promise<TaskRow | null>;

  /** Same-transaction write. Assumes the caller already ran `decideTransition`. */
  updateStatusWithin(
    session: TenantSession,
    taskId: string,
    status: TaskStatus,
  ): Promise<void>;

  /** F02 -- manual creation (uc-11-1 R3.5). Returns the created row's id. */
  createWithin(
    session: TenantSession,
    input: {
      readonly id: string;
      readonly orgId: OrgId;
      readonly projectId: string | null;
      readonly title: string;
      readonly status: TaskStatus;
      readonly sourceKind: SourceKind;
      readonly ownerUserId: string;
      readonly executor: string | null;
      readonly dueAt: string | null;
      readonly riskLevel: RiskLevel | null;
      readonly waitingOn: string | null;
    },
  ): Promise<void>;

  /**
   * F02 -- one query, three consumers (project view / global view / my-today), so the
   * "三处计数必须来自同一次查询" and "本视图与看板读同一份数据" contracts (uc-11-1 R7,
   * uc-11-5 AC4) are structural rather than a discipline three call sites have to keep in
   * sync by hand.
   *
   * `visibility` implements R5 at the repository layer (not filtered client-side, and not
   * bolted on after a broader query): a facilitator gets every row in the project(s) named
   * by `projectIds`; a groupLead/member gets only rows they own/execute, or whose owner
   * shares their project group (see `pg-task-repository.ts` for the exact join -- this is
   * the one place that rule is expressed).
   */
  listVisibleWithin(
    session: TenantSession,
    input: {
      readonly orgId: OrgId;
      readonly userId: string;
      /** null = every project the user can see (used by "我的今天"'s cross-project aggregation). */
      readonly projectIds: readonly string[] | null;
      readonly role: ProjectRole | "org-wide-admin";
      readonly groupId: string | null;
    },
  ): Promise<readonly RawTaskRow[]>;

  /** Marks a task's writeback outcome (uc-11-1 R3.3/R7 -- "未同步" must be visible, not swallowed). */
  updateSyncStatusWithin(
    session: TenantSession,
    taskId: string,
    syncStatus: "synced" | "out_of_sync",
  ): Promise<void>;
}

export const TASK_REPOSITORY = Symbol("TaskRepository");
export const TASK_STATUS_AUDIT_WRITER = Symbol("TaskStatusAuditWriter");

export interface TaskStatusAuditWriter {
  /** Records one status change. Only called for transitions O-27 required a reason for. */
  appendWithin(
    session: TenantSession,
    input: {
      readonly orgId: OrgId;
      readonly taskId: string;
      readonly actorId: string;
      readonly fromStatus: TaskStatus;
      readonly toStatus: TaskStatus;
      readonly reason: string;
    },
  ): Promise<string>;
}
