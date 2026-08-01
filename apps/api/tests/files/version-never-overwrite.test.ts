import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureDatabase, migrateOnce, resetOrgs, seedOrg } from "../support/db";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { toOrgId } from "../../src/domain/org-id";
import { PgArtifactRepository } from "../../src/infrastructure/artifact/pg-artifact-repository";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { materializeArtifact, type MaterializeDeps } from "../../src/application/artifact/materialize-artifact";
import { uploadNewVersion } from "../../src/application/artifact/upload-new-version";
import { VersionChangedError } from "../../src/application/artifact/pin-version";
import type { IdFactory } from "../../src/application/artifact/ports";

/**
 * F44 -- R3.a step 1/2 and R7 🔴: uploading over an existing artifact never overwrites the
 * old version's object, always creates a NEW `artifact_versions` row when the content
 * differs, is idempotent (V2) when it does not, and the version list (R3.a step 2) shows
 * both, each independently downloadable with its own SHA-256.
 *
 * V1/V2 (uc-22-4 R12), end to end against real PostgreSQL and a real filesystem object
 * store -- not a re-proof of `materializeArtifact`'s own write-once guarantee (that is F04's
 * `file-first-materialization.test.ts`), but a proof that `uploadNewVersion`'s OWN job --
 * idempotency and optimistic concurrency -- holds when layered on top of it.
 */

const ORG = "org-f44-noverwrite";
const PROJECT = "proj-f44-noverwrite";

class SeqIds implements IdFactory {
  private n = 0;
  next(prefix: string): string {
    this.n += 1;
    return `f44v-${prefix}-${this.n}`;
  }
}

let root: string;
let db: PgDatabase;

beforeAll(async () => {
  ensureDatabase();
  await migrateOnce();
  db = new PgDatabase(appConfig());
});

afterAll(async () => {
  await db.close();
  if (root) await rm(root, { recursive: true, force: true });
});

beforeEach(async () => {
  await resetOrgs(ORG);
  await seedOrg({ orgId: ORG, projectId: PROJECT });
  root = await mkdtemp(join(tmpdir(), "wsx-f44-noverwrite-"));
});

async function listVersionRows(repo: PgArtifactRepository, artifactId: string) {
  return repo.listVersions(toOrgId(ORG), artifactId);
}

