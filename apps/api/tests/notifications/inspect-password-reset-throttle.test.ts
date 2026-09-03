/**
 * `inspectPasswordResetThrottle` (issue #2632) -- the platform-admin diagnostic that reads
 * exactly what `requestPasswordReset` consults before deciding whether to skip sending.
 */
import { describe, expect, it } from "vitest";
import { inspectPasswordResetThrottle } from "../../src/application/auth/inspect-password-reset-throttle";
import { COOLDOWN_MS, DAY_MS } from "../../src/application/auth/password-reset";
import type { Clock, CredentialRepository, ResetTokenRepository } from "../../src/application/auth/ports";

const CRED = {
  userId: "u-1", email: "a@b.com", passwordHash: "x", emailVerifiedAt: new Date(),
  displayName: "A", avatarUrl: null,
};

function fakeCredentials(found: typeof CRED | null): CredentialRepository {
  return {
    findByEmail: async () => found,
    findByUserId: async () => found,
    updatePasswordHash: async () => {},
    updateDisplayName: async () => found,
    updateAvatar: async () => found,
  };
}

function fakeResetTokens(over: Partial<ResetTokenRepository> = {}): ResetTokenRepository {
  return {
    issue: async () => {},
    consume: async () => null,
    countIssuedSince: async () => 0,
    latestIssuedAt: async () => null,
    ...over,
  };
}

function fakeClock(now: Date): Clock {
  return { now: () => now };
}

const NOW = new Date("2026-09-04T12:00:00.000Z");

describe("inspectPasswordResetThrottle", () => {
  it("unregistered email: says so plainly, no enumeration concern at this admin-only door", async () => {
    const out = await inspectPasswordResetThrottle(
      { credentials: fakeCredentials(null), resetTokens: fakeResetTokens(), clock: fakeClock(NOW) },
      { email: "nobody@example.com" },
    );
    expect(out).toEqual({
      registered: false, issuedInLast24h: 0, dailyCap: 5, overDailyCap: false,
      lastIssuedAt: null, cooldownSeconds: 60, cooling: false, cooldownEndsAt: null,
    });
  });

  it("registered, never requested: not cooling, not over cap", async () => {
    const out = await inspectPasswordResetThrottle(
      { credentials: fakeCredentials(CRED), resetTokens: fakeResetTokens(), clock: fakeClock(NOW) },
      { email: CRED.email },
    );
    expect(out.registered).toBe(true);
    expect(out.cooling).toBe(false);
    expect(out.overDailyCap).toBe(false);
    expect(out.lastIssuedAt).toBeNull();
  });

  it("requested 10 seconds ago: cooling, with a cooldownEndsAt 60s after that request", async () => {
    const last = new Date(NOW.getTime() - 10_000);
    const out = await inspectPasswordResetThrottle(
      {
        credentials: fakeCredentials(CRED),
        resetTokens: fakeResetTokens({ latestIssuedAt: async () => last, countIssuedSince: async () => 1 }),
        clock: fakeClock(NOW),
      },
      { email: CRED.email },
    );
    expect(out.cooling).toBe(true);
    expect(out.cooldownEndsAt).toBe(new Date(last.getTime() + COOLDOWN_MS).toISOString());
  });

  it("5 issued in the last 24h: over the daily cap -- exactly the case the real incident hit", async () => {
    const out = await inspectPasswordResetThrottle(
      {
        credentials: fakeCredentials(CRED),
        resetTokens: fakeResetTokens({
          latestIssuedAt: async () => new Date(NOW.getTime() - DAY_MS + 1_000),
          countIssuedSince: async () => 5,
        }),
        clock: fakeClock(NOW),
      },
      { email: CRED.email },
    );
    expect(out.issuedInLast24h).toBe(5);
    expect(out.dailyCap).toBe(5);
    expect(out.overDailyCap).toBe(true);
  });

  it("normalizes the email the same way the public endpoint does (case/whitespace)", async () => {
    let queried: string | null = null;
    const credentials: CredentialRepository = {
      ...fakeCredentials(CRED),
      findByEmail: async (email) => { queried = email; return CRED; },
    };
    await inspectPasswordResetThrottle(
      { credentials, resetTokens: fakeResetTokens(), clock: fakeClock(NOW) },
      { email: "  A@B.COM  " },
    );
    expect(queried).toBe("a@b.com");
  });
});
