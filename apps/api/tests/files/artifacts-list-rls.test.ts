/**
 * F31 -- the visibility filter runs in SQL, and every part of that claim is proved by
 * breaking it.
 *
 * ## What this file has to establish
 *
 *   1. the per-row predicate is IN THE DATABASE (`wsx_visible_artifacts`, migration 0018),
 *   2. it is load-bearing -- neutering it makes a forbidden row appear IN THE RESPONSE PAYLOAD,
 *   3. RLS is load-bearing -- widening the tenant policy makes another tenant's rows appear,
 *   4. the function cannot escape RLS (`SECURITY INVOKER`, asserted from pg_catalog),
 *   5. the SQL scope rule and `decide()` agree over the whole matrix -- the one fact that
 *      unavoidably exists in two languages is the one fact with a differential gate on it.
 *
 * ## Why the assertions are about the PAYLOAD, not about a repository return value
 *
 * "无权见到的不出现、不占位、不显示「已隐藏 N 项」" is a statement about what leaves the
 * server. So the denial assertions are `JSON.stringify(response)` searches for the forbidden
 * id AND title: a row that survived into a `hidden` counter, a placeholder, or any nested
 * field would be caught, and a filter that merely stops the frontend rendering would not.
 *
 * ## ⚠ Why the application layer must NOT filter, and how this file would notice if it did
 *
 * `browse-artifacts.ts` unwraps rows with `discloseDecided` and the REQUESTER-level decision;
 * it never re-judges per row. If it did, "the counter-proof" below could not go red -- the
 * application would silently redo the work the neutered SQL stopped doing, and the whole file
 * would be theatre. That is the failure mode this repository has hit nine times, so the
 * counter-proof is not optional decoration here; it is the only thing separating this suite
 * from a green no-op.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { files as C } from "@repo/contracts";
import { asApp, asOwner, addBinding, addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { addBrowserArtifact } from "../support/files-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgArtifactBrowserRepository } from "../../src/infrastructure/files/pg-artifact-browser-repository";
import { ObjectStoreHeadProbe } from "../../src/infrastructure/files/object-store-head-probe";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import {
  FilesReadDeniedError,
  listProjectArtifacts,
  type BrowseDeps,
} from "../../src/application/files/browse-artifacts";
import { decide, UNSATISFIABLE_TEAM } from "../../src/domain/identity/permission-decision";
import { toOrgId } from "../../src/domain/org-id";
import type { ObjectStore } from "../../src/application/artifact/ports";

const ORG = "org-f31-rls";
const OTHER = "org-f31-rls-other";
const PROJECT = "proj-f31-rls";
const OTHER_PROJECT = "proj-f31-rls-other";

/** Deterministic ids, so a failure names the decision rather than a uuid. */
class SeqIds {
  private n = 0;
  next(): string { return `d-${++this.n}`; }
}

/** A store that is always reachable. `downloadAvailable` is not what this file is about. */
const STORE_UP: ObjectStore = {
  async putOnce() { /* unused */ },
  async get() { return null; },
  async head() { return null; },
};

let db: PgDatabase;
let deps: BrowseDeps;
let teams: Record<string, string>;

