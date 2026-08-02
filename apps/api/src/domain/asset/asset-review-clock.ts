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

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * F138 -- `uc-23-6` R3 状态机（① 计时器 + 到期转 `待复核`；R7 规则 1/2/3；R12 验收线索 1/2/7）
 *
 * 🔴 **This is the shared shape F139 (30-day scan-based downgrade) and F140 (visibility write
 * path + orphaned-asset handoff) build on next.** It is kept deliberately narrow: everything
 * here is the `active <-> pending-review` half of the three-state machine (`ReviewClockState`
 * in `@repo/contracts/asset-governance`). The `pending-review -> downgraded` transition (the
 * "30 天" number, AG3/Q-7) is NOT implemented here and this file never writes that literal --
 * that is F139's territory by design, per the contract's own `KNOWN_CONTRACT_GAPS.AG3` warning
 * ("谁先写谁就是本仓第九次同一事实两处声明").
 *
 * Exports for F139/F140 to reuse:
 *   - `ReviewClockRecord` -- the persisted shape (mirrors the contract's `ReviewClock`, minus
 *     zod wrapping) that any repository/port dealing with review clocks should key off.
 *   - `isReviewDue(record, nowIso)` -- pure T1 predicate (`active` && `reviewDueAt <= now`).
 *     F139's scan can reuse this unchanged for the first half of its sweep.
 *   - `transitionToPendingReview(record, nowIso)` -- pure T1 transition. Leaves
 *     `downgradeDueAt: null` on purpose: this file does not decide when a `pending-review`
 *     record becomes overdue for downgrade -- F139 is expected to either derive that from
 *     `reviewDueAt` at scan time, or to populate `downgradeDueAt` at the moment it needs the
 *     30-day answer, once Q-7 is settled. Do not backfill a `+ 30 days` computation into this
 *     transition without re-reading AG3 first.
 *   - `applyReview(record, reviewedBy, reviewedAtIso, reviewCycle)` -- pure T3 transition
 *     (`uc-23-6` R3 步骤 4 / R6 "复核 ⇒ 计时重置"). Always returns to `active` with a freshly
 *     derived `reviewDueAt` (via `deriveReviewDueAt` above, so the two "reviewDueAt" derivations
 *     in this bundle are the SAME function, not a second declaration) and clears
 *     `downgradeDueAt` regardless of which state it was called from (R3's diagram shows `复核`
 *     arrows leaving both `待复核` and, per E2/E4, possibly `downgraded` -- this function does
 *     not gate on the current state because R7 rule 8 has no defined `conclusion` semantics to
 *     gate on; it only asserts "review happened ⇒ clock resets", which is all R7 rule 8 lets
 *     anyone assert today).
 */
export type ReviewClockStateValue = "active" | "pending-review" | "downgraded";

/** Mirrors `@repo/contracts/asset-governance`'s `ReviewClock` shape (kept dependency-free here). */
export interface ReviewClockRecord {
  readonly assetKind: string;
  readonly assetId: string;
  readonly state: ReviewClockStateValue;
  readonly publishedAt: string | null;
  readonly reviewDueAt: string | null;
  /** null unless `state === "pending-review"` (F139/Q-7 territory -- see file header). */
  readonly downgradeDueAt: string | null;
  readonly lastReviewedAt: string | null;
  readonly lastReviewedBy: string | null;
}

/**
 * T1 predicate (`uc-23-6` R2 触发条件 T1): true only when the clock is still `active` and its
 * `reviewDueAt` has arrived. A record already in `pending-review` or `downgraded` is never
 * "due" again by this function -- re-triggering T1 on a record that already transitioned is
 * exactly the kind of second write path R7 rule 6/Q-7 warns against.
 */
export function isReviewDue(record: ReviewClockRecord, nowIso: string): boolean {
  if (record.state !== "active") return false;
  if (record.reviewDueAt === null) return false;
  return record.reviewDueAt <= nowIso;
}

/**
 * T1 transition (`uc-23-6` R3 步骤 1 / R7 规则 1/2/3): `active -> pending-review`.
 *
 * 🔴 **Deliberately does not disable, unbind, or otherwise remove the asset from anything.**
 * The only field this function changes is `state` (and clearing `downgradeDueAt`, F139's to
 * populate). `publishedAt`, `reviewDueAt`, `lastReviewedAt`, `lastReviewedBy` all pass through
 * untouched -- there is nothing in R7 rule 1/2 that says the expiry moment erases when the
 * asset was published or last reviewed, and a caller (e.g. a "调用时提示" surface) may want
 * exactly those fields to phrase the prompt ("已过期" needs `reviewDueAt` to still be there
 * after the transition). If the record is not actually due yet, this is a no-op (returns the
 * input unchanged) -- callers should not need to re-check `isReviewDue` themselves.
 */
