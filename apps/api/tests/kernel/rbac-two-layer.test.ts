import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  addArtifact,
  addBinding,
  addOrgMember,
  addSegment,
  addProjectMember,
  asApp,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { authorize, authorizeBatch, authorizeDerived } from "../../src/application/identity/authorize";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { strictestScope, UNSATISFIABLE_TEAM } from "../../src/domain/identity/permission-decision";

/**
 * F01 -- the two-layer intersection, against a real database.
 *
 * Covers UC-0.3 AC1 (org role and project role do not substitute for each other),
 * R4 E1/E3/E4, and invariants I-1, I-7, I-11.
 *
 * These run through `PgIdentityRepository`, so what is under test is the whole path:
 * tenant-scoped SQL, the binding lookup, and the pure decision function -- not just the
 * last of those.
 */

const ORG = "org-alpha";
const PROJECT = "proj-1";
let db: PgDatabase;
let deps: { repo: PgIdentityRepository; ids: CountingDecisionIdFactory };
let fx: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  deps = { repo: new PgIdentityRepository(db), ids: new CountingDecisionIdFactory() };
});

beforeEach(async () => {
  await resetOrgs("org-alpha", "org-beta");
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
});

const call = (userId: string, action: string, opts: { projectId?: string; object?: { kind: "project" | "artifact" | "segment"; id: string } } = {}) =>
  authorize(deps, {
    userId,
    orgId: toOrgId(ORG),
    projectId: opts.projectId,
    object: opts.object ?? { kind: "project", id: PROJECT },
    action,
  });

describe("AC1: org role and project role do not substitute for each other", () => {
  it("an org admin with no project role is DENIED project content", async () => {
    await addOrgMember(ORG, "u-admin", "admin", fx.teams.energy!);
    const d = await call("u-admin", "read.allHands", { projectId: PROJECT });
    expect(d.allowed).toBe(false);
    // The org layer passed. That is the whole point: it is the project layer that closed
    // the door, and the response has to be able to say which.
    expect(d.orgLayer.passed).toBe(true);
    expect(d.orgLayer.role).toBe("admin");
    expect(d.projectLayer?.passed).toBe(false);
  });

  it("names the admin case specifically, because it is the one people file as a bug", async () => {
    await addOrgMember(ORG, "u-admin", "admin", fx.teams.energy!);
    const d = await call("u-admin", "read.allHands", { projectId: PROJECT });
    expect(d.reasonCode).toBe("ADMIN_NOT_SUPERUSER");
  });

  it("a compliance officer is on the same footing as an admin here (D-U3)", async () => {
    await addOrgMember(ORG, "u-comp", "compliance", fx.teams.energy!);
    const d = await call("u-comp", "read.allHands", { projectId: PROJECT });
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("ADMIN_NOT_SUPERUSER");
  });

  it("an ordinary consultant with no project role gets NO_PROJECT_ROLE, not the admin code", async () => {
    await addOrgMember(ORG, "u-c", "consultant", fx.teams.energy!);
    const d = await call("u-c", "read.allHands", { projectId: PROJECT });
    expect(d.reasonCode).toBe("NO_PROJECT_ROLE");
  });

  it("a project role without org membership is DENIED at the org layer", async () => {
    // No org_membership row. The project membership alone must not authorise anything --
    // otherwise a stale project row survives a user being removed from the organization.
    await addProjectMember(ORG, PROJECT, "u-ghost", "facilitator", null);
    const d = await call("u-ghost", "read.allHands", { projectId: PROJECT });
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("NO_ORG_MEMBERSHIP");
    expect(d.orgLayer.passed).toBe(false);
  });
});

describe("R4 E3: a team-scoped denial says it came from the ORG layer", () => {
  beforeEach(async () => {
    await addOrgMember(ORG, "u-platform", "consultant", fx.teams.platform!);
    await addProjectMember(ORG, PROJECT, "u-platform", "facilitator", null);
    // The artifact has to exist since F04: migration 0006 closed the gap 0003 declared, so
    // an ACL binding can no longer name an object that is not there.
    await addArtifact({ orgId: ORG, id: "ledger", projectId: PROJECT });
    await addBinding({
      orgId: ORG,
      subject: { kind: "team", id: fx.teams.energy! },
      object: { kind: "artifact", id: "ledger" },
      scope: "team-only",
      ownerTeamId: fx.teams.energy!,
    });
  });

  it("a facilitator outside the owning team is still denied", async () => {
    const d = await call("u-platform", "read.allHands", {
      projectId: PROJECT,
      object: { kind: "artifact", id: "ledger" },
    });
    expect(d.allowed).toBe(false);
    // Project role was sufficient; the org layer is what stopped it. Reporting this as a
    // project-layer problem sends the user hunting for a role they already hold.
    expect(d.reasonCode).toBe("ORG_SCOPE_DENIED");
    expect(d.scopeLayer).toEqual({ scope: "team-only", passed: false });
    expect(d.projectLayer?.role).toBe("facilitator");
  });

  it("the same request from inside the owning team is allowed", async () => {
    await addOrgMember(ORG, "u-energy", "consultant", fx.teams.energy!);
    await addProjectMember(ORG, PROJECT, "u-energy", "facilitator", null);
    const d = await call("u-energy", "read.allHands", {
      projectId: PROJECT,
      object: { kind: "artifact", id: "ledger" },
    });
    // Without this half, a policy that denies everyone would pass the test above.
    expect(d.allowed).toBe(true);
    expect(d.scopeLayer.passed).toBe(true);
  });

  it("a user with no team cannot satisfy a team-only resource", async () => {
    await addOrgMember(ORG, "u-noteam", "consultant", null);
    await addProjectMember(ORG, PROJECT, "u-noteam", "facilitator", null);
    const d = await call("u-noteam", "read.allHands", {
      projectId: PROJECT,
      object: { kind: "artifact", id: "ledger" },
    });
    // null == null must not read as "matches". This is the classic way a team check passes
    // for exactly the users it should stop.
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("ORG_SCOPE_DENIED");
  });
});

