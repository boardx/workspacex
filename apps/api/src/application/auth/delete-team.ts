/**
 * `deleteTeam`（team-crud delta #639，迭代 2）—— 复用 `TeamRepository.delete`
 * （F11 的占用校验：非空一律阻断、不级联清空成员归属，delta §4②与 F11 是同一条决定）。
 * 只在这一层把结果码翻译成本操作签核的专属码：`in-use → TEAM_NOT_EMPTY`，
 * `not-found → TEAM_NOT_FOUND`（旧 `mutateTeam` 把 not-found 映射到 `VERSION_CHANGED`，
 * 是那条操作没有专属码时的权宜；这条操作签了专属码，直接用）。
 */
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { TeamRepository } from "./team-ports";

export interface DeleteTeamDeps {
  readonly repo: TeamRepository;
}

export interface DeleteTeamInput {
  readonly orgId: OrgId;
  readonly actorOrgRole: string;
  readonly teamId: string;
}

export async function deleteTeam(deps: DeleteTeamDeps, input: DeleteTeamInput): Promise<{ deleted: true }> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("FORBIDDEN");

  const result = await deps.repo.delete(input.orgId, input.teamId);
  if (!result.ok) {
    throw new OrgAdminError(result.reason === "in-use" ? "TEAM_NOT_EMPTY" : "TEAM_NOT_FOUND");
  }
  return { deleted: true };
}
