/**
 * `ScanReviewClocks` (F138 T1 + F139 T2) -- `uc-23-6` R3 步骤 1/3 / R9 "必须是主动扫描".
 *
 * 🔴 **This is the ONE function handling `POST /review-clocks/scan` -- F139 extends F138's
 * function in place rather than forking a second implementation** (per F138's own PR note and
 * this file's original header). Both sweeps live here:
 *   - T1 (`active -> pending-review`, F138): unchanged from before.
 *   - T2 (`pending-review -> downgraded`, F139, AG3/Q-7's 30-day rule): reads every
 *     `pending-review` clock via `listPendingReview`, asks the domain's `isDowngradeDue`
 *     whether its `downgradeDueAt` (populated by T1's own transition, see
 *     `asset-review-clock.ts`) has arrived, and if so writes the "仅负责人可见" collapse through
 *     `writeAssetGovernanceVisibility` -- the SAME single write path `setAssetGovernance` uses
 *     (I-14; see `apps/api/tests/asset/visibility-single-write-path.test.ts`). There is
 *     deliberately no inline `governance.set(...)` call in this file.
 *
 * 🔴 **R12 验收线索 8 -- the reverse-proof this feature exists to satisfy**: an asset that has
 * NEVER been read/called even once since its review became due must still be downgraded here,
 * because this sweep is driven entirely by `listPendingReview()` + stored `downgradeDueAt`, not
 * by anything a caller's read path does. A lazily-evaluated ("`EvaluateOnRead…`") implementation
 * would make this rule only fire for assets someone happens to look at -- exactly backwards,
 * since the never-called ones are the ones most likely to have gone stale.
 *
 * `lastScanAt` is always `now` (R9's "最近一次扫描时间必须可观测, 扫描停摆时该指标变旧") --
 * every call, even one that transitions/downgrades nothing, still proves the scan ran.
 *
 * ⚠ **Deliberately NOT lazy-evaluated.** Nothing here derives either transition from a read path
 * (`getReviewClock` never mutates state). This file's job is to be the thing a scheduler/cron
 * calls; it does not itself schedule anything (that wiring is infrastructure, out of scope).
 *
 * ⚠ **Owner-missing (E1, `ASSET_DOWNGRADED_OWNER_MISSING`) is left undecided on purpose.** R7's
 * own text (`uc-23-6` R12 验收线索 13) says this case has no ruling yet ("按 E1 裁决结果断言
 * （未裁前不写验收，但必须有一条）") -- there is no port here that can answer "is this owner's
 * account deactivated", so this sweep does not invent one. If `governance.get` ever returns
 * `null` for a clock that is `pending-review` (should not happen -- a clock only exists once
 * `PublishAsset` has already required governance), that record is skipped rather than guessed at.
 */
import { assetGovernance as C } from "@repo/contracts";
import type { z } from "zod";
import {
  isDowngradeDue,
  isReviewDue,
  transitionToDowngraded,
  transitionToPendingReview,
} from "../../domain/asset/asset-review-clock";
import type { AssetGovernanceRepository, ReviewClockRepository } from "./ports";
import { writeAssetGovernanceVisibility } from "./write-asset-visibility";

export type ScanReviewClocksResult = z.infer<typeof C.operations.scanReviewClocks.out>;

export interface ScanReviewClocksDeps {
  readonly reviewClocks: ReviewClockRepository;
  readonly governance: AssetGovernanceRepository;
}

export interface ScanReviewClocksInput {
  readonly now: string;
}

export async function scanReviewClocks(
  deps: ScanReviewClocksDeps,
  input: ScanReviewClocksInput,
): Promise<ScanReviewClocksResult> {
  const active = await deps.reviewClocks.listActive();
  const transitionedToPending: Array<{ assetKind: z.infer<typeof C.AssetKind>; assetId: string }> = [];

  for (const record of active) {
    if (!isReviewDue(record, input.now)) continue;
    const updated = transitionToPendingReview(record, input.now);
    await deps.reviewClocks.save(updated);
    transitionedToPending.push({ assetKind: record.assetKind as z.infer<typeof C.AssetKind>, assetId: record.assetId });
  }

  // F139 -- T2: `pending-review -> downgraded`, the 30-day-no-review sweep (AG3/Q-7).
  const pendingReview = await deps.reviewClocks.listPendingReview();
  const downgraded: Array<{ assetKind: z.infer<typeof C.AssetKind>; assetId: string }> = [];

  for (const record of pendingReview) {
    if (!isDowngradeDue(record, input.now)) continue;

    const assetKind = record.assetKind as z.infer<typeof C.AssetKind>;
    const governance = await deps.governance.get(assetKind, record.assetId);
    // No governance on record for a pending-review clock should not happen (see file header) --
    // skip rather than fabricate an owner-missing verdict E1 has not settled.
    if (governance === null) continue;

    await writeAssetGovernanceVisibility({ governance: deps.governance }, assetKind, record.assetId, {
      ...governance,
      visibility: "private-draft",
      teamIds: [],
    });

    const updatedClock = transitionToDowngraded(record, input.now);
    await deps.reviewClocks.save(updatedClock);
    downgraded.push({ assetKind, assetId: record.assetId });
  }

  return { transitionedToPending, downgraded, lastScanAt: input.now };
}
