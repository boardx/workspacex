/**
 * `hoursAgoWithinCurrentMonth` -- shared by `tests/auth/usage-window-aggregation.test.ts`
 * and `tests/auth/limit-rule-crud.test.ts`, both of which need a test data point that is
 * simultaneously "more than `minHours` hours old" (so a short rolling window excludes it)
 * and "still within the current calendar month" (so a month-window aggregate includes it).
 *
 * ## Real incident this fixes (2026-09-01, PR #2440's CI)
 *
 * The first fix for the underlying flake (each file independently hard-coded a fixed
 * offset -- "10 days ago" / "3 days ago" -- which is false whenever the run happens to fall
 * within that many days of a calendar month's start) used a "degrade toward a smaller value
 * near month start" formula (`Math.min(fixedOffset, hoursSinceMonthStart / 2)`). That looked
 * like it handled the edge case, but it only shrinks the window -- it never checked whether
 * the shrunk value still satisfies the CALLER's lower bound (`minHours`). Real CI running
 * ~3.4 hours into September 1st hit exactly this: `hoursSinceMonthStart / 2 ≈ 1.7`, which is
 * LESS than the 5-hour lower bound `usage-window-aggregation.test.ts` needed -- the "recent"
 * event landed inside the "recent" window it was supposed to be excluded from, and the test
 * failed with the assertions swapped (received the sum of both events, not just the first).
 *
 * ## The actual fix: prove a valid offset exists, or say plainly that none does
 *
 * "More than `minHours` hours old" AND "after this calendar month started" are mutually
 * exclusive exactly when `hoursSinceMonthStart <= minHours` -- there is no algebra that
 * produces a value in an empty interval. So this function does not pretend one always
 * exists: it returns `null` in that case, and callers are expected to `it.skip` (with a
 * printed reason) rather than assert something that is not true at the moment the test runs.
 * When a valid interval DOES exist, the returned value is the interval's midpoint
 * (`minHours + (hoursSinceMonthStart - minHours) / 2`, capped at `maxHours`) -- constructed
 * to satisfy both bounds by construction, not by approaching them and hoping.
 */
export function hoursAgoWithinCurrentMonth(maxHours: number, minHours: number): number | null {
  const now = new Date();
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const hoursSinceMonthStart = (now.getTime() - monthStart.getTime()) / 3_600_000;
  if (hoursSinceMonthStart <= minHours) return null;
  return Math.min(maxHours, minHours + (hoursSinceMonthStart - minHours) / 2);
}
