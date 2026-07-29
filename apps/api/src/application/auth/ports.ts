/**
 * Ports for the `auth` use cases. Defined here, implemented by `infrastructure`.
 *
 * usecases.md's port table lists five; this file has seven, and the two extras are not
 * scope creep -- they are gaps in the contract, recorded here rather than absorbed silently:
 *
 *   `LoginAttemptRepository`  domain.md declares `LoginAttempt` as the value object lockout
 *                             is computed from, and usecases.md's port table has NO port
 *                             for it. Without one, the lockout rule has nowhere to read
 *                             from, so an implementer either invents a port (this) or
 *                             reaches into a table from the use case (a layering breach).
 *   `Clock`                   every rule in this bundle is time-dependent (rolling window,
 *                             lock duration, token expiry, session TTL). With `Date.now()`
 *                             called inside the use case, "the lock lifts after 15 minutes"
 *                             can only be asserted by sleeping for 15 minutes -- so it
 *                             would not be asserted, and I-3's second half would quietly
 *                             stop being true.
 */
import type { SessionRecord } from "../../domain/auth/session-lifetime";
import type { LoginAttempt } from "../../domain/auth/lockout";

/* ───────────────────────────── credentials ───────────────────────────── */

export interface CredentialRow {
  readonly userId: string;
  /** Already normalised (`domain/auth/email`). */
  readonly email: string;
  readonly passwordHash: string;
  readonly emailVerifiedAt: Date | null;
}

export interface CredentialRepository {
  /** @param email MUST be normalised by the caller. Returns null when no such account. */
  findByEmail(email: string): Promise<CredentialRow | null>;
  findByUserId(userId: string): Promise<CredentialRow | null>;
  /** Replace the stored hash. Used by password reset; never by login. */
  updatePasswordHash(userId: string, passwordHash: string): Promise<void>;
}

export const CREDENTIAL_REPOSITORY = Symbol("CredentialRepository");

/* ───────────────────────────── hashing ───────────────────────────── */

/**
 * ⚠ `verifyDummy` is not a convenience wrapper and MUST NOT be deleted as dead weight.
 *
 * It is the timing half of I-1. "Email not found" takes a short path; "wrong password"
 * runs a slow hash. The two differ by roughly an order of magnitude, and an identical
 * response body does not help at all -- an attacker with a stopwatch enumerates the user
 * table through the difference. So when no user is found, the login path burns an
 * EQUIVALENT amount of work against a fixed dummy hash.
 *
 * coverage.md §5 item 4 names this line as the one most likely to be removed in code review
 * as "pointless waste". It is on the PORT rather than inline in the use case so that
 * removing it is a compile error in every implementation, not a quiet deletion in one.
 */
export interface PasswordHasher {
  hash(plaintext: string): Promise<string>;
  verify(plaintext: string, hash: string): Promise<boolean>;
  /**
   * Burn the same cost `verify` would, and always return false.
   * Called when the account does not exist, so that the two failure paths cost the same.
   */
  verifyDummy(plaintext: string): Promise<false>;
}

export const PASSWORD_HASHER = Symbol("PasswordHasher");

/* ─────────────────────────── login attempts ─────────────────────────── */

export interface LoginAttemptRepository {
  /**
   * Attempts for this email newer than `since`.
   * ⚠ By EMAIL, never by IP -- see migration 0010 for the reasoning and for the recorded
   * conflict with uc-1-1 R4 E1.
   */
  recentFor(email: string, since: Date): Promise<readonly LoginAttempt[]>;
  record(email: string, outcome: LoginAttempt["outcome"], at: Date): Promise<void>;
}

export const LOGIN_ATTEMPT_REPOSITORY = Symbol("LoginAttemptRepository");

/* ─────────────────────────── session tokens ─────────────────────────── */

/**
 * Opaque session tokens. Redis (domain §3 ①).
 *
 * ⚠ Chosen over JWT because I-5 requires "all existing sessions invalid IMMEDIATELY" after
 * a password reset, and a JWT cannot do that without a blacklist -- which is a stateful
 * store, i.e. this, with extra steps and a window in which the old token still works.
 *
 * ⚠ NOT the same thing as `application/identity/ports.ts`'s `SessionStore`. That one holds
 * the per-user project-scoped CONTEXT that `switchOrganization` clears (O-12); this one
 * maps a bearer token to an identity. They were nearly merged during design: the names are
 * similar and both say "session". Merging them would mean revoking a token also wipes the
 * user's project context on every other device, and clearing context on an org switch would
 * log them out.
 *
 * ⚠ Every method must FAIL, never degrade, when Redis is unreachable (usecases.md's last
 * failure row). Returning "no session" on a connection error is indistinguishable, from the
 * caller's side, from a valid logout -- and returning "session ok" is the disguise for
 * "there is no auth layer".
 */