const list = (userId: string, projectId = PROJECT) =>
  listProjectArtifacts(deps, {
    userId, orgId: toOrgId(ORG), projectId, filters: null, cursor: null, pageSize: null,
  });

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG, OTHER);

  const fixture = await seedOrg({ orgId: ORG, projectId: PROJECT, teamNames: ["energy", "platform"] });
  teams = fixture.teams;
  await asApp(ORG, (c) =>
    c.query("INSERT INTO projects (id, org_id, name) VALUES ($1,$2,$3)", [OTHER_PROJECT, ORG, "other"]),
  );

  // Four project roles + one org member with no project role. The matrix F31 names.
  await addOrgMember(ORG, "u-fac", "consultant", teams.energy!);
  await addOrgMember(ORG, "u-lead", "consultant", teams.energy!);
  await addOrgMember(ORG, "u-member", "consultant", teams.platform!);
  await addOrgMember(ORG, "u-observer", "consultant", teams.platform!);
  await addOrgMember(ORG, "u-stranger", "consultant", teams.energy!);
  await addProjectMember(ORG, PROJECT, "u-fac", "facilitator", null, true);
  await addProjectMember(ORG, PROJECT, "u-lead", "groupLead", null);
  await addProjectMember(ORG, PROJECT, "u-member", "member", null);
  await addProjectMember(ORG, PROJECT, "u-observer", "observer", null);

  await addBrowserArtifact({ orgId: ORG, id: "a-open", projectId: PROJECT, title: "open notes" });
  await addBrowserArtifact({ orgId: ORG, id: "a-energy", projectId: PROJECT, title: "energy only briefing" });
  await addBrowserArtifact({ orgId: ORG, id: "a-platform", projectId: PROJECT, title: "platform only briefing" });
  await addBrowserArtifact({ orgId: ORG, id: "a-multi", projectId: PROJECT, title: "claimed by two teams" });
  await addBrowserArtifact({ orgId: ORG, id: "a-elsewhere", projectId: OTHER_PROJECT, title: "different project" });

  const teamOnly = (objectId: string, team: string) =>
    addBinding({
      orgId: ORG,
      subject: { kind: "team", id: teams[team]! },
      object: { kind: "artifact", id: objectId },
      scope: "team-only",
      ownerTeamId: teams[team]!,
    });
  await teamOnly("a-energy", "energy");
  await teamOnly("a-platform", "platform");
  // TWO owning teams -> `strictestScope` says nobody. The interesting row: it is the one an
  // implementation that takes the UNION of bindings would show to both teams.
  await teamOnly("a-multi", "energy");
  await teamOnly("a-multi", "platform");

  // Another tenant, same shaped data. Nothing may ever cross.
  await seedOrg({ orgId: OTHER, projectId: PROJECT + "-x", teamNames: ["energy"] });
  await addBrowserArtifact({ orgId: OTHER, id: "a-other-tenant", projectId: PROJECT + "-x", title: "other tenant secret" });

  db = new PgDatabase(appConfig());
  deps = {
    repo: new PgIdentityRepository(db),
    ids: new SeqIds(),
    browser: new PgArtifactBrowserRepository(db),
    objectStore: new ObjectStoreHeadProbe(STORE_UP),
  };
});

afterAll(async () => {
  await db?.close();
  await resetOrgs(ORG, OTHER);
});

describe("the visible set, per role", () => {
  it("a facilitator on the energy team sees org-wide + energy-only, and NOT platform-only", async () => {
    const r = await list("u-fac");
    expect(r.nodes.map((n) => n.artifactId).sort()).toEqual(["a-energy", "a-open"]);
  });

  it("a member on the platform team sees org-wide + platform-only", async () => {
    const r = await list("u-member");
    expect(r.nodes.map((n) => n.artifactId).sort()).toEqual(["a-open", "a-platform"]);
  });

  it("an artifact claimed by TWO owning teams is visible to NEITHER (strictest, not union)", async () => {
    for (const user of ["u-fac", "u-lead", "u-member"]) {
      const r = await list(user);
      expect(r.nodes.map((n) => n.artifactId), user).not.toContain("a-multi");
    }
  });

  it("an observer is refused outright -- their only read surface is read.published", async () => {
    // ⚠ NOT a ruling on `files.KNOWN_CONTRACT_GAPS.FS3` (T-6, unruled). This is the
    // fail-closed branch; when T-6 lands this expectation is the thing that must be revisited.
    await expect(list("u-observer")).rejects.toBeInstanceOf(FilesReadDeniedError);
  });

  it("an org member with no project role is refused, and cannot tell that from 'no such project'", async () => {
    const denied = await list("u-stranger").catch((e: unknown) => e);
    const missing = await list("u-fac", "proj-does-not-exist").catch((e: unknown) => e);
    expect(denied).toBeInstanceOf(FilesReadDeniedError);
    expect(missing).toBeInstanceOf(FilesReadDeniedError);
    expect((denied as FilesReadDeniedError).reasonCode).toBe((missing as FilesReadDeniedError).reasonCode);
  });
});

