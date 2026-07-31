/**
 * F02 -- UC-0.3 R12 V10: permission travels along the data path, all six routes.
 *
 * ## Read this before reading the assertions
 *
 * V10 names six routes to the same content: retrieval, Context Pack, embedding similarity,
 * graph traversal, file browser, cache. **Five of those subsystems do not exist yet.**
 * They arrive with F09 (Context Pack), F10 (retrieval + pgvector), F04 (the artifact
 * tables everything derives from) and phase-01 (09-kg, 22-files). Only the cache is live
 * today, because F01 shipped `AuthorizationCache`.
 *
 * So this file does NOT claim "six running subsystems were tested and denied". It claims,
 * precisely:
 *
 *   1. All six paths resolve through ONE decision -- the same `decide()` F01 wrote. That
 *      is the whole ruling of coherence X-1, and it is asserted by driving each of the six
 *      path ids through `disclose()` against the same team-only object and requiring
 *      identical verdicts. If a later feature forks its own filter, the fork will not be
 *      in `PROPAGATION_PATHS` and `disclose` will refuse it.
 *   2. Derived content takes the STRICTEST of its sources (I-7 / artifact I-13), so a
 *      summary cannot launder a team-only original into an org-wide answer.
 *   3. Content cannot physically leave a repository without a decision: the payload lives
 *      in a module-private WeakMap and `lint-permission-paths.mjs` blocks the other route.
 *
 * What is NOT proven, stated plainly rather than left to be discovered: no real retrieval
 * query, no real pgvector recall, no real graph walk and no real file listing has been
 * exercised, because none exists. Each of those features must add its own end-to-end V10
 * assertion; what F02 guarantees is that it cannot build one that skips the decision.
 *
 * ## The scenario
 *
 * An artifact visible only to the energy team, plus the derived objects each path would
 * hand back. `u-platform` is a full member of the organization in a different team --
 * which is the interesting case, because org membership alone is not the question.
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  addArtifact,
  addBinding,
  addOrgMember,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import {
  CountingDecisionIdFactory,
  InMemoryAuthorizationCache,
} from "../../src/infrastructure/identity/in-memory-session-store";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PROPAGATION_PATHS, type PropagationPathId } from "../../src/domain/identity/propagation-paths";
import { UNSATISFIABLE_TEAM } from "../../src/domain/identity/permission-decision";
import { decisionCacheKey, disclose, guard } from "../../src/application/security/permission-filter";

const ORG = "org-f02-prop";
const PROJECT = "proj-f02-prop";
const ARTIFACT = { kind: "artifact", id: "art-energy-only" } as const;
const SECRET = "the-team-only-content";

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
  await resetOrgs(ORG);
  fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, "u-energy", "consultant", fx.teams.energy!);
  await addOrgMember(ORG, "u-platform", "consultant", fx.teams.platform!);
  // Real `artifacts` rows since F04: 0006 closed the trigger gap 0003 declared, so a
  // binding can no longer name an object that does not exist.
  for (const id of [ARTIFACT.id, "art-org-wide", "art-platform-only"]) {
    await addArtifact({ orgId: ORG, id, projectId: PROJECT });
  }
  // The original: visible to the energy team only.
  await addBinding({
    orgId: ORG,
    subject: { kind: "team", id: fx.teams.energy! },
    object: ARTIFACT,
    scope: "team-only",
    ownerTeamId: fx.teams.energy!,
  });
});

/**
 * What each path would hand back. All of them are DERIVED from the same artifact, which is
 * the point of R7: the derivative must not be looser than the original.
 */
const derivedFor = (path: string) =>
  guard({ kind: "segment", id: `seg-via-${path}` }, SECRET, [ARTIFACT]);

const call = (userId: string, path: PropagationPathId) =>
  disclose(deps, {
    userId,
    orgId: toOrgId(ORG),
    action: "read.artifact",
    // No projectId: this is an ORG-layer visibility question (team scope), and adding a
    // project context would let a project-role failure mask the scope failure being tested.
    path,
    items: [derivedFor(path)],
  });

