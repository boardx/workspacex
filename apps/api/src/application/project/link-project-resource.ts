/**
 * 项目中枢 B2-S1（#4425）`linkProjectResource` —— 把自己的问卷 / 深度研究 / 个人转写挂到项目上。
 *
 * 两道门，顺序固定：① 项目成员（同 `listProjectResources`，观察者也算）；② 资源存在**且**
 * 是调用者自己的——「不存在」与「不是你的」同一个 `RESOURCE_NOT_FOUND`，不泄露别人资源的存在性。
 * 先判项目再判资源：不是项目成员的人连「这个 id 是不是资源」都不该探得到。
 *
 * 幂等：已经挂在这个项目上 ⇒ `alreadyLinked: true`，不是错误。
 */
import type { OrgId } from "../../domain/org-id";
import { ProjectError } from "./errors";
import { authorizeProjectResourceAccess, type ProjectResourceDeps } from "./list-project-resources";
import type { ProjectLinkableResourceKind } from "./project-resource-ports";

export interface LinkProjectResourceInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly kind: ProjectLinkableResourceKind;
  readonly resourceId: string;
}

export interface LinkProjectResourceOutput {
  readonly projectId: string;
  readonly kind: ProjectLinkableResourceKind;
  readonly resourceId: string;
  readonly alreadyLinked: boolean;
}

export async function linkProjectResource(
  deps: ProjectResourceDeps,
  input: LinkProjectResourceInput,
): Promise<LinkProjectResourceOutput> {
  await authorizeProjectResourceAccess(deps, input);

  const owned = await deps.resources.isOwnedResource(input.orgId, input.kind, input.resourceId, input.userId);
  if (!owned) throw new ProjectError("RESOURCE_NOT_FOUND");

  const outcome = await deps.resources.linkResource({
    orgId: input.orgId,
    projectId: input.projectId,
    kind: input.kind,
    resourceId: input.resourceId,
    linkedBy: input.userId,
  });
  // 容器不存在：与「没有角色」不可分辨（同 `get-project-overview.ts` 的 snapshot === null）。
  if (outcome.kind === "project-not-found") throw new ProjectError("NO_PROJECT_ROLE");

  return {
    projectId: input.projectId,
    kind: input.kind,
    resourceId: input.resourceId,
    alreadyLinked: outcome.kind === "already-linked",
  };
}
