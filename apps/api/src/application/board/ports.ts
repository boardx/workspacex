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
import type { TenantSession } from "../ports/database.port";

export interface TaskRow {
  readonly id: string;
  readonly orgId: string;
  readonly projectId: string | null;
  readonly status: TaskStatus;
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
}

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
