/**
 * `listTeams`（#639 delta，迭代 1）—— 团队列表，只读。
 *
 * ⚠ 与 `mutateTeam` 不同，这里**不要求 `actorOrgRole === "admin"`**——组织管理页
 *   "团队"标签页要给任何组织成员看列表（CRUD 动作本轮留空/禁用态），越权收窄只
 *   约束写操作（delta §4①逐字：「谁能建/改/删团队」，不是「谁能看」）。
 *   调用方在 controller 层已经用 `requireAdminRole`（其实只检查成员资格，见该文件
 *   注释）确认过组织成员身份，这里不重复判定。
 */
import type { OrgId } from "../../domain/org-id";
import type { TeamListRow, TeamRepository } from "./team-ports";

export interface ListTeamsDeps {
  readonly repo: TeamRepository;
}

export interface ListTeamsInput {
  readonly orgId: OrgId;
}

export interface ListTeamsOutput {
  readonly teams: readonly TeamListRow[];
}

export async function listTeams(deps: ListTeamsDeps, input: ListTeamsInput): Promise<ListTeamsOutput> {
  const teams = await deps.repo.list(input.orgId);
  return { teams };
}
