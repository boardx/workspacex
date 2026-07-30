/**
 * F07, second half — 「拒绝原因明确标为**组织层限制**（不是项目层）」.
 * phase-01 `org-admin` · uc-1-4 R3 / R8 · `coverage.md` V6.
 *
 * ## Why this needs its own file, and why "it returns 403" is not the assertion
 *
 * The failure this guards against is not "denials are missing". It is **denials that all
 * look the same**. `contracts/org-admin/usecases.md` on `ResolveResourceScope`: 拒绝原因
 * **必须标明是组织层限制**，不是项目层 — and the reason it matters is operational, not
 * cosmetic: a user told merely "no permission" goes to the project members page looking for
 * a role they already hold, and there is nothing there they can change. The thing they need
 * is a team membership, which only an org admin can grant.
 *
 * So every assertion below is a DISCRIMINATION assertion: the org-layer denial must differ
 * from each of the other layers' denials, both in `reasonCode` and structurally. A test that
 * only checked `reasonCode === "ORG_SCOPE_DENIED"` would still pass on an implementation
 * that returned that code for every refusal in the system.
 *
 * ## The MCP section
 *
 * 「MCP 的授权范围…是另一套枚举，**不与团队可见性合并成同一字段**」 (feature statement;
 * `contracts/templates/design-signoff.md` X-8 / I-27; `uc-0-3` R7). Asserted as: no value of
 * one vocabulary is accepted by the other, and the decision object has nowhere to put an
 * MCP scope even if someone tried.
 *
 * ⚠ Deliberately NOT asserted: any mapping or unification between the four coexisting
 * visibility vocabularies. `design-coherence.md` XC-05 is unruled and belongs to a human.
 * This file asserts only the SEPARATION, which is already ruled.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { agentRuntime as AR, identity as I, orgAdmin as OA } from "@repo/contracts";
import { addCapability, addOrgMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { decide, type PermissionDecision } from "../../src/domain/identity/permission-decision";

process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

const ORG = "org-f07-deny";
const ENERGY = "u-f07d-energy";
const PLATFORM = "u-f07d-platform";
const ADMIN = "u-f07d-admin";

let BASE: string;
let app: NestExpressApplication;
let fx: Awaited<ReturnType<typeof seedOrg>>;

const authFor = (user: string) => ({ "x-kernel-test-principal": `${user}:${ORG}` });

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
  await resetOrgs(ORG);
});

beforeEach(async () => {
  await resetOrgs(ORG);
  fx = await seedOrg({ orgId: ORG, projectId: `${ORG}-p` });
  await addOrgMember(ORG, ENERGY, "consultant", fx.teams.energy!);
  await addOrgMember(ORG, PLATFORM, "consultant", fx.teams.platform!);
  await addOrgMember(ORG, ADMIN, "admin", fx.teams.platform!);
  await addCapability({
    orgId: ORG, id: "f07d-cap", kind: "agent", name: "f07d-energy-agent",
    scope: "team-only", ownerTeamId: fx.teams.energy!,
  });
});

const ask = (user: string, id = "f07d-cap") =>
  fetch(`${BASE}/organizations/${ORG}/resource-scope?resource[kind]=agent&resource[id]=${id}`, {
    headers: authFor(user),
  });

describe("the denial says ORG LAYER, over HTTP", () => {
  it("wrong team: reasonCode names the org scope and the scope layer is the one that failed", async () => {
    const body = (await ask(PLATFORM).then((r) => r.json())) as PermissionDecision;
    expect(body.allowed).toBe(false);
    expect(body.reasonCode).toBe("ORG_SCOPE_DENIED");
    // Structural, not just the code: the layer that closed the door is identifiable from
    // the payload without knowing the code's meaning.
    expect(body.scopeLayer.passed).toBe(false);
    expect(body.orgLayer.passed).toBe(false);
    // ...and this person IS in the organization. Conflating "not a member" with "wrong team"
    // sends them to the wrong person to ask (uc-1-4 R8).
    expect(body.orgLayer.role).toBe("consultant");
    expect(body.orgLayer.teamId).toBe(fx.teams.platform);
    // No project context was involved at all (identity I-11) — so nobody can read this as a
    // project-layer refusal.
    expect(body.projectLayer).toBeNull();
  });

  it("an org ADMIN of the wrong team is denied identically — 管理员不是超级用户", async () => {
    // D-18 / AC1. If admins slipped through here, 「无论其项目角色为何」 would be true and
    // 「一律拒绝」 false, and the hole would be in the role most likely to be used to test.
    const body = (await ask(ADMIN).then((r) => r.json())) as PermissionDecision;
    expect(body.allowed).toBe(false);
    expect(body.reasonCode).toBe("ORG_SCOPE_DENIED");
    expect(body.orgLayer.role).toBe("admin");
  });
});

describe("hard rule 6: the response body conforms to the contract, denial path included", () => {
  const parse = (body: unknown) => OA.operations.resolveResourceScope.out.safeParse(body);

  it("denied", async () => {
    const body = await ask(PLATFORM).then((r) => r.json());
    const r = parse(body);
    expect(r.success ? null : r.error.issues, JSON.stringify(body)).toBeNull();
  });

  it("allowed", async () => {
    const body = await ask(ENERGY).then((r) => r.json());
    const r = parse(body);
    expect(r.success ? null : r.error.issues, JSON.stringify(body)).toBeNull();
    expect((body as PermissionDecision).allowed).toBe(true);
  });

  it("COUNTER-PROOF: that schema rejects bodies that drift", () => {
    // Without this the two assertions above could be a safeParse that says yes to anything.
    expect(parse({ allowed: false }).success).toBe(false);
    // A reason code outside the closed enum must not pass.
    expect(
      parse({
        allowed: false,
        orgLayer: { role: "consultant", teamId: "t", passed: false },
        projectLayer: null,
        scopeLayer: { scope: "team-only", passed: false },
        reasonCode: "TEAM_DENIED",
        decisionId: "d",
      }).success,
    ).toBe(false);
    // A scope outside the closed enum likewise — `"team"` is a drift this repo already
    // shipped once.
    expect(
      parse({
        allowed: false,
        orgLayer: { role: "consultant", teamId: "t", passed: false },
        projectLayer: null,
        scopeLayer: { scope: "team", passed: false },
        reasonCode: "ORG_SCOPE_DENIED",
        decisionId: "d",
      }).success,
    ).toBe(false);
  });
});

/**
 * The five refusals, built from the pure decision function so every axis can be varied
 * independently. HTTP can only reach two of them on this route.
 */
