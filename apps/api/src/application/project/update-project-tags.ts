/**
 * `updateProjectTags` —— 2026-08-16（F185，delta）新增。
 *
 * 与 `archive-project.ts` 同一条权限线：复用 `canCreateProject`（2026-08-06 由人类
 * 裁决放宽为「`lead` 或 `admin`」，#608），不新造一个 `canEditProjectTags` 判据——
 * 打标签是「管理」这个大权限里的一小块，不是独立能力。
 *
 * ⚠ 整体替换语义：调用方传入的 `tags` 就是替换后的全集，不是增量 add/remove
 *   （同 F180 `updatePersonalTranscriptionMetadata` 的 `tags` 形状）。
 */
import type { OrgId } from "../../domain/org-id";
import { canCreateProject } from "../../domain/project/create-project-rules";
import type { IdentityRepository } from "../identity/ports";
import { ProjectError } from "./errors";
import type { ProjectTagsRepository } from "./ports";

export interface UpdateProjectTagsDeps {
  readonly repo: ProjectTagsRepository;
  readonly identity: IdentityRepository;
}

export interface UpdateProjectTagsInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly projectId: string;
  readonly tags: readonly string[];
}

export interface UpdateProjectTagsOutput {
  readonly id: string;
  readonly tags: readonly string[];
}

export async function updateProjectTags(
  deps: UpdateProjectTagsDeps,
  input: UpdateProjectTagsInput,
): Promise<UpdateProjectTagsOutput> {
  let orgRole: Awaited<ReturnType<IdentityRepository["findOrgMembership"]>>;
  try {
    orgRole = await deps.identity.findOrgMembership(input.actorId, input.orgId);
  } catch {
    // ⚠ 判定服务不可用**一律拒绝，不得降级放行**（同 `archive-project.ts` / `create-project.ts`）。
    throw new ProjectError("AUTH_SERVICE_UNAVAILABLE");
  }

  if (!canCreateProject(orgRole?.orgRole ?? null)) {
    throw new ProjectError("ORG_ROLE_INSUFFICIENT");
  }

  const outcome = await deps.repo.updateTags(input.orgId, input.projectId, input.tags);
  switch (outcome.kind) {
    case "updated":
      return { id: outcome.projectId, tags: outcome.tags };
    case "not-found":
      throw new ProjectError("PROJECT_NOT_FOUND");
  }
}
