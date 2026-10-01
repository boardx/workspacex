/**
 * 项目中枢 B3-T5（#4499）`listNonWorkshopMembers` —— 研究项目 / 用户洞察的协作者名单，
 * 以及三个用例共用的门 `authorizeNonWorkshopMember`。
 *
 * ## 判定顺序（每一步的理由在契约操作头注里）
 *
 *   ① `findContainer`：不存在 ⇒ `NO_PROJECT_ROLE`（与「没有角色」不可分辨）。
 *   ② `findOrgMembership`：判定服务不可用 ⇒ `AUTH_SERVICE_UNAVAILABLE`（不降级放行）。
 *   ③ `kind === "workshop"`：组织成员 ⇒ `ProjectKindMismatchError`（400 不带码）；
 *      非组织成员 ⇒ `NO_PROJECT_ROLE`——先②后③，外人探不出「这个 id 是个工作坊」。
 *   ④ `findStanding` + `decideNonWorkshopMemberAccess`（domain）：拒绝按 `reason` 抛。
 *
 * 名单经 `discloseDecided()` 出来——仓储只交 `Guarded<T>`，忘了判定是类型错误不是疏漏。
 */
import type { OrgId } from "../../domain/org-id";
import type { OrgMembershipRow, DecisionIdFactory, IdentityRepository } from "../identity/ports";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import {
  decideNonWorkshopMemberAccess,
  type NonWorkshopMemberAction,
} from "../../domain/project/non-workshop-member-access";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import { ProjectError, ProjectKindMismatchError } from "./errors";
import type {
  NonWorkshopContainer,
  NonWorkshopKind,
  NonWorkshopMemberRepository,
  NonWorkshopMemberRow,
} from "./non-workshop-member-ports";

export interface NonWorkshopMemberDeps {
  readonly identity: IdentityRepository;
  readonly ids: DecisionIdFactory;
  readonly members: NonWorkshopMemberRepository;
}

export interface NonWorkshopMemberActor {
  readonly actorId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
}

export interface NonWorkshopMemberGate {
  readonly container: NonWorkshopContainer & { readonly kind: NonWorkshopKind };
  readonly decision: PermissionDecision;
}

export async function authorizeNonWorkshopMember(
  deps: NonWorkshopMemberDeps,
  input: NonWorkshopMemberActor,
  action: NonWorkshopMemberAction,
): Promise<NonWorkshopMemberGate> {
  const container = await deps.members.findContainer(input.orgId, input.projectId);
  if (container === null) throw new ProjectError("NO_PROJECT_ROLE");

  let orgMembership: OrgMembershipRow | null;
  try {
    orgMembership = await deps.identity.findOrgMembership(input.actorId, input.orgId);
  } catch {
    throw new ProjectError("AUTH_SERVICE_UNAVAILABLE");
  }

  if (container.kind === "workshop") {
    if (orgMembership === null) throw new ProjectError("NO_PROJECT_ROLE");
    throw new ProjectKindMismatchError();
  }
  const kind: NonWorkshopKind = container.kind;

  const standing = await deps.members.findStanding(input.orgId, input.projectId, kind, input.actorId);
  const verdict = decideNonWorkshopMemberAccess({
    decisionId: deps.ids.next(),
    action,
    orgRole: orgMembership?.orgRole ?? null,
    memberRole: standing.memberRole,
    containerHasOwner: standing.containerHasOwner,
  });
  if (verdict.reason !== null) throw new ProjectError(verdict.reason);

  return { container: { kind, status: container.status }, decision: verdict.decision };
}

export interface ListNonWorkshopMembersOutput {
  readonly members: readonly NonWorkshopMemberRow[];
}

export async function listNonWorkshopMembers(
  deps: NonWorkshopMemberDeps,
  input: NonWorkshopMemberActor,
): Promise<ListNonWorkshopMembersOutput> {
  const gate = await authorizeNonWorkshopMember(deps, input, "read");
  const guarded = await deps.members.listMembers(input.orgId, input.projectId, gate.container.kind);
  const d = discloseDecided(guarded, gate.decision);
  // 上面已按 reason 抛过，这一支理论不可达；到达时按无权限处理而不是放行。
  if (!isDisclosed(d)) throw new ProjectError("NO_PROJECT_ROLE");
  return { members: d.payload };
}
