/**
 * F21 -- a password reset revokes EVERY existing session. Invariant I-5 (with I-7),
 * uc-1-1 R4 A2 step 5 / AC3 / R12 V3 / E6; coverage V11.
 *
 * ## Why `revokedSessionCount` is contract surface and not a debug field
 *
 * The most common way to get uc-1-1 R4 wrong is to revoke only the CURRENT session. The
 * resulting response is IDENTICAL to a correct implementation's in every respect except
 * this number -- the reset succeeds, the new password works, and the attacker's session on
 * another device keeps working silently. There is nothing else to assert on.
 *
 * So the tests below establish THREE sessions on purpose, from three "devices", and then
 * assert both the count and the actual usability of each one afterwards. Asserting only the
 * count would pass against an implementation that counts correctly and revokes nothing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { ensureRedis, resetCredentials, seedCredential } from "../support/auth";
import { OutboxMailer } from "../../src/infrastructure/auth/outbox-mailer";
import { MAILER, SESSION_TOKEN_STORE } from "../../src/application/auth/ports";
import type { RedisSessionTokenStore } from "../../src/infrastructure/auth/redis-session-token-store";
import { checkSession } from "../../src/domain/auth/session-lifetime";

process.env.KERNEL_QUIET = "1";

const ORG = "org-f21-revoke";
const PROJECT = "proj-f21-revoke";
const USER = "u-f21-revoke";
const EMAIL = "multidevice@f21-revoke.test";
const BYSTANDER = "u-f21-revoke-other";
const BYSTANDER_EMAIL = "bystander@f21-revoke.test";
const OLD_PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "a-brand-new-passphrase-here";

let BASE: string;
let app: NestExpressApplication;
let outbox: OutboxMailer;
let sessions: RedisSessionTokenStore;

beforeAll(async () => {
  ensureDatabase();
  ensureRedis();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  outbox = app.get<OutboxMailer>(MAILER);
  // The SAME store instance the app uses -- so I-7 can be inspected at the storage level,
  // not merely inferred from a 401.
  sessions = app.get<RedisSessionTokenStore>(SESSION_TOKEN_STORE);
}, 120_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await resetCredentials([USER, BYSTANDER], [EMAIL, BYSTANDER_EMAIL]);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "consultant", fx.teams.energy!);
  await addOrgMember(ORG, BYSTANDER, "consultant", fx.teams.energy!);
  await seedCredential({ userId: USER, email: EMAIL, password: OLD_PASSWORD });
  await seedCredential({ userId: BYSTANDER, email: BYSTANDER_EMAIL, password: OLD_PASSWORD });
  // PURGE, not revoke. Revocation deliberately keeps the records (I-7), so revoking between
  // tests would leave every previous test's sessions in `listForUser` and the I-7 counts
  // below would grow with the file. Fixture cleanup deletes; the product marks.
  await sessions.purgeForUser(USER);
  await sessions.purgeForUser(BYSTANDER);
  outbox.clear();
});

const post = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** `Response.json()` is `unknown` here; the cast is stated once rather than at each call. */
type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const readJson = (res: Response): Promise<Json> => res.json() as Promise<Json>;

/** One "device" = one login = one session token. */
async function loginAs(email: string, password: string): Promise<string> {
  const res = await post("/auth/login", { email, password });
  if (res.status !== 200) throw new Error(`login failed with ${res.status}`);
  return (await readJson(res)).sessionToken as string;
}

