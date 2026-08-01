/**
 * F36 ports: the transactional-outbox job queue and the history trail the worker advances.
 *
 * Kept separate from `application/artifact/ports.ts` (F04's `ArtifactRepository`, reused
 * unchanged here for `addSegments`/`findVersion`) and from `upload-ports.ts` (F35's
 * quarantine/alert concerns): this file is F36's own new concern -- everything AFTER
 * `STORED`.
 */
import type { OrgId } from "../../domain/org-id";
import type { IngestionStatus } from "../../domain/files/ingestion-pipeline";

/** The step a job is working TOWARDS -- see the migration header for why. */
export type IngestionStep = Exclude<IngestionStatus, "RECEIVED" | "QUARANTINED" | "SCANNED" | "STORED">;

export interface IngestionOutboxJob {
  readonly id: string;
  readonly orgId: OrgId;
  readonly artifactId: string;
  readonly artifactVersionId: string;
  readonly step: IngestionStep;
  readonly attempts: number;
}

export interface NewIngestionOutboxJob {
  readonly id: string;
  readonly orgId: OrgId;
  readonly artifactId: string;
  readonly artifactVersionId: string;
  readonly step: IngestionStep;
}

/**
 * The outbox + job table. `claimNext` is the ONLY read path a worker uses -- it is also what
 * makes replay safe: a job whose `locked_at` is older than `staleAfterMs` is claimable again
 * by ANY worker, including the one that originally claimed it before it crashed (uc-22-2 V12).
 */
export interface IngestionOutboxRepository {
  /**
   * Enqueues the first step after `STORED`. Idempotent: enqueuing a step that already has a
   * row for this version is a no-op (`ON CONFLICT (artifact_version_id, step) DO NOTHING`),
   * never a second race for the same work.
   */
  enqueue(job: NewIngestionOutboxJob): Promise<void>;

  /**
   * Atomically claims one pending-or-stale job for `orgId` (`FOR UPDATE SKIP LOCKED`),
   * marking it `processing` and stamping `locked_by`/`locked_at`. Returns `null` when
   * nothing is claimable -- an empty queue is not an error.
   *
   * ⚠ Scoped to a single tenant, like every other read/write in this codebase (RLS is
   * FORCEd on `ingestion_outbox`; there is no cross-tenant "just give me any org's next
   * job" query here, on purpose -- see `pg-ingestion-repository.ts`'s header for why an
   * unscoped claim would have to bypass RLS to work at all, and why that is not done). A
   * process that services many orgs calls this once per known `orgId` on its poll tick.
   */
  claimNext(orgId: OrgId, workerId: string, staleAfterMs: number): Promise<IngestionOutboxJob | null>;

  /**
   * Claims the job for a SPECIFIC version regardless of staleness -- the explicit
   * `replayIngestionRun` / `retryIngestionStep` operation (uc-22-2 V12), as opposed to
   * `claimNext`'s "whatever the queue offers next" poll-loop claim. Still `FOR UPDATE SKIP
   * LOCKED` under the hood, so an explicit replay racing an in-flight worker's own claim of
   * the SAME row cannot double-claim it -- one of the two gets `null`.
   */
  claimForVersion(orgId: OrgId, artifactVersionId: string, workerId: string): Promise<IngestionOutboxJob | null>;

  /**
   * The step this job represents is DONE: advances `artifacts.ingestion_status`, appends an
   * `ingestion_history` row, deletes this job's row, and (unless `nextStep` is null, i.e. the
   * pipeline reached a terminal state) enqueues the next job -- all in ONE transaction, so a
   * crash between "the step's side effects landed" and "the queue advanced" can only ever be
   * observed as "the step's side effects landed twice, harmlessly" (idempotent), never as
   * "the version silently stopped advancing".
   */
  completeAndAdvance(
    orgId: OrgId,
    jobId: string,
    nextStatus: IngestionStatus,
    nextStep: IngestionStep | null,
  ): Promise<void>;

  /** The step failed. Recorded so `attempts`/`last_error` are visible, job stays claimable. */
  markFailed(orgId: OrgId, jobId: string, error: string): Promise<void>;

  /** Read-only: for `getIngestionRun`/`replayIngestionRun` to find a version's live job. */
  findByVersion(orgId: OrgId, artifactVersionId: string): Promise<IngestionOutboxJob | null>;
}

export const INGESTION_OUTBOX_REPOSITORY = Symbol("IngestionOutboxRepository");

export interface IngestionHistoryRepository {
  history(orgId: OrgId, artifactVersionId: string): Promise<readonly IngestionStatus[]>;
}

export const INGESTION_HISTORY_REPOSITORY = Symbol("IngestionHistoryRepository");