describe("the registry is the coverage claim, so it is asserted first", () => {
  it("names exactly the six paths UC-0.3 R12 V10 lists", () => {
    expect(PROPAGATION_PATHS.map((p) => p.id).sort()).toEqual([
      "cache",
      "context-pack",
      "embedding-similarity",
      "file-browser",
      "graph-traversal",
      "retrieval",
    ]);
    // The UC is written in Chinese; the ids are not. Keeping the original wording on each
    // entry is what makes the mapping back to the spec checkable rather than a claim.
    expect(PROPAGATION_PATHS.map((p) => p.ucTerm)).toEqual([
      "检索", "Context Pack", "embedding 相似度", "图节点遍历", "文件浏览器", "缓存命中",
    ]);
  });

  it("every path that is not live names who builds it -- 'later' has to have an owner", () => {
    for (const p of PROPAGATION_PATHS) {
      expect(p.owner, `${p.id} has no owner`).toMatch(/F\d\d|phase-\d\d/);
    }
    // Honest today: one live, five mechanism-only. If this number ever changes without the
    // corresponding end-to-end assertion, this test is where it gets noticed.
    expect(PROPAGATION_PATHS.filter((p) => p.status === "live").map((p) => p.id)).toEqual(["cache"]);
  });

  it("a seventh path cannot be invented by writing a seventh module", async () => {
    await expect(
      disclose(deps, {
        userId: "u-platform",
        orgId: toOrgId(ORG),
        action: "read.artifact",
        // Cast required: the union already REJECTS this at compile time, which is the
        // stronger guarantee. The cast forces the runtime guard to be exercised too, for
        // ids that arrive as data rather than as source.
        path: "export-to-slack" as PropagationPathId,
        items: [derivedFor("x")],
      }),
    ).rejects.toThrow(/unknown propagation path/);
  });
});

describe("V10: all six paths deny the same content to the same person", () => {
  for (const path of PROPAGATION_PATHS.map((p) => p.id)) {
    it(`${path}: a non-energy member gets no content`, async () => {
      const r = await call("u-platform", path);
      expect(r.visible).toEqual([]);
      expect(r.withheld).toHaveLength(1);
      // The denial has to say it was an ORG-layer restriction, not a project one -- E3.
      // Otherwise the user goes looking for a project role they already have.
      expect(r.withheld[0]!.reasonCode).toBe("ORG_SCOPE_DENIED");
      // Nothing about the content, in any field, including serialised.
      expect(JSON.stringify(r.withheld)).not.toContain(SECRET);
    });

    it(`${path}: an energy member DOES get it -- propagation, not paralysis`, async () => {
      const r = await call("u-energy", path);
      expect(r.withheld).toEqual([]);
      expect(r.visible.map((v) => v.payload)).toEqual([SECRET]);
      // R10 ④: every disclosed item carries the decision that let it through, so
      // "why was I shown this" is answerable later from the Context Pack alone.
      expect(r.visible[0]!.permissionDecisionId).toMatch(/^d-\d+$/);
    });
  }

  it("the six verdicts are the SAME decision, not six lookalikes (coherence X-1)", async () => {
    // If a path ever grew its own filter, this is what would drift first: same subject,
    // same object, different answer depending on which door you came in.
    const verdicts = await Promise.all(
      PROPAGATION_PATHS.map(async (p) => {
        const r = await call("u-platform", p.id);
        return `${r.visible.length}/${r.withheld[0]?.reasonCode}`;
      }),
    );
    expect(new Set(verdicts).size, `paths disagreed: ${verdicts.join(", ")}`).toBe(1);
  });
});

