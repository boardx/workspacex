/**
 * Account lockout -- invariant I-3, ruling O-28 ③.
 *
 * "5 consecutive failures in a 15-minute rolling window => the account is locked for 15
 * minutes." A pure function over the attempt log, so the rule can be tested without a
 * database, a clock or an HTTP request.
 *
 * ## The clause that makes this a real control
 *
 * While locked, a CORRECT password is refused too (`ACCOUNT_LOCKED`, not a session). That
 * is the entire point: if a correct password still works during the lockout, the lockout
 * only inconveniences the legitimate owner and does nothing to the attacker, who is going
 * to hit the right password eventually and will simply not notice the counter.
 *
 * Which is why `decideLockout` is consulted BEFORE the password is verified, and why the
 * test asserts BOTH directions -- locked => correct password refused, and after the window
 * => login works. "Rejects while locked" alone is satisfied by rejecting always.
 *
 * ## Consecutive, not cumulative
 *
 * A successful login clears the streak. Counting cumulative failures would lock out
 * somebody who mistypes once a week for two months, which trains users to treat the
 * lockout as noise.
 */
import { auth as C } from "@repo/contracts";

export type AttemptOutcome = "ok" | "bad-credential";

/** One row of the attempt log. `at` is epoch milliseconds -- comparable, and timezone-free. */
export interface LoginAttempt {
  readonly at: number;
  readonly outcome: AttemptOutcome;
}

export interface LockoutVerdict {
  readonly locked: boolean;
  /** epoch ms at which the lock lifts; null when not locked. Drives the "try again in N minutes" copy. */
  readonly lockedUntil: number | null;
  /** How many consecutive failures are currently counted, for the log. Never returned to the client. */
  readonly consecutiveFailures: number;
}

export const LOCK_WINDOW_MS = C.AUTH_POLICY.lockWindowMinutes * 60_000;
export const LOCK_DURATION_MS = C.AUTH_POLICY.lockDurationMinutes * 60_000;

/**
 * @param attempts attempts for ONE email, any order; only those inside the window matter.
 *                 ⚠ Callers pass attempts selected by EMAIL, never by IP -- see the note in
 *                 migration 0010 for why, and for the conflict with uc-1-1 R4 E1.
 * @param now      epoch ms. Injected rather than read from `Date.now()` so the "the window
 *                 expires and login works again" half of I-3 can be asserted without a
 *                 15-minute sleep in the test suite.
 */
export function decideLockout(attempts: readonly LoginAttempt[], now: number): LockoutVerdict {
  const windowStart = now - LOCK_WINDOW_MS;
  // Newest first, so "consecutive" is read backwards from the present.
  const recent = attempts.filter((a) => a.at > windowStart).sort((a, b) => b.at - a.at);

  let consecutive = 0;
  let oldestFailureInStreak = 0;
  for (const a of recent) {
    if (a.outcome === "ok") break; // a success ends the streak
    consecutive += 1;
    oldestFailureInStreak = a.at;
  }

  if (consecutive < C.AUTH_POLICY.lockAfterFails) {
    return { locked: false, lockedUntil: null, consecutiveFailures: consecutive };
  }

  // The lock runs from the attempt that CROSSED the threshold, not from the latest attempt.
  //
  // Measuring from the latest attempt means an attacker who keeps hammering extends the
  // lock indefinitely -- which sounds severe but is actually a denial-of-service against
  // the account's real owner, granted for free to anyone who knows their email address.
  //
  // `recent` is NEWEST-first, so the Nth failure in chronological order sits at index
  // (consecutive - N). For the threshold-crossing failure, N = lockAfterFails.
  // (Getting this index backwards is invisible when the streak is exactly at the
  // threshold -- the two expressions coincide there -- and only diverges once the attacker
  // keeps going, which is the case that matters.)
  const streak = recent.slice(0, consecutive);
  const crossing = streak[consecutive - C.AUTH_POLICY.lockAfterFails]?.at ?? oldestFailureInStreak;
  const lockedUntil = crossing + LOCK_DURATION_MS;
  if (now >= lockedUntil) {
    // The window has passed. Still report the streak so the caller can log it.
    return { locked: false, lockedUntil: null, consecutiveFailures: consecutive };
  }
  return { locked: true, lockedUntil, consecutiveFailures: consecutive };
}
