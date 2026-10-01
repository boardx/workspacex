/**
 * 项目中枢 B3-T5（#4499）`addNonWorkshopMember` —— 把组织成员加进研究项目 / 用户洞察，或改档。
 *
 * 门：`authorizeNonWorkshopMember(…, "manage")`（owner；空 owner 时组织 lead/admin 可加第一位）。
 * 目标人必须是组织成员 ⇒ 否则 `ORG_ROLE_INSUFFICIENT`（契约头注：不为它新增码）。
 * 归档：先读 `container.status`（用例层投影），写入再撞 F124 策略兜底（仓储翻译成 `archived`）。
 * 审计：`role-changed` / `membership`（复合 id `${projectId}:${userId}`），同 `add-project-member.ts`。
 * 通知（#4787）：加人成功后**尽力而为**地告诉被加的人（`notifier`，站内通知 + 邮件）——失败只记日志，
 * 绝不让一次已经写入的加人变成失败。自己加自己不通知。
 *
 * ⚠ 本用例的组织成员门没有放宽：目标不是组织成员仍是 `ORG_ROLE_INSUFFICIENT`。
 *   「对方还不是组织成员」的路径是邮箱邀请 / 邀请链接（`accept-project-invitation.ts`）。
 */
import type { ProvenanceWriter } from "../provenance/ports";
import { ProjectError } from "./errors";
import { authorizeNonWorkshopMember, type NonWorkshopMemberActor, type NonWorkshopMemberDeps } from "./list-non-workshop-member";
import type { NonWorkshopMemberRole } from "./non-workshop-member-ports";
import type { ProjectMemberAddedNotifier } from "./project-invitation-ports";

export interface AddNonWorkshopMemberDeps extends NonWorkshopMemberDeps {
  readonly provenance: ProvenanceWriter;
  /** 可选：未接线（多数单测）就不通知。 */
  readonly notifier?: ProjectMemberAddedNotifier;
  readonly log?: (message: string, detail: Record<string, unknown>) => void;
}

export interface AddNonWorkshopMemberInput extends NonWorkshopMemberActor {
  readonly userId: string;
  readonly role: NonWorkshopMemberRole;
}

export interface AddNonWorkshopMemberOutput {
  readonly projectId: string;
  readonly userId: string;
  readonly role: NonWorkshopMemberRole;
  readonly provenanceEventId: string;
}

export async function addNonWorkshopMember(
  deps: AddNonWorkshopMemberDeps,
  input: AddNonWorkshopMemberInput,
): Promise<AddNonWorkshopMemberOutput> {
  const gate = await authorizeNonWorkshopMember(deps, input, "manage");
  if (gate.container.status === "archived") throw new ProjectError("PROJECT_ARCHIVED");

  let targetInOrg: boolean;
  try {
    targetInOrg = (await deps.identity.findOrgMembership(input.userId, input.orgId)) !== null;
  } catch {
    throw new ProjectError("AUTH_SERVICE_UNAVAILABLE");
  }
  if (!targetInOrg) throw new ProjectError("ORG_ROLE_INSUFFICIENT");

  const outcome = await deps.members.upsertMember({
    orgId: input.orgId,
    projectId: input.projectId,
    kind: gate.container.kind,
    userId: input.userId,
    role: input.role,
  });
  switch (outcome.kind) {
    case "not-found":
      throw new ProjectError("NO_PROJECT_ROLE");
    case "archived":
      throw new ProjectError("PROJECT_ARCHIVED");
    case "written":
      break;
  }

  const provenanceEventId = await deps.provenance.append({
    orgId: input.orgId,
    type: "role-changed",
    actorId: input.actorId,
    target: { kind: "membership", id: `${input.projectId}:${input.userId}` },
    detail: { op: "non-workshop-member-upserted", containerKind: gate.container.kind, role: outcome.role },
  });

  if (deps.notifier !== undefined && input.userId !== input.actorId) {
    try {
      await deps.notifier.notifyAdded({
        orgId: input.orgId,
        projectId: input.projectId,
        userId: input.userId,
        actorId: input.actorId,
        role: outcome.role,
      });
    } catch (err) {
      deps.log?.("project member-added notification failed", { projectId: input.projectId, err });
    }
  }

  return { projectId: input.projectId, userId: input.userId, role: outcome.role, provenanceEventId };
}
