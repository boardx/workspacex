/**
 * F31's core invariant: **可见集合 ≡ 检索可见集合**.
 *
 * The set of artifacts the list endpoint returns and the set search can reach are the SAME
 * set, for every requester. Not "kept in sync" -- the same, because both readers select FROM
 * `wsx_visible_artifacts()` and there is nowhere else for a divergence to live.
 *
 * ## Both directions, named separately
 *
 * A set comparison written as one `toEqual` tells you "they differ" and nothing else. The two
 * directions are two different defects with two different causes:
 *
 *   list \ search  the browser shows a file the assistant can never cite -> the user asks
 *                  "why does the AI say it has no data on this" and nobody can answer.
 *   search \ list  retrieval reaches a file the browser hides -> a permission leak, and the
 *                  only surface it appears on is a model's answer.
 *
 * So each direction gets its own assertion and its own message.
 *
 * ## The anti-vacuity proof
 *
 * A test that compares two queries which happen to be identical proves nothing. The last
 * describe block runs a ROGUE search -- the same FTS query with the visibility join removed,
 * i.e. exactly what a second reader written in six months would look like -- and requires the
 * comparison to FAIL for it. Without that, this file would stay green even if
 * `wsx_visible_artifacts` were deleted from the search path.
 */
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import {
  addBinding, addOrgMember, addProjectMember, ensureDatabase, migrateOnce, resetOrgs, seedOrg,
} from "../support/db";
import { addBrowserArtifact } from "../support/files-db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgArtifactBrowserRepository } from "../../src/infrastructure/files/pg-artifact-browser-repository";
import { ObjectStoreHeadProbe } from "../../src/infrastructure/files/object-store-head-probe";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import {
  FilesReadDeniedError, listProjectArtifacts, searchArtifacts, type BrowseDeps,
} from "../../src/application/files/browse-artifacts";
import { toOrgId } from "../../src/domain/org-id";
import type { ObjectStore } from "../../src/application/artifact/ports";

const ORG = "org-f31-equiv";
const PROJECT = "proj-f31-equiv";

/** A token every seeded artifact's indexed text contains -- so "search everything" is expressible. */
const CORPUS_TOKEN = "corpustoken";

class SeqIds {
  private n = 0;
  next(): string { return `d-${++this.n}`; }
}
const STORE_UP: ObjectStore = {
  async putOnce() {}, async get() { return null; }, async head() { return null; },
};

let db: PgDatabase;
let deps: BrowseDeps;
let teams: Record<string, string>;

/**
 * The four project roles, plus the two org-team memberships that make scope matter.
 *
 * `observer` is included even though it is refused: "the two sets are equal" has to hold for
 * the empty case too, and the refusal is exactly where an implementation is most likely to
 * make one path throw and the other return `[]`.
 */
const REQUESTERS = ["u-fac-energy", "u-lead-energy", "u-member-platform", "u-observer-platform"] as const;

const listIds = async (userId: string): Promise<string[] | "denied"> => {
  try {
    const r = await listProjectArtifacts(deps, {
      userId, orgId: toOrgId(ORG), projectId: PROJECT, filters: null, cursor: null, pageSize: null,
    });
    return r.nodes.map((n) => n.artifactId).sort();
  } catch (e) {
    if (e instanceof FilesReadDeniedError) return "denied";
    throw e;
  }
};

const searchIds = async (userId: string): Promise<string[] | "denied"> => {
  try {
    const r = await searchArtifacts(deps, {
      userId, orgId: toOrgId(ORG), projectId: PROJECT, q: CORPUS_TOKEN,
    });
    return r.hits.map((h) => h.node.artifactId).sort();
  } catch (e) {
    if (e instanceof FilesReadDeniedError) return "denied";
    throw e;
  }
};

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  await resetOrgs(ORG);

  const fixture = await seedOrg({ orgId: ORG, projectId: PROJECT, teamNames: ["energy", "platform"] });
  teams = fixture.teams;

  await addOrgMember(ORG, "u-fac-energy", "consultant", teams.energy!);
  await addOrgMember(ORG, "u-lead-energy", "consultant", teams.energy!);
  await addOrgMember(ORG, "u-member-platform", "consultant", teams.platform!);
  await addOrgMember(ORG, "u-observer-platform", "consultant", teams.platform!);
  await addProjectMember(ORG, PROJECT, "u-fac-energy", "facilitator", null, true);
  await addProjectMember(ORG, PROJECT, "u-lead-energy", "groupLead", null);
  await addProjectMember(ORG, PROJECT, "u-member-platform", "member", null);
  await addProjectMember(ORG, PROJECT, "u-observer-platform", "observer", null);

  // Every artifact carries the same token, so the query "everything" is a real query rather
  // than a per-artifact special case.
  const text = `${CORPUS_TOKEN} shared body text`;
  for (const id of ["e-open", "e-energy", "e-platform", "e-both-teams"]) {
    await addBrowserArtifact({ orgId: ORG, id, projectId: PROJECT, title: `${id} document`, text });
  }
  const teamOnly = (objectId: string, team: string) =>
    addBinding({
      orgId: ORG,
      subject: { kind: "team", id: teams[team]! },
      object: { kind: "artifact", id: objectId },
      scope: "team-only",
      ownerTeamId: teams[team]!,
    });
  await teamOnly("e-energy", "energy");
  await teamOnly("e-platform", "platform");
  await teamOnly("e-both-teams", "energy");
  await teamOnly("e-both-teams", "platform");

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
  await resetOrgs(ORG);
});

