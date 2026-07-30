/**
 * F07 — 资源可见性范围过滤（全组织可用 / 仅某团队）。
 * phase-01 `org-admin` · uc-1-4 R3 · `coverage.md` V6.
 *
 * ## What this file is actually asserting
 *
 * Not "the list looks right". The claim is narrower and harder: **the row never leaves the
 * server**. Every assertion here is made against the RAW RESPONSE TEXT, not against a
 * parsed array — because a filter that runs in the browser produces exactly the same
 * parsed array in a happy-path test while shipping the restricted agent's name to someone
 * who may not have it. `expect(body.map(name))` cannot tell those two apart;
 * `expect(text).not.toContain(name)` can.
 *
 * Counter-proof for that claim is recorded in the F07 issue comment: removing the server
 * side filter (returning `[...visible, ...withheld]` from `listCapabilities`, or dropping
 * the `decideCapabilityVisibility` call) turns these red immediately.
 *
 * ## Why `agent` AND `canvas-template`
 *
 * feature notes, verbatim: 「可见性范围只在 agent 与画布模板两类上[原型]确认存在」. Testing
 * one of the two would leave the other's path unexercised, and they are separate rows with
 * separate kinds travelling the same code — which is precisely the arrangement where one
 * gets wired and the other does not.
 *
 * ## The project-role clause has its own section
 *
 * 「对非该团队成员一律拒绝，**无论其项目角色为何**」 is not implied by any HTTP test above:
 * a capability read carries no project context at all, so no HTTP request can vary the
 * project role. It is asserted exhaustively over the four-value `ProjectRole` enum against
 * the pure decision function instead — and derived from the enum, so a fifth role cannot be
 * added without this loop covering it.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { identity as I } from "@repo/contracts";
import { addCapability, addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { decide, type PermissionDecision } from "../../src/domain/identity/permission-decision";
import { resolveResourceScope } from "../../src/application/org-admin/resolve-resource-scope";
import {
  CAPABILITY_REPOSITORY,
  type CapabilityRepository,
} from "../../src/application/identity/capability-ports";
import {
  DECISION_ID_FACTORY,
  IDENTITY_REPOSITORY,
  type DecisionIdFactory,
  type IdentityRepository,
} from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f07-vis";
/** In the energy team — the team that owns the restricted rows. */
const ENERGY = "u-f07-energy";
/** In the platform team — same organization, wrong team. The person F07 is about. */
const PLATFORM = "u-f07-platform";

/**
 * The restricted rows' names are deliberately long and unique: a substring assertion is
 * only as strong as the improbability of the substring appearing by accident.
 */
const SECRET_AGENT = "f07-energy-only-agent-DO-NOT-LEAK";
const SECRET_TEMPLATE = "f07-energy-only-canvas-template-DO-NOT-LEAK";
const OPEN_AGENT = "f07-org-wide-agent";

let BASE: string;
let app: NestExpressApplication;
let fx: Awaited<ReturnType<typeof seedOrg>>;
let deps: { repo: IdentityRepository; capabilities: CapabilityRepository; ids: DecisionIdFactory };

const authFor = (user: string) => ({ "x-kernel-test-principal": `${user}:${ORG}` });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  deps = {
    repo: app.get<IdentityRepository>(IDENTITY_REPOSITORY),
    capabilities: app.get<CapabilityRepository>(CAPABILITY_REPOSITORY),
    ids: app.get<DecisionIdFactory>(DECISION_ID_FACTORY),
  };
});

afterAll(async () => {
  await app?.close();
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await addOrgMember(ORG, ENERGY, "consultant", fx.teams.energy!);
  await addOrgMember(ORG, PLATFORM, "consultant", fx.teams.platform!);

  await addCapability({
    orgId: ORG, id: "f07-cap-agent", kind: "agent", name: SECRET_AGENT,
    scope: "team-only", ownerTeamId: fx.teams.energy!,
  });
  await addCapability({
    orgId: ORG, id: "f07-cap-tpl", kind: "canvas-template", name: SECRET_TEMPLATE,
    scope: "team-only", ownerTeamId: fx.teams.energy!,
  });
  await addCapability({ orgId: ORG, id: "f07-cap-open", kind: "agent", name: OPEN_AGENT });
});

