/**
 * Invariant I-4, the transactional half: **redeem + create org + create owner membership +
 * create credential are ONE transaction. Any step fails => full rollback => no half
 * organization.**
 *
 * The concurrency half is a separate file, because it needs a different kind of assertion
 * and it is the half that fails silently.
 *
 * ## What "half an organization" would actually look like
 *
 * Not an error. An `organizations` row with no admin, or an admin membership pointing at an
 * org whose creator has no credential, or a spent invite code that produced nothing. Every
 * one of those is a database that answers queries normally; the only symptom is a user who
 * cannot get in and a code that cannot be reused. So every rollback case below asserts on
 * FOUR tables, not on the returned error.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { registerWithInvite } from "../../src/application/auth/register-with-invite";
import { EmailTakenError, InviteCodeInvalidError } from "../../src/application/auth/errors";
import { BcryptPasswordHasher } from "../../src/infrastructure/auth/bcrypt-password-hasher";
import { PgRegistrationRepository } from "../../src/infrastructure/auth/pg-registration-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { newOrgId, newUserId } from "../../src/domain/auth/registration";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";
import {
  countOrganizations,
  issueInviteCode,
  makeCode,
  orgsOwnedBy,
  personalLocalOrgsOwnedBy,
  readCredentialByEmail,
  readInviteCode,
  readVerificationTokens,
  resetAuthFixtures,
  resetOrgsOwnedBy,
} from "../support/auth-db";

const EMAIL_DOMAIN = "f19atomic.test";
const PASSWORD = "correct-horse-battery-staple";

const codes = {
  happy: makeCode("ATOMICHAPPY"),
  reuse: makeCode("ATOMICREUSE"),
  taken: makeCode("ATOMICTAKEN"),
  expired: makeCode("ATOMICEXPIR"),
  revoked: makeCode("ATOMICREVOK"),
  absent: makeCode("ATOMICNOPE1"),
};

let db: PgDatabase;
let repo: PgRegistrationRepository;
/** Real bcrypt, real cost. A fake hasher here would make the test cheap and I-2 unproven. */
const hasher = new BcryptPasswordHasher();

/** Every user id this file creates, so cleanup can find the random org ids. */
const created: string[] = [];

