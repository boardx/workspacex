/**
 * F20 -- session-store failure during login must become `AUTH_SERVICE_UNAVAILABLE`, never a
 * raw exception.
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
 * ## Fully-faked deps, not the real Redis stack
 *
 * The other F20 login suites (`login-password-auth.test.ts`, `login-lockout-ratelimit.test.ts`)
 * boot the real Postgres + Redis stack, which is the right call when the thing under test is
 * an actual integration boundary. Here the thing under test is a single catch block around one
 * call -- pointing a real `RedisSessionTokenStore` at an unreachable host would exercise
 * ioredis's own (unbounded, retry-with-backoff) reconnection behaviour, which is not what this
 * test is about and would make it slow and address-dependent. A fake `SessionTokenStore` whose
 * `issue()` rejects gives the same "the port throws" fact deterministically and fast.
 */
import { describe, expect, it } from "vitest";
import { login, type LoginDeps } from "../../src/application/auth/login";
import { AuthError } from "../../src/application/auth/errors";
import type { CredentialRow, SessionTokenStore } from "../../src/application/auth/ports";

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
      throw new Error("Connection is closed."); // the real ioredis message, reproduced verbatim
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
  it("a rejecting SessionTokenStore.issue() becomes AuthError(AUTH_SERVICE_UNAVAILABLE)", async () => {
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

  it("control: with a working session store the same deps produce a real session (proves the fake is otherwise a faithful stand-in)", async () => {
    const out = await login(
      fakeDeps({ sessions: fakeSessions(async () => "a-real-token") }),
      { email: EMAIL, password: PASSWORD },
      FIXED_DEVICE,
    );
    expect(out.sessionToken).toBe("a-real-token");
  });
});
