/**
 * 项目中枢 B2-S1（#4425）`unlinkProjectResource` —— 把自己的资源从项目上解挂。
 *
 * 门与 `linkProjectResource` 完全同一套（项目成员 + 资源是自己的），只是落库动作反过来。
 * 解挂后资源仍在，只是回到「不属于任何项目」——链接表是唯一被动的地方。
 * `removed: false` = 门都过了、但它本来就没挂在这个项目上（不是错误，是幂等的另一半）。
 */
import type { OrgId } from "../../domain/org-id";
import { ProjectError } from "./errors";
import { authorizeProjectResourceAccess, type ProjectResourceDeps } from "./list-project-resources";
import type { ProjectLinkableResourceKind } from "./project-resource-ports";

export interface UnlinkProjectResourceInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly kind: ProjectLinkableResourceKind;
  readonly resourceId: string;
}

export async function unlinkProjectResource(
  deps: ProjectResourceDeps,
  input: UnlinkProjectResourceInput,
): Promise<{ readonly removed: boolean }> {
  await authorizeProjectResourceAccess(deps, input);

  const owned = await deps.resources.isOwnedResource(input.orgId, input.kind, input.resourceId, input.userId);
  if (!owned) throw new ProjectError("RESOURCE_NOT_FOUND");

  const removed = await deps.resources.unlinkResource(input.orgId, input.projectId, input.kind, input.resourceId);
  return { removed };
}
