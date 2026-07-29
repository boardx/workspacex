import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addOrgMember,
  addProjectMember,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { authorize } from "../../src/application/identity/authorize";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { CountingDecisionIdFactory } from "../../src/infrastructure/identity/in-memory-session-store";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { ORG_ROLES, PROJECT_ROLES } from "../../src/domain/identity/roles";
import {
  PROJECT_ACTIONS,
  PROJECT_ROLE_MATRIX,
  WRITE_ACTIONS,
  type ProjectAction,
} from "../../src/domain/identity/project-role-matrix";

/**
 * UC-0.3 acceptance V4: call the same set of operations as each of the four project roles
 * plus an unauthorised user, and check the results against the R5 table exactly.
 *
 * The enumeration is exhaustive on purpose -- 4 roles x every declared action. Spot checks
 * are how a permission matrix ends up correct for the three cases someone thought of.
 */

const ORG = "org-matrix";
const PROJECT = "proj-m";
let deps: { repo: PgIdentityRepository; ids: CountingDecisionIdFactory };
let fx: Awaited<ReturnType<typeof seedOrg>>;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  deps = {
    repo: new PgIdentityRepository(new PgDatabase(appConfig())),
    ids: new CountingDecisionIdFactory(),
  };
});

beforeEach(async () => {
  await resetOrgs("org-matrix");
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  for (const role of PROJECT_ROLES) {
    await addOrgMember(ORG, `u-${role}`, "consultant", fx.teams.energy!);
    await addProjectMember(ORG, PROJECT, `u-${role}`, role, fx.groups.g1!);
  }
  // Org member, no project role. The "unauthorised user" row of V4.
  await addOrgMember(ORG, "u-none", "consultant", fx.teams.energy!);
});

const ask = (userId: string, action: string) =>
  authorize(deps, {
    userId,
    orgId: toOrgId(ORG),
    projectId: PROJECT,
    object: { kind: "project", id: PROJECT },
    action,
  });

describe("the role vocabulary is closed", () => {
  it("there are exactly four project roles (O-03)", () => {
    // Co-facilitator is a second facilitator INSTANCE; researcher/participant are display
    // aliases; interviewee is a token identity. Each was proposed as a fifth role, and
    // accepting any one turns a 2-way intersection into a 3-way one.
    expect(PROJECT_ROLES).toHaveLength(4);
    expect([...PROJECT_ROLES].sort()).toEqual(["facilitator", "groupLead", "member", "observer"]);
  });

  it("there are exactly four org roles (D-U3 added compliance, and stopped there)", () => {
    expect(ORG_ROLES).toHaveLength(4);
    expect([...ORG_ROLES].sort()).toEqual(["admin", "compliance", "consultant", "lead"]);
  });

  it("every role in the matrix is a declared role, and every declared role is in the matrix", () => {
    expect(Object.keys(PROJECT_ROLE_MATRIX).sort()).toEqual([...PROJECT_ROLES].sort());
  });

  it("every action in the matrix is a declared action", () => {
    for (const [role, actions] of Object.entries(PROJECT_ROLE_MATRIX)) {
      for (const a of actions) {
        expect(PROJECT_ACTIONS, `${role} grants undeclared action ${a}`).toContain(a);
      }
    }
  });

  it("no action is orphaned -- every declared action is reachable by someone", () => {
    // An action nobody can perform is either a typo or a permission that was quietly
    // removed. Either way the declaration is lying about what the system does.
    const reachable = new Set(Object.values(PROJECT_ROLE_MATRIX).flat());
    expect([...PROJECT_ACTIONS].filter((a) => !reachable.has(a))).toEqual([]);
  });
});

describe("V4: every role x every action, against the R5 table", () => {
  for (const role of PROJECT_ROLES) {
    for (const action of PROJECT_ACTIONS) {
      const expected = (PROJECT_ROLE_MATRIX[role] as readonly string[]).includes(action);
      it(`${role} ${expected ? "MAY" : "may NOT"} ${action}`, async () => {
        const d = await ask(`u-${role}`, action);
        expect(d.allowed).toBe(expected);
        if (!expected) expect(d.reasonCode).toBe("PROJECT_ROLE_INSUFFICIENT");
      });
    }
  }
});

