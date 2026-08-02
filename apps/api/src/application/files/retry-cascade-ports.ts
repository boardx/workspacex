/**
 * F46 -- `retryCascade`'s write port. F45's `DeletionTaskRepository` only ever INSERTs a
 * task once (`create`); retrying updates an EXISTING task's cascade rows and status, a
 * different shape this file adds rather than widening F45's port.
 */
import type { OrgId } from "../../domain/org-id";
import type { CascadeResultEntry } from "../../domain/files/deletion-cascade";

export interface RetryCascadeRepository {
  /** Overwrites this task's cascade-result rows with a freshly re-run set (six entries). */
  updateCascadeResults(
    orgId: OrgId,
    taskId: string,
    results: readonly CascadeResultEntry[],
  ): Promise<void>;

  /** Updates `deletion_tasks.status` for a retry outcome (`'running'` or `'partial-failure'`). */
  updateStatus(orgId: OrgId, taskId: string, status: "running" | "partial-failure"): Promise<void>;
}

export const RETRY_CASCADE_REPOSITORY = Symbol("RetryCascadeRepository");
