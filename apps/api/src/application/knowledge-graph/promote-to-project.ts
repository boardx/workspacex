/**
 * 项目中枢 R7 —— 「记到项目大脑」：把项目线程里的结论晋升到**项目记忆**（L0 → L2）。
 *
 * 与 `promote-to-personal.ts` 同构（复制 + derived_from 连边、逐条部分成功、相近需选择），只有三处不同：
 *   · 谁能做：线程创建者，或本项目引导师（同 R5 分享的判据——看得见 ≠ 能替整个项目记下）；
 *   · 只对项目线程（`KG_SCOPE_NOT_PROJECT`）；
 *   · 去重对象是项目记忆（`promotion.projectClaims`），不是本人个人空间。
 * 落库判定住在 `kg_promote_claim_to_project`（迁移 20260927120000），这里只编排。
 */
import { knowledgeGraph as KG } from "@repo/contracts";
import { dedupAgainstPersonal } from "../../domain/knowledge-graph/promotion";
import type { OrgId } from "../../domain/org-id";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";
import { visibleThread } from "./read-thread-knowledge";
import { KgHumanActionError, type PromotionItemResult } from "./ports";
import type { PromotionDeps } from "./promote-to-personal";

interface Input {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly threadId: string;
}

async function requireProjectPromoter(deps: PromotionDeps, input: Input) {
  const t = await visibleThread(deps, input, input.threadId);
  if (t.facts.projectId === null) throw new KgHumanActionError("KG_SCOPE_NOT_PROJECT");
  if (t.facts.createdBy !== input.userId) {
    const m = await deps.repo.findProjectMembership(input.userId, t.facts.projectId, input.orgId);
    if (m?.projectRole !== "facilitator") throw new KgHumanActionError("KG_NOT_OWNER");
  }
  const reveal = <T>(g: Guarded<T>): T => {
    const d = discloseDecided(g, t.base);
    if (!isDisclosed(d)) throw new KgHumanActionError("KG_NOT_OWNER");
    return d.payload;
  };
  return { ref: t.ref, reveal };
}

const REJECT_CODES = new Set<string>(KG.KgPromotionRejectCode.options);

export async function promoteToProject(
  deps: PromotionDeps,
  input: Input & {
    readonly claimIds: readonly string[];
    readonly choices?: readonly { readonly claimId: string; readonly choice: "merge" | "coexist" }[];
  },
): Promise<{ readonly results: readonly PromotionItemResult[] }> {
  if (input.claimIds.length > KG.KG_PROMOTE_MAX_BATCH) throw new KgHumanActionError("KG_PROMOTE_BATCH_TOO_LARGE");
  const t = await requireProjectPromoter(deps, input);
  const choices = new Map((input.choices ?? []).map((c) => [c.claimId, c.choice]));
  const source = new Map(t.reveal(await deps.promotion.threadClaims(input.orgId, input.userId, t.ref, input.claimIds)).map((c) => [c.id, c]));
  const results: PromotionItemResult[] = [];
  for (const claimId of [...new Set(input.claimIds)]) {
    const src = source.get(claimId);
    if (src === undefined) {
      results.push({ claimId, outcome: "rejected", code: "KG_CLAIM_NOT_FOUND" });
      continue;
    }
    if (src.sourceGone) {
      results.push({ claimId, outcome: "rejected", code: "KG_EVIDENCE_REVOKED" });
      continue;
    }
    // 每条都重新读一次项目记忆：同一批里前一条刚晋升的，后一条要能看见。
    const verdict = dedupAgainstPersonal(src.statement, t.reveal(await deps.promotion.projectClaims(input.orgId, input.userId, t.ref)));
    const choice = choices.get(claimId);
    if (verdict.kind === "similar" && choice === undefined) {
      results.push({ claimId, outcome: "needs_choice", existingPersonalClaimId: verdict.existingId });
      continue;
    }
    const merge = verdict.kind === "duplicate" || (verdict.kind === "similar" && choice === "merge");
    try {
      const projectClaimId = await deps.promotion.promoteToProject(input.orgId, input.userId, {
        actionId: deps.newId("act"), threadId: input.threadId, claimId,
        mode: merge ? "merge" : "new",
        ...(merge && (verdict.kind === "duplicate" || verdict.kind === "similar") ? { targetClaimId: verdict.existingId } : {}),
      });
      results.push(merge
        ? { claimId, outcome: "merged_into_existing", personalClaimId: projectClaimId }
        : verdict.kind === "similar" ? { claimId, outcome: "coexisting", personalClaimId: projectClaimId } : { claimId, outcome: "promoted", personalClaimId: projectClaimId });
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
