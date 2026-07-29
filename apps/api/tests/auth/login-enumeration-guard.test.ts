/**
 * F20 -- anti-enumeration, INCLUDING TIMING. Invariant I-1, uc-1-1 R7 / R12 V4,
 * coverage V8.
 *
 * ## Why the timing half exists
 *
 * "Email not found" and "wrong password" must be indistinguishable. Making the response
 * bodies identical is the obvious half and it is NOT SUFFICIENT: the not-found path returns
 * without hashing anything (~0.1ms) while the wrong-password path runs bcrypt at cost 12
 * (~100ms). That is three orders of magnitude. An attacker with a stopwatch and a list of
 * corporate addresses enumerates the entire user table through an endpoint that requires no
 * credentials at all, and every byte of every response is identical while they do it.
 *
 * The fix is the one line coverage.md §5 item 4 predicts will be deleted in code review as
 * pointless waste: when there is no account, run an EQUIVALENT-COST dummy hash anyway
 * (`PasswordHasher.verifyDummy`).
 *
 * ## Why this file also contains a counter-proof
 *
 * A timing assertion is the easiest kind to write vacuously -- a generous threshold passes
 * whether or not the dummy hash exists. So the file measures the UNPROTECTED difference
 * directly (`bcrypt.compare` vs. an immediate return) and asserts it is large. If that
 * measurement ever comes back small, the threshold below proves nothing and this test says
 * so instead of quietly passing.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import bcrypt from "bcryptjs";
import { addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { ensureRedis, resetCredentials, seedCredential } from "../support/auth";
import { BcryptPasswordHasher, BCRYPT_COST } from "../../src/infrastructure/auth/bcrypt-password-hasher";

process.env.KERNEL_QUIET = "1";

const ORG = "org-f20-enum";
const PROJECT = "proj-f20-enum";
const USER = "u-f20-enum";
const KNOWN_EMAIL = "known@f20-enum.test";
const UNKNOWN_EMAIL = "nobody-at-all@f20-enum.test";
const PASSWORD = "correct-horse-battery-staple";
const WRONG_PASSWORD = "wrong-horse-battery-staple";

let BASE: string;
let app: NestExpressApplication;

beforeAll(async () => {
  ensureDatabase();
  ensureRedis();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 120_000);

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await resetCredentials([USER], [KNOWN_EMAIL, UNKNOWN_EMAIL]);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "consultant", fx.teams.energy!);
  await seedCredential({ userId: USER, email: KNOWN_EMAIL, password: PASSWORD });
});

async function attempt(email: string, password: string) {
  const started = performance.now();
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  return { elapsed: performance.now() - started, status: res.status, text, headers: res.headers };
}

/** Median rather than mean: one GC pause or one cold connection should not decide the verdict. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

describe("I-1 -- the two failures are indistinguishable in the RESPONSE", () => {
  it("identical status code", async () => {
    const missing = await attempt(UNKNOWN_EMAIL, WRONG_PASSWORD);
    const wrong = await attempt(KNOWN_EMAIL, WRONG_PASSWORD);
    expect(missing.status).toBe(wrong.status);
    expect(missing.status).toBe(401);
  });

  /**
   * The traceId is masked in both comparisons below.
   *
   * It is a fresh UUID on EVERY response including two consecutive identical requests, so it
   * cannot carry a bit about whether the account exists -- and it is mandatory (the error
   * boundary requires it, or production issues become undiagnosable). Masking exactly one
   * named field, rather than comparing field by field, keeps the property being asserted
   * strong: any OTHER difference, including a field nobody thought to check, still fails.
   */
  const TRACE_UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  const maskTrace = (s: string) => s.replace(TRACE_UUID, "<traceId>");

  it("byte-identical body once the per-request traceId is masked", async () => {
    const missing = await attempt(UNKNOWN_EMAIL, WRONG_PASSWORD);
    const wrong = await attempt(KNOWN_EMAIL, WRONG_PASSWORD);
    expect(maskTrace(missing.text)).toBe(maskTrace(wrong.text));
    // Non-vacuity: the masking must not have erased the whole body.
    expect(maskTrace(missing.text)).toContain("unauthenticated");
  });

  it("the traceId really does differ between two IDENTICAL requests (so masking it is honest)", async () => {
    // Counter-proof for the masking above. If traceIds happened to be stable per input, the
    // mask would be hiding a genuine channel rather than per-request noise.
    const a = await attempt(UNKNOWN_EMAIL, WRONG_PASSWORD);
    const b = await attempt(UNKNOWN_EMAIL, WRONG_PASSWORD);
    expect(a.text).not.toBe(b.text);
    expect(maskTrace(a.text)).toBe(maskTrace(b.text));
  });

  it("no header distinguishes them either", async () => {
    const missing = await attempt(UNKNOWN_EMAIL, WRONG_PASSWORD);
    const wrong = await attempt(KNOWN_EMAIL, WRONG_PASSWORD);
    // `date` varies with the wall clock and `x-trace-id` is per-request; everything else --
    // including content-length, which would leak a body-length difference -- must match.
    const strip = (h: Headers) => {
      const o: Record<string, string> = {};
      h.forEach((v, k) => {
        if (k !== "date" && k !== "etag" && k !== "x-trace-id") o[k] = v;
      });
      return o;
    };
    const a = strip(missing.headers);
    expect(a).toEqual(strip(wrong.headers));
    // Non-vacuity: `strip` must not have removed everything.
    expect(Object.keys(a).length).toBeGreaterThan(2);
    expect(a["content-length"]).toBeDefined();
  });

  it("the body never names the email, so it cannot leak by echo", async () => {
    const missing = await attempt(UNKNOWN_EMAIL, WRONG_PASSWORD);
    expect(missing.text).not.toContain(UNKNOWN_EMAIL);
  });
});

