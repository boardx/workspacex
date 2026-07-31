/**
 * Ports for the Artifact model. Defined here, implemented by `infrastructure`.
 *
 * Two stores, deliberately two ports, because they are canonical for different things
 * (`domain/artifact/canonical.ts`): `ObjectStore` owns the bytes, `ArtifactRepository` owns
 * lineage, state and permission. A single "artifact storage" port would hide that split, and
 * the split is the thing a restore has to respect.
 */
import { artifact as A } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

/* ── types, all derived from the contract ─────────────────────────────────────────────── */

export type ArtifactSource = z.infer<typeof A.ArtifactSource>;
export type SegmentKind = z.infer<typeof A.SegmentKind>;
export type AnchorKind = z.infer<typeof A.AnchorKind>;
export type DerivedKind = z.infer<typeof A.DerivedKind>;
export type ArtifactVersionRecord = z.infer<typeof A.ArtifactVersion>;
export type SaveDraftOut = z.infer<typeof A.operations.saveDraft.out>;

/* ── object store ─────────────────────────────────────────────────────────────────────── */

export class ObjectExistsError extends Error {
  constructor(readonly key: string) {
    super(`object already exists at ${key}`);
  }
}

export class ObjectStoreUnavailableError extends Error {}

/**
 * Two writers reached the same `(artifactId, versionNumber)`.
 *
 * Raised by the repository, not by a caller inspecting a driver error: SQLSTATE 23505 and the
 * constraint name `artifact_versions_uniq_number` are PostgreSQL facts, and an application
 * module that reads them is an application module that knows which database it is on. It also
 * has to be a distinct error rather than "the insert failed": the pin path turns exactly this
 * into `VERSION_CHANGED`, and telling it apart from a genuine write fault by matching on a
 * message is how a storage outage starts being reported as a concurrent edit.
 */
export class DuplicateVersionNumberError extends Error {
  constructor(readonly artifactId: string, readonly versionNumber: number) {
    super(`version ${versionNumber} of ${artifactId} already exists`);
  }
}

/**
 * The bytes. Write-once (I-2).
 *
 * ⚠ `putOnce` refusing an existing key is only HALF of I-2, and the weaker half. It is an
 * application-level promise, and the invariant is about what the bucket permits: a restore,
 * an operator, a second service or a future writer that does not use this port can still
 * overwrite an object, and the database would keep asserting a hash that no longer matches.
 * The other half is bucket configuration (versioning + object-lock) and it cannot be made
 * from here -- `contracts/artifact/domain.md` says exactly this and it remains a deployment
 * obligation, not something this interface discharges.
 *
 * There is no `delete`. Coherence X-4 makes compliance withdrawal the single hole in
 * immutability, and it has to remove the object AND the row together; a delete on this port
 * would let half of it happen from anywhere.
 */
export interface ObjectStore {
  /** Writes, or throws `ObjectExistsError` if the key is taken. Never overwrites. */
  putOnce(key: string, bytes: Uint8Array, mime: string): Promise<void>;
  /** Reads the bytes back. Null when the key does not exist. */
  get(key: string): Promise<Uint8Array | null>;
  /** Existence and size, without transferring the body -- what I-5 is asserted with. */
  head(key: string): Promise<{ sizeBytes: number; mime: string } | null>;
}

export const OBJECT_STORE = Symbol("ObjectStore");

/* ── metadata repository ──────────────────────────────────────────────────────────────── */

export interface NewArtifact {
  readonly id: string;
  readonly orgId: OrgId;
  readonly projectId: string | null;
  readonly source: ArtifactSource;
  readonly title: string;
  readonly createdBy: string;
  readonly synthesized: boolean;
  /**
   * F35 additions -- all optional so every existing caller (F04/F05/F06/F31) keeps its
   * current behaviour untouched. Undefined means "use the column default"
   * (`agenda_segment_id IS NULL`, `confidential = false`, `ingestion_status = 'READY'`,
   * migration 0023). The upload path (`upload-artifact.ts`) is the one caller that passes
   * all three explicitly, because a freshly-uploaded file is `STORED`, not `READY` -- the
   * rest of the nine-state pipeline (extract/segment/enrich/index/review) is F36+, not yet
   * run for a file that just landed in the object store.
   */
  readonly agendaSegmentId?: string | null;
  readonly confidential?: boolean;
  readonly ingestionStatus?: string;
}

