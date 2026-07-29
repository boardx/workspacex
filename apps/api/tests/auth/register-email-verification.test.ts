/**
 * Email verification (UC-1.5 R3 step 4 / R9, ruling O-28: 24 hours, one-time).
 *
 * ## Read this before reading the tests
 *
 * `contracts/auth/usecases.md` has **no operation that consumes a verification token**.
 * `Credential.emailVerifiedAt` is a contract field and I-8 says an unverified account
 * cannot log in, but nothing in the signed bundle can ever set it -- so, taken literally,
 * no account created by F19 could ever log in, and both F19's and F20's acceptances would
 * still be green (F19: "new account is unverified" ✓; F20: "unverified is refused" ✓).
 *
 * That is logged as `KNOWN_CONTRACT_GAPS.C1` in the contract itself. F19 implements the
 * RULE (in `application/auth/confirm-email-verification.ts`) but adds **no operation and no
 * route**, because that would need a re-signature and signing is a human's act.
 *
 * So the tests below exercise an application use case directly. That is a real limitation
 * and it is stated rather than papered over: nothing here proves an end-to-end HTTP
 * verification flow, because there is no contracted flow to prove.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { confirmEmailVerification } from "../../src/application/auth/confirm-email-verification";
import { registerWithInvite } from "../../src/application/auth/register-with-invite";
import { EMAIL_VERIFICATION_TTL_MS } from "../../src/domain/auth/email-verification";
import { isTokenUsable } from "../../src/domain/auth/email-verification";
import { BcryptPasswordHasher } from "../../src/infrastructure/auth/bcrypt-password-hasher";
import { PgRegistrationRepository } from "../../src/infrastructure/auth/pg-registration-repository";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { asOwner, ensureDatabase, migrateOnce } from "../support/db";
import {
  issueInviteCode,
  makeCode,
  readCredentialByEmail,
  readVerificationTokens,
  resetAuthFixtures,
  resetOrgsOwnedBy,
} from "../support/auth-db";

const EMAIL_DOMAIN = "f19verify.test";
const PASSWORD = "correct-horse-battery-staple";
const codes = Array.from({ length: 6 }, (_, i) => makeCode(`VERIFYCODE${i}`));

let db: PgDatabase;
let repo: PgRegistrationRepository;
const hasher = new BcryptPasswordHasher();
const created: string[] = [];
let nextCode = 0;

async function registerFresh(local: string) {
  const code = codes[nextCode++]!;
  await issueInviteCode(code);
  const out = await registerWithInvite(
    { repo, hasher },
    {
      code,
      email: `${local}@${EMAIL_DOMAIN}`,
      password: PASSWORD,
      displayName: local,
      orgName: "Verify Co",
    },
  );
  created.push(out.userId);
  const tokens = await readVerificationTokens(out.userId);
  return { ...out, token: tokens[0]!.token, email: `${local}@${EMAIL_DOMAIN}` };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgRegistrationRepository(db);
});

afterAll(async () => {
  await resetOrgsOwnedBy(created);
  await resetAuthFixtures({ codes, emailLike: `%@${EMAIL_DOMAIN}` });
  await db.close();
});

beforeEach(async () => {
  await resetOrgsOwnedBy(created);
  created.length = 0;
  nextCode = 0;
  await resetAuthFixtures({ codes, emailLike: `%@${EMAIL_DOMAIN}` });
});

describe("a new account starts unverified and can be verified -- BOTH directions", () => {
  it("registration leaves email_verified_at NULL, and confirming sets it", async () => {
    const r = await registerFresh("alice");

    // Direction 1: unverified. This is the precondition I-8 rests on.
    const before = await readCredentialByEmail(r.email);
    expect(before!.email_verified_at, "a brand new account was already verified").toBeNull();

    const confirmed = await confirmEmailVerification({ repo }, r.token);
    expect(confirmed).toEqual({ userId: r.userId });

    // Direction 2: verified. Without this half, "unverified cannot log in" is
    // indistinguishable from "nobody can ever log in".
    const after = await readCredentialByEmail(r.email);
    expect(after!.email_verified_at, "confirming did not verify the address").not.toBeNull();

    // ...and the token is spent, in the same write.
    const tokens = await readVerificationTokens(r.userId);
    expect(tokens[0]!.consumed_at).not.toBeNull();
  });

  it("the link is ONE-TIME: a second click changes nothing and reports nothing new", async () => {
    const r = await registerFresh("bob");
    const first = await confirmEmailVerification({ repo }, r.token);
    expect(first).not.toBeNull();
    const verifiedAt = (await readCredentialByEmail(r.email))!.email_verified_at;

    const second = await confirmEmailVerification({ repo }, r.token);
    expect(second, "the same verification link worked twice").toBeNull();
    // The timestamp did not move -- a re-verify that overwrote it would erase when the
    // address was actually confirmed, which is the only auditable fact here.
    expect((await readCredentialByEmail(r.email))!.email_verified_at).toEqual(verifiedAt);
  });

  it("an expired link (O-28: 24 hours) is refused, and the account stays unverified", async () => {
    const r = await registerFresh("carol");
    // Move the token's expiry into the past rather than waiting a day.
    await asOwner((c) =>
      c.query(`UPDATE email_verification_tokens SET expires_at = now() - interval '1 minute' WHERE token = $1`, [
        r.token,
      ]),
    );

    expect(await confirmEmailVerification({ repo }, r.token)).toBeNull();
    expect((await readCredentialByEmail(r.email))!.email_verified_at).toBeNull();
    // The token was not consumed either: it expired, it was not spent. Keeping those
    // distinct is what a future resend flow needs.
    expect((await readVerificationTokens(r.userId))[0]!.consumed_at).toBeNull();
  });

  it("a forged token verifies nobody", async () => {
    const r = await registerFresh("dave");
    expect(await confirmEmailVerification({ repo }, "not-a-real-token")).toBeNull();
    expect((await readCredentialByEmail(r.email))!.email_verified_at).toBeNull();
  });
});

describe("the token is issued with the contracted window and the contracted properties", () => {
  it("expires 24 hours out, is single-use, and is high-entropy", async () => {
    const at = new Date("2026-07-29T00:00:00.000Z");
    const code = codes[nextCode++]!;
    await issueInviteCode(code);
    const out = await registerWithInvite(
      { repo, hasher, now: () => at },
      {
        code,
        email: `erin@${EMAIL_DOMAIN}`,
        password: PASSWORD,
        displayName: "erin",
        orgName: "Verify Co",
      },
    );
    created.push(out.userId);

    const tokens = await readVerificationTokens(out.userId);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.expires_at.getTime()).toBe(at.getTime() + EMAIL_VERIFICATION_TTL_MS);
    // 24 hours, from the single source both the domain and this assertion read.
    expect(EMAIL_VERIFICATION_TTL_MS).toBe(24 * 60 * 60 * 1000);

    // Unpredictable (UC-1.5 R9). 32 random bytes in base64url = 43 characters; asserting
    // the LENGTH rather than the exact value is what survives a change of encoding, and
    // asserting it at all is what would catch a token accidentally derived from the email.
    expect(tokens[0]!.token.length).toBeGreaterThanOrEqual(40);
    expect(tokens[0]!.token).not.toContain("erin");
    expect(tokens[0]!.token).not.toContain(out.userId);
  });

  it("two registrations never share a token", async () => {
    const a = await registerFresh("frank");
    const b = await registerFresh("grace");
    expect(a.token).not.toBe(b.token);
  });
});

describe("the domain rule is not vacuous", () => {
  /**
   * `isTokenUsable` is the pure statement of "24 hours, one-time". The database enforces the
   * same thing in SQL, and the tests above go through the database -- so this checks the two
   * agree, rather than leaving the pure function as decoration nobody executes.
   */
  it("isTokenUsable accepts a fresh token and rejects both failure modes", () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    const fresh = { expiresAt: new Date(now.getTime() + 1000), consumedAt: null };
    expect(isTokenUsable(fresh, now)).toBe(true);
    expect(isTokenUsable({ ...fresh, consumedAt: now }, now)).toBe(false);
    expect(isTokenUsable({ expiresAt: new Date(now.getTime() - 1), consumedAt: null }, now)).toBe(false);
    // Exactly at the boundary the token is already gone -- `>` not `>=`, matching the SQL.
    expect(isTokenUsable({ expiresAt: now, consumedAt: null }, now)).toBe(false);
  });
});