describe("I-11: the project layer only exists inside project context", () => {
  it("with no projectId, projectLayer is null rather than a default role", async () => {
    await addOrgMember(ORG, "u-c", "consultant", fx.teams.energy!);
    const d = await call("u-c", "read.published");
    expect(d.projectLayer).toBeNull();
    expect(d.allowed).toBe(true);
  });

  it("with a projectId but no membership, projectLayer EXISTS with a null role", async () => {
    await addOrgMember(ORG, "u-c", "consultant", fx.teams.energy!);
    const d = await call("u-c", "read.published", { projectId: PROJECT });
    // "not a project screen" and "on a project screen with no role" are different states.
    // Collapsing them is how project-layer identity ends up rendered on non-project pages.
    expect(d.projectLayer).not.toBeNull();
    expect(d.projectLayer?.role).toBeNull();
    expect(d.allowed).toBe(false);
  });
});

describe("denials do not leak whether the resource exists", () => {
  it("an unknown project and a real project the user cannot see are indistinguishable", async () => {
    await addOrgMember(ORG, "u-c", "consultant", fx.teams.energy!);
    const real = await call("u-c", "read.allHands", { projectId: PROJECT });
    const fake = await call("u-c", "read.allHands", { projectId: "no-such-project" });
    const shape = (d: typeof real) => ({
      allowed: d.allowed,
      reasonCode: d.reasonCode,
      orgPassed: d.orgLayer.passed,
      projectRole: d.projectLayer?.role ?? null,
      scope: d.scopeLayer,
    });
    expect(shape(fake)).toEqual(shape(real));
  });
});

describe("I-7: several sources take the STRICTEST scope, not the union", () => {
  it("org-wide combined with team-only yields team-only", () => {
    expect(
      strictestScope([
        { scope: "org-wide", ownerTeamId: null },
        { scope: "team-only", ownerTeamId: "t-energy" },
      ]),
    ).toEqual({ scope: "team-only", ownerTeamId: "t-energy" });
  });

  it("two DIFFERENT owning teams yields something nobody satisfies", () => {
    // The tempting answers are "either team" (union) or "org-wide" (loosest). Both hand a
    // derived artifact to people who could not read one of its sources.
    const r = strictestScope([
      { scope: "team-only", ownerTeamId: "t-energy" },
      { scope: "team-only", ownerTeamId: "t-platform" },
    ]);
    expect(r).toEqual({ scope: "team-only", ownerTeamId: UNSATISFIABLE_TEAM });
  });

  it("a derived object is judged by the strictest of its sources, end to end", async () => {
    await addOrgMember(ORG, "u-energy", "consultant", fx.teams.energy!);
    await addProjectMember(ORG, PROJECT, "u-energy", "facilitator", null);
    await addArtifact({ orgId: ORG, id: "src-open", projectId: PROJECT });
    await addArtifact({ orgId: ORG, id: "src-platform", projectId: PROJECT });
    await addBinding({
      orgId: ORG, subject: { kind: "team", id: fx.teams.energy! },
      object: { kind: "artifact", id: "src-open" }, scope: "org-wide",
    });
    await addBinding({
      orgId: ORG, subject: { kind: "team", id: fx.teams.platform! },
      object: { kind: "artifact", id: "src-platform" }, scope: "team-only",
      ownerTeamId: fx.teams.platform!,
    });

    const d = await authorizeDerived(deps, {
      userId: "u-energy",
      orgId: toOrgId(ORG),
      projectId: PROJECT,
      objects: [{ kind: "artifact", id: "derived" }],
      sources: [
        { kind: "artifact", id: "src-open" },
        { kind: "artifact", id: "src-platform" },
      ],
      action: "read.allHands",
    });
    // An energy-team member may read one source but not the other, so they may not read the
    // combination. Union semantics would have allowed this.
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("ORG_SCOPE_DENIED");
  });
});

