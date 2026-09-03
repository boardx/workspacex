/**
 * `changeTaskStatus` -- the one write path for a task card's status (F01).
 *
 * Judges with `decideTransition` (pure, domain layer), then -- only if allowed -- writes
 * the new status and, for a backward move, an audit row, inside ONE transaction. A
 * transition that O-27 required a reason for but that fails to write the audit row must
 * not leave the status changed either; that is why both writes share `db.withTenant`
 * rather than running as two independent statements.
 *
 * Deliberately has no REST controller and no wiring into `apps/web` -- F01's notes say
 * explicitly this is "纯 API/状态机断言，不锚 UI"; a route and a UI are F02+'s job.
 */
import { decideTransition, type TransitionOptions } from "../../domain/board/transition-matrix";
import type { TaskStatus } from "../../domain/board/task-status";
import type { DatabasePort } from "../ports/database.port";
import type { TaskRepository, TaskStatusAuditWriter } from "./ports";
import { IllegalTransitionError, TaskNotFoundError } from "./errors";
import type { OrgId } from "../../domain/org-id";

export interface ChangeTaskStatusDeps {
  readonly db: DatabasePort;
  readonly tasks: TaskRepository;
  readonly audit: TaskStatusAuditWriter;
}

export interface ChangeTaskStatusInput {
  readonly orgId: OrgId;
  readonly taskId: string;
  readonly actorId: string;
  readonly toStatus: string;
  /** Required for a backward move (O-27 rule 2); ignored (not persisted) for a forward one. */
  readonly reason?: string | null;
  /**
   * `false` when the caller is dragging a card from a `scope: "global"` cross-project view.
   * Defaults to `true` (an ordinary single-project board action).
   */
  readonly sameProjectScope?: boolean;
}

export interface ChangeTaskStatusOutput {
  readonly fromStatus: TaskStatus;
  readonly toStatus: TaskStatus;
  /** Present only when the move was a backward move (an audit row was written). */
  readonly auditEventId: string | null;
}

export async function changeTaskStatus(
  deps: ChangeTaskStatusDeps,
  input: ChangeTaskStatusInput,
): Promise<ChangeTaskStatusOutput> {
  const opts: TransitionOptions = { sameProjectScope: input.sameProjectScope ?? true };

  return deps.db.withTenant(input.orgId, async (session) => {
    const task = await deps.tasks.getByIdWithin(session, input.taskId);
    if (task === null) throw new TaskNotFoundError(input.taskId);

    const decision = decideTransition(task.status, input.toStatus, input.reason, opts);
    if (!decision.allowed) {
      throw new IllegalTransitionError(decision.reasonCode, task.status, input.toStatus);
    }

    // `decideTransition` already proved `input.toStatus` is a declared TaskStatus.
    const toStatus = input.toStatus as TaskStatus;

    await deps.tasks.updateStatusWithin(session, input.taskId, toStatus);

    // A reason was supplied (and non-blank) exactly when O-27 required one, i.e. exactly
    // for the backward moves this function is asked to make auditable.
    const reason = input.reason?.trim() ?? "";
    let auditEventId: string | null = null;
    if (reason !== "") {
      auditEventId = await deps.audit.appendWithin(session, {
        orgId: input.orgId,
        taskId: input.taskId,
        actorId: input.actorId,
        fromStatus: task.status,
        toStatus,
        reason,
      });
    }

    return { fromStatus: task.status, toStatus, auditEventId };
  });
}
