/**
 * `RegisterNewAccount` (open-self-serve-registration delta, issue #1929) -- the use case.
 *
 * Replaces the removed `registerWithInvite`/`redeemInviteAndCreateOrg`: any caller can
 * self-serve a brand new organization and become its owner, with no invite code. See
 * `phases/phase-00-shared-kernel/design-deltas/open-self-serve-registration/contract.md`
 * for the signed-off decision record (5 points, all human-ruled 2026-08-24).
 *
 * Orchestration only. It knows nothing about HTTP and nothing about PostgreSQL; the
 * transaction it depends on is a property of the port's single method (see `ports.ts`).
 *
 * ## Anti-abuse: email verification, reusing the EXISTING closed loop
 *
 * Decision ②: the only anti-abuse control this delta adds is that the new account starts
 * unverified (`email_verified_at IS NULL`, same as the old invite path) and cannot log in
 * until it verifies -- see `login.ts`'s `EMAIL_NOT_VERIFIED` check, which reads directly off
 * the `credentials` row and does not care which registration path wrote it. No rate limiting
 * or CAPTCHA is added (decision ⑤ -- explicitly out of scope for this round).
 *
 * ## What is done HERE rather than inside the transaction, and why
 *
 * Password hashing. A bcrypt cost-12 hash takes hundreds of milliseconds by design -- that
 * slowness is the entire point of I-2. Doing it inside the transaction would hold the
 * `credentials_email_uniq` contention window open for that whole time. So: hash first, then
 * open the transaction. The cost is a hash computed for a registration that may fail --
 * which is CPU, not correctness.
 */
import { auth as A } from "@repo/contracts";
import {
  newOrgId,
  newUserId,
  normalizeEmail,
} from "../../domain/auth/registration";
import { EMAIL_VERIFICATION_TTL_MS } from "../../domain/auth/email-verification";
import { EmailTakenError } from "./errors";
import type { PasswordHasher, RegistrationRepository } from "./ports";
import type { EmailVerificationTokenCodec } from "./email-verification-ports";

export interface RegisterNewAccountDeps {
  readonly repo: RegistrationRepository;
  readonly hasher: PasswordHasher;
  readonly verificationTokens: EmailVerificationTokenCodec;
  /** Injected so expiry is assertable without waiting 24 hours. */
  readonly now?: () => Date;
}

export interface RegisterNewAccountInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly orgName: string;
}

export interface RegisterNewAccountOutput {
  readonly userId: string;
  readonly orgId: string;
  readonly verificationDelivery: "queued";
  /** HTTP adapter stores this in an HttpOnly cookie; it is never part of the JSON contract. */
  readonly pendingIdentityProof: string;
}

export async function registerNewAccount(
  deps: RegisterNewAccountDeps,
  input: RegisterNewAccountInput,
): Promise<RegisterNewAccountOutput> {
  const now = (deps.now ?? (() => new Date()))();

  const passwordHash = await deps.hasher.hash(input.password);

  /**
   * ⚠ Self-check against the contract's own definition of "slow hash" (I-2). Same reasoning
   * as the removed `registerWithInvite` -- not defensive noise, see that use case's history
   * for the full argument.
   */
  if (!A.PasswordHashFormat.safeParse(passwordHash).success) {
    throw new Error("password hasher produced a hash that violates invariant I-2");
  }

  const challengeId = deps.verificationTokens.newChallengeId();
  const verificationToken = deps.verificationTokens.tokenForChallenge(challengeId);
  const result = await deps.repo.createAccountAndOrg({
    email: normalizeEmail(input.email),
    displayName: input.displayName,
    passwordHash,
    userId: newUserId(),
    orgId: newOrgId(),
    orgName: input.orgName,
    verificationChallengeId: challengeId,
    verificationTokenDigest: deps.verificationTokens.digest(verificationToken),
    verificationOutboxId: `verify-${challengeId}`,
    verificationExpiresAt: new Date(now.getTime() + EMAIL_VERIFICATION_TTL_MS),
  });

  if (!result.ok) {
    throw new EmailTakenError();
  }

  return {
    userId: result.userId,
    orgId: result.orgId,
    // Literal `queued`, matching the contract. The repository only reaches this point when
    // the verification row committed alongside everything else, so the claim is backed by
    // a durable outbox write rather than by provider acceptance.
    verificationDelivery: "queued",
    pendingIdentityProof: deps.verificationTokens.pendingProofForChallenge(challengeId),
  };
}
