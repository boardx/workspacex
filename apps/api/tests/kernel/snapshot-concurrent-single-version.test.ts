import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgArtifactRepository } from "../../src/infrastructure/artifact/pg-artifact-repository";
// F08 made the audit trail a REQUIRED dependency of pinVersion: a pin that leaves no
// record is not a pin this system performs, so it cannot be constructed without one.
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { pinVersion, VersionChangedError } from "../../src/application/artifact/pin-version";
import { materializeArtifact, MaterializationFailedError } from "../../src/application/artifact/materialize-artifact";
import {
  DuplicateVersionNumberError,
  type ArtifactRepository,
  type IdFactory,
} from "../../src/application/artifact/ports";

/**
 * F05 -- E4 / R12 V6 / domain I-10: two people pinning at once produce ONE new version, and
 * the loser is told the head moved.
 *
 * ## The thing this file is really guarding
 *
 * `read head` then `write head + 1` is check-then-act. It is correct on every sequential run
 * and wrong in exactly the window the requirement is about, so a test that only pins with a
 * stale `expectedHeadVersion` passes against an implementation whose entire concurrency story
 * is that pre-check -- i.e. against an implementation with no enforcement at all.
 *
 * So there are three loser paths and each is provoked separately:
 *
 *   pre-check     stale `expectedHeadVersion`, caught before any write
 *   object store  both writers computed vN, `putOnce` is write-once (`VersionKeyTakenError`)
 *   unique index  both writers reached PG, `artifact_versions_uniq_number` fired
 *
 * and the last two are the ones that hold when the first is skipped.
 *
 * ## Both directions, everywhere
 *
 * "The second pin failed" is what a broken writer produces too, so every case also asserts
 * that the WINNER succeeded, that exactly one row was added, and that the version numbers in
 * the table are 1..n with no gap and no duplicate.
 */

const ORG = "org-f05-concurrent";
const PROJECT = "proj-f05-concurrent";

let root: string;
let db: PgDatabase;
let repo: PgArtifactRepository;
let provenance: PgProvenanceRepository;
let store: FsObjectStore;

class SeqIds implements IdFactory {
  private n = 0;
  next(prefix: string): string {
    this.n += 1;
    return `f05c-${prefix}-${this.n}`;
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
  if (root) await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  root = await mkdtemp(join(tmpdir(), "wsx-f05c-"));
  store = new FsObjectStore(root);
});

const enc = (s: string) => new TextEncoder().encode(s);

/**
 * ONE id factory per artifact, shared by everyone pinning it.
 *
 * ⚠ Not a convenience. Two fresh factories mint the SAME first id, so a second "concurrent"
 * caller with its own factory dies on `artifacts_pkey` before reaching any of the logic under
 * test -- and the assertion "only one version exists" then passes for a reason that has
 * nothing to do with concurrency control. That is exactly how F04's write-nothing test stayed
 * green with the feature disabled (coherence 修订 D). Distinct ids per writer are what make
 * the race real rather than a primary-key collision wearing its costume.
 */
async function seedArtifact(ids: IdFactory) {
  return materializeArtifact(
    { store, repo, ids },
    {
      orgId: toOrgId(ORG), projectId: PROJECT, source: "conversation", title: "a chat",
      actorId: "u-a", parts: { "messages.jsonl": enc("v1\n") },
    },
  );
}

const pin = (ids: IdFactory, artifactId: string, expectedHeadVersion: number, actorId: string, body: string) =>
  pinVersion(
    { store, repo, ids, provenance },
    {
      orgId: toOrgId(ORG), artifactId, expectedHeadVersion,
      source: "conversation", title: "a chat", actorId, parts: { "messages.jsonl": enc(body) },
    },
  );

/** Every version number of an artifact, ascending. */
async function versionNumbers(artifactId: string): Promise<number[]> {
  return asApp(ORG, async (c) => {
    const r = await c.query<{ version_number: number }>(
      `SELECT version_number FROM artifact_versions WHERE artifact_id = $1 ORDER BY version_number`,
      [artifactId],
    );
    return r.rows.map((x) => x.version_number);
  });
}

