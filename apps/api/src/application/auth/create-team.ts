/**
 * `createTeam`（team-crud delta #639，迭代 2；迭代 4 补写 provenance）—— 与 `mutateTeam` 的
 * `create` 分支并存，见 `team-ports.ts` 的 `createExclusive` 文档注释：这里撞到重名**真的拒绝**。
 *
 * 迭代 4：成功后写一条 `team-created`（target = 新团队，`team` kind，id = `teamId`）。
 * `mutateTeam`（F11 的旧路径，`create`/`rename`/`delete` 三分支合一）**不在本次补齐范围**，
 * 见 `docs/adr/ADR-101-provenance-event-type-missing-members.md` 的 #638 追加记录。
 */
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { ProvenanceWriter } from "../provenance/ports";
import type { TeamRepository, TeamRow } from "./team-ports";

export interface CreateTeamDeps {
  readonly repo: TeamRepository;
  readonly provenance: ProvenanceWriter;
}

export interface CreateTeamInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly actorOrgRole: string;
  readonly name: string;
}

export async function createTeam(deps: CreateTeamDeps, input: CreateTeamInput): Promise<TeamRow> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("FORBIDDEN");

  const result = await deps.repo.createExclusive(input.orgId, input.name);
  if (!result.ok) throw new OrgAdminError("TEAM_NAME_CONFLICT");

  await deps.provenance.append({
    orgId: input.orgId,
    type: "team-created",
    actorId: input.actorId,
    target: { kind: "team", id: result.team.teamId },
    detail: { name: result.team.name },
  });

  return result.team;
}
