/**
 * `auth` ports -- declared by the application layer, implemented by `infrastructure`
 * (dependency inversion, ADR-020 onion rule).
 *
 * The contract's port table (contracts/auth/usecases.md) names five:
 * `CredentialRepository`, `SessionStore`, `InviteCodeRepository`, `PasswordHasher`,
 * `Mailer`. F19 needs three of them and takes a documented decision on the fifth.
 *
 * ## Why `InviteCodeRepository` and `CredentialRepository` are ONE port here
 *
 * Because I-4 says redemption, organization creation, owner membership and credential
 * creation are **one transaction**, and a transaction cannot span two repositories that
 * each open their own. Splitting them would produce the exact failure the invariant
 * forbids: the code marked spent, the credential insert failing, and half an organization
 * left behind -- with two perfectly reasonable-looking repositories and no place where the
 * bug lives.
 *
 * So the transaction boundary IS the port's method. `RegistrationRepository.redeemAndCreateOrg`
 * is a single call precisely because the contract says the writes are indivisible. The two
 * contracted port names are recorded here as what this one replaces, so the divergence is
 * visible rather than discovered.
 *
 * ## `SessionStore` is NOT here
 *
 * F19 does not issue sessions. F20 owns `Login` and session issuance, and it is running in
 * parallel -- two features each providing a `SESSION_STORE` token is a merge conflict at
 * best and two session stores at worst. (The kernel already binds `SESSION_STORE` to
 * `InMemorySessionStore` for the identity bundle; replacing it with Redis is A-3 in
 * coverage.md and belongs to whoever implements `Login`.)
 *
 * ⚠ UC-1.5 AC2 says "注册完成即已登录". F19 therefore does NOT satisfy AC2 -- it creates the
 * account and the organization but returns no session. It cannot: the contract's `out` for
 * this operation is `{ userId, orgId, emailVerificationSent }` with no session token in it,
 * and inventing one here would be a second session-issuing path competing with F20's.
 * Stated rather than quietly dropped.
 *
 * ## `Mailer` is NOT here either, and that is the interesting one
 *
 * See the header of `migrations/0010-f19-auth-registration.sql`. In short: the contract
 * makes `emailVerificationSent` a literal `true`, so "not sent" must be a failure rather
 * than a success body -- and an out-of-transaction SMTP call cannot deliver that, because
 * its failure arrives after the organization is already committed. Enqueueing durably
 * inside the same transaction can. So the "send" is a write in `redeemAndCreateOrg`, and
 * the relay that drains the outbox is out of phase-00 scope.
 */
import type { OrgId } from "../../domain/org-id";

/**
 * Hashing is a port because the algorithm is **part of the contract** (invariant I-2:
 * argon2id or bcrypt cost >= 12), not an implementation preference. A port makes swapping
 * it a deliberate act at the composition root rather than an edit inside a use case.
 */
export interface PasswordHasher {
  /** Returns a hash matching `auth.PasswordHashFormat`. Implementations self-check. */
  hash(plaintext: string): Promise<string>;
  /** F20 verifies; declared here so there is one port, not two. F19 does not call it. */
  verify(plaintext: string, hash: string): Promise<boolean>;
}

export const PASSWORD_HASHER = Symbol("PasswordHasher");

export interface RedeemAndCreateOrgInput {
  readonly code: string;
  /** Already normalized by the use case -- the repository does not re-normalize. */
  readonly email: string;
  readonly displayName: string;
  /** Already hashed. A plaintext password never crosses this boundary. */
  readonly passwordHash: string;
  readonly userId: string;
  readonly orgId: OrgId;
  readonly orgName: string;
  readonly verificationToken: string;
  readonly verificationExpiresAt: Date;
}

/**
 * Outcome of a redemption attempt.
 *
 * A discriminated union rather than exceptions-for-everything: `invite-code-invalid` and
 * `email-taken` are **contracted results** (they are in the operation's `err` list), while
 * a connection failure is not. Modelling the contracted failures as values keeps the
 * boundary honest -- a caller cannot forget to handle one, because TypeScript will not let
 * it read `.orgId` off the union without narrowing.
 */
export type RedeemAndCreateOrgResult =
  | { readonly ok: true; readonly userId: string; readonly orgId: OrgId }
  | { readonly ok: false; readonly reason: "invite-code-invalid" | "email-taken" };

export interface RegistrationRepository {
  /**
   * ⚠ **One call because it is one transaction** (I-4). Do not "helpfully" split this.
   *
   * Everything the invariant names happens inside: the conditional redemption, the
   * organization, the owner membership, the credential, and the queued verification mail.
   * Any failure rolls all of it back.
   */
  redeemAndCreateOrg(input: RedeemAndCreateOrgInput): Promise<RedeemAndCreateOrgResult>;

  /**
   * Flip `credentials.email_verified_at`, consuming the token.
   *
   * ⚠ Also one call, for a smaller version of the same reason: consuming the token and
   * marking the address verified must not be separable, or a crash between them produces
   * a spent token and an unverified account -- which, with no resend operation in the
   * contract, is an account that can never log in.
   *
   * Returns null when the token is unusable (absent / expired / already consumed) -- one
   * outcome for three causes, see `domain/auth/email-verification.ts`.
   */
  confirmEmailVerification(token: string, now: Date): Promise<{ userId: string } | null>;
}

export const REGISTRATION_REPOSITORY = Symbol("RegistrationRepository");
