import type { SharedStageValue } from "@repo/contracts/aidt-stages";
export type AidtStageErrorCode = "AIDT_STAGE_NOT_FOUND" | "AIDT_STAGE_READONLY" | "AIDT_STAGE_REVISION_CONFLICT" | "AIDT_STAGE_OPERATION_CONFLICT" | "AIDT_STAGE_INVALID" | "AIDT_STAGE_TOO_LARGE" | "AIDT_STAGE_UNAVAILABLE";
export class AidtStageError extends Error {
  constructor(readonly reasonCode: AidtStageErrorCode, readonly current?: SharedStageValue | null) { super(reasonCode); }
}