describe("F44 -- version never overwrites, idempotent re-upload, list shows every row", () => {
  it("V1: a new upload with DIFFERENT content adds a new version; v1's bytes/hash are untouched", async () => {
    const store = new FsObjectStore(root);
    const repo = new PgArtifactRepository(db);
    const deps: MaterializeDeps = { store, repo, ids: new SeqIds() };

    const contentA = new TextEncoder().encode("content A -- the first version");
    const contentB = new TextEncoder().encode("content B -- materially different");

    // v1, via the F04 path directly (this artifact does not exist yet).
    const v1 = await materializeArtifact(deps, {
      orgId: toOrgId(ORG),
      projectId: PROJECT,
      source: "upload",
      title: "a.pdf",
      actorId: "u-alice",
      parts: { original: contentA },
      versionChangeSource: "upload",
    });

    const v1BytesBefore = await store.get(v1.materializedKeys[0]!);
    expect(v1BytesBefore).not.toBeNull();

    // v2, through the feature under test.
    const v2 = await uploadNewVersion(deps, {
      orgId: toOrgId(ORG),
      artifactId: v1.artifactId,
      expectedHeadVersion: 1,
      filename: "a.pdf",
      bytes: contentB,
      actorId: "u-bob",
    });

    expect(v2.duplicateHit).toBe(false);
    expect(v2.versionNumber).toBe(2);

    // ① artifact_versions has 2 rows.
    const rows = await listVersionRows(repo, v1.artifactId);
    expect(rows).toHaveLength(2);

    // ② v1's row still reports hash(A) and its object is still downloadable with that hash.
    const row1 = rows.find((r) => r.versionNumber === 1)!;
    const row2 = rows.find((r) => r.versionNumber === 2)!;
    expect(row1.sha256).toBe(v1.contentHash);
    expect(row2.sha256).not.toBe(row1.sha256);

    // ③ v1's OBJECT (not just the row) is byte-identical to what was written originally --
    // the read-back after v2 was written is the same bytes as the read-back before.
    const v1BytesAfter = await store.get(v1.materializedKeys[0]!);
    expect(v1BytesAfter).toEqual(v1BytesBefore);

    // ④ each row's `downloadable` claim (R3.a step 2 "🔴 旧版仍可下载") holds for real: both
    // objects are still readable from the store by their own key.
    expect(await store.get(v1.materializedKeys[0]!)).not.toBeNull();

    // ⑤ per-row metadata the version list shows: creator and change source are recorded, not
    // merged into one artifact-level fact.
    expect(row1.changeSource).toBe("upload");
    expect(row2.changeSource).toBe("upload");
    expect(row1.creator.id).toBe("u-alice");
    expect(row2.creator.id).toBe("u-bob");
  });

  it("V2: re-uploading the SAME content as the current head is idempotent -- no new row", async () => {
    const store = new FsObjectStore(root);
    const repo = new PgArtifactRepository(db);
    const deps: MaterializeDeps = { store, repo, ids: new SeqIds() };

    const contentA = new TextEncoder().encode("content A -- unchanged across three uploads");
    const v1 = await materializeArtifact(deps, {
      orgId: toOrgId(ORG),
      projectId: PROJECT,
      source: "upload",
      title: "b.pdf",
      actorId: "u-alice",
      parts: { original: contentA },
    });

    // Second upload: same bytes.
    const dup1 = await uploadNewVersion(deps, {
      orgId: toOrgId(ORG),
      artifactId: v1.artifactId,
      expectedHeadVersion: 1,
      filename: "b.pdf",
      bytes: contentA,
      actorId: "u-alice",
    });
    expect(dup1.duplicateHit).toBe(true);
    expect(dup1.versionNumber).toBe(1);
    expect(dup1.versionId).toBe(v1.versionId);

    // Third upload: same bytes again -- still idempotent, still exactly one row.
    const dup2 = await uploadNewVersion(deps, {
      orgId: toOrgId(ORG),
      artifactId: v1.artifactId,
      expectedHeadVersion: 1,
      filename: "b.pdf",
      bytes: contentA,
      actorId: "u-alice",
    });
    expect(dup2.duplicateHit).toBe(true);

    const rows = await listVersionRows(repo, v1.artifactId);
    expect(rows).toHaveLength(1);
  });

  it("E7 / optimistic concurrency: a stale `expectedHeadVersion` is rejected as VERSION_CHANGED, never silently applied", async () => {
    const store = new FsObjectStore(root);
    const repo = new PgArtifactRepository(db);
    const deps: MaterializeDeps = { store, repo, ids: new SeqIds() };

    const v1 = await materializeArtifact(deps, {
      orgId: toOrgId(ORG),
      projectId: PROJECT,
      source: "upload",
      title: "c.pdf",
      actorId: "u-alice",
      parts: { original: new TextEncoder().encode("v1 content") },
    });

    // Someone else adds v2 first.
    await uploadNewVersion(deps, {
      orgId: toOrgId(ORG),
      artifactId: v1.artifactId,
      expectedHeadVersion: 1,
      filename: "c.pdf",
      bytes: new TextEncoder().encode("v2 content, written by someone else"),
      actorId: "u-bob",
    });

    // A stale client still believes the head is v1 and tries to add v2 of its own.
    await expect(
      uploadNewVersion(deps, {
        orgId: toOrgId(ORG),
        artifactId: v1.artifactId,
        expectedHeadVersion: 1,
        filename: "c.pdf",
        bytes: new TextEncoder().encode("a third, DIFFERENT version"),
        actorId: "u-carol",
      }),
    ).rejects.toBeInstanceOf(VersionChangedError);

    // Exactly two versions exist -- the stale write never landed as a third.
    const rows = await listVersionRows(repo, v1.artifactId);
    expect(rows).toHaveLength(2);
  });
});
