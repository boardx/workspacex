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


/* ── 以下自 F19（注册侧）并入 ────────────────────────────────────
 * 两个并行 feature 各自建了一份 auth 地基。合并时以 F20 那份为底（它更完整：
 * 会话、锁定、重置都在里面），再把 F19 独有的搬过来——而不是二选一。
 */

/**
 * The `auth` bundle's contracted failures, as exceptions the interface layer can map.
 *
 * Every one of these carries a `reasonCode` drawn from `auth.AuthReason` in
 * `@repo/contracts` -- never a free string. `all-exceptions.filter.ts` parses the code
 * against the closed enum before letting it into a response body, so an internal message
 * cannot become a public contract by accident.
 */
import type { auth as A } from "@repo/contracts";

/** Derived from the contract, never restated -- the enum has exactly one definition. */
export type AuthReasonCode = z.infer<typeof A.AuthReason>;

/**
 * Both "no such code" and "already redeemed" and "expired" and "revoked".
 *
 * ⚠ **There is deliberately no second error class for the already-redeemed case**, and no
 * field on this one recording which case it was. Not because the distinction is
 * uninteresting -- because the moment it exists, someone maps it to a clearer message and
 * the 14-character brute-force space gets pruned by hit rate: an attacker who can tell
 * "real but spent" from "never existed" only has to find codes that WERE issued, which is
 * a far denser target than codes that are currently spendable.
 *
 * usecases.md is explicit that `INVITE_CODE_REDEEMED` is *deliberately not provided*, and
 * that the cost -- a real user re-clicking gets a vaguer message -- is an accepted
 * trade-off. This class is the shape of that decision in code: there is nothing here to
 * accidentally leak, because the information was never carried.
 */
export class InviteCodeInvalidError extends Error {
  readonly reasonCode: AuthReasonCode = "INVITE_CODE_INVALID";
  constructor() {
    // No detail in the message either: it reaches the LOGGER, and a log line saying
    // "code ABC already redeemed" is the same disclosure one storage layer further out.
    super("invite_code_invalid");
  }
}

/**
 * The email already has an account.
 *
 * ⚠ This one DOES disclose that an address is registered, and that is correct here -- see
 * the long note on `AuthReason` in the contract. UC-1.5 A2 requires the user be told to log
 * in instead; a vague failure would leave them unable to proceed at all. Email enumeration
 * is defended at `Login` (I-1) and `RequestPasswordReset` (always `sent: true`), which are
 * F20's and F21's, not here.
 */
export class EmailTakenError extends Error {
  readonly reasonCode: AuthReasonCode = "EMAIL_TAKEN";
  constructor() {
    super("email_taken");
  }
}

/** The one-time, invite-free cold-start path has already been consumed. */
export class BootstrapUnavailableError extends Error {
  readonly reasonCode: AuthReasonCode = "BOOTSTRAP_UNAVAILABLE";
  constructor() {
    super("bootstrap_unavailable");
  }
}