describe("V4: the unauthorised row", () => {
  it("an org member with no project role can do nothing in the project", async () => {
    for (const action of PROJECT_ACTIONS) {
      const d = await ask("u-none", action);
      expect(d.allowed, `u-none unexpectedly allowed ${action}`).toBe(false);
      expect(d.reasonCode).toBe("NO_PROJECT_ROLE");
    }
  });
});

describe("the shape of the observer role", () => {
  it("an observer holds no write action at all", async () => {
    for (const action of WRITE_ACTIONS) {
      expect(await ask("u-observer", action).then((d) => d.allowed), action).toBe(false);
    }
  });

  it("observer read access is NARROWER than read-only -- no raw transcript, no private chat", async () => {
    // "Read-only" and "may read everything" are different claims. Conflating them is how a
    // read-only role ends up holding the most sensitive material in the room.
    expect((await ask("u-observer", "read.rawTranscript")).allowed).toBe(false);
    expect((await ask("u-observer", "read.privateChat")).allowed).toBe(false);
    expect((await ask("u-observer", "read.ownGroup")).allowed).toBe(false);
    expect((await ask("u-observer", "read.published")).allowed).toBe(true);
  });
});

describe("the role hierarchy is real, not decorative", () => {
  const grants = (r: (typeof PROJECT_ROLES)[number]) => new Set<ProjectAction>(PROJECT_ROLE_MATRIX[r]);

  it("a member cannot submit their group's output or confirm its nodes", async () => {
    expect((await ask("u-member", "group.submitOutput")).allowed).toBe(false);
    expect((await ask("u-member", "group.confirmNode")).allowed).toBe(false);
  });

  it("a group lead cannot control the room", async () => {
    for (const a of PROJECT_ACTIONS.filter((x) => x.startsWith("stage."))) {
      expect((await ask("u-groupLead", a)).allowed, a).toBe(false);
    }
  });

  it("each step up is a strict superset: observer < member < groupLead < facilitator", () => {
    const chain = ["observer", "member", "groupLead", "facilitator"] as const;
    for (let i = 0; i + 1 < chain.length; i++) {
      const lower = grants(chain[i]!);
      const upper = grants(chain[i + 1]!);
      const lost = [...lower].filter((a) => !upper.has(a));
      // A role losing something its junior had is almost always a transcription slip, and
      // it is invisible unless you check for it explicitly.
      expect(lost, `${chain[i + 1]} lost ${lost.join(",")} that ${chain[i]} has`).toEqual([]);
      expect(upper.size, `${chain[i + 1]} adds nothing over ${chain[i]}`).toBeGreaterThan(lower.size);
    }
  });
});

describe("the matrix has exactly one home", () => {
  it("no copy of it exists in the frontend", () => {
    // When the UI needs this, it must MOVE to packages/contracts, never be copied. A
    // permission matrix drifting between UI and server does not fail loudly: the UI offers
    // a button the server rejects, or hides one the server would have allowed.
    const webDir = fileURLToPath(new URL("../../../web", import.meta.url));
    if (!existsSync(webDir)) return;
    const files: string[] = [];
    const walk = (d: string): void => {
      for (const n of readdirSync(d)) {
        if (n === "node_modules" || n.startsWith(".")) continue;
        const p = join(d, n);
        statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(n) && files.push(p);
      }
    };
    walk(webDir);
    const offenders = files.filter((f) => {
      const body = readFileSync(f, "utf8");
      return /PROJECT_ROLE_MATRIX|\bstage\.bulkConfirm\b|\bgroup\.confirmNode\b/.test(body);
    });
    expect(offenders, `frontend copy of the role matrix:\n${offenders.join("\n")}`).toEqual([]);
  });
});
