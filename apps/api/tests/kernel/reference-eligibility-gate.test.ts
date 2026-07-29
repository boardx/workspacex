process.env.KERNEL_ALLOW_TEST_PRINCIPAL = "1";
process.env.KERNEL_QUIET = "1";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { artifact as C } from "@repo/contracts";
import {
  addOrgMember,
  addProjectMember,
  asApp,
  asOwner,
  ensureDatabase,
  migrateOnce,
  resetOrgs,
  seedOrg,
} from "../support/db";
import { makeHarness, seedArtifact, type Harness } from "../support/binding-fixture";
import { toOrgId } from "../../src/domain/org-id";
import { PgDownstreamReferenceRepository } from "../../src/infrastructure/artifact/pg-downstream-reference-repository";
import { bindToProjectStep } from "../../src/application/artifact/bind-to-project-step";
import { upgradeBinding } from "../../src/application/artifact/upgrade-binding";
import { referenceForDownstream, type ReferenceDeps } from "../../src/application/artifact/reference-for-downstream";
import {
  ArtifactNotFoundError,
  CONTRACT_CODE_BY_ERROR,
  RequiresPinnedError,
} from "../../src/application/artifact/binding-errors";
import {
  DOWNSTREAM_PURPOSES,
  judgeCitation,
} from "../../src/domain/artifact/downstream-eligibility";
import { MODE_RANK } from "../../src/domain/artifact/binding-modes";
import { disclose } from "../../src/application/security/permission-filter";

/**
 * F07 -- 下游引用资格门控 (uc-0-1 R6 / AC1 / R12 V1, domain I-14).
 *
 * ## What this file refuses to accept as a pass
 *
 * The literal contract makes this feature vacuous. `referenceForDownstream.in` carries a
 * `versionId`, every `artifact_versions` row is an immutable snapshot by construction, and
 * therefore under the literal reading `REQUIRES_PINNED` has no reachable case: the gate
 * whose entire value is a refusal could never refuse, and a test suite built on it would be
 * this project's TENTH "green and idle" gate.
 *
 * So eligibility here is a property of the BINDING (see `downstream-eligibility.ts`), and
 * every assertion below is written so that removing the rule turns something red:
 *
 *   · every refusal is paired with the PERMITTED neighbour, so a gate that refuses
 *     everything cannot pass;
 *   · every refusal is exercised through the use case AND directly against the database,
 *     because a rule living in one use case holds until the second consumer -- and F07 has
 *     five consumers coming, in five other bundles (coverage gap ③);
 *   · the case a mode check alone cannot see -- a PINNED binding at v1 while the caller
 *     cites v2 -- is asserted explicitly. An implementation that only asks "is this
 *     artifact pinned somewhere" refuses every draft and every live product, passes every
 *     test written about modes, and lets a citation name bytes nobody committed to.
 */

const ORG = "org-f07-gate";
const OTHER_ORG = "org-f07-other";
const PROJECT = "proj-f07-gate";
const OTHER_PROJECT = "proj-f07-other";
const STEP = "step-synthesis";
const AUTHOR = "u-f07-author";
const OUTSIDER = "u-f07-outsider";

let h: Harness;
let app: NestExpressApplication;
let BASE: string;
let references: PgDownstreamReferenceRepository;
let deps: ReferenceDeps;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  h = await makeHarness("f07");
  references = new PgDownstreamReferenceRepository(h.db);
  deps = {
    references,
    bindings: h.deps.bindings,
    artifacts: h.deps.artifacts,
    ids: h.ids,
  };
  const { createApp } = await import("../../src/main");
  app = await createApp();
  await app.listen(0);
  const addr = app.getHttpServer().address();
  BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
});

afterAll(async () => {
  await app?.close();
  await h?.close();
  if (h?.root) await rm(h.root, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER_ORG);
  const fx = await seedOrg({ orgId: ORG, projectId: PROJECT });
  await addOrgMember(ORG, AUTHOR, "consultant", fx.teams.energy!);
  await addProjectMember(ORG, PROJECT, AUTHOR, "facilitator", null);

  const other = await seedOrg({ orgId: OTHER_ORG, projectId: OTHER_PROJECT });
  await addOrgMember(OTHER_ORG, OUTSIDER, "consultant", other.teams.energy!);
  await addProjectMember(OTHER_ORG, OTHER_PROJECT, OUTSIDER, "facilitator", null);
});

