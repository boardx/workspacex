/**
 * Ports for F45: `previewDeleteImpact` / `requestDeletion` (uc-22-4 R3.c, D-15, N-17).
 * Defined here, implemented by `infrastructure` (migration `20260801190000_f45_deletion_
 * cascade.sql`).
 *
 * ## Why this is one repository interface, not five
 *
 * The six-category cascade is one ATOMIC unit of work by contract ("逻辑失效不能等
 * worker...必须在同步事务或极短异步内完成", `requestDeletion`'s long comment). Five of the
 * six live in THIS database (browser entry, derived-file queueing, pgvector, FTS/segments,
 * context-pack cache); splitting them into five separate repository interfaces would make
 * "run them all in one transaction" something every CALLER has to remember to do, instead of
 * a property of there being one `invalidateLocalCascades` method that opens one `withTenant`.
 * The sixth (`ontology-edges`) is NOT in this repository -- it is the F47 outbound port,
 * called separately because it can fail independently and must not roll back the other five
 * (see `request-deletion.ts`'s header for why).
 */
import type { OrgId } from "../../domain/org-id";
import type { CascadeResultEntry } from "../../domain/files/deletion-cascade";
import type { Guarded } from "../security/permission-filter";

/** One artifact's delete-impact numbers (uc-22-4 R3.c step 8). */
export interface DeleteImpactCounts {
  readonly versionCount: number;
  readonly derivedCount: number;
  readonly segmentCount: number;
  readonly referencingClaims: readonly { readonly id: string; readonly label: string }[];
  /**
   * ⚠ Always `[]` in phase-01. There is no report-section table in this schema (10-report /
   * 13-deliv are phase-02, same as the `annotateWithdrawnEvidence` outbound port) -- an
   * honest empty set, not "not yet queried". See `files.KNOWN_CONTRACT_GAPS.FS11`.
   */
  readonly referencingReportSections: readonly { readonly id: string; readonly label: string }[];
  readonly exportedOutOfOrg: readonly {
    readonly jobId: string;
    readonly exportedAt: string;
    readonly exportedBy: string;
    readonly itemCount: number;
  }[];
}

/** What a deletable artifact looks like, resolved through the ONE visibility predicate. */
export interface DeletableArtifactLookup {
  readonly artifactId: string;
  readonly projectId: string | null;
  /** Guarded so the caller cannot read past it without an `authorize()` decision. */
  readonly artifact: Guarded<{ readonly title: string }>;
}

export interface DeleteImpactRepository {
  /**
   * Null when the artifact does not exist OR is not visible to this requester through
   * `wsx_visible_artifacts()` -- same collapse as F32/F34 (N-25).
   */
  findDeletable(input: {
    readonly orgId: OrgId;
    readonly artifactId: string;
    readonly requesterTeamId: string | null;
  }): Promise<DeletableArtifactLookup | null>;

  countsFor(orgId: OrgId, artifactId: string): Promise<DeleteImpactCounts>;
}

/** `requestDeletion`'s `LEGAL_HOLD_ACTIVE` gate. Writing holds is F46's job. */
export interface LegalHoldGate {
  isActive(orgId: OrgId, artifactId: string): Promise<boolean>;
}

/** What `invalidateLocalCascades` needs to know to do its work. */
export interface CascadeInvalidationInput {
  readonly orgId: OrgId;
  readonly artifactId: string;
}

export interface CascadeInvalidationRepository {
  /**
   * Runs cascades ①②③④⑥ in ONE transaction:
   *   ① `artifacts.deleted_at = now()` -- the browser-entry / download-404 flag.
   *   ② every `derived_representations` row under this artifact's versions -- returned so
   *      the caller can report how many were queued (there is no separate "queued" column;
   *      a derivative under a deleted artifact IS the queue, matched by join at read time --
   *      see the repository's own header for why a boolean flag would be a second place the
   *      same fact could disagree with `artifacts.deleted_at`).
   *   ③ deletes every `segment_embeddings` row for this artifact's segments -- pgvector
   *      recall reads that table directly, so a deleted row is an IMMEDIATE zero-recall
   *      fact, not an eventual one.
   *   ④ deletes every `segment_text` row for the same segments -- same reasoning for FTS.
   *   ⑥ marks every `context_packs` row whose `recorded.candidates[].segmentId` cites one of
   *      this artifact's segments as `invalidated_at = now()`, PLUS every pack pinned
   *      directly to one of this artifact's versions (`pinned_snapshot_id`).
   *
   * Returns the five outcomes (always `"ok"` -- these are plain SQL statements against
   * tables this process owns; there is no partial-failure mode for a local UPDATE/DELETE
   * that either commits or the whole transaction rolls back) plus the segment/version ids
   * the caller needs in order to call the `ontology-edges` outbound port.
   */
  invalidateLocalCascades(input: CascadeInvalidationInput): Promise<{
    readonly results: readonly CascadeResultEntry[];
    readonly versionIds: readonly string[];
    readonly segmentIds: readonly string[];
  }>;
}

export interface NewDeletionTask {
  readonly id: string;
  readonly orgId: OrgId;
  readonly artifactId: string;
  readonly requestedBy: string;
  readonly actorKind: "user" | "agent";
  readonly reason: string;
  readonly scope: string | null;
  readonly requestedAt: Date;
  readonly logicalInvalidationDeadline: Date;
  readonly physicalDeletionDeadline: Date;
  readonly status: "running" | "partial-failure";
  readonly cascadeResults: readonly CascadeResultEntry[];
}

export interface DeletionTaskRow {
  readonly taskId: string;
  readonly artifactId: string;
  readonly status: "pending" | "running" | "done" | "partial-failure";
  readonly requestedAt: Date;
  readonly logicalInvalidationDeadline: Date;
  readonly physicalDeletionDeadline: Date;
  readonly receiptId: string | null;
  readonly cascadeResults: readonly CascadeResultEntry[];
}

export interface DeletionTaskRepository {
  /** Writes the task row and its six cascade-result rows, in one transaction. */
  create(input: NewDeletionTask): Promise<void>;

  getTask(orgId: OrgId, taskId: string): Promise<DeletionTaskRow | null>;
}

export const DELETE_IMPACT_REPOSITORY = Symbol("DeleteImpactRepository");
export const LEGAL_HOLD_GATE = Symbol("LegalHoldGate");
export const CASCADE_INVALIDATION_REPOSITORY = Symbol("CascadeInvalidationRepository");
export const DELETION_TASK_REPOSITORY = Symbol("DeletionTaskRepository");