export function transitionToPendingReview(record: ReviewClockRecord, nowIso: string): ReviewClockRecord {
  if (!isReviewDue(record, nowIso)) return record;
  return { ...record, state: "pending-review", downgradeDueAt: deriveDowngradeDueAt(nowIso) };
}

/* ═══════════════════════════════════════════════════════════════════════════════════════
 * F139 -- `uc-23-6` R3 状态机②（`pending-review -> downgraded`, T2; R7 规则 4/7; R9 主动扫描；
 * R12 验收线索 4/5/8/10）
 *
 * 🔴 **The "30" lives in exactly one place: `PENDING_REVIEW_DOWNGRADE_GRACE_DAYS` below.**
 * `uc-23-4`/`ReviewCycle`'s own header and this file's own header (see top) are explicit that
 * the 30-day number belongs here, not there -- R12 验收线索 12 asks for a single grep hit
 * across the repo for this literal; this constant is that one hit.
 *
 * `deriveDowngradeDueAt` is called from `transitionToPendingReview` above at the moment a clock
 * actually enters `pending-review` (not lazily, not from `reviewDueAt` -- a scan that runs late
 * would otherwise silently shrink the 30-day grace window). This keeps the "when did the 30-day
 * countdown start" answer anchored to the one instant the state machine records it: the T1
 * transition itself.
 */
const PENDING_REVIEW_DOWNGRADE_GRACE_DAYS = 30;

function deriveDowngradeDueAt(pendingSinceIso: string): string {
  const due = new Date(pendingSinceIso);
  due.setUTCDate(due.getUTCDate() + PENDING_REVIEW_DOWNGRADE_GRACE_DAYS);
  return due.toISOString();
}

/**
 * T2 predicate (`uc-23-6` R2 触发条件 T2 / R7 规则 4): true only when the clock is still
 * `pending-review` and its `downgradeDueAt` has arrived. Mirrors `isReviewDue`'s shape on
 * purpose -- same "only fires from the state this transition owns" guard, so a `downgraded`
 * record is never re-swept and an `active` record (never having gone through T1) cannot be
 * downgraded out of turn.
 */
export function isDowngradeDue(record: ReviewClockRecord, nowIso: string): boolean {
  if (record.state !== "pending-review") return false;
  if (record.downgradeDueAt === null) return false;
  return record.downgradeDueAt <= nowIso;
}

/**
 * T2 transition (`uc-23-6` R3 步骤 3 / R7 规则 4/7): `pending-review -> downgraded`.
 *
 * 🔴 **Clock-only.** This function does not touch visibility -- the actual "collapse to
 * owner-only" write goes through `writeAssetGovernanceVisibility` (I-14's single write path),
 * a separate call the use case layer (`scan-review-clocks.ts`) makes alongside saving this
 * transition's result. Mixing the two here would give the clock's pure domain function a side
 * effect on a completely different aggregate (`AssetGovernanceRecord`), which is exactly the
 * kind of second-write-path risk I-14 exists to rule out.
 *
 * `downgradeDueAt` clears back to `null` on entering `downgraded` -- the contract's own comment
 * on `ReviewClock.downgradeDueAt` ("只在 `pending-review` 上有意义") holds after this
 * transition too; a stale downgrade deadline sitting on an already-downgraded record would be a
 * second, dead definition of "when" for a transition that already happened (R7 规则 7:
 * "降级不是删除"，but it is also not a countdown that keeps ticking after it fires).
 */
export function transitionToDowngraded(record: ReviewClockRecord, nowIso: string): ReviewClockRecord {
  if (!isDowngradeDue(record, nowIso)) return record;
  return { ...record, state: "downgraded", downgradeDueAt: null };
}

/**
 * T3 transition (`uc-23-6` R3 步骤 4 / R6 "复核 ⇒ 计时重置"): review happened -> back to
 * `active`, clock restarts from `reviewedAtIso`.
 *
 * `conclusion` is intentionally NOT a parameter here -- `asset-governance.ts`'s
 * `KNOWN_CONTRACT_GAPS.AG2` already registers "`ReviewAsset.conclusion` 的取值集合无依据":
 * this domain function only encodes "复核发生过 ⇒ 计时重置" (R7 rule 8's one settled half),
 * not any branch on what the review concluded. The caller
 * (`application/asset/review-asset.ts`) is free to persist the open-string `conclusion`
 * alongside the audit trail; it never reaches this function because no transition here
 * depends on its value.
 */
export function applyReview(
  record: ReviewClockRecord,
  reviewedBy: string,
  reviewedAtIso: string,
  reviewCycle: ReviewCycleValue,
): ReviewClockRecord {
  return {
    ...record,
    state: "active",
    reviewDueAt: deriveReviewDueAt(reviewedAtIso, reviewCycle),
    downgradeDueAt: null,
    lastReviewedAt: reviewedAtIso,
    lastReviewedBy: reviewedBy,
  };
}
