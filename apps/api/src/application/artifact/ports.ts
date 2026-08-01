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
   * F44 additions -- optional, same "undefined = column default" contract F35 set for
   * `NewArtifact` (see `agendaSegmentId` above). Every pre-F44 caller (F04/F05/F06/F35)
   * leaves these unset and gets `creator_kind = 'user'`, `agent_run_id = NULL`,
   * `change_source = 'materialize'`, unchanged from what those rows always meant.
   *
   * `creatorKind`/`agentRunId` describe WHO wrote this particular version -- distinct from
   * `pinnedBy` (an id with no shape) and from `artifacts.creator_kind` (one value for the
   * whole logical object): two versions of the same artifact can come from different actors
   * (a human uploads v1, an agent's re-run produces v2), and R3.a step 2's version list
   * shows this per row, not once per artifact.
   */
  readonly creatorKind?: "user" | "agent";
  readonly agentRunId?: string | null;
  /** 'upload' | 'materialize' | 'rerun' -- R3.a step 2's "变更来源" column, per version. */
  readonly changeSource?: "upload" | "materialize" | "rerun";
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

  /**
   * F36 passthrough -- see `MaterializeInput.ingestionStatus`.
   *
   * When set (only by the upload path, only when `ingestionStatus === "STORED"`), the
   * repository writes an `ingestion_outbox` row for this step IN THE SAME TRANSACTION as
   * this version's INSERT (`PgArtifactRepository.createVersion`). That co-location is the
   * entire "transactional" half of the transactional-outbox pattern: a worker can never see
   * a committed `STORED` version with no job to pick it up, because both rows commit or
   * roll back together.
   *
   * `null`/`undefined` (every caller except the upload path) means "no async pipeline runs
   * after this version" -- F04/F05/F06's own versions are `READY` already and have nothing
   * queued behind them.
   */
  readonly enqueueIngestionOutboxStep?: string | null;

  /**
   * F37 -- the other two components of the idempotency key (`content_hash` already exists;
   * see migration `20260801190000_f37_idempotent_ingest_and_adapters.sql`'s header). Optional,
   * `undefined` means "use the column default" (`'1'`) -- every caller before F37 (F04/F05/
   * F06/F35/F44/F73) never varied either axis, so their versions are retroactively "pipeline
   * 1, parser 1", the only value that was ever true for them.
   *
   * Only `upload-artifact.ts` sets these explicitly today, so it can look an existing version
   * up again by the exact same triple on a later request (`findVersionByIdempotencyKey`).
   */
  readonly pipelineVersion?: string;
  readonly parserVersion?: string;
}

/** One `artifact_versions` row matched by `findVersionByIdempotencyKey` -- just enough for
 *  the upload path to report a duplicate hit without a second read. */
export interface IdempotencyHit {
  readonly artifactId: string;
  readonly versionId: string;
  readonly versionNumber: number;
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

/**
 * One row of `listVersions.out` (contracts/files.ts) -- the version list's per-row shape
 * (R3.a step 2). `downloadable` is not read off the row: I-2/I-1 make every written version
 * downloadable forever, so the contract types it `literal(true)` and this record does not
 * carry a boolean that could disagree with the schema.
 */
export interface VersionListEntry {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly createdAt: string;
  readonly creator: { readonly type: "user" | "agent"; readonly id: string; readonly agentRunId: string | null };
  readonly sizeBytes: number;
  readonly sha256: string;
  readonly changeSource: "upload" | "materialize" | "rerun";
}

/**
 * A `derived_representations` row for the read side (`listDerived.out`).
 *
 * `objectStorageKey` is `null` exactly when `kind === "embedding"` (R3.b step 4: "除
 * embedding 外" materialized) -- the DB CHECK `derived_representations_materialized_unless_embedding`
 * (F44 migration) is the enforcement, this is its read shape.
 */
export interface DerivedRepresentationRecord {
  readonly id: string;
  readonly derivedFrom: string;
  readonly kind: DerivedKind;
  readonly objectStorageKey: string | null;
  readonly generatorModel: string;
  readonly generatorVersion: string;
  readonly pipelineVersion: string;
  readonly createdAt: string;
}

/** What `createDerived` needs to write one `derived_representations` row (F44). */
export interface NewDerivedRepresentation {
  readonly id: string;
  readonly orgId: OrgId;
  /** The exact `artifact_versions.id` this was derived FROM -- never an `artifactId` (N-15). */
  readonly derivedFrom: string;
  readonly kind: DerivedKind;
  /** `null` iff `kind === "embedding"` -- see `DerivedRepresentationRecord`. */
  readonly objectStorageKey: string | null;
  readonly generatorModel: string;
  readonly generatorVersion: string;
  readonly pipelineVersion: string;
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

  /**
   * Every version of an artifact, newest first (R3.a step 2 -- the version list expands to
   * this). Not filtered or paginated: R9's "50 版上限" is a display/perf budget on the
   * caller's side, not a correctness boundary this port enforces.
   */
  listVersions(orgId: OrgId, artifactId: string): Promise<readonly VersionListEntry[]>;

  /**
   * F37 -- the idempotency lookup `upload-artifact.ts` runs before every materialize call
   * (uc-22-2 R7: "幂等键=content_hash+pipeline_version+parser_version").
   *
   * Scoped by `projectId`, not `artifactId` -- the whole point is that the caller does NOT
   * yet know which artifact (if any) this upload duplicates; that is what this method
   * answers. A match means "this exact content, at this exact pipeline/parser version, was
   * already materialized in this project" -- the caller then skips `createVersion` entirely
   * rather than creating a second artifact for the same bytes.
   */
  findVersionByIdempotencyKey(
    orgId: OrgId,
    projectId: string | null,
    contentHash: string,
    pipelineVersion: string,
    parserVersion: string,
  ): Promise<IdempotencyHit | null>;

  /** Insert one `derived_representations` row (F44 / R3.b steps 4-5). Never updates a row. */
  createDerived(d: NewDerivedRepresentation): Promise<void>;

  /**
   * Every derivative of an artifact's versions, newest first. Rerunning OCR does not delete
   * or update the old row (A4 -- "旧派生版本保留可下载"), so an artifact that has been
   * OCR'd twice returns TWO `ocr` rows here, not one.
   */
  listDerived(orgId: OrgId, artifactId: string): Promise<readonly DerivedRepresentationRecord[]>;
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
