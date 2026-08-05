/**
 * Email verification rules (UC-1.5 R3 step 4 / R9, ruling O-28).
 *
 * O-28 fixed the parameters: **link valid 24 hours, single use**, resend throttled to
 * 60s / 5 per day. UC-1.5 R9 says this policy is shared with UC-1.1's reset flow and
 * "不得各写一套" -- so the window is declared once, here, and both flows read it.
 *
 * Wave 2 enforces resend throttling at 60 seconds / 5 per rolling day in PostgreSQL.
 */

/** O-28: 24 hours, one-time. */
export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

export interface VerificationTokenState {
  readonly expiresAt: Date;
  readonly consumedAt: Date | null;
}

/**
 * Why expiry and re-use collapse into one boolean.
 *
 * Same anti-enumeration reasoning as `INVITE_CODE_INVALID`, and the same reasoning the
 * contract applies to `RESET_TOKEN_INVALID` ("过期与伪造共用一个码"): telling a caller
 * "this token is real but expired" confirms the token existed, which is the only bit an
 * attacker holding a guessed token is missing.
 *
 * The cost is the same deliberate one: a user who clicks an old link twice gets a vaguer
 * message than they could have had.
 */
export function isTokenUsable(state: VerificationTokenState, now: Date): boolean {
  if (state.consumedAt !== null) return false;
  return state.expiresAt.getTime() > now.getTime();
}