describe("authorizeBatch (coherence review B-2 / X-1)", () => {
  it("returns one decision per object, in the SAME order", async () => {
    await addOrgMember(ORG, "u-energy", "consultant", fx.teams.energy!);
    await addProjectMember(ORG, PROJECT, "u-energy", "facilitator", null);
    // s1 and s3 stay unseeded on purpose: they are unbound objects, and the point of the
    // assertion is that an unbound object is judged by the org layer alone. Only s2 needs a
    // real row, because only s2 carries a binding.
    await addSegment({ orgId: ORG, segmentId: "s2", artifactId: "art-batch" });
    await addBinding({
      orgId: ORG, subject: { kind: "team", id: fx.teams.platform! },
      object: { kind: "segment", id: "s2" }, scope: "team-only", ownerTeamId: fx.teams.platform!,
    });

    const objects = [
      { kind: "segment" as const, id: "s1" },
      { kind: "segment" as const, id: "s2" },
      { kind: "segment" as const, id: "s3" },
    ];
    const decisions = await authorizeBatch(deps, {
      userId: "u-energy", orgId: toOrgId(ORG), projectId: PROJECT, objects, action: "read.allHands",
    });
    expect(decisions).toHaveLength(3);
    // Order is contractual precisely so callers never match by id -- an off-by-one there
    // pairs one item's content with another item's verdict, and nothing errors.
    expect(decisions.map((d) => d.allowed)).toEqual([true, false, true]);
  });

  it("gives every decision a distinct decisionId", async () => {
    await addOrgMember(ORG, "u-c", "consultant", fx.teams.energy!);
    const decisions = await authorizeBatch(deps, {
      userId: "u-c", orgId: toOrgId(ORG),
      objects: [
        { kind: "segment", id: "a" },
        { kind: "segment", id: "b" },
      ],
      action: "read.published",
    });
    // decisionId is what makes "why was I shown this" answerable per item. Reusing one id
    // across a batch collapses the audit trail to a single row.
    expect(new Set(decisions.map((d) => d.decisionId)).size).toBe(2);
  });

  it("an empty batch is legal and returns nothing", async () => {
    await addOrgMember(ORG, "u-c", "consultant", null);
    expect(
      await authorizeBatch(deps, { userId: "u-c", orgId: toOrgId(ORG), objects: [], action: "read.published" }),
    ).toEqual([]);
  });
});

describe("I-1: a binding's subject and object live in the same organization", () => {
  it("a cross-org binding is rejected by the database, not by application code", async () => {
    await seedOrg({ orgId: "org-beta", projectId: "proj-beta" });
    await addOrgMember(ORG, "u-c", "consultant", null);
    await expect(
      addBinding({
        orgId: ORG,
        subject: { kind: "user", id: "u-c" },
        // A project belonging to org-beta, claimed under org-alpha.
        object: { kind: "project", id: "proj-beta" },
        scope: "org-wide",
      }),
    ).rejects.toThrow(/invariant I-1/);
  });

  it("a binding whose subject is not an org member is rejected", async () => {
    await expect(
      addBinding({
        orgId: ORG,
        subject: { kind: "user", id: "u-stranger" },
        object: { kind: "project", id: PROJECT },
        scope: "org-wide",
      }),
    ).rejects.toThrow(/invariant I-1/);
  });

  it("a team-only binding with no owning team is rejected", async () => {
    await addOrgMember(ORG, "u-c", "consultant", null);
    // "team-only, team unknown" is not a stricter rule, it is an unanswerable one -- and
    // unanswerable rules get resolved as "allow" by whoever implements the caller.
    await expect(
      asApp(ORG, (c) =>
        c.query(
          `INSERT INTO acl_bindings (org_id, subject_kind, subject_id, object_kind, object_id, scope, owner_team_id)
           VALUES ($1,'user','u-c','project',$2,'team-only',NULL)`,
          [ORG, PROJECT],
        ),
      ),
    ).rejects.toThrow(/acl_bindings_team_only_needs_team/);
  });
});

describe("R4 E4: inconsistent data denies rather than falling back permissively", () => {
  it("an unknown action is denied, never waved through", async () => {
    await addOrgMember(ORG, "u-f", "consultant", fx.teams.energy!);
    await addProjectMember(ORG, PROJECT, "u-f", "facilitator", null);
    const d = await call("u-f", "stage.selfDestruct", { projectId: PROJECT });
    // A facilitator can do everything in the declared matrix. An action nobody declared is
    // still denied -- "unknown" must not read as "unrestricted".
    expect(d.allowed).toBe(false);
    expect(d.reasonCode).toBe("PROJECT_ROLE_INSUFFICIENT");
  });
});
