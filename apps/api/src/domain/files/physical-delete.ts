/**
 * F46 -- the physical-delete worker's pure rules + the deletion receipt shape (uc-22-4 R3.c
 * step 11, R3.d, N-18/N-19, `getDeletionReceipt`).
 *
 * `domain/files/deletion-cascade.ts` (F45) already draws the ceiling: its
 * `deriveLogicalCascadeStatus` can only ever return `"running"` or `"partial-failure"`,
 * never `"done"` -- see that file's header. This module owns the ONE place `"done"` is ever
 * produced: a task whose logical cascade is clean (`"running"`), whose grace period has
 * elapsed, and whose bytes have actually been purged from the object store.
 */
import type { CascadeResultEntry } from "./deletion-cascade";
import { receiptEligible } from "./deletion-cascade";

export interface DeletionTaskSnapshot {
  readonly taskId: string;
  readonly status: "pending" | "running" | "done" | "partial-failure";
  readonly physicalDeletionDeadline: Date;
  readonly receiptId: string | null;
}

/**
 * May the physical-delete worker touch this task right now?
 *
 * 🔴 A `legalHoldActive` task is NEVER eligible, full stop -- R3.d 点 15: "豁免于留存期到期
 * 删除"; a hold applied AFTER `requestDeletion` but BEFORE the grace period elapses must
 * still block the worker, which is exactly why this predicate takes the CURRENT hold state
 * as an argument rather than trusting whatever `deletion_tasks` recorded at creation time.
 *
 * A `"partial-failure"` task is also never eligible -- N-17's ceiling applies here just as
 * much as it does to `getDeletionReceipt`: this worker deletes real bytes, and it must not
 * do that for a task whose six-category cascade has not actually gone clean.
 */
export function isEligibleForPhysicalDeletion(
  task: DeletionTaskSnapshot,
  now: Date,
  legalHoldActive: boolean,
): boolean {
  if (legalHoldActive) return false;
  if (task.status !== "running") return false;
  if (task.receiptId !== null) return false;
  return now.getTime() >= task.physicalDeletionDeadline.getTime();
}

/**
 * E4 / R5: "物理删除超过 30 天未完成 -- 触发升级告警". Overdue is a DIFFERENT question from
 * eligible: a task can be overdue (grace period long past) yet still correctly withheld from
 * physical deletion because a legal hold landed in the meantime -- that combination is not a
 * bug, it is R3.d's exemption doing its job, and `listTrashQueue`'s compliance view must be
 * able to show both facts (overdue AND on-hold) at once rather than one silently masking the
 * other.
 */
export function isOverdue(task: DeletionTaskSnapshot, now: Date): boolean {
  if (task.status === "done") return false;
  return now.getTime() > task.physicalDeletionDeadline.getTime();
}

export interface PurgeOutcome {
  readonly objectKey: string;
  readonly deleted: boolean;
  readonly detail: string | null;
}

export interface DeletionReceipt {
  readonly taskId: string;
  readonly objectRefs: readonly string[];
  readonly hashes: readonly string[];
  readonly deletedAt: string;
  readonly executor: string;
  readonly coverage: readonly CascadeResultEntry[];
  readonly exportedOutOfOrg: readonly {
    readonly jobId: string;
    readonly exportedAt: string;
    readonly exportedBy: string;
    readonly itemCount: number;
  }[];
  readonly uncoverableStatement: string;
}

export class PhysicalDeleteError extends Error {
  constructor(
    readonly reasonCode: "OBJECT_STORE_PURGE_FAILED" | "NOT_ELIGIBLE" | "DELETION_PARTIAL_FAILURE" | "LEGAL_HOLD_ACTIVE",
  ) {
    super(reasonCode);
  }
}

/**
 * N-19: 🔴 **不得出具虚假回执**. `uncoverableStatement` is REQUIRED non-empty text (the
 * contract's own `.min(1)`) precisely so an empty/absent field can never be read as "nothing
 * to disclose" -- see `files.ts`'s own comment on `getDeletionReceipt.out.uncoverableStatement`
 * for why the field must never disappear. "无" is the honest answer when there is nothing to
 * disclose; it is written out explicitly, never omitted.
 */
export function buildUncoverableStatement(
  exportedOutOfOrg: DeletionReceipt["exportedOutOfOrg"],
): string {
  if (exportedOutOfOrg.length === 0) return "无";
  const items = exportedOutOfOrg
    .map((e) => `导出任务 ${e.jobId}（由 ${e.exportedBy} 于 ${e.exportedAt} 导出，共 ${e.itemCount} 项）`)
    .join("；");
  return `以下内容已导出到组织外，物理删除无法回收：${items}。`;
}

/**
 * Assembles the receipt. Throws `DELETION_PARTIAL_FAILURE` if asked to build one for a
 * cascade that is not actually fully covered -- `receiptEligible` (F45's own gate, reused
 * rather than re-declared) is the single determination of "may a receipt exist for this
 * status", so this function and `getDeletionTask`'s status field can never disagree about
 * when a receipt is legitimate.
 */
export function buildDeletionReceipt(input: {
  readonly taskId: string;
  readonly status: "pending" | "running" | "done" | "partial-failure";
  readonly objectRefs: readonly string[];
  readonly hashes: readonly string[];
  readonly deletedAt: Date;
  readonly executor: string;
  readonly coverage: readonly CascadeResultEntry[];
  readonly exportedOutOfOrg: DeletionReceipt["exportedOutOfOrg"];
}): DeletionReceipt {
  if (!receiptEligible(input.status)) throw new PhysicalDeleteError("DELETION_PARTIAL_FAILURE");
  return {
    taskId: input.taskId,
    objectRefs: input.objectRefs,
    hashes: input.hashes,
    deletedAt: input.deletedAt.toISOString(),
    executor: input.executor,
    coverage: input.coverage,
    exportedOutOfOrg: input.exportedOutOfOrg,
    uncoverableStatement: buildUncoverableStatement(input.exportedOutOfOrg),
  };
}
