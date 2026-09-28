import type { WorkflowErrorCode, WorkflowReasonCode } from "@repo/contracts/workflow-runtime";

export class WorkflowUseCaseError extends Error {
  constructor(
    readonly code: WorkflowErrorCode,
    message: string,
    readonly details: { missingSkills?: string[]; issues?: unknown[] } = {},
  ) {
    super(message);
    this.name = "WorkflowUseCaseError";
  }
}

/**
 * WF02 / E2：lease 的 epoch 已不属于调用者（被接管或过期）。这不是 HTTP 错误码而是运行中阻断原因
 * （`WorkflowReasonCode.workflow_lease_lost`），所以不复用 WorkflowUseCaseError。
 */
export class WorkflowLeaseLostError extends Error {
  readonly reasonCode = "workflow_lease_lost" as const satisfies WorkflowReasonCode;
  constructor(
    readonly instanceId: string,
    readonly heldEpoch: number,
    readonly currentEpoch: number | null,
  ) {
    super(`workflow lease lost for instance ${instanceId}: held epoch ${heldEpoch}, current ${currentEpoch ?? "none"}`);
    this.name = "WorkflowLeaseLostError";
  }
}
