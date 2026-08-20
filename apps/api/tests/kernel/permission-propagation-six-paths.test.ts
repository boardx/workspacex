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
    //
    // ⚠ Raised 16 -> 17 by F124 (archiveProject/unarchiveProject) -- RE-MEASURED on the combined
    // (rebased onto main through F82 #173 / F66 #169 / F141 #174) tree via
    // `node apps/api/scripts/lint-permission-paths.mjs`, not computed as "16 + 1". The new entry
    // is `infrastructure/project/pg-project-archive-repository.ts`: a WRITE path
    // (`projects.status`) plus the reads needed to decide whether that write is allowed, gated
    // upstream by `application/project/archive-project.ts` calling
    // `canCreateProject`/`findOrgMembership` before this repository ever runs -- same ordering as
    // the F119/F123 entries above. Its enforced premise (no tenant table beyond
    // `projects`/`agenda_segments`, no returned field beyond {kind, projectId, status}) is asserted
    // by tests/project/archive-readonly-and-readable.test.ts. If that test is ever deleted, this
    // entry must go with it.
    //
    // ⚠ Raised 17 -> 18 by F35 (phase-01 / uc-22-2 malware quarantine trail) -- this raise landed
    // independently of F124's raise above and was merged here on rebase onto main (through F124
    // #172 / F33 #178) -- RE-MEASURED on the combined (rebased) tree via
    // `node apps/api/scripts/lint-permission-paths.mjs` (18), not computed as "17 + 1". The
    // new entry is `infrastructure/files/pg-quarantine-repository.ts` -- it has no read method at
    // all, `record()` is a single INSERT, and a malware-scan verdict is a security/audit fact
    // about bytes that were REFUSED (no artifact, no artifact_version, nothing UC-0.3 R7
    // propagation reaches), same category as the provenance-repository entry above.
    //
    // Its ENFORCED premise: `tests/files/quarantine-repo-is-write-only.test.ts` parses the
    // file and asserts every `malware_quarantine_records` reference is an INSERT INTO. If
    // that test is deleted, this entry must go with it.
    //
    // ⚠ Raised 18 -> 20 by F83 (uc-6-1 A3, reverse-extraction drafts), rebased onto main
    // through F82 #173 -- RE-MEASURED via `node apps/api/scripts/lint-permission-paths.mjs`
    // (20), not computed as "18 + 2". Two new entries, two different shapes:
    //
    // `infrastructure/interview/pg-template-draft-repository.ts` is the SAME shape as F82's
    // `pg-template-repository.ts` entry directly above: a draft is a not-yet-a-template of
    // exactly the same undecided-visibility (D-16) kind, so the argument does not need
    // restating, only pointing at. Its enforced premise (org_id-scoped, no `withoutTenant`)
    // is asserted by `tests/itv/template-draft-repo-org-scoped-only.test.ts`.
    //
    // `infrastructure/interview/pg-source-interview-reader.ts` is a DIFFERENT shape from
    // every entry above except F119/F123/F124: "authorization already happened one layer up,
    // this file only continues an already-approved action." `extractTemplateDraft` (the use
    // case) calls `InterviewScopeRepository.findVisibleById` + `decideInterviewVisibility`
    // (F80's existing guarded path -- the same one `getInterview` uses) for every
    // `sourceInterviewId` BEFORE this reader is ever invoked, so this file adds no new
    // visibility surface: it reads only `interview_consent_submissions` (to derive a
    // boolean, O-05) and `interview_template_applications` (structural content already known
    // to belong to an interview the caller was just cleared to see) -- never
    // `interview_sessions` itself. Its enforced premise (only those two tables, never
    // `interview_sessions`, never `withoutTenant`) is asserted by
    // `tests/itv/source-interview-reader-org-scoped-only.test.ts`. If either test is
    // deleted, its entry must go with it.
    //
    // ⚠ Raised 20 -> 21 by F36 (phase-01 / uc-22-2 ingestion outbox + worker), rebased onto
    // main through F83 (this file) -- RE-MEASURED on the combined tree via
    // `node apps/api/scripts/lint-permission-paths.mjs` (21), not computed as "20 + 1". The
    // new entry is `infrastructure/files/pg-ingestion-repository.ts`: `ingestion_outbox`/
    // `ingestion_history` rows are job-queue metadata (which step, status/attempts, a state
    // name + timestamp) -- never a title, mime, bytes, or segment text -- and the worker
    // calls (`claimNext`/`completeAndAdvance`) have no requester to judge in the first
    // place, same shape as the identity-repository entry's "the decision is made FROM this"
    // circularity.
    //
    // Its ENFORCED premise: `tests/files/ingestion-repo-metadata-only.test.ts` parses the
    // file and fails if any returned field falls outside the allowlisted set, or if any
    // statement is not scoped by an explicit `org_id` predicate (no `withoutTenant`). If
    // that test is ever deleted, this entry must go with it.
    //
    // ⚠ Raised 20 -> 22 by F125 (project 束 · UC-P9 `addProjectMember`/`changeProjectRole`/
    // `removeProjectMember`) -- this raise landed INDEPENDENTLY of both F83's raise above and
    // F36's raise directly above (all three branched from the 18/20-entry tree before each
    // other's merge) -- RE-MEASURED on the combined tree via
    // `node apps/api/scripts/lint-permission-paths.mjs`, not computed as "20 + 2". Two new
    // entries, both gated upstream by `application/project/member-authorization.ts`'s
    // two-layer OR check (facilitator via `member.manage`, or org role `lead` per Q-4(2))
    // BEFORE either repository runs, same ordering as the F119/F124 entries above:
    //   · `infrastructure/project/pg-project-membership-repository.ts` -- writes
    //     `project_memberships` and echoes back only the caller's own grant; the one extra
    //     read (`projects.status` in `removeMember`) exists because F124's frozen DELETE
    //     policy uses `USING` (silent row filtering) rather than `WITH CHECK` (a catchable
    //     exception), so the archived case is otherwise indistinguishable from "not a member".
    //   · `infrastructure/project/pg-invite-token-member-resolver.ts` -- reads `invite_links`
    //     for a token ALREADY consumed by F15's `consumeInviteLink` (`used_by IS NOT NULL`):
    //     the authority for a grant the token holder already redeemed, not a disclosure
    //     surface a requester can pick someone else's row from.
    // If tests/project/member-two-entries-one-usecase.test.ts or
    // tests/project/display-alias-not-persisted.test.ts are ever deleted, these two entries
    // must go with them.
    //
    // Combined total on that rebase (F36's +1 and F125's +2 landing on the same 20-entry
    // base, side by side): 20 -> 23 -- RE-MEASURED on the combined tree via
    // `node apps/api/scripts/lint-permission-paths.mjs` (23), not computed as "21 + 2" or
    // "22 + 1".
    //
    // ⚠ Raised 23 -> 24 by F112 (chat approval-card backend contract), rebased a second time
    // onto main after F44/F125/F148/F98 all merged -- RE-MEASURED FRESH on the combined tree
    // via `node apps/api/scripts/lint-permission-paths.mjs` (24), not carried forward from
    // either branch's stale count (this file's own prior rebase had claimed 22; that number
    // predates F125's +2 landing and was never the real total on any tree that existed). The
    // new entry is `infrastructure/chat/pg-approval-model-registry.ts`. Its argument has the
    // same SHAPE as F49's admission-test entry, and for the same reason: `ObjectRef` is
    // project|artifact|segment|capability|organization|interview, and a MODEL is none of
    // them -- it has no `acl_bindings` row, so pushing a `model` ref through `authorize`
    // would find no binding, fall back to `DEFAULT_SCOPE` (org-wide), see a non-null org
    // role and return `allowed: true` for every member, exactly the failure `toAclRef`
    // refuses to paper over for `capability`/`organization`/`interview`. Who may see a
    // model's kind/price is ORGANIZATION CONFIGURATION (migration `0019-f48-model-pool.sql`'s
    // own header), not a per-artifact question. The file additionally reads STRICTLY FEWER
    // columns than that migration grants `app_rw` on `models` -- `id, kind, display_name,
    // unit_price`, never `model_secrets.ciphertext` (which has no SELECT grant to any role,
    // guarded at the database, not here).
    //
    // Its ENFORCED premise: `tests/chat/approval-model-registry-no-secret-columns.test.ts`
    // parses the file and fails if any column outside those four `models` columns, or any
    // `model_secrets`/credential-shaped identifier, appears in it. If that test is ever
    // deleted, this entry must go with it.
    //
    // ⚠ Coordinator buffer bump 24 -> 40 (2026-08-01, ahead of a large parallel dev-agent
    // wave): NOT a real-measured raise -- real count on main at this moment is 24. Headroom
    // so ~20 concurrently-merging features don't each need to touch this exact line (that
    // collision pattern cost several rebase-fix rounds in the prior wave). Individual
    // features should still add their own allowlist entry + enforced-premise test as normal,
    // but do NOT need to bump this ceiling unless the real count exceeds 40 -- re-measure via
    // `node apps/api/scripts/lint-permission-paths.mjs` before assuming the buffer is used up.
    // Coordinator will re-measure and tighten this back down once the wave lands.
    //
    // ⚠ Raised 40 -> 41 by #662 (default-agent bootstrap): the 2026-08-01 buffer got used up.
    // The new entry is `infrastructure/agent/pg-default-agent-repository.ts` -- see that
    // entry's own paragraph in `lint-permission-paths.mjs` for the argument (no caller to
    // gate against: the org bootstrapping its own default agent for itself, echoing back
    // only the id it just minted from a fixed system template, nothing disclosed to anyone).
    //
    // ⚠ Raised 41 -> 42 by #595 (skill-version content edit): new entry is
    // `infrastructure/skill/pg-skill-version-edit-repository.ts` -- see that entry's own
    // paragraph in `lint-permission-paths.mjs` (admin decision made one layer up, in
    // `edit-skill-version-content.ts`, before `deps.repository.persist` runs).
    //
    // ⚠ Raised 42 -> 43 by #785 (real Postgres backing for the `skill` asset-directory
    // read/write/delete/rename repository, replacing the in-memory fixture): new entry is
    // `infrastructure/asset/pg-asset-file-repository.ts` -- see that entry's own paragraph in
    // `lint-permission-paths.mjs` (F141/F142/F143's OWN signed-off gate is org-membership
    // only, checked by `findOrgMembership` in all five `application/asset/*.ts` use cases
    // BEFORE this repository is ever reached; this PR changes only where `skill` bytes are
    // stored, not who may ask for them).
    //
    // ⚠ Raised 43 -> 44 by #363 (org-profile-membership delta: listOrgMembers/listOrgInvites/
    // updateOrganization/uploadOrgAvatar): new entry is
    // `infrastructure/auth/pg-org-profile-repository.ts` -- see that entry's own paragraph in
    // `lint-permission-paths.mjs`. Org membership roster (listMembers/readAvatarBytes) is
    // gated by org-membership-only, checked one layer up in the controller
    // (`requireAdminRole`, which despite its name only confirms membership); admin-only reads/
    // writes (listInvites/updateOrganization/storeAvatar) are gated by `actorOrgRole !== "admin"`
    // in the use case, BEFORE this repository is ever reached -- same shape as #785's entry.
    //
    // ⚠ Raised 44 -> 45 by #660 (agent publish state machine): new entry is
    // `infrastructure/agent/pg-agent-publish-repository.ts` -- see that entry's own paragraph
    // in `lint-permission-paths.mjs` (org-membership decided one layer up, in
    // `application/agent/agent-publish.ts`, as BOTH use cases' FIRST action before any
    // repository call; the `agents` row read never reaches a response -- the contract's `out`
    // is a state + a boolean + a count + a null -- and the `skill_reviewer_functions` read is
    // keyed by the authenticated caller's own `principal_id`, i.e. "what function do I hold",
    // never a roster). Premises enforced by `tests/agent-runtime/agent-publish-repo-guard.test.ts`.
    // ⚠ 本条与 #363 是同一轮里各自 +1 的两条，不是重复：两个条目、两个仓储、两份前提测试。
    //
    // ⚠ Raised 45 -> 46 by #660 (the toolless self-publish edge, signed off as candidate A of
    // the `agent-instructions` delta): new entry is
    // `infrastructure/agent/pg-self-publish-agent-repository.ts` -- see that entry's own
    // paragraph in `lint-permission-paths.mjs` (org-admin decision made one layer up, in
    // `self-publish-toolless-agent.ts`, before both repository calls; the two reads feed the
    // domain gate and a `FOR UPDATE` row lock, and neither reaches a response).
    // ⚠ 本条与上面那条 #856 的是同一个 issue 下**两条互补的路径**各自 +1，不是重复：
    // 有能力面的 agent 走双人评审（`pg-agent-publish-repository.ts`），无能力面的走自助
    // （本条）。两个条目、两个仓储、两份前提测试。
    //
    // ⚠ Raised 46 -> 47 by #946 F153/W1（V9-b 附件内容抽取）: 新条目是
    // `infrastructure/chat/pg-attachment-extraction-repository.ts` —— 见其在
    // `lint-permission-paths.mjs` 的段落。与正上方的 `pg-ingestion-repository.ts` 完全同类：
    // 纯 worker/系统路径，**任一调用都没有 requester**——outbox 是作业队列元数据
    // （jobId/attachmentId/attempts），`readAttachment` 只回 {storageRef, mime} 两个 worker 取数
    // 输入，抽取内容到用户只经已判定的 agent-run 历史路径。`guard()` 没有 requester 可过滤。
    // 前提被 `tests/chat/attachment-extraction-repo-guard.test.ts` 强制（无 withoutTenant + 运行时
    // 形状 ⊆ 允许集），删测试则本条须一并删——正是这里要求的「带前提测试的 +1」。
    //
    // ⚠ Raised 47 -> 48 by F159（token 计量单一写入点）：新条目是
    // `infrastructure/auth/pg-token-usage-repository.ts`。论点与 `pg-quarantine-repository.ts`
    // 同形，而不是「过滤器不方便」：`Guarded<T>` 护的是 DISCLOSURE，而这个文件**没有读方法**
    // ——`record()` 是唯一导出，里面只有一条 INSERT、返回 `void`，没有任何东西被交给
    // 任何请求者。一次模型调用烧了多少 token 也不在 UC-0.3 R7 propagation 的射程里：
    // 它不挂在任何 artifact/segment/embedding/context pack 上，是一条计费事实。
    // 这条流水被读出来的地方是另一个仓储（`pg-token-quota-repository.ts`），
    // 那里的授权是 controller 的组织 admin 门。
    //
    // 它的**被强制的前提**（本行要求的那种，不是一句声明）：
    // `tests/auth/token-usage-single-write-path.test.ts` 解析该文件，出现任何
    // SELECT/UPDATE/DELETE 即失败；同一文件还断言那条 INSERT 在整个 `apps/api/src` 里
    // 只出现这一处（否则「唯一写入点」这个主张本身就是假的）。删测试则本条须一并删。
    //
    // ⚠ Raised 48 -> 49 by F164 (personal transcription persistence): the new entry is
    // `infrastructure/recording/pg-personal-transcription-repository.ts`. Unlike project
    // artifacts, this content is private to the authenticated owner and therefore has no
    // `acl_bindings` object to pass through `guard()`. Its allowlist premise is enforced by
    // `personal-transcription-repo-scope-guard.test.ts` (table scope, no `withoutTenant`,
    // owner predicate on every read) and `personal-transcription-owner-boundary.test.ts`
    // (another member and an org admin both see not-found/empty over real HTTP/PostgreSQL).
    // This is one repository and one bounded exception, so the ceiling moves by exactly one.
    //
    // ⚠ Raised 49 -> 50 by F166 (realtime ASR ticket persistence): the ticket store is a
    // write/consume-only authentication boundary. It returns no protected artifact content;
    // its table scope, tenant context and one-use atomic consume are mechanically enforced by
    // `realtime-asr-repo-scope-guard.test.ts` and `realtime-asr-ticket.test.ts`.
    // ⚠ Raised 49 -> 50 by F160（成员 token 配额）：新条目是
    // `infrastructure/auth/pg-token-quota-repository.ts`。它与上一条不同——它**真的**把内容
    // 交给请求者（谁分了多少额度、谁烧了多少 token）。论点因此走的是紧邻的
    // `pg-org-profile-repository.ts` 的 `listMembers` 那条线：这是**组织管理数据**，不是
    // `acl_bindings` 治理的 Artifact/Segment 内容——`toAclRef` 里没有能表达「额度」的 kind，
    // 硬推一个进去只会落到 `DEFAULT_SCOPE`（org-wide）从而对每个成员返回 allowed:true，
    // 那正是 `capability`/`organization`/`interview` 在那里 THROW 而不是被判定的原因。
    // 真正需要的那道门比 `listMembers` 更紧（额度是钱）：四条路由在 controller 的
    // `requireOrgAdmin` 里判组织 admin，在本仓储被触达之前跑完，且**不复用**
    // `listMembers` 那条对普通成员开放的判定——两条授权面各判一次。
    //
    // 它的**被强制的前提**：`tests/org-admin/token-quota-authorization.test.ts` 逐条反证
    // 非成员 → NO_ORG_MEMBERSHIP、组织内非管理员 → FORBIDDEN，**且同时断言库里没写进去**
    // ——只断言抛异常的话，一个「先写后判」的实现照样能过：它抛的异常是真的，
    // 写进去的行也是真的。删测试则本条须重新论证。
    //
    // ⚠ Raised 51 -> 52 by F162（限额策略）：新条目是
    // `infrastructure/auth/pg-limit-rule-repository.ts`。它读两样东西，两样都不是
    // `acl_bindings` 治理的内容：`limit_rules` 是组织自己的配置，`limit_events` 是
    // 触发留痕——后者与 `pg-provenance-repository.ts` 同形，一条审计轨迹不能被它
    // 自己要供给的那个判定把守。用量是从 `token_usage_events` 现算的派生 SUM，
    // 不是把某个人的原始事件行交出去。门与上一条同：五条路由都在 controller 的
    // `requireOrgAdmin` 里判组织 admin，在仓储被触达之前跑完。
    //
    // 它的**被强制的前提**：`tests/org-admin/limit-rule-authorization.test.ts` 逐条反证
    // 非成员/非 admin 被拒，**且断言被拒时库里没有新规则、没有新事件**。
    //
    // ⚠ Raised 52 -> 53 by shared-invite-links delta（组织共享邀请链接）：新条目是
    // `infrastructure/auth/pg-org-invite-link-repository.ts`。论点与
    // `pg-org-invite-repository.ts` **同形**：`activate()` 读的 `org_invite_links` 行是
    // 授予的权威，而这条路径上没有 requester 可判——点链接的人还不属于任何组织，
    // `disclose()` 无问题可问。admin 侧四方法的组织 admin 判定在用例层
    // （actorOrgRole === "admin"）先于仓储跑完；`list()` 只回链接元数据，令牌明文
    // 在库里**根本不存在**（只有 sha-256 hash，比单人邀请的明文 token 表更窄）。
    //
    // 它的**被强制的前提**：`tests/auth/shared-invite-links.test.ts` 断言 activate 的
    // 返回形状恰好是授予键集（多一个内容字段即红），并以「搜值不搜字段名」断言两张表
    // 整行 JSON 里搜不到签发响应中的明文。删测试则本条须一并删。
    //
    // ⚠ Raised 53 -> 54 by F155（L3 文件式检索，design delta `context-engine-l3-file-based`，
    // 人类 2026-08-14 签核）：新条目是 `infrastructure/agent-run/pg-file-retrieval.ts`。
    // 论点与 `pg-model-pool-repository.ts` / `pg-admission-test-repository.ts` **同形**，
    // 而且更直接：`ObjectRef` 里没有「聊天线程的附件」这一种；把它当 `project` ref 推进
    // `authorize` 问的是错的问题，而**个人线程**（`project_id IS NULL`，#594 起存在）
    // 根本没有 project ref 可推——会落到 `DEFAULT_SCOPE`（org-wide）从而对全组织每个成员
    // 返回 allowed:true，正是 `interview`/`organization` 在 `toAclRef` 里 THROW 的那个失败。
    // 与前面几条不同的是：取代 `disclose()` 的不是「一层之上的一次判定」，而是**判权就是
    // 这条查询的 WHERE 子句**——这是已签 delta §3.1 明确选择的机制，原话「SQL 谓词本身带
    // org_id/thread_id/可见性判定，不是『召回了再过滤』」。方向恒为 fail closed：受限可见性
    // 线程的文件一律不召回（具名缺口 `GAP-CE-FTS-SCOPE-GROUP-VISIBILITY`），只会少给。
    //
    // 它的**被强制的前提**：`tests/chat/l3-retrieval-permission-scope.test.ts` 在真库上让
    // 一个真的没有权限的 actor 去查一份真的存在的文件并断言零命中（另一个项目的成员、
    // 伪造 projectId 的非成员、别人的个人线程），**且**解析源码断言两条 SELECT 的 scope
    // 谓词都还带着个人线程分支与 `EXISTS(project_memberships)`——只解析源码的话，
    // 几行字还在但语义被改坏照样能过。删测试则本条须一并删。
    // ⚠ Raised 54 -> 55 by F176（消息级评价落地）：新条目是
    // `infrastructure/skill/pg-message-rating-repository.ts`。它比前几条**多碰三张表**
    // （`chat_messages` / `agent_runs` / `skill_versions`），所以论点必须比前几条更窄：
    // 那三张表只为**归因**而读，交出来的是三个标识符（agent_id / skill_id /
    // skill_version_id），**一个内容列都不选**——尤其没有 `chat_messages.body`。
    // 门在仓储之前：唯一调用方 `application/skill/submit-message-rating.ts` 先跑
    // `chat.findMessageLocation` + `resolveVisibility`，不是 `allow` 就抛，
    // 之后才碰 `deps.ratings`。那是 chat 束**已有的**可见性判定（`expandToolCallChain`
    // 用的同一个），不是第二套。
    //
    // 它的**被强制的前提**：`tests/skill/message-rating-repo-guard.test.ts` 断言四件——
    // ① 名到的表恰好是这五张；② 不选任何内容列（含 `m.body`/`body,`）；
    // ③ 无 `withoutTenant`；④ 两道前置检查仍在 `submit-message-rating.ts` 里、
    // 且位置在第一次 `deps.ratings.` 之前（按字符下标断言，不是「文件里有这两个词」）。
    // 删测试则本条须一并删。
    //
    // ⚠ Raised 55 -> 56 by F157（可审计上下文快照 agent_run_context，08-chat/uc-8-7 R3②，
    // 人类 2026-08-11「yes to all」签核）：新条目是
    // `infrastructure/agent-run/pg-agent-run-context-snapshot.ts`。两个方法两种豁免理由：
    // `record()` 是系统内部写——`execute-run.ts` 在组装完成后无条件写一条「这次到底喂了
    // 什么」的事实快照，没有请求者向它发问「我能不能读」，同 F117 那批「actor 写自己刚
    // 创建的容器」不必判权的形状（这里甚至连 actor 都不是概念上的读者，是执行器自己）。
    // `findByRunId()` 才是真正的披露面，判权在调用它之前发生——
    // `application/agent-run/read-run-context-snapshot.ts` 复用 `read-run.ts` 已经在用
    // 的同一个 `resolveVisibility`（一条快照的可见性等于它所属 run 的可见性，不新开
    // 第二套判权）。快照不是 `ObjectRef` 的任何一种，`guard()`/`disclose()` 同样问错问题，
    // 与 `pg-file-retrieval.ts` 那条同理。
    //
    // 它的**被强制的前提**：`tests/chat/agent-run-context-snapshot-repo-guard.test.ts`
    // 断言两件——(a) `pg-agent-run-context-snapshot.ts` 不出现
    // `agent_run_context_snapshots` 之外的任何租户表；(b) `readAgentRunContextSnapshot`
    // 在调用 `deps.snapshots.findByRunId` 之前先调 `resolveVisibility`，未通过时抛出、
    // 绝不往下走。删测试则本条须一并删。
    //
    // ⚠ Raised 56 -> 57 by F185（2026-08-16 delta，listProjects 扁平化 + 项目标签）：
    // 新条目是 `infrastructure/project/pg-project-tags-repository.ts`。与 F124
    // `pg-project-archive-repository.ts` 同一个形状：一条 WRITE 路径（`project_tags`
    // 的整体替换：DELETE + INSERT）加一条只用来判定「写入目标存不存在」的 SELECT，
    // 从不披露别人的内容——`UpdateProjectTagsOutcome` 只带调用者自己这次写入的
    // projectId/tags 回显，同 F117/F124 那批「actor 写自己刚提交的东西」不必判权的形状。
    // 判权发生在仓储被调用之前：`application/project/update-project-tags.ts` 先跑
    // `canCreateProject`（与 `archiveProject` 同一条组织角色线），不通过就抛，
    // 之后才碰 `deps.repo.updateTags`。
    //
    // 它的**被强制的前提**：`tests/project/tags-repo-guard.test.ts` 断言两件——
    // ① 名到的表恰好是 `projects`/`project_tags`；② `canCreateProject` 判定在第一次
    // `deps.repo.updateTags` 之前，且未通过必须抛出（按字符下标断言，不是「文件里有这两
    // 个词」）。删测试则本条须一并删。
    //
    // ⚠ Raised 57 -> 58 by F190（design-delta `tool-trace-cross-run-context`，PR #1409 已
    // 签核）：新条目是 `infrastructure/agent-run/pg-tool-trace-context.ts`。与上面 F157
    // `pg-agent-run-context-snapshot.ts` 的 `record()` 同一个「系统内部读」形状——`recent()`
    // 只被 `execute-run.ts` 的组装管线调用，读回的是拼进 `ModelCallInput.history` 给模型看
    // 的伪消息素材，从未作为任何一个面向请求者的用例的返回值存在。
    //
    // 它的**被强制的前提**：`tests/chat/tool-trace-context-repo-guard.test.ts` 断言两件——
    // ① 名到的表恰好是 `agent_runs`/`agent_run_steps`/`chat_messages`；② `src/interface/`
    // 下没有任何 controller 直接调用它或 import 这个仓储/端口（按源码字符串扫描断言，不是
    // 「文件里有这两个词」）。删测试则本条须一并删。
    //
    // ⚠ Raised 58 -> 59 by #1415（agent 版 GitHub URL 导入）：新条目是
    // `infrastructure/agent-import/pg-agent-url-import-repository.ts`——与
    // `pg-skill-url-import-repository.ts` 逐字同一条豁免理由（授权在
    // `import-agent-from-url.ts` 里、且在 `deps.fetch` 之前，同一层先后顺序）。
    // 它的**被强制的前提**：`tests/agent-runtime/agent-url-import-repo-guard.test.ts`
    // 断言三件——(a) 只命名 `agent_url_imports`/`agents` 两张租户表；(b) 无
    // `withoutTenant`；(c) 授权判定排在 `deps.fetch` 调用之前。删测试则本条须一并删。
    //
    // ⚠ Raised 59 -> 60 by 2026-08-17（skill 试跑自愈式模型回退）：新条目是
    // `infrastructure/skill/pg-org-agent-model-reader.ts`——授权在
    // `trial-run-skill.ts` 里、且在 `deps.orgAgentModel?.findAnyPublished` 之前，
    // 同一层先后顺序。它的**被强制的前提**：
    // `tests/skill/org-agent-model-reader-repo-guard.test.ts` 断言三件——
    // (a) 只命名 `agents`/`agent_versions` 两张租户表；(b) 无 `withoutTenant`；
    // (c) 授权判定排在这次读之前。删测试则本条须一并删。
    //
    // ⚠ Raised 60 -> 63 by F950（2026-08-16 delta，templates 束定题/分组读侧 + 组员字段——
    // 第一次给 F24/F25 已签核的契约接上真实 Postgres，此前只有内存假仓储撑单元测试）：
    // 三个新条目——
    //   `infrastructure/templates/pg-project-topic-repository.ts`：写路径（`project_topics`
    //   upsert）+ 读同一行，同 F117/F124/F185 那批「actor 写自己刚提交的东西」形状。
    //   `infrastructure/templates/pg-grouping-repository.ts`：写 `groups`/
    //   `project_grouping_revision`，**并且**改 `project_memberships.group_id`/
    //   `project_role`——这是三个里最接近 `pg-identity-repository.ts` 那条线的一个，
    //   但它只 UPDATE 已存在的成员行，从不 INSERT，不能把任何人拉进一个他们本不在的
    //   项目（那是 F125 `addProjectMember` 的职责范围）。
    //   `infrastructure/templates/pg-project-prep-repository.ts`：纯只读三张表，只回
    //   四个裸整数（`ProjectPrepCounts`），不含任何成员身份或内容。
    // 三处角色门槛（`canSaveTopic`/`canUpdateGrouping`/`getProjectPrep` 的
    // `actorProjectRole`）都在各自用例里、仓储被调用之前完成，同一层顺序。
    //
    // 它们的**被强制的前提**：`tests/tpl/project-prep-repo-guard.test.ts`（topic + prep
    // 两个仓储共用，断言各自只命名它声明的那些表）与
    // `tests/tpl/grouping-repo-guard.test.ts`（分组仓储专属，额外断言 (a) 只命名
    // `groups`/`project_grouping_revision`/`project_memberships` 三张表，(b) 对
    // `project_memberships` 的每一条语句都是 `UPDATE`，从不出现 `INSERT`）。删测试则
    // 对应条目须一并删。
    //
    // ⚠ Raised 63 -> 64 by F960（2026-08-17 delta）：一个新条目——
    //   `infrastructure/templates/pg-interview-subjects-repository.ts`：写 `project_group_
    //   interview_subjects`（DELETE+INSERT 整体替换）+ `..._revision` 乐观锁 upsert，读同一
    //   张表，同 F185 project-tags 那批「actor 写/读自己项目数据」形状。角色门槛
    //   （`actorProjectRole === null` ⇒ NO_PROJECT_ROLE，写侧另加 `canUpdateInterviewSubjects`）
    //   在 `update-interview-subjects.ts`/`get-interview-subjects.ts` 用例里、仓储被调用
    //   之前完成，同一层顺序。它的**被强制的前提**：
    //   `tests/tpl/interview-subjects-repo-guard.test.ts` 断言只命名这两张表。删测试则
    //   本条须一并删。
    //
    // ⚠ Raised 64 -> 65 by #1493（UC-7.3 第一块 · 画布实例源码链）：新条目是
    // `infrastructure/canvas/pg-canvas-instance-repository.ts`——与 F119
    // `pg-agenda-segment-repository.ts` 同一个「判定一层之上、先于内容披露」形状：
    // `get-canvas-source.ts` 先 `authorize(read.ownGroup)` 再 `findVersion`（唯一返回
    // markdown 的读法），`update-canvas-source.ts` 先比对 `group_id`（NOT_IN_GROUP）再
    // `appendVersion`；先于判定的 `findInstance` 只回 routing facts，不回 markdown。
    // 它的**被强制的前提**：`tests/canvas/instance-repo-guard.test.ts` 断言四件——
    // (a) 只命名 `canvas_instances`/`canvas_instance_versions`/`canvas_templates`
    // 三张租户表；(b) 无 `withoutTenant`；(c) `findInstance` 的 SELECT 不含 markdown 列；
    // (d) 两个源码用例的判定排在 `findVersion`/`appendVersion` 之前。删测试则本条须一并删。
    //
    // ⚠ Raised 65 -> 66 by #1561（P2 推理侧图像通道，缺口背景 #1558）：新条目是
    // `infrastructure/agent-run/pg-run-image-input.ts`——与 `pg-file-retrieval.ts`（F155）
    // 同一个「`ObjectRef` 没有这一种，判权只能是查询的 WHERE 子句」形状，而且更窄。
    // 「聊天消息的图片附件」不是 project|artifact|segment|capability|organization|interview
    // 中的任何一个；把它当 `project` ref 推进 `authorize` 对**个人线程**
    //（`chat_threads.project_id IS NULL`）会找不到绑定、退回 org-wide `DEFAULT_SCOPE`、
    // 看见非空组织角色而对全组织每个成员放行——`pg-file-retrieval.ts` 那条逐字记着这个
    // 失败形状，为它加第七种 ref kind 是在制造这个失败，不是在避免它。
    //
    // 它比 L3 那条还窄一档，这是本条能成立的核心：范围只到**触发本次 run 的那一条消息**
    //（`a.thread_id = $2 ∧ a.message_id = $3 ∧ m.author_id = $4`）。这批行的元数据 run
    // 早就合法持有——`ClaimedAgentRun.inputAttachments` 由 `pg-agent-run-repository.ts`
    // 从同一张表、按同一个 `message_id`、在同一次 claim 里聚合出来——本文件只是把同一批
    // 行的字节取出来交给模型，**没有新增任何一个可见面**。跨消息/跨线程的图像今天取不到
    //（具名缺口 `GAP-VISION-CROSS-TURN-IMAGES`），方向是 fail closed。
    //
    // 它的**被强制的前提**：`tests/chat/run-image-input-repo-guard.test.ts` 断言五件——
    // (a) 只命名 `chat_message_attachments`/`chat_messages` 两张租户表；(b) 无
    // `withoutTenant`；(c) 两条 SQL **各自**都带 `a.message_id = $3` 与 `m.author_id = $4`
    //（少任何一条，这条读路径就从「run 自己那条消息的附件」扩大成一个新的可见面，
    // 而那时本条论证的每一句都不再成立）；(d) SQL 里没有 `LIMIT`——加了就是 #1561 明文
    // 禁止的静默截断；(e) `src/interface/` 下没有任何 controller 触达它或它的端口，
    // 所以它今天是「组装用的内部素材」而不是披露面。删测试则本条须一并删。
    // ⚠ Raised 66 -> 67 by F962（phase-01 / design-delta `skill-sandbox-execution` §6.1），
    // and it brings an enforced premise, as demanded above. The new entry is
    // `infrastructure/skill/pg-skill-trial-run-store.ts`（`skill_trial_runs`，试跑转异步的
    // 提交→轮询表）。
    //
    // 它的论证与上面 `pg-admission-test-repository.ts`（模型准入）**同一形状**，这正是重点：
    // `ObjectRef` 是 project|artifact|segment|capability|organization|interview，而**一次试跑
    // 一个都不是**。它没有 `acl_bindings` 行，一个 `trial-run` ref 推进 `authorize` 会找不到
    // 绑定、退回 `DEFAULT_SCOPE`（org-wide）、看到非空 org role，然后**对组织里每个人返回
    // `allowed: true`** —— 还带着一个看起来完全正常的 decisionId。这正是 `toAclRef` 里
    // `capability` / `organization` / `interview` 选择 THROW 而不是去判定的原因。
    // 为了让 lint 变绿而加第四种 ref kind，是在**制造**那个失败，不是在避免它。
    //
    // 「谁可以读一次试跑」根本不是 ACL 问题，而是**归属**问题：只有提交者本人。
    // 这条规则由 SQL 谓词 `actor_id = $3` 表达，读不到就是读不到（controller 翻成裸 404，
    // 与 `agent-run.controller.ts` 同一条「不给存在性预言机」的纪律）。
    //
    // 它的**被强制的前提**：`tests/skill/trial-run-store-reads-are-actor-scoped.test.ts`
    // 解析该文件并断言四件——(a) 每条面向请求方的 SELECT 都带 `actor_id = $`（唯一例外是
    // 系统侧 `FOR UPDATE SKIP LOCKED` 认领，它没有请求方，行是交给执行器的）；
    // (b) 每条语句都带 `org_id` 作为 RLS 之后的第二道防线；(c) 没有任何 DELETE 路径
    //（迁移里也不 GRANT DELETE）；(d) **自检真的解析到了 SQL**，否则一次重命名就能让
    // 这条断言变成永远绿的空转。已实测反证：把 `actor_id = $3` 换成恒真谓词，该测试立刻红。
    // 删那个测试则本条目须一并删。
    //
    // ⚠ Raised 67 -> 71 by F01（phase-06-research-insight-backend，#1628）：洞察写路径
    // （extractQuotes / generateCandidateInsights / confirmInsight）新增四个 infra 文件，
    // 各自的授权都在**调用它的用例层一层之上**完成，不是这里第二次没人判的门：
    //
    //   `pg-segment-reader.ts`（extractQuotes 的直连片段读取）—— `extract-quotes.ts` 的
    //   `assertVisible` 先经 `decideInterviewVisibility`/`discloseDecided` 判过这场访谈本身
    //   可见，才会调 `readSegments`；`interview` 这个 ACL kind 本来就不能走通用
    //   `authorize()`/`guard()`（`permission-filter.ts` 的 `toAclRef` 对 `interview` 显式
    //   throw，同上面既有条目对 `interview`/`subject` 的处理一致）。
    //
    //   `pg-interview-quote-repository.ts` —— 三个调用点各自一层之上完成授权：
    //   `extractQuotes` 排在 `assertVisible` 之后（与上一条同一次判定复用）；
    //   `generateCandidateInsights` 只用 Context Pack 已按 `actorId` 授权返回的
    //   `segmentIds` 过滤（`PgContextPackStore` 对不属于当前请求者的 run 返回 null，
    //   同 `DIGITAL_EXPERT_CONTEXT_API` 既有先例）；`confirmInsight` 只取候选自带的
    //   `evidenceQuoteIds`，不接受调用方另传的 id 集合。
    //
    //   `pg-interview-insight-repository.ts` —— `confirm` 写回已经过上面授权链产生的候选，
    //   `disclose()` 没有第二个问题要问（同 F98 `acceptCandidate` 一类『写回显已决定动作』
    //   的既有先例）；`getById` 目前没有任何 controller/route 调用它，只在测试里核对刚写入
    //   的行——F02 落地 `getEvidenceMatrix` 若把它接到真实读接口，必须改走
    //   `guard()`/`discloseDecided()`，本次豁免不覆盖那次接线。
    //
    //   `pg-consent-decline-reader.ts` —— 与上面已有的 `pg-consent-gate-reader.ts` 同型：
    //   出门的只是调用方本就持有的 subjectId 列表，不是任何同意位的值。
    //
    // 四条的被强制前提：`tests/itv/insight-segment-reader-repo-guard.test.ts` 解析全部四个
    // 文件 + `extract-quotes.ts`，断言（a）每个文件只命名它声称的租户表；（b）四个文件都
    // 不调用 `withoutTenant`；（c）`extractQuotes` 里 `assertVisible` 排在
    // `segments.readSegments`/`quotes.insertMany` 之前；（d）`src/interface/` 下没有文件
    // 直接 import `pg-interview-insight-repository.ts`（只经 DI token 拿端口类型）。
    // 删那个测试则这四条也须一并删。
    expect(Number(/allowlisted=(\d+)/.exec(r.out)?.[1] ?? -1)).toBeLessThanOrEqual(71);

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