export interface NewArtifactVersion {
  readonly id: string;
  readonly orgId: OrgId;
  readonly artifactId: string;
  readonly versionNumber: number;
  readonly objectStorageKey: string;
  readonly contentHash: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly pinnedBy: string;
  readonly contextPackId: string | null;
  /**
   * F73 (migration `20260731153640_f73_recording_file_first`): the exact `artifact_versions.id`
   * this version was produced FROM, or `null` when this version is itself an original.
   *
   * Required rather than optional so every caller states it explicitly -- F04's own
   * `materialize-artifact.ts` passes `null` (nothing it writes is derived), and recording's
   * transcript/notes materialization passes the audio version's id. A default of `undefined`
   * here would be the same silent-default failure mode I-32 forbids for retention days, just
   * on a different column.
   *
   * ⚠ Not exposed on the `ArtifactVersion` read contract yet (`packages/contracts/src/artifact.ts`
   * is a signed contract this feature does not own) -- it is write-only / DB-only until a
   * read-side use case is signed off to expose it. `findVersion` below does not return it.
   */
  readonly derivedFrom: string | null;
}

export interface NewSegment {
  readonly id: string;
  readonly artifactVersionId: string;
  readonly kind: SegmentKind;
  readonly ordinal: number;
  /**
   * At least one, and the type says so. I-7 is enforced by a deferred constraint in the
   * database, but a caller that hands over an empty array should not get as far as a
   * transaction that is going to abort at COMMIT with a message about triggers.
   */
  readonly anchors: readonly [NewAnchor, ...NewAnchor[]];
}

export interface NewAnchor {
  readonly id: string;
  readonly kind: AnchorKind;
  readonly locator: string;
}

/** A segment's identity and position. Deliberately no text: F04 stores structure, not bodies. */
export interface SegmentRecord {
  readonly id: string;
  readonly artifactVersionId: string;
  readonly kind: SegmentKind;
  readonly ordinal: number;
  readonly anchors: readonly { kind: AnchorKind; locator: string }[];
}

export interface ArtifactRepository {
  createArtifact(a: NewArtifact): Promise<void>;
  /** Throws on a duplicate (artifactId, versionNumber) -- I-10. F05 maps that to VERSION_CHANGED. */
  createVersion(v: NewArtifactVersion): Promise<void>;
  /** 0 when the artifact has no version yet, so `head + 1` is always the next number. */
  headVersionNumber(orgId: OrgId, artifactId: string): Promise<number>;
  findVersion(orgId: OrgId, versionId: string): Promise<ArtifactVersionRecord | null>;
  /** Segments with their anchors, in ordinal order. Inserted atomically with the anchors. */
  addSegments(orgId: OrgId, segments: readonly NewSegment[]): Promise<void>;

  /**
   * Segments of a version, as `Guarded<SegmentRecord>` whose `sources` name the originating
   * artifact.
   *
   * That `sources` list is the whole reason this returns `Guarded` rather than rows: I-13
   * says a segment's effective visibility is its original's, only ever narrower. Handing
   * back plain rows would make honouring that the caller's problem, and the caller is
   * retrieval code whose tests all pass while it launders a team-only artifact out through
   * its segments (UC-0.3 R7).
   */
  findSegments(orgId: OrgId, versionId: string): Promise<readonly Guarded<SegmentRecord>[]>;
}

export const ARTIFACT_REPOSITORY = Symbol("ArtifactRepository");

/* ── id generation ────────────────────────────────────────────────────────────────────── */

/**
 * A port, not a `randomUUID()` call in the use case.
 *
 * Ids end up in storage keys, so a test that wants to assert an exact key needs them to be
 * predictable, and a use case that generates them internally cannot offer that without the
 * test reaching into the database to discover what it just wrote.
 */
export interface IdFactory {
  next(prefix: string): string;
}

export const ID_FACTORY = Symbol("ArtifactIdFactory");
