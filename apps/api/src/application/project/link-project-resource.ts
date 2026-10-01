/**
 * 项目中枢 B2-S1（#4425）`linkProjectResource` —— 把自己的问卷 / 深度研究 / 个人转写（#4615 起 + 访谈 / 白板 / 设计）挂到项目上。
 *
 * 两道门，顺序固定：① 项目成员（同 `listProjectResources`，观察者也算）；② 资源存在**且**
 * 是调用者自己的——「不存在」与「不是你的」同一个 `RESOURCE_NOT_FOUND`，不泄露别人资源的存在性。
 * 先判项目再判资源：不是项目成员的人连「这个 id 是不是资源」都不该探得到。
 *
 * 幂等：已经挂在这个项目上 ⇒ `alreadyLinked: true`，不是错误。
 *
 * B3-T1（#4495）：挂载成功后（含 alreadyLinked——再挂一次也许就是想让新答卷进来）顺带把这一类资源采成证据
 * 单元，外加访谈（访谈没有自己的挂载动作）。采集拿的是第 ① 道门的判定；失败只记日志、不影响挂载结果。
 */
import type { OrgId } from "../../domain/org-id";
import { collectProjectEvidence, LINKABLE_KIND_TO_EVIDENCE } from "./collect-project-evidence";
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
  const decision = await authorizeProjectResourceAccess(deps, input);

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

  if (deps.evidence !== undefined) {
    // #4615：设计第一版只挂载不采证据（`LINKABLE_KIND_TO_EVIDENCE.design = null`），访谈照旧顺带采。
    const own = LINKABLE_KIND_TO_EVIDENCE[input.kind];
    try {
      await collectProjectEvidence(deps.evidence, {
        orgId: input.orgId,
        projectId: input.projectId,
        decision,
        kinds: own === null ? ["interview_segment"] : [own, "interview_segment"],
      });
    } catch (err) {
      deps.logger?.error("project evidence collect failed after link", {
        traceId: "project-evidence", orgId: input.orgId, projectId: input.projectId, kind: input.kind, resourceId: input.resourceId, err,
      });
    }
  }

  return {
    projectId: input.projectId,
    kind: input.kind,
    resourceId: input.resourceId,
    alreadyLinked: outcome.kind === "already-linked",
  };
}
