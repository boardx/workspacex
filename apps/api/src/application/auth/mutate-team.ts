/**
 * `MutateTeam`（F11 / O-29 ④）—— 编排。团队增 / 删 / 改，一个用例三个分支。
 *
 * 越权判定在这里（只有管理员能改团队）；「同名是不是幂等重放」「删除前占用校验」
 * 都在仓储那次锁定里（见 `team-ports.ts`），因为这两条都要求判定与写入不可分离。
 */
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { TeamOccupancy, TeamRepository, TeamRow } from "./team-ports";

export interface MutateTeamDeps {
  readonly repo: TeamRepository;
}

export interface MutateTeamInput {
  readonly orgId: OrgId;
  readonly actorOrgRole: string;
  readonly op: "create" | "rename" | "delete";
  /** `create` 时为 null。 */
  readonly teamId: string | null;
  /** `delete` 时为 null。 */
  readonly name: string | null;
}

export interface MutateTeamOutput {
  readonly team: TeamRow | null;
  /** 仅 `delete` 被阻断时非空——但阻断走异常路径（见下），这个字段恒为 null。 */
  readonly blocked: TeamOccupancy | null;
}

export async function mutateTeam(deps: MutateTeamDeps, input: MutateTeamInput): Promise<MutateTeamOutput> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("PROJECT_ROLE_INSUFFICIENT");

  const result = await dispatch(deps.repo, input);

  if (!result.ok) {
    if (result.reason === "not-found") throw new OrgAdminError("VERSION_CHANGED");
    // `in-use`：删除前占用校验失败。占用项必须**随异常一起**到达调用方——
    // `TeamInUseError` 携带它，interface 层把它铺进响应体（见 all-exceptions.filter.ts
    // 新增的 `orgAdminBlockedOf`），而不是把 `blocked` 塞进一个 200 响应再假装它是错误。
    throw new TeamInUseError(result.occupancy);
  }

  return { team: result.team, blocked: null };
}

function dispatch(repo: TeamRepository, input: MutateTeamInput) {
  switch (input.op) {
    case "create":
      // `name` 契约上非空（`.min(1)` 不在这条路径校验——由 ZodBodyPipe 挡在更外层，
      // 这里只信任「create 时 name 非 null」这条前置条件）。
      return repo.create(input.orgId, input.name ?? "");
    case "rename":
      return repo.rename(input.orgId, input.teamId ?? "", input.name ?? "");
    case "delete":
      return repo.delete(input.orgId, input.teamId ?? "");
  }
}

/**
 * `TEAM_IN_USE` 的携带者。⚠ 这不是给 `OrgAdminError` 加一个可选字段——
 * `OrgAdminError` 的存在理由是「interface 层把它们映射成同一种响应形状」（见其文件头），
 * 而 `TEAM_IN_USE` 恰好是本束**唯一**一个响应形状不同的失败码（要带 `blocked`）。
 * 一个独立的类比一个 `if (e.reasonCode === "TEAM_IN_USE")` 分支更难被漏判。
 */
export class TeamInUseError extends Error {
  readonly reasonCode = "TEAM_IN_USE" as const;
  constructor(readonly occupancy: TeamOccupancy) {
    super("TEAM_IN_USE");
    this.name = "TeamInUseError";
  }
}