describe("the response PAYLOAD carries no trace of what was filtered out", () => {
  it("no id, no title, no count, no placeholder -- for the artifact, the project and the tenant", async () => {
    const r = await list("u-member");
    const payload = JSON.stringify(r);
    for (const leak of [
      "a-energy", "energy only briefing",           // another team's artifact
      "a-multi", "claimed by two teams",            // the unsatisfiable one
      "a-elsewhere", "different project",           // another project
      "a-other-tenant", "other tenant secret",      // another tenant
    ]) {
      expect(payload, `"${leak}" reached the response body`).not.toContain(leak);
    }
    // 「已隐藏 N 项」 is itself a leak: the count tells the requester how much exists.
    expect(payload).not.toMatch(/hidden|已隐藏|redacted|withheld/i);
    // ...and the response must not carry a total that would reveal it either.
    expect(Object.keys(r).sort()).toEqual(["cursor", "downloadAvailable", "nodes", "sourceCounts"]);
  });

  it("the body conforms to the contract, and the contract really rejects drift", async () => {
    const r = await list("u-fac");
    const parsed = C.operations.listProjectArtifacts.out.safeParse(r);
    expect(parsed.success ? null : parsed.error.issues, JSON.stringify(r)).toBeNull();

    // Reverse assertion: without it, a schema that accepted anything would make the line
    // above pass for a body that is completely wrong.
    expect(
      C.operations.listProjectArtifacts.out.safeParse({ ...r, hiddenCount: 3 }).success,
      "the out schema is not strict -- an extra field would ship unnoticed",
    ).toBe(false);
  });
});

describe("the predicate is in the database, and it is load-bearing", () => {
  it("wsx_visible_artifacts is SECURITY INVOKER -- a DEFINER would run as owner and skip RLS", async () => {
    const row = await asOwner(async (c) =>
      (await c.query<{ prosecdef: boolean; prosrc: string }>(
        "SELECT prosecdef, prosrc FROM pg_proc WHERE proname = 'wsx_visible_artifacts'",
      )).rows[0]!,
    );
    expect(row.prosecdef, "SECURITY DEFINER runs as the table owner, which bypasses RLS").toBe(false);

    // The sentinel exists in TypeScript and in SQL. Two copies of one literal is this
    // repository's most frequent defect, so the copy is checked rather than commented.
    expect(row.prosrc).toContain(UNSATISFIABLE_TEAM);
  });

  /**
   * Break it for real, then roll back.
   *
   * DDL is transactional in PostgreSQL, so the damage is visible to THIS transaction and to
   * nothing else -- other test files running against the same database never see it. Doing it
   * as a committed change plus cleanup would be a race, and the symptom of losing that race is
   * another file's isolation assertion failing for no reason.
   *
   * ⚠ The queries below run on the broken transaction's own client, because that is the only
   * place the damage exists. They are the production shape (`wsx_visible_artifacts` is what
   * `pg-artifact-browser-repository.ts` selects FROM), which is what makes the red meaningful.
   */
  /**
   * ## ⚠ And why it drops to `app_rw` before asserting anything
   *
   * The migration identity is `postgres`, a SUPERUSER (migration 0001 / `pg-config.ts`), and a
   * superuser bypasses row-level security **even on a FORCEd table**. The first version of the
   * two RLS counter-proofs below ran their queries as the owner, and they "passed": the
   * widened-policy case leaked, and the intact-policy case leaked too -- i.e. the assertion was
   * measuring nothing. That is this repository's recurring failure shape, found here by writing
   * the negative case rather than only the positive one.
   *
   * `SET LOCAL ROLE app_rw` is the fix: the DDL runs as the owner, the READ runs as the runtime
   * identity, both inside the transaction that gets rolled back. Order matters -- after the
   * role switch no further DDL is possible, which is itself the property being relied on.
   */
  const withBroken = async <T>(ddl: readonly string[], fn: (c: import("pg").Client) => Promise<T>): Promise<T> =>
    asOwner(async (c) => {
      await c.query("BEGIN");
      try {
        for (const s of ddl) await c.query(s);
        await c.query("SELECT set_config('app.current_org', $1, true)", [ORG]);
        await c.query("SET LOCAL ROLE app_rw");
        return await fn(c);
      } finally {
        await c.query("ROLLBACK");
      }
    });

  const visibleIds = async (c: import("pg").Client, team: string | null): Promise<string[]> => {
    const r = await c.query<{ artifact_id: string }>(
      "SELECT artifact_id FROM wsx_visible_artifacts($1, $2) ORDER BY artifact_id",
      [PROJECT, team],
    );
    return r.rows.map((x) => x.artifact_id);
  };

  it("baseline: the real function excludes the other team's artifact", async () => {
    await withBroken([], async (c) => {
      expect(await visibleIds(c, teams.platform!)).toEqual(["a-open", "a-platform"]);
    });
  });

  it("COUNTER-PROOF: neuter the predicate and the forbidden row appears", async () => {
    const ids = await withBroken(
      [
        `CREATE OR REPLACE FUNCTION wsx_visible_artifacts(p_project_id text, p_requester_team_id text)
         RETURNS TABLE (artifact_id text, scope text, owner_team_id text)
         LANGUAGE sql STABLE AS $f$
           SELECT a.id, 'org-wide', NULL::text FROM artifacts a WHERE a.project_id = p_project_id
         $f$`,
      ],
      (c) => visibleIds(c, teams.platform!),
    );
    // Red-on-purpose direction: with the predicate gone, a platform user reaches the energy
    // team's briefing AND the two-team artifact. If this list did not change, the predicate
    // was never doing anything and every assertion above was vacuous.
    expect(ids).toContain("a-energy");
    expect(ids).toContain("a-multi");
  });

  it("COUNTER-PROOF: widen the tenant policy and another tenant's artifact appears", async () => {
    const ids = await withBroken(
      [
        "DROP POLICY IF EXISTS artifacts_tenant ON artifacts",
        "CREATE POLICY artifacts_tenant ON artifacts USING (true) WITH CHECK (true)",
        // The other tenant's project id differs, so ask for THAT project while scoped to ORG.
      ],
      async (c) => {
        const r = await c.query<{ artifact_id: string }>(
          "SELECT artifact_id FROM wsx_visible_artifacts($1, NULL) ORDER BY artifact_id",
          [PROJECT + "-x"],
        );
        return r.rows.map((x) => x.artifact_id);
      },
    );
    expect(ids, "RLS is what keeps tenants apart here -- with it widened, it must leak").toContain("a-other-tenant");
  });

  it("...and with RLS intact, that same query sees nothing", async () => {
    await withBroken([], async (c) => {
      const r = await c.query<{ artifact_id: string }>(
        "SELECT artifact_id FROM wsx_visible_artifacts($1, NULL)",
        [PROJECT + "-x"],
      );
      expect(r.rows).toEqual([]);
    });
  });
});