describe("I-7 / artifact I-13: derived content takes the strictest source", () => {
  beforeEach(async () => {
    await addBinding({
      orgId: ORG,
      subject: { kind: "team", id: fx.teams.platform! },
      object: { kind: "artifact", id: "art-org-wide" },
      scope: "org-wide",
    });
    await addBinding({
      orgId: ORG,
      subject: { kind: "team", id: fx.teams.platform! },
      object: { kind: "artifact", id: "art-platform-only" },
      scope: "team-only",
      ownerTeamId: fx.teams.platform!,
    });
  });

  it("mixing an org-wide source with a team-only source yields team-only, not org-wide", async () => {
    // The laundering case R7 describes: a Context Pack item assembled from a public source
    // and a restricted one. Taking the union -- the intuitive move if you think of
    // permissions as capabilities that accumulate -- publishes the restricted half.
    const item = guard({ kind: "segment", id: "seg-mixed" }, SECRET, [
      { kind: "artifact", id: "art-org-wide" },
      ARTIFACT,
    ]);
    const base = { orgId: toOrgId(ORG), action: "read.artifact", path: "context-pack" as const, items: [item] };
    expect((await disclose(deps, { ...base, userId: "u-platform" })).visible).toEqual([]);
    expect((await disclose(deps, { ...base, userId: "u-energy" })).visible.map((v) => v.payload)).toEqual([SECRET]);
  });

  it("sources owned by two DIFFERENT teams are visible to neither", async () => {
    // No single team satisfies both, so the strictest reading is "nobody". Falling back to
    // either team's scope would hand each team the other's material.
    const item = guard({ kind: "segment", id: "seg-two-teams" }, SECRET, [
      ARTIFACT,
      { kind: "artifact", id: "art-platform-only" },
    ]);
    const base = { orgId: toOrgId(ORG), action: "read.artifact", path: "retrieval" as const, items: [item] };
    for (const u of ["u-energy", "u-platform"]) {
      const r = await disclose(deps, { ...base, userId: u });
      expect(r.visible, `${u} saw a two-team intersection`).toEqual([]);
      expect(r.withheld[0]!.reasonCode).toBe("ORG_SCOPE_DENIED");
    }
    // And the sentinel is not a real team anyone could join.
    expect(UNSATISFIABLE_TEAM).not.toMatch(/^org-/);
  });

  it("an unbound object still defaults to org-wide -- and that is contained by the org layer", async () => {
    // Stated as a test rather than a comment because it is the one place the filter is
    // permissive by default. A non-member gets nothing regardless, which is what makes the
    // default acceptable.
    const item = guard({ kind: "segment", id: "seg-unbound" }, SECRET, []);
    const base = { orgId: toOrgId(ORG), action: "read.artifact", path: "file-browser" as const, items: [item] };
    expect((await disclose(deps, { ...base, userId: "u-platform" })).visible).toHaveLength(1);
    const outsider = await disclose(deps, { ...base, userId: "u-nobody" });
    expect(outsider.visible).toEqual([]);
    expect(outsider.withheld[0]!.reasonCode).toBe("NO_ORG_MEMBERSHIP");
  });
});

describe("the payload cannot leave without a decision", () => {
  it("a guarded item carries no reachable content", () => {
    const g = derivedFor("retrieval");
    // Not a hidden property, not a private field: no property at all. So logging it,
    // spreading it or serialising it -- the three things that happen to objects by
    // accident -- cannot emit the content.
    expect(JSON.stringify(g)).not.toContain(SECRET);
    expect(Object.keys(g)).toEqual(["ref", "sources"]);
    expect(JSON.stringify({ ...g })).not.toContain(SECRET);
  });

  it("a denied item's content is absent from the result, not blanked out", async () => {
    // I-8's shape, applied here: the field must not EXIST. "content: ''" is still a
    // statement about the content, and it is the shape that later gets 'fixed' by filling
    // the field back in.
    const r = await call("u-platform", "retrieval");
    expect(Object.keys(r.withheld[0]!).sort()).toEqual(["permissionDecisionId", "reasonCode", "ref"]);
  });
});

