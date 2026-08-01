/**
 * F40 ports: the shared persistent queue the materialization event bus enqueues into, and
 * the backlog alert channel E5 requires.
 *
 * ⚠ Deliberately NOT the same interface as `ingestion-ports.ts`'s `IngestionOutboxRepository`.
 * That port's jobs are "advance THIS artifact_version from state A to state B" -- it has
 * nothing to say about materialization at all, because by the time a version exists in
 * `ingestion_outbox` the artifact row is already `STORED` and F35's `materializeArtifact` has
 * already run. This port's jobs are one step upstream: "a business event says source X needs
 * materializing (again)" -- the thing that, once claimed, is what CALLS
 * `materializeArtifact`, which is what THEN writes the `STORED` row that makes an
 * `ingestion_outbox` job exist. Collapsing the two into one port would make "not another
 * ingest path, reuse the pipeline" backwards: the reuse is that both paths' PRODUCTS
 * (STORED artifact versions) flow into the SAME ingestion_outbox and the SAME worker
 * (`ingestion-worker.ts`) afterwards -- not that they share one queue table beforehand, when
 * they are still queuing two different kinds of work.
 */
import type { OrgId } from "../../domain/org-id";
import type { MaterializationPriority, MaterializationSourceType } from "../../domain/files/materialization-events";

export interface MaterializationJob {
  readonly id: string;
  readonly orgId: OrgId;
  readonly sourceType: MaterializationSourceType;
  readonly sourceRef: string;
  /** D-03a: the ONLY segment-binding field this job may carry. Never `design_facet_id` /
   *  `method_stage_id` (uc-22-3 R7 last bullet, V12). */
  readonly agendaSegmentId: string | null;
  readonly priority: MaterializationPriority;
  readonly enqueuedAt: Date;
}

export interface NewMaterializationJob {
  readonly id: string;
  readonly orgId: OrgId;
  readonly sourceType: MaterializationSourceType;
  readonly sourceRef: string;
  readonly agendaSegmentId: string | null;
  readonly priority: MaterializationPriority;
  readonly enqueuedAt: Date;
}

/**
 * The persistent queue materialization jobs live in until a per-source worker claims one.
 * "Persistent" (R4/R9): a materialization service being unavailable must leave the event
 * queued, not dropped (R9 "物化服务不可用时，事件进入队列等待，不丢失").
 */
export interface MaterializationQueueRepository {
  enqueue(job: NewMaterializationJob): Promise<void>;
  /** Pending (not yet claimed) job count for this org -- what the backpressure check reads
   *  before every enqueue (E5). */
  pendingCount(orgId: OrgId): Promise<number>;
  /**
   * Priority-ordered claim: among pending jobs for `orgId`, the lowest
   * `MATERIALIZATION_PRIORITY_RANK` wins ties by `enqueuedAt` (FIFO within the same
   * priority). This is what makes "物化优先级低于用户主动上传" true structurally rather than
   * by convention -- an upload-priority job enqueued AFTER ten pending materialization jobs
   * still claims first.
   */
  claimNext(orgId: OrgId): Promise<MaterializationJob | null>;
}

export const MATERIALIZATION_QUEUE_REPOSITORY = Symbol("MaterializationQueueRepository");

/**
 * R4 E5: "积压超阈值时给出可见告警" -- a visible signal, not a log line nobody reads. Kept as
 * its own port (rather than folded into the queue repository) for the same reason
 * `SecurityAlertPort` (F35's `upload-ports.ts`) is separate from the object store: alerting
 * is a notification concern, and a fake used to assert "the alert fired" should not also have
 * to fake being a working queue.
 */
export interface BacklogAlertPort {
  raise(input: { readonly orgId: OrgId; readonly pendingCount: number; readonly threshold: number }): Promise<void>;
}

export const BACKLOG_ALERT_PORT = Symbol("BacklogAlertPort");
