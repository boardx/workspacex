/**
 * `ReviewAsset` (F138) -- `uc-23-6` R3 步骤 4 / R6 "复核 ⇒ 一条复核记录 + 计时重置" / R7 规则 8.
 *
 * 🔴 **`conclusion` is an open string, on purpose** -- `asset-governance.ts`'s
 * `KNOWN_CONTRACT_GAPS.AG2` is explicit that its value set has zero prototype hits. This use
 * case does not brand it, does not validate it against any enum, and does not branch on it.
 * "复核发生过" is the only fact this function asserts; that is the entirety of what R7 rule 8
 * lets anyone assert today (see `applyReview`'s header in `domain/asset/asset-review-clock.ts`).
 *
 * Editability gate reuses `SetAssetGovernance`'s existing rule (owner or `editableBy` member) --
 * R5 says "资产负责人：执行复核", and the "可改集合内的其他人能否代为复核" question (`[待确认]`)
 * is exactly the same open question `Q-9` already raises for governance edits. Reusing the same
 * gate here, rather than inventing a narrower "owner only" check, does not answer Q-9 -- it just
 * avoids declaring a SECOND, stricter answer to a question that is already open in one place.
 *
 * If no clock exists yet (asset was never published), there is nothing to review -- this throws
 * the same `AssetNotEditableError` as "you may not act on this asset's governance", since a
 * never-published asset has no owner/editableBy-gated review action to perform either way.
 */
import { assetGovernance as C } from "@repo/contracts";
import type { z } from "zod";
import { applyReview, type ReviewClockRecord } from "../../domain/asset/asset-review-clock";
import type { OrgId } from "../../domain/org-id";
import type { Clock } from "../auth/ports";
import type { IdentityRepository } from "../identity/ports";
import type { AssetGovernanceRepository, ReviewClockRepository } from "./ports";
import { AssetOrgScopeDeniedError } from "./get-asset-directory";
import { AssetNotEditableError } from "./set-asset-governance";

export type ReviewAssetResult = z.infer<typeof C.operations.reviewAsset.out>;

export interface ReviewAssetDeps {
  readonly repo: Pick<IdentityRepository, "findOrgMembership">;
  readonly governance: AssetGovernanceRepository;
  readonly reviewClocks: ReviewClockRepository;
  readonly clock: Clock;
}

export interface ReviewAssetInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly assetKind: z.infer<typeof C.AssetKind>;
  readonly assetId: string;
  readonly conclusion: string;
}

function toClockOut(record: ReviewClockRecord): z.infer<typeof C.ReviewClock> {
  return {
    assetKind: record.assetKind as z.infer<typeof C.AssetKind>,
    assetId: record.assetId,
    state: record.state,
    publishedAt: record.publishedAt,
    reviewDueAt: record.reviewDueAt,
    downgradeDueAt: record.downgradeDueAt,
    lastReviewedAt: record.lastReviewedAt,
    lastReviewedBy: record.lastReviewedBy,
  };
}

export async function reviewAsset(deps: ReviewAssetDeps, input: ReviewAssetInput): Promise<ReviewAssetResult> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  if (membership === null) throw new AssetOrgScopeDeniedError();

  const governance = await deps.governance.get(input.assetKind, input.assetId);
  if (governance === null) throw new AssetNotEditableError();
  if (governance.ownerId !== input.userId && !governance.editableBy.includes(input.userId)) {
    throw new AssetNotEditableError();
  }

  const existing = await deps.reviewClocks.get(input.assetKind, input.assetId);
  if (existing === null) throw new AssetNotEditableError();

  const reviewedAt = deps.clock.now().toISOString();
  const updated = applyReview(existing, input.userId, reviewedAt, governance.reviewCycle);
  await deps.reviewClocks.save(updated);

  // `input.conclusion` is intentionally not persisted anywhere here beyond having been accepted
  // by the contract's open-string schema -- see file header (AG2). A future audit trail for
  // "what did the review conclude" is not this feature's scope to invent.

  return { clock: toClockOut(updated) };
}
