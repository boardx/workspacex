/**
 * `RedeemInviteAndCreateOrg` (F19 / UC-1.5) -- the use case.
 *
 * Orchestration only. It knows nothing about HTTP and nothing about PostgreSQL; the
 * transaction it depends on is a property of the port's single method (see `ports.ts`).
 *
 * ## What is done HERE rather than inside the transaction, and why
 *
 * Password hashing. A bcrypt cost-12 hash takes hundreds of milliseconds by design -- that
 * slowness is the entire point of I-2. Doing it inside the transaction would hold the
 * invite-code row lock for that whole time, which under the concurrent-redemption case
 * (V3) means the losing transaction waits ~a second to be told the code is gone. Worse, it
 * scales: N concurrent attempts serialise into N hash-lengths of lock time.
 *
 * So: hash first, then open the transaction. The cost is a hash computed for a
 * registration that may fail -- which is CPU, not correctness.
 */
import { auth as A } from "@repo/contracts";
import {
  newOrgId,
  newUserId,
  normalizeEmail,
} from "../../domain/auth/registration";
import { EMAIL_VERIFICATION_TTL_MS } from "../../domain/auth/email-verification";
import { EmailTakenError, InviteCodeInvalidError } from "./errors";
import type { PasswordHasher, RegistrationRepository } from "./ports";
import type { EmailVerificationTokenCodec } from "./email-verification-ports";

export interface RegisterDeps {
  readonly repo: RegistrationRepository;
  readonly hasher: PasswordHasher;
  readonly verificationTokens: EmailVerificationTokenCodec;
  /** Injected so expiry is assertable without waiting 24 hours. */
  readonly now?: () => Date;
}

export interface RegisterInput {
  readonly code: string;
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly orgName: string;
}

export interface RegisterOutput {
  readonly userId: string;
  readonly orgId: string;
  readonly verificationDelivery: "queued";
}

export async function registerWithInvite(
  deps: RegisterDeps,
  input: RegisterInput,
): Promise<RegisterOutput> {
  const now = (deps.now ?? (() => new Date()))();

  const passwordHash = await deps.hasher.hash(input.password);

  /**
   * ⚠ Self-check against the contract's own definition of "slow hash" (I-2).
   *
   * This is not defensive noise. The hasher is a PORT: the composition root can bind any
   * implementation, and the failure mode of binding a wrong one is not an exception -- it
   * is a `credentials` row with a fast hash in it, which nothing at runtime would notice.
   * The database's CHECK constraint catches it too, but one layer later and with a message
   * about a constraint rather than about I-2.
   *
   * Parsed against the contract's schema, so "what counts as a slow hash" has exactly one
   * definition (packages/contracts/src/auth.ts `PasswordHashFormat`).
   */
  if (!A.PasswordHashFormat.safeParse(passwordHash).success) {
    // ⚠ Note what is NOT in this message: the hash, and obviously the password. The
    // implementation's identity is what a maintainer needs; the value is what an attacker
    // needs.
    throw new Error("password hasher produced a hash that violates invariant I-2");
  }

  const challengeId = deps.verificationTokens.newChallengeId();
  const verificationToken = deps.verificationTokens.tokenForChallenge(challengeId);
  const result = await deps.repo.redeemAndCreateOrg({
    code: input.code,
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
    if (result.reason === "email-taken") throw new EmailTakenError();
    throw new InviteCodeInvalidError();
  }

  return {
    userId: result.userId,
    orgId: result.orgId,
    // Literal `true`, matching the contract. The repository only reaches this point when
    // the verification row committed alongside everything else, so the claim is backed by
    // a durable write rather than by a hope that SMTP worked.
    verificationDelivery: "queued",
  };
}
