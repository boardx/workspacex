/**
 * `Login` (F20) -- uc-1-1 R3, contract `auth.operations.login`.
 *
 * ## The order of operations here IS the security property
 *
 *   1. lockout check          BEFORE the password is verified (I-3: a correct password is
 *                             refused while locked -- checking it afterwards would let the
 *                             attacker's eventual hit through)
 *   2. credential lookup
 *   3. password verification, OR an equivalent-cost dummy hash when there is no account
 *                            (I-1's timing half)
 *   4. email-verified check   AFTER the password is confirmed (I-8, and see below)
 *   5. issue the session
 *
 * ## Why `EMAIL_NOT_VERIFIED` comes after the password check
 *
 * uc-1-1 A3 wants the user told that their email is unverified. But answering that BEFORE
 * verifying the password turns the endpoint into an oracle: anyone can ask "is
 * victim@corp.com a registered-but-unverified account" without holding the password. So the
 * distinct code is only issued to a caller who has ALREADY proven they hold the password --
 * at which point they are the account owner and telling them costs nothing.
 *
 * ⚠ That is a deliberate narrowing of A3 and is called out in the report: A3's literal
 * reading ("prompt and offer resend") is reachable only after a correct password.
 *
 * ## What this use case must never do (I-9)
 *
 * It returns organization IDS and nothing else -- no roles, no scopes. `auth` answers "who
 * are you"; the moment it answers "what may you do" there is a second authorization source,
 * and X-1's whole job is that there is exactly one.
 */
import { auth as C } from "@repo/contracts";
import type { z } from "zod";
import { normalizeEmail } from "../../domain/auth/email";
import { decideLockout, LOCK_WINDOW_MS } from "../../domain/auth/lockout";
import { issueAuthenticatedSession } from "./issue-authenticated-session";
import type { IdentityRepository } from "../identity/ports";
import { AuthError } from "./errors";
import type {
  Clock,
  CredentialRepository,
  LoginAttemptRepository,
  PasswordHasher,
  SessionTokenStore,
  TokenFactory,
} from "./ports";

export interface LoginDeps {
  readonly credentials: CredentialRepository;
  readonly hasher: PasswordHasher;
  readonly attempts: LoginAttemptRepository;
  readonly sessions: SessionTokenStore;
  readonly tokens: TokenFactory;
  readonly clock: Clock;
  /** Only `listMemberships` is used -- a cross-org read restricted to the caller's own id. */
  readonly identity: IdentityRepository;
}

export type LoginInput = z.infer<typeof C.operations.login.in>;
export type LoginOutput = z.infer<typeof C.operations.login.out>;

/**
 * F03：这次登录来自哪台设备、哪个网络。
 *
 * ⚠ **第二个参数，不是 `LoginInput` 的字段。** `auth.operations.login.in` 是 phase-00
 *   已签核的 `{ email, password }.strict()`，往里加字段等于改一份已签核契约；
 *   而且那会让设备名变成**客户端自报**的值。这两个值只从传输元数据派生
 *   （`domain/auth/device-fingerprint.ts`），由 `interface` 层从请求头/连接上读出。
 *
 * ⚠ 有默认值，但默认值是 `UNKNOWN_DEVICE` 而不是「省略」——一条没有设备名的会话
 *   在列表里是一行无法与另一行区分的空白，用户据此决定踢哪一台。
 */
export interface LoginDeviceContext {
  readonly device: string;
  readonly location: string | null;
}

export async function login(
  deps: LoginDeps,
  input: LoginInput,
  device: LoginDeviceContext,
): Promise<LoginOutput> {
  const email = normalizeEmail(input.email);
  const now = deps.clock.now();

  /* 1. Lockout, before anything is verified (I-3). */
  const recent = await deps.attempts.recentFor(email, new Date(now.getTime() - LOCK_WINDOW_MS));
  const verdict = decideLockout(recent, now.getTime());
  if (verdict.locked) {
    // Not recorded as another failed attempt: the password was never examined, so counting
    // it would let an attacker who keeps hammering extend the lock on the real owner --
    // and it would make `lockedUntil` drift forward on every rejected probe.
    throw new AuthError("ACCOUNT_LOCKED", verdict.lockedUntil);
  }

  /* 2-3. Lookup, then verify -- or burn the same cost when there is nothing to verify. */
  const cred = await deps.credentials.findByEmail(email);

  // ⚠⚠ DO NOT "OPTIMISE" THIS BRANCH AWAY. ⚠⚠
  //
  // `verifyDummy` runs a full-cost hash against a fixed dummy digest and returns false. It
  // looks like pure waste -- it computes a value that is thrown away -- and that is exactly
  // why coverage.md §5 item 4 predicts it gets deleted in review.
  //
  // Without it: "no such account" returns in ~0.1ms and "wrong password" in ~100ms. The
  // response bodies are byte-identical and it does not matter in the slightest; a stopwatch
  // separates them on the first request, and the login endpoint becomes a user-table
  // enumeration oracle for an unauthenticated attacker.
  //
  // `login-enumeration-guard.test.ts` asserts the elapsed-time difference stays inside a
  // threshold, and carries a counter-proof that the assertion is not vacuous.
  const ok = cred
    ? await deps.hasher.verify(input.password, cred.passwordHash)
    : await deps.hasher.verifyDummy(input.password);

  if (!cred || !ok) {
    await deps.attempts.record(email, "bad-credential", now);
    // ONE code for both cases. Splitting them is the enumeration channel I-1 closes, and
    // the split is usually introduced later, by someone improving the error messages.
    throw new AuthError("INVALID_CREDENTIAL");
  }

  /* 4. Verified email (I-8). Only reachable by someone who holds the password. */
  if (cred.emailVerifiedAt === null) {
    // Recorded as a SUCCESSFUL credential check: the password was right. Recording it as a
    // failure would let an unverified user lock their own account out by retrying.
    await deps.attempts.record(email, "ok", now);
    throw new AuthError("EMAIL_NOT_VERIFIED");
  }

  /* 5. Session. */
  await deps.attempts.record(email, "ok", now);

  return issueAuthenticatedSession(deps, cred.userId, now, device);
}
