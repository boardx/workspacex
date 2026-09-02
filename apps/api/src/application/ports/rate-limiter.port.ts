/**
 * A generic "how many hits has this key had recently" port. See
 * `domain/system/rate-limit.ts` for the pure decision function this wraps, and its own file
 * header for why the first (and today only) caller — `POST /system/client-error-reports` —
 * needs this at all.
 */
import type { RateLimitVerdict } from "../../domain/system/rate-limit";

export interface RateLimiterPort {
  /** Records one hit for `key` and returns whether it is still within the window's budget. */
  hit(key: string): Promise<RateLimitVerdict>;
}

export const RATE_LIMITER_PORT = Symbol("RateLimiterPort");
