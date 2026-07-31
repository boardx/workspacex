import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import {
  addOrgMember,
  addProjectMember,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import {
  AUTHORIZATION_CACHE,
  SESSION_STORE,
  type AuthorizationCache,
  type SessionStore,
} from "../../src/application/identity/ports";

/**
 * UC-0.3 acceptance V11 (ruling O-12): switching organization clears everything
 * project-scoped and re-evaluates permissions against the NEW organization.
 *
 * Driven over real HTTP against the real app, because the failure this guards against is
 * not a wrong return value -- it is state left behind. The naive implementation (set
 * currentOrgId, return the new org) passes any unit test you would think to write while
 * leaving the previous organization's project context and cached verdicts in place. The
 * user then sees org B's shell around org A's data and nothing reports an error.
 *
 * The env vars are set BEFORE importing the app: the test-principal channel is off by
 * default, and ESM imports hoist, so a top-level `import` would evaluate the resolver
 * before these lines run.
 */
process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

// Port and BASE are assigned at listen() time -- see the note in beforeAll.
let BASE: string;
const USER = "u-multi";

const ORG_A = "org-a-switch";
const ORG_B = "org-b-switch";
const PROJ_A = "proj-a-switch";
const PROJ_B = "proj-b-switch";

let app: NestExpressApplication;
let sessions: SessionStore;
let cache: AuthorizationCache;
let fxA: Awaited<ReturnType<typeof seedOrg>>;
let fxB: Awaited<ReturnType<typeof seedOrg>>;

const as = (userId: string) => ({ "x-kernel-test-principal": `${userId}:${ORG_A}` });

const post = (path: string, body: unknown, userId = USER) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { ...as(userId), "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const get = (path: string, userId = USER) => fetch(`${BASE}${path}`, { headers: as(userId) });

interface SessionSnapshot {
  currentOrgId: string | null;
  currentProjectId: string | null;
  currentStageId: string | null;
  contextPackId: string | null;
  draftRefs: string[];
  cachedDecisions: number;
}
interface DecisionBody {
  allowed: boolean;
  reasonCode: string | null;
  projectLayer: { role: string | null } | null;
}
interface MeBody {
  orgRole: string;
  teamId: string | null;
  projectRole: string | null;
  groupId: string | null;
}

const session = () => get("/kernel/probe/identity-session").then((r) => r.json() as Promise<SessionSnapshot>);

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
  sessions = app.get<SessionStore>(SESSION_STORE);
  cache = app.get<AuthorizationCache>(AUTHORIZATION_CACHE);
});

afterAll(async () => {
  await app?.close();
});

beforeEach(async () => {
  await resetOrgs(ORG_A, ORG_B);
  await cache.invalidateUser(USER);
  await sessions.clearProjectScoped(USER);

  // The same human, in two organizations, with DIFFERENT roles and teams in each. Equal
  // roles on both sides would let a stale verdict look correct by coincidence.
  fxA = await seedOrg({ orgId: ORG_A, projectId: PROJ_A });
  fxB = await seedOrg({ orgId: ORG_B, projectId: PROJ_B });
  await addOrgMember(ORG_A, USER, "admin", fxA.teams.energy!);
  await addProjectMember(ORG_A, PROJ_A, USER, "facilitator", null);
  await addOrgMember(ORG_B, USER, "consultant", fxB.teams.platform!);
  // Deliberately NO project membership in org B.
});

async function enterProject(): Promise<void> {
  await sessions.setOrg(USER, ORG_A);
  await sessions.setProjectScoped(USER, {
    currentProjectId: PROJ_A,
    currentStageId: "stage-3",
    contextPackId: "pack-77",
    draftRefs: ["draft-1", "draft-2"],
  });
  // A cached verdict from org A, of the kind a real request would leave behind.
  await cache.set(`${USER}|${ORG_A}|project:${PROJ_A}|read.allHands`, { allowed: true });
}

describe("V11 (1): switching clears ALL project-scoped context", () => {
  it("current project, stage, context pack and draft refs are gone", async () => {
    await enterProject();
    const before = await session();
    expect(before.currentProjectId).toBe(PROJ_A);
    expect(before.contextPackId).toBe("pack-77");

    const r = await post("/identity/switch-org", { toOrgId: ORG_B });
    expect(r.status).toBe(201);

    const after = await session();
    expect(after.currentOrgId).toBe(ORG_B);
    expect(after.currentProjectId).toBeNull();
    expect(after.currentStageId).toBeNull();
    expect(after.contextPackId).toBeNull();
    expect(after.draftRefs).toEqual([]);
  });

  it("no cached authorization decision survives the switch", async () => {
    await enterProject();
    expect((await session()).cachedDecisions).toBe(1);

    await post("/identity/switch-org", { toOrgId: ORG_B });

    // Stale authorization is the failure mode where the user keeps seeing the previous
    // organization's data and everything looks completely normal.
    expect((await session()).cachedDecisions).toBe(0);
  });
});

