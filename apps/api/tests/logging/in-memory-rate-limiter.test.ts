/**
 * `InMemoryRateLimiter` -- the adapter wired to `RATE_LIMITER_PORT`. Uses a fake `Clock`
 * (same pattern as `domain/auth/lockout.ts`'s tests) so burst/expiry is asserted without a
 * real sleep -- see `rate-limit.test.ts` for the pure decision function this wraps.
 */
import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "../../src/infrastructure/system/in-memory-rate-limiter";
import type { Clock } from "../../src/application/auth/ports";

function fakeClock(startMs: number): Clock & { advance(ms: number): void } {
  let t = startMs;
  return {
    now: () => new Date(t),
    advance(ms: number) {
      t += ms;
    },
  };
}

describe("InMemoryRateLimiter", () => {
  it("allows up to maxPerWindow hits for one key, then refuses the next", async () => {
    const clock = fakeClock(0);
    const limiter = new InMemoryRateLimiter(clock, 60_000, 3);

    expect((await limiter.hit("ip-a")).allowed).toBe(true);
    expect((await limiter.hit("ip-a")).allowed).toBe(true);
    expect((await limiter.hit("ip-a")).allowed).toBe(true);
    const fourth = await limiter.hit("ip-a");
    expect(fourth.allowed).toBe(false);
    expect(fourth.retryAfterMs).not.toBeNull();
  });

  it("different keys have independent budgets", async () => {
    const clock = fakeClock(0);
    const limiter = new InMemoryRateLimiter(clock, 60_000, 1);

    expect((await limiter.hit("ip-a")).allowed).toBe(true);
    expect((await limiter.hit("ip-a")).allowed).toBe(false);
    // ip-b has never hit -- its own budget is untouched by ip-a's.
    expect((await limiter.hit("ip-b")).allowed).toBe(true);
  });

  it("expiry: once the window has fully elapsed, the budget resets", async () => {
    const clock = fakeClock(0);
    const limiter = new InMemoryRateLimiter(clock, 60_000, 1);

    expect((await limiter.hit("ip-a")).allowed).toBe(true);
    expect((await limiter.hit("ip-a")).allowed).toBe(false);

    clock.advance(60_001);
    expect((await limiter.hit("ip-a")).allowed).toBe(true);
  });
});
