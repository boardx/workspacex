/**
 * `GetReviewClock` (F138) -- `uc-23-6` 消费面. Read-only; same requester gate as
 * `GetAssetDirectory` (org membership only, no project-role check -- reading a review clock is
 * not scoped to a project).
 *
 * ⚠ **Never-published asset -> synthesized `active` clock with all-null timestamps, not a 404.**
 * `getAssetGovernance` already establishes the precedent that "never configured" is a `null`
 * governance record, not an org-scope-style denial; a review clock that has never started
 * ticking is the same kind of fact (`ReviewClock.publishedAt === null` IS the "never published"
 * signal a caller checks), not a different error surface.
 */
import { assetGovernance as C } from "@repo/contracts";
import type { z } from "zod";
import type { ReviewClockRecord } from "../../domain/asset/asset-review-clock";
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { ReviewClockRepository } from "./ports";
import { AssetOrgScopeDeniedError } from "./get-asset-directory";

export type GetReviewClockResult = z.infer<typeof C.operations.getReviewClock.out>;

export interface GetReviewClockDeps {
  readonly repo: Pick<IdentityRepository, "findOrgMembership">;
  readonly reviewClocks: ReviewClockRepository;
}

export interface GetReviewClockInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly assetKind: z.infer<typeof C.AssetKind>;
  readonly assetId: string;
}

function synthesize(assetKind: string, assetId: string): ReviewClockRecord {
  return {
    assetKind,
    assetId,
    state: "active",
    publishedAt: null,
    reviewDueAt: null,
    downgradeDueAt: null,
    lastReviewedAt: null,
    lastReviewedBy: null,
  };
}

export async function getReviewClock(deps: GetReviewClockDeps, input: GetReviewClockInput): Promise<GetReviewClockResult> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  if (membership === null) throw new AssetOrgScopeDeniedError();

  const record = (await deps.reviewClocks.get(input.assetKind, input.assetId)) ?? synthesize(input.assetKind, input.assetId);

  return {
    clock: {
      assetKind: record.assetKind as z.infer<typeof C.AssetKind>,
      assetId: record.assetId,
      state: record.state,
      publishedAt: record.publishedAt,
      reviewDueAt: record.reviewDueAt,
      downgradeDueAt: record.downgradeDueAt,
      lastReviewedAt: record.lastReviewedAt,
      lastReviewedBy: record.lastReviewedBy,
    },
  };
}
