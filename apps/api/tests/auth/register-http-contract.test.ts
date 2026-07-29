/**
 * `POST /auth/register` end to end, with **every response validated against the contract**
 * (contract-design.md hard rule 6).
 *
 * The global pipe validates what comes IN. Nothing validates what goes OUT, so without this
 * file the return direction of ADR-020's single-source chain is broken: the server can emit
 * a body the contract does not describe and every gate stays green, because the frontend's
 * types come from the same contract and are simply wrong about reality. That is not
 * hypothetical -- `contract-response.test.ts` exists because it happened in F01.
 *
 * ⚠ Rule 6 also says to "特别覆盖拒绝路径" and to add reverse assertions proving the
 * schemas really reject drift. Both are below; the reverse assertions are what stop this
 * whole file from being a no-op.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { auth as C } from "@repo/contracts";
import { ensureDatabase, migrateOnce } from "../support/db";
import {
  issueInviteCode,
  makeCode,
  readCredentialByEmail,
  readInviteCode,
  resetAuthFixtures,
  resetOrgsOwnedBy,
} from "../support/auth-db";

process.env.KERNEL_QUIET = "1";

const EMAIL_DOMAIN = "f19http.test";
const PASSWORD = "correct-horse-battery-staple";
const codes = {
  ok: makeCode("HTTPOKCODE1"),
  dup: makeCode("HTTPDUPCODE"),
  spent: makeCode("HTTPSPENTCD"),
  expired: makeCode("HTTPEXPIRED"),
  revoked: makeCode("HTTPREVOKED"),
  absent: makeCode("HTTPABSENT1"),
};

let BASE: string;
let app: NestExpressApplication;
const created: string[] = [];

async function post(body: unknown) {
  const res = await fetch(`${BASE}/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

function registration(code: string, local: string, orgName = "HTTP Co") {
  return {
    code,
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
  await resetAuthFixtures({ codes: Object.values(codes), emailLike: `%@${EMAIL_DOMAIN}` });
});

afterEach(async () => {
  await resetOrgsOwnedBy(created);
  created.length = 0;
  await resetAuthFixtures({ codes: Object.values(codes), emailLike: `%@${EMAIL_DOMAIN}` });
});

describe("the route is reachable WITHOUT authentication, and only this route is", () => {
  it("registration does not require a principal (@Public), but a protected route still does", async () => {
    await issueInviteCode(codes.ok);
    const r = await post(registration(codes.ok, "public"));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    created.push(r.body.userId as string);

    // Two-way. If `@Public()` had leaked onto the controller class or the guard had been
    // disabled, this would be a 200 and the "only this route" half would be false.
    const guarded = await fetch(`${BASE}/identity/me?orgId=whatever`);
    expect(guarded.status, "an authenticated route became public").toBe(401);
  });
});

describe("success: the response conforms to the contract", () => {
  it("201 with { userId, orgId, emailVerificationSent: true }", async () => {
    await issueInviteCode(codes.ok);
    const r = await post(registration(codes.ok, "conform", "Ocean Consulting"));
    expect(r.status).toBe(201);
    created.push(r.body.userId as string);

    const parsed = C.operations.redeemInviteAndCreateOrg.out.safeParse(r.body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(r.body)).toBeNull();
    expect(r.body.emailVerificationSent).toBe(true);
  });

  it("the response carries NO organization content and no credential material", async () => {
    await issueInviteCode(codes.ok);
    const r = await post(registration(codes.ok, "nocontent", "Ocean Consulting"));
    created.push(r.body.userId as string);

    // The org's NAME is tenant content. The caller supplied it, so echoing it is harmless
    // today -- and that is exactly how a response grows a field the contract does not
    // describe. `out` has three keys; the body must have three keys.
    expect(Object.keys(r.body).sort()).toEqual(["emailVerificationSent", "orgId", "userId"]);
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
 * The denial paths. Rule 6 singles these out because they are where the contract turns out
 * to be wrong about reality -- the success body gets looked at during development, the
 * failure bodies do not.
 */
describe("failure: invite code -- four causes, ONE indistinguishable response", () => {
  it("absent / spent / expired / revoked produce byte-identical bodies apart from traceId", async () => {
    // Set up each cause for real, rather than trusting that they route to the same branch.
    await issueInviteCode(codes.spent);
    const winner = await post(registration(codes.spent, "winner"));
    created.push(winner.body.userId as string);
    await issueInviteCode(codes.expired, { expiresAt: new Date(Date.now() - 60_000) });
    await issueInviteCode(codes.revoked, { revokedAt: new Date() });

    const responses = [];
    for (const [code, local] of [
      [codes.absent, "x1"],
      [codes.spent, "x2"],
      [codes.expired, "x3"],
      [codes.revoked, "x4"],
    ] as const) {
      responses.push(await post(registration(code, local)));
    }

    for (const r of responses) {
      expect(r.status).toBe(400);
      expect(r.body.error).toBe("bad_request");
      expect(r.body.reasonCode).toBe("INVITE_CODE_INVALID");
    }

    // Compared as normalized objects, not field by field: an extra key on ONE of them --
    // a `hint`, a `retryAfter`, a `fields` array -- is the shape the leak comes back in,
    // and checking three known fields would not notice it.
    const shapes = responses.map((r) => {
      const { traceId: _t, ...rest } = r.body;
      return JSON.stringify(Object.fromEntries(Object.entries(rest).sort()));
    });
    expect(new Set(shapes).size, `responses differ:\n${shapes.join("\n")}`).toBe(1);

    // ⚠ And the traceIds are all DIFFERENT -- which proves the normalization above removed
    // a field that genuinely varies, rather than a field that happened to be identical.
    const traces = new Set(responses.map((r) => r.body.traceId));
    expect(traces.size).toBe(responses.length);
  });

  it("...and a failed attempt leaves nothing behind", async () => {
    const r = await post(registration(codes.absent, "leftover"));
    expect(r.status).toBe(400);
    expect(await readCredentialByEmail(`leftover@${EMAIL_DOMAIN}`)).toBeNull();
  });
});