const org = () => toOrgId(ORG);

const bind = (
  mode: "draft" | "live" | "pinned",
  artifactId: string,
  stepId = STEP,
  sourceVersionId?: string,
) =>
  bindToProjectStep(h.deps, {
    userId: AUTHOR, orgId: org(), artifactId, projectId: PROJECT, stepId, mode, sourceVersionId,
  });

const cite = (
  versionId: string,
  purpose: (typeof DOWNSTREAM_PURPOSES)[number] = "decision-reference",
  referencedBy = { kind: "claim", id: "cl-1" },
) => referenceForDownstream(deps, { userId: AUTHOR, orgId: org(), versionId, purpose, referencedBy });

const post = (path: string, body: unknown, userId = AUTHOR, orgId = ORG) =>
  fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "x-kernel-test-principal": `${userId}:${orgId}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const rowsFor = (versionId: string) =>
  asOwner(async (c) => {
    const r = await c.query<{ id: string; purpose: string; referenced_by_id: string }>(
      `SELECT id, purpose, referenced_by_id FROM downstream_references
        WHERE version_id = $1 ORDER BY id`,
      [versionId],
    );
    return r.rows;
  });

/* ─────────────── AC1 negative: live / draft / unbound are all refused ─────────────── */

describe("AC1: only a fixed snapshot may be cited", () => {
  it("a DRAFT product is refused for all five downstream purposes", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bind("draft", a.artifactId);

    // All five, not a sample. R6 names five acts and the whole claim of AC1 is that the
    // gate is the same door for every one of them; testing one and trusting the others is
    // how the fifth downstream ends up with its own judgement.
    expect(DOWNSTREAM_PURPOSES).toHaveLength(5);
    for (const purpose of DOWNSTREAM_PURPOSES) {
      await expect(cite(a.versionIds[0]!, purpose), `${purpose} was allowed`).rejects.toBeInstanceOf(
        RequiresPinnedError,
      );
    }
    expect(await rowsFor(a.versionIds[0]!)).toEqual([]);
  });

  it("a LIVE product is refused for all five, and the refusal names the artifact (E1)", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bind("live", a.artifactId);

    for (const purpose of DOWNSTREAM_PURPOSES) {
      await expect(cite(a.versionIds[0]!, purpose)).rejects.toBeInstanceOf(RequiresPinnedError);
    }
    // E1: the denial must offer 一键定版, and an interface cannot address an artifact it was
    // never told about. The caller supplied a VERSION id; the remedy acts on the artifact.
    await expect(cite(a.versionIds[0]!)).rejects.toMatchObject({ artifactId: a.artifactId });
  });

  it("a product that was never backflowed at all is refused too", async () => {
    // A1 permits an artifact with no project and no binding. It is an immutable version and
    // it is still not citable: the five purposes are project-side acts, and nothing has
    // committed to this one. Stated in `downstream-eligibility.ts` rather than left to be
    // inferred from a passing test.
    const a = await seedArtifact(h, ORG, null, ["v1\n"], AUTHOR);
    await expect(cite(a.versionIds[0]!)).rejects.toBeInstanceOf(RequiresPinnedError);
  });

  it("the case a mode check cannot see: pinned at v1, citing v2", async () => {
    // The artifact IS pinned. Its project side says 已定版 v1. An implementation that asks
    // "does this artifact have a pinned binding" answers yes and lets a decision cite bytes
    // no step ever committed to -- while every draft/live assertion above stays green.
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n", "v2\n"], AUTHOR);
    await bind("pinned", a.artifactId, STEP, a.versionIds[0]);

    await expect(cite(a.versionIds[1]!)).rejects.toBeInstanceOf(RequiresPinnedError);
    // ...and the neighbour, so the refusal is about WHICH version and not about pinned
    // artifacts being uncitable.
    const ok = await cite(a.versionIds[0]!);
    expect(ok.eligible).toBe(true);
  });
});

/* ─────────────────────── AC1 positive: a pinned snapshot passes ──────────────────── */

describe("AC1: the same five calls all succeed against a fixed snapshot", () => {
  it("pinned -> every purpose is recorded, each as its own row", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bind("pinned", a.artifactId, STEP, a.versionIds[0]);

    const ids: string[] = [];
    for (const purpose of DOWNSTREAM_PURPOSES) {
      const r = await cite(a.versionIds[0]!, purpose);
      expect(r.eligible, purpose).toBe(true);
      expect(r.referenceId, purpose).toBeTruthy();
      ids.push(r.referenceId);
    }
    expect(new Set(ids).size).toBe(5);
    expect((await rowsFor(a.versionIds[0]!)).map((r) => r.purpose).sort()).toEqual(
      [...DOWNSTREAM_PURPOSES].sort(),
    );
  });

  it("upgrading a refused live binding to pinned makes the SAME call succeed", async () => {
    // The strongest form of the counter-proof: one artifact, one version, one call, and the
    // only thing that changes between the refusal and the success is the binding mode. A
    // gate that refused for any other reason would refuse both times.
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    const live = await bind("live", a.artifactId);
    await expect(cite(a.versionIds[0]!)).rejects.toBeInstanceOf(RequiresPinnedError);

    await upgradeBinding(h.deps, {
      userId: AUTHOR, orgId: org(), bindingId: live.id, expectedHeadVersion: 1,
    });

    const ok = await cite(a.versionIds[0]!);
    expect(ok.eligible).toBe(true);
    expect(await rowsFor(a.versionIds[0]!)).toHaveLength(1);
  });

  it("the source moving afterwards does not unmake the citation, and does not extend it (I-8)", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bind("pinned", a.artifactId, STEP, a.versionIds[0]);
    const first = await cite(a.versionIds[0]!);

    // The source moves: a new immutable version appears. The pinned binding does not follow
    // it (I-8), so the citation of v1 stays valid and v2 is not citable at this step.
    const b = await seedArtifact(h, ORG, PROJECT, ["v1\n", "v2\n"], AUTHOR);
    const moved = await seedArtifactVersionOn(a.artifactId);
    expect(b.versionIds).toHaveLength(2); // fixture sanity: the multi-version path really ran

    expect((await rowsFor(a.versionIds[0]!)).map((r) => r.id)).toEqual([first.referenceId]);
    await expect(cite(moved)).rejects.toBeInstanceOf(RequiresPinnedError);
  });
});

/** Pin one more version onto an existing artifact, through the real pin path. */
async function seedArtifactVersionOn(artifactId: string): Promise<string> {
  const { pinVersion } = await import("../../src/application/artifact/pin-version");
  const head = await h.deps.artifacts.headVersionNumber(org(), artifactId);
  const r = await pinVersion(
    { store: h.store, repo: h.deps.artifacts, ids: h.ids },
    {
      orgId: org(), artifactId, expectedHeadVersion: head,
      source: "conversation", title: "a chat", actorId: AUTHOR,
      parts: { "messages.jsonl": new TextEncoder().encode(`v${head + 1}\n`) },
    },
  );
  return r.versionId;
}

/* ──────────────── the DATABASE is the door, not just the use case ────────────────── */

describe("coverage gap ③: a consumer that skips the use case is refused too", () => {
  const insertRaw = (orgId: string, versionId: string, id: string) =>
    asApp(orgId, (c) =>
      c.query(
        `INSERT INTO downstream_references
           (id, org_id, version_id, purpose, referenced_by_kind, referenced_by_id, created_by)
         VALUES ($1,$2,$3,'report-final','report-section','sec-1','u-raw')`,
        [id, orgId, versionId],
      ),
    );

  it("a raw INSERT citing a live-bound version is refused by the trigger", async () => {
    // Five downstream bundles are coming and none of them exists yet. If the rule lived only
    // in `referenceForDownstream`, the sixth consumer would walk past it with its own green
    // test suite and nothing would report it.
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bind("live", a.artifactId);
    await expect(insertRaw(ORG, a.versionIds[0]!, "raw-1")).rejects.toThrow(/REQUIRES_PINNED/);

    // Counter-proof: the same raw INSERT against a PINNED version succeeds, so the trigger
    // discriminates rather than refusing every insert (which would look identical).
    const b = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bind("pinned", b.artifactId, "step-b", b.versionIds[0]);
    await insertRaw(ORG, b.versionIds[0]!, "raw-2");
    expect(await rowsFor(b.versionIds[0]!)).toHaveLength(1);
  });

  it("a version in ANOTHER tenant cannot be cited, and says not-found rather than not-yours", async () => {
    const mine = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bind("pinned", mine.artifactId, STEP, mine.versionIds[0]);

    // The foreign key on `version_id` is not tenant-aware: it accepts any existing version.
    // RLS stops the row from being written under the wrong org, and the trigger answers
    // ARTIFACT_NOT_FOUND rather than naming what it found.
    await expect(insertRaw(OTHER_ORG, mine.versionIds[0]!, "raw-x")).rejects.toThrow(
      /ARTIFACT_NOT_FOUND|violates row-level security/,
    );
    await expect(
      referenceForDownstream(deps, {
        userId: OUTSIDER, orgId: toOrgId(OTHER_ORG), versionId: mine.versionIds[0]!,
        purpose: "acceptance", referencedBy: { kind: "acceptance", id: "ac-1" },
      }),
    ).rejects.toBeInstanceOf(ArtifactNotFoundError);
  });
});

/* ───────────────────────── a citation is an append-only record ───────────────────── */

describe("what was cited stays cited", () => {
  it("the runtime role holds no UPDATE and no DELETE on the table", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n", "v2\n"], AUTHOR);
    await bind("pinned", a.artifactId, STEP, a.versionIds[0]);
    const ref = await cite(a.versionIds[0]!);

    await expect(
      asApp(ORG, (c) =>
        c.query(`UPDATE downstream_references SET version_id = $2 WHERE id = $1`, [
          ref.referenceId, a.versionIds[1],
        ]),
      ),
    ).rejects.toThrow(/permission denied/i);
    await expect(
      asApp(ORG, (c) => c.query(`DELETE FROM downstream_references WHERE id = $1`, [ref.referenceId])),
    ).rejects.toThrow(/permission denied/i);
  });

  it("the OWNER is refused too -- a REVOKE leaves 'fix it by hand in prod' available", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n", "v2\n"], AUTHOR);
    await bind("pinned", a.artifactId, STEP, a.versionIds[0]);
    const ref = await cite(a.versionIds[0]!);

    await expect(
      asOwner((c) => c.query(`DELETE FROM downstream_references WHERE id = $1`, [ref.referenceId])),
    ).rejects.toThrow(/SNAPSHOT_IMMUTABLE/);

    // Re-pointing as the owner: the BEFORE UPDATE trigger re-runs the eligibility rule, so a
    // citation cannot be moved onto bytes nobody pinned.
    await expect(
      asOwner((c) =>
        c.query(`UPDATE downstream_references SET version_id = $2 WHERE id = $1`, [
          ref.referenceId, a.versionIds[1],
        ]),
      ),
    ).rejects.toThrow(/REQUIRES_PINNED/);

    // Cascade counts as an interface (0007's lesson): deleting the artifact reaches this row
    // and is refused before it gets here, by 0007 -- named so the chain is visible.
    await expect(
      asOwner((c) => c.query(`DELETE FROM artifacts WHERE id = $1`, [a.artifactId])),
    ).rejects.toThrow(/SNAPSHOT_IMMUTABLE/);

    // Counter-proof: tenant teardown still works. A discriminator that answered "not a
    // teardown" to everything would hang every suite's cleanup, and one that answered
    // "teardown" to everything would have let the three refusals above through.
    await asOwner((c) => c.query(`DELETE FROM organizations WHERE id = $1`, [ORG]));
    const left = await asOwner(async (c) => {
      const r = await c.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM downstream_references WHERE org_id = $1`,
        [ORG],
      );
      return r.rows[0]!.n;
    });
    expect(left).toBe("0");
  });

  it("a retried citation is idempotent, and a DIFFERENT one is not absorbed into it", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bind("pinned", a.artifactId, STEP, a.versionIds[0]);

    const first = await cite(a.versionIds[0]!, "report-final", { kind: "report", id: "r-1" });
    const retry = await cite(a.versionIds[0]!, "report-final", { kind: "report", id: "r-1" });
    expect(retry.referenceId).toBe(first.referenceId);
    expect(await rowsFor(a.versionIds[0]!)).toHaveLength(1);

    // ...and the three axes that must NOT collapse: another purpose, another citer, another
    // citer kind. Keying uniqueness more widely would forbid the ordinary case (a claim
    // cites several products), which is the failure a dedupe test alone cannot see.
    await cite(a.versionIds[0]!, "acceptance", { kind: "report", id: "r-1" });
    await cite(a.versionIds[0]!, "report-final", { kind: "report", id: "r-2" });
    await cite(a.versionIds[0]!, "report-final", { kind: "claim", id: "r-1" });
    expect(await rowsFor(a.versionIds[0]!)).toHaveLength(4);
  });
});

