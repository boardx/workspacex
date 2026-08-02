/**
 * F46 -- `listTrashQueue` (uc-22-4 R3.d / R5). Only compliance may see this list -- see
 * `project-role-matrix.ts`'s `artifact.complianceOps` comment for the facilitator stand-in
 * pending FS9's ruling on a real "合规负责人" project role.
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { OrgId } from "../../domain/org-id";
import type { TrashQueueRepository, TrashQueueStatus } from "./trash-queue-ports";

export type ListTrashQueueResult = z.infer<typeof C.operations.listTrashQueue.out>;

export type ListTrashQueueReasonCode = "NO_PROJECT_ROLE" | "PROJECT_ROLE_INSUFFICIENT";

export class ListTrashQueueError extends Error {
  constructor(readonly reasonCode: ListTrashQueueReasonCode) {
    super("list_trash_queue_failed");
  }
}

const COMPLIANCE_ACTION = "artifact.complianceOps";

export interface ListTrashQueueDeps extends AuthorizeDeps {
  readonly trashQueue: TrashQueueRepository;
}

export interface ListTrashQueueInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string;
  readonly status: TrashQueueStatus | null;
}

export async function listTrashQueue(
  deps: ListTrashQueueDeps,
  input: ListTrashQueueInput,
): Promise<ListTrashQueueResult> {
  const decision = await authorize(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: input.projectId,
    object: { kind: "project", id: input.projectId },
    action: COMPLIANCE_ACTION,
  });
  if (!decision.allowed) {
    // `listTrashQueue.err` has no `ADMIN_NOT_SUPERUSER` -- an org `compliance`/`admin` role
    // hitting this without a project role collapses to `NO_PROJECT_ROLE`, same reasoning
    // `get-project-overview.ts` documents for its own `ADMIN_NOT_SUPERUSER`-aware branch,
    // inverted: here the contract never asked for the finer code, so it is not surfaced.
    throw new ListTrashQueueError(
      decision.reasonCode === "PROJECT_ROLE_INSUFFICIENT" ? "PROJECT_ROLE_INSUFFICIENT" : "NO_PROJECT_ROLE",
    );
  }

  const taskIds = await deps.trashQueue.listTaskIds(input.orgId, input.projectId, input.status);
  return { taskIds: [...taskIds] };
}
