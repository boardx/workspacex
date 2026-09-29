import type { WorkflowNotAllowlistedHint } from "@repo/contracts/work-content";
import type { WorkflowErrorCode, WorkflowInstanceProjection, WorkflowReasonCode } from "@repo/contracts/workflow-runtime";
import type { z } from "zod";

export class WorkflowUseCaseError extends Error {
  constructor(
    readonly code: WorkflowErrorCode,
    message: string,
    readonly details: {
      missingSkills?: string[];
      issues?: unknown[];
      latestProjection?: WorkflowInstanceProjection;
      /** A5：gate_already_decided 带已落定的门。 */
      decidedGate?: NonNullable<WorkflowInstanceProjection["openGate"]>;
      /** CT06 / 契约束 work-content E3：Agent 可运行但 Workflow 不在其已发布白名单内（403 body 附 hint）。 */
      allowlistHint?: z.infer<typeof WorkflowNotAllowlistedHint>;
    } = {},
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
