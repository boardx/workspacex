/**
 * 用例：分组读侧（F950，delta / 契约 `templates.getProjectGrouping`）。
 *
 * 同 `get-project-topic.ts` 的薄编排：角色门槛 → 仓储读。空数组是真实空态，仓储直接返回，
 * 这里不需要像定题那样合成默认值——`GroupingRepository.getGrouping` 的契约本来就承诺
 * 「`revision` 恒有值」，用例不用替它兜底。
 *
 * ⚠ **这个用例服务两个不同的 UI 场景，两者的可见性语义不一样，不要在这里加角色投影**
 * （phase-10 F02 调研时曾经在这个文件里加过一版按角色收窄 `groups` 的实现，
 * 因为下面这条冲突被撤回）：
 *   - `apps/web/components/project/tab-prep.tsx`（F950，筹备阶段）的 `GroupingBlock`——
 *     facilitator / groupLead / member **看到的是全量分组名单**（组长/组员/场景），
 *     这是被明确设计成的「内部协作视图」（该文件头注释原话），只有 observer 被前端
 *     整块隐藏；这不是漏洞，是筹备阶段需要互相知道全场怎么分的组。
 *   - `apps/web/components/project/tab-live.tsx`（phase-10 F01，现场协作视角切换器）
 *     **需要角色收窄**——组长/组员只能看自己那组，观察者不看任何一组
 *     （`viewer-role/domain.md` 不变量 2/3/4）。
 * 两个场景共用同一个契约 `getProjectGrouping` 但可见性规则互斥，在这一个用例里加
 * 「按角色过滤」会把筹备阶段的合法全量视图也一起削掉。真正的服务端强制面见
 * `get-viewer-options.ts`（phase-10 F02 新增，`tab-live.tsx` 专用的独立只读端点）。
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
