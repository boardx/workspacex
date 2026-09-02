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
 * ## Storage is bounded PER KEY (review finding, PR #2475, round 1)
 *
 * A first version of this file pushed `now` on EVERY call, allowed or not -- so a caller
 * hammering one key past its budget grew that key's array without bound. The fix: `hit()`
 * only appends when the verdict is `allowed`. Once a key is at its budget (`maxPerWindow`
 * un-expired entries), every further call in the same window is refused WITHOUT growing that
 * key's array -- bounded by `maxPerWindow` per key, until entries age out.
 *
 * ## Storage is ALSO bounded across the TOTAL number of keys (review finding, round 2)
 *
 * Per-key bounding alone does not bound the `Map` itself: an anonymous caller population
 * using many distinct keys (many source IPs) grows the number of MAP ENTRIES without limit,
 * even though each individual entry stays small. `MAX_TRACKED_KEYS` closes that: once the
 * map would exceed it, `evictOverCapacity` runs, preferring to drop keys whose stored hits
 * are ALL already expired (a real cleanup, not a loss of active state), and only falling
 * back to dropping the oldest-inserted keys (FIFO -- `Map` preserves insertion order, and
 * `.set()` on an EXISTING key does not move it) if expired-only eviction is not enough to
 * get back under the cap. The fallback CAN evict a still-active key under a truly massive
 * distinct-key flood -- that is the accepted cost of a bound that needs no shared store; it
 * is strictly better than the prior unbounded-map behaviour, not a claim of perfect fairness.
 *
 * ## Why a `Map`, not `setInterval` cleanup
 *
 * Pruning happens lazily on `hit()` -- no background timer to leak if this class is ever
 * constructed more than once (e.g. in a test). `evictOverCapacity` only runs when the map is
 * actually over `MAX_TRACKED_KEYS`, so a normal (under-cap) workload never pays its cost.
 */
import type { Clock } from "../../application/auth/ports";
import type { RateLimiterPort } from "../../application/ports/rate-limiter.port";
import {
  CLIENT_ERROR_REPORT_MAX_PER_WINDOW,
  CLIENT_ERROR_REPORT_WINDOW_MS,
  decideRateLimit,
  type RateLimitVerdict,
} from "../../domain/system/rate-limit";

/**
 * Upper bound on distinct keys tracked at once. Generous relative to this control's actual
 * scale (one write endpoint) -- sized to make a distinct-IP flood cost memory, not to be a
 * tight budget a legitimate traffic pattern could ever brush against.
 */
export const DEFAULT_MAX_TRACKED_KEYS = 50_000;

export class InMemoryRateLimiter implements RateLimiterPort {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly clock: Clock,
    private readonly windowMs: number = CLIENT_ERROR_REPORT_WINDOW_MS,
    private readonly maxPerWindow: number = CLIENT_ERROR_REPORT_MAX_PER_WINDOW,
    private readonly maxTrackedKeys: number = DEFAULT_MAX_TRACKED_KEYS,
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

    if (this.hits.size > this.maxTrackedKeys) {
      this.evictOverCapacity(now);
    }
    return verdict;
  }

  /**
   * Brings `this.hits.size` back to `maxTrackedKeys`, preferring to drop keys with no live
   * (un-expired) entries left before falling back to FIFO eviction of the oldest-inserted
   * keys. See this file's header for why each pass exists.
   */
  private evictOverCapacity(now: number): void {
    for (const [k, timestamps] of this.hits) {
      if (this.hits.size <= this.maxTrackedKeys) return;
      if (timestamps.every((t) => t <= now - this.windowMs)) {
        this.hits.delete(k);
      }
    }
    if (this.hits.size <= this.maxTrackedKeys) return;
    for (const k of this.hits.keys()) {
      if (this.hits.size <= this.maxTrackedKeys) return;
      this.hits.delete(k);
    }
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

  /** Total distinct keys currently tracked. Test-only, same rationale as `size()`. */
  trackedKeyCount(): number {
    return this.hits.size;
  }
}
