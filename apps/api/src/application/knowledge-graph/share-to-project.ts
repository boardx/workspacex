/**
 * phase-18 S10（issue #4367，epic #4359）——「分享到项目…」：把本人的一条个人结论**显式**提升到项目层（L1 → L2）。
 *
 * 三步都只由这条个人结论的主人发起：
 *   ① `listProjectShareTargets`：能分享到哪些项目、每个项目里**谁会看到**（范围预览）；
 *   ② `shareToProject`：数据库 `kg_share_claim_to_project` 建派生副本（derived_from 连回，保留作者），幂等；
 *   ③ `unshareFromProject`：`kg_unshare_claim_from_project` 让项目副本失效，F07 级联收掉它的边，原件不动。
 *
 * 权限只有一处判定：个人空间的判定 `decidePersonalSpace`（组织层通过 且 查看者 = 空间主人）。
 * 别人的个人结论、不存在、判定不过 ⇒ 同一个出口 `KG_CLAIM_NOT_FOUND`（HTTP 404，人类决定 2026-09-27：
 * 别人的个人结论一律 404，不是 403——403 等于承认「有这么一条，只是你看不到」）。
 * 目标项目的成员 / 观察者 / 归档判定在数据库函数里（与写入同一个事务，不存在「判完之后被移出项目」的窗口）。
 */
import type { knowledgeGraph as KGNS } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";
import { decidePersonalSpace } from "./read-personal-knowledge";
import type { KnowledgeReadDeps } from "./read-thread-knowledge";

type Targets = z.infer<typeof KGNS.knowledgeGraph.listProjectShareTargets.out>["targets"];

/** 分享路径的拒绝码（契约 listProjectShareTargets / shareToProject / unshareFromProject 的 err）。 */
export type KgShareErrorCode =
  | "KG_CLAIM_NOT_FOUND" | "KG_PROJECT_NOT_FOUND" | "KG_PROJECT_READ_ONLY"
  | "KG_CONTESTED_NEEDS_RESOLUTION" | "KG_ACTOR_NOT_HUMAN" | "KG_SCOPE_NOT_ENABLED";

export class KgShareError extends Error {
  constructor(readonly code: KgShareErrorCode, message?: string) {
    super(message ?? code);
  }
}

export interface ProjectSharePort {
  /**
   * 本人个人空间里的这一条（活的）；不是本人的 / 不存在 / 已失效 ⇒ null。
   * 返回值按本人个人空间 guard（ref = `personal:<userId>`，同 `personalKnowledge`）。
   */
  ownClaim(orgId: OrgId, userId: string, claimId: string): Promise<Guarded<{ readonly id: string; readonly statement: string }> | null>;
  /** 本人能分享进去的项目（成员、非观察者、未归档）+ 每个项目的可见范围 + 这一条是否已分享过。同一个 guard ref。 */
  shareTargets(orgId: OrgId, userId: string, claimId: string): Promise<Guarded<Targets>>;
  /** 数据库复核主人 / 成员 / 角色 / 归档后执行；被拒时抛 `KgShareError`。 */
  share(orgId: OrgId, userId: string, input: { readonly actionId: string; readonly claimId: string; readonly projectId: string }):
    Promise<{ readonly projectClaimId: string; readonly outcome: "shared" | "already_shared" }>;
  unshare(orgId: OrgId, userId: string, input: { readonly actionId: string; readonly claimId: string; readonly projectId: string }): Promise<string>;
}

export const PROJECT_SHARE_PORT = Symbol("ProjectSharePort");

export interface ShareDeps extends KnowledgeReadDeps {
  readonly share: ProjectSharePort;
  readonly newId: (prefix: string) => string;
}

interface Viewer {
  readonly userId: string;
  readonly orgId: OrgId;
}

/** 主人判定：读口交回本人空间里的这一条，再过个人空间的判定；任何一步不过 ⇒ 404。 */
async function requireOwner(deps: ShareDeps, input: Viewer & { readonly claimId: string }) {
  const own = await deps.share.ownClaim(input.orgId, input.userId, input.claimId);
  if (own === null) throw new KgShareError("KG_CLAIM_NOT_FOUND");
  const decision = await decidePersonalSpace(deps, input, own);
  const d = discloseDecided(own, decision);
  if (!isDisclosed(d)) throw new KgShareError("KG_CLAIM_NOT_FOUND");
  const reveal = <T>(g: Guarded<T>): T => {
    const x = discloseDecided(g, decision);
    if (!isDisclosed(x)) throw new KgShareError("KG_CLAIM_NOT_FOUND");
    return x.payload;
  };
  return { claim: d.payload, reveal };
}

export async function listProjectShareTargets(
  deps: ShareDeps,
  input: Viewer & { readonly claimId: string },
): Promise<z.infer<typeof KGNS.knowledgeGraph.listProjectShareTargets.out>> {
  const { claim, reveal } = await requireOwner(deps, input);
  const targets = reveal(await deps.share.shareTargets(input.orgId, input.userId, claim.id));
  return { claimId: claim.id, statement: claim.statement, targets };
}

export async function shareToProject(
  deps: ShareDeps,
  input: Viewer & { readonly claimId: string; readonly projectId: string },
): Promise<z.infer<typeof KGNS.knowledgeGraph.shareToProject.out>> {
  const { claim } = await requireOwner(deps, input);
  return deps.share.share(input.orgId, input.userId, { actionId: deps.newId("act"), claimId: claim.id, projectId: input.projectId });
}

export async function unshareFromProject(
  deps: ShareDeps,
  input: Viewer & { readonly claimId: string; readonly projectId: string },
): Promise<z.infer<typeof KGNS.knowledgeGraph.unshareFromProject.out>> {
  const { claim } = await requireOwner(deps, input);
  const projectClaimId = await deps.share.unshare(input.orgId, input.userId, { actionId: deps.newId("act"), claimId: claim.id, projectId: input.projectId });
  return { projectClaimId };
}