const REFUSALS: Readonly<Record<string, PermissionDecision>> = {
  NO_ORG_MEMBERSHIP: decide({
    decisionId: "d1", action: "read.published",
    org: { role: null, teamId: null }, project: null,
    scope: { scope: "org-wide", ownerTeamId: null },
  }),
  ORG_SCOPE_DENIED: decide({
    decisionId: "d2", action: "read.published",
    org: { role: "consultant", teamId: "team-platform" },
    project: { role: "facilitator", groupId: "g1", isHost: true },
    scope: { scope: "team-only", ownerTeamId: "team-energy" },
  }),
  NO_PROJECT_ROLE: decide({
    decisionId: "d3", action: "read.published",
    org: { role: "consultant", teamId: "team-energy" },
    project: { role: null, groupId: null, isHost: false },
    scope: { scope: "org-wide", ownerTeamId: null },
  }),
  ADMIN_NOT_SUPERUSER: decide({
    decisionId: "d4", action: "read.published",
    org: { role: "admin", teamId: "team-energy" },
    project: { role: null, groupId: null, isHost: false },
    scope: { scope: "org-wide", ownerTeamId: null },
  }),
  PROJECT_ROLE_INSUFFICIENT: decide({
    decisionId: "d5", action: "stage.advance",
    org: { role: "consultant", teamId: "team-energy" },
    project: { role: "observer", groupId: "g1", isHost: false },
    scope: { scope: "org-wide", ownerTeamId: null },
  }),
};