describe("I-1 -- and indistinguishable in ELAPSED TIME (the half that gets deleted)", () => {
  /**
   * COUNTER-PROOF, run first.
   *
   * Establishes that the signal this test is about is real ON THIS MACHINE. Without it, a
   * fast enough machine or a mis-set cost factor would make the threshold assertion below
   * pass trivially -- the classic "green because idle" gate.
   */
  it("counter-proof: WITHOUT the dummy hash the two paths differ by an order of magnitude", async () => {
    const hash = await bcrypt.hash(PASSWORD, BCRYPT_COST);

    const slow: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      await bcrypt.compare(WRONG_PASSWORD, hash); // what "wrong password" costs
      slow.push(performance.now() - t);
    }

    const fast: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = performance.now();
      await Promise.resolve(false); // what "no such account" costs with an early return
      fast.push(performance.now() - t);
    }

    const ratio = median(slow) / Math.max(median(fast), 0.001);
    // If this ever fails, the assertion further down is measuring nothing and must not be
    // trusted -- report it rather than relaxing the threshold.
    expect(
      ratio,
      `bcrypt cost ${BCRYPT_COST} is not producing a measurable signal here (slow=${median(slow).toFixed(2)}ms fast=${median(fast).toFixed(4)}ms) -- the timing assertion below would be vacuous`,
    ).toBeGreaterThan(10);
  }, 60_000);

  it("counter-proof: the production hasher's verifyDummy really burns the cost", async () => {
    // If someone "simplifies" verifyDummy to `return false`, this fails -- which is the
    // point. The invariant lives on the hasher, so it is asserted on the hasher.
    const hasher = new BcryptPasswordHasher();
    const t = performance.now();
    const result = await hasher.verifyDummy(PASSWORD);
    const elapsed = performance.now() - t;
    expect(result).toBe(false);
    expect(
      elapsed,
      "verifyDummy returned too fast -- it is no longer running an equivalent-cost hash, and I-1's timing half is gone",
    ).toBeGreaterThan(5);
  }, 60_000);

  it("the real endpoint: unknown-email and wrong-password take comparable time", async () => {
    // Warm up: first request pays for pool connections and JIT, and that cost lands on
    // whichever case runs first -- which would decide the result.
    await attempt(KNOWN_EMAIL, WRONG_PASSWORD);
    await attempt(UNKNOWN_EMAIL, WRONG_PASSWORD);

    const missing: number[] = [];
    const wrong: number[] = [];
    // Interleaved, so a machine that gets busier partway through affects both equally.
    for (let i = 0; i < 5; i++) {
      missing.push((await attempt(UNKNOWN_EMAIL, WRONG_PASSWORD)).elapsed);
      wrong.push((await attempt(KNOWN_EMAIL, WRONG_PASSWORD)).elapsed);
    }

    const a = median(missing);
    const b = median(wrong);
    const ratio = Math.max(a, b) / Math.max(Math.min(a, b), 0.001);

    // 2x, not 1.05x. The threshold has to absorb real scheduling noise on a shared CI box
    // while still catching the failure mode, which is a ~1000x gap. A tight threshold here
    // would produce a flaky gate, and a flaky gate gets muted -- at which point the
    // invariant is unprotected for a reason that has nothing to do with the invariant.
    expect(
      ratio,
      `unknown-email ${a.toFixed(1)}ms vs wrong-password ${b.toFixed(1)}ms -- the login path is a timing oracle for account existence. Check that PasswordHasher.verifyDummy is still called when no credential is found (login.ts).`,
    ).toBeLessThan(2);
  }, 120_000);
});

describe("I-1 -- the same rule on the password-reset request endpoint", () => {
  it("registered and unregistered addresses get the same status and the same body", async () => {
    const post = (email: string) =>
      fetch(`${BASE}/auth/password-reset/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      }).then(async (r) => ({ status: r.status, text: await r.text() }));

    const known = await post(KNOWN_EMAIL);
    const unknown = await post(UNKNOWN_EMAIL);
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.text).toBe(unknown.text);
    expect(JSON.parse(known.text)).toEqual({ sent: true });
  });
});
