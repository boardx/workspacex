/**
 * `RateLimiterPort` implementation -- an in-process fixed window, keyed by whatever string
 * the caller passes (today: `POST /system/client-error-reports`'s caller IP).
 *
 * ## What this control does NOT protect against (named, not hidden)
 *
 * Same discipline as `pg-error-log-writer.ts`'s "best-effort, NOT a guarantee" retention
 * header: state lives in process memory, so it is scoped to ONE running instance and reset
 * on every restart or deploy. A horizontally-scaled deployment (N API instances behind a
 * load balancer) gives an attacker N times the effective budget, and a deploy resets
 * everyone's counter to zero. Closing that gap needs a shared store (Redis, which this
 * codebase already uses for session tokens -- see `SESSION_TOKEN_STORE`) and is a real
 * follow-up, not silently promised here. What this DOES close: the previously-true "any
 * number of requests from any one source, forever" -- which was the actual finding.
 *
 * ## Storage IS bounded per key, even under a flood past the limit (review finding, PR #2475)
 *
 * A first version of this file pushed `now` on EVERY call, allowed or not -- so a caller
 * hammering one key past its budget grew that key's array without bound: unbounded memory,
 * and every subsequent call paid an O(n) filter over an ever-growing array. That is exactly
 * backwards for a control whose entire job is to bound the cost of a flood.
 *
 * The fix: `hit()` only appends when the verdict is `allowed`. Once a key is at its budget
 * (`maxPerWindow` un-expired entries), every further call in the same window is refused
 * WITHOUT growing the array -- the stored count for any key is bounded by `maxPerWindow`
 * (until entries age out, pruned lazily on the next call for that key, same as before).
 * `size()` exists for exactly this: to make "bounded, not just cheaper" assertable in a test
 * rather than inferred from reading the implementation.
 *
 * ## Why a `Map`, not `setInterval` cleanup
 *
 * Pruning expired timestamps happens lazily on the next `hit()` for that same key -- no
 * background timer to leak if this class is ever constructed more than once (e.g. in a
 * test). A key that never gets hit again keeps a small (now genuinely bounded) array around
 * until process exit.
 */
import type { Clock } from "../../application/auth/ports";
import type { RateLimiterPort } from "../../application/ports/rate-limiter.port";
import {
  CLIENT_ERROR_REPORT_MAX_PER_WINDOW,
  CLIENT_ERROR_REPORT_WINDOW_MS,
  decideRateLimit,
  type RateLimitVerdict,
} from "../../domain/system/rate-limit";

export class InMemoryRateLimiter implements RateLimiterPort {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock,
    private readonly windowMs: number = CLIENT_ERROR_REPORT_WINDOW_MS,
    private readonly maxPerWindow: number = CLIENT_ERROR_REPORT_MAX_PER_WINDOW,
  ) {}

  async hit(key: string): Promise<RateLimitVerdict> {
    const now = this.clock.now().getTime();
    const existing = (this.hits.get(key) ?? []).filter((t) => t > now - this.windowMs);
    const verdict = decideRateLimit(existing, now, this.windowMs, this.maxPerWindow);
    // ⚠ Only append on an ALLOWED hit -- see this file's header. A denied hit must not grow
    //   the stored array; that is what keeps a flood past the limit O(1) in storage and O(k)
    //   (k = maxPerWindow, a constant) in per-call work, not O(number of requests ever sent).
    if (verdict.allowed) {
      existing.push(now);
    }
    this.hits.set(key, existing);
    return verdict;
  }

  /**
   * Current stored (un-pruned-by-this-call) entry count for `key`. Not part of
   * `RateLimiterPort` -- exists so a test can assert "bounded" as a number instead of
   * inferring it from reading `hit()`'s body. Harmless to expose: it reveals nothing beyond
   * "how many recent hits", which is the entire point of a rate limiter's state.
   */
  size(key: string): number {
    return this.hits.get(key)?.length ?? 0;
  }
}