/**
 * The one fact that unavoidably lives in two languages.
 *
 * The SQL function decides `org-wide OR requester team = owning team`; `decide()` decides the
 * same thing as `scopeLayer.passed`. Neither can import the other. So instead of trusting a
 * comment, the whole matrix is driven through both and required to agree -- which is what
 * turns "we wrote it the same way" into something that fails when it stops being true.
 */
describe("differential: the SQL scope rule and decide() agree over the whole matrix", () => {
  const SCOPES = ["org-wide", "team-only"] as const;
  const TEAMS = [null, "t-a", "t-b", UNSATISFIABLE_TEAM] as const;

  it("every (scope x owning team x requester team) cell matches", async () => {
    const cells: { cell: string; sql: boolean; ts: boolean }[] = [];
    await asOwner(async (c) => {
      for (const scope of SCOPES) {
        for (const owner of TEAMS) {
          for (const requester of TEAMS) {
            // The SQL predicate, lifted verbatim out of `wsx_visible_artifacts`'s WHERE.
            // `IS TRUE` is not a convenience: the raw expression yields NULL when the owning
            // team is NULL (three-valued logic), and `decide()` yields `false`. They agree
            // only because a WHERE clause treats NULL as "do not return the row" -- so the
            // comparison has to be made in the same terms the function uses it in. Written
            // without it, this cell reported `null !== false` and the differential went red,
            // which is how the distinction was noticed rather than assumed.
            const r = await c.query<{ ok: boolean }>(
              `SELECT ($1 = 'org-wide' OR ($3::text IS NOT NULL AND $3 = $2::text)) IS TRUE AS ok`,
              [scope, owner, requester],
            );
            const ts = decide({
              decisionId: "d",
              action: "read.allHands",
              org: { role: "consultant", teamId: requester },
              project: null,
              scope: { scope, ownerTeamId: owner },
            }).scopeLayer.passed;
            cells.push({ cell: `${scope}/own=${owner}/req=${requester}`, sql: r.rows[0]!.ok, ts });
          }
        }
      }
    });
    expect(cells.filter((x) => x.sql !== x.ts)).toEqual([]);
    // Non-vacuity: an all-true or all-false matrix would "agree" and mean nothing.
    expect(cells.some((x) => x.sql)).toBe(true);
    expect(cells.some((x) => !x.sql)).toBe(true);
  });
});
