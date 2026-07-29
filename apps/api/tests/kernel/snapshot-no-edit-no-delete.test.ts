import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asApp, asOwner, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgArtifactRepository } from "../../src/infrastructure/artifact/pg-artifact-repository";
// F08 made the audit trail a REQUIRED dependency of pinVersion: a pin that leaves no
// record is not a pin this system performs, so it cannot be constructed without one.
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { materializeArtifact } from "../../src/application/artifact/materialize-artifact";
import { pinVersion } from "../../src/application/artifact/pin-version";
import type { IdFactory } from "../../src/application/artifact/ports";
import { thresholds as T } from "@repo/contracts";

/**
 * F05 -- R12 V8 / domain I-1 / I-11: a pinned snapshot cannot be modified or deleted, by
 * anyone, through any path.
 *
 * ## Why "the app role is denied" is not the assertion
 *
 * 0006 revoked UPDATE and DELETE on `artifact_versions` from `app_rw` and installed a BEFORE
 * UPDATE trigger, and both work. Measured against a real database before 0007, this was also
 * true:
 *
 *     app_rw: DELETE FROM artifacts WHERE id = ...   ->  DELETE 1, version row GONE
 *
 * because `artifact_versions.artifact_id REFERENCES artifacts ON DELETE CASCADE` and
 * referential actions are performed without a privilege check on the child. The revoke is
 * real; it guards a door beside an open one. So this file asserts what the ROW survives, per
 * path, rather than what a grant says -- and includes the paths nobody thought to revoke.
 *
 * ## Both directions, throughout
 *
 * "Writes are refused" is exactly what a broken connection produces. Every prohibition here
 * is paired with the permitted act it must not have broken: a new version can still be
 * pinned, the mutable artifact head can still be retitled, an artifact with no versions can
 * still be deleted, and a whole tenant can still be torn down.
 */

const ORG = "org-f05-immutable";
const OTHER = "org-f05-immutable-teardown";
const PROJECT = "proj-f05-immutable";

let root: string;
let db: PgDatabase;
let repo: PgArtifactRepository;
let provenance: PgProvenanceRepository;
let store: FsObjectStore;

class SeqIds implements IdFactory {
  private n = 0;
  next(prefix: string): string {
    this.n += 1;
    return `f05i-${prefix}-${this.n}`;
  }
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgArtifactRepository(db);
  provenance = new PgProvenanceRepository(db);
});

afterAll(async () => {
  await db.close();
  await resetOrgs(ORG, OTHER);
  if (root) await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG, OTHER);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  root = await mkdtemp(join(tmpdir(), "wsx-f05i-"));
  store = new FsObjectStore(root);
});

const enc = (s: string) => new TextEncoder().encode(s);

async function pinned(ids: IdFactory, body = "the pinned bytes\n") {
  return materializeArtifact(
    { store, repo, ids },
    {
      orgId: toOrgId(ORG), projectId: PROJECT, source: "conversation", title: "a chat",
      actorId: "u-author", parts: { "messages.jsonl": enc(body) },
    },
  );
}