describe("V6: concurrent pinning yields one new version number", () => {
  it("truly simultaneous pins -- one wins, the other gets VERSION_CHANGED, and 1..2 has no gap", async () => {
    const ids = new SeqIds();
    const a = await seedArtifact(ids);

    // Both started with the same view of the head, and neither awaits the other. This is the
    // race the pre-check cannot see.
    const results = await Promise.allSettled([
      pin(ids, a.artifactId, 1, "u-a", "from a\n"),
      pin(ids, a.artifactId, 1, "u-b", "from b\n"),
    ]);

    const won = results.filter((r) => r.status === "fulfilled");
    const lost = results.filter((r) => r.status === "rejected");
    expect(won.length, "both pins succeeded -- two writers created a v2").toBe(1);
    expect(lost.length).toBe(1);

    // The loser's error is the contract's, not a driver's. A user is offered refresh /
    // compare / re-pin off the back of this (R8); a raw 23505 offers nothing.
    const reason = (lost[0] as PromiseRejectedResult).reason;
    expect(reason, `loser rejected with ${reason}`).toBeInstanceOf(VersionChangedError);

    // The winner's version is real and the table agrees: exactly 1 and 2, once each.
    expect((won[0] as PromiseFulfilledResult<{ versionNumber: number }>).value.versionNumber).toBe(2);
    expect(await versionNumbers(a.artifactId)).toEqual([1, 2]);
  });

  it("five at once still produce exactly one v2", async () => {
    // Two racers can be survived by an implementation that is merely lucky about ordering.
    // With five, an unguarded writer produces several v2 rows or several objects at the same
    // key, and both are visible in the assertions below.
    const ids = new SeqIds();
    const a = await seedArtifact(ids);

    const results = await Promise.allSettled(
      [1, 2, 3, 4, 5].map((n) => pin(ids, a.artifactId, 1, `u-${n}`, `from ${n}\n`)),
    );
    expect(results.filter((r) => r.status === "fulfilled").length).toBe(1);
    for (const r of results.filter((x) => x.status === "rejected")) {
      expect((r as PromiseRejectedResult).reason).toBeInstanceOf(VersionChangedError);
    }
    expect(await versionNumbers(a.artifactId)).toEqual([1, 2]);
  });

  it("the loser can simply re-pin against the new head, and gets v3", async () => {
    // The other half of "版本已变化，可刷新/对比/重新定版". A rejection that leaves the
    // artifact un-pinnable would satisfy every assertion above and be useless.
    const ids = new SeqIds();
    const a = await seedArtifact(ids);
    await Promise.allSettled([pin(ids, a.artifactId, 1, "u-a", "a\n"), pin(ids, a.artifactId, 1, "u-b", "b\n")]);

    const retried = await pin(ids, a.artifactId, 2, "u-b", "b, again\n");
    expect(retried.versionNumber).toBe(3);
    expect(await versionNumbers(a.artifactId)).toEqual([1, 2, 3]);
  });
});

