/**
 * B2-S4（issue #4428）—— 组织大脑只读：本组织的组织记忆（L3）。
 *
 * 判定：① 必须是组织成员（`org_memberships`，任何角色——组织记忆本就是给全员的）；② 再走 `authorize(read.published)`
 * 对着组织空间的合成对象（`project:org:<orgId>`，同个人空间 `personal:<userId>` 的做法：组织记忆没有 acl_bindings 行，
 * 无项目上下文 ⇒ 只判组织层：冻结 / 已不是成员等既有判定），用它的决策去 disclose。两道门任一不过 ⇒ `KG_NOT_VISIBLE`
 * （403，同个人空间 / 项目记忆）。
 *
 * `canPromoteToOrg`：谁能把项目记忆记到组织记忆——本组织 lead / admin。这里是应用层的唯一说明处；落库判定在
 * `kg_promote_claim_to_org`（迁移 20260927160000）按同一条 `org_role IN ('lead','admin')` 复核。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import type { OrgMembershipRow } from "../identity/ports";
import { authorize } from "../identity/authorize";
import { AuthzUnavailableError } from "../chat/resolve-visibility";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";
import { KgReadError, type KnowledgeReadDeps } from "./read-thread-knowledge";

interface Viewer {
  readonly userId: string;
  readonly orgId: OrgId;
}

/** 组织空间 guard ref 的合成 id 前缀（同 pg-knowledge-read / pg-promotion 的 `orgSpaceRef`）。 */
const ORG_REF_PREFIX = "org:";

export const canPromoteToOrg = (m: OrgMembershipRow | null): boolean => m?.orgRole === "lead" || m?.orgRole === "admin";

/** 组织成员关系；判定依赖读不到 ⇒ 503，不降级为放行（同 resolveVisibility）。 */
export async function orgMembershipOf(deps: KnowledgeReadDeps, viewer: Viewer): Promise<OrgMembershipRow | null> {
  try {
    return await deps.repo.findOrgMembership(viewer.userId, viewer.orgId);
  } catch {
    throw new AuthzUnavailableError();
  }
}

/**
 * 组织空间的判定：组织成员 且 组织层通过 且 读口交回的 ref 就是本组织的空间。
 * 主人取自 guard ref（`org:<orgId>`）——读口若因为缺陷交回了别的组织的空间，这里拒绝，内容一个字也不出去。
 */
export async function decideOrgSpace(deps: KnowledgeReadDeps, viewer: Viewer, space: Guarded<unknown>): Promise<PermissionDecision> {
  const membership = await orgMembershipOf(deps, viewer);
  let base: PermissionDecision;
  try {
    base = await authorize(
      { repo: deps.repo, ids: deps.ids },
      { userId: viewer.userId, orgId: viewer.orgId, object: { kind: "project", id: `${ORG_REF_PREFIX}${viewer.orgId}` }, action: "read.published" },
    );
  } catch {
    throw new AuthzUnavailableError();
  }
  const owner = space.ref.kind === "project" && space.ref.id.startsWith(ORG_REF_PREFIX) ? space.ref.id.slice(ORG_REF_PREFIX.length) : null;
  const allowed = membership !== null && base.orgLayer.passed && owner === viewer.orgId;
  return { ...base, allowed, reasonCode: allowed ? null : base.reasonCode ?? "ORG_SCOPE_DENIED" };
}

export async function getOrgKnowledge(
  deps: KnowledgeReadDeps,
  input: Viewer,
): Promise<z.infer<typeof KG.knowledgeGraph.getOrgKnowledge.out>> {
  const guarded = await deps.knowledge.orgKnowledge(input.orgId, input.userId);
  const d = discloseDecided(guarded, await decideOrgSpace(deps, input, guarded));
  if (!isDisclosed(d)) throw new KgReadError("KG_NOT_VISIBLE");
  return { scope: { kind: "org", id: input.orgId }, ...d.payload };
}
