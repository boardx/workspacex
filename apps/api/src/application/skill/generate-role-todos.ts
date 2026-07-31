/**
 * R3 步骤 5：编排矩阵的每一个非空角色格 → 恰一条待办（F64；I-16 / D-39）。
 *
 * 依据：契约 `generateRoleTodos`；`contracts/skills/usecases.md` 「角色格 → 待办（跨束边）」；
 *       domain.md I-16「计数断言 count(非空格) = count(生成的待办)；断言无 assignee 为 agent 的行」。
 *
 * ⚠ **同步失败不是这个用例的失败**。`usecases.md` 逐字：「同步失败编排仍保存成功，
 *   但必须返回 failed 让界面显示『N 条待办未同步』并可重试」——`failed` 是成功响应
 *   的一部分，不是 `TODO_SYNC_FAILED` 错误码的替代品。这里只有编排本身找不到时才
 *   整体失败（`DEPENDENCY_UNAVAILABLE`）。
 */
import { executorAgentIdFor, nonEmptyRoleCells } from "../../domain/skill/orchestration";
import type { SkillErrorCode } from "../../domain/skill/declarative-contract";
import type {
  ProjectOrchestrationStorePort,
  RoleAssigneePort,
  TodoPublisherPort,
} from "./ports";

export interface GenerateRoleTodosInput {
  readonly projectId: string;
}

export interface RoleCellRef {
  readonly agendaSegmentId: string;
  readonly roleKey: string;
}

export type GenerateRoleTodosResult =
  | {
      readonly ok: true;
      /** 契约 `out.created`：本次成功同步的待办 id 列表。 */
      readonly created: readonly string[];
      /** 契约 `out.failed`：同步失败的格子，E4/V12——**不是错误码的替代品**。 */
      readonly failed: readonly RoleCellRef[];
    }
  | { readonly ok: false; readonly code: SkillErrorCode; readonly reason: string };

export interface GenerateRoleTodosDeps {
  readonly orchestrations: ProjectOrchestrationStorePort;
  readonly assignees: RoleAssigneePort;
  readonly todos: TodoPublisherPort;
}

export async function generateRoleTodos(
  input: GenerateRoleTodosInput,
  deps: GenerateRoleTodosDeps,
): Promise<GenerateRoleTodosResult> {
  const orchestration = await deps.orchestrations.load(input.projectId);
  if (orchestration === null) {
    return { ok: false, code: "DEPENDENCY_UNAVAILABLE", reason: "该项目尚无编排，无法生成待办" };
  }

  const cells = nonEmptyRoleCells(orchestration);
  const created: string[] = [];
  const failed: RoleCellRef[] = [];

  for (const cell of cells) {
    const assignee = await deps.assignees.assigneeOf({
      projectId: input.projectId,
      agendaSegmentId: cell.agendaSegmentId,
      role: cell.role,
    });
    if (assignee === null) {
      // 找不到人接这个角色：这条待办没法生成，计入 failed 而不是让整批中断（同 E4 口径）。
      failed.push({ agendaSegmentId: cell.agendaSegmentId, roleKey: cell.role });
      continue;
    }
    const executorAgentId = executorAgentIdFor(orchestration, cell);
    let result: { readonly ok: true; readonly todoId: string } | { readonly ok: false };
    try {
      result = await deps.todos.publish({
        agendaSegmentId: cell.agendaSegmentId,
        role: cell.role,
        text: cell.text,
        assigneePrincipalId: assignee.principalId,
        executorAgentId,
      });
    } catch {
      result = { ok: false };
    }
    if (result.ok) {
      created.push(result.todoId);
    } else {
      failed.push({ agendaSegmentId: cell.agendaSegmentId, roleKey: cell.role });
    }
  }

  return { ok: true, created, failed };
}
