/**
 * B2-S4（issue #4428）—— 「记到组织记忆」：把一个项目的项目记忆里的结论晋升到**组织记忆**（L2 → L3）。
 *
 * 与 `promote-to-project.ts` 同构（复制 + derived_from 连边、逐条部分成功、相近需选择），只有三处不同：
 *   · 谁能做：本组织 lead / admin（`canPromoteToOrg`）——组织记忆是替整个组织记下，项目引导师也不够；
 *   · 来源是项目记忆（`promotion.projectSourceClaims`），不是会话结论；调用者还得看得到这个项目（`authorize read.published`）；
 *   · 去重对象是组织记忆（`promotion.orgClaims`）。
 * 落库判定住在 `kg_promote_claim_to_org`（迁移 20260927160000），这里只编排。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import { dedupAgainstPersonal } from "../../domain/knowledge-graph/promotion";
import type { OrgId } from "../../domain/org-id";
import type { PermissionDecision } from "../../domain/identity/permission-decision";
import { authorize } from "../identity/authorize";
import { AuthzUnavailableError } from "../chat/resolve-visibility";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";
import { KgReadError } from "./read-thread-knowledge";
import { canPromoteToOrg, decideOrgSpace, orgMembershipOf } from "./read-org-knowledge";
import { KgHumanActionError, type PromotionItemResult } from "./ports";
import type { PromotionDeps } from "./promote-to-personal";

interface Input {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
}

const REJECT_CODES = new Set<string>(KG.KgPromotionRejectCode.options);

/** 组织 lead / admin，且看得到这个项目（组织层 / 冻结 / 团队绑定等既有判定）。 */
async function requireOrgPromoter(deps: PromotionDeps, input: Input) {
  if (!canPromoteToOrg(await orgMembershipOf(deps, input))) throw new KgHumanActionError("KG_NOT_OWNER");
  let project: PermissionDecision;
  try {
    project = await authorize(
      { repo: deps.repo, ids: deps.ids },
      { userId: input.userId, orgId: input.orgId, object: { kind: "project", id: input.projectId }, action: "read.published" },
    );
  } catch {
    throw new AuthzUnavailableError();
  }
  if (!project.allowed) throw new KgReadError("KG_NOT_VISIBLE");
  const revealProject = <T>(g: Guarded<T>): T => {
    const d = discloseDecided(g, project);
    if (!isDisclosed(d)) throw new KgReadError("KG_NOT_VISIBLE");
    return d.payload;
  };
  const revealOrg = async <T>(g: Guarded<T>): Promise<T> => {
    const d = discloseDecided(g, await decideOrgSpace(deps, input, g));
    if (!isDisclosed(d)) throw new KgHumanActionError("KG_NOT_OWNER");
    return d.payload;
  };
  return { revealProject, revealOrg };
}

export async function promoteToOrg(
  deps: PromotionDeps,
  input: Input & {
    readonly claimIds: readonly string[];
    readonly choices?: readonly { readonly claimId: string; readonly choice: "merge" | "coexist" }[];
  },
): Promise<{ readonly results: readonly PromotionItemResult[] }> {
  if (input.claimIds.length > KG.KG_PROMOTE_MAX_BATCH) throw new KgHumanActionError("KG_PROMOTE_BATCH_TOO_LARGE");
  const p = await requireOrgPromoter(deps, input);
  const choices = new Map((input.choices ?? []).map((c) => [c.claimId, c.choice]));
  const source = new Map(
    p.revealProject(await deps.promotion.projectSourceClaims(input.orgId, input.userId, input.projectId, input.claimIds)).map((c) => [c.id, c]),
  );
  const results: PromotionItemResult[] = [];
  for (const claimId of [...new Set(input.claimIds)]) {
    const src = source.get(claimId);
    if (src === undefined) {
      results.push({ claimId, outcome: "rejected", code: "KG_CLAIM_NOT_FOUND" });
      continue;
    }
    // 每条都重新读一次组织记忆：同一批里前一条刚晋升的，后一条要能看见。
    const verdict = dedupAgainstPersonal(src.statement, await p.revealOrg(await deps.promotion.orgClaims(input.orgId, input.userId)));
    const choice = choices.get(claimId);
    if (verdict.kind === "similar" && choice === undefined) {
      results.push({ claimId, outcome: "needs_choice", existingPersonalClaimId: verdict.existingId });
      continue;
    }
    const merge = verdict.kind === "duplicate" || (verdict.kind === "similar" && choice === "merge");
    try {
      const orgClaimId = await deps.promotion.promoteToOrg(input.orgId, input.userId, {
        actionId: deps.newId("act"), projectId: input.projectId, claimId,
        mode: merge ? "merge" : "new",
        ...(merge && (verdict.kind === "duplicate" || verdict.kind === "similar") ? { targetClaimId: verdict.existingId } : {}),
      });
      results.push(merge
        ? { claimId, outcome: "merged_into_existing", personalClaimId: orgClaimId }
        : verdict.kind === "similar" ? { claimId, outcome: "coexisting", personalClaimId: orgClaimId } : { claimId, outcome: "promoted", personalClaimId: orgClaimId });
    } catch (e) {
      if (e instanceof KgHumanActionError && REJECT_CODES.has(e.code)) {
        results.push({ claimId, outcome: "rejected", code: e.code as KG.KgPromotionRejectCode });
        continue;
      }
      throw e;
    }
  }
  return { results };
}
