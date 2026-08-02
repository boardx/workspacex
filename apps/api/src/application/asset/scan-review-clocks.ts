/**
 * `ScanReviewClocks` (F138 -- T1 half only) -- `uc-23-6` R3 步骤 1 / R9 "必须是主动扫描".
 *
 * 🔴 **This use case implements ONLY the `active -> pending-review` sweep (T1).** The contract's
 * `scanReviewClocks.out` shape also has a `downgraded` field (the 30-day, `pending-review ->
 * downgraded` sweep, T2) -- that field is always `[]` here. This is not a stub masquerading as
 * done: T2 is F139's feature (scan-based degradation, AG3/Q-7's territory -- see
 * `domain/asset/asset-review-clock.ts`'s header for why the 30-day number does not belong in
 * this bundle). F139 is expected to extend this SAME function (or call it and layer its own
 * `pending-review` sweep on top) rather than write a second `ScanReviewClocks` implementation --
 * there must be exactly one place `POST /review-clocks/scan` is handled.
 *
 * `lastScanAt` is always `now` (R9's "最近一次扫描时间必须可观测, 扫描停摆时该指标变旧") --
 * every call, even one that transitions nothing, still proves the scan ran.
 *
 * ⚠ **Deliberately NOT lazy-evaluated.** This only does work when actually invoked, and nothing
 * here derives `active -> pending-review` from a read path (`getReviewClock` never mutates
 * state) -- R9's warning is that lazy evaluation would make the "30 天无人复核" downgrade never
 * fire for assets nobody reads. This file's job is to be the thing a scheduler/cron calls; it
 * does not itself schedule anything (that wiring is infrastructure, out of this bundle's scope).
 */
import { assetGovernance as C } from "@repo/contracts";
import type { z } from "zod";
import { isReviewDue, transitionToPendingReview } from "../../domain/asset/asset-review-clock";
import type { ReviewClockRepository } from "./ports";

export type ScanReviewClocksResult = z.infer<typeof C.operations.scanReviewClocks.out>;

export interface ScanReviewClocksDeps {
  readonly reviewClocks: ReviewClockRepository;
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

  // F139's territory (see file header): the 30-day pending-review -> downgraded sweep.
  const downgraded: Array<{ assetKind: z.infer<typeof C.AssetKind>; assetId: string }> = [];

  return { transitionedToPending, downgraded, lastScanAt: input.now };
}