/* ─────────────────────── I-14 second half: scan the reference table ──────────────── */

describe("I-14: no non-pinned pointer exists anywhere in the reference table", () => {
  it("every stored citation resolves to a version some binding pins", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n", "v2\n"], AUTHOR);
    await bind("pinned", a.artifactId, STEP, a.versionIds[0]);
    await bind("live", a.artifactId, "step-live");
    await cite(a.versionIds[0]!);

    const offenders = await asOwner(async (c) => {
      const r = await c.query<{ id: string }>(
        `SELECT r.id FROM downstream_references r
          WHERE NOT EXISTS (
            SELECT 1 FROM artifact_bindings b
             WHERE b.org_id = r.org_id AND b.mode = 'pinned' AND b.pinned_version_id = r.version_id)`,
      );
      return r.rows.map((x) => x.id);
    });
    expect(offenders).toEqual([]);
    // "Nothing offends" is only meaningful when there was something to scan.
    expect(await rowsFor(a.versionIds[0]!)).toHaveLength(1);
  });

  it("nothing else in the schema points straight at a version -- the door is the only door", async () => {
    // Coverage gap ③ says every downstream must pass through the SAME gate rather than
    // deciding for itself. A future citation table with its own `artifact_version_id` column
    // would satisfy every assertion in this file and bypass all of them, so the shape of the
    // schema is asserted: only these four tables may reference a version.
    const referrers = await asOwner(async (c) => {
      const r = await c.query<{ t: string }>(
        `SELECT DISTINCT con.conrelid::regclass::text AS t
           FROM pg_constraint con
          WHERE con.contype = 'f' AND con.confrelid = 'artifact_versions'::regclass`,
      );
      return r.rows.map((x) => x.t).sort();
    });
    // The five that legitimately name a version, and why each is not a citation:
    //   artifact_bindings        the pin itself -- it is what this gate READS.
    //   derived_representations  OCR / ASR / summary of one version (I-6). Not a citation.
    //   downstream_references    the door.
    //   segments / segment_text  the retrieval projection of a version's content (F04/F10).
    //                            ⚠ the closest thing to a bypass in the list: a Context Pack
    //                            item is assembled from segments, so F13's "Pack 随定版固化"
    //                            must cite through this door and not through segment ids.
    //                            Recorded here so that fact has somewhere to be checked.
    expect(referrers).toEqual([
      "artifact_bindings",
      "derived_representations",
      "downstream_references",
      "segment_text",
      "segments",
    ]);

    // Counter-proof: the query really catches a new referrer. Created and rolled back, so
    // the schema is unchanged -- without this, a query that returned a hard-coded list would
    // look identical.
    const caught = await asOwner(async (c) => {
      await c.query("BEGIN");
      try {
        await c.query(
          `CREATE TABLE f07_probe_referrer (id text PRIMARY KEY,
             version_id text REFERENCES artifact_versions (id))`,
        );
        const r = await c.query<{ t: string }>(
          `SELECT DISTINCT con.conrelid::regclass::text AS t
             FROM pg_constraint con
            WHERE con.contype = 'f' AND con.confrelid = 'artifact_versions'::regclass`,
        );
        return r.rows.map((x) => x.t);
      } finally {
        await c.query("ROLLBACK");
      }
    });
    expect(caught).toContain("f07_probe_referrer");
  });
});

