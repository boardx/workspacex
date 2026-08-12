import { interview } from "@repo/contracts";
import type { z } from "zod";

export type DigitalInterviewStatusName = z.infer<typeof interview.DigitalInterviewStatus>;

const ALLOWED_TRANSITIONS: Readonly<Record<DigitalInterviewStatusName, readonly DigitalInterviewStatusName[]>> = {
  draft: ["topic_pending", "experts_pending", "failed"],
  topic_pending: ["experts_pending", "failed"],
  experts_pending: ["questions_pending", "failed"],
  questions_pending: ["running", "failed"],
  running: ["report_pending", "failed"],
  report_pending: ["completed", "failed"],
  completed: [],
  failed: ["topic_pending", "experts_pending", "questions_pending", "running", "report_pending"],
};

export function canTransitionDigitalInterview(
  from: DigitalInterviewStatusName,
  to: DigitalInterviewStatusName,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export type DigitalInterviewStep = z.infer<typeof interview.DigitalInterviewStep>;
export type DigitalInterviewPrimaryAction = z.infer<typeof interview.DigitalInterviewPrimaryAction>;

export interface DigitalInterviewStateProjection {
  readonly cardStatus: DigitalInterviewStatusName;
  readonly detailStatus: DigitalInterviewStatusName;
  readonly currentStep: DigitalInterviewStep;
  readonly primaryAction: DigitalInterviewPrimaryAction;
}

export function projectDigitalInterviewState(status: DigitalInterviewStatusName): DigitalInterviewStateProjection {
  const projected = {
    draft: { currentStep: "topic", primaryAction: "confirm_topic" },
    topic_pending: { currentStep: "topic", primaryAction: "confirm_topic" },
    experts_pending: { currentStep: "experts", primaryAction: "confirm_experts" },
    questions_pending: { currentStep: "questions", primaryAction: "confirm_questions" },
    running: { currentStep: "runs", primaryAction: "continue_runs" },
    report_pending: { currentStep: "report", primaryAction: "generate_report" },
    completed: { currentStep: "report", primaryAction: "view_report" },
    failed: { currentStep: "runs", primaryAction: "retry" },
  } as const satisfies Record<
    DigitalInterviewStatusName,
    { readonly currentStep: DigitalInterviewStep; readonly primaryAction: DigitalInterviewPrimaryAction }
  >;
  return { cardStatus: status, detailStatus: status, ...projected[status] };
}
