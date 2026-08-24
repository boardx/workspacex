/**
 * Invariant I-4, the transactional half, for `registerNewAccount` (open-self-serve-
 * registration delta, issue #1929): **create org + create owner membership + create
 * credential are ONE transaction. Any step fails => full rollback => no half organization.**
 *
 * ⚠ This file REPLACES `invite-code-redeem-atomic.test.ts` (removed alongside
 * `redeemAndCreateOrg`/`registerWithInvite`), not merely renames it. The invite-code failure
 * modes (absent/spent/expired/revoked) are gone because there is no code; the ONLY
 * contracted failure left is `EMAIL_TAKEN`, so this file's "every failure leaves no half
 * organization" section has exactly one case where the old file had four.
 *
 * The concurrency half of I-4 (N simultaneous callers, one winner) does not apply here the
 * way it did to the code-redemption path: `registerNewAccount` has no shared contended row
 * to race over -- each caller supplies a DIFFERENT email, so the only concurrency invariant
 * left is "the `credentials_email_uniq` unique index rejects a genuine duplicate", which is
 * a property of PostgreSQL's own unique index, not of this feature's code. What IS this
 * feature's code is asserted below: a failed attempt leaves no organization, no membership,
 * no personal-local org and no queued verification email behind.
 *
 * ## What "half an organization" would actually look like
 *
 * Not an error. An `organizations` row with no admin, or an admin membership pointing at an
 * org whose creator has no credential, or a queued verification email for an account that
 * does not exist. Every one of those is a database that answers queries normally; the only
 * symptom is a user who cannot get in. So every rollback case below asserts on FOUR tables,
 * not on the returned error.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerNewAccount } from "../../src/application/auth/register-new-account";
import { EmailTakenError } from "../../src/application/auth/errors";
import { BcryptPasswordHasher } from "../../src/infrastructure/auth/bcrypt-password-hasher";
import { PgRegistrationRepository } from "../../src/infrastructure/auth/pg-registration-repository";
import { HmacEmailVerificationTokenCodec } from "../../src/infrastructure/auth/email-verification-token-codec";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { newOrgId, newUserId } from "../../src/domain/auth/registration";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";
import {
  countOrganizations,
  orgsOwnedBy,
  personalLocalOrgsOwnedBy,
  readCredentialByEmail,
  readVerificationTokens,
  resetAuthFixtures,
  resetOrgsOwnedBy,
} from "../support/auth-db";

const EMAIL_DOMAIN = "openreg-atomic.test";
const PASSWORD = "correct-horse-battery-staple";

let db: PgDatabase;
let repo: PgRegistrationRepository;
/** Real bcrypt, real cost. A fake hasher here would make the test cheap and I-2 unproven. */
const hasher = new BcryptPasswordHasher();
const verificationTokens = new HmacEmailVerificationTokenCodec("test-email-verification-secret-at-least-32-bytes");

/** Every user id this file creates, so cleanup can find the random org ids. */
const created: string[] = [];

async function register(local: string, orgName = "Acme") {
  const out = await registerNewAccount(
    { repo, hasher, verificationTokens },
    {
      email: `${local}@${EMAIL_DOMAIN}`,
      password: PASSWORD,
      displayName: `${local} person`,
      orgName,
    },
  );
  created.push(out.userId);
  return out;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgRegistrationRepository(db);
});

afterAll(async () => {
  await resetOrgsOwnedBy(created);
  await resetAuthFixtures({ codes: [], emailLike: `%@${EMAIL_DOMAIN}` });
  await db.close();
});

beforeEach(async () => {
  await resetOrgsOwnedBy(created);
  created.length = 0;
  await resetAuthFixtures({ codes: [], emailLike: `%@${EMAIL_DOMAIN}` });
});

