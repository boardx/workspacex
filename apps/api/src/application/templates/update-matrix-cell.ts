/**
 * 用例：编辑矩阵格（F26 / `uc-2-2` R7 / 契约 `updateMatrixCell`）。
 *
 * ⚠ 字段名写全 `agendaSegmentId`，禁止裸 `stage`（D-03a）。
 * ⚠ `roleKey` 必须 ∈ `ORCHESTRATION_ROLE_KEYS`（角色表派生，不硬编码，I-28）——
 *   未知值一律 `UNKNOWN_ROLE_KEY`，这道判断先于任何存储层调用。
 * ⚠ 「绑定」列（`canvasTemplateId` / `skillIds`）与 UC-3.2（`skills` 束）读写**同一份数据**
 *   （I-25）——本用例只负责把这次改动落到 `OrchestrationRepository`，不新建第二份存储。
 * ⚠ `syncedTaskIds`（F27 接入后）—— `deps.taskSync` 未提供时仍恒为空数组，行为不变
 *   （向后兼容尚未接线的调用方/测试）；提供时调用 `syncMatrixToTasks` 只同步**这一格**
 *   （`cellIds: [input.cellId]`），成功后把 `created`/`updated` 汇总进 `syncedTaskIds`。
 *   `TASK_SYNC_FAILED` 在提供了 `taskSync` 时会真的被抛出（同步失败必须可见并可重试，
 *   见 `syncMatrixToTasks` 契约头注 E3），未提供时这条分支仍不可达。
 */
import { templates } from "@repo/contracts";
import type { z } from "zod";
import { isOrchestrationRoleKey } from "../../domain/templates/workflow-orchestration";
import type { ProjectRole } from "../../domain/identity/roles";
import { canWriteOrchestration } from "./orchestration-write-guard";
import { syncMatrixToTasks, SyncMatrixToTasksError } from "./sync-matrix-to-tasks";
import type {
  MatrixRoleAssigneePort,
  MatrixTaskPublisherPort,
  OrchestrationRepository,
} from "./workflow-orchestration-ports";

export type UpdateMatrixCellOutput = z.infer<typeof templates.operations.updateMatrixCell.out>;
export type UpdateMatrixCellErrorCode = z.infer<typeof templates.TemplateError>;

export class UpdateMatrixCellError extends Error {
  readonly reasonCode: UpdateMatrixCellErrorCode;
  constructor(reasonCode: UpdateMatrixCellErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "UpdateMatrixCellError";
  }
}

export interface UpdateMatrixCellInput {
  readonly projectId: string;
  readonly cellId: string;
  readonly agendaSegmentId: string;
  readonly roleKey: string;
  readonly content: string;
  readonly canvasTemplateId: string | null;
  readonly skillIds: readonly string[];
  readonly expectedRevision: string;
  readonly actorProjectRole: ProjectRole | null;
}

export interface UpdateMatrixCellDeps {
  readonly orchestrations: OrchestrationRepository;
  /**
   * F27 接线点。⚠ **可选**——未提供时保持 F26 落地时的既有行为
   * （`syncedTaskIds` 恒为空数组，`TASK_SYNC_FAILED` 不可达），不强迫尚未接线的
   * 调用方（例如既有测试）一起改。
   */
  readonly taskSync?: {
    readonly assignees: MatrixRoleAssigneePort;
    readonly tasks: MatrixTaskPublisherPort;
  };
}

export async function updateMatrixCell(
  deps: UpdateMatrixCellDeps,
  input: UpdateMatrixCellInput,
): Promise<UpdateMatrixCellOutput> {
  if (!canWriteOrchestration(input.actorProjectRole)) {
    throw new UpdateMatrixCellError(
      input.actorProjectRole === null ? "NO_PROJECT_ROLE" : "ROLE_INSUFFICIENT",
    );
  }

  if (!isOrchestrationRoleKey(input.roleKey)) {
    throw new UpdateMatrixCellError("UNKNOWN_ROLE_KEY");
  }

  const result = await deps.orchestrations.upsertCell(
    input.projectId,
    {
      cellId: input.cellId,
      agendaSegmentId: input.agendaSegmentId,
      roleKey: input.roleKey,
      content: input.content,
      canvasTemplateId: input.canvasTemplateId,
      skillIds: [...input.skillIds],
    },
    input.expectedRevision,
  );

  if (!result.ok) throw new UpdateMatrixCellError("VERSION_CHANGED");

  // 见文件头：`deps.taskSync` 未提供时保持 F26 落地时的既有行为。
  if (deps.taskSync === undefined) {
    return { cellId: input.cellId, syncedTaskIds: [] };
  }

  let syncResult;
  try {
    syncResult = await syncMatrixToTasks(
      { orchestrations: deps.orchestrations, ...deps.taskSync },
      { projectId: input.projectId, cellIds: [input.cellId] },
    );
  } catch (e) {
    if (e instanceof SyncMatrixToTasksError) {
      throw new UpdateMatrixCellError(e.reasonCode);
    }
    throw e;
  }

  return {
    cellId: input.cellId,
    syncedTaskIds: [...syncResult.created, ...syncResult.updated],
  };
}
