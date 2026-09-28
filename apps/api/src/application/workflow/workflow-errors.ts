import type { WorkflowErrorCode } from "@repo/contracts/workflow-runtime";

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
