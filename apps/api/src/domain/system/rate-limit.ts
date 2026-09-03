/**
 * Fixed-window rate limiting -- a pure function over a hit log, same shape as
 * `domain/auth/lockout.ts`'s `decideLockout` (a rolling window judged against an
 * injected `now`, so burst/expiry behaviour is assertable without a real sleep).
 *
 * ## Why this exists (review finding, PR #2475)
 *
 * `POST /system/client-error-reports` is `@Public()` (see `system-error-logs.ts`'s file
 * header for why an anonymous write path is the right call for this endpoint) -- which
 * means every valid request schedules an `error_logs` INSERT with no session to revoke.
 * Contract-level `.max()` bounds on each field close the "unbounded single field" half of
 * that gap; this closes the other half -- unlimited REQUEST VOLUME from one source.
 *
 * ## Why keyed by IP here, unlike `login_attempts` (deliberately keyed by EMAIL)
 *
 * `0010-auth-credentials-sessions.sql`'s header explains why login lockout counts by email,
 * not IP: per-IP counting on an ACCOUNT control locks out an entire shared office behind one
 * NAT while an attacker rotates source addresses for free -- it inverts who gets hurt. That
 * argument is about a control that can lock a real person out of their own account. This
 * control has no such failure mode: the worst case of an IP hitting its window is "this
 * report is dropped, try later" on a diagnostic side-channel nobody is otherwise blocked
 * from using the product by. There is also no `email`/session identity available here at
 * all -- the endpoint is intentionally reachable before login -- so IP is the only dimension
 * that exists to key on.
 *
 * ## Why fixed-window, not sliding, and why in-memory (see the adapter, not this file)
 *
 * A fixed window is simpler to reason about and to test than a sliding one, and the
 * difference only matters at the window boundary, which is not a meaningfully different
 * risk here (`RETENTION_DAYS`-style "best effort, not a guarantee" honesty applies: see the
 * in-memory adapter's own header for what this control does NOT protect against).
 */

export interface RateLimitVerdict {
  readonly allowed: boolean;
  /** epoch ms at which the window resets; present only when `allowed` is false. */
  readonly retryAfterMs: number | null;
}

export const CLIENT_ERROR_REPORT_WINDOW_MS = 60_000;
export const CLIENT_ERROR_REPORT_MAX_PER_WINDOW = 20;

/**
 * @param hitsInWindow epoch-ms timestamps of prior hits for this key that the caller has
 *                      ALREADY filtered to `now - windowMs .. now` (the adapter's job, not
 *                      this function's -- this function only counts and decides).
 */
export function decideRateLimit(
  hitsInWindow: readonly number[],
  now: number,
  windowMs: number = CLIENT_ERROR_REPORT_WINDOW_MS,
  maxPerWindow: number = CLIENT_ERROR_REPORT_MAX_PER_WINDOW,
): RateLimitVerdict {
  if (hitsInWindow.length < maxPerWindow) {
    return { allowed: true, retryAfterMs: null };
  }
  const oldest = Math.min(...hitsInWindow);
  return { allowed: false, retryAfterMs: Math.max(0, oldest + windowMs - now) };
}