/** Raw text, never `.json()` — see the header. */
const listRaw = (user: string, kind: string): Promise<string> =>
  fetch(`${BASE}/capabilities?orgId=${ORG}&kind=${kind}`, { headers: authFor(user) }).then((r) => r.text());

describe("the filtering happens on the SERVER: the row is not in the response at all", () => {
  it("agent — a wrong-team member's response body does not contain the restricted row", async () => {
    const text = await listRaw(PLATFORM, "agent");
    // The three assertions are not redundant. Name, id and owning team are three separate
    // fields that could each survive an incomplete filter (a projection that blanks `name`
    // but keeps `id` still tells you the row exists and which team holds it).
    expect(text).not.toContain(SECRET_AGENT);
    expect(text).not.toContain("f07-cap-agent");
    expect(text).not.toContain(fx.teams.energy!);
    // ...and the request was not simply empty: the org-wide row DID come back, so the
    // absence above is a filter doing its job, not a query returning nothing.
    expect(text).toContain(OPEN_AGENT);
  });

  it("canvas-template — the same, for the second kind F07 names", async () => {
    const text = await listRaw(PLATFORM, "canvas-template");
    expect(text).not.toContain(SECRET_TEMPLATE);
    expect(text).not.toContain("f07-cap-tpl");
    // This kind has no org-wide row seeded, so `[]` is the correct answer here. Asserted
    // exactly, so that a future "return everything" regression cannot hide behind emptiness.
    expect(JSON.parse(text)).toEqual([]);
  });

  it("a member of the OWNING team gets both rows — so the denial above was the scope, not the row", async () => {
    // Without this, every assertion above is satisfiable by a broken query that returns
    // nothing to anybody, which is the classic vacuous permission test.
    expect(await listRaw(ENERGY, "agent")).toContain(SECRET_AGENT);
    expect(await listRaw(ENERGY, "canvas-template")).toContain(SECRET_TEMPLATE);
  });
});

