/**
 * F46 -- the physical-delete worker's ports (uc-22-4 R3.c step 11, E5, N-18/N-19).
 */
import type { OrgId } from "../../domain/org-id";
import type { DeletionReceipt } from "../../domain/files/physical-delete";

export interface PurgeableObject {
  readonly objectKey: string;
  /**
   * Null for kinds with no hash column at all -- `derived_representations` (F04's own
   * migration) has no `content_hash`, unlike `artifact_versions`. The receipt's `hashes`
   * array is built only from the non-null entries; a purged object with no recorded hash
   * is still purged and still listed in `objectRefs`, it just contributes nothing to
   * `hashes` (inventing a hash for it would be worse than omitting one).
   */
  readonly sha256: string | null;
}

/**
 * Everything the physical-delete worker must remove for one artifact: the original's every
 * version, PLUS every derived representation under any of them (R7: "原件写入后永不覆盖…
 * 派生物是独立文件…不覆盖原件" -- deletion has to reach both classes of object, not just the
 * one the artifact row points at directly).
 */
export interface FindTaskForPurgeRow {
  readonly taskId: string;
  readonly artifactId: string;
  readonly status: "pending" | "running" | "done" | "partial-failure";
  readonly physicalDeletionDeadline: Date;
  readonly receiptId: string | null;
  readonly objects: readonly PurgeableObject[];
}

export interface PhysicalDeleteTaskRepository {
  /** Tasks in THIS org that are candidates for the worker to examine (not yet 'done'). */
  listPendingPhysicalDeletion(orgId: OrgId, now: Date): Promise<readonly FindTaskForPurgeRow[]>;

  /** Flips the task to 'done' and stamps `receipt_id` -- the ONLY writer of that transition. */
  markPhysicallyDeleted(orgId: OrgId, taskId: string, receiptId: string): Promise<void>;
}

export const PHYSICAL_DELETE_TASK_REPOSITORY = Symbol("PhysicalDeleteTaskRepository");

/**
 * The "single hole" in `ObjectStore`'s write-once discipline (see that port's own header:
 * "There is no `delete`... X-4 makes compliance withdrawal the single hole in immutability").
 * A SEPARATE port, not a method added to `ObjectStore`, so that ordinary application code
 * calling through `ObjectStore` can never accidentally reach a delete -- only the
 * physical-delete worker is wired to this one.
 */
export interface PhysicalPurgePort {
  /**
   * Attempts to remove every key. Best-effort per key (one object-store outage must not stop
   * the others from being purged) -- E5: a failure here means the WHOLE task stays
   * un-eligible for a receipt (N-19), but partial progress is not silently discarded either.
   */
  purgeAll(keys: readonly string[]): Promise<readonly { readonly objectKey: string; readonly deleted: boolean }[]>;
}

export const PHYSICAL_PURGE_PORT = Symbol("PhysicalPurgePort");

/**
 * ⚠ `DeletionReceipt.coverage` is NOT one of the columns `deletion_receipts` persists (see
 * the migration header: coverage already lives in F45's `deletion_cascade_results`, joined
 * by `task_id` at read time). `save` persists everything else; `find` returns a receipt with
 * `coverage: []` -- the caller (`get-deletion-receipt.ts`) is the one that joins the real
 * coverage back in before handing a response to the contract's `out` shape. Calling `find`
 * directly and reading `.coverage` off the result is a bug in the caller, not this port.
 */
export interface DeletionReceiptRepository {
  save(orgId: OrgId, receipt: DeletionReceipt): Promise<void>;
  find(orgId: OrgId, taskId: string): Promise<DeletionReceipt | null>;
}

export const DELETION_RECEIPT_REPOSITORY = Symbol("DeletionReceiptRepository");