export interface SessionTokenStore {
  /** @returns the opaque bearer token. The token is NOT derivable from the record. */
  issue(record: SessionRecord): Promise<string>;
  findByToken(token: string): Promise<SessionRecord | null>;
  /**
   * Mark every live session of this user revoked, and return HOW MANY were marked.
   *
   * ⚠ The count is contract surface (`completePasswordReset.out.revokedSessionCount`), not
   * diagnostics: it is the only assertable form of uc-1-1 R4's "all existing sessions are
   * invalidated". The common way to get R4 wrong is to revoke only the CURRENT session, and
   * that mistake produces a response identical to the correct one except for this number.
   *
   * ⚠ Marks, does not delete (I-7).
   */
  revokeAllForUser(userId: string, at: Date): Promise<number>;
  /** All sessions of a user, revoked ones included -- so I-7 ("still there, marked") is assertable. */
  listForUser(userId: string): Promise<readonly SessionRecord[]>;
}

export const SESSION_TOKEN_STORE = Symbol("SessionTokenStore");

/* ────────────────────── password reset tokens ────────────────────── */

export interface ResetTokenRepository {
  /** Stores the HASH of `token`; the plaintext never reaches the database. */
  issue(userId: string, token: string, expiresAt: Date): Promise<void>;
  /**
   * Atomically consume a token: valid and unused => mark used and return the user.
   *
   * ⚠ One conditional UPDATE (`WHERE used_at IS NULL`, assert rowCount === 1), never
   * SELECT-then-UPDATE. The read-then-write has a window in which two concurrent requests
   * both see an unused token, and "single use" silently becomes "twice".
   */
  consume(token: string, now: Date): Promise<{ userId: string } | null>;
  /** Requests issued for this user since `since` -- the resend cooldown / daily cap (O-28 ④). */
  countIssuedSince(userId: string, since: Date): Promise<number>;
  latestIssuedAt(userId: string): Promise<Date | null>;
}

export const RESET_TOKEN_REPOSITORY = Symbol("ResetTokenRepository");

/* ────────────────────────────── mailer ────────────────────────────── */

/**
 * ⚠ Sending mail is EGRESS (X-3, gap A-4). The local-organization path promises zero
 * outbound traffic, so this port must not reach the network on that path -- which means
 * "forgot password" does not work for a local organization at all. usecases.md records that
 * as an open product question (A-4), and this bundle does not answer it.
 *
 * What is implemented here is an OUTBOX: the message is recorded, and delivery is somebody
 * else's transport. That keeps `sent: true` honest at this layer (the request was accepted
 * and recorded) without this feature quietly opening an egress path nobody signed off.
 */
export interface Mailer {
  send(msg: { to: string; kind: MailKind; body: Record<string, string> }): Promise<void>;
}

/**
 * ⚠ `password-changed` is MANDATORY and not user-disableable (O-28 ④): it is the only
 * alarm channel that exists when an account has already been taken over.
 */
export type MailKind = "password-reset-link" | "password-changed" | "account-locked";

export const MAILER = Symbol("Mailer");

/* ────────────────────────────── clock ────────────────────────────── */

export interface Clock {
  now(): Date;
}

export const CLOCK = Symbol("Clock");

/* ─────────────────────────── token factory ─────────────────────────── */

/**
 * Unguessable ids and tokens (I-6: "UUID, must not be a sequence").
 *
 * A port rather than a direct `randomUUID()` call so the domain stays pure and, more
 * usefully, so a test can prove the production factory is NOT a counter: a sequential
 * session id is guessable, and guessable session ids make every other control in this
 * bundle irrelevant.
 */
export interface TokenFactory {
  /** Session id -- UUID. */
  sessionId(): string;
  /** High-entropy opaque bearer token (session token / reset token). */
  opaqueToken(): string;
}

export const TOKEN_FACTORY = Symbol("TokenFactory");
