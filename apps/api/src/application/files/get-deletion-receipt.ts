/**
 * F46 -- `getDeletionReceipt` (N-18/N-19). Joins the stored receipt (this feature's
 * `deletion_receipts`, everything except `coverage`) with the six-category cascade outcome
 * (F45's `deletion_cascade_results`, read through `DeletionTaskRepository.getTask`) -- see
 * `physical-delete-ports.ts`'s `DeletionReceiptRepository` header for why the two are not
 * merged into one persisted row.
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { DeletionReceiptRepository } from "./physical-delete-ports";
import type { DeletionTaskRepository } from "./deletion-ports";

export type GetDeletionReceiptResult = z.infer<typeof C.operations.getDeletionReceipt.out>;

export type GetDeletionReceiptReasonCode = "DELETION_PARTIAL_FAILURE" | "LEGAL_HOLD_ACTIVE";

export class GetDeletionReceiptError extends Error {
  constructor(readonly reasonCode: GetDeletionReceiptReasonCode) {
    super("get_deletion_receipt_failed");
  }
}

export interface GetDeletionReceiptDeps {
  readonly receipts: DeletionReceiptRepository;
  readonly tasks: DeletionTaskRepository;
}

export interface GetDeletionReceiptInput {
  readonly orgId: OrgId;
  readonly taskId: string;
}

export async function getDeletionReceipt(
  deps: GetDeletionReceiptDeps,
  input: GetDeletionReceiptInput,
): Promise<GetDeletionReceiptResult> {
  const task = await deps.tasks.getTask(input.orgId, input.taskId);
  // 🔴 N-17/N-19: no task, or a task that never reached 'done' -- no receipt, ever. A
  // 'partial-failure' task's own coverage array is the honest explanation of why.
  if (task === null || task.status !== "done") throw new GetDeletionReceiptError("DELETION_PARTIAL_FAILURE");

  const stored = await deps.receipts.find(input.orgId, input.taskId);
  if (stored === null) throw new GetDeletionReceiptError("DELETION_PARTIAL_FAILURE");

  return {
    objectRefs: [...stored.objectRefs],
    hashes: [...stored.hashes],
    deletedAt: stored.deletedAt,
    executor: stored.executor,
    coverage: task.cascadeResults.map((r) => ({ kind: r.kind, result: r.result })),
    exportedOutOfOrg: [...stored.exportedOutOfOrg],
    uncoverableStatement: stored.uncoverableStatement,
  };
}