async function register(code: string, local: string, orgName = "Acme") {
  const out = await registerWithInvite(
    { repo, hasher },
    {
      code,
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
  await resetAuthFixtures({ codes: Object.values(codes), emailLike: `%@${EMAIL_DOMAIN}` });
  await db.close();
});

beforeEach(async () => {
  await resetOrgsOwnedBy(created);
  created.length = 0;
  await resetAuthFixtures({ codes: Object.values(codes), emailLike: `%@${EMAIL_DOMAIN}` });
});

describe("the happy path writes all four things, and writes them as the app role", () => {
  it("creates credential + organization + admin membership + verification, and spends the code", async () => {
    await issueInviteCode(codes.happy, { batchId: "batch-alpha" });

    const out = await register(codes.happy, "founder", "Ocean Consulting");

    // 1. the credential
    const cred = await readCredentialByEmail(`founder@${EMAIL_DOMAIN}`);
    expect(cred, "no credential row").not.toBeNull();
    expect(cred!.user_id).toBe(out.userId);
    // I-8's precondition: a new account starts UNVERIFIED.
    expect(cred!.email_verified_at).toBeNull();

    // 2. the organization
    expect(await countOrganizations([out.orgId])).toBe(1);

    // 3. the owner membership -- UC-1.5 R3 step 5, "授予管理员"
    const admins = await orgsOwnedBy([out.userId]);
    expect(admins).toEqual([out.orgId]);

    // 4. the queued verification mail
    const tokens = await readVerificationTokens(out.userId);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.email).toBe(`founder@${EMAIL_DOMAIN}`);
    expect(tokens[0]!.consumed_at).toBeNull();
    // ⚠ Still in the outbox. `emailVerificationSent: true` means "durably enqueued", and
    // this assertion is what keeps that claim honest -- there is no relay in phase-00, and
    // a test that asserted `delivered_at` non-null would be asserting a fiction.
    expect(tokens[0]!.delivered_at).toBeNull();

    // ...and the code is spent, pointing back at what it produced.
    const code = await readInviteCode(codes.happy);
    expect(code!.redeemed_by_user_id).toBe(out.userId);
    expect(code!.redeemed_at).not.toBeNull();
    expect(code!.created_org_id).toBe(out.orgId);

    // The contract's literal.
    expect(out.emailVerificationSent).toBe(true);
  });

  it("normalizes the email, so `Founder@...` and `founder@...` are one account", async () => {
    await issueInviteCode(codes.happy);
    const out = await registerWithInvite(
      { repo, hasher },
      {
        code: codes.happy,
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
});

/**
 * Each of these asserts the SAME four-table emptiness. That repetition is deliberate: the
 * cases fail at different points in the transaction, and a rollback that works for step 4
 * says nothing about one that has to unwind step 1.
 */
describe("every failure leaves NO half organization (I-4)", () => {
  /**
   * ⚠ These cases go through the REPOSITORY with ids chosen here, not through the use case,
   * which generates them internally and -- on failure -- never returns them.
   *
   * The first version of this file asked the question globally instead: "is there any
   * `org_memberships` row whose user has no credential". That is the right question and the
   * wrong scope. vitest runs test files in parallel against one database, and the other
   * files' cleanup deletes credentials before organizations, so for a few milliseconds
   * there really are orphaned memberships that have nothing to do with this test. It
   * surfaced while running a counter-proof: two cases went red that the injected bug could
   * not have affected. Left alone it would have been an intermittent failure in somebody
   * else's future session, blamed on their change.
   */
  async function attemptWith(code: string, local: string) {
    const userId = newUserId();
    const orgId = newOrgId();
    const r = await repo.redeemAndCreateOrg({
      code,
      email: `${local}@${EMAIL_DOMAIN}`,
      displayName: local,
      passwordHash: await hasher.hash(PASSWORD),
      userId,
      orgId,
      orgName: "Rolled Back Co",
      verificationToken: `tok-${userId}`,
      verificationExpiresAt: new Date(Date.now() + 3600_000),
    });
    created.push(userId);
    return { result: r, userId, orgId };
  }

  /** Every trace the attempt could have left, checked by the exact ids it used. */
  async function assertNothingSurvives(a: { userId: string; orgId: string; email: string }) {
    expect(await readCredentialByEmail(a.email), "a credential survived a rolled-back registration")
      .toBeNull();
    expect(await countOrganizations([a.orgId]), "an organization survived").toBe(0);
    expect(await orgsOwnedBy([a.userId]), "an admin membership survived").toEqual([]);
    // F16: registration also creates the user's personal-local organization, in the SAME
    // transaction. So "nothing survives" now has a second half -- and it is the half that
    // would be easy to get wrong, because a local organization left behind by a failed
    // registration is invisible (nobody has an account to look at it with) right up until
    // that user registers again and hits the I-2 unique index.
    expect(
      await personalLocalOrgsOwnedBy([a.userId]),
      "a personal-local organization survived a rolled-back registration",
    ).toEqual([]);
    const tokens = await asOwner(async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM email_verification_tokens WHERE user_id = $1`,
        [a.userId],
      );
      return Number(r.rows[0]!.n);
    });
    expect(tokens, "a queued verification email survived a rolled-back registration").toBe(0);
  }

  it("code already redeemed: second attempt rolls back entirely, first org untouched", async () => {
    await issueInviteCode(codes.reuse);
    const first = await register(codes.reuse, "first");

    const second = await attemptWith(codes.reuse, "second");
    expect(second.result.ok).toBe(false);
    if (!second.result.ok) expect(second.result.reason).toBe("invite-code-invalid");
    // ...and through the use case, the contracted error class.
    await expect(register(codes.reuse, "third")).rejects.toBeInstanceOf(InviteCodeInvalidError);

    // The winner is untouched...
    expect(await countOrganizations([first.orgId])).toBe(1);
    expect(await orgsOwnedBy([first.userId])).toEqual([first.orgId]);
    // ...and the loser left nothing. This is THE assertion of "一码一组织".
    await assertNothingSurvives({ ...second, email: `second@${EMAIL_DOMAIN}` });
    const code = await readInviteCode(codes.reuse);
    expect(code!.redeemed_by_user_id).toBe(first.userId);
    expect(code!.created_org_id).toBe(first.orgId);
  });

  it("email taken: the code is NOT spent, so the user can retry after signing in (A2/A3)", async () => {
    await issueInviteCode(codes.happy);
    await issueInviteCode(codes.taken);
    await register(codes.happy, "dup");

    await expect(register(codes.taken, "dup")).rejects.toBeInstanceOf(EmailTakenError);

    // The interesting half: a failed registration must not burn the invite code. UC-1.5 A2
    // tells the user to sign in and use the code from there -- which is impossible if the
    // failed attempt consumed it.
    const code = await readInviteCode(codes.taken);
    expect(code!.redeemed_by_user_id, "a failed registration spent the invite code").toBeNull();
    expect(code!.created_org_id).toBeNull();
  });

  it("expired code (O-29: 90 days): refused, nothing created", async () => {
    await issueInviteCode(codes.expired, { expiresAt: new Date(Date.now() - 1000) });
    const a = await attemptWith(codes.expired, "late");
    expect(a.result.ok).toBe(false);
    await assertNothingSurvives({ ...a, email: `late@${EMAIL_DOMAIN}` });
    expect((await readInviteCode(codes.expired))!.redeemed_by_user_id).toBeNull();
    await expect(register(codes.expired, "late2")).rejects.toBeInstanceOf(InviteCodeInvalidError);
  });

  it("revoked code: refused, nothing created", async () => {
    await issueInviteCode(codes.revoked, { revokedAt: new Date() });
    const a = await attemptWith(codes.revoked, "revoked");
    expect(a.result.ok).toBe(false);
    await assertNothingSurvives({ ...a, email: `revoked@${EMAIL_DOMAIN}` });
    await expect(register(codes.revoked, "revoked2")).rejects.toBeInstanceOf(InviteCodeInvalidError);
  });

  it("absent code: refused, nothing created", async () => {
    const a = await attemptWith(codes.absent, "ghost");
    expect(a.result.ok).toBe(false);
    await assertNothingSurvives({ ...a, email: `ghost@${EMAIL_DOMAIN}` });
    await expect(register(codes.absent, "ghost2")).rejects.toBeInstanceOf(InviteCodeInvalidError);
  });
});

/**
 * Anti-enumeration, at the layer where the information exists.
 *
 * The HTTP-level version of this is in `register-http-contract.test.ts`. Both are needed:
 * this one proves the application layer never CARRIES the distinction, which is what stops
 * a future controller from being able to leak it even if someone wanted to.
 */
describe("the four ways a code can fail are indistinguishable (V9 / V11)", () => {
  it("absent, spent, expired and revoked all produce the identical error object", async () => {
    await issueInviteCode(codes.reuse);
    await register(codes.reuse, "winner");
    await issueInviteCode(codes.expired, { expiresAt: new Date(Date.now() - 1000) });
    await issueInviteCode(codes.revoked, { revokedAt: new Date() });

    const errs: unknown[] = [];
    for (const [code, local] of [
      [codes.absent, "e1"],
      [codes.reuse, "e2"],
      [codes.expired, "e3"],
      [codes.revoked, "e4"],
    ] as const) {
      errs.push(await register(code, local).then(() => null, (e: unknown) => e));
    }

    for (const e of errs) {
      expect(e).toBeInstanceOf(InviteCodeInvalidError);
      // Compared field by field, not just by class: a subclass or an extra property is how
      // the distinction comes back.
      expect(Object.keys(e as object).sort()).toEqual(["reasonCode"]);
      expect((e as InviteCodeInvalidError).message).toBe("invite_code_invalid");
      expect((e as InviteCodeInvalidError).reasonCode).toBe("INVITE_CODE_INVALID");
    }
    // ⚠ And the code that says "this one exists but is spent" must not exist at all.
    // A member added later would let a well-meaning UI change re-open the channel.
    const { auth } = await import("@repo/contracts");
    expect(auth.AuthReason.options).not.toContain("INVITE_CODE_REDEEMED");
    // Non-vacuity: the enum is real and non-empty, so the assertion above is about a
    // populated set rather than an empty one.
    expect(auth.AuthReason.options).toContain("INVITE_CODE_INVALID");
  });
});

/**
 * Least privilege, asserted rather than merely granted.
 *
 * O-29 ruled that invite codes are issued OFFLINE by the platform operator. Migration 0010
 * grants `app_rw` SELECT+UPDATE and withholds INSERT/DELETE, which means a compromised
 * runtime role can spend a code it was given but cannot mint one. A GRANT is a line in a
 * file; this is the check that it is in effect.
 */
describe("the runtime role can spend an invite code but not mint one", () => {
  it("app_rw has no INSERT on invite_codes", async () => {
    const priv = await asOwner(async (c) => {
      const r = await c.query<{ ins: boolean; del: boolean; sel: boolean; upd: boolean }>(
        `SELECT has_table_privilege('app_rw','invite_codes','INSERT') AS ins,
                has_table_privilege('app_rw','invite_codes','DELETE') AS del,
                has_table_privilege('app_rw','invite_codes','SELECT') AS sel,
                has_table_privilege('app_rw','invite_codes','UPDATE') AS upd`,
      );
      return r.rows[0]!;
    });
    // Two-way: withheld where it should be, present where redemption needs it. Asserting
    // only the absences would pass on a role with no grants at all.
    expect(priv.ins, "app_rw can mint invite codes").toBe(false);
    expect(priv.del, "app_rw can destroy the evidence that a code was spent").toBe(false);
    expect(priv.sel).toBe(true);
    expect(priv.upd).toBe(true);
  });
});
