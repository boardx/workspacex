/**
 * F02 -- wraps F01's `changeTaskStatus` with the writeback step (uc-11-1 R3.3/R7).
 *
 * Deliberately does NOT put the writeback call inside `changeTaskStatus`'s own
 * transaction: `changeTaskStatus` is F01's tested unit and its contract ("judge, then
 * write status + audit, all inside one `db.withTenant`") stays byte-for-byte what F01
 * shipped. The writeback is a SEPARATE step, run after the status commit, because the
 * source object being written back to (once F03 builds real adapters) lives outside this
 * database transaction entirely -- an external call cannot honestly participate in a
 * local ACID transaction. On failure, this function persists `sync_status = 'out_of_sync'`
 * in its own follow-up write (`updateSyncStatusWithin`) rather than rolling the status
 * change back -- rolling back would contradict the very rule it exists to serve ("看板侧
 * 的 status 与来源侧不一致的窗口期必须对用户可见，不得呈现为成功" -- the status DID
 * change on the board; what failed is the mirror, and that has to be visible, not undone).
 */
import { changeTaskStatus, type ChangeTaskStatusDeps, type ChangeTaskStatusInput, type ChangeTaskStatusOutput } from "./change-task-status";
import type { TaskRepository } from "./ports";
import type { WritebackPort } from "./writeback-port";
import type { SourceKind } from "../../domain/board/source-kind";
import type { DatabasePort } from "../ports/database.port";

export interface ChangeTaskStatusWithWritebackDeps extends ChangeTaskStatusDeps {
  readonly db: DatabasePort;
  readonly tasks: TaskRepository;
  readonly writeback: WritebackPort;
}

export interface ChangeTaskStatusWithWritebackOutput extends ChangeTaskStatusOutput {
  readonly syncStatus: "synced" | "out_of_sync";
  readonly writebackFailureReason: string | null;
}

export async function changeTaskStatusWithWriteback(
  deps: ChangeTaskStatusWithWritebackDeps,
  input: ChangeTaskStatusInput & { readonly sourceKind: SourceKind },
): Promise<ChangeTaskStatusWithWritebackOutput> {
  const result = await changeTaskStatus(deps, input);

  const writebackOutcome = await deps.writeback.writeback({
    taskId: input.taskId,
    sourceKind: input.sourceKind,
    fromStatus: result.fromStatus,
    toStatus: result.toStatus,
  });

  const syncStatus: "synced" | "out_of_sync" = writebackOutcome.ok ? "synced" : "out_of_sync";
  // Persisted regardless of ok/not -- a card that WAS out_of_sync and just got a
  // successful retry must flip back to 'synced', not stay stuck.
  await deps.db.withTenant(input.orgId, (session) => deps.tasks.updateSyncStatusWithin(session, input.taskId, syncStatus));

  return {
    ...result,
    syncStatus,
    writebackFailureReason: writebackOutcome.ok ? null : writebackOutcome.reason,
  };
}
