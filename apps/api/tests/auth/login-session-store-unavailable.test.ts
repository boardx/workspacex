/**
 * F20 -- session-store failure during login must become `AUTH_SERVICE_UNAVAILABLE`, never a
 * raw exception -- and `login()`'s catch must stay NARROW: it translates
 * `SessionStoreUnavailableError` specifically, and rethrows anything else unchanged.
 *
 * ## Real incident this pins down
 *
 * 2026-09-01, traceId `28b6862c-71e1-4ce8-8e3f-3fceb9f8b607`: `RedisSessionTokenStore.issue`
 * hit a transient "Connection is closed." mid-request. `login()` did not catch it, so it fell
 * through `AuthController`'s `toHttp()` untranslated (it is neither an `AuthError` nor a
 * `PasswordPolicyError`) and `AllExceptionsFilter` turned it into a bare `internal_error` 500
 * -- the contract has always listed `AUTH_SERVICE_UNAVAILABLE` as a `login` failure reason,
 * but nothing on this path ever produced it.
 *
 * ## Revision, 2026-09-01 (PR #2440 independent review, finding #1)
 *
 * The first version of this fix (and this file) caught ANY error from `sessions.issue()` and
 * translated it. That is too wide: a programming bug in the adapter would also get relabelled
 * "the store is down". The fix moved the classification into the infrastructure adapter
 * (`RedisSessionTokenStore`'s `isRecognisedConnectionFailure`, which throws the typed
 * `SessionStoreUnavailableError` only for recognised connection-class failures); `login()`
 * now catches only that type. This file's counter-evidence tests (below) exist because the
 * review's finding #2 named exactly this gap: the original suite only proved "any Error gets
 * wrapped", which would pass an implementation that is too permissive just as easily as a
 * correct one.
 *
 * ## Fully-faked deps, not the real Redis stack
 *
 * The other F20 login suites (`login-password-auth.test.ts`, `login-lockout-ratelimit.test.ts`)
 * boot the real Postgres + Redis stack, which is the right call when the thing under test is
 * an actual integration boundary. Here the thing under test is `login()`'s own catch clause --
 * pointing a real `RedisSessionTokenStore` at an unreachable host would exercise ioredis's own
 * (unbounded, retry-with-backoff) reconnection behaviour, which is not what this test is about
 * and would make it slow and address-dependent. A fake `SessionTokenStore` whose `issue()`
 * throws exactly what the real adapter would throw (`SessionStoreUnavailableError` for the
 * recognised case, a plain `Error` for the unrecognised one) gives the same facts
 * deterministically and fast. `RedisSessionTokenStore`'s own classifier
 * (`isRecognisedConnectionFailure`) is exercised separately, against the literal ioredis error
 * shapes, in `redis-session-token-store-error-classification.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { login, type LoginDeps } from "../../src/application/auth/login";
import { AuthError } from "../../src/application/auth/errors";
import type { CredentialRow, SessionTokenStore } from "../../src/application/auth/ports";
import { SessionStoreUnavailableError } from "../../src/application/auth/ports";

const EMAIL = "session-store-down@f20.test";
const PASSWORD = "correct-horse-battery-staple";
const USER = "u-f20-session-store-down";

const CRED: CredentialRow = {
  userId: USER,
  email: EMAIL,
  passwordHash: "irrelevant-hash", // never actually compared -- `hasher.verify` is faked below
  emailVerifiedAt: new Date("2026-01-01T00:00:00Z"),
  displayName: "Session Store Down",
  avatarUrl: null,
};

const FIXED_DEVICE = { device: "Chrome on macOS", location: null } as const;
const NOW = new Date("2026-09-01T00:00:00Z");

/**
 * A complete `SessionTokenStore` fake, `issue()` swappable per test. The other six methods
 * are never exercised by `login()` (it only ever calls `issue()`) but the interface is not
 * optional-methods -- a partial object fails to typecheck rather than silently working, which
 * is the right failure mode here: a real implementation missing one of these would be a bug.
 */
function fakeSessions(issue: SessionTokenStore["issue"]): SessionTokenStore {
  return {
    issue,
    findByToken: async () => null,
    revokeAllForUser: async () => 0,
    revokeAllForUserExcept: async () => 0,
    listForUser: async () => [],
    revokeSession: async () => null,
    touch: async () => undefined,
    setCurrentOrg: async () => false,
  };
}

/** Every dependency `login()` needs, all faked, for a run that reaches step 5. */
function fakeDeps(overrides: Partial<LoginDeps> = {}): LoginDeps {
  return {
    credentials: {
      findByEmail: async () => CRED,
      findByUserId: async () => CRED,
      updatePasswordHash: async () => undefined,
      updateOwnProfile: async () => CRED,
    },
    hasher: {
      hash: async () => "irrelevant",
      verify: async () => true, // the password is "correct" -- we are testing what happens AFTER
      verifyDummy: async () => false,
    },
    attempts: {
      recentFor: async () => [], // not locked
      record: async () => undefined,
    },
    sessions: fakeSessions(async () => {
      // What the real adapter throws for the RECOGNISED case (see the classifier's own test
      // file for what makes a raw ioredis error recognised in the first place).
      throw new SessionStoreUnavailableError(new Error("Connection is closed."));
    }),
    tokens: {
      sessionId: () => "sess-fake",
      opaqueToken: () => "token-fake",
    },
    clock: { now: () => NOW },
    identity: {
      listMemberships: async () => [],
    },
    ...overrides,
  } as LoginDeps;
}

describe("F20 login -- session-store failure surfaces as AUTH_SERVICE_UNAVAILABLE, not a raw exception", () => {
  it("SessionTokenStore.issue() throwing SessionStoreUnavailableError becomes AuthError(AUTH_SERVICE_UNAVAILABLE)", async () => {
    await expect(login(fakeDeps(), { email: EMAIL, password: PASSWORD }, FIXED_DEVICE))
      .rejects.toSatisfy((e: unknown) => e instanceof AuthError && e.reason === "AUTH_SERVICE_UNAVAILABLE");
  });

  it("the raw Redis error message never escapes -- callers only ever see the AuthError", async () => {
    try {
      await login(fakeDeps(), { email: EMAIL, password: PASSWORD }, FIXED_DEVICE);
      throw new Error("expected login() to reject");
    } catch (e) {
      expect(e).toBeInstanceOf(AuthError);
      expect((e as AuthError).reason).not.toContain("Connection");
    }
  });

  it("counter-evidence (review finding #2): an UNRECOGNISED error from issue() is NOT translated -- it passes through as-is, so it still reaches AllExceptionsFilter's internal_error bucket instead of being mislabelled 'service unavailable'", async () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'foo')");
    const deps = fakeDeps({ sessions: fakeSessions(async () => { throw bug; }) });

    await expect(login(deps, { email: EMAIL, password: PASSWORD }, FIXED_DEVICE)).rejects.toBe(bug);
  });

  it("control: with a working session store the same deps produce a real session (proves the fake is otherwise a faithful stand-in)", async () => {
    const out = await login(
      fakeDeps({ sessions: fakeSessions(async () => "a-real-token") }),
      { email: EMAIL, password: PASSWORD },
      FIXED_DEVICE,
    );
    expect(out.sessionToken).toBe("a-real-token");
  });
});
