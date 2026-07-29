import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { identity as C } from "@repo/contracts";
import {
  addOrgMember,
  addProjectMember,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
  workerPort,
} from "../support/db";

/**
 * Responses are validated against the contract too -- not just requests.
 *
 * The global ValidationPipe checks what comes IN. Nothing checked what goes OUT, which
 * means the response half of ADR-020's single-source chain was unenforced: the server could
 * return a body the contract does not describe and every gate would stay green, because the
 * frontend's types come from the same contract and would simply be wrong about reality.
 *
 * This is not hypothetical. It bit during F01: `Organization` in the contract carries a
 * `team` field, the repository's row type did not, and `/identity/me` would have returned a
 * body missing it. Nothing failed until this file existed.
 *
 * Why assert here rather than adding a response pipe: a pipe that rejects non-conforming
 * responses turns a schema slip into a 500 in production. Failing the build is the right
 * place to find out.
 */
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const PORT = workerPort(33230);
const BASE = `http://127.0.0.1:${PORT}`;
const ORG = "org-resp";
const PROJECT = "proj-resp";
const USER = "u-resp";

let app: NestExpressApplication;
let fx: Awaited<ReturnType<typeof seedOrg>>;

const auth = { "x-kernel-test-principal": `${USER}:${ORG}` };

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(PORT);
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, USER, "facilitator", null);
});

describe("every response conforms to the contract's `out` schema", () => {
  it("POST /identity/authorize -- when ALLOWED", async () => {
    const body = await fetch(`${BASE}/identity/authorize`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        orgId: ORG, projectId: PROJECT,
        object: { kind: "project", id: PROJECT }, action: "stage.advance",
      }),
    }).then((r) => r.json());
    const parsed = C.operations.authorize.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
  });

  it("POST /identity/authorize -- when DENIED, which is the case the schema got wrong", async () => {
    // The denial path is where the contract failed to describe reality: `orgLayer.role` was
    // declared non-nullable while `NO_ORG_MEMBERSHIP` is a verdict with no role to report.
    const body = await fetch(`${BASE}/identity/authorize`, {
      method: "POST",
      headers: { "x-kernel-test-principal": `u-stranger:${ORG}`, "content-type": "application/json" },
      body: JSON.stringify({
        orgId: ORG, object: { kind: "project", id: PROJECT }, action: "read.published",
      }),
    }).then((r) => r.json() as Promise<Record<string, unknown>>);
    expect(body.allowed).toBe(false);
    expect((body.orgLayer as { role: unknown }).role).toBeNull();
    const parsed = C.operations.authorize.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
  });

  it("POST /identity/authorize -- in project context with no project role", async () => {
    const body = await fetch(`${BASE}/identity/authorize`, {
      method: "POST",
      headers: { "x-kernel-test-principal": `u-noproj:${ORG}`, "content-type": "application/json" },
      body: JSON.stringify({
        orgId: ORG, projectId: PROJECT,
        object: { kind: "project", id: PROJECT }, action: "read.published",
      }),
    }).then((r) => r.json() as Promise<Record<string, unknown>>);
    await addOrgMember(ORG, "u-noproj", "consultant", null).catch(() => undefined);
    const parsed = C.operations.authorize.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
  });

  it("POST /identity/authorize-batch -- array, same length as the request", async () => {
    const objects = [
      { kind: "segment", id: "s1" },
      { kind: "segment", id: "s2" },
    ];
    const body = await fetch(`${BASE}/identity/authorize-batch`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ orgId: ORG, projectId: PROJECT, objects, action: "read.allHands" }),
    }).then((r) => r.json());
    const parsed = C.operations.authorizeBatch.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
    expect((body as unknown[]).length).toBe(objects.length);
  });

  it("GET /identity/me", async () => {
    const body = await fetch(`${BASE}/identity/me?orgId=${ORG}&projectId=${PROJECT}`, {
      headers: auth,
    }).then((r) => r.json() as Promise<Record<string, unknown>>);
    const parsed = C.operations.resolveIdentity.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
    // The field that was silently missing. Asserted by name so a future regression names itself.
    expect((body.org as { team: unknown }).team).toBe(fx.teams.energy);
  });

  it("GET /identity/me without project context -- projectRole is null (I-11)", async () => {
    const body = await fetch(`${BASE}/identity/me?orgId=${ORG}`, { headers: auth }).then((r) =>
      r.json() as Promise<Record<string, unknown>>,
    );
    const parsed = C.operations.resolveIdentity.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
    expect(body.projectRole).toBeNull();
  });

  it("POST /identity/switch-org", async () => {
    const body = await fetch(`${BASE}/identity/switch-org`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({ toOrgId: ORG }),
    }).then((r) => r.json());
    const parsed = C.operations.switchOrganization.out.safeParse(body);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(body)).toBeNull();
    // Empty, not a built-in default list -- that is F15's acceptance V1, and shipping a
    // placeholder now would create exactly the default it forbids.
    expect((body as { capabilities: unknown[] }).capabilities).toEqual([]);
  });
});

describe("the assertion above is not vacuous", () => {
  it("the same schemas REJECT a body that drifts from the contract", () => {
    // If safeParse accepted anything, every test above would pass while proving nothing.
    expect(C.operations.resolveIdentity.out.safeParse({ org: { id: "x" } }).success).toBe(false);
    expect(
      C.operations.authorize.out.safeParse({ allowed: true, orgLayer: { role: "admin" } }).success,
    ).toBe(false);
    // And specifically: a role value outside the closed enum must not sneak through.
    expect(
      C.operations.authorize.out.safeParse({
        allowed: true,
        orgLayer: { role: "superuser", teamId: null, passed: true },
        projectLayer: null,
        scopeLayer: { scope: "org-wide", passed: true },
        reasonCode: null,
        decisionId: "d-1",
      }).success,
    ).toBe(false);
  });
});
