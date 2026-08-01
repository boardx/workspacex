/**
 * In-memory doubles for F04's `ArtifactRepository` / `ObjectStore` / `IdFactory` ports.
 *
 * F73 tests run against these rather than PostgreSQL — per this worker's constraint (issue
 * #74: no local Postgres-backed test runs) and per the same pattern `tests/support/rec-fakes.ts`
 * and `tests/support/retention-fakes.ts` already establish: a fake that really keeps rows,
 * so an assertion like "the audio version's hash is unchanged after materializing the
 * transcript" reads back what was actually written rather than what the code under test claims.
 */
import { computeContentHash } from "../../src/domain/artifact/content-hash";
import {
  ObjectExistsError,
  type ArtifactRepository,
  type ArtifactVersionRecord,
  type DerivedRepresentationRecord,
  type IdFactory,
  type NewArtifact,
  type NewArtifactVersion,
  type NewDerivedRepresentation,
  type NewSegment,
  type ObjectStore,
  type SegmentRecord,
  type VersionListEntry,
} from "../../src/application/artifact/ports";
import { guard, type Guarded } from "../../src/application/security/permission-filter";
import type { OrgId } from "../../src/domain/org-id";

export class FakeObjectStore implements ObjectStore {
  private readonly objects = new Map<string, { bytes: Uint8Array; mime: string }>();

  async putOnce(key: string, bytes: Uint8Array, mime: string): Promise<void> {
    if (this.objects.has(key)) throw new ObjectExistsError(key);
    // Copy the bytes: a caller mutating its own buffer afterwards must not corrupt the store.
    this.objects.set(key, { bytes: bytes.slice(), mime });
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key)?.bytes ?? null;
  }

  async head(key: string): Promise<{ sizeBytes: number; mime: string } | null> {
    const obj = this.objects.get(key);
    return obj === undefined ? null : { sizeBytes: obj.bytes.byteLength, mime: obj.mime };
  }

  /** F33: how many objects have EVER been written. Used to assert "no half-built zip" -- a
   *  failed export must leave this exactly where it was before the attempt. */
  get putCount(): number {
    return this.objects.size;
  }
}

interface StoredArtifact extends NewArtifact {}
interface StoredVersion extends NewArtifactVersion {
  readonly pinnedAt: string;
}

/**
 * The subset of `ArtifactRepository` F73's use case actually calls, kept genuinely in-memory
 * (`addSegments` / `findSegments` are stubbed — no test here exercises segments; a call would
 * be a bug in the test, not a case this fake needs to serve).
 */
export class FakeArtifactRepository implements ArtifactRepository {
  readonly artifacts = new Map<string, StoredArtifact>();
  readonly versions = new Map<string, StoredVersion>();

  async createArtifact(a: NewArtifact): Promise<void> {
    this.artifacts.set(a.id, a);
  }

  async createVersion(v: NewArtifactVersion): Promise<void> {
    const dup = [...this.versions.values()].some(
      (row) => row.artifactId === v.artifactId && row.versionNumber === v.versionNumber,
    );
    if (dup) throw new Error(`version ${v.versionNumber} of ${v.artifactId} already exists`);
    this.versions.set(v.id, { ...v, pinnedAt: "2026-07-31T00:00:00Z" });
  }

  async headVersionNumber(orgId: OrgId, artifactId: string): Promise<number> {
    const nums = [...this.versions.values()]
      .filter((v) => v.orgId === orgId && v.artifactId === artifactId)
      .map((v) => v.versionNumber);
    return nums.length === 0 ? 0 : Math.max(...nums);
  }

  async findVersion(orgId: OrgId, versionId: string): Promise<ArtifactVersionRecord | null> {
    const row = this.versions.get(versionId);
    if (row === undefined || row.orgId !== orgId) return null;
    return {
      id: row.id,
      artifactId: row.artifactId,
      versionNumber: row.versionNumber,
      objectStorageKey: row.objectStorageKey,
      contentHash: row.contentHash,
      mime: row.mime,
      sizeBytes: row.sizeBytes,
      pinnedBy: row.pinnedBy,
      pinnedAt: row.pinnedAt,
      contextPackId: row.contextPackId,
    };
  }

  /** Not part of `ArtifactVersionRecord` (see `ports.ts` — write-only until a read-side use
   *  case is signed off). Tests reach for the fake's own map directly instead:
   *  `repo.versions.get(id)!.derivedFrom`. */
  async addSegments(_orgId: OrgId, _segments: readonly NewSegment[]): Promise<void> {
    throw new Error("FakeArtifactRepository.addSegments is not exercised by F73's tests");
  }

  async findSegments(_orgId: OrgId, _versionId: string): Promise<readonly Guarded<SegmentRecord>[]> {
    return [];
  }

  /** F44 -- not exercised by F73's tests (no test here touches the version list). */
  async listVersions(orgId: OrgId, artifactId: string): Promise<readonly VersionListEntry[]> {
    return [...this.versions.values()]
      .filter((v) => v.orgId === orgId && v.artifactId === artifactId)
      .sort((a, b) => b.versionNumber - a.versionNumber)
      .map((v) => ({
        versionId: v.id,
        versionNumber: v.versionNumber,
        createdAt: v.pinnedAt,
        creator: { type: v.creatorKind ?? "user", id: v.pinnedBy, agentRunId: v.agentRunId ?? null },
        sizeBytes: v.sizeBytes,
        sha256: v.contentHash,
        changeSource: v.changeSource ?? "materialize",
      }));
  }

  readonly derived = new Map<string, NewDerivedRepresentation & { createdAt: string }>();

  /** F44 -- not exercised by F73's tests (no test here touches derived representations). */
  async createDerived(d: NewDerivedRepresentation): Promise<void> {
    this.derived.set(d.id, { ...d, createdAt: "2026-07-31T00:00:00Z" });
  }

  async listDerived(orgId: OrgId, artifactId: string): Promise<readonly DerivedRepresentationRecord[]> {
    const versionIds = new Set(
      [...this.versions.values()].filter((v) => v.orgId === orgId && v.artifactId === artifactId).map((v) => v.id),
    );
    return [...this.derived.values()]
      .filter((d) => d.orgId === orgId && versionIds.has(d.derivedFrom))
      .map((d) => ({
        id: d.id,
        derivedFrom: d.derivedFrom,
        kind: d.kind,
        objectStorageKey: d.objectStorageKey,
        generatorModel: d.generatorModel,
        generatorVersion: d.generatorVersion,
        pipelineVersion: d.pipelineVersion,
        createdAt: d.createdAt,
      }));
  }
}

export class SequentialIdFactory implements IdFactory {
  private readonly counters = new Map<string, number>();

  next(prefix: string): string {
    const n = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, n);
    return `${prefix}-${n}`;
  }
}

/** Deterministic bytes for a named file, so two tests that both write "audio.webm" without
 *  otherwise coordinating do not collide, and so the same call twice hashes identically. */
export function bytesFor(label: string): Uint8Array {
  return new TextEncoder().encode(`fixture-bytes:${label}`);
}

export function hashOf(label: string): string {
  return computeContentHash(bytesFor(label));
}

// Re-exported so a test asserting on `guard` shapes does not need a second import path.
export { guard };
