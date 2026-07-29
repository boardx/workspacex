import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgArtifactRepository } from "../../src/infrastructure/artifact/pg-artifact-repository";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { computeContentHash } from "../../src/domain/artifact/content-hash";
import { pinVersion } from "../../src/application/artifact/pin-version";
import type { IdFactory } from "../../src/application/artifact/ports";
import { materializeArtifact } from "../../src/application/artifact/materialize-artifact";

/**
 * F05 -- AC2 / R12 V2 / domain I-8: pinning v1, then changing the source, leaves v1 BYTE
 * IDENTICAL.
 *
 * ## Why the assertion is on hashes and on bytes, never on length
 *
 * `expect(a.length).toBe(b.length)` passes for every pair of same-sized buffers, which
 * includes the corruption this invariant is about: an OCR step or a restore that replaces an
 * object with a different object of the same size. The claim is byte equality, so the check
 * recomputes SHA-256 over what came back out of storage and compares the decoded content as
 * well.
 *
 * ## Both directions
 *
 * "The old version did not change" is satisfied trivially by a system that cannot write at
 * all, so every case here also asserts that pinning a NEW version worked: a v2 exists, it
 * has its own number, its own key and a different hash. An immutability test with no
 * successful write in it is a test of an outage.
 */

const ORG = "org-f05-roundtrip";
const PROJECT = "proj-f05-roundtrip";

let root: string;
let db: PgDatabase;
let repo: PgArtifactRepository;
let store: FsObjectStore;

/**
 * File-scoped id prefix. `artifacts.id` is a GLOBAL primary key, not tenant-scoped, so two
 * test files running in parallel against separate orgs still collide on a bare `art-1` -- the
 * symptom is `duplicate key violates artifacts_pkey` in a test that has nothing to do with
 * ids. (F04 recorded this; the shared cause is noted in coherence 修订 D.)
 */
class SeqIds implements IdFactory {
  private n = 0;
  next(prefix: string): string {
    this.n += 1;
    return `f05r-${prefix}-${this.n}`;
  }
}

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
  repo = new PgArtifactRepository(db);
});

afterAll(async () => {
  await db.close();
  if (root) await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  root = await mkdtemp(join(tmpdir(), "wsx-f05r-"));
  store = new FsObjectStore(root);
});

const enc = (s: string) => new TextEncoder().encode(s);
const dec = (b: Uint8Array) => new TextDecoder().decode(b);

/** Create the artifact and its v1 through the ordinary save path, so pinning has a head. */
async function seedArtifact(ids: IdFactory, body: string) {
  return materializeArtifact(
    { store, repo, ids },
    {
      orgId: toOrgId(ORG), projectId: PROJECT, source: "conversation", title: "a chat",
      actorId: "u-author", parts: { "messages.jsonl": enc(body) },
    },
  );
}

