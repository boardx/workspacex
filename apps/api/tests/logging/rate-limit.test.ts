/**
 * `decideRateLimit` -- pure function, same style as `domain/auth/lockout.ts`'s
 * `decideLockout` test coverage. Burst and expiry behaviour asserted against an injected
 * `now`, per the review's ask for "executable burst/expiry evidence" on PR #2475.
 */
import { describe, expect, it } from "vitest";
import { decideRateLimit } from "../../src/domain/system/rate-limit";

const WINDOW_MS = 60_000;
const MAX = 3;

describe("decideRateLimit", () => {
  it("under the limit -> allowed", () => {
    const now = 1_000_000;
    const verdict = decideRateLimit([now - 100, now - 200], now, WINDOW_MS, MAX);
    expect(verdict).toEqual({ allowed: true, retryAfterMs: null });
  });

  it("burst: exactly at the limit -> the NEXT hit is refused", () => {
    const now = 1_000_000;
    const hits = [now - 300, now - 200, now - 100]; // 3 hits, MAX = 3
    const verdict = decideRateLimit(hits, now, WINDOW_MS, MAX);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterMs).not.toBeNull();
  });

  it("expiry: a hit exactly at the window boundary is retryAfterMs=0, not negative", () => {
    const now = 1_000_000;
    const hits = [now - WINDOW_MS, now - 500, now - 400]; // oldest is exactly windowMs old
    const verdict = decideRateLimit(hits, now, WINDOW_MS, MAX);
    expect(verdict.allowed).toBe(false);
    expect(verdict.retryAfterMs).toBe(0);
  });

  it("retryAfterMs counts down from the OLDEST hit in the window, not the newest", () => {
    const now = 1_000_000;
    const hits = [now - 10_000, now - 5_000, now - 1_000];
    const verdict = decideRateLimit(hits, now, WINDOW_MS, MAX);
    // oldest hit ages out at (now - 10_000) + WINDOW_MS = now + 50_000
    expect(verdict.retryAfterMs).toBe(50_000);
  });

  it("empty hit log -> always allowed", () => {
    expect(decideRateLimit([], 0, WINDOW_MS, MAX)).toEqual({ allowed: true, retryAfterMs: null });
  });
});
