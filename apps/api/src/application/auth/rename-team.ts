/**
 * `renameTeam`（team-crud delta #639，迭代 2；迭代 4 补写 provenance）—— 见 `create-team.ts`
 * 同样的并存理由。
 *
 * 迭代 4：成功后写一条 `team-renamed`（target = 该团队，`team` kind）。
 */
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { ProvenanceWriter } from "../provenance/ports";
import type { TeamRepository, TeamRow } from "./team-ports";

export interface RenameTeamDeps {
  readonly repo: TeamRepository;
  readonly provenance: ProvenanceWriter;
}

export interface RenameTeamInput {
  readonly orgId: OrgId;
  readonly actorId: string;
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

  await deps.provenance.append({
    orgId: input.orgId,
    type: "team-renamed",
    actorId: input.actorId,
    target: { kind: "team", id: result.team.teamId },
    detail: { name: result.team.name },
  });

  return result.team;
}
