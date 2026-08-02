/**
 * F46 -- the physical-delete worker (uc-22-4 R3.c step 11, E5, N-18/N-19). Not an HTTP
 * operation -- there is no `runPhysicalDeletion` in `files.operations`; this is the process
 * that makes `getDeletionTask.out.status` eventually reach `"done"` and `getDeletionReceipt`
 * eventually answer with something real, the same way F36's `ingestion-worker.ts` is the
 * process behind `getIngestionRun` without itself being a contract operation.
 *
 * ## Why a legal hold checked HERE, again, even though `requestDeletion` already checked it
 *
 * `isEligibleForPhysicalDeletion` (domain) takes the CURRENT hold state as an argument on
 * purpose: a hold applied the day after `requestDeletion` (and released before the 30-day
 * grace period elapses) must still have blocked the worker for however long it was active.
 * Re-reading `LegalHoldGate.isActive` at the moment this worker runs is the only way that
 * window is honored -- trusting a boolean recorded at request time would let a hold applied
 * mid-grace-period be silently ignored.
 */
import { buildDeletionReceipt, isEligibleForPhysicalDeletion } from "../../domain/files/physical-delete";
import type { DeletionReceipt } from "../../domain/files/physical-delete";
import type { OrgId } from "../../domain/org-id";
import type { LegalHoldGate } from "./deletion-ports";
import type {
  DeletionReceiptRepository,
  PhysicalDeleteTaskRepository,
  PhysicalPurgePort,
} from "./physical-delete-ports";
import type { IdFactory } from "../artifact/ports";
import type { ProvenanceWriter } from "../provenance/ports";
import type { DeleteImpactRepository } from "./deletion-ports";

export interface RunPhysicalDeletionDeps {
  readonly tasks: PhysicalDeleteTaskRepository;
  readonly legalHold: LegalHoldGate;
  readonly purge: PhysicalPurgePort;
  readonly receipts: DeletionReceiptRepository;
  readonly impact: DeleteImpactRepository;
  readonly ids: IdFactory;
  readonly provenance: ProvenanceWriter;
  readonly now: () => Date;
  /** `"system"` in production; overridable for tests that assert `executor`. */
  readonly executor: string;
}

export interface PhysicalDeletionOutcome {
  readonly taskId: string;
  readonly outcome: "deleted" | "skipped-not-eligible" | "skipped-purge-failed";
}

/**
 * Runs one sweep over `orgId`'s not-yet-done deletion tasks. Per-org, not global -- every
 * repository call in this codebase is `withTenant`-scoped (RLS), so a cross-org sweep is
 * "call this once per org the caller already knows about", same shape F36's ingestion worker
 * takes.
 */
export async function runPhysicalDeletion(
  deps: RunPhysicalDeletionDeps,
  orgId: OrgId,
): Promise<readonly PhysicalDeletionOutcome[]> {
  const now = deps.now();
  const candidates = await deps.tasks.listPendingPhysicalDeletion(orgId, now);
  const outcomes: PhysicalDeletionOutcome[] = [];

  for (const task of candidates) {
    const legalHoldActive = await deps.legalHold.isActive(orgId, task.artifactId);
    if (!isEligibleForPhysicalDeletion(task, now, legalHoldActive)) {
      outcomes.push({ taskId: task.taskId, outcome: "skipped-not-eligible" });
      continue;
    }

    const keys = task.objects.map((o) => o.objectKey);
    const purged = await deps.purge.purgeAll(keys);
    const allDeleted = purged.length === keys.length && purged.every((p) => p.deleted);
    if (!allDeleted) {
      // E5: object-store purge failed (fully or partially) -- the task stays un-eligible,
      // no receipt is issued, and a future sweep retries it. Nothing is marked here; the
      // NEXT call to `listPendingPhysicalDeletion` will offer this task again unchanged.
      outcomes.push({ taskId: task.taskId, outcome: "skipped-purge-failed" });
      continue;
    }

    const counts = await deps.impact.countsFor(orgId, task.artifactId);
    const receiptId = deps.ids.next("deletion-receipt");
    const receipt: DeletionReceipt = buildDeletionReceipt({
      taskId: task.taskId,
      // Cascade coverage was already gated `"running"` (never `"partial-failure"`) by
      // `listPendingPhysicalDeletion`'s own query (see the infra implementation's WHERE
      // clause) -- passed through as `"done"` here because that IS what this function is
      // about to make true, and `buildDeletionReceipt`'s `receiptEligible` gate only
      // recognizes `"done"`/`"running"`/`"partial-failure"`/`"pending"` as inputs, not a
      // fifth "about to be done" state.
      status: "done",
      objectRefs: task.objects.map((o) => o.objectKey),
      hashes: task.objects.map((o) => o.sha256).filter((h): h is string => h !== null),
      deletedAt: now,
      executor: deps.executor,
      coverage: [], // filled in by the caller layer that already has F45's cascade results (see get-deletion-receipt.ts for the read path that joins them); the worker's own receipt row does not duplicate them (migration header).
      exportedOutOfOrg: counts.exportedOutOfOrg,
    });

    await deps.receipts.save(orgId, receipt);
    await deps.tasks.markPhysicallyDeleted(orgId, task.taskId, receiptId);
    await deps.provenance.append({
      orgId,
      type: "deletion-requested",
      actorId: deps.executor,
      target: { kind: "artifact", id: task.artifactId },
      detail: { taskId: task.taskId, receiptId, phase: "physical-delete-completed" },
    });

    outcomes.push({ taskId: task.taskId, outcome: "deleted" });
  }

  return outcomes;
}
