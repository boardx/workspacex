/**
 * 用例：分组编排（F25 / `uc-2-2` R8 / 契约 `templates.updateGrouping`）。
 *
 * 编排顺序：角色门槛 → 状态三值校验 → 组长必填校验 → 仓储 upsert（并发冲突翻译）。
 *
 * ⚠ 权限复用既有的项目角色矩阵（`project-role-matrix.ts`）里已经存在的 `agendaSegment.group`
 * 动作（矩阵头注「分组」，本次是它第一次被消费）——不新建一条平行判定。矩阵里只有
 * `facilitator` 持有这个动作，`groupLead`/`member`/`observer` 一律 `ROLE_INSUFFICIENT`。
 *
 * ⚠ `[AI 按背景均衡分组]` 的产出是**建议**——本用例收的是人确认后的最终分组（V8），
 *   AI 建议本身在应用层之外（前端/未来的 AI 编排层）产出，不经过这个门。
 */
import { roleAllows } from "../../domain/identity/project-role-matrix";
import type { ProjectRole } from "../../domain/identity/roles";
import {
  findGroupMissingLeader,
  findInvalidStatus,
  type GroupPatch,
} from "../../domain/templates/grouping";
import {
  GroupingRevisionConflictError,
  type GroupingRepository,
  type UpdatedGrouping,
} from "./grouping-ports";

export type UpdateGroupingErrorCode =
  | "NO_PROJECT_ROLE"
  | "ROLE_INSUFFICIENT"
  | "VERSION_CHANGED"
  | "INVALID_GROUP_STATUS"
  | "GROUP_LEADER_REQUIRED"
  | "DEPENDENCY_UNAVAILABLE";

export class UpdateGroupingError extends Error {
  readonly reasonCode: UpdateGroupingErrorCode;

  constructor(reasonCode: UpdateGroupingErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "UpdateGroupingError";
  }
}

/** 复用矩阵里已声明的 `agendaSegment.group`——不新造一条判定（见文件头注）。 */
export function canUpdateGrouping(role: ProjectRole | null): boolean {
  return role !== null && roleAllows(role, "agendaSegment.group");
}

export interface UpdateGroupingInput {
  readonly projectId: string;
  readonly actorProjectRole: ProjectRole | null;
  readonly groupCount: number | null;
  readonly groups: readonly GroupPatch[];
  readonly expectedRevision: string;
}

export interface UpdateGroupingDeps {
  readonly repo: GroupingRepository;
}

export async function updateGroupingUseCase(
  deps: UpdateGroupingDeps,
  input: UpdateGroupingInput,
): Promise<UpdatedGrouping> {
  if (input.actorProjectRole === null) throw new UpdateGroupingError("NO_PROJECT_ROLE");
  if (!canUpdateGrouping(input.actorProjectRole)) {
    throw new UpdateGroupingError("ROLE_INSUFFICIENT");
  }

  if (findInvalidStatus(input.groups) !== undefined) {
    throw new UpdateGroupingError("INVALID_GROUP_STATUS");
  }
  if (findGroupMissingLeader(input.groups) !== undefined) {
    throw new UpdateGroupingError("GROUP_LEADER_REQUIRED");
  }

  try {
    return await deps.repo.updateGrouping({
      projectId: input.projectId,
      groupCount: input.groupCount,
      groups: input.groups,
      expectedRevision: input.expectedRevision,
    });
  } catch (err) {
    if (err instanceof GroupingRevisionConflictError) {
      throw new UpdateGroupingError("VERSION_CHANGED");
    }
    throw new UpdateGroupingError("DEPENDENCY_UNAVAILABLE");
  }
}
