/**
 * F46 -- `revokeDeletion` (A5: "在宽限期内、物理删除执行前，合规负责人可撤销删除任务，
 * 对象恢复可见").
 *
 * ## ⚠ This operation is built on top of an EXPLICITLY unruled contract gap
 *
 * `files.KNOWN_CONTRACT_GAPS.FS10` says, in the contract's own words: whether to offer a
 * revoke exit at all is `[待定 T-5]`, and the UI already ships `files-trash-revoke`/
 * `files-trash-revoked` testids while the delete-confirmation screen offers no revoke entry
 * -- "同一件事在两个屏上表了相反的态". This file does not resolve that dispute (it is not
 * this feature's call to make); it implements the operation the SIGNED contract already
 * commits to (`revokeDeletion` is a real entry in `files.operations`, not a draft), on the
 * conservative reading: a revoke undoes cascade ① (the object's visibility) but leaves
 * `deletion_tasks.status` UNCHANGED, because `DeletionTaskStatus` has no fifth
 * `"revoked"` value to move it to -- inventing one here would be exactly the kind of
 * unilateral schema decision `files.ts`'s own `KNOWN_CONTRACT_GAPS` entries refuse to make
 * for T-4/T-5/T-6/T-9. If T-5 is ruled "no revoke", the fix is to delete this file, the two
 * UI testids, and this contract operation together (FS10's own instruction) -- not to leave
 * one of the three behind.
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { LegalHoldGate, DeletionTaskRepository } from "./deletion-ports";
import type { RevokeDeletionRepository } from "./revoke-deletion-ports";

export type RevokeDeletionResult = z.infer<typeof C.operations.revokeDeletion.out>;

export type RevokeDeletionReasonCode = "DELETION_PARTIAL_FAILURE" | "CASCADE_TARGET_UNAVAILABLE" | "LEGAL_HOLD_ACTIVE";

export class RevokeDeletionError extends Error {
  constructor(readonly reasonCode: RevokeDeletionReasonCode) {
    super("revoke_deletion_failed");
  }
}

export interface RevokeDeletionDeps {
  readonly tasks: DeletionTaskRepository;
  readonly legalHold: LegalHoldGate;
  readonly repo: RevokeDeletionRepository;
}

export interface RevokeDeletionInput {
  readonly orgId: OrgId;
  readonly taskId: string;
  readonly reason: string;
}

export async function revokeDeletion(deps: RevokeDeletionDeps, input: RevokeDeletionInput): Promise<RevokeDeletionResult> {
  const task = await deps.tasks.getTask(input.orgId, input.taskId);
  // No task, or physical deletion already happened -- nothing left to revoke. Collapsed to
  // `DELETION_PARTIAL_FAILURE`, the same "there is nothing here to act on" reuse
  // `retry-cascade.ts` already makes for this operation's sibling.
  if (task === null || task.status === "done") throw new RevokeDeletionError("DELETION_PARTIAL_FAILURE");

  // A hold applied AFTER the deletion request takes precedence: the object must stay
  // logically absent from the browser while the hold is active, so revoking is refused
  // until the hold itself is released.
  if (await deps.legalHold.isActive(input.orgId, task.artifactId)) {
    throw new RevokeDeletionError("LEGAL_HOLD_ACTIVE");
  }

  await deps.repo.restoreArtifact(input.orgId, task.artifactId);

  return { status: task.status };
}
