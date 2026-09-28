/**
 * 项目中枢 B3-T5（#4499）`removeNonWorkshopMember` —— 从研究项目 / 用户洞察移除一人。
 *
 * 门同 add（`manage`）。幂等：不在名单上 ⇒ 成功、`removed: false`、不写审计（没有状态变化）。
 * 归档：DELETE 的 F124 策略挂 `USING`，拒绝时静默 0 行——所以在删之前显式读 `container.status`
 * （同 `pg-project-membership-repository.ts` 文件头对 DELETE 的处置），否则「已归档」与
 * 「本来就不在」都长成 `absent`。
 */
import type { ProvenanceWriter } from "../provenance/ports";
import { ProjectError } from "./errors";
import { authorizeNonWorkshopMember, type NonWorkshopMemberActor, type NonWorkshopMemberDeps } from "./list-non-workshop-member";

export interface RemoveNonWorkshopMemberDeps extends NonWorkshopMemberDeps {
  readonly provenance: ProvenanceWriter;
}

export interface RemoveNonWorkshopMemberInput extends NonWorkshopMemberActor {
  readonly userId: string;
}

export interface RemoveNonWorkshopMemberOutput {
  readonly projectId: string;
  readonly userId: string;
  readonly removed: boolean;
  readonly provenanceEventId: string | null;
}

export async function removeNonWorkshopMember(
  deps: RemoveNonWorkshopMemberDeps,
  input: RemoveNonWorkshopMemberInput,
): Promise<RemoveNonWorkshopMemberOutput> {
  const gate = await authorizeNonWorkshopMember(deps, input, "manage");
  if (gate.container.status === "archived") throw new ProjectError("PROJECT_ARCHIVED");

  const outcome = await deps.members.removeMember({
    orgId: input.orgId,
    projectId: input.projectId,
    kind: gate.container.kind,
    userId: input.userId,
  });
  if (outcome === "absent") {
    return { projectId: input.projectId, userId: input.userId, removed: false, provenanceEventId: null };
  }

  const provenanceEventId = await deps.provenance.append({
    orgId: input.orgId,
    type: "role-changed",
    actorId: input.actorId,
    target: { kind: "membership", id: `${input.projectId}:${input.userId}` },
    detail: { op: "non-workshop-member-removed", containerKind: gate.container.kind },
  });
  return { projectId: input.projectId, userId: input.userId, removed: true, provenanceEventId };
}
