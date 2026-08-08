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
} from "../support/db";
import { seedCredential } from "../support/auth";

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

// Port and BASE are assigned at listen() time -- see the note in beforeAll.
let BASE: string;
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
  // Port 0: the OS assigns a free one and we read it back.
  //
  // The previous version derived a port from a hash of WORKSPACEX_DB. That is a workaround,
  // not a fix -- two runs whose names collide mod the hash space pick the same port, and
  // CI hit exactly that on its second run (EADDRINUSE 33550). It also leaves a run that
  // died mid-test holding a port the next run wants.
  //
  // Asking for 0 removes the whole class: there is no number to collide on.
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG);
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, USER, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, USER, "facilitator", null);
  // Addendum A: `resolveIdentity` now reads `credentials.display_name`, so USER needs a real
  // credential row -- the test-principal header (KERNEL_ALLOW_TEST_PRINCIPAL) bypasses login
  // but not this read. ON CONFLICT keeps this idempotent across runs.
  await seedCredential({ userId: USER, email: `${USER}@f638-resp.test`, password: "correct horse battery staple", displayName: "Resp Fixture" });
});

describe("every response conforms to the contract's `out` schema", () => {
  it("POST /identity/authorize -- when ALLOWED", async () => {
    const body = await fetch(`${BASE}/identity/authorize`, {
      method: "POST",
      headers: { ...auth, "content-type": "application/json" },
      body: JSON.stringify({
        orgId: ORG, projectId: PROJECT,
        object: { kind: "project", id: PROJECT }, action: "agendaSegment.advance",
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
    // Addendum A (反证 A): read from `credentials.display_name`, not a placeholder. If the
    // read step is removed, this fails (missing field => schema parse above already fails)
    // AND this line would assert against a stale/absent value even if someone patched the
    // schema to make displayName optional to dodge the parse failure.
    expect(body.displayName).toBe("Resp Fixture");
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
    // Empty because this organization has configured nothing -- F15's acceptance V1. The
    // resolution is real now (F15): the configured direction is asserted in
    // no-builtin-capability-lists.test.ts, which is what stops "always []" from passing.
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
