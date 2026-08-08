/**
 * `createTeam`（team-crud delta #639，迭代 2）—— 与 `mutateTeam` 的 `create` 分支并存，
 * 见 `team-ports.ts` 的 `createExclusive` 文档注释：这里撞到重名**真的拒绝**。
 */
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { TeamRepository, TeamRow } from "./team-ports";

export interface CreateTeamDeps {
  readonly repo: TeamRepository;
}

export interface CreateTeamInput {
  readonly orgId: OrgId;
  readonly actorOrgRole: string;
  readonly name: string;
}

export async function createTeam(deps: CreateTeamDeps, input: CreateTeamInput): Promise<TeamRow> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("FORBIDDEN");

  const result = await deps.repo.createExclusive(input.orgId, input.name);
  if (!result.ok) throw new OrgAdminError("TEAM_NAME_CONFLICT");
  return result.team;
}
