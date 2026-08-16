/**
 * 用例：分组读侧（F950，delta / 契约 `templates.getProjectGrouping`）。
 *
 * 同 `get-project-topic.ts` 的薄编排：角色门槛 → 仓储读。空数组是真实空态，仓储直接返回，
 * 这里不需要像定题那样合成默认值——`GroupingRepository.getGrouping` 的契约本来就承诺
 * 「`revision` 恒有值」，用例不用替它兜底。
 */
import type { ProjectRole } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import type { GroupingRepository, UpdatedGrouping } from "./grouping-ports";

export type GetProjectGroupingErrorCode = "NO_PROJECT_ROLE" | "DEPENDENCY_UNAVAILABLE";

export class GetProjectGroupingError extends Error {
  readonly reasonCode: GetProjectGroupingErrorCode;

  constructor(reasonCode: GetProjectGroupingErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "GetProjectGroupingError";
  }
}

export interface GetProjectGroupingInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly actorProjectRole: ProjectRole | null;
}

export interface GetProjectGroupingDeps {
  readonly repo: GroupingRepository;
}

export async function getProjectGroupingUseCase(
  deps: GetProjectGroupingDeps,
  input: GetProjectGroupingInput,
): Promise<UpdatedGrouping> {
  if (input.actorProjectRole === null) throw new GetProjectGroupingError("NO_PROJECT_ROLE");

  try {
    return await deps.repo.getGrouping(input.orgId, input.projectId);
  } catch {
    throw new GetProjectGroupingError("DEPENDENCY_UNAVAILABLE");
  }
}
