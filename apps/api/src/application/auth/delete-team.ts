/**
 * `deleteTeam`（team-crud delta #639，迭代 2；迭代 4 补写 provenance）—— 复用
 * `TeamRepository.delete`（F11 的占用校验：非空一律阻断、不级联清空成员归属，delta §4②与
 * F11 是同一条决定）。只在这一层把结果码翻译成本操作签核的专属码：`in-use → TEAM_NOT_EMPTY`，
 * `not-found → TEAM_NOT_FOUND`（旧 `mutateTeam` 把 not-found 映射到 `VERSION_CHANGED`，
 * 是那条操作没有专属码时的权宜；这条操作签了专属码，直接用）。
 *
 * 迭代 4：成功后写一条 `team-deleted`（target = 该团队，`team` kind，id = `teamId`）。
 *
 * 迭代 4 修复（独立复核抓到的可用性缺陷）：`detail.name` 补上团队名——`TeamRepository.delete`
 * 在行被删除前已经查过一次该团队（占用校验要用），把 name 顺路带出来，不需要再多一次查询；
 * 活动记录要能显示「删除了团队"XX"」而不是裸 `team:<uuid>`，这个名字必须在这里落进
 * provenance，删除之后这一行就再也查不到了。
 */
import type { OrgId } from "../../domain/org-id";
import { OrgAdminError } from "./org-invite-errors";
import type { ProvenanceWriter } from "../provenance/ports";
import type { TeamRepository } from "./team-ports";

export interface DeleteTeamDeps {
  readonly repo: TeamRepository;
  readonly provenance: ProvenanceWriter;
}

export interface DeleteTeamInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly actorOrgRole: string;
  readonly teamId: string;
}

export async function deleteTeam(deps: DeleteTeamDeps, input: DeleteTeamInput): Promise<{ deleted: true }> {
  if (input.actorOrgRole !== "admin") throw new OrgAdminError("FORBIDDEN");

  const result = await deps.repo.delete(input.orgId, input.teamId);
  if (!result.ok) {
    throw new OrgAdminError(result.reason === "in-use" ? "TEAM_NOT_EMPTY" : "TEAM_NOT_FOUND");
  }

  await deps.provenance.append({
    orgId: input.orgId,
    type: "team-deleted",
    actorId: input.actorId,
    target: { kind: "team", id: input.teamId },
    detail: { name: result.team?.name ?? null },
  });

  return { deleted: true };
}
