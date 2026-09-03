/**
 * `RequestPasswordReset` / `CompletePasswordReset` (F21) -- uc-1-1 R4 A2, AC3,
 * contract `auth.operations.{requestPasswordReset,completePasswordReset}`.
 *
 * Two invariants carry this whole feature, and both are the kind that a correct-looking
 * implementation gets wrong:
 *
 *   I-1 (request)   `{ sent: true }` REGARDLESS of whether the email exists. An endpoint
 *                   that answers truthfully is an unauthenticated enumeration oracle: point
 *                   a list of company addresses at it and it tells you who the customers
 *                   are. No password required, no rate limit that helps.
 *
 *   I-5 (complete)  EVERY existing session of that account dies, not just the current one.
 *                   Revoking only the current session is the common mistake, and its
 *                   response is identical to the correct one except for
 *                   `revokedSessionCount`. That is precisely why the count is contract
 *                   surface: it is the only assertable form of uc-1-1 R4.
 */
import { auth as C } from "@repo/contracts";
import type { z } from "zod";
import { normalizeEmail } from "../../domain/auth/email";
import { checkPassword } from "../../domain/auth/password-policy";
import { AuthError, PasswordPolicyError } from "./errors";
import type {
  Clock,
  CredentialRepository,
  Mailer,
  PasswordHasher,
  ResetTokenRepository,
  SessionTokenStore,
  TokenFactory,
} from "./ports";

export interface PasswordResetDeps {
  readonly credentials: CredentialRepository;
  readonly hasher: PasswordHasher;
  readonly resetTokens: ResetTokenRepository;
  readonly sessions: SessionTokenStore;
  readonly tokens: TokenFactory;
  readonly mailer: Mailer;
  readonly clock: Clock;
}

export type RequestResetInput = z.infer<typeof C.operations.requestPasswordReset.in>;
export type RequestResetOutput = z.infer<typeof C.operations.requestPasswordReset.out>;
export type CompleteResetInput = z.infer<typeof C.operations.completePasswordReset.in>;
export type CompleteResetOutput = z.infer<typeof C.operations.completePasswordReset.out>;

const RESET_TTL_MS = C.AUTH_POLICY.resetLinkHours * 60 * 60 * 1000;
/**
 * Exported (not just local) so `inspect-password-reset-throttle.ts` computes the SAME
 * cooldown/rolling-window boundaries this function enforces, rather than a second copy that
 * could silently drift from `AUTH_POLICY` -- see that file's head comment for why it needs
 * these at all (2026-09-04 support incident: a real account's reset requests were silently
 * skipped by this cooldown/cap with nothing anywhere to show it, see issue #2632).
 */
export const COOLDOWN_MS = C.AUTH_POLICY.resendCooldownSeconds * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Step 2 of uc-1-1 A2.
 *
 * ⚠ There is exactly ONE `return` in this function, and it is unconditional. That is not a
 * style preference: an early `return { sent: true }` inside an `if (!cred)` branch is how
 * the two paths acquire different shapes, and the difference does not have to be in the
 * body -- a thrown error, a different status, or a much faster response all leak the same
 * bit.
 *
 * ⚠ Known residual: this function still returns FASTER for an unknown address (no token
 * generated, no mail queued). The login path closes the equivalent gap with a dummy hash;
 * here the work is IO-bound rather than CPU-bound, so the same trick does not transfer
 * cleanly. Recorded in the report as a gap rather than papered over -- uc-1-1 R7 asks for
 * "the same copy and the same order of magnitude of response time", and only the copy half
 * is guaranteed here.
 */
export async function requestPasswordReset(
  deps: PasswordResetDeps,
  input: RequestResetInput,
): Promise<RequestResetOutput> {
  const email = normalizeEmail(input.email);
  const now = deps.clock.now();
  const cred = await deps.credentials.findByEmail(email);

  if (cred) {
    const last = await deps.resetTokens.latestIssuedAt(cred.userId);
    const issuedToday = await deps.resetTokens.countIssuedSince(
      cred.userId,
      new Date(now.getTime() - DAY_MS),
    );
    // Resend limits (O-28 ④): 60s cooldown, 5/day. Exceeding them is NOT an error --
    // the caller still gets `{ sent: true }`, because a distinguishable "too many requests"
    // response is the same enumeration channel wearing a different hat.
    const cooling = last !== null && now.getTime() - last.getTime() < COOLDOWN_MS;
    const overDailyCap = issuedToday >= C.AUTH_POLICY.resendDailyMax;
    if (!cooling && !overDailyCap) {
      const token = deps.tokens.opaqueToken();
      await deps.resetTokens.issue(cred.userId, token, new Date(now.getTime() + RESET_TTL_MS));
      await deps.mailer.send({
        to: cred.email,
        kind: "password-reset-link",
        // ⚠ The token travels in the mail body and NOWHERE else -- not in a log line, not
        // in a trace attribute. It is a bearer credential for the account.
        body: { token, expiresAt: new Date(now.getTime() + RESET_TTL_MS).toISOString() },
      });
    }
  }

  return { sent: true };
}

/**
 * Steps 4-5 of uc-1-1 A2 / AC3.
 *
 * ⚠ Order: consume the token FIRST (atomically), then set the password, then revoke.
 * Validating the token and writing the password before marking it used leaves a window in
 * which one link sets the password twice -- and the second use is by whoever else got hold
 * of the link.
 */
export async function completePasswordReset(
  deps: PasswordResetDeps,
  input: CompleteResetInput,
): Promise<CompleteResetOutput> {
  const now = deps.clock.now();

  // Strength is checked BEFORE the token is consumed, so a user who fumbles the new
  // password does not burn their single-use link and have to start over.
  const rejection = checkPassword(input.newPassword);
  if (rejection) throw new PasswordPolicyError(rejection);

  const consumed = await deps.resetTokens.consume(input.token, now);
  // Expired and forged share ONE code (usecases.md): a distinct "this link expired" tells
  // an attacker holding a guessed token that the token was real.
  if (!consumed) throw new AuthError("RESET_TOKEN_INVALID");

  const cred = await deps.credentials.findByUserId(consumed.userId);
  // The FK makes this unreachable, but a null here must not become an unhandled crash that
  // has already consumed the user's only token.
  if (!cred) throw new AuthError("RESET_TOKEN_INVALID");

  await deps.credentials.updatePasswordHash(consumed.userId, await deps.hasher.hash(input.newPassword));

  // ⚠ I-5 / uc-1-1 R4: ALL of them, not the current one. `revokeAllForUser` marks rather
  // than deletes (I-7), and returns the count that is contract surface.
  const revokedSessionCount = await deps.sessions.revokeAllForUser(consumed.userId, now);

  // O-28 ④: mandatory, not user-disableable. When an account has already been taken over
  // this is the only channel that tells the real owner.
  await deps.mailer.send({
    to: cred.email,
    kind: "password-changed",
    body: { at: now.toISOString(), revokedSessionCount: String(revokedSessionCount) },
  });

  return { revokedSessionCount };
}
