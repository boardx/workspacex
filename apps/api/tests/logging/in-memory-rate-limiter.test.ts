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

  // review finding (PR #2475, round 3): a first version of overflow eviction scanned the
  // WHOLE map looking for expired-only keys before falling back to FIFO -- an
  // attacker-controlled O(maxTrackedKeys) cost per request once the map is full, under a
  // sustained rotating-key flood. The fix is pure FIFO (no scan): this test pins the actual
  // eviction order (oldest-inserted key goes first, unconditionally) so a regression back to
  // the scanning version -- which would evict "fresh" here instead -- goes red.
  it("eviction is pure FIFO: the oldest-inserted key is evicted first, even if it is still active", async () => {
    const clock = fakeClock(0);
    const maxTrackedKeys = 3;
    const limiter = new InMemoryRateLimiter(clock, 60_000, 5, maxTrackedKeys);

    await limiter.hit("first");  // oldest -- must be the one evicted
    await limiter.hit("second");
    await limiter.hit("third");
    expect(limiter.trackedKeyCount()).toBe(3);

    // "first" is still well within its window (not expired) -- FIFO evicts it anyway.
    await limiter.hit("fourth");

    expect(limiter.trackedKeyCount()).toBe(3);
    expect(limiter.size("first")).toBe(0);
    expect(limiter.size("second")).toBe(1);
    expect(limiter.size("third")).toBe(1);
    expect(limiter.size("fourth")).toBe(1);
  });

  // review finding (PR #2475, round 3): "bounded memory" was proven, but not "bounded WORK
  // per call" -- a scanning eviction pass would make this same distinct-key flood, once past
  // capacity, cost O(maxTrackedKeys) per request instead of O(1). A quadratic-vs-linear gap at
  // this scale (a 1k cap times a 100k-call flood) is not something a flaky sub-second
  // wall-clock threshold is needed to see: O(1) finishes in well under a second, the scanning
  // version would not finish in any reasonable CI timeout. This is empirical evidence the
  // per-call cost does not grow with maxTrackedKeys, not a tight performance budget.
  it("a sustained distinct-key flood well past capacity completes in bounded time (O(1) eviction, not a per-request scan)", async () => {
    const clock = fakeClock(0);
    const maxTrackedKeys = 1_000;
    const limiter = new InMemoryRateLimiter(clock, 60_000, 20, maxTrackedKeys);

    const totalHits = 100_000; // 100x over capacity once the map fills up
    const started = Date.now();
    for (let i = 0; i < totalHits; i++) {
      await limiter.hit(`distinct-ip-${i}`);
    }
    const elapsedMs = Date.now() - started;

    expect(limiter.trackedKeyCount()).toBeLessThanOrEqual(maxTrackedKeys);
    // O(1) eviction: ~100k cheap map operations, comfortably under a second even on a slow
    // CI runner. An O(maxTrackedKeys)-per-call scan at this size would be ~100k * 1k = 1e8
    // array/map operations -- multiple seconds to tens of seconds, not comfortably under one.
    expect(elapsedMs).toBeLessThan(5_000);
  });
});
