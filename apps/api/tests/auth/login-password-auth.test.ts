/**
 * F20 -- email + password login, end to end over HTTP (uc-1-1 R3 / AC1 / R12 V1, V5, V5a,
 * coverage V7).
 *
 * Booted through the real composition root, so what is asserted is the thing that ships:
 * the route, the global Guard, the contract pipe, PostgreSQL and Redis. Every response is
 * validated against the contract's `out` schema (contract-design hard rule 6), including
 * the REJECTION paths -- which is where the contract was wrong the last two times anyone
 * looked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { auth as C } from "@repo/contracts";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { ensureRedis, resetCredentials, seedCredential, storedPasswordHash } from "../support/auth";
import { checkPassword, WEAK_PASSWORD_COUNT } from "../../src/domain/auth/password-policy";

process.env.KERNEL_QUIET = "1";
// The kernel's test-injection channel stays available for the OTHER suites; this file never
// uses it, and asserts below that a real token does not need it.
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";

const ORG = "org-f20-login";
const PROJECT = "proj-f20-login";
const USER = "u-f20-login";
const EMAIL = "Linke@Yuanyang-Consulting.CN"; // deliberately mixed case -- normalisation
const PASSWORD = "correct-horse-battery-staple";

let BASE: string;
let app: NestExpressApplication;

beforeAll(async () => {
  ensureDatabase();
  ensureRedis();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  // Port 0: the OS assigns a free one. Deriving a port from a hash of the database name
  // was the previous approach and collided in CI (EADDRINUSE) -- there is no number to
  // collide on here.
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 120_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await resetCredentials([USER, `${USER}-unverified`], [EMAIL, `unverified-${EMAIL}`]);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "consultant", fx.teams.energy!);
  await seedCredential({ userId: USER, email: EMAIL, password: PASSWORD });
});

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

/**
 * `Response.json()` is typed `Promise<any>` in the DOM lib but `unknown` under this
 * project's stricter settings, so every assertion would need its own cast. One helper, and
 * the cast is stated once -- the alternative is fifteen inline `as` expressions, which is
 * fifteen places for a wrong one to hide.
 */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<Json> => res.json() as Promise<Json>;

