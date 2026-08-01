/**
 * 用例：编辑矩阵格（F26 / `uc-2-2` R7 / 契约 `updateMatrixCell`）。
 *
 * ⚠ 字段名写全 `agendaSegmentId`，禁止裸 `stage`（D-03a）。
 * ⚠ `roleKey` 必须 ∈ `ORCHESTRATION_ROLE_KEYS`（角色表派生，不硬编码，I-28）——
 *   未知值一律 `UNKNOWN_ROLE_KEY`，这道判断先于任何存储层调用。
 * ⚠ 「绑定」列（`canvasTemplateId` / `skillIds`）与 UC-3.2（`skills` 束）读写**同一份数据**
 *   （I-25）——本用例只负责把这次改动落到 `OrchestrationRepository`，不新建第二份存储。
 * ⚠ `syncedTaskIds` 恒为空数组——矩阵格 → 待办的同步是 **F27** 的交付物
 *   （`syncMatrixToTasks`，跨模块契约 I-23）。本用例不在这里提前实现它，给一个非空但
 *   虚构的返回只会制造「格子已同步」的假象；`TASK_SYNC_FAILED` 因此在本文件里也
 *   永不被抛出——F27 落地后若把同步接进来，才需要那个分支。
 */
import { templates } from "@repo/contracts";
import type { z } from "zod";
import { isOrchestrationRoleKey } from "../../domain/templates/workflow-orchestration";
import type { ProjectRole } from "../../domain/identity/roles";
import { canWriteOrchestration } from "./orchestration-write-guard";
import type { OrchestrationRepository } from "./workflow-orchestration-ports";

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

  // 见文件头：矩阵格 → 待办同步是 F27 的交付物，本用例恒返回空集。
  return { cellId: input.cellId, syncedTaskIds: [] };
}
