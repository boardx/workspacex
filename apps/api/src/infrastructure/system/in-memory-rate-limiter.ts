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
 * ## Why a `Map`, not `setInterval` cleanup
 *
 * Pruning expired timestamps happens lazily on the next `hit()` for that same key (see
 * `decideRateLimit`'s caller-filters-first contract) -- no background timer to leak if this
 * class is ever constructed more than once (e.g. in a test). A key that never gets hit again
 * keeps a small array around until process exit; at the scale this guards (one write
 * endpoint, `CLIENT_ERROR_REPORT_MAX_PER_WINDOW` entries per active IP) that is not a
 * meaningful leak.
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
    // Record the attempt regardless of verdict -- a caller hammering past the limit must not
    // get a FRESH window's worth of budget back just by trying again immediately; only the
    // filter above (age > windowMs) ever removes an entry.
    existing.push(now);
    this.hits.set(key, existing);
    return verdict;
  }
}
