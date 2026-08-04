import { auth as A } from "@repo/contracts";
import { newOrgId, newUserId, normalizeEmail } from "../../domain/auth/registration";
import { BootstrapUnavailableError, EmailTakenError } from "./errors";
import type { PasswordHasher, RegistrationRepository } from "./ports";

export interface BootstrapFirstUserDeps {
  readonly repo: RegistrationRepository;
  readonly hasher: PasswordHasher;
  readonly now?: () => Date;
}

export interface BootstrapFirstUserInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
  readonly orgName: string;
}

export interface BootstrapFirstUserOutput {
  readonly userId: string;
  readonly orgId: string;
  readonly emailVerified: true;
}

export async function bootstrapFirstUser(
  deps: BootstrapFirstUserDeps,
  input: BootstrapFirstUserInput,
): Promise<BootstrapFirstUserOutput> {
  // The endpoint is public. Once the permanent gate is consumed, reject before bcrypt so
  // anonymous guaranteed losers cannot turn password hashing into an unbounded CPU sink.
  // This is not the concurrency authority: the repository repeats the check under its
  // transaction-scoped advisory lock.
  if (!await deps.repo.isFirstUserBootstrapAvailable()) throw new BootstrapUnavailableError();

  // Deliberately outside the transaction: bcrypt is slow by design and must not hold the
  // global bootstrap lock. Contenders during the brief initial race may compute a discarded
  // hash; after the winner commits, the cheap preflight rejects all later calls.
  const passwordHash = await deps.hasher.hash(input.password);
  if (!A.PasswordHashFormat.safeParse(passwordHash).success) {
    throw new Error("password hasher produced a hash that violates invariant I-2");
  }

  const result = await deps.repo.bootstrapFirstUser({
    email: normalizeEmail(input.email),
    displayName: input.displayName,
    passwordHash,
    userId: newUserId(),
    orgId: newOrgId(),
    orgName: input.orgName,
    emailVerifiedAt: (deps.now ?? (() => new Date()))(),
  });

  if (!result.ok) {
    if (result.reason === "email-taken") throw new EmailTakenError();
    throw new BootstrapUnavailableError();
  }
  return { userId: result.userId, orgId: result.orgId, emailVerified: true };
}
