/**
 * Shared fixture for the DB-backed F17 files.
 *
 * ⚠ `artifacts.id` / `segments.id` are GLOBALLY unique, so every id minted here carries the
 * caller's own prefix. Two F17 files seeding `f17-art-1` would pass alone and collide the
 * moment vitest runs them in parallel -- and the failure reads as flaky rather than as an id
 * collision.
 *
 * ⚠ Real bytes, not just rows. The export transport refuses to copy a version whose source
 * object is missing (an empty copy passes every row-level assertion and is worthless), so a
 * fixture that only wrote rows would make every export test fail for a reason unrelated to
 * what it asserts.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ObjectExistsError } from "../../src/application/artifact/ports";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { addOrgMember, addSegment, asApp, seedOrg } from "./db";

/**
 * Point the app's object store at a directory this test owns, BEFORE `createApp` is imported.
 *
 * `objectStoreRoot()` reads the environment on every call for exactly this reason -- a
 * module-level constant would have been frozen by whichever import ran first.
 */
export function useTempObjectStore(): string {
  const root = mkdtempSync(join(tmpdir(), "wsx-f17-objects-"));
  process.env.WORKSPACEX_OBJECT_ROOT = root;
  return root;
}

export interface ExportFixture {
  readonly localOrg: string;
  readonly realOrg: string;
  readonly owner: string;
  readonly colleague: string;
  readonly artifactIds: readonly string[];
  /** artifactId -> the bytes seeded for its only version. */
  readonly bytes: ReadonlyMap<string, string>;
}

/**
 * A local organization with `count` artifacts, and a real organization the same person is
 * also in.
 *
 * The colleague matters: `previewVisibility` answers "who will see this once it is over
 * there", and an organization with one member would let a preview that returns nothing look
 * correct.
 */
export async function seedExportFixture(opts: {
  readonly prefix: string;
  readonly localOrg: string;
  readonly realOrg: string;
  readonly objectRoot: string;
  readonly count?: number;
}): Promise<ExportFixture> {
  const owner = `u-${opts.prefix}-owner`;
  const colleague = `u-${opts.prefix}-colleague`;
  const count = opts.count ?? 2;

  await seedOrg({
    orgId: opts.localOrg, kind: "personal-local", ownerUserId: owner,
    projectId: `${opts.localOrg}-p`,
  });
  await seedOrg({ orgId: opts.realOrg, projectId: `${opts.realOrg}-p` });
  await addOrgMember(opts.localOrg, owner, "admin", null);
  await addOrgMember(opts.realOrg, owner, "consultant", null);
  await addOrgMember(opts.realOrg, colleague, "lead", null);

  const store = new FsObjectStore(opts.objectRoot);
  const artifactIds: string[] = [];
  const bytes = new Map<string, string>();

  for (let i = 1; i <= count; i++) {
    const artifactId = `${opts.prefix}-art-${i}`;
    const { versionId } = await addSegment({
      orgId: opts.localOrg,
      segmentId: `${opts.prefix}-seg-${i}`,
      artifactId,
    });
    // The same key `addSegment` derives for a personal-local organization.
    const key = `local/${opts.localOrg}/artifacts/${artifactId}/v1/${versionId}`;
    const body = `bytes of ${artifactId} -- the most private thing this person owns`;
    // `beforeEach` re-seeds, and the object store is write-once by design (I-2). Re-running
    // the fixture writes the SAME bytes to the SAME key, so a collision here is the store
    // behaving correctly rather than a fixture problem -- but it must not be swallowed
    // blindly: assert the existing object really is what this fixture would have written.
    try {
      await store.putOnce(key, new TextEncoder().encode(body), "application/octet-stream");
    } catch (e) {
      if (!(e instanceof ObjectExistsError)) throw e;
      const existing = await store.get(key);
      if (existing === null || new TextDecoder().decode(existing) !== body) {
        throw new Error(`fixture key ${key} holds unexpected bytes`);
      }
    }
    artifactIds.push(artifactId);
    bytes.set(artifactId, body);
  }

  return { localOrg: opts.localOrg, realOrg: opts.realOrg, owner, colleague, artifactIds, bytes };
}

/** Rows of the target organization that carry the "came from a local org" mark. */
export async function importedArtifacts(realOrg: string): Promise<
  { id: string; imported_from_org_id: string | null; imported_from_artifact_id: string | null; imported_from_note: string | null }[]
> {
  const r = await asApp(realOrg, (c) =>
    c.query<{
      id: string;
      imported_from_org_id: string | null;
      imported_from_artifact_id: string | null;
      imported_from_note: string | null;
    }>(
      `SELECT id, imported_from_org_id, imported_from_artifact_id, imported_from_note
         FROM artifacts WHERE org_id = $1 ORDER BY id`,
      [realOrg],
    ),
  );
  return r.rows;
}