/* ──────────────────────── the schema agrees with the contract ────────────────────── */

describe("the purpose enum is the contract's, not a copy of it", () => {
  it("the CHECK constraint lists exactly DownstreamPurpose, member for member", async () => {
    const src = await asOwner(async (c) => {
      const r = await c.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'downstream_references'::regclass AND contype = 'c'
            AND pg_get_constraintdef(oid) LIKE '%purpose%'`,
      );
      return r.rows.map((x) => x.def).join("\n");
    });
    expect(src, "no purpose CHECK found -- the assertion would pass vacuously").toContain("purpose");
    for (const p of C.DownstreamPurpose.options) {
      expect(src, `${p} is missing from the CHECK`).toContain(`'${p}'`);
    }
    // ...and nothing extra: count the quoted literals so a sixth value in the database
    // (or a removed one in the contract) turns this red rather than passing on a subset.
    expect(src.match(/'[a-z-]+'/g) ?? []).toHaveLength(C.DownstreamPurpose.options.length);
  });

  it("DOWNSTREAM_PURPOSES is inferred from the contract and not restated", () => {
    expect([...DOWNSTREAM_PURPOSES]).toEqual([...C.DownstreamPurpose.options]);
  });
});

/* ───────────────────────────── the pure judgement ───────────────────────────────── */

describe("judgeCitation, exhaustively over the three modes", () => {
  it("only a pinned anchor naming THIS version is eligible", () => {
    // Exhaustive rather than sampled: three modes x (names this version / names another /
    // names none). A predicate is a total function, so there is no reason to sample it.
    expect(Object.keys(MODE_RANK).sort()).toEqual(["draft", "live", "pinned"]);

    expect(judgeCitation("v1", [{ mode: "pinned", pinnedVersionId: "v1" }])).toEqual({
      eligible: true, reason: null,
    });
    for (const anchors of [
      [],
      [{ mode: "draft" as const, pinnedVersionId: null }],
      [{ mode: "live" as const, pinnedVersionId: null }],
      [{ mode: "pinned" as const, pinnedVersionId: "v2" }],
      [{ mode: "draft" as const, pinnedVersionId: null }, { mode: "live" as const, pinnedVersionId: null }],
    ]) {
      expect(judgeCitation("v1", anchors), JSON.stringify(anchors)).toEqual({
        eligible: false, reason: "NOT_PINNED",
      });
    }
    // One pinned anchor among many is enough -- A4 lets one artifact be pinned at one step
    // and live at another, and the live binding must not veto the pinned one.
    expect(
      judgeCitation("v1", [
        { mode: "live", pinnedVersionId: null },
        { mode: "pinned", pinnedVersionId: "v1" },
      ]).eligible,
    ).toBe(true);
  });
});

/* ───────────────────────── the route, and its contract body ──────────────────────── */

describe("POST /artifacts/versions/:versionId/references", () => {
  it("a pinned snapshot returns a contract-valid, STRICT body", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bind("pinned", a.artifactId, STEP, a.versionIds[0]);

    const res = await post(`/artifacts/versions/${a.versionIds[0]}/references`, {
      versionId: a.versionIds[0], purpose: "graph-writeback",
      referencedBy: { kind: "graph-node", id: "n-1" },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    const p = C.operations.referenceForDownstream.out.safeParse(body);
    expect(p.success ? null : p.error.issues, JSON.stringify(body)).toBeNull();
  });

  it("counter-proof: the STRICT out rejects an extra key and a missing one", () => {
    const out = C.operations.referenceForDownstream.out;
    expect(out.safeParse({ referenceId: "r", eligible: true }).success).toBe(true);
    // Without `.strict()` zod silently strips this and the assertion above would pass for a
    // handler that leaked the artifact id into a SUCCESS body. That is the direction a
    // non-strict schema cannot see.
    expect(out.safeParse({ referenceId: "r", eligible: true, artifactId: "a" }).success).toBe(false);
    expect(out.safeParse({ referenceId: "r" }).success).toBe(false);
  });

  it("a live product returns 409 carrying the code AND the artifact to pin (E1)", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bind("live", a.artifactId);

    const res = await post(`/artifacts/versions/${a.versionIds[0]}/references`, {
      versionId: a.versionIds[0], purpose: "report-final",
      referencedBy: { kind: "report-section", id: "s-1" },
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("conflict");
    expect(body.artifactError).toBe("REQUIRES_PINNED");
    // Without this the interface has a refusal it cannot act on, and a dead end is what
    // users route around by copying the content somewhere the gate is not.
    expect(body.artifactId).toBe(a.artifactId);
    expect(typeof body.traceId).toBe("string");
    // ...and still nothing else: no message, no SQL, no stack (the error boundary's contract).
    expect(Object.keys(body).sort()).toEqual(["artifactError", "artifactId", "error", "traceId"]);
  });

  it("an unknown version and a foreign one are both 404, and neither leaks a code", async () => {
    const mine = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bind("pinned", mine.artifactId, STEP, mine.versionIds[0]);

    for (const [versionId, principalOrg] of [
      ["no-such-version", ORG],
      [mine.versionIds[0]!, OTHER_ORG],
    ] as const) {
      const res = await post(
        `/artifacts/versions/${versionId}/references`,
        { versionId, purpose: "brain-promotion", referencedBy: { kind: "brain", id: "b-1" } },
        principalOrg === ORG ? AUTHOR : OUTSIDER,
        principalOrg,
      );
      expect(res.status, `${versionId} @ ${principalOrg}`).toBe(404);
      const body = (await res.json()) as Record<string, unknown>;
      // A foreign version answering 409 REQUIRES_PINNED would confirm the id exists.
      expect(body.artifactError).toBeUndefined();
      expect(body.artifactId).toBeUndefined();
    }
  });

  it("a body the contract rejects never reaches the use case", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bind("pinned", a.artifactId, STEP, a.versionIds[0]);

    const res = await post(`/artifacts/versions/${a.versionIds[0]}/references`, {
      versionId: a.versionIds[0], purpose: "publish-to-linkedin",
      referencedBy: { kind: "claim", id: "c-1" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; fields: { path: string }[] };
    expect(body.error).toBe("validation_failed");
    expect(body.fields.map((f) => f.path)).toContain("purpose");
    expect(await rowsFor(a.versionIds[0]!)).toEqual([]);

    // ...and the path/body disagreement, which would otherwise let a caller address one
    // version while the citation records another.
    const mismatch = await post(`/artifacts/versions/${a.versionIds[0]}/references`, {
      versionId: "some-other-version", purpose: "acceptance",
      referencedBy: { kind: "claim", id: "c-1" },
    });
    expect(mismatch.status).toBe(422);
    expect(await rowsFor(a.versionIds[0]!)).toEqual([]);
  });
});

/* ───────────────── the citation list is guarded like any other tenant read ───────── */

describe("listForVersion hands back Guarded rows", () => {
  it("the payload is unreachable without a decision, and the decision lets the author see it", async () => {
    const a = await seedArtifact(h, ORG, PROJECT, ["v1\n"], AUTHOR);
    await bind("pinned", a.artifactId, STEP, a.versionIds[0]);
    const ref = await cite(a.versionIds[0]!);

    const guarded = await references.listForVersion(org(), a.versionIds[0]!);
    expect(guarded).toHaveLength(1);
    // The wrapper carries no payload property at all -- spreading or serialising it cannot
    // disclose the row. That is the property `permission-filter` exists for.
    expect(JSON.stringify(guarded[0])).not.toContain(ref.referenceId);

    const { visible } = await disclose(h.deps.auth, {
      userId: AUTHOR, orgId: org(), projectId: PROJECT,
      action: "read.published",
      // ⚠ `file-browser`, and not a seventh path. R10 ③ makes 22-files a projection of
      // artifacts/artifact_versions over one `acl_bindings`; a citation list is that
      // projection filtered to one version. Registering a seventh path amends the identity
      // bundle's closed enumeration and is a sign-off decision -- flagged, not taken here.
      path: "file-browser",
      items: guarded,
    });
    expect(visible.map((v) => v.payload.id)).toEqual([ref.referenceId]);
    expect(visible[0]!.payload.purpose).toBe("decision-reference");
  });
});

/* ────────────────────────── what the contract cannot say ─────────────────────────── */

describe("contract gaps found while implementing F07", () => {
  it("`in` names a VERSION, and a version is always a snapshot -- so the literal gate is vacuous", () => {
    const shape = Object.keys(
      (C.operations.referenceForDownstream.in as unknown as { shape: Record<string, unknown> }).shape,
    ).sort();
    expect(shape).toEqual(["purpose", "referencedBy", "versionId"]);
    // No bindingId, no mode, no artifactId. The implementation therefore reads eligibility
    // off the BINDINGS of the version's artifact, which is a divergence from the literal
    // text and is reported. If the contract later carries the citation target properly,
    // this goes red and points at `downstream-eligibility.ts`.
    expect(shape).not.toContain("bindingId");
  });

  it("`SNAPSHOT_IMMUTABLE` is declared for an operation that cannot produce it", () => {
    // The operation writes a reference; it never modifies or deletes a snapshot. Nothing in
    // the implementation maps to it, and saying so here is the difference between a known
    // gap and an unnoticed one.
    expect([...C.operations.referenceForDownstream.err]).toContain("SNAPSHOT_IMMUTABLE");
    const mapped = [...CONTRACT_CODE_BY_ERROR.values()];
    expect(mapped).not.toContain("SNAPSHOT_IMMUTABLE");
    expect(mapped).toContain("REQUIRES_PINNED");
  });

  it("`err` has no permission code, for an operation that WRITES", () => {
    // So no role check is made -- inventing one would invent a rule the signed contract does
    // not have. Tenant isolation is what holds, and it is asserted above. When the codes are
    // added, this goes red and points at `reference-for-downstream.ts`.
    const err = [...C.operations.referenceForDownstream.err];
    expect(err).not.toContain("NO_PROJECT_ROLE");
    expect(err).not.toContain("PROJECT_ROLE_INSUFFICIENT");
  });

  it("`eligible` is a boolean that can only ever be true", () => {
    // `usecases.md` writes the success as `{ referenceId, eligible: true }` while the refusal
    // lives in `err`. A client that "checks eligibility" gets a field that never says no.
    expect(
      C.operations.referenceForDownstream.out.safeParse({ referenceId: "r", eligible: false })
        .success,
    ).toBe(true);
  });

  it("BackflowEntry has no versionId, so the project side cannot construct this call", () => {
    // `listBackflow` is where a downstream consumer sees what a project has: it returns
    // `version` (a NUMBER) and no version id, while `referenceForDownstream.in` requires the
    // id. The two halves of the same user journey do not join up.
    const keys = Object.keys(
      (C.BackflowEntry as unknown as { shape: Record<string, unknown> }).shape,
    );
    expect(keys).toContain("version");
    expect(keys).not.toContain("versionId");
  });

  it("this bundle's out schemas are NOT strict apart from the one F07 touched", () => {
    // Recorded as a measured gap rather than claimed as coverage: `.strict()` is what makes
    // "the response carried a field it should not" assertable, and 30-odd out schemas across
    // three bundles still strip unknown keys silently. Converting them is a cross-bundle
    // change and is not F07's to make.
    const unknownKeysOf = (s: unknown): string | undefined =>
      (s as { _def?: { unknownKeys?: string } })._def?.unknownKeys;
    expect(unknownKeysOf(C.operations.referenceForDownstream.out)).toBe("strict");
    const loose = Object.entries(C.operations)
      .filter(([, op]) => unknownKeysOf((op as { out: unknown }).out) === "strip")
      .map(([n]) => n);
    expect(loose.length, "if this reaches zero the gate below should become a lint").toBeGreaterThan(0);
  });
});
