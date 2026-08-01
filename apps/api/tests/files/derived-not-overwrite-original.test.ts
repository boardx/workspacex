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
import {
  createDerivedRepresentation,
  type CreateDerivedDeps,
} from "../../src/application/artifact/create-derived-representation";
import type { IdFactory } from "../../src/application/artifact/ports";

/**
 * F44 -- R3.b step 7 🔴 (V3, R7's second 🔴): rerunning a derivation (OCR upgraded, model
 * bumped) produces a NEW `derived_representations` row -- it never updates the old one, and
 * the ORIGINAL's bytes/hash are provably untouched by the rerun, because the rerun's code
 * path has no reference to the original's storage key at all.
 *
 * Also covers R3.b step 6 (embedding is registered but never materialized as a file) and
 * step 5 (`derived_from` is the exact version id, and `generatorModel`/`generatorVersion`
 * are never empty).
 */

const ORG = "org-f44-derived";
const PROJECT = "proj-f44-derived";

class SeqIds implements IdFactory {
  private n = 0;
  next(prefix: string): string {
    this.n += 1;
    return `f44d-${prefix}-${this.n}`;
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
  root = await mkdtemp(join(tmpdir(), "wsx-f44-derived-"));
});

describe("F44 -- rerunning a derivation never touches the original (V3, R7 🔴)", () => {
  it("🔴 two OCR reruns: original hash/bytes unchanged, TWO independent derived rows, both downloadable", async () => {
    const store = new FsObjectStore(root);
    const repo = new PgArtifactRepository(db);
    const ids = new SeqIds();
    const matDeps: MaterializeDeps = { store, repo, ids };
    const drvDeps: CreateDerivedDeps = { store, repo, ids };

    // The original: a PDF-shaped upload.
    const original = await materializeArtifact(matDeps, {
      orgId: toOrgId(ORG),
      projectId: PROJECT,
      source: "upload",
      title: "scan.pdf",
      actorId: "u-alice",
      parts: { original: new TextEncoder().encode("%PDF-1.4 pretend-scanned-bytes") },
    });
    const originalHashBefore = original.contentHash;
    const originalBytesBefore = await store.get(original.materializedKeys[0]!);

    // First OCR pass.
    const ocr1 = await createDerivedRepresentation(drvDeps, {
      orgId: toOrgId(ORG),
      artifactVersionId: original.versionId,
      kind: "ocr",
      fileName: "text.ocr.txt",
      bytes: new TextEncoder().encode("recognised text, pass 1 (paddle-ocr 2.7.1)"),
      generatorModel: "paddle-ocr",
      generatorVersion: "2.7.1",
      pipelineVersion: "ingest-2026.07",
    });

    // Parser/model upgraded, rerun.
    const ocr2 = await createDerivedRepresentation(drvDeps, {
      orgId: toOrgId(ORG),
      artifactVersionId: original.versionId,
      kind: "ocr",
      fileName: "text.ocr.txt",
      bytes: new TextEncoder().encode("recognised text, pass 2 -- upgraded model (paddle-ocr 3.0.0)"),
      generatorModel: "paddle-ocr",
      generatorVersion: "3.0.0",
      pipelineVersion: "ingest-2026.08",
    });

    // ① the original's hash is COMPLETELY unchanged.
    const originalAfter = await repo.findVersion(toOrgId(ORG), original.versionId);
    expect(originalAfter!.contentHash).toBe(originalHashBefore);
    // ...and its bytes, read back from the store, are unchanged too -- not just the row.
    expect(await store.get(original.materializedKeys[0]!)).toEqual(originalBytesBefore);

    // ② derived_representations gained a NEW row, not an update of the old one: two ids,
    // both present.
    expect(ocr1.derivedId).not.toBe(ocr2.derivedId);
    const derived = await repo.listDerived(toOrgId(ORG), original.artifactId);
    expect(derived).toHaveLength(2);

    // ③ both OCR passes are independently downloadable, distinct files -- not one file two
    // rows pointing at it (which would make ② true while V3's actual promise, "旧派生版本保留
    // 可下载", false).
    const sorted = derived.slice().sort((a, b) => (a.id < b.id ? -1 : 1));
    const d1 = sorted[0]!;
    const d2 = sorted[1]!;
    expect(d1.objectStorageKey).not.toBeNull();
    expect(d2.objectStorageKey).not.toBeNull();
    expect(d1.objectStorageKey).not.toBe(d2.objectStorageKey);
    expect(await store.get(d1.objectStorageKey!)).not.toBeNull();
    expect(await store.get(d2.objectStorageKey!)).not.toBeNull();
    // The two passes' bytes really do differ -- proof this is not the same object under two
    // rows.
    expect(await store.get(d1.objectStorageKey!)).not.toEqual(await store.get(d2.objectStorageKey!));

    // ④ every derivative names the exact VERSION it came from, never the artifact (N-15).
    for (const d of derived) expect(d.derivedFrom).toBe(original.versionId);

    // ⑤ generator identity is never empty.
    for (const d of derived) {
      expect(d.generatorModel.length).toBeGreaterThan(0);
      expect(d.generatorVersion.length).toBeGreaterThan(0);
    }
  });

  it("embedding is registered but never materialized as a file (R3.b step 4's one exception)", async () => {
    const store = new FsObjectStore(root);
    const repo = new PgArtifactRepository(db);
    const ids = new SeqIds();
    const matDeps: MaterializeDeps = { store, repo, ids };
    const drvDeps: CreateDerivedDeps = { store, repo, ids };

    const original = await materializeArtifact(matDeps, {
      orgId: toOrgId(ORG),
      projectId: PROJECT,
      source: "upload",
      title: "notes.md",
      actorId: "u-alice",
      parts: { original: new TextEncoder().encode("some notes") },
    });

    const emb = await createDerivedRepresentation(drvDeps, {
      orgId: toOrgId(ORG),
      artifactVersionId: original.versionId,
      kind: "embedding",
      fileName: "unused",
      generatorModel: "text-embedding-3",
      generatorVersion: "2026-05",
      pipelineVersion: "ingest-2026.07",
    });

    expect(emb.objectStorageKey).toBeNull();

    const derived = await repo.listDerived(toOrgId(ORG), original.artifactId);
    expect(derived).toHaveLength(1);
    expect(derived[0]!.objectStorageKey).toBeNull();
    expect(derived[0]!.kind).toBe("embedding");
  });

  it("a non-embedding kind with no bytes is refused rather than silently registered with no file", async () => {
    const store = new FsObjectStore(root);
    const repo = new PgArtifactRepository(db);
    const ids = new SeqIds();
    const matDeps: MaterializeDeps = { store, repo, ids };
    const drvDeps: CreateDerivedDeps = { store, repo, ids };

    const original = await materializeArtifact(matDeps, {
      orgId: toOrgId(ORG),
      projectId: PROJECT,
      source: "upload",
      title: "audio.webm",
      actorId: "u-alice",
      parts: { original: new TextEncoder().encode("pretend audio bytes") },
    });

    await expect(
      createDerivedRepresentation(drvDeps, {
        orgId: toOrgId(ORG),
        artifactVersionId: original.versionId,
        kind: "asr",
        fileName: "transcript.jsonl",
        generatorModel: "whisper-large-v3",
        generatorVersion: "2026-05",
        pipelineVersion: "ingest-2026.07",
      }),
    ).rejects.toThrow(/requires a materialized file/);
  });
});
