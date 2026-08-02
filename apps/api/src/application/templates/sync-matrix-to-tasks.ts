/**
 * 用例：矩阵格 → 待办同步（F27 / `uc-2-2` R10 / 契约 `syncMatrixToTasks`，跨模块契约）。
 *
 * ⚠ 幂等由 `MatrixTaskPublisherPort.upsertForCell` 的键控 upsert 保证（见该端口文档），
 *   本用例不自己维护「已同步过哪些 cellId」的第二份记账——那会是与发布端口存量
 *   不一致的第二份事实源。
 * ⚠ 负责人解析失败（`assignees.assigneeOf` 返回 `null`）或任一发布/移除调用失败，
 *   本用例整体抛 `TASK_SYNC_FAILED`（契约 `syncMatrixToTasks.err` 没有逐格失败清单
 *   ——不同于 F64 `generateRoleTodos` 的 `failed: RoleCellRef[]` 形状，这里的契约
 *   出参只有 `created/updated/removed` 三个数组，没有第四个「失败」数组）。
 *   ⚠ **[本用例做的判断，非契约裁决]** 由于 `upsertForCell` 是幂等的键控 upsert，
 *   「整体失败后重试」不会把已成功的那些格子重复同步一遍——重试是安全的，这也是
 *   为什么本用例选择「一格失败即整批报错」而不是尽力而为地吞掉失败：吞掉会让
 *   `TASK_SYNC_FAILED` 永不出现，界面就没有「重试」这个动作可挂。已在 F27 的
 *   PR/issue 收尾评论里报告，供人类复核（是否要改成局部成功 + 显式失败清单，
 *   属契约修订，不是本用例能单方面做的事）。
 */
import { planMatrixTaskSync } from "../../domain/templates/matrix-task-sync";
import type {
  MatrixRoleAssigneePort,
  MatrixTaskPublisherPort,
  OrchestrationRepository,
} from "./workflow-orchestration-ports";

export interface SyncMatrixToTasksInput {
  readonly projectId: string;
  readonly cellIds: readonly string[];
}

export interface SyncMatrixToTasksDeps {
  readonly orchestrations: OrchestrationRepository;
  readonly assignees: MatrixRoleAssigneePort;
  readonly tasks: MatrixTaskPublisherPort;
}

export interface SyncMatrixToTasksOutput {
  readonly created: readonly string[];
  readonly updated: readonly string[];
  readonly removed: readonly string[];
}

export type SyncMatrixToTasksErrorCode = "TASK_SYNC_FAILED" | "DEPENDENCY_UNAVAILABLE";

export class SyncMatrixToTasksError extends Error {
  readonly reasonCode: SyncMatrixToTasksErrorCode;
  constructor(reasonCode: SyncMatrixToTasksErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "SyncMatrixToTasksError";
  }
}

export async function syncMatrixToTasks(
  deps: SyncMatrixToTasksDeps,
  input: SyncMatrixToTasksInput,
): Promise<SyncMatrixToTasksOutput> {
  let snapshot;
  try {
    snapshot = await deps.orchestrations.load(input.projectId);
  } catch {
    throw new SyncMatrixToTasksError("DEPENDENCY_UNAVAILABLE");
  }
  if (snapshot === null) {
    throw new SyncMatrixToTasksError("DEPENDENCY_UNAVAILABLE");
  }

  const plan = planMatrixTaskSync(snapshot.matrix, input.cellIds);

  const created: string[] = [];
  const updated: string[] = [];
  const removed: string[] = [];

  for (const item of plan.toUpsert) {
    const assignee = await deps.assignees.assigneeOf({
      projectId: input.projectId,
      agendaSegmentId: item.agendaSegmentId,
      roleKey: item.roleKey,
    });
    // D-39：找不到人接这一格，不得让 agent 顶替成负责人——整批报 TASK_SYNC_FAILED，
    // 见文件头「负责人解析失败」一节。
    if (assignee === null) {
      throw new SyncMatrixToTasksError("TASK_SYNC_FAILED");
    }

    let result:
      | { readonly ok: true; readonly todoId: string; readonly created: boolean }
      | { readonly ok: false };
    try {
      result = await deps.tasks.upsertForCell({
        projectId: input.projectId,
        cellId: item.cellId,
        agendaSegmentId: item.agendaSegmentId,
        roleKey: item.roleKey,
        content: item.content,
        assigneePrincipalId: assignee.principalId,
        executorAgentId: item.executorAgentId,
      });
    } catch {
      result = { ok: false };
    }
    if (!result.ok) {
      throw new SyncMatrixToTasksError("TASK_SYNC_FAILED");
    }
    // 端口如实回传「这次是新建还是命中已有卡」，本用例只是按此分流——
    // 这就是「重复触发同步不产生重复卡」在 created/updated 两个数组上的可断言形式：
    // 第二次对同一 cellId 调用，端口应回 `created: false`，此格落进 updated 而不是
    // 再进 created 一次。
    if (result.created) {
      created.push(result.todoId);
    } else {
      updated.push(result.todoId);
    }
  }

  for (const cellId of plan.toRemove) {
    let result: { readonly ok: true; readonly removed: boolean } | { readonly ok: false };
    try {
      result = await deps.tasks.removeForCell(input.projectId, cellId);
    } catch {
      result = { ok: false };
    }
    if (!result.ok) {
      throw new SyncMatrixToTasksError("TASK_SYNC_FAILED");
    }
    if (result.removed) {
      removed.push(cellId);
    }
  }

  return { created, updated, removed };
}
