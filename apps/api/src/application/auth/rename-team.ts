/**
 * `renameTeam`（team-crud delta #639，迭代 2）—— 见 `create-team.ts` 同样的并存理由。
 */
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { TeamRepository, TeamRow } from "./team-ports";

export interface RenameTeamDeps {
  readonly repo: TeamRepository;
}

export interface RenameTeamInput {
  readonly orgId: OrgId;
  readonly actorOrgRole: string;
  readonly teamId: string;
  readonly name: string;
}

export async function renameTeam(deps: RenameTeamDeps, input: RenameTeamInput): Promise<TeamRow> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("FORBIDDEN");

  const result = await deps.repo.renameExclusive(input.orgId, input.teamId, input.name);
  if (!result.ok) {
    throw new OrgAdminError(result.reason === "conflict" ? "TEAM_NAME_CONFLICT" : "TEAM_NOT_FOUND");
  }
  return result.team;
}