async function versionCount(artifactId: string): Promise<number> {
  return asApp(ORG, async (c) => {
    const r = await c.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM artifact_versions WHERE artifact_id = $1`, [artifactId],
    );
    return Number(r.rows[0]!.n);
  });
}

describe("I-1: a pinned version cannot be MODIFIED", () => {
  it("the runtime role has no UPDATE privilege at all", async () => {
    const v = await pinned(new SeqIds());
    await expect(
      asApp(ORG, (c) =>
        c.query(`UPDATE artifact_versions SET content_hash = $1 WHERE id = $2`, ["f".repeat(64), v.versionId]),
      ),
    ).rejects.toThrow(/permission denied/i);
    expect((await repo.findVersion(toOrgId(ORG), v.versionId))!.contentHash).toBe(v.contentHash);
  });

  it("and neither does the OWNER -- the trigger refuses a hand-run correction in psql", async () => {
    // The half a revoke cannot cover. "Just fix it in prod" is how an immutable record
    // actually gets rewritten, and it is done as the owner, from a shell, by someone who
    // knows what they are doing.
    const v = await pinned(new SeqIds());
    await expect(
      asOwner((c) =>
        c.query(`UPDATE artifact_versions SET content_hash = $1 WHERE id = $2`, ["f".repeat(64), v.versionId]),
      ),
    ).rejects.toThrow(/SNAPSHOT_IMMUTABLE/);
    expect((await repo.findVersion(toOrgId(ORG), v.versionId))!.contentHash).toBe(v.contentHash);
  });

  it("every column is covered, not just the hash", async () => {
    // A trigger written per-column, or a revoke of UPDATE(content_hash), would pass the two
    // cases above and leave the pointer editable -- which redirects a version at other bytes
    // just as effectively as rewriting the hash does.
    const v = await pinned(new SeqIds());
    for (const [col, val] of [
      ["object_storage_key", "somewhere/else"],
      ["version_number", 99],
      ["mime", "text/plain"],
      ["size_bytes", 1],
      ["pinned_by", "u-someone-else"],
    ] as const) {
      await expect(
        asOwner((c) => c.query(`UPDATE artifact_versions SET ${col} = $1 WHERE id = $2`, [val, v.versionId])),
        `${col} was editable`,
      ).rejects.toThrow(/SNAPSHOT_IMMUTABLE/);
    }
  });

  it("counter-proof: the SAME statement shape succeeds on the mutable head", async () => {
    // Without this the three cases above are also satisfied by a database that refuses every
    // UPDATE, a broken connection, or a role with no rights anywhere. `artifacts` is the
    // mutable half of the model on purpose and must still be writable.
    const v = await pinned(new SeqIds());
    await asApp(ORG, (c) => c.query(`UPDATE artifacts SET title = $1 WHERE id = $2`, ["retitled", v.artifactId]));
    const title = await asApp(ORG, async (c) => {
      const r = await c.query<{ title: string }>(`SELECT title FROM artifacts WHERE id = $1`, [v.artifactId]);
      return r.rows[0]!.title;
    });
    expect(title).toBe("retitled");
  });
});

describe("I-11: a pinned version cannot be DELETED", () => {
  it("not by the runtime role, directly", async () => {
    const v = await pinned(new SeqIds());
    await expect(
      asApp(ORG, (c) => c.query(`DELETE FROM artifact_versions WHERE id = $1`, [v.versionId])),
    ).rejects.toThrow(/permission denied/i);
    expect(await versionCount(v.artifactId)).toBe(1);
  });

  it("not by the runtime role via the parent artifact -- the cascade route (the hole F05 closed)", async () => {
    // ⚠ THIS is the case that was open. `app_rw` holds DELETE on `artifacts`, and the FK
    // cascades. Before 0007 this statement returned DELETE 1 and destroyed the snapshot,
    // with every immutability test of F04 still green.
    const v = await pinned(new SeqIds());
    await expect(
      asApp(ORG, (c) => c.query(`DELETE FROM artifacts WHERE id = $1`, [v.artifactId])),
    ).rejects.toThrow(/SNAPSHOT_IMMUTABLE/);
    expect(await versionCount(v.artifactId)).toBe(1);
    // ...and the bytes are still there too. A row surviving while its object is gone is
    // I-5 broken, and only one of the two is visible in PG.
    expect(await store.head(v.materializedKeys[0]!)).not.toBeNull();
  });

  it("not by the OWNER, directly", async () => {
    const v = await pinned(new SeqIds());
    await expect(
      asOwner((c) => c.query(`DELETE FROM artifact_versions WHERE id = $1`, [v.versionId])),
    ).rejects.toThrow(/SNAPSHOT_IMMUTABLE/);
    expect(await versionCount(v.artifactId)).toBe(1);
  });

  it("not by the OWNER via the parent artifact either", async () => {
    const v = await pinned(new SeqIds());
    await expect(
      asOwner((c) => c.query(`DELETE FROM artifacts WHERE id = $1`, [v.artifactId])),
    ).rejects.toThrow(/SNAPSHOT_IMMUTABLE/);
    expect(await versionCount(v.artifactId)).toBe(1);
  });

  it("not by a blanket DELETE with no WHERE clause", async () => {
    // A per-row trigger is right for this and a statement-level check would not be; asserted
    // because "delete everything" is the shape a cleanup script takes.
    const v = await pinned(new SeqIds());
    await expect(asOwner((c) => c.query(`DELETE FROM artifact_versions`))).rejects.toThrow(/SNAPSHOT_IMMUTABLE/);
    expect(await versionCount(v.artifactId)).toBe(1);
  });

  it("counter-proof: an artifact with NO pinned version is still deletable", async () => {
    // The prohibition is about snapshots, not about artifacts. Blocking the delete
    // unconditionally would pass every assertion above and make an abandoned draft
    // undeletable forever -- a rule wider than the invariant, which is how a rule gets
    // switched off wholesale later.
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO artifacts (id, org_id, project_id, source, title, created_by, synthesized)
         VALUES ($1,$2,NULL,'upload','never pinned','u',false)`,
        ["f05i-art-unpinned", ORG],
      ),
    );
    await asApp(ORG, (c) => c.query(`DELETE FROM artifacts WHERE id = $1`, ["f05i-art-unpinned"]));
    const left = await asApp(ORG, async (c) => {
      const r = await c.query(`SELECT 1 FROM artifacts WHERE id = $1`, ["f05i-art-unpinned"]);
      return r.rowCount;
    });
    expect(left).toBe(0);
  });

  it("counter-proof: tearing down a whole tenant still works, versions and all", async () => {
    // The single opening, and it has to stay open: removing an organization is how a tenant
    // leaves, and every test file's cleanup depends on it. If the discriminator answered
    // "not teardown" to everything, this fails -- and if it answered "teardown" to
    // everything, the six prohibitions above fail. Neither direction is provable alone.
    await seedOrg({ orgId: OTHER, projectId: `${OTHER}-proj` });
    const ids = new SeqIds();
    await materializeArtifact(
      { store, repo, ids },
      {
        orgId: toOrgId(OTHER), projectId: `${OTHER}-proj`, source: "conversation",
        title: "doomed", actorId: "u", parts: { "messages.jsonl": enc("bye\n") },
      },
    );
    await resetOrgs(OTHER);
    const left = await asOwner(async (c) => {
      const r = await c.query(`SELECT 1 FROM artifact_versions WHERE org_id = $1`, [OTHER]);
      return r.rowCount;
    });
    expect(left).toBe(0);
  });
});

