/**
 * Completing the email verification (UC-1.5 R3 step 4).
 *
 * ⚠⚠ **This use case has NO contracted operation and NO HTTP route, on purpose.**
 *
 * `contracts/auth/usecases.md` lists five operations and none of them consumes a
 * verification token. `Credential.emailVerifiedAt` is a contract field, invariant I-8 says
 * an unverified account cannot log in, and coverage.md's V4 requires that be asserted --
 * but there is no contracted way for `emailVerifiedAt` to ever become non-null. Taken
 * literally, no account created by `RedeemInviteAndCreateOrg` can ever log in, and both
 * F19's and F20's acceptances still pass: F19 asserts "new account is unverified" (true),
 * F20 asserts "unverified account is refused" (also true).
 *
 * coverage.md's reverse check ("有没有多余的操作") cannot find this, because it looks for
 * operations with no requirement, not requirements with no operation.
 *
 * The instruction for this feature is explicit: if the contract cannot express something,
 * say so rather than invent a shape. So:
 *   * the RULE is implemented here, where UC-1.5 R9 / O-28 state it (24 hours, one-time)
 *   * no operation is added to `packages/contracts/src/auth.ts`
 *   * no route is mounted
 *   * it is logged as `KNOWN_CONTRACT_GAPS.C1` in the contract itself
 *
 * Adding the operation requires re-signing `design-signoff.md`, and that is a human's
 * action, not an agent's (contract-design.md hard rule 1).
 *
 * It exists rather than being left out entirely because without it invariant I-8 is
 * one-directional: "unverified cannot log in" with no reachable "verified can" is
 * indistinguishable from "nobody can log in, ever". Two-way assertions need both ends.
 */
import type { RegistrationRepository } from "./ports";

export interface ConfirmEmailVerificationDeps {
  readonly repo: RegistrationRepository;
  readonly now?: () => Date;
}

/**
 * Returns the verified user's id, or null.
 *
 * ⚠ **One null for three causes** (no such token / expired / already consumed), the same
 * collapse the contract mandates for `RESET_TOKEN_INVALID` ("过期与伪造共用一个码"). A
 * caller has nothing to distinguish, so a future route cannot leak the distinction even by
 * accident.
 */
export async function confirmEmailVerification(
  deps: ConfirmEmailVerificationDeps,
  token: string,
): Promise<{ userId: string } | null> {
  const now = (deps.now ?? (() => new Date()))();
  return deps.repo.confirmEmailVerification(token, now);
}
