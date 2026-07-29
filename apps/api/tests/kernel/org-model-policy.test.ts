/**
 * F15 acceptance V12 -- a real organization's `modelPolicy` is an ADMIN-CHANGEABLE POLICY;
 * a personal-local organization's local-only guarantee is an UNCLOSABLE PROMISE; and the two
 * must never be the same switch (uc-0-5 R7 / R10 rulings of 2026-07-28 / R12 V12;
 * identity domain.md I-10).
 *
 * ## The assertion that actually carries the weight
 *
 * Not "a local organization answers local-only" -- an implementation that read
 * `model_policy` and happened to find `self-hosted-only` there would pass that. The decisive
 * pair is: a real organization and a personal-local organization holding the SAME value in
 * `model_policy` ('any', the default) and giving DIFFERENT answers. Same field, different
 * result, therefore the result does not come from the field.
 *
 * ⚠ What this file does NOT cover, stated rather than left to be discovered:
 *   · V3/V11's "zero egress" -- that has to be asserted at the NETWORK layer, and this is an
 *     application-layer test. It belongs to F16.
 *   · Disabling individual cloud models under `self-hosted-only`. `CapabilityListing` has no
 *     field distinguishing a cloud model row from a self-hosted one, so the server cannot
 *     tell which rows to grey out. Reported as a contract gap; no field was invented.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { z } from "zod";
import { identity as C } from "@repo/contracts";
import { addOrgMember, asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const FORMAL = "org-policy-formal";
const STRICT = "org-policy-strict";
const LOCAL = "org-policy-local";
const USER = "u-policy";

let BASE: string;
let app: NestExpressApplication;

const auth = (org: string) => ({
  "x-kernel-test-principal": `${USER}:${org}`,
  "content-type": "application/json",
});

interface Constraint {
  localOnly: boolean;
  source: "promise" | "policy" | "none";
  reason: string;
}

async function constraintFor(
  org: string,
  dataScope: { itemId: string; confidential: boolean }[] = [],
): Promise<Constraint> {
  const r = await fetch(`${BASE}/identity/model-constraint`, {
    method: "POST",
    headers: auth(org),
    body: JSON.stringify({ orgId: org, dataScope }),
  });
  expect(r.status, await r.clone().text()).toBe(200);
  const body = (await r.json()) as Constraint;
  // Hard rule 6, on every call rather than in one token test: the response half of the
  // single-source chain is only enforced where it is asserted.
  const parsed = C.operations.resolveModelConstraint.out.safeParse(body);
  expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
  return body;
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(FORMAL, STRICT, LOCAL);
});

beforeEach(async () => {
  await resetOrgs(FORMAL, STRICT, LOCAL);
  await seedOrg({ orgId: FORMAL, projectId: `${FORMAL}-p` });
  await seedOrg({ orgId: STRICT, projectId: `${STRICT}-p` });
  // The owner is USER: F16's single-member trigger admits only the organization's owner, so
  // a fixture that adds any other member is a fixture describing a state that cannot exist.
  await seedOrg({ orgId: LOCAL, kind: "personal-local", ownerUserId: USER, projectId: `${LOCAL}-p` });
  for (const o of [FORMAL, STRICT, LOCAL]) await addOrgMember(o, USER, "admin", null);
  // An administrator configures it. That is the whole point of a policy.
  await asApp(STRICT, (c) =>
    c.query("UPDATE organizations SET model_policy = 'self-hosted-only' WHERE id = $1", [STRICT]),
  );
});

describe("V12: policy and promise produce the same boolean and are NOT the same thing", () => {
  it("a real organization with no policy is unrestricted", async () => {
    const r = await constraintFor(FORMAL);
    expect(r).toMatchObject({ localOnly: false, source: "none" });
  });

  it("a real organization configured self-hosted-only reports source POLICY", async () => {
    const r = await constraintFor(STRICT);
    expect(r).toMatchObject({ localOnly: true, source: "policy" });
    // The word an admin needs to see: this one is theirs to change.
    expect(r.reason).toContain("administrator");
  });

  it("a personal-local organization reports source PROMISE", async () => {
    const r = await constraintFor(LOCAL);
    expect(r).toMatchObject({ localOnly: true, source: "promise" });
    expect(r.reason).toContain("cannot be turned off");
  });

  it("THE decisive pair: identical model_policy, different answers", async () => {
    // Both organizations hold model_policy = 'any' at this point. If the promise were read
    // from that column, they would answer identically -- and the promise would have become a
    // default that happens to be set.
    const policies = await asOwner((c) =>
      c.query<{ id: string; model_policy: string }>(
        "SELECT id, model_policy FROM organizations WHERE id = ANY($1::text[])",
        [[FORMAL, LOCAL]],
      ),
    );
    expect(new Set(policies.rows.map((r) => r.model_policy))).toEqual(new Set(["any"]));

    expect((await constraintFor(FORMAL)).source).toBe("none");
    expect((await constraintFor(LOCAL)).source).toBe("promise");
  });

  it("the three sources are the contract's closed set, and a fourth value is refused", () => {
    // Closedness, not a count (E-4). If a `confidential-data` value is ever added -- and the
    // notes for this feature argue it should be -- this assertion should be updated by that
    // ADR, not tripped by it.
    expect(new Set(C.ConstraintSource.options)).toEqual(new Set(["promise", "policy", "none"]));
    expect(C.ConstraintSource.safeParse("configurable").success).toBe(false);
  });
});

describe("I-10: the promise cannot be switched off through ANY interface", () => {
  it("no contract operation accepts modelPolicy as an input field", () => {
    // Mechanical, not a review: I-10 says "through any interface", and the set of interfaces
    // is the contract's operations. A future operation that took it would fail here.
    const offenders: string[] = [];
    for (const [name, op] of Object.entries(C.operations)) {
      const input = (op as { in: z.ZodTypeAny }).in;
      if (input instanceof z.ZodObject && "modelPolicy" in input.shape) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  it("the database refuses to store a configured policy on a personal-local organization", async () => {
    // Not because the code avoids reading it -- code changes. The state in which the promise
    // could LOOK configured is removed (migration 0008).
    await expect(
      asOwner((c) =>
        c.query("UPDATE organizations SET model_policy = 'self-hosted-only' WHERE id = $1", [LOCAL]),
      ),
    ).rejects.toThrow(/organizations_local_policy_is_not_configurable/);
  });

  it("...and it refuses at INSERT time too, not only on update", async () => {
    await expect(
      asOwner((c) =>
        c.query(
          // `owner_user_id` is supplied because F16's migration 0012 requires it for a
          // personal-local row. Without it this INSERT would still fail -- but for the WRONG
          // constraint, and the assertion below would pass while proving nothing about the
          // policy column.
          "INSERT INTO organizations (id, name, kind, model_policy, owner_user_id) VALUES ($1,$2,'personal-local','self-hosted-only',$3)",
          [`${LOCAL}-2`, "sneaky", `${LOCAL}-2-owner`],
        ),
      ),
    ).rejects.toThrow(/organizations_local_policy_is_not_configurable/);
  });

  it("the capability mutation payload is an open bag, and it is not a way in", async () => {
    // `mutateCapability.in.payload` is `z.record(z.unknown())`: anything fits in it. This
    // asserts the server drops what it does not recognise instead of writing it somewhere.
    const r = await fetch(`${BASE}/capabilities/mutate`, {
      method: "POST",
      headers: auth(LOCAL),
      body: JSON.stringify({
        orgId: LOCAL, kind: "model", op: "add",
        payload: { name: "local-llm", scope: "org-wide", modelPolicy: "any", kind: "organization" },
      }),
    });
    expect(r.status).toBe(200);
    expect((await constraintFor(LOCAL)).source).toBe("promise");
  });

  it("a REAL organization's policy is changeable -- that is the other half of V12", async () => {
    // If nothing could change it, "policy" and "promise" would be equally immovable and the
    // distinction would be words. The contract has no operation for it, which is reported as
    // a gap; the storage-level change is asserted here so the difference is demonstrated.
    expect((await constraintFor(STRICT)).source).toBe("policy");
    await asApp(STRICT, (c) =>
      c.query("UPDATE organizations SET model_policy = 'any' WHERE id = $1", [STRICT]),
    );
    expect((await constraintFor(STRICT)).source).toBe("none");
  });
});

describe("D-U1: confidential data takes the whole round local, in any organization", () => {
  it("one confidential item is enough, and it is not the org policy talking", async () => {
    const r = await constraintFor(FORMAL, [
      { itemId: "i1", confidential: false },
      { itemId: "i2", confidential: true },
    ]);
    expect(r.localOnly).toBe(true);
    // Not "the confidential parts go local and the cloud takes the rest": splitting makes
    // privacy depend on per-fragment classification, and one miss is irreversible.
    expect(r.reason).toContain("entire round");
  });

  it("...and a scope with nothing confidential does NOT trigger it", async () => {
    // The other direction. Without it, "returns localOnly" is satisfied by always returning
    // true, which would also make every assertion above pass.
    const r = await constraintFor(FORMAL, [{ itemId: "i1", confidential: false }]);
    expect(r).toMatchObject({ localOnly: false, source: "none" });
  });

  it("an unchangeable rule outranks a changeable one when both apply", async () => {
    // STRICT has the policy AND confidential data. Reporting `policy` would tell the admin
    // they can lift a restriction that would still be there after they did.
    const r = await constraintFor(STRICT, [{ itemId: "i1", confidential: true }]);
    expect(r).toMatchObject({ localOnly: true, source: "promise" });
  });
});

describe("hard rule 6 counter-proof", () => {
  it("the model-constraint schema rejects a body that drifts", () => {
    // Otherwise every safeParse above is a check that says yes to everything.
    expect(C.operations.resolveModelConstraint.out.safeParse({ localOnly: true }).success).toBe(false);
    expect(
      C.operations.resolveModelConstraint.out.safeParse({
        localOnly: true, source: "mandate", reason: "x",
      }).success,
    ).toBe(false);
    expect(
      C.operations.resolveModelConstraint.out.safeParse({
        localOnly: "yes", source: "promise", reason: "x",
      }).success,
    ).toBe(false);
  });

  it("a non-member is refused without revealing the organization", async () => {
    const r = await fetch(`${BASE}/identity/model-constraint`, {
      method: "POST",
      headers: { "x-kernel-test-principal": `u-stranger:${FORMAL}`, "content-type": "application/json" },
      body: JSON.stringify({ orgId: FORMAL, dataScope: [] }),
    });
    expect(r.status).toBe(404);
  });
});