/** Does this token still open a guarded route? */
async function stillWorks(token: string): Promise<boolean> {
  const r = await fetch(`${BASE}/kernel/probe/whoami`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return r.status === 200;
}

async function resetPassword(email: string, newPassword: string): Promise<number> {
  await post("/auth/password-reset/request", { email });
  const msg = outbox.drain().find((m) => m.kind === "password-reset-link" && m.to === email);
  if (!msg) throw new Error(`no reset mail for ${email}`);
  const res = await post("/auth/password-reset/complete", { token: msg.body.token!, newPassword });
  if (res.status !== 200) throw new Error(`reset failed with ${res.status}`);
  return (await readJson(res)).revokedSessionCount as number;
}

describe("I-5 -- a reset kills every existing session, not just one", () => {
  it("three devices in, three sessions revoked, and all three tokens stop working", async () => {
    const laptop = await loginAs(EMAIL, OLD_PASSWORD);
    const phone = await loginAs(EMAIL, OLD_PASSWORD);
    const tablet = await loginAs(EMAIL, OLD_PASSWORD);

    // Establish the premise. Without this the "they stopped working" assertion below would
    // also pass against tokens that never worked.
    expect(await stillWorks(laptop)).toBe(true);
    expect(await stillWorks(phone)).toBe(true);
    expect(await stillWorks(tablet)).toBe(true);

    const revokedSessionCount = await resetPassword(EMAIL, NEW_PASSWORD);

    // ⚠ THE assertion that separates a correct implementation from the common wrong one.
    // Revoking only the current session returns 1 here and looks identical otherwise.
    expect(
      revokedSessionCount,
      "only some sessions were revoked -- uc-1-1 R4 requires ALL existing sessions of the account",
    ).toBe(3);

    // And the count is not just bookkeeping: every token is actually dead.
    expect(await stillWorks(laptop)).toBe(false);
    expect(await stillWorks(phone)).toBe(false);
    expect(await stillWorks(tablet)).toBe(false);
  }, 120_000);

  it("a session created AFTER the reset works (revocation is not a permanent lockout)", async () => {
    await loginAs(EMAIL, OLD_PASSWORD);
    await resetPassword(EMAIL, NEW_PASSWORD);

    // The other direction. "All sessions are dead" is satisfied by an account that can
    // never log in again, which is a broken reset wearing the costume of a security control.
    const fresh = await loginAs(EMAIL, NEW_PASSWORD);
    expect(await stillWorks(fresh)).toBe(true);
  }, 120_000);

  it("another user's sessions are untouched", async () => {
    const mine = await loginAs(EMAIL, OLD_PASSWORD);
    const theirs = await loginAs(BYSTANDER_EMAIL, OLD_PASSWORD);

    const count = await resetPassword(EMAIL, NEW_PASSWORD);
    expect(count).toBe(1);
    expect(await stillWorks(mine)).toBe(false);
    // A `revokeAll` that forgot its WHERE clause logs out the entire product, and the
    // response to the person who reset their password looks completely normal.
    expect(await stillWorks(theirs)).toBe(true);
  }, 120_000);

  it("zero sessions -> count is 0, and that is not an error", async () => {
    expect(await resetPassword(EMAIL, NEW_PASSWORD)).toBe(0);
  }, 60_000);

  it("already-revoked sessions are not counted a second time", async () => {
    await loginAs(EMAIL, OLD_PASSWORD);
    expect(await resetPassword(EMAIL, NEW_PASSWORD)).toBe(1);

    // ⚠ Asserted against the STORE, not by running a second reset over HTTP: the 60-second
    // resend cooldown (O-28 ④) means the second `requestPasswordReset` legitimately queues
    // no mail, so there would be no token to complete with. Driving the store directly is
    // what isolates the property under test from a different, correct rule.
    //
    // Counting already-revoked sessions again would make the number meaningless as
    // evidence -- and that number is the only evidence uc-1-1 R4 has.
    expect(await sessions.revokeAllForUser(USER, new Date())).toBe(0);
  }, 120_000);

  it("the resend cooldown is why: a second request inside 60s queues no new link (O-28 ④)", async () => {
    outbox.clear();
    await post("/auth/password-reset/request", { email: EMAIL });
    await post("/auth/password-reset/request", { email: EMAIL });
    expect(outbox.drain().filter((m) => m.kind === "password-reset-link")).toHaveLength(1);
    // ...and the CALLER still cannot tell: a distinguishable "too many requests" response
    // would be the enumeration channel wearing a different hat.
    const second = await post("/auth/password-reset/request", { email: EMAIL });
    expect(second.status).toBe(200);
    expect(await readJson(second)).toEqual({ sent: true });
  }, 60_000);
});

describe("I-7 -- revocation writes a MARK, it does not delete the record", () => {
  it("after revocation the session record still exists, with revokedAt set", async () => {
    await loginAs(EMAIL, OLD_PASSWORD);
    await loginAs(EMAIL, OLD_PASSWORD);

    const before = await sessions.listForUser(USER);
    expect(before).toHaveLength(2);
    expect(before.every((s) => s.revokedAt === null)).toBe(true);

    await resetPassword(EMAIL, NEW_PASSWORD);

    const after = await sessions.listForUser(USER);
    // Still two records. A `DEL` would be one line shorter and would make "who was kicked,
    // and when" unanswerable -- one of the four events uc-1-1 R6 requires to be auditable.
    expect(after, "the records were deleted rather than marked -- I-7").toHaveLength(2);
    expect(after.every((s) => s.revokedAt !== null)).toBe(true);
    // And the domain reports the right REASON: revoked, not expired. The user needs to tell
    // "this device was removed" from "you have been away too long".
    expect(after.map((s) => checkSession(s, Date.now()))).toEqual(["SESSION_REVOKED", "SESSION_REVOKED"]);
  }, 120_000);

  it("counter-proof: a live session reports null from the same function", async () => {
    // Otherwise `checkSession` returning SESSION_REVOKED above would be consistent with a
    // function that returns SESSION_REVOKED for everything.
    await loginAs(EMAIL, OLD_PASSWORD);
    const live = await sessions.listForUser(USER);
    expect(live.map((s) => checkSession(s, Date.now()))).toEqual([null]);
  }, 60_000);

  it("I-6: session ids are UUIDs, not a sequence", async () => {
    await loginAs(EMAIL, OLD_PASSWORD);
    await loginAs(EMAIL, OLD_PASSWORD);
    const ids = (await sessions.listForUser(USER)).map((s) => s.id);
    for (const id of ids) {
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    }
    expect(new Set(ids).size).toBe(ids.length);
  }, 60_000);

  it("the bearer token is NOT the session id -- holding one does not yield the other", async () => {
    const token = await loginAs(EMAIL, OLD_PASSWORD);
    const [session] = await sessions.listForUser(USER);
    // Session ids travel into logs and audit rows. If the token were derivable from the id,
    // every audit trail would be a list of live credentials.
    expect(token).not.toBe(session!.id);
    expect(token).not.toContain(session!.id);
  }, 60_000);
});
