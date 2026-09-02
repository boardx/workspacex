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

  // review finding (PR #2475): a first version pushed a timestamp on EVERY hit, allowed or
  // not, so storage for one flooded key grew without bound. This is the counter-evidence the
  // review asked for: a high-volume denied flood against ONE key must leave that key's stored
  // entry count bounded by maxPerWindow, not by however many requests were actually sent.
  it("a flood of denied hits does not grow stored state past maxPerWindow (bounded storage under attack)", async () => {
    const clock = fakeClock(0);
    const maxPerWindow = 5;
    const limiter = new InMemoryRateLimiter(clock, 60_000, maxPerWindow);

    for (let i = 0; i < 2_000; i++) {
      await limiter.hit("flooded-ip");
    }

    expect(limiter.size("flooded-ip")).toBe(maxPerWindow);
  });

  it("a flood past the limit does not corrupt retryAfterMs -- it stays pinned to the oldest of the (bounded) stored hits", async () => {
    const clock = fakeClock(0);
    const limiter = new InMemoryRateLimiter(clock, 60_000, 3);

    await limiter.hit("ip-a"); // t=0, the oldest of the eventual 3 stored hits
    clock.advance(10);
    await limiter.hit("ip-a"); // t=10
    clock.advance(10);
    await limiter.hit("ip-a"); // t=20, budget now full

    // Every one of these is denied and must NOT push a new timestamp (verified separately by
    // the bounded-storage test above); retryAfterMs must stay anchored to t=0, not drift.
    let last;
    for (let i = 0; i < 50; i++) {
      clock.advance(1);
      last = await limiter.hit("ip-a");
    }
    expect(last!.allowed).toBe(false);
    // oldest stored hit (t=0) ages out at 0 + 60_000; clock is now at 20 + 50 = 70.
    expect(last!.retryAfterMs).toBe(60_000 - 70);
  });

  // review finding (PR #2475, round 2): per-key bounding alone does not bound the Map
  // itself -- an anonymous caller population using many distinct keys grows the number of
  // map ENTRIES without limit even though each individual entry stays small. This is the
  // counter-evidence: a flood of many distinct keys must leave the total tracked-key count
  // bounded by maxTrackedKeys, not by however many distinct keys were actually sent.
  it("a flood of many distinct keys does not grow the total tracked-key count past maxTrackedKeys", async () => {
    const clock = fakeClock(0);
    const maxTrackedKeys = 100;
    const limiter = new InMemoryRateLimiter(clock, 60_000, 20, maxTrackedKeys);

    for (let i = 0; i < 5_000; i++) {
      await limiter.hit(`distinct-ip-${i}`);
    }

    expect(limiter.trackedKeyCount()).toBeLessThanOrEqual(maxTrackedKeys);
  });

  it("eviction prefers keys whose stored hits are ALL expired over still-active keys", async () => {
    const clock = fakeClock(0);
    const maxTrackedKeys = 10;
    const limiter = new InMemoryRateLimiter(clock, 60_000, 5, maxTrackedKeys);

    // Fill to capacity, then let every one of these age out.
    for (let i = 0; i < maxTrackedKeys; i++) {
      await limiter.hit(`stale-${i}`);
    }
    clock.advance(60_001);

    // One fresh, still-active key.
    await limiter.hit("fresh");
    // Pushing the map over capacity (one more distinct key) must trigger eviction that
    // prefers the now-fully-expired "stale-*" keys, not the still-active "fresh" one.
    await limiter.hit("brand-new");

    expect(limiter.trackedKeyCount()).toBeLessThanOrEqual(maxTrackedKeys);
    // "fresh" must survive the eviction pass -- it had a live entry, the stale-* keys did not.
    expect(limiter.size("fresh")).toBe(1);
  });
});
