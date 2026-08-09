/**
 * `updateOrganization`（#363 delta）—— 组织资料编辑（名称/简介/头像提交），
 * **仅组织 admin**（delta §2，与 `mutateTeam` 先例一致）。
 *
 * ⚠ 简介纯文本（delta §4②裁决）：这里不做任何 markdown/HTML 处理，存什么是什么。
 */
import { OrgAdminError } from "./org-invite-errors";
import type { OrgId } from "../../domain/org-id";
import type { OrgProfile, OrgProfileRepository, UpdateOrganizationInput } from "./org-profile-ports";

export interface UpdateOrganizationDeps {
  readonly repo: OrgProfileRepository;
}

export interface UpdateOrganizationUseCaseInput extends UpdateOrganizationInput {
  readonly orgId: OrgId;
  readonly actorOrgRole: string;
}

export async function updateOrganization(
  deps: UpdateOrganizationDeps,
  input: UpdateOrganizationUseCaseInput,
): Promise<OrgProfile> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");

  const result = await deps.repo.updateOrganization(input.orgId, {
    name: input.name,
    description: input.description,
    avatarArtifactId: input.avatarArtifactId,
  });
  if (!result.ok) throw new OrgAdminError("AVATAR_ARTIFACT_NOT_OWNED");
  return result.profile;
}
