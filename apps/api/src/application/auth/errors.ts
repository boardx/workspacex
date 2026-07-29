/**
 * Authentication failures, carrying a contract `AuthReason`.
 *
 * One class rather than one per reason: the interface layer maps EVERY one of them to the
 * same HTTP status and the same body shape, and having separate classes invites a `catch`
 * that handles them separately -- which is how "email not found" and "wrong password" grow
 * different responses again (I-1).
 */
import { auth as C } from "@repo/contracts";
import type { z } from "zod";

export type AuthReason = z.infer<typeof C.AuthReason>;

export class AuthError extends Error {
  constructor(
    readonly reason: AuthReason,
    /**
     * Only for `ACCOUNT_LOCKED`: epoch ms at which the lock lifts.
     *
     * ⚠ Deliberately NOT returned to the client. "Try again in 12 minutes" confirms the
     * account exists, which reopens the enumeration channel that I-1 closes on the login
     * path. It is here so the server can log it and so the lock-expiry test can read it.
     */
    readonly lockedUntil: number | null = null,
  ) {
    // The message never reaches a response body (`lint-error-leak` bans reading
    // `.message` anywhere under `src/interface/`); it is for logs only.
    super(reason);
    this.name = "AuthError";
  }
}

/**
 * Password rejected by the strength policy (O-28 ①).
 *
 * Separate from `AuthError` because it is a VALIDATION failure with a field, not an
 * authentication failure -- it becomes a field-level 400 like every other contract
 * violation, not a 401.
 */
export class PasswordPolicyError extends Error {
  constructor(readonly rejection: z.infer<typeof C.PasswordRejection>) {
    super(rejection);
    this.name = "PasswordPolicyError";
  }
}
