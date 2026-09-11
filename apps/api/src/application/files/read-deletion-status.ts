import { files as C } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import { isOverdue } from "../../domain/files/physical-delete";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import type { DeletionTaskRepository } from "./deletion-ports";
import type { DeletionReceiptRepository } from "./physical-delete-ports";
import { getDeletionReceipt } from "./get-deletion-receipt";
import { discloseDecided, isDisclosed, type Guarded } from "../security/permission-filter";

export interface ReadDeletionStatusDeps extends AuthorizeDeps {
  tasks: DeletionTaskRepository;
  receipts: DeletionReceiptRepository;
  taskProject(orgId: OrgId, taskId: string): Promise<{ projectId: string | null; artifactId: string; task: Guarded<{ taskId: string }> } | null>;
  now(): Date;
}
export class DeletionStatusDeniedError extends Error {
  constructor() { super("deletion_status_denied"); }
}
async function authorizeTask(deps: ReadDeletionStatusDeps, input: { orgId: OrgId; userId: string; taskId: string }) {
  const scope = await deps.taskProject(input.orgId, input.taskId);
  if (!scope) throw new DeletionStatusDeniedError();
  const decision = await authorize(deps, { ...input, projectId: scope.projectId ?? undefined,
    object: { kind: "artifact", id: scope.artifactId }, action: "artifact.complianceOps" });
  if (!decision.allowed || !isDisclosed(discloseDecided(scope.task, decision))) throw new DeletionStatusDeniedError();
}
export async function readDeletionStatus(deps: ReadDeletionStatusDeps, input: { orgId: OrgId; userId: string; taskId: string }) {
  await authorizeTask(deps, input);
  const task = await deps.tasks.getTask(input.orgId, input.taskId);
  if (!task) throw new DeletionStatusDeniedError();
  return C.operations.getDeletionTask.out.parse({
    taskId: task.taskId, artifactRef: task.artifactId,
    step: task.status === "done" ? 5 : task.status === "pending" ? 1 : 3,
    // Only request time is persisted. Never invent timestamps for later steps.
    stepTimestamps: [{ step: 1, at: task.requestedAt.toISOString() }],
    status: task.status, cascadeResults: task.cascadeResults.map(({ kind, result }) => ({ kind, result })),
    receiptId: task.status === "done" ? task.receiptId : null, overdue: isOverdue(task, deps.now()),
  });
}
export async function readAuthorizedDeletionReceipt(deps: ReadDeletionStatusDeps, input: { orgId: OrgId; userId: string; taskId: string }) {
  await authorizeTask(deps, input);
  return getDeletionReceipt(deps, input);
}
