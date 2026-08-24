/**
 * `POST /auth/register-open` end to end, with **every response validated against the
 * contract** (contract-design.md hard rule 6).
 *
 * ⚠ open-self-serve-registration delta (issue #1929): this file REPLACES the version that
 * exercised `POST /auth/register` (`redeemInviteAndCreateOrg`, now removed). The invite-code
 * failure-mode block ("four causes, one indistinguishable response") is gone because there
 * is no code; in its place is a symmetric block for `registerNewAccount`'s own rejection
 * paths (malformed email / weak password / empty org name / email already taken), each
 * asserted to leave no row behind.
 *
 * The global pipe validates what comes IN. Nothing validates what goes OUT, so without this
 * file the return direction of ADR-020's single-source chain is broken: the server can emit
 * a body the contract does not describe and every gate stays green, because the frontend's
 * types come from the same contract and are simply wrong about reality. That is not
 * hypothetical -- `contract-response.test.ts` exists because it happened in F01.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { auth as C } from "@repo/contracts";
import { ensureDatabase, migrateOnce } from "../support/db";
import {
  readCredentialByEmail,
  resetAuthFixtures,
  resetOrgsOwnedBy,
} from "../support/auth-db";

process.env.KERNEL_QUIET = "1";

const EMAIL_DOMAIN = "openregopen.test";
const PASSWORD = "correct-horse-battery-staple";

let BASE: string;
let app: NestExpressApplication;
const created: string[] = [];

async function post(body: unknown) {
  const res = await fetch(`${BASE}/auth/register-open`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function registration(local: string, orgName = "Open Co") {
  return {
    email: `${local}@${EMAIL_DOMAIN}`,
    password: PASSWORD,
    displayName: `${local} person`,
    orgName,
  };
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  // Port 0 -- the OS picks a free one. Same reasoning as contract-response.test.ts: a
  // derived port number collides, and a run that died holding one wedges the next.
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgsOwnedBy(created);
  await resetAuthFixtures({ emailLike: `%@${EMAIL_DOMAIN}` });
});

afterEach(async () => {
  await resetOrgsOwnedBy(created);
  created.length = 0;
  await resetAuthFixtures({ emailLike: `%@${EMAIL_DOMAIN}` });
});

describe("the route is reachable WITHOUT authentication, and only this route is", () => {
  it("registration does not require a principal (@Public), but a protected route still does", async () => {
    const r = await post(registration("public"));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    created.push(r.body.userId as string);

    // Two-way. If `@Public()` had leaked onto the controller class or the guard had been
    // disabled, this would be a 200 and the "only this route" half would be false.
    const guarded = await fetch(`${BASE}/identity/me?orgId=whatever`);
    expect(guarded.status, "an authenticated route became public").toBe(401);
  });
});

describe("no invite code is required or accepted -- decision ④, issue #1929", () => {
  it("a body with NO code field at all succeeds", async () => {
    const body = registration("nocode");
    expect("code" in body).toBe(false);
    const r = await post(body);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    created.push(r.body.userId as string);
  });

  it("a body that STILL carries a `code` field is REJECTED -- `.strict()` means no ghost field", async () => {
    // The old `redeemInviteAndCreateOrg` shape is gone; the schema is `.strict()`, so a
    // stray `code` (e.g. a client that has not been updated) must 400, not be silently
    // ignored -- silently ignoring it would let a caller believe a code was checked.
    const r = await post({ ...registration("ghostcode"), code: "12345678901234" });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
  });
});

describe("success: the response conforms to the contract", () => {
  it("201 with a durable queued delivery status", async () => {
    const r = await post(registration("conform", "Ocean Consulting"));
    expect(r.status).toBe(201);
    created.push(r.body.userId as string);

    const parsed = C.operations.registerNewAccount.out.safeParse(r.body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(r.body)).toBeNull();
    expect(r.body.verificationDelivery).toBe("queued");
  });

  it("the response carries NO organization content and no credential material", async () => {
    const r = await post(registration("nocontent", "Ocean Consulting"));
    created.push(r.body.userId as string);

    // The org's NAME is tenant content. The caller supplied it, so echoing it is harmless
    // today -- and that is exactly how a response grows a field the contract does not
    // describe. `out` has three keys; the body must have three keys.
    expect(Object.keys(r.body).sort()).toEqual(["orgId", "userId", "verificationDelivery"]);
    const asText = JSON.stringify(r.body);
    expect(asText).not.toContain("Ocean Consulting");
    expect(asText).not.toContain(PASSWORD);
    expect(asText).not.toContain("$2b$");
    // ...and no verification token, which would let anyone who saw the response verify the
    // address without access to the mailbox.
    expect(asText).not.toMatch(/token/i);
  });
});

/**
 * The denial paths. Symmetric to the old file's invite-code block, but for the failure modes
 * `registerNewAccount` actually has: field-level validation, plus `EMAIL_TAKEN`.
 */