describe("the org-layer denial is DISTINGUISHABLE from every other layer's denial", () => {
  it("each construction produces the refusal it is named after", () => {
    for (const [expected, d] of Object.entries(REFUSALS)) {
      expect(d.allowed, expected).toBe(false);
      expect(d.reasonCode, expected).toBe(expected);
    }
  });

  it("the five reason codes are pairwise distinct — not all denials look alike", () => {
    const codes = Object.values(REFUSALS).map((d) => d.reasonCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("every refusal names a reason: a bare `allowed:false` is not a permitted shape", () => {
    for (const [name, d] of Object.entries(REFUSALS)) {
      expect(d.reasonCode, name).not.toBeNull();
      // And the code is one the contract knows, so the UI can branch on it.
      expect(I.PermissionReason.safeParse(d.reasonCode).success, name).toBe(true);
    }
  });

  it("STRUCTURALLY too: only the org-scope refusal has a failed scope layer", () => {
    // The load-bearing assertion of this file. A caller that does not know what
    // `ORG_SCOPE_DENIED` means can still tell which layer refused, by reading the layers.
    for (const [name, d] of Object.entries(REFUSALS)) {
      expect(d.scopeLayer.passed, name).toBe(name !== "ORG_SCOPE_DENIED");
    }
    // ...and the project-layer refusals all passed the scope, so a UI branching on
    // `scopeLayer.passed` sends exactly the org-scope case to the org admin.
    expect(REFUSALS.NO_PROJECT_ROLE!.projectLayer?.passed).toBe(false);
    expect(REFUSALS.PROJECT_ROLE_INSUFFICIENT!.projectLayer?.passed).toBe(false);
    // The org-scope refusal's project layer PASSED — it was denied despite the project
    // being fine, which is 「无论其项目角色为何」 stated as a structure rather than a loop.
    expect(REFUSALS.ORG_SCOPE_DENIED!.projectLayer?.passed).toBe(true);
  });

  it("the one overlap is named rather than hidden: a NON-MEMBER also fails the scope layer", () => {
    // Honest limit of the structural predicate above. A non-member asking about a team-only
    // resource fails BOTH the membership check and the scope check, so `scopeLayer.passed`
    // alone does not separate those two cases.
    const nonMemberTeamOnly = decide({
      decisionId: "d6", action: "read.published",
      org: { role: null, teamId: null }, project: null,
      scope: { scope: "team-only", ownerTeamId: "team-energy" },
    });
    expect(nonMemberTeamOnly.scopeLayer.passed).toBe(false);
    // `reasonCode` is what discriminates here, and it takes the membership answer first --
    // which is the right order: telling a non-member "you are in the wrong team" would
    // imply they are in the organization at all.
    expect(nonMemberTeamOnly.reasonCode).toBe("NO_ORG_MEMBERSHIP");
    expect(nonMemberTeamOnly.reasonCode).not.toBe(REFUSALS.ORG_SCOPE_DENIED!.reasonCode);
    // ⇒ the pair (reasonCode, scopeLayer.passed) separates all six cases; scopeLayer alone
    // separates five of them. Stated so nobody later reads the predicate as stronger.
  });

  it("COUNTER-PROOF: an allow is not accidentally satisfying these predicates", () => {
    const ok = decide({
      decisionId: "d0", action: "read.published",
      org: { role: "consultant", teamId: "team-energy" },
      project: { role: "member", groupId: "g1", isHost: false },
      scope: { scope: "team-only", ownerTeamId: "team-energy" },
    });
    expect(ok.allowed).toBe(true);
    expect(ok.reasonCode).toBeNull();
    expect(ok.scopeLayer.passed).toBe(true);
  });
});

describe("MCP authorization scope is a SEPARATE vocabulary — 禁止合并成同一字段", () => {
  /** The three orthogonal MCP axes (O-20 / I-17), plus the visibility scope itself. */
  const VOCABULARIES = {
    "identity.VisibilityScope": I.VisibilityScope.options as readonly string[],
    "agentRuntime.ToolAuthScope": AR.ToolAuthScope.options as readonly string[],
    "agentRuntime.McpReviewStatus": AR.McpReviewStatus.options as readonly string[],
  };

  it("no value of one vocabulary is a value of another", () => {
    const names = Object.keys(VOCABULARIES) as (keyof typeof VOCABULARIES)[];
    for (const a of names) {
      for (const b of names) {
        if (a === b) continue;
        const overlap = VOCABULARIES[a].filter((v) => VOCABULARIES[b].includes(v));
        expect(overlap, `${a} ∩ ${b}`).toEqual([]);
      }
    }
  });

  it("the visibility field rejects every MCP authorization-scope value", () => {
    // This is what "禁止合并成同一字段" means mechanically: if the two were ever merged,
    // one of these would start parsing.
    for (const v of AR.ToolAuthScope.options) {
      expect(I.VisibilityScope.safeParse(v).success, v).toBe(false);
    }
    for (const v of AR.McpReviewStatus.options) {
      expect(I.VisibilityScope.safeParse(v).success, v).toBe(false);
    }
    // ...and in the other direction, so this is not a one-way accident of alphabets.
    for (const v of I.VisibilityScope.options) {
      expect(AR.ToolAuthScope.safeParse(v).success, v).toBe(false);
    }
  });

  it("COUNTER-PROOF: those schemas do accept their OWN values", () => {
    // Without this, the assertions above hold for a schema that rejects everything.
    for (const v of I.VisibilityScope.options) expect(I.VisibilityScope.safeParse(v).success).toBe(true);
    for (const v of AR.ToolAuthScope.options) expect(AR.ToolAuthScope.safeParse(v).success).toBe(true);
  });

  it("the decision object has nowhere to carry an MCP scope, even if someone added one", () => {
    const denied = REFUSALS.ORG_SCOPE_DENIED!;
    expect(OA.operations.resolveResourceScope.out.safeParse(denied).success).toBe(true);
    // `.strict()` is what makes the separation enforceable rather than conventional.
    expect(
      OA.operations.resolveResourceScope.out.safeParse({ ...denied, mcpAuthScope: "仅项目负责人" })
        .success,
    ).toBe(false);
    // And the scope layer will not take one either.
    expect(
      OA.operations.resolveResourceScope.out.safeParse({
        ...denied,
        scopeLayer: { scope: "仅项目负责人", passed: false },
      }).success,
    ).toBe(false);
  });

  it("the live HTTP response likewise carries no MCP authorization scope", async () => {
    const text = await ask(PLATFORM).then((r) => r.text());
    for (const v of AR.ToolAuthScope.options) expect(text).not.toContain(v);
    for (const v of AR.McpReviewStatus.options) expect(text).not.toContain(v);
  });
});
