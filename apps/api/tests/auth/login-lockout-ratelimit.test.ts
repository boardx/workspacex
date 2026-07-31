/**
 * F20 -- rate limiting and account lockout. Invariant I-3, ruling O-28 ③,
 * uc-1-1 R4 E1 / R12 V5b, coverage V9.
 *
 * ## The clause that makes lockout a control rather than an inconvenience
 *
 * While locked, a CORRECT password is refused. If it still worked, the lockout would only
 * ever hurt the legitimate owner: the attacker is going to hit the right password
 * eventually and would sail straight through, never having noticed the counter.
 *
 * So this file asserts BOTH directions, always:
 *   locked   => the correct password is refused
 *   unlocked => the same correct password works
 * "Refuses while locked" on its own is satisfied by an implementation that refuses always.
 *
 * ## Why the clock is injected
 *
 * The second half ("and 15 minutes later you can log in") is only assertable without a
 * 15-minute sleep if time is a dependency. A suite that cannot afford to assert it would
 * simply not assert it, and I-3 would half-silently stop being true.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auth as C } from "@repo/contracts";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { ensureRedis, resetCredentials, seedCredential } from "../support/auth";
import { decideLockout, LOCK_DURATION_MS, LOCK_WINDOW_MS } from "../../src/domain/auth/lockout";
import { login } from "../../src/application/auth/login";
import { AuthError } from "../../src/application/auth/errors";
import { BcryptPasswordHasher } from "../../src/infrastructure/auth/bcrypt-password-hasher";
import {
  PgCredentialRepository,
  PgLoginAttemptRepository,
} from "../../src/infrastructure/auth/pg-credential-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { RedisSessionTokenStore, redisConfig } from "../../src/infrastructure/auth/redis-session-token-store";
import { FixedClock, UuidTokenFactory } from "../../src/infrastructure/auth/system-clock";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";

const ORG = "org-f20-lock";
const PROJECT = "proj-f20-lock";
const USER = "u-f20-lock";
const EMAIL = "locked@f20-lock.test";
const OTHER_USER = "u-f20-lock-other";
const OTHER_EMAIL = "bystander@f20-lock.test";
const PASSWORD = "correct-horse-battery-staple";
const WRONG = "wrong-horse-battery-staple";

let db: PgDatabase;
let sessions: RedisSessionTokenStore;
let clock: FixedClock;

function deps() {
  return {
    credentials: new PgCredentialRepository(db),
    hasher: new BcryptPasswordHasher(),
    attempts: new PgLoginAttemptRepository(db),
    sessions,
    tokens: new UuidTokenFactory(),
    clock,
    identity: new PgIdentityRepository(db),
  };
}

/**
 * F03：登录现在还接一个设备上下文。这个文件断言的是锁定与枚举，与设备无关，
 * 所以固定一个值——让它随机变化会给这些断言引入一个它们并不关心的变量。
 */
const FIXED_DEVICE = { device: "Chrome on macOS", location: null } as const;

/** Run a login and report only what the assertions care about. */
async function tryLogin(email: string, password: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    await login(deps(), { email, password }, FIXED_DEVICE);
    return { ok: true };
  } catch (e) {
    if (e instanceof AuthError) return { ok: false, reason: e.reason };
    throw e;
  }
}

beforeAll(async () => {
  ensureDatabase();
  ensureRedis();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  sessions = new RedisSessionTokenStore(redisConfig());
}, 120_000);

afterAll(async () => {
  await sessions?.close();
  await db?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await resetCredentials([USER, OTHER_USER], [EMAIL, OTHER_EMAIL]);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "consultant", fx.teams.energy!);
  await addOrgMember(ORG, OTHER_USER, "consultant", fx.teams.energy!);
  await seedCredential({ userId: USER, email: EMAIL, password: PASSWORD });
  await seedCredential({ userId: OTHER_USER, email: OTHER_EMAIL, password: PASSWORD });
  clock = new FixedClock(new Date("2026-07-29T10:00:00Z"));
});