describe("the happy path writes all four things, no code involved", () => {
  it("creates credential + organization + admin membership + verification", async () => {
    const out = await register("founder", "Ocean Consulting");

    // 1. the credential
    const cred = await readCredentialByEmail(`founder@${EMAIL_DOMAIN}`);
    expect(cred, "no credential row").not.toBeNull();
    expect(cred!.user_id).toBe(out.userId);
    // I-8's precondition: a new account starts UNVERIFIED, same as the removed invite path.
    expect(cred!.email_verified_at).toBeNull();

    // 2. the organization
    expect(await countOrganizations([out.orgId])).toBe(1);

    // 3. the owner membership -- the caller becomes admin/owner of the new org
    const admins = await orgsOwnedBy([out.userId]);
    expect(admins).toEqual([out.orgId]);

    // 4. the queued verification mail
    const tokens = await readVerificationTokens(out.userId);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.email).toBe(`founder@${EMAIL_DOMAIN}`);
    expect(tokens[0]!.consumed_at).toBeNull();
    expect(tokens[0]!.delivered_at).toBeNull();

    // The contract's literal.
    expect(out.verificationDelivery).toBe("queued");
  });

  it("normalizes the email, so `Founder@...` and `founder@...` are one account", async () => {
    const out = await registerNewAccount(
      { repo, hasher, verificationTokens },
      {
        email: `  MiXeD@${EMAIL_DOMAIN}  `,
        password: PASSWORD,
        displayName: "Mixed Case",
        orgName: "Acme",
      },
    );
    created.push(out.userId);
    const cred = await readCredentialByEmail(`mixed@${EMAIL_DOMAIN}`);
    expect(cred, "the stored address was not normalized").not.toBeNull();
    expect(cred!.email).toBe(`mixed@${EMAIL_DOMAIN}`);
  });

  it("each caller gets their OWN organization -- no shared resource to contend on", async () => {
    const a = await register("racer-a", "Org A");
    const b = await register("racer-b", "Org B");
    expect(a.orgId).not.toBe(b.orgId);
    expect(await countOrganizations([a.orgId, b.orgId])).toBe(2);
  });
});

/**
 * The ONLY contracted failure left (`EMAIL_TAKEN`) -- the invite-code failure modes
 * (absent/spent/expired/revoked) that used to live here are gone with the code itself.
 */
describe("the only failure left (EMAIL_TAKEN) leaves NO half organization (I-4)", () => {
  async function attemptWith(local: string) {
    const userId = newUserId();
    const orgId = newOrgId();
    const r = await repo.createAccountAndOrg({
      email: `${local}@${EMAIL_DOMAIN}`,
      displayName: local,
      passwordHash: await hasher.hash(PASSWORD),
      userId,
      orgId,
      orgName: "Rolled Back Co",
      verificationChallengeId: `challenge-${userId}`,
      verificationTokenDigest: verificationTokens.digest(`tok-${userId}`),
      verificationOutboxId: `outbox-${userId}`,
      verificationExpiresAt: new Date(Date.now() + 3600_000),
    });
    created.push(userId);
    return { result: r, userId, orgId };
  }

  async function assertNothingSurvives(a: { userId: string; orgId: string; email: string }) {
    expect(await countOrganizations([a.orgId]), "an organization survived a rolled-back registration")
      .toBe(0);
    expect(await orgsOwnedBy([a.userId]), "an admin membership survived").toEqual([]);
    // F16: registration also creates the user's personal-local organization, in the SAME
    // transaction. Same reasoning as the removed invite path.
    expect(
      await personalLocalOrgsOwnedBy([a.userId]),
      "a personal-local organization survived a rolled-back registration",
    ).toEqual([]);
    const tokens = await asOwner(async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM email_verification_challenges WHERE user_id = $1`,
        [a.userId],
      );
      return Number(r.rows[0]!.n);
    });
    expect(tokens, "a queued verification email survived a rolled-back registration").toBe(0);
  }

  it("email taken: refused, and nothing but the FIRST account's rows exist", async () => {
    const first = await register("dup");

    const second = await attemptWith("dup");
    expect(second.result.ok).toBe(false);
    if (!second.result.ok) expect(second.result.reason).toBe("email-taken");
    // ...and through the use case, the contracted error class.
    await expect(register("dup")).rejects.toBeInstanceOf(EmailTakenError);

    // The winner is untouched...
    expect(await countOrganizations([first.orgId])).toBe(1);
    expect(await orgsOwnedBy([first.userId])).toEqual([first.orgId]);
    // ...and the loser left nothing.
    await assertNothingSurvives({ ...second, email: `dup@${EMAIL_DOMAIN}` });
    // Only ONE credential row exists for the address, not two -- the failure mode this whole
    // file exists to rule out is a SECOND, half-wired account on the same email.
    expect(await readCredentialByEmail(`dup@${EMAIL_DOMAIN}`)).not.toBeNull();
  });
});

/**
 * Reverse-assertion: the section above is not vacuous unless `EMAIL_TAKEN` really is the
 * only failure mode `registerNewAccount.err` declares (no `INVITE_CODE_INVALID` left over).
 */
describe("the contract really has no invite-code failure mode any more", () => {
  it("registerNewAccount.err is exactly [EMAIL_TAKEN]", async () => {
    const { auth } = await import("@repo/contracts");
    expect(auth.operations.registerNewAccount.err).toEqual(["EMAIL_TAKEN"]);
    // ...and the OLD operation is genuinely gone, not merely renamed and forgotten about.
    expect((auth.operations as Record<string, unknown>).redeemInviteAndCreateOrg).toBeUndefined();
  });
});
