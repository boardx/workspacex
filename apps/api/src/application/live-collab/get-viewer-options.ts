/**
 * 用例：现场协作视角切换器的服务端权威数据源（phase-10 F02 / 契约
 * `liveCollabViewerRole.getViewerOptions`）。
 *
 * ⚠ **不是 `get-project-grouping.ts` 的重复实现**：那个用例服务筹备阶段
 * `tab-prep.tsx` 的全量分组视图（facilitator/groupLead/member 都看全部）；这里服务
 * `tab-live.tsx` 的角色收窄视角切换器（组长/组员只看本组、观察者不看任何一组）——
 * 两者可见性语义互斥，故各自一个用例、各自一条路由，仓储层复用同一个
 * `GroupingRepository`（读的是同一张 `groups` 表，只是投影规则不同）。
 *
 * `projectViewersForRole` 是这里唯一的判定逻辑：先把仓储的全量分组按角色收窄成
 * 「这个人能看的分组」，再包成『视角』选项列表（`stage` + 收窄后的分组）。
 * `viewer-role/domain.md` 不变量 2/3/4 都可以直接读这个函数的返回值断言。
 */
import type { ProjectRole } from "../../domain/identity/roles";
import type { OrgId } from "../../domain/org-id";
import type { GroupPatch } from "../../domain/templates/grouping";
import type { GroupingRepository } from "../templates/grouping-ports";

export type GetViewerOptionsErrorCode = "NO_PROJECT_ROLE" | "VIEWER_SCOPE_DENIED" | "DEPENDENCY_UNAVAILABLE";

export class GetViewerOptionsError extends Error {
  readonly reasonCode: GetViewerOptionsErrorCode;

  constructor(reasonCode: GetViewerOptionsErrorCode) {
    super(reasonCode);
    this.reasonCode = reasonCode;
    this.name = "GetViewerOptionsError";
  }
}

export type ViewerOption =
  | { readonly id: "stage"; readonly kind: "stage"; readonly label: string }
  | { readonly id: string; readonly kind: "group"; readonly label: string; readonly group: GroupPatch };

export interface GetViewerOptionsInput {
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly actorProjectRole: ProjectRole | null;
  /** 组长/组员当前所在组的 `groupId`；facilitator/observer 用不到，传 `null` 即可。 */
  readonly actorGroupId: string | null;
  /** 可选：调用方想切到的视角 id（`"stage"` 或某个 `groupId`）。 */
  readonly requestedViewerId?: string;
}

export interface GetViewerOptionsDeps {
  readonly repo: GroupingRepository;
}

const STAGE_OPTION: ViewerOption = { id: "stage", kind: "stage", label: "主持台·全场" };

/**
 * 按角色把全量分组收窄成「这个人能看的分组」——纯函数，可单测。
 * 见 `viewer-role/domain.md` 不变量 2/3/4。
 */
export function projectGroupsForRole(
  groups: readonly GroupPatch[],
  role: ProjectRole,
  actorGroupId: string | null,
): readonly GroupPatch[] {
  if (role === "facilitator") return groups;
  if (role === "observer") return [];
  if (actorGroupId === null) return [];
  return groups.filter((g) => g.groupId === actorGroupId);
}

/** 把收窄后的分组包成视角选项列表：facilitator/observer 恒带 `stage`，组长/组员不带。 */
export function toViewerOptions(role: ProjectRole, scopedGroups: readonly GroupPatch[]): readonly ViewerOption[] {
  const groupOptions: ViewerOption[] = scopedGroups.map((g) => ({ id: g.groupId, kind: "group", label: g.name, group: g }));
  if (role === "facilitator") return [STAGE_OPTION, ...groupOptions];
  if (role === "observer") return [STAGE_OPTION];
  return groupOptions;
}

/** 顶部提示条文案——服务端权威，不是前端字典写死（防止漏改，design-signoff.md 用例②要求）。 */
export function promptTextForRole(role: ProjectRole): string {
  switch (role) {
    case "facilitator":
      return "你有全部权限：可切换到任意分组或主持台·全场";
    case "observer":
      return "你只能查看主持台·全场的只读聚合，不进入任何分组";
    case "groupLead":
    case "member":
      return "你只能查看自己所在的分组";
  }
}

export async function getViewerOptionsUseCase(
  deps: GetViewerOptionsDeps,
  input: GetViewerOptionsInput,
): Promise<{ role: ProjectRole; viewers: readonly ViewerOption[]; promptText: string }> {
  if (input.actorProjectRole === null) throw new GetViewerOptionsError("NO_PROJECT_ROLE");

  let groups: readonly GroupPatch[];
  try {
    groups = (await deps.repo.getGrouping(input.orgId, input.projectId)).groups;
  } catch {
    throw new GetViewerOptionsError("DEPENDENCY_UNAVAILABLE");
  }

  const scoped = projectGroupsForRole(groups, input.actorProjectRole, input.actorGroupId);
  const viewers = toViewerOptions(input.actorProjectRole, scoped);

  if (input.requestedViewerId !== undefined && !viewers.some((v) => v.id === input.requestedViewerId)) {
    throw new GetViewerOptionsError("VIEWER_SCOPE_DENIED");
  }

  return { role: input.actorProjectRole, viewers, promptText: promptTextForRole(input.actorProjectRole) };
}