describe("failure: field-level validation, each rejection leaves nothing behind", () => {
  it("a malformed email is rejected and creates nothing", async () => {
    const r = await post({ ...registration("bademail"), email: "not-an-email" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_failed");
    expect((r.body.fields as { path: string }[]).map((f) => f.path)).toContain("email");
    expect(await readCredentialByEmail("not-an-email")).toBeNull();
  });

  it("an 11-character password is rejected (O-28: >= 12) and creates nothing", async () => {
    const r = await post({ ...registration("weakpw"), password: "12345678901" });
    expect(r.status).toBe(400);
    expect(r.body.fields).toContainEqual({ path: "password", code: "too_small" });
    expect(await readCredentialByEmail(`weakpw@${EMAIL_DOMAIN}`)).toBeNull();
  });

  it("an empty org name is rejected and creates nothing", async () => {
    const r = await post({ ...registration("noorg"), orgName: "" });
    expect(r.status).toBe(400);
    expect(r.body.fields).toContainEqual({ path: "orgName", code: "too_small" });
    expect(await readCredentialByEmail(`noorg@${EMAIL_DOMAIN}`)).toBeNull();
  });

  it("an empty display name is rejected and creates nothing", async () => {
    const r = await post({ ...registration("nodisplay"), displayName: "" });
    expect(r.status).toBe(400);
    expect(r.body.fields).toContainEqual({ path: "displayName", code: "too_small" });
    expect(await readCredentialByEmail(`nodisplay@${EMAIL_DOMAIN}`)).toBeNull();
  });
});

describe("failure: email already registered", () => {
  it("409 + EMAIL_TAKEN, and no second account or organization is created", async () => {
    const first = await post(registration("twice"));
    created.push(first.body.userId as string);

    const second = await post(registration("twice", "A Different Org"));
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("conflict");
    expect(second.body.reasonCode).toBe("EMAIL_TAKEN");
  });

  it("the reasonCode really is the closed enum's member, not a free string", () => {
    // `all-exceptions.filter.ts` re-parses reasonCode against the contract's enums before
    // emitting it, so a typo in the controller becomes a MISSING field rather than a wrong
    // one.
    expect(C.AuthReason.options).toContain("EMAIL_TAKEN");
    // ⚠ And `INVITE_CODE_INVALID` must NOT be reachable through this route any more -- it
    // stays in the enum (still used by `joinOrgWithInvite`, a different operation), but this
    // operation's `err` list no longer names it.
    expect(C.operations.registerNewAccount.err as readonly string[]).not.toContain("INVITE_CODE_INVALID");
  });
});

/**
 * Without this block every `safeParse(...).success` assertion above could be passing
 * because the schema accepts anything. This project has nine-plus recorded instances of a
 * green gate testing nothing; two features found that one of their OWN counter-proofs was
 * vacuous.
 */
describe("the assertions above are not vacuous", () => {
  it("the out schema REJECTS bodies that drift from the contract", () => {
    const out = C.operations.registerNewAccount.out;
    // missing a field
    expect(out.safeParse({ userId: "u", orgId: "o" }).success).toBe(false);
    // the literal really is a literal -- `false` must not pass, or "silently not sent"
    // becomes expressible again
    expect(
      out.safeParse({ userId: "u", orgId: "o", verificationDelivery: "sent" }).success,
    ).toBe(false);
    // wrong types
    expect(
      out.safeParse({ userId: 1, orgId: "o", verificationDelivery: "queued" }).success,
    ).toBe(false);
    /**
     * ⚠ An EXTRA field must fail too, and it only does because this `out` is `.strict()`.
     * See the contract's long note on why plain zod objects strip unknown keys, and why
     * that makes hard rule 6 blind to the most common direction of response drift.
     */
    expect(
      out.safeParse({ userId: "u", orgId: "o", verificationDelivery: "queued", orgName: "leak" })
        .success,
      "the out schema accepts undeclared fields -- hard rule 6 is blind to response drift here",
    ).toBe(false);
    // ...and the shape that DOES conform, so the schema is not simply rejecting everything
    expect(
      out.safeParse({ userId: "u", orgId: "o", verificationDelivery: "queued" }).success,
    ).toBe(true);
  });

  it("the in schema REJECTS what the tests above rely on it rejecting, including a stray code", () => {
    const inSchema = C.operations.registerNewAccount.in;
    const good = {
      email: "a@b.test",
      password: PASSWORD,
      displayName: "d",
      orgName: "o",
    };
    expect(inSchema.safeParse(good).success).toBe(true);
    expect(inSchema.safeParse({ ...good, password: "12345678901" }).success).toBe(false);
    expect(inSchema.safeParse({ ...good, orgName: "" }).success).toBe(false);
    expect(inSchema.safeParse({ ...good, displayName: "" }).success).toBe(false);
    expect(inSchema.safeParse({ ...good, email: "not-an-email" }).success).toBe(false);
    // `.strict()` -- a leftover `code` field from the old contract shape must be rejected,
    // not silently stripped.
    expect(inSchema.safeParse({ ...good, code: "12345678901234" }).success).toBe(false);
  });

  it("the pipe uses the contract's schema BY REFERENCE, not a look-alike", async () => {
    // Structural equality would be satisfied by a hand-copied schema that matches today.
    const { REGISTER_SCHEMA } = await import(
      "../../src/interface/controllers/auth-registration.controller"
    );
    expect(REGISTER_SCHEMA).toBe(C.operations.registerNewAccount.in);
  });
});