describe("failure: email already registered", () => {
  it("409 + EMAIL_TAKEN, and the second code is NOT spent", async () => {
    await issueInviteCode(codes.ok);
    await issueInviteCode(codes.dup);
    const first = await post(registration(codes.ok, "twice"));
    created.push(first.body.userId as string);

    const second = await post(registration(codes.dup, "twice"));
    expect(second.status).toBe(409);
    expect(second.body.error).toBe("conflict");
    expect(second.body.reasonCode).toBe("EMAIL_TAKEN");

    // UC-1.5 A2 tells this user to sign in and use the code from there -- impossible if the
    // failed attempt burned it.
    expect((await readInviteCode(codes.dup))!.redeemed_by_user_id).toBeNull();
  });

  it("the reasonCode really is the closed enum's member, not a free string", () => {
    // `all-exceptions.filter.ts` re-parses reasonCode against the contract's enums before
    // emitting it, so a typo in the controller becomes a MISSING field rather than a wrong
    // one. Both codes this route can emit must be in the enum, or the field silently
    // disappears in production and only the wizard's error screen notices.
    expect(C.AuthReason.options).toContain("INVITE_CODE_INVALID");
    expect(C.AuthReason.options).toContain("EMAIL_TAKEN");
  });
});

describe("request validation is field-level and comes from the contract", () => {
  it("a 13-character code is rejected with the failing field named", async () => {
    const r = await post({ ...registration(codes.ok, "short"), code: "0123456789012" });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe("validation_failed");
    expect(r.body.fields).toContainEqual({ path: "code", code: "too_small" });
  });

  it("an 11-character password is rejected (O-28: >= 12)", async () => {
    const r = await post({ ...registration(codes.ok, "weak"), password: "12345678901" });
    expect(r.status).toBe(400);
    expect(r.body.fields).toContainEqual({ path: "password", code: "too_small" });
  });

  it("a malformed email is rejected", async () => {
    const r = await post({ ...registration(codes.ok, "bad"), email: "not-an-email" });
    expect(r.status).toBe(400);
    expect((r.body.fields as { path: string }[]).map((f) => f.path)).toContain("email");
  });

  it("a rejected body creates nothing -- validation happens before the transaction", async () => {
    await issueInviteCode(codes.ok);
    await post({ ...registration(codes.ok, "notx"), password: "short" });
    expect((await readInviteCode(codes.ok))!.redeemed_by_user_id).toBeNull();
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
    const out = C.operations.redeemInviteAndCreateOrg.out;
    // missing a field
    expect(out.safeParse({ userId: "u", orgId: "o" }).success).toBe(false);
    // the literal really is a literal -- `false` must not pass, or "silently not sent"
    // becomes expressible again
    expect(
      out.safeParse({ userId: "u", orgId: "o", emailVerificationSent: false }).success,
    ).toBe(false);
    // wrong types
    expect(
      out.safeParse({ userId: 1, orgId: "o", emailVerificationSent: true }).success,
    ).toBe(false);
    /**
     * ⚠ An EXTRA field must fail too, and it only does because this `out` is `.strict()`.
     *
     * Found by counter-proof: adding `orgName` to the response left `safeParse` green,
     * because a plain zod object strips unknown keys. Hard rule 6's whole mechanism --
     * "assert the response against the contract" -- is blind to the most common direction
     * of response drift, which is a field being ADDED. Nothing crashes when a response
     * grows a field, so it stays, and one day it is tenant content.
     *
     * Every other bundle's `out` in this repo is still non-strict. Logged as
     * `KNOWN_CONTRACT_GAPS.C7`.
     */
    expect(
      out.safeParse({ userId: "u", orgId: "o", emailVerificationSent: true, orgName: "leak" })
        .success,
      "the out schema accepts undeclared fields -- hard rule 6 is blind to response drift here",
    ).toBe(false);
    // ...and the shape that DOES conform, so the schema is not simply rejecting everything
    expect(
      out.safeParse({ userId: "u", orgId: "o", emailVerificationSent: true }).success,
    ).toBe(true);
  });

  it("the in schema REJECTS what the tests above rely on it rejecting", () => {
    const inSchema = C.operations.redeemInviteAndCreateOrg.in;
    const good = {
      code: "12345678901234",
      email: "a@b.test",
      password: PASSWORD,
      displayName: "d",
      orgName: "o",
    };
    expect(inSchema.safeParse(good).success).toBe(true);
    expect(inSchema.safeParse({ ...good, code: "1234567890123" }).success).toBe(false);
    expect(inSchema.safeParse({ ...good, code: "123456789012345" }).success).toBe(false);
    expect(inSchema.safeParse({ ...good, password: "12345678901" }).success).toBe(false);
    expect(inSchema.safeParse({ ...good, orgName: "" }).success).toBe(false);
  });

  it("the pipe uses the contract's schema BY REFERENCE, not a look-alike", async () => {
    // Structural equality would be satisfied by a hand-copied schema that matches today.
    const { REGISTER_SCHEMA } = await import(
      "../../src/interface/controllers/auth-registration.controller"
    );
    expect(REGISTER_SCHEMA).toBe(C.operations.redeemInviteAndCreateOrg.in);
  });
});
