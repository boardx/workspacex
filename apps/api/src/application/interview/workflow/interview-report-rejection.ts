import { DigitalInterviewWorkflowError } from "./digital-interview-runtime.port";
export const REPORT_REJECTION_CODES = ["REPORT_ACTION_VALIDATION_REJECTED", "REPORT_QUALITY_REJECTED", "REPORT_GROUNDING_REJECTED"] as const;
export type ReportRejectionCode = typeof REPORT_REJECTION_CODES[number];
export class ReportGenerationRejectedError extends DigitalInterviewWorkflowError {
  constructor(readonly reasonCode: ReportRejectionCode) { super("AI_GENERATION_UNAVAILABLE"); }
}
/** Only a known subtype and allowlisted enum may cross the public boundary. */
export function reportRejectionReason(error: unknown): ReportRejectionCode | undefined {
  return error instanceof ReportGenerationRejectedError && REPORT_REJECTION_CODES.includes(error.reasonCode) ? error.reasonCode : undefined;
}
