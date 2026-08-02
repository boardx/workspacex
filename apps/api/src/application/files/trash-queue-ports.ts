/**
 * F46 -- `listTrashQueue`'s read port (uc-22-4 R3.d / R5: "合规负责人可查看待删除队列").
 *
 * Deliberately thin: the contract's `out` is `{ taskIds: string[] }` -- the compliance view
 * fetches each task's five-step detail through the ALREADY-SIGNED `getDeletionTask` (F45),
 * one call per id, rather than this port re-shaping `DeletionTaskRow` into a second list
 * projection. That keeps "what a deletion task looks like" declared in exactly one place.
 */
import type { OrgId } from "../../domain/org-id";

export type TrashQueueStatus = "pending" | "running" | "done" | "partial-failure";

export interface TrashQueueRepository {
  listTaskIds(orgId: OrgId, projectId: string, status: TrashQueueStatus | null): Promise<readonly string[]>;
}

export const TRASH_QUEUE_REPOSITORY = Symbol("TrashQueueRepository");