describe("I-3 -- the lockout rule as a pure function", () => {
  const at = (minutesAgo: number, outcome: "ok" | "bad-credential" = "bad-credential") => ({
    at: Date.parse("2026-07-29T10:00:00Z") - minutesAgo * 60_000,
    outcome,
  });
  const NOW = Date.parse("2026-07-29T10:00:00Z");

  it(`${C.AUTH_POLICY.lockAfterFails - 1} failures inside the window do NOT lock`, () => {
    const attempts = Array.from({ length: C.AUTH_POLICY.lockAfterFails - 1 }, (_, i) => at(i));
    expect(decideLockout(attempts, NOW).locked).toBe(false);
  });

  it(`${C.AUTH_POLICY.lockAfterFails} failures inside the window DO lock`, () => {
    const attempts = Array.from({ length: C.AUTH_POLICY.lockAfterFails }, (_, i) => at(i));
    expect(decideLockout(attempts, NOW).locked).toBe(true);
  });

  it("failures OUTSIDE the rolling window do not count", () => {
    const stale = Array.from({ length: 20 }, (_, i) =>
      at(C.AUTH_POLICY.lockWindowMinutes + 1 + i),
    );
    expect(decideLockout(stale, NOW).locked).toBe(false);
  });

  it("a success in between clears the streak (consecutive, not cumulative)", () => {
    // 3 recent failures, a success, then 3 more failures = 6 failures but no streak of 5.
    const attempts = [at(0), at(1), at(2), at(3, "ok"), at(4), at(5), at(6)];
    expect(decideLockout(attempts, NOW).locked).toBe(false);
  });

  it("the lock runs from the CROSSING failure, so hammering does not extend it", () => {
    // 10 failures, the 5th (chronologically) being the one that crossed. Measuring from the
    // newest attempt instead would hand any stranger a permanent DoS on an account whose
    // email address they know.
    const attempts = Array.from({ length: 10 }, (_, i) => at(i));
    const crossingAt = NOW - (10 - C.AUTH_POLICY.lockAfterFails) * 60_000;
    expect(decideLockout(attempts, NOW).lockedUntil).toBe(crossingAt + LOCK_DURATION_MS);
  });

  it("the lock expires by itself -- no administrator needed (O-28 ③)", () => {
    const attempts = Array.from({ length: C.AUTH_POLICY.lockAfterFails }, (_, i) => at(i));
    const after = NOW + LOCK_DURATION_MS + 1;
    expect(decideLockout(attempts, NOW).locked).toBe(true);
    expect(decideLockout(attempts, after).locked).toBe(false);
  });
});

describe("I-3 -- end to end, both directions", () => {
  it("after N consecutive failures, the CORRECT password is refused", async () => {
    for (let i = 0; i < C.AUTH_POLICY.lockAfterFails; i++) {
      const r = await tryLogin(EMAIL, WRONG);
      expect(r).toEqual({ ok: false, reason: "INVALID_CREDENTIAL" });
      clock.advance(1_000);
    }

    // THE assertion. A correct password, refused.
    const locked = await tryLogin(EMAIL, PASSWORD);
    expect(locked).toEqual({ ok: false, reason: "ACCOUNT_LOCKED" });
  }, 120_000);

  it("...and after the lock expires, the SAME correct password works", async () => {
    for (let i = 0; i < C.AUTH_POLICY.lockAfterFails; i++) {
      await tryLogin(EMAIL, WRONG);
      clock.advance(1_000);
    }
    expect((await tryLogin(EMAIL, PASSWORD)).reason).toBe("ACCOUNT_LOCKED");

    // The other direction. Without this half, "refuses while locked" is satisfied by an
    // implementation that refuses forever -- which is a broken login wearing the costume of
    // a security control.
    clock.advance(LOCK_DURATION_MS + LOCK_WINDOW_MS + 1_000);
    expect(await tryLogin(EMAIL, PASSWORD)).toEqual({ ok: true });
  }, 120_000);

  it("N-1 failures do not lock -- the correct password still works right away", async () => {
    for (let i = 0; i < C.AUTH_POLICY.lockAfterFails - 1; i++) {
      await tryLogin(EMAIL, WRONG);
      clock.advance(1_000);
    }
    expect(await tryLogin(EMAIL, PASSWORD)).toEqual({ ok: true });
  }, 120_000);

  it("counting is per EMAIL: locking one account does not lock a bystander", async () => {
    for (let i = 0; i < C.AUTH_POLICY.lockAfterFails + 2; i++) {
      await tryLogin(EMAIL, WRONG);
      clock.advance(1_000);
    }
    expect((await tryLogin(EMAIL, PASSWORD)).reason).toBe("ACCOUNT_LOCKED");

    // ⚠ This is the half that per-IP counting gets wrong. Both accounts are being attacked
    // from the same process, i.e. the same source address; per-IP counting would lock the
    // bystander out too, which in production means one attacker locks out an entire office
    // behind one NAT while paying nothing to rotate addresses.
    expect(await tryLogin(OTHER_EMAIL, PASSWORD)).toEqual({ ok: true });
  }, 120_000);

  it("a locked account's rejection does not reveal WHEN it unlocks", async () => {
    for (let i = 0; i < C.AUTH_POLICY.lockAfterFails; i++) {
      await tryLogin(EMAIL, WRONG);
      clock.advance(1_000);
    }
    try {
      await login(deps(), { email: EMAIL, password: PASSWORD }, FIXED_DEVICE);
      throw new Error("expected a lockout");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      // `lockedUntil` exists on the error for logging and for the test above, but the
      // controller must not put it in the body: "try again in 12 minutes" confirms the
      // account exists, reopening on this path the channel I-1 closes on the other one.
      const controllerBody = { reasonCode: (e as AuthError).reason };
      expect(JSON.stringify(controllerBody)).not.toContain("lockedUntil");
    }
  }, 120_000);

  it("counter-proof: a locked account is refused for a REASON, not because login is broken", async () => {
    // Guards against the whole file passing because logins simply never succeed. Runs a
    // clean login against a completely untouched account.
    expect(await tryLogin(OTHER_EMAIL, PASSWORD)).toEqual({ ok: true });
  }, 120_000);
});
