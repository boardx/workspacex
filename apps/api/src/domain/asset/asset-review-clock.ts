/**
 * `deriveReviewDueAt` -- F137 (`uc-23-4` R3 第三项 / R6 逐字 / R7 规则 5, domain invariant
 * `reviewDueAt = publishedAt + reviewCycle`, PublishAsset's own contract comment).
 *
 * 🔴 **This is a derivation, not a field anyone writes directly.** `PublishAsset.out` has no
 * `reviewDueAt` input -- the contract only accepts `{assetKind, assetId, mode}` -- so the ONLY
 * way a `reviewDueAt` comes into existence is by computing it from `publishedAt` and whatever
 * `reviewCycle` the asset's governance record already carries. A caller cannot backdate or
 * front-load a review deadline independent of when the asset was actually published.
 *
 * ⚠ **What this file does NOT do, and why that is not an oversight here (unlike elsewhere in
 * this bundle where the same warning marks an actual gap):** `uc-23-4` R7 rule 5 is explicit
 * that the *30-day-no-review-then-downgrade* rule, and its single source of truth, are `uc-23-6`
 * / Q-7's territory -- "本 UC 不写 6/12/24 个月 与 30 天的语义，只写「有这三档、有这条规则」".
 * That warning is about the DOWNGRADE clock (`ReviewClock.state -> pending-review ->
 * downgraded`, the `30` in "30 天无人复核"), which this file never touches or imports.
 *
 * What THIS file computes is a narrower, already-settled thing: `ReviewCycle`'s three members
 * (`"6m" | "12m" | "24m"`) are not opaque tokens whose real-world meaning is pending a
 * decision -- the literal name IS the meaning ("6m" denotes six calendar months from the
 * moment it starts counting). Turning "six calendar months from `publishedAt`" into a
 * timestamp is arithmetic on a fact the enum itself already states, not a second declaration
 * of what a review cycle means. If Q-7 later redefines what "6m" counts *from* or *in* (e.g.
 * business days instead of calendar months), that redefinition still has exactly one home --
 * this function -- because nothing else in the repository also converts `ReviewCycle` to a
 * date. There is no second implementation to keep in sync.
 */
import type { ReviewCycleValue } from "./asset-governance";

const REVIEW_CYCLE_MONTHS: Readonly<Record<ReviewCycleValue, number>> = {
  "6m": 6,
  "12m": 12,
  "24m": 24,
};

/**
 * `publishedAt` and the return value are both ISO 8601 timestamps (UTC). Calendar-month
 * addition via `setUTCMonth` -- if `publishedAt` lands on the 31st of a month and the target
 * month is shorter, `Date` itself rolls the excess into the following month (native JS
 * semantics, not a bug this function papers over).
 */
export function deriveReviewDueAt(publishedAt: string, reviewCycle: ReviewCycleValue): string {
  const months = REVIEW_CYCLE_MONTHS[reviewCycle];
  const due = new Date(publishedAt);
  due.setUTCMonth(due.getUTCMonth() + months);
  return due.toISOString();
}