describe("V1: the two sets are equal, for every role in the matrix", () => {
  it("list \\ search is empty -- nothing is browsable that retrieval cannot reach", async () => {
    for (const user of REQUESTERS) {
      const [l, s] = await Promise.all([listIds(user), searchIds(user)]);
      if (l === "denied" || s === "denied") {
        expect(l, `${user}: one path denied and the other did not`).toBe(s);
        continue;
      }
      const only = l.filter((id) => !s.includes(id));
      expect(only, `${user}: browsable but not retrievable -- the assistant will deny knowing these`).toEqual([]);
    }
  });

  it("search \\ list is empty -- retrieval reaches nothing the browser hides", async () => {
    for (const user of REQUESTERS) {
      const [l, s] = await Promise.all([listIds(user), searchIds(user)]);
      if (l === "denied" || s === "denied") {
        expect(s, `${user}: one path denied and the other did not`).toBe(l);
        continue;
      }
      const only = s.filter((id) => !l.includes(id));
      expect(only, `${user}: retrievable but not browsable -- this is a leak with no UI surface`).toEqual([]);
    }
  });

  it("is not vacuous: the sets are non-empty and DIFFER between requesters", async () => {
    const energy = await listIds("u-fac-energy");
    const platform = await listIds("u-member-platform");
    expect(energy).toEqual(["e-energy", "e-open"]);
    expect(platform).toEqual(["e-open", "e-platform"]);
    // Two equal empty sets satisfy both directions above. This is what stops that reading.
    expect(energy).not.toEqual(platform);
  });

  it("the two-team artifact is in NEITHER set, for anybody", async () => {
    for (const user of REQUESTERS) {
      const [l, s] = await Promise.all([listIds(user), searchIds(user)]);
      if (l !== "denied") expect(l, user).not.toContain("e-both-teams");
      if (s !== "denied") expect(s, user).not.toContain("e-both-teams");
    }
  });
});

/**
 * COUNTER-PROOF. The comparison above must be able to fail.
 *
 * `rogueSearch` is the same full-text query with the `wsx_visible_artifacts` join removed --
 * a plausible second reader, and the exact drift F31 exists to prevent. If the equality
 * assertions were structurally incapable of noticing (because both sides came from one call,
 * or because the application filtered afterwards anyway), this block would be green and
 * everything above would be theatre.
 */
describe("COUNTER-PROOF: a search that bypasses the predicate breaks the equality", () => {
  const rogueSearch = async (): Promise<string[]> =>
    db.withTenant(toOrgId(ORG), async (s) => {
      const r = await s.query<{ id: string }>(
        `SELECT DISTINCT a.id
           FROM artifacts a
           LEFT JOIN segment_text st ON st.artifact_id = a.id AND st.org_id = a.org_id
          WHERE a.org_id = $1 AND a.project_id = $2
            AND (st.tsv @@ wsx_tsquery($3) OR a.title ILIKE '%' || $3 || '%')
          ORDER BY a.id`,
        [ORG, PROJECT, CORPUS_TOKEN],
      );
      return r.rows.map((x) => x.id);
    });

  it("the rogue reader returns rows the platform member's list does not -- and that is a red", async () => {
    const list = await listIds("u-member-platform");
    expect(list).not.toBe("denied");
    const rogue = await rogueSearch();

    const extra = rogue.filter((id) => !(list as string[]).includes(id));
    // Named explicitly rather than as `.length > 0`: the point is WHICH rows escape.
    expect(extra.sort()).toEqual(["e-both-teams", "e-energy"]);

    // And stated as the assertion the suite above uses, so the shape of the failure is the
    // shape of the real one: `search \ list` would be non-empty.
    expect(
      () => expect(extra, "search \\ list").toEqual([]),
      "the equality assertion cannot fail -- the whole file is a no-op",
    ).toThrow();
  });

  it("...while the real search returns exactly the list", async () => {
    const l = await listIds("u-member-platform");
    const s = await searchIds("u-member-platform");
    expect(s).toEqual(l);
    // ...and it is strictly smaller than the rogue one, i.e. the predicate removed something.
    expect((s as string[]).length).toBeLessThan((await rogueSearch()).length);
  });
});