describe("V11 (2): org A's resources are unreachable from org B, without revealing they exist", () => {
  it("asking about org A's project while in org B is denied", async () => {
    await post("/identity/switch-org", { toOrgId: ORG_B });
    const r = await post("/identity/authorize", {
      orgId: ORG_B,
      projectId: PROJ_A, // belongs to org A
      object: { kind: "project", id: PROJ_A },
      action: "read.allHands",
    });
    const d = (await r.json()) as DecisionBody;
    expect(d.allowed).toBe(false);
  });

  it("org A's real project is indistinguishable from a project that never existed", async () => {
    await post("/identity/switch-org", { toOrgId: ORG_B });
    const shapeOf = async (projectId: string) => {
      const d = await post("/identity/authorize", {
        orgId: ORG_B, projectId,
        object: { kind: "project", id: projectId },
        action: "read.allHands",
      }).then((r) => r.json() as Promise<DecisionBody>);
      return { allowed: d.allowed, reasonCode: d.reasonCode, projectRole: d.projectLayer?.role ?? null };
    };
    expect(await shapeOf(PROJ_A)).toEqual(await shapeOf("project-that-never-existed"));
  });

  it("/identity/me for an organization the user does not belong to returns 404, not 403", async () => {
    // 403 answers "that org exists and you are not in it". 404 answers nothing.
    const r = await get("/identity/me?orgId=org-not-mine");
    expect(r.status).toBe(404);
    const body = await r.text();
    expect(body).not.toContain("org-not-mine");
  });

  it("switching to an organization the user does not belong to is refused", async () => {
    const r = await post("/identity/switch-org", { toOrgId: "org-stranger" });
    expect(r.status).toBe(404);
    // And the refusal must not have half-applied: the session is untouched.
    const s = await session();
    expect(s.currentOrgId).not.toBe("org-stranger");
  });
});

describe("V11 (3): permissions are re-evaluated against the NEW organization", () => {
  it("the org role and team come from org B after switching", async () => {
    await enterProject();
    const inA = await get(`/identity/me?orgId=${ORG_A}`).then((r) => r.json() as Promise<MeBody>);
    expect(inA.orgRole).toBe("admin");
    expect(inA.teamId).toBe(fxA.teams.energy);

    await post("/identity/switch-org", { toOrgId: ORG_B });

    const inB = await get(`/identity/me?orgId=${ORG_B}`).then((r) => r.json() as Promise<MeBody>);
    expect(inB.orgRole).toBe("consultant");
    expect(inB.teamId).toBe(fxB.teams.platform);
    // Same person, same session, different everything. Reusing the pre-switch judgement
    // would have kept them an admin of the energy team.
    expect(inB.orgRole).not.toBe(inA.orgRole);
  });

  it("a facilitator in org A is not a facilitator in org B", async () => {
    await enterProject();
    const allowedInA = await post("/identity/authorize", {
      orgId: ORG_A, projectId: PROJ_A,
      object: { kind: "project", id: PROJ_A }, action: "agendaSegment.advance",
    }).then((r) => r.json() as Promise<DecisionBody>);
    expect(allowedInA.allowed).toBe(true);

    await post("/identity/switch-org", { toOrgId: ORG_B });

    const inB = await post("/identity/authorize", {
      orgId: ORG_B, projectId: PROJ_B,
      object: { kind: "project", id: PROJ_B }, action: "agendaSegment.advance",
    }).then((r) => r.json() as Promise<DecisionBody>);
    expect(inB.allowed).toBe(false);
    expect(inB.reasonCode).toBe("NO_PROJECT_ROLE");
  });

  it("project-layer identity is null outside project context (I-11)", async () => {
    await post("/identity/switch-org", { toOrgId: ORG_B });
    const me = await get(`/identity/me?orgId=${ORG_B}`).then((r) => r.json() as Promise<MeBody>);
    expect(me.projectRole).toBeNull();
    expect(me.groupId).toBeNull();
  });
});

describe("the switch endpoint is not a way around the guard", () => {
  it("switching organizations without credentials is 401", async () => {
    const r = await fetch(`${BASE}/identity/switch-org`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ toOrgId: ORG_B }),
    });
    expect(r.status).toBe(401);
  });

  it("a malformed body is rejected with field-level errors, from the contract's schema", async () => {
    const r = await post("/identity/switch-org", { toOrg: ORG_B });
    expect(r.status).toBe(400);
    const body = (await r.json()) as { fields?: { path: string }[] };
    expect(body.fields?.some((f: { path: string }) => f.path === "toOrgId")).toBe(true);
  });
});