describe("the three loser paths, provoked one at a time", () => {
  it("path 1 -- a stale expectedHeadVersion is refused before anything is written", async () => {
    const ids = new SeqIds();
    const a = await seedArtifact(ids);
    await pin(ids, a.artifactId, 1, "u-a", "v2\n");

    const before = await versionNumbers(a.artifactId);
    // u-b still believes the head is 1.
    await expect(pin(ids, a.artifactId, 1, "u-b", "stale\n")).rejects.toThrow(VersionChangedError);
    // Nothing half-written: no extra row, and the error names both numbers so the interface
    // can say what changed.
    expect(await versionNumbers(a.artifactId)).toEqual(before);
    await pin(ids, a.artifactId, 2, "u-b", "stale\n").catch(() => undefined);
    const err = await pin(ids, a.artifactId, 1, "u-b", "x\n").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(VersionChangedError);
    expect((err as VersionChangedError).expected).toBe(1);
    expect((err as VersionChangedError).actual).toBe(3);
  });

  it("path 2 -- the object store refuses the second writer's key, and that is VERSION_CHANGED", async () => {
    // Provoked directly: the key for v2 is taken before the pin runs, so the pre-check passes
    // (the head really is 1) and `putOnce` is what refuses. This is the enforcement that
    // holds when the check-then-act window is lost.
    const ids = new SeqIds();
    const a = await seedArtifact(ids);
    await store.putOnce(`${ORG}/artifacts/${a.artifactId}/v2/messages.jsonl`, enc("someone else's v2\n"), "application/jsonl");

    await expect(pin(ids, a.artifactId, 1, "u-b", "mine\n")).rejects.toThrow(VersionChangedError);
    // No row was written for a v2 this caller did not create.
    expect(await versionNumbers(a.artifactId)).toEqual([1]);
  });

  it("path 3 -- the unique index refuses the second writer's row, and that is VERSION_CHANGED", async () => {
    // The store cannot refuse here: the row for v2 exists but its object does not, so the key
    // is free. Only `artifact_versions_uniq_number` is left -- the case a store with different
    // key derivation, or an ingested original arriving alongside a Studio pin, puts us in.
    //
    // ⚠ The head is reported STALE on purpose, and that is the whole construction. The first
    // version of this test simply inserted the v2 row and pinned with `expectedHeadVersion: 1`
    // -- but then `headVersionNumber` returns 2 and the PRE-CHECK rejects, so the unique index
    // is never reached. It passed, and it went on passing with the 23505 mapping deleted:
    // green, testing nothing. A stale head is also what concurrency actually IS -- the
    // pre-check's information was true when it was read and is false by the time it is used.
    //
    // Only `headVersionNumber` is faked. The insert, the constraint and the error mapping --
    // everything under test -- are the real repository against the real database.
    const ids = new SeqIds();
    const a = await seedArtifact(ids);
    await asApp(ORG, (c) =>
      c.query(
        `INSERT INTO artifact_versions
           (id, org_id, artifact_id, version_number, object_storage_key, content_hash, mime, size_bytes, pinned_by)
         VALUES ($1,$2,$3,2,$4,$5,'application/jsonl',7,'u-other')`,
        [`${a.artifactId}-other-v2`, ORG, a.artifactId, `elsewhere/${a.artifactId}/v2`, "b".repeat(64)],
      ),
    );

    const staleHead: ArtifactRepository = {
      ...repo,
      createVersion: (v) => repo.createVersion(v),
      createArtifact: (x) => repo.createArtifact(x),
      findVersion: (o, v) => repo.findVersion(o, v),
      addSegments: (o, s) => repo.addSegments(o, s),
      findSegments: (o, v) => repo.findSegments(o, v),
      headVersionNumber: () => Promise.resolve(1),
      listVersions: (o, id) => repo.listVersions(o, id),
      createDerived: (d) => repo.createDerived(d),
      listDerived: (o, id) => repo.listDerived(o, id),
    };

    await expect(
      pinVersion(
        { store, repo: staleHead, ids, provenance },
        {
          orgId: toOrgId(ORG), artifactId: a.artifactId, expectedHeadVersion: 1,
          source: "conversation", title: "a chat", actorId: "u-b",
          parts: { "messages.jsonl": enc("mine\n") },
        },
      ),
    ).rejects.toThrow(VersionChangedError);
    // The other writer's v2 is intact and no third row appeared.
    expect(await versionNumbers(a.artifactId)).toEqual([1, 2]);
  });

  it("counter-proof: the repository really does raise DuplicateVersionNumberError, not a driver error", async () => {
    // Path 3 above would pass if `createVersion` threw anything at all AND the pin path
    // happened to map it -- but it maps only this type, so if the repository stopped
    // translating 23505 the mapping would silently stop applying. Asserted at the source.
    const ids = new SeqIds();
    const a = await seedArtifact(ids);
    await expect(
      repo.createVersion({
        id: `${a.artifactId}-dup`, orgId: toOrgId(ORG), artifactId: a.artifactId, versionNumber: 1,
        objectStorageKey: `elsewhere/${a.artifactId}/dup`, contentHash: "c".repeat(64),
        mime: "text/plain", sizeBytes: 3, pinnedBy: "u", contextPackId: null, derivedFrom: null,
      }),
    ).rejects.toThrow(DuplicateVersionNumberError);
  });

  it("counter-proof: an ordinary materialization failure is NOT reported as a concurrent edit", async () => {
    // The failure mode this guards is the mapping being too wide. `VersionKeyTakenError`
    // extends `MaterializationFailedError`, so a catch written in the other order turns every
    // missing-file error into "version changed" -- telling a user to refresh their way out of
    // a file they never supplied.
    const ids = new SeqIds();
    const a = await seedArtifact(ids);
    const err = await pinVersion(
      { store, repo, ids, provenance },
      {
        orgId: toOrgId(ORG), artifactId: a.artifactId, expectedHeadVersion: 1,
        source: "survey", title: "a survey", actorId: "u",
        parts: { "responses.csv": enc("a,b\n") }, // schema.json missing
      },
    ).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(MaterializationFailedError);
    expect(err).not.toBeInstanceOf(VersionChangedError);
    expect(await versionNumbers(a.artifactId)).toEqual([1]);
  });
});

describe("version numbers are monotonic and unique (I-10)", () => {
  it("the unique index exists and is on (artifact_id, version_number)", async () => {
    // Read out of the catalog rather than asserted through behaviour alone: the behavioural
    // tests above would keep passing if the index were dropped and the application check
    // happened to win every race in a single-process test run.
    const cols = await asApp(ORG, async (c) => {
      const r = await c.query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'artifact_versions_uniq_number'`,
      );
      return r.rows[0]?.def ?? "";
    });
    expect(cols).toMatch(/UNIQUE \(artifact_id, version_number\)/);
  });

  it("sequential pins number 1,2,3 with no gaps", async () => {
    const ids = new SeqIds();
    const a = await seedArtifact(ids);
    await pin(ids, a.artifactId, 1, "u", "2\n");
    await pin(ids, a.artifactId, 2, "u", "3\n");
    expect(await versionNumbers(a.artifactId)).toEqual([1, 2, 3]);
  });
});