describe("F20 login -- the success path", () => {
  it("correct credentials return a session token, and the body conforms to the contract", async () => {
    const res = await post("/auth/login", { email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    const body = await readJson(res);

    const parsed = C.operations.login.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();

    expect(body.userId).toBe(USER);
    expect(typeof body.sessionToken).toBe("string");
    expect(body.sessionToken.length).toBeGreaterThan(20);
    expect(body.orgs).toEqual([ORG]);
  });

  it("the email is matched case-insensitively (one normalisation, not two)", async () => {
    const res = await post("/auth/login", { email: EMAIL.toUpperCase(), password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it("I-9: the response carries NO role or scope -- `auth` produces no authorization verdict", async () => {
    const body = await post("/auth/login", { email: EMAIL, password: PASSWORD }).then(readJson);
    // The token itself is excluded: it is 43 characters of base64url, so it can contain the
    // literal substring "role" by chance -- roughly once in 400k tokens. A test that fails
    // once in 400k runs is worse than no test, because the failure looks like a real leak
    // and nobody can reproduce it.
    const { sessionToken: _token, ...rest } = body;
    const flat = JSON.stringify(rest);
    // The moment login answers "what may you do", there are two authorization sources and
    // X-1's entire job (there is exactly one) is over.
    for (const forbidden of ["role", "scope", "admin", "lead", "consultant", "permission"]) {
      expect(flat.toLowerCase(), `login response leaked \`${forbidden}\``).not.toContain(forbidden);
    }
  });

  it("the token actually authenticates a guarded route -- with NO test-injection header", async () => {
    const { sessionToken } = await post("/auth/login", { email: EMAIL, password: PASSWORD }).then(readJson);
    // This is the assertion that F18's placeholder resolver has really been replaced. Before
    // F20 the ONLY way to reach a guarded route was `x-kernel-test-principal`, which is
    // unreachable in production -- i.e. the product had no reachable authenticated path at all.
    const me = await fetch(`${BASE}/kernel/probe/whoami`, {
      headers: { authorization: `Bearer ${sessionToken}` },
    });
    expect(me.status).toBe(200);
    expect(await readJson(me)).toMatchObject({ userId: USER, orgId: ORG });
  });

  /**
   * Regression: `listMemberships` returned `[]` unconditionally.
   *
   * F01 declared it on the port and implemented it as a plain SELECT inside `withoutTenant`,
   * with a comment reading "RLS therefore does not help here". RLS did not merely fail to
   * help -- `org_memberships` is FORCE RLS with a fail-closed policy, so with no
   * `app.current_org` set the query matched nothing. It had no caller and no test until F20
   * needed it, and the symptom was `orgs: []` for an account that has a membership: a
   * successful login that drops the user nowhere.
   *
   * Kept as its own test rather than folded into the login assertion above, so that if it
   * regresses the failure names what broke.
   */
  it("regression: listMemberships returns the account's organizations under the RUNTIME role", async () => {
    const { PgIdentityRepository } = await import("../../src/infrastructure/identity/pg-identity-repository");
    const { PgDatabase } = await import("../../src/infrastructure/db/pg-database");
    const { appConfig } = await import("../../src/infrastructure/db/pg-config");
    // app_rw specifically -- as the OWNER this always worked, which is exactly why the bug
    // survived: every fixture helper in the suite runs as one role or the other, and the
    // broken path was the one nobody exercised.
    const db = new PgDatabase(appConfig());
    try {
      const rows = await new PgIdentityRepository(db).listMemberships(USER);
      expect(rows.map((r) => r.orgId)).toEqual([ORG]);
      // Counter-proof: a user with no membership still gets an empty list, so the fix is
      // not "return everything".
      expect(await new PgIdentityRepository(db).listMemberships("u-nobody-at-all")).toEqual([]);
    } finally {
      await db.close();
    }
  });

  it("a garbage bearer token is 401, not a pass-through", async () => {
    const me = await fetch(`${BASE}/kernel/probe/whoami`, {
      headers: { authorization: "Bearer not-a-real-token" },
    });
    expect(me.status).toBe(401);
  });
});

describe("F20 login -- the rejection paths", () => {
  it("wrong password -> 401 INVALID_CREDENTIAL", async () => {
    const res = await post("/auth/login", { email: EMAIL, password: "wrong-but-long-enough" });
    expect(res.status).toBe(401);
    expect((await readJson(res)).reasonCode).toBe("INVALID_CREDENTIAL");
  });

  it("I-8: an unverified account cannot log in, EVEN with the right password (both directions)", async () => {
    const unverifiedEmail = `unverified-${EMAIL}`;
    await seedCredential({
      userId: `${USER}-unverified`,
      email: unverifiedEmail,
      password: PASSWORD,
      emailVerified: false,
    });

    const denied = await post("/auth/login", { email: unverifiedEmail, password: PASSWORD });
    expect(denied.status).toBe(401);
    expect((await readJson(denied)).reasonCode).toBe("EMAIL_NOT_VERIFIED");

    // The other direction: verifying the email makes the SAME credentials work. Without
    // this half, "unverified accounts are refused" is satisfied by refusing everyone.
    await seedCredential({
      userId: `${USER}-unverified`,
      email: unverifiedEmail,
      password: PASSWORD,
      emailVerified: true,
    });
    const allowed = await post("/auth/login", { email: unverifiedEmail, password: PASSWORD });
    expect(allowed.status).toBe(200);
  });

  it("every rejection body carries a reasonCode drawn from the contract's closed set", async () => {
    const res = await post("/auth/login", { email: "nobody@example.com", password: "x".repeat(20) });
    const body = await readJson(res);
    // Membership in the contract enum, NOT `toHaveLength` on the enum -- asserting the
    // member COUNT turns a reviewed, legitimate addition into a test failure (hard rule 7).
    expect(C.AuthReason.options).toContain(body.reasonCode);
    expect(C.operations.login.err as readonly string[]).toContain(body.reasonCode);
  });

  it("a malformed body is a FIELD-LEVEL 400 from the contract schema, not a blanket 400", async () => {
    const res = await post("/auth/login", { email: "not-an-email", password: "" });
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.fields?.map((f: { path: string }) => f.path)).toEqual(
      expect.arrayContaining(["email", "password"]),
    );
  });
});

/**
 * Reverse assertions on the contract schema itself.
 *
 * `contract-response.test.ts` established why: a file full of `safeParse(...).success ===
 * true` assertions passes just as happily against a schema that accepts anything. These
 * prove the schema above actually refuses a drifted body, so the assertions in this file
 * are not spinning.
 */
describe("F20 -- the response schema really does reject drift (non-vacuity)", () => {
  it("login.out rejects a body missing sessionToken", () => {
    const r = C.operations.login.out.safeParse({ userId: "u", orgs: [], expiresAt: new Date().toISOString() });
    expect(r.success).toBe(false);
  });

  it("login.out rejects orgs carrying objects instead of ids (the I-9 drift shape)", () => {
    const r = C.operations.login.out.safeParse({
      sessionToken: "t", userId: "u",
      // This is exactly how I-9 would be violated in practice: someone adds the role
      // "because the frontend needs it anyway".
      orgs: [{ orgId: "org-a", orgRole: "admin" }],
      expiresAt: new Date().toISOString(),
    });
    expect(r.success).toBe(false);
  });

  it("login.out rejects a non-ISO expiresAt", () => {
    const r = C.operations.login.out.safeParse({
      sessionToken: "t", userId: "u", orgs: [], expiresAt: "soon",
    });
    expect(r.success).toBe(false);
  });
});

/**
 * I-2: the password is stored as a slow hash, and appears nowhere in plaintext.
 */
describe("F20 -- password storage (I-2 / uc-1-1 R12 V5)", () => {
  it("the stored value is bcrypt at cost >= 12, and is not the password", async () => {
    const hash = await storedPasswordHash(USER);
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
    const cost = Number(hash!.slice(4, 6));
    // The contract fixes the FLOOR (domain I-2). Asserting equality would fail a future
    // decision to raise it, which is a change this test should welcome, not block.
    expect(cost).toBeGreaterThanOrEqual(12);
    expect(hash).not.toContain(PASSWORD);
  });

  it("the login response never contains the password", async () => {
    const body = await post("/auth/login", { email: EMAIL, password: PASSWORD }).then((r) => r.text());
    expect(body).not.toContain(PASSWORD);
  });
});

/**
 * O-28 ① password policy, asserted in BOTH directions -- including the absences.
 *
 * The absences matter more than the presences here. "Length >= 12, no character-class rule,
 * check a weak list, never expire" is counter-intuitive enough that a reviewer's instinct is
 * to add back the familiar `[A-Z][0-9][!@#]` requirement. These tests fail if they do.
 */
describe("F20 -- password policy (uc-1-1 R12 V5a)", () => {
  it("11 characters rejected, 12 accepted", () => {
    expect(checkPassword("a".repeat(11))).toBe("TOO_SHORT");
    expect(checkPassword("abcdefghijkl")).toBeNull();
  });

  it("a long password with NO uppercase, digit or symbol is ACCEPTED", () => {
    // The whole ruling in one assertion. If someone adds a character-class rule, this fails.
    expect(checkPassword("correcthorsebatterystaple")).toBeNull();
  });

  it("`Password123456` is rejected despite passing length and every character class", () => {
    // uc-1-1 V5a names this case explicitly: it is the one that separates this policy from
    // the conventional one.
    expect(checkPassword("Password123456")).toBe("WEAK_COMMON");
    // ...and case-folding is real: the lowercase form is the same entry.
    expect(checkPassword("password123456")).toBe("WEAK_COMMON");
  });

  it("the weak-password list is NOT EMPTY (an empty list satisfies every assertion above)", () => {
    // Non-vacuity. "Checks a weak-password list" is trivially true of an empty list, and
    // a gate that is green because it is idle is this project's most repeated failure.
    expect(WEAK_PASSWORD_COUNT).toBeGreaterThan(10);
  });

  it("no route anywhere forces a password change -- there is no expiry flow (V5a, V5c)", async () => {
    // The ruling says rotation is NOT forced. The assertable form of "there is no such
    // flow" is that no endpoint answers for it.
    for (const path of ["/auth/password/expired", "/auth/password/rotate", "/auth/mfa/challenge"]) {
      const res = await post(path, {});
      expect(res.status, `${path} answered ${res.status} -- it should not exist`).toBe(404);
    }
  });
});