describe("the permitted correction: add a version, never edit one", () => {
  it("a new version can be pinned while every earlier one stays byte-identical", async () => {
    // The whole reason immutability is acceptable: "you cannot fix it" would be a defect, and
    // "correct it by adding a version" is the contract's answer (R7 / A3). Without this the
    // file proves only that the system cannot write.
    const ids = new SeqIds();
    const v1 = await pinned(ids, "as first pinned\n");
    const v2 = await pinVersion(
      { store, repo, ids, provenance },
      {
        orgId: toOrgId(ORG), artifactId: v1.artifactId, expectedHeadVersion: 1,
        source: "conversation", title: "a chat", actorId: "u-corrector",
        parts: { "messages.jsonl": enc("the correction\n") },
      },
    );
    expect(v2.versionNumber).toBe(2);
    expect(await versionCount(v1.artifactId)).toBe(2);
    expect(new TextDecoder().decode((await store.get(v1.materializedKeys[0]!))!)).toBe("as first pinned\n");
  });
});

describe("compliance withdrawal: the one exemption, and why it is absent", () => {
  it("its criterion O-39 is unresolved and reading it THROWS rather than defaulting", async () => {
    // Coherence X-4 makes compliance withdrawal the single hole in immutability, and N-1
    // records that its criterion -- which snapshots are under legal hold -- does not exist.
    // 0007 therefore implements no deletion path at all: not a `force` flag, not an exempt
    // role. This asserts the block is still in place, so that the day somebody adds an
    // exemption they have to come past a failing test that says why they cannot yet.
    expect(T.THRESHOLDS.legalHoldCategories.known).toBe(false);
    expect(() => T.requireValue(T.THRESHOLDS.legalHoldCategories, "legalHoldCategories")).toThrow(/尚未裁决/);
    // ...and it is registered as a REAL blocker, not merely as a note. `blockingThresholds()`
    // is what a report reads; a pending item that never appears there is a gap nobody sees.
    expect(T.blockingThresholds().map((b) => b.name)).toContain("legalHoldCategories");
  });

  it("and no deletion escape hatch was added to the schema in its place", async () => {
    // A `force_delete` function, a role exempted from the trigger, a session GUC -- any of
    // these would satisfy every prohibition above (the tests do not use them) while leaving
    // the hole wide open for whoever knows the incantation.
    const fns = await asOwner(async (c) => {
      const r = await c.query<{ proname: string }>(
        `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public' AND (p.proname ILIKE '%force%' OR p.proname ILIKE '%purge%'
             OR p.proname ILIKE '%hard_delete%' OR p.proname ILIKE '%withdraw%')`,
      );
      return r.rows.map((x) => x.proname);
    });
    expect(fns, `unexpected deletion helper(s): ${fns.join(", ")}`).toEqual([]);
  });
});