describe("AC2: changing the source does not change an already-pinned snapshot", () => {
  it("v1's bytes, hash and key are untouched after v2 is pinned -- and v2 really was created", async () => {
    const ids = new SeqIds();
    const original = "the answers as they stood when the decision was taken\n";
    const v1 = await seedArtifact(ids, original);

    // Everything about v1, captured from STORAGE and from PG before anything else happens.
    const v1Bytes = (await store.get(v1.materializedKeys[0]!))!;
    const v1Hash = computeContentHash(v1Bytes);
    const v1Row = await repo.findVersion(toOrgId(ORG), v1.versionId);
    expect(v1Row).not.toBeNull();

    // The source moves on. This is "改源" -- a later, different save on the same artifact.
    const v2 = await pinVersion(
      { store, repo, ids },
      {
        orgId: toOrgId(ORG), artifactId: v1.artifactId, expectedHeadVersion: 1,
        source: "conversation", title: "a chat", actorId: "u-author",
        parts: { "messages.jsonl": enc("a completely rewritten history\n") },
      },
    );

    // ── direction 1: the new version exists and is genuinely new ────────────────────────
    expect(v2.versionNumber).toBe(2);
    expect(v2.objectStorageKey).not.toBe(v1.materializedKeys[0]);
    expect(v2.contentHash).not.toBe(v1.contentHash);

    // ── direction 2: v1 is exactly what it was ──────────────────────────────────────────
    const again = (await store.get(v1.materializedKeys[0]!))!;
    // Byte equality, three ways. The hash is the claim the rest of the system trusts; the
    // decoded string is what a human would notice; `toEqual` on the arrays is the literal
    // reading of "字节一致" and the only one that a same-length substitution cannot pass.
    expect(computeContentHash(again)).toBe(v1Hash);
    expect(dec(again)).toBe(original);
    expect(Array.from(again)).toEqual(Array.from(v1Bytes));

    // ...and PG still asserts the same thing about it.
    const v1RowAgain = await repo.findVersion(toOrgId(ORG), v1.versionId);
    expect(v1RowAgain).toEqual(v1Row);
    expect(v1RowAgain!.contentHash).toBe(v1.contentHash);
  });

  it("the artifact's own mutable fields can move without disturbing a pinned version", async () => {
    // `artifacts` is the mutable head -- app_rw holds UPDATE on it, and retitling is an
    // ordinary act. The version must not follow. This is the difference between pinning to a
    // VERSION and pinning to an ARTIFACT (D-30), stated as an assertion rather than as a
    // schema comment.
    const ids = new SeqIds();
    const v1 = await seedArtifact(ids, "as pinned\n");
    const before = await repo.findVersion(toOrgId(ORG), v1.versionId);

    await asApp(ORG, (c) =>
      c.query(`UPDATE artifacts SET title = $1 WHERE id = $2`, ["renamed after the fact", v1.artifactId]),
    );

    const title = await asApp(ORG, async (c) => {
      const r = await c.query<{ title: string }>(`SELECT title FROM artifacts WHERE id = $1`, [v1.artifactId]);
      return r.rows[0]!.title;
    });
    // The update really happened -- otherwise this test proves nothing about what survived it.
    expect(title).toBe("renamed after the fact");
    expect(await repo.findVersion(toOrgId(ORG), v1.versionId)).toEqual(before);
    expect(dec((await store.get(v1.materializedKeys[0]!))!)).toBe("as pinned\n");
  });

  it("three versions deep, every earlier snapshot still reads back as itself", async () => {
    // One rewrite could pass by luck -- a writer that happens to allocate a fresh key while
    // still being capable of clobbering an older one would look fine at n=2. Every version is
    // re-read AFTER the last write, not as it is created.
    const ids = new SeqIds();
    const bodies = ["first\n", "second\n", "third\n"];
    const first = await seedArtifact(ids, bodies[0]!);
    const keys = [first.materializedKeys[0]!];

    for (let n = 1; n < bodies.length; n++) {
      const r = await pinVersion(
        { store, repo, ids },
        {
          orgId: toOrgId(ORG), artifactId: first.artifactId, expectedHeadVersion: n,
          source: "conversation", title: "a chat", actorId: "u-author",
          parts: { "messages.jsonl": enc(bodies[n]!) },
        },
      );
      expect(r.versionNumber).toBe(n + 1);
      keys.push(r.objectStorageKey);
    }

    expect(new Set(keys).size).toBe(3);
    for (let i = 0; i < bodies.length; i++) {
      expect(dec((await store.get(keys[i]!))!), `v${i + 1} was overwritten`).toBe(bodies[i]);
    }
  });
});

describe("the hash in PG is the hash of the bytes in storage, still, afterwards (I-3)", () => {
  it("re-hashing v1's object after later pins reproduces the recorded per-file hash", async () => {
    const ids = new SeqIds();
    const v1 = await seedArtifact(ids, "evidence\n");
    await pinVersion(
      { store, repo, ids },
      {
        orgId: toOrgId(ORG), artifactId: v1.artifactId, expectedHeadVersion: 1,
        source: "conversation", title: "a chat", actorId: "u",
        parts: { "messages.jsonl": enc("different evidence\n") },
      },
    );

    // The version hash is the digest OVER the per-file hashes (a version can be several
    // files), so it is reconstructed the same way rather than compared to a single file's
    // hash -- which would fail for `survey` and pass here, i.e. would be a test of
    // `conversation` having exactly one part.
    const row = (await repo.findVersion(toOrgId(ORG), v1.versionId))!;
    const fileHash = computeContentHash((await store.get(row.objectStorageKey))!);
    expect(computeContentHash(enc(fileHash))).toBe(row.contentHash);
  });

  it("counter-proof: the same check FAILS when the object behind a version is tampered with", async () => {
    // Without this, the assertion above is satisfied by any pair of consistent values,
    // including two that were both computed from the same in-memory buffer. Here the object
    // on disk is replaced behind the store's back -- the exact I-2 breach the domain warns
    // cannot be prevented from the application side -- and the recomputation must diverge.
    const ids = new SeqIds();
    const v1 = await seedArtifact(ids, "evidence\n");
    const row = (await repo.findVersion(toOrgId(ORG), v1.versionId))!;

    const { writeFile } = await import("node:fs/promises");
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update(row.objectStorageKey).digest("hex").slice(0, 12);
    await writeFile(join(root, ...row.objectStorageKey.split("/"), `_${digest}`), "tampered\n");

    const fileHash = computeContentHash((await store.get(row.objectStorageKey))!);
    expect(computeContentHash(enc(fileHash))).not.toBe(row.contentHash);
    // ...and PG went on asserting the old hash, which is the point of I-2 being a separate
    // invariant: the database cannot notice this, only a verification pass can.
    expect(row.contentHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
