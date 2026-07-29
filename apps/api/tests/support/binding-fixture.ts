/**
 * Shared fixture for the three F06 test files.
 *
 * Kept in one place because all three need the same non-trivial setup -- a real artifact
 * with real versions in real object storage -- and because `artifacts.id` is a GLOBAL
 * primary key rather than a tenant-scoped one (coherence 修订 D). Three files inventing
 * their own ids collide on a bare `art-1` under vitest's parallel workers, and the symptom
 * is `duplicate key violates artifacts_pkey` in a test about something else entirely.
 *
 * Every id here is therefore derived from a caller-supplied file prefix.
 */
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PgDatabase } from "../../src/infrastructure/db/pg-database";
import { appConfig } from "../../src/infrastructure/db/pg-config";
import { PgArtifactRepository } from "../../src/infrastructure/artifact/pg-artifact-repository";
import { PgBindingRepository } from "../../src/infrastructure/artifact/pg-binding-repository";
import { PgIdentityRepository } from "../../src/infrastructure/identity/pg-identity-repository";
import { PgProvenanceRepository } from "../../src/infrastructure/provenance/pg-provenance-repository";
import { FsObjectStore } from "../../src/infrastructure/storage/fs-object-store";
import { materializeArtifact } from "../../src/application/artifact/materialize-artifact";
import { pinVersion } from "../../src/application/artifact/pin-version";
import type { IdFactory } from "../../src/application/artifact/ports";
import type { BindingDeps } from "../../src/application/artifact/binding-ports";
import type { DecisionIdFactory } from "../../src/application/identity/ports";
import { toOrgId } from "../../src/domain/org-id";

/** Sequential, prefixed, deterministic -- a test that wants to assert a storage key can. */
export class SeqIds implements IdFactory {
  private n = 0;
  constructor(private readonly file: string) {}
  next(prefix: string): string {
    this.n += 1;
    return `${this.file}-${prefix}-${this.n}`;
  }
}

/** Decision ids do not have to be unique across a run; they have to be non-empty. */
class SeqDecisionIds implements DecisionIdFactory {
  private n = 0;
  next(): string {
    this.n += 1;
    return `d-${this.n}`;
  }
}

export const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
export const dec = (b: Uint8Array): string => new TextDecoder().decode(b);

export interface Harness {
  readonly db: PgDatabase;
  readonly deps: BindingDeps;
  readonly store: FsObjectStore;
  readonly ids: SeqIds;
  readonly root: string;
  /** The real audit trail, exposed so F08's assertions can read what the use cases wrote. */
  readonly provenance: PgProvenanceRepository;
  close(): Promise<void>;
}

export async function makeHarness(filePrefix: string): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), `wsx-${filePrefix}-`));
  const db = new PgDatabase(appConfig());
  const store = new FsObjectStore(root);
  const ids = new SeqIds(filePrefix);
  // The REAL repository, not a spy. F08's assertions are about rows in `provenance_events`
  // -- a fake writer would let every one of them pass against a system that audits nothing.
  const provenance = new PgProvenanceRepository(db);
  const deps: BindingDeps = {
    bindings: new PgBindingRepository(db),
    artifacts: new PgArtifactRepository(db),
    auth: { repo: new PgIdentityRepository(db), ids: new SeqDecisionIds() },
    ids,
    provenance,
  };
  return { db, deps, store, ids, root, provenance, close: () => db.close() };
}

export interface SeededArtifact {
  readonly artifactId: string;
  /** version ids by version number, 1-based: `versionIds[0]` is v1. */
  readonly versionIds: readonly string[];
  readonly keys: readonly string[];
}

/**
 * Create an artifact and `bodies.length` immutable versions of it, through the REAL save and
 * pin paths.
 *
 * Not inserted with raw SQL. The point of most of these assertions is that a pinned binding
 * survives the source moving, and "the source moved" has to be the ordinary thing the system
 * does -- a hand-written INSERT would sidestep exactly the code whose behaviour is in
 * question.
 */
export async function seedArtifact(
  h: Harness,
  orgId: string,
  projectId: string | null,
  bodies: readonly string[],
  actorId = "u-author",
): Promise<SeededArtifact> {
  const store = h.store;
  const repo = h.deps.artifacts;
  const first = await materializeArtifact(
    { store, repo, ids: h.ids },
    {
      orgId: toOrgId(orgId),
      projectId,
      source: "conversation",
      title: "a chat",
      actorId,
      parts: { "messages.jsonl": enc(bodies[0]!) },
    },
  );
  const versionIds = [first.versionId];
  const keys = [first.materializedKeys[0]!];

  for (let n = 1; n < bodies.length; n++) {
    const r = await pinVersion(
      { store, repo, ids: h.ids, provenance: h.provenance },
      {
        orgId: toOrgId(orgId),
        artifactId: first.artifactId,
        expectedHeadVersion: n,
        source: "conversation",
        title: "a chat",
        actorId,
        parts: { "messages.jsonl": enc(bodies[n]!) },
      },
    );
    versionIds.push(r.versionId);
    keys.push(r.objectStorageKey);
  }
  return { artifactId: first.artifactId, versionIds, keys };
}

/** An artifact row with NO version -- 0007 calls this "a draft buffer with nothing pinned". */
export async function seedVersionlessArtifact(
  h: Harness,
  orgId: string,
  id: string,
  createdBy = "u-author",
): Promise<string> {
  await h.db.withTenant(toOrgId(orgId), (s) =>
    s.query(
      `INSERT INTO artifacts (id, org_id, project_id, source, title, created_by, synthesized)
       VALUES ($1,$2,NULL,'upload',$3,$4,false)`,
      [id, orgId, `artifact ${id}`, createdBy],
    ),
  );
  return id;
}
