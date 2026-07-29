/**
 * F21 -- the four-step "forgot password" flow, end to end over HTTP.
 * uc-1-1 R4 A2 / AC3 / R12 V3, V4, E4; coverage V10.
 *
 * The step this feature lives or dies on is step 2: the response is the same whether or not
 * the address is registered. An honest answer here turns an endpoint that needs NO
 * credentials into a customer list -- point a corporate address book at it and read off who
 * uses the product.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { auth as C } from "@repo/contracts";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { ensureRedis, resetCredentials, seedCredential, storedPasswordHash } from "../support/auth";
import { OutboxMailer } from "../../src/infrastructure/auth/outbox-mailer";
import { MAILER } from "../../src/application/auth/ports";

process.env.KERNEL_QUIET = "1";

const ORG = "org-f21-forgot";
const PROJECT = "proj-f21-forgot";
const USER = "u-f21-forgot";
const EMAIL = "resetme@f21-forgot.test";
const UNKNOWN = "no-such-person@f21-forgot.test";
const OLD_PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "a-brand-new-passphrase-here";

let BASE: string;
let app: NestExpressApplication;
let outbox: OutboxMailer;

beforeAll(async () => {
  ensureDatabase();
  ensureRedis();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  // The composition root provides `OutboxMailer`; reading it back out of the container is
  // what makes "a mail was queued" assertable. Nothing is substituted -- this is the same
  // instance the running app uses.
  outbox = app.get<OutboxMailer>(MAILER);
}, 120_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await resetCredentials([USER], [EMAIL, UNKNOWN]);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "consultant", fx.teams.energy!);
  await seedCredential({ userId: USER, email: EMAIL, password: OLD_PASSWORD });
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

/** Step 3: pull the one-time token out of the queued mail, the way a user pulls it out of a link. */
async function requestAndReadToken(email: string): Promise<string> {
  await post("/auth/password-reset/request", { email });
  const msg = outbox.drain().find((m) => m.kind === "password-reset-link" && m.to === email);
  if (!msg) throw new Error(`no reset mail queued for ${email}`);
  return msg.body.token!;
}

describe("F21 step 2 -- the same answer either way (I-1 on the reset path)", () => {
  it("a registered address returns { sent: true }", async () => {
    const res = await post("/auth/password-reset/request", { email: EMAIL });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body).toEqual({ sent: true });
    const parsed = C.operations.requestPasswordReset.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues).toBeNull();
  });

  it("an UNREGISTERED address returns exactly the same thing", async () => {
    const res = await post("/auth/password-reset/request", { email: UNKNOWN });
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ sent: true });
  });

  it("...and no mail is queued for the unregistered address (the answer is a lie only to the attacker)", async () => {
    outbox.clear();
    await post("/auth/password-reset/request", { email: UNKNOWN });
    // Both halves matter: the caller cannot tell, AND we did not actually send anything to
    // an address that never signed up.
    expect(outbox.drain().filter((m) => m.to === UNKNOWN)).toHaveLength(0);
  });

  it("counter-proof: the SAME assertion does see a mail for the registered address", async () => {
    // Without this, "no mail for the unknown address" would pass just as well if the mailer
    // were broken and queued nothing at all, ever.
    outbox.clear();
    await post("/auth/password-reset/request", { email: EMAIL });
    expect(outbox.drain().filter((m) => m.to === EMAIL)).toHaveLength(1);
  });
});