describe("the cache path (the one that is live today)", () => {
  it("the cache key is scoped by organization", () => {
    // Same user, same object, different org. Without orgId in the key, switching orgs
    // serves the previous organization's verdict from memory: no query runs, so no RLS
    // policy is consulted, and nothing anywhere looks wrong (O-12).
    const k = (orgId: string) =>
      decisionCacheKey({ userId: "u", orgId: toOrgId(orgId), path: "retrieval", action: "read.artifact", ref: ARTIFACT });
    expect(k("org-a")).not.toBe(k("org-b"));
    expect(k("org-a").startsWith("u|")).toBe(true); // the cache buckets on the first segment
  });

  it("the key separates paths and actions too", () => {
    const base = { userId: "u", orgId: toOrgId(ORG), ref: ARTIFACT };
    const a = decisionCacheKey({ ...base, path: "retrieval", action: "read.artifact" });
    const b = decisionCacheKey({ ...base, path: "file-browser", action: "read.artifact" });
    const c = decisionCacheKey({ ...base, path: "retrieval", action: "write.artifact" });
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("invalidating a user drops every cached verdict for them and nobody else's", async () => {
    const cache = new InMemoryAuthorizationCache();
    await cache.set(decisionCacheKey({ userId: "u1", orgId: toOrgId(ORG), path: "retrieval", action: "r", ref: ARTIFACT }), true);
    await cache.set(decisionCacheKey({ userId: "u2", orgId: toOrgId(ORG), path: "retrieval", action: "r", ref: ARTIFACT }), true);
    await cache.invalidateUser("u1");
    expect(await cache.size("u1")).toBe(0);
    expect(await cache.size("u2")).toBe(1);
  });
});

/**
 * The filter stops content leaving without a decision. It does not stop a repository
 * ignoring it and returning raw rows -- that is this gate's job, and a gate nobody has
 * watched go red is a gate nobody knows works.
 */
describe("lint-permission-paths: counter-proof", () => {
  const API = fileURLToPath(new URL("../..", import.meta.url));
  const GATE = join(API, "scripts/lint-permission-paths.mjs");
  const run = (...args: string[]): { code: number; out: string } => {
    try {
      return { code: 0, out: execFileSync("node", [GATE, ...args], { cwd: API, encoding: "utf8", stdio: "pipe" }) };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? 1, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
  };

  it("scans the real source tree and derives a real table list (not the exit code)", () => {
    const r = run();
    expect(r.code, r.out).toBe(0);
    expect(Number(/scanned=(\d+)/.exec(r.out)?.[1] ?? -1), "gate scanned nothing").toBeGreaterThan(20);
    // Parsed out of migrations/*.sql. Zero here means the parse silently failed and the
    // gate would pass every file forever.
    expect(Number(/tenant-tables=(\d+)/.exec(r.out)?.[1] ?? -1)).toBeGreaterThanOrEqual(8);
  });

  it("rejects a permission-blind read from outside infrastructure", () => {
    const r = run("apps/api/__fixtures__/permission-bad");
    expect(r.code).toBe(1);
    expect(r.out).toContain("leaky-retrieval.ts");
    expect(r.out).toContain("acl_bindings");
    // Also catches the table reached through a JOIN, which is how the second half of a
    // query gets forgotten about.
    expect(r.out).toContain("projects");
  });

  it("rejects a raw read even when it IS in infrastructure -- the folder is not the rule", () => {
    const r = run("apps/api/__fixtures__/permission-bad");
    expect(r.out).toContain("raw-repo.ts");
    expect(r.out).toContain("does not import application/security/permission-filter");
  });

  it("does NOT over-fire on the correct shape", () => {
    const r = run("apps/api/__fixtures__/permission-good");
    expect(r.code, r.out).toBe(0);
    expect(Number(/scanned=(\d+)/.exec(r.out)?.[1] ?? -1)).toBe(1);
  });

  it("the allowlist stays short, and every entry carries a real argument", () => {
    const r = run();
    // A ceiling alone is a number someone bumps. The property that actually matters is
    // that each exemption was ARGUED -- so the reason strings are checked too, and a
    // one-liner like "legacy" or "TODO" fails.
    //
    // ⚠ Raised 4 -> 5 by F19, and the bump is exactly the act this comment warns about, so
    // here is the argument. The new entry is
    // `infrastructure/auth/pg-registration-repository.ts`: it INSERTs into `organizations`
    // and `org_memberships` while creating an organization that does not exist yet, for an
    // anonymous caller holding an invite code. `Guarded<T>` protects DISCLOSURE, and there
    // is nothing to disclose and nobody to judge -- "may this person read the row they are
    // creating" has no answer.
    //
    // What makes this bump different from a quiet one: the exemption's PREMISE is now
    // enforced, not asserted. `tests/auth/registration-repo-is-write-only.test.ts` parses
    // that file and fails if any statement naming a tenant table is anything but an INSERT,
    // so the day it grows a SELECT the gate goes red. No other entry on the allowlist has
    // that, and a sixth should be expected to bring one.
    //
    // ⚠ Raised 5 -> 6 by F13, and it brings one, as demanded above. The new entry is
    // `infrastructure/context-pack/pg-context-pack-store.ts` (`context_packs`), and its
    // argument is not "the filter was inconvenient" but "the decision the filter attaches is
    // the WRONG decision": re-authorising a frozen run's segments at replay time mints new
    // `permissionDecisionId`s -- so I-11's "follow the id to the judgement that applied" lands
    // on a judgement made today -- and lets a since-revoked permission SHRINK a pinned pack,
    // which is I-7 broken by the mechanism meant to protect it. Same shape as the provenance
    // entry: an audit trail cannot be gated on the answer it exists to supply.
    //
    // Its ENFORCED premise: a run is readable back only by the principal it was assembled
    // FOR, checked in `readRow` and asserted in `context-pack-pinned-replay.test.ts`, which
    // also removes the check to show the assertion is load-bearing.
    //
    // ⚠ Raised 6 -> 7 by F10 (phase-01 / UC-1.6), and it brings an enforced premise, as
    // demanded above. The new entry is `infrastructure/auth/pg-org-invite-repository.ts`.
    // Its argument has the same SHAPE as the identity repository's, not the registration
    // one's: the row it reads from `org_invites` is the AUTHORITY FOR THE GRANT, so gating
    // it on a decision would be circular -- and on this path there is nobody to judge,
    // because the caller is an anonymous visitor holding an activation link who does not yet
    // belong to any organization. "May this person read the row that decides what they are
    // about to be granted" has no answer. Wrapping the read in `guard()` and discarding the
    // wrapper would be a shell built to pass THIS gate, which is worse than an exemption
    // stated in the open.
    //
    // Its ENFORCED premise: the invite row's CONTENT never leaves the repository.
    // `activate()` returns only the grant (userId / orgId / orgRole / teamId /
    // tamperRecorded) -- never `email`, never `invited_by`; the email is used solely as an
    // INSERT parameter for the credential row the activation creates. That is asserted in
    // `tests/auth/member-invite-activation.test.ts`, which also WIDENS the return value to
    // show the assertion is load-bearing. If that test is deleted, the entry goes with it.
    //
    // ⚠ Raised 7 -> 8 by F49 (phase-01 / UC-20.1 R3), and it brings an enforced premise, as
    // demanded above. The new entry is `infrastructure/model/pg-admission-test-repository.ts`
    // (`model_admission_tests`, the five admission verdicts).
    //
    // Its argument has the same shape as `toAclRef`'s three throws, and that is the point:
    // `ObjectRef` is project|artifact|segment|capability|organization|interview, and a MODEL
    // is none of them. A model has no `acl_bindings` row, so a `model` ref pushed through
    // `authorize` would find no binding, fall back to `DEFAULT_SCOPE` (org-wide), see a
    // non-null org role and return `allowed: true` FOR EVERY MEMBER -- with a
    // normal-looking decision and a decisionId to match. That is precisely why `capability`,
    // `organization` and `interview` THROW there rather than being judged. Adding a fourth
    // ref kind to make the lint green would be creating that failure, not avoiding it.
    // Who may read a model's verdicts is an org-admin question -- `recordAdmissionTest` and
    // `enableModel` both carry `NOT_ORG_ADMIN` and nothing finer -- decided one layer up,
    // exactly as the provenance entry describes for its trail.
    //
    // Its ENFORCED premise is deliberately the strongest of the eight, because F49 ships no
    // controller and an exemption resting on "nothing calls it yet" would rot in silence.
    // `tests/capability/model/admission-test-gate.test.ts` asserts (a) every statement in
    // the file names only `model_admission_tests`, (b) it never uses `withoutTenant`,
    // (c) the projection emits no key outside `AdmissionTestRecord ∪ {seq}` and the file
    // mentions nothing credential-shaped, and (d) NOTHING under `src/interface/` reaches
    // it -- so the day a controller is added, (d) goes red and whoever adds it must attach
    // the org-admin decision there rather than inherit an exemption written for a file with
    // no disclosure surface. If that test is deleted, the entry goes with it.
    //
    // ⚠ Raised 8 -> 9 by F117 (phase-01 / UC-P1 `createProject`) — RE-COUNTED after
    // rebasing onto F49, not shifted by one. F117 and F49 were developed in parallel and
    // BOTH raised this line 7 -> 8 against their own tree; both were right and the two do
    // NOT add up. Copying my own 8 forward would leave the cap one slot loose while staying
    // green. The number below is what `lint-permission-paths` printed on the merged tree.
    // The new entry is
    // `infrastructure/project/pg-project-repository.ts`, and its argument has the same
    // SHAPE as the registration one's: the file is a WRITE path (three INSERTs -- the
    // container, its subtype row, and the replay record) plus ONE echo of the caller's own
    // creation request. `disclose()` needs a requester and a decision, and "may this person
    // read the container they are creating right now" has no answer -- worse, per Q-4(2)
    // the creator deliberately holds NO project role over it, so the honest decision would
    // come back NO_PROJECT_ROLE for the row the caller just wrote. Guarding it would mean
    // wrapping and immediately discarding the wrapper, i.e. a shell built to pass THIS gate.
    //
    // Its ENFORCED premise: every tenant-table statement in the file is an INSERT except
    // one SELECT, and that SELECT is scoped `fingerprint = $1 AND actor_id = $2` -- so the
    // only row it can ever read back is the echo of a request the caller themself submitted.
    // That is asserted in `tests/project/create-project-idempotent.test.ts`, which parses
    // the file (failing if a second SELECT appears) and separately shows the actor scoping
    // is load-bearing: a different lead submitting the identical request gets a NEW
    // container, never the first one's. If that test is deleted, the entry goes with it.
    //
    // ⚠ Raised 9 -> 10 by F122 (phase-01 / UC-P2 `listProjects`), and it brings an enforced
    // premise, as demanded above. The new entry is
    // `infrastructure/project/pg-project-list-repository.ts` -- a SEPARATE file from F117's
    // `pg-project-repository.ts` on purpose: that file's existing entry is pinned to "one
    // write path plus one echo SELECT" and a test asserts exactly that shape, so bolting the
    // two-segment list query onto it would have broken that assertion's premise rather than
    // satisfied it (fixing the test to fit new code, not the other way around).
    //
    // Its argument is the SAME SHAPE as the identity repository's entry, not the
    // registration one's: `listProjects`'s two segments are judged by
    // `project_memberships` (member) and `org_memberships.org_role` (managed) -- the
    // IDENTITY DATA a decision would be made FROM, not `acl_bindings`. Pushing a `project`
    // ref through `authorize()` for a listing whose whole point is "which containers does
    // this membership/role make visible" asks the wrong question, in the same way `model`,
    // `capability`, `organization` and `interview` all throw in `toAclRef` rather than being
    // judged through a binding they do not have. D-18 already draws the line this file stays
    // on: appearing in `managed` is NOT content read access.
    //
    // Its ENFORCED premise: `tests/project/list-projects-repo-shape.test.ts` parses the file
    // and asserts (a) it contains no INSERT/UPDATE/DELETE -- pure read, (b) every row it
    // returns has EXACTLY the five keys `id/name/kind/status/orgStatus` -- no content, no
    // summary, no count could be smuggled in as a sixth key, and (c) it names only the three
    // tables the argument above claims (`project_memberships` / `projects` /
    // `organizations`). If that test is deleted, this entry must go with it.
    //
    // ⚠ Raised 10 -> 12 by F11 (phase-01 / UC-1.6 R10 org-admin bundle), merged on top of
    // F122's raise above -- RE-MEASURED on the combined tree via
    // `node scripts/lint-permission-paths.mjs` (12), not computed as "10 + 2". The two new
    // entries are `infrastructure/auth/pg-team-repository.ts` (MutateTeam's occupancy check
    // -- same shape as the identity-repository exemption: the thing consulted to decide
    // whether a delete is ALLOWED cannot itself be gated by that decision, plus one
    // write-echo of the team the actor is creating/renaming/deleting) and
    // `infrastructure/auth/pg-org-member-repository.ts` (RemoveOrgMember -- same shape as
    // the org-invite-repository entry: DELETE/UPDATE against the actor's own organization,
    // returning only counts, never a row's content). Both entries' enforced premises are
    // asserted in `tests/auth/team-crud-occupancy-check.test.ts` and
    // `tests/auth/member-removal-preserves-attribution.test.ts` respectively.
    //
    // ⚠ Raised 12 -> 13 by F115 (chat preset dispatch), rebased onto main after F11/F122's
    // raises above landed -- RE-MEASURED on the combined tree via
    // `node apps/api/scripts/lint-permission-paths.mjs` (13), not computed as "12 + 1". The
    // new entry is `infrastructure/chat/pg-chat-preset-repository.ts`. Its argument is not a
    // single shape but a composite of ones already established here: `chat_presets` reads are
    // either the actor's OWN write echoed back (same shape as the project-repository entry)
    // or consumed only to compute a derived value never returned as content (dispatch scope
    // check, thread-title lookup, usage aggregate); `project_memberships` / `org_agents` /
    // `org_skills` reads are IDENTITY/CATALOG data a decision is made FROM, circular to gate
    // with the decision they'd produce (same shape as the identity-repository entry); and the
    // `chat_threads` INSERT reuses the SAME visibilityScope='private' mechanism F108/F109
    // already gate reads of, so this file only writes that row, never reads it back.
    //
    // Its ENFORCED premise: none of the four application-layer preset functions
    // (`upsertPreset`/`dispatchPreset`/`startPresetInstance`/`getPresetUsage`) return
    // `openingPrompt`/`skills`/`agents` to a caller. `tests/chat/preset-content-echo-only.test.ts`
    // asserts each function's result shape excludes those three keys via an in-memory fake
    // repository. If that test is deleted, this entry must go with it.
    //
    // ⚠ Raised 13 -> 14 by F119 (advanceAgendaSegment, UC-P7), merged on top of the F115 raise
    // above -- RE-MEASURED on the combined (rebased) tree via
    // `node apps/api/scripts/lint-permission-paths.mjs` (see below for the fresh count). The one
    // new entry is `infrastructure/project/pg-agenda-segment-repository.ts` -- a WRITE path
    // (current segment's state/merged_into plus, in the same transaction, the next pending
    // segment's activation) reached only after `authorize({action:'agendaSegment.advance'})`
    // already ran and passed, one layer up in `advance-agenda-segment.ts` (permission before
    // existence, same ordering as `bindToProjectStep`). Its enforced premise is asserted in
    // `tests/project/advance-segment-repo-guard.test.ts`, which fails if any tenant table
    // other than `agenda_segments` appears in the file. If that test is ever deleted, this
    // entry must go with it.
    //
    // ⚠ Raised 14 -> 15 by F123 (phase-01 / UC-P3 `getProjectOverview`), rebased onto main a
    // third time after F119's raise above landed -- RE-MEASURED on the combined (rebased) tree
    // via `node apps/api/scripts/lint-permission-paths.mjs` (see below for the fresh count),
    // not computed as "14 + 1". The new entry is
    // `infrastructure/project/pg-project-overview-repository.ts`. It reads `projects` /
    // `agenda_segments` / `project_memberships` for three of the whitelist's four fields
    // (container identity, current agenda segment, four role COUNTS); none of it is
    // `acl_bindings`-governed content -- same D-18 line `pg-project-list-repository.ts` already
    // draws for container identity, and `project_memberships` here is read the same way
    // `pg-identity-repository.ts`'s entry describes (IDENTITY DATA grouped into counts, not
    // disclosed row-by-row, so guarding it with the decision it feeds would be circular).
    // `application/project/get-project-overview.ts` already calls `authorize()` against the
    // same `{kind:'project', id}` object before this repository is ever reached, so this is
    // not a second, undecided door.
    //
    // Its ENFORCED premise: the file stays a projection of those three tables into
    // container/segment/count shapes only. `tests/project/overview-whitelist-four-blocks.
    // test.ts` asserts the response is a closed four-field set (no fifth key can smuggle in
    // artifact/segment CONTENT), and `tests/project/overview-empty-vs-dependency-failure.
    // test.ts` asserts a dependency outage surfaces as 503, never a silently-empty 200. If
    // either test is deleted, this entry must go with it.
    //
    // ⚠ Raised 15 -> 16 by F82 (uc-6-1 access-templates data model). RE-MEASURED via
    // `node apps/api/scripts/lint-permission-paths.mjs` (see the fresh count below), not
    // computed as "15 + 1". The new entry is `infrastructure/interview/pg-template-repository.ts`
    // -- unlike every entry above, this one is not "the read cannot be judged by authorize()
    // without over-granting" (the `organization`/`interview` shape) or "this echoes the actor's
    // own write" (the project-repository shape). It is a THIRD shape: the rule to judge by does
    // not exist yet. `contracts/interview/domain.md` marks the template visibility range
    // (org-wide / team-private / personal draft) `[待定 D-16]`, still undecided at signoff.
    // Writing a `decideTemplateVisibility` now would fabricate the very rule the signoff
    // deferred -- worse than the gap, because it would read as covered.
    //
    // Its ENFORCED premise: every statement in the file is scoped by an explicit `org_id`
    // predicate/column (the same bound RLS already gives -- not looser), and the file never
    // calls `withoutTenant`. `tests/itv/template-repo-org-scoped-only.test.ts` parses the file
    // and fails on either violation. The day D-16 is decided, the allowlist entry must be
    // REPLACED by a real `decideTemplateVisibility` + `discloseDecided()` path, not renewed --
    // if that companion test is ever deleted, this allowlist entry must go with it.
    expect(Number(/allowlisted=(\d+)/.exec(r.out)?.[1] ?? -1)).toBeLessThanOrEqual(16);

    const src = readFileSync(
      fileURLToPath(new URL("../../scripts/lint-permission-paths.mjs", import.meta.url)),
      "utf8",
    );
    const block = /const ALLOWLIST = new Map\(\[([\s\S]*?)\n\]\);/.exec(src)?.[1] ?? "";
    const reasons = [...block.matchAll(/"((?:[^"\\]|\\.){40,})",\n\s*\],/g)].map((m) => m[1]!);
    const entries = [...block.matchAll(/\[\n\s*"src\//g)].length;
    expect(entries, "could not parse the allowlist -- this assertion would be vacuous").toBeGreaterThan(0);
    expect(reasons.length, "an allowlist entry has no real justification").toBe(entries);
    for (const reason of reasons) {
      expect(reason, `weak justification: ${reason}`).not.toMatch(/^(todo|legacy|temporary|for now)\b/i);
    }
  });
});