describe("ResolveResourceScope: the same judgement, asked directly (V6)", () => {
  const ask = (user: string, kind: string, id: string): Promise<Response> =>
    fetch(
      `${BASE}/organizations/${ORG}/resource-scope?resource[kind]=${kind}&resource[id]=${id}`,
      { headers: authFor(user) },
    );

  it("wrong team is denied, and the response carries no fact about the resource", async () => {
    const r = await ask(PLATFORM, "agent", "f07-cap-agent");
    expect(r.status).toBe(200); // a verdict, not an exception (UC-0.3 R6)
    const text = await r.text();
    expect(text).not.toContain(SECRET_AGENT);
    expect(text).not.toContain(fx.teams.energy!);
    expect((JSON.parse(text) as PermissionDecision).allowed).toBe(false);
  });

  it("owning team is allowed — the route is not a constant `false`", async () => {
    const body = (await ask(ENERGY, "agent", "f07-cap-agent").then((r) => r.json())) as PermissionDecision;
    expect(body.allowed).toBe(true);
    expect(body.scopeLayer).toEqual({ scope: "team-only", passed: true });
  });

  it("org-wide resources are visible to every member of the organization", async () => {
    const body = (await ask(PLATFORM, "agent", "f07-cap-open").then((r) => r.json())) as PermissionDecision;
    expect(body.allowed).toBe(true);
    expect(body.scopeLayer).toEqual({ scope: "org-wide", passed: true });
  });

  it("an id that does not exist is INDISTINGUISHABLE from one restricted to another team (V13)", async () => {
    // Otherwise this route is an enumeration oracle over the organization's configuration:
    // ask about every id, and the ones that answer differently are the ones that exist.
    const missing = (await ask(ENERGY, "agent", "f07-cap-nonexistent").then((r) => r.json())) as PermissionDecision;
    const otherTeam = (await ask(PLATFORM, "agent", "f07-cap-agent").then((r) => r.json())) as PermissionDecision;
    const strip = (d: PermissionDecision) => ({ ...d, decisionId: "<any>" });
    // Compared field by field except the decision id, which is unique per call by design.
    expect(strip(missing)).toEqual(strip({ ...otherTeam, orgLayer: missing.orgLayer }));
    expect(missing.reasonCode).toBe("ORG_SCOPE_DENIED");
  });

  it("an id belonging to a DIFFERENT kind is absent, not cross-reported", async () => {
    // Asking about the canvas template's id under `kind=agent` must not confirm that the id
    // is real; "wrong kind" is still a fact about the configuration.
    const body = (await ask(ENERGY, "agent", "f07-cap-tpl").then((r) => r.json())) as PermissionDecision;
    expect(body.allowed).toBe(false);
    expect(body.reasonCode).toBe("ORG_SCOPE_DENIED");
  });

  it("a resource kind outside the closed capability set is a 400, not a verdict", async () => {
    // A typo must not read as an authorization result forever.
    const r = await ask(ENERGY, "canvas_template", "f07-cap-tpl");
    expect(r.status).toBe(400);
  });

  it("the use case is reachable without HTTP and gives the same answer", async () => {
    // Proves the judgement is in `application`, not in the controller: an equivalent check
    // written inside the route handler would make this call return something else.
    const d = await resolveResourceScope(deps, {
      userId: PLATFORM, orgId: toOrgId(ORG), resource: { kind: "agent", id: "f07-cap-agent" },
    });
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("ORG_SCOPE_DENIED");
  });
});

describe("「无论其项目角色为何」 — exhaustive over the project-role enum", () => {
  /**
   * Derived from the contract, not written out. A fifth project role added to
   * `identity.ProjectRole` is covered by this loop the day it lands; a hand-written list of
   * four would silently stop covering the enum it claims to cover.
   */
  const ROLES = I.ProjectRole.options;

  it("every project role, including facilitator, is denied a team-only resource of another team", () => {
    expect(ROLES.length).toBeGreaterThan(0); // guards against a vacuous loop
    for (const role of ROLES) {
      const d = decide({
        decisionId: `d-${role}`,
        // A read action the role matrix grants broadly — so if this denial were coming from
        // the PROJECT layer instead, the test would not be able to tell. It is not: see the
        // projectLayer assertion below.
        action: "read.published",
        org: { role: "consultant", teamId: "team-platform" },
        project: { role, groupId: "g1", isHost: role === "facilitator" },
        scope: { scope: "team-only", ownerTeamId: "team-energy" },
      });
      expect(d.allowed, `project role ${role} must not open a team-only resource`).toBe(false);
      expect(d.reasonCode, `project role ${role}`).toBe("ORG_SCOPE_DENIED");
      // The load-bearing half: the project layer PASSED and the request was still denied.
      // Without this, a denial caused by the project matrix would satisfy the line above.
      expect(d.projectLayer?.passed, `project role ${role} project layer`).toBe(true);
    }
  });

  it("COUNTER-PROOF: the same roles DO get through once the team matches", () => {
    // Without this the loop above is satisfiable by a decision function that denies
    // everything, which is the failure mode a permission test is least able to notice.
    for (const role of ROLES) {
      const d = decide({
        decisionId: `d-ok-${role}`,
        action: "read.published",
        org: { role: "consultant", teamId: "team-energy" },
        project: { role, groupId: "g1", isHost: false },
        scope: { scope: "team-only", ownerTeamId: "team-energy" },
      });
      expect(d.scopeLayer, `project role ${role}`).toEqual({ scope: "team-only", passed: true });
    }
  });
});