describe("F21 steps 3-5 -- consume the link, set a new password", () => {
  it("the happy path: new password works, old password does not", async () => {
    const token = await requestAndReadToken(EMAIL);

    const res = await post("/auth/password-reset/complete", { token, newPassword: NEW_PASSWORD });
    expect(res.status).toBe(200);
    const body = await readJson(res);
    const parsed = C.operations.completePasswordReset.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();

    // Both directions. "The old password stops working" alone is satisfied by breaking the
    // account outright.
    const withOld = await post("/auth/login", { email: EMAIL, password: OLD_PASSWORD });
    expect(withOld.status).toBe(401);
    const withNew = await post("/auth/login", { email: EMAIL, password: NEW_PASSWORD });
    expect(withNew.status).toBe(200);
  }, 60_000);

  it("the stored hash actually changed, and is still a slow hash", async () => {
    const before = await storedPasswordHash(USER);
    const token = await requestAndReadToken(EMAIL);
    await post("/auth/password-reset/complete", { token, newPassword: NEW_PASSWORD });
    const after = await storedPasswordHash(USER);
    expect(after).not.toBe(before);
    expect(after).toMatch(/^\$2[aby]\$\d{2}\$/);
    expect(Number(after!.slice(4, 6))).toBeGreaterThanOrEqual(12);
    expect(after).not.toContain(NEW_PASSWORD);
  }, 60_000);

  it("the link is SINGLE USE -- the second attempt is RESET_TOKEN_INVALID", async () => {
    const token = await requestAndReadToken(EMAIL);
    expect((await post("/auth/password-reset/complete", { token, newPassword: NEW_PASSWORD })).status).toBe(200);

    const second = await post("/auth/password-reset/complete", {
      token,
      newPassword: "yet-another-passphrase",
    });
    expect(second.status).toBe(401);
    expect((await readJson(second)).reasonCode).toBe("RESET_TOKEN_INVALID");
  }, 60_000);

  it("concurrent use of ONE token: exactly one succeeds (the read-then-write window)", async () => {
    const token = await requestAndReadToken(EMAIL);
    const results = await Promise.all([
      post("/auth/password-reset/complete", { token, newPassword: NEW_PASSWORD }),
      post("/auth/password-reset/complete", { token, newPassword: "a-different-passphrase" }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    // A SELECT-then-UPDATE implementation lets both through, and the account ends up with
    // whichever password lost the race -- silently, with two "success" responses. Same
    // failure shape as invite-code redemption (I-4).
    expect(statuses).toEqual([200, 401]);
  }, 60_000);

  it("a forged token is RESET_TOKEN_INVALID -- the same code as an expired one (E4)", async () => {
    const res = await post("/auth/password-reset/complete", {
      token: "f".repeat(64),
      newPassword: NEW_PASSWORD,
    });
    expect(res.status).toBe(401);
    // Expired and forged share one code on purpose: a distinct "this link expired" tells an
    // attacker holding a guessed token that the token was real.
    expect((await readJson(res)).reasonCode).toBe("RESET_TOKEN_INVALID");
  });

  it("a weak new password is rejected BEFORE the token is spent", async () => {
    const token = await requestAndReadToken(EMAIL);

    const tooShort = await post("/auth/password-reset/complete", { token, newPassword: "short" });
    expect(tooShort.status).toBe(400);
    expect((await readJson(tooShort)).fields?.[0]).toEqual({ path: "newPassword", code: "TOO_SHORT" });

    const weak = await post("/auth/password-reset/complete", { token, newPassword: "Password123456" });
    expect(weak.status).toBe(400);
    expect((await readJson(weak)).fields?.[0]).toEqual({ path: "newPassword", code: "WEAK_COMMON" });

    // The token survived both fumbles -- otherwise a mistyped password costs the user their
    // single-use link and they have to start the whole flow again.
    expect((await post("/auth/password-reset/complete", { token, newPassword: NEW_PASSWORD })).status).toBe(200);
  }, 60_000);
});

describe("F21 -- the mandatory change notification (O-28 ④)", () => {
  it("a `password-changed` message is queued, and it is not optional", async () => {
    outbox.clear();
    const token = await requestAndReadToken(EMAIL);
    await post("/auth/password-reset/complete", { token, newPassword: NEW_PASSWORD });
    const notice = outbox.drain().filter((m) => m.kind === "password-changed" && m.to === EMAIL);
    // It is the only alarm channel that exists once an account has already been taken over,
    // which is why the ruling says it cannot be switched off.
    expect(notice).toHaveLength(1);
  }, 60_000);

  it("no message body is ever logged -- a reset token in a log is a bearer credential in a log", async () => {
    const token = await requestAndReadToken(EMAIL);
    // Structural: the mailer must not have a logger at all, so there is no line to leak on.
    expect(Object.keys(new OutboxMailer() as unknown as Record<string, unknown>)).not.toContain("logger");
    expect(token.length).toBeGreaterThan(32);
  });
});

describe("F21 -- the response schema really does reject drift (non-vacuity)", () => {
  it("requestPasswordReset.out refuses `sent: false`", () => {
    // The literal type is the point: `z.boolean()` would invite someone to add a
    // `sent: false` branch, and that branch IS the enumeration oracle.
    expect(C.operations.requestPasswordReset.out.safeParse({ sent: false }).success).toBe(false);
  });

  it("completePasswordReset.out refuses a missing or negative revokedSessionCount", () => {
    expect(C.operations.completePasswordReset.out.safeParse({}).success).toBe(false);
    expect(C.operations.completePasswordReset.out.safeParse({ revokedSessionCount: -1 }).success).toBe(false);
    expect(C.operations.completePasswordReset.out.safeParse({ revokedSessionCount: 0 }).success).toBe(true);
  });
});
