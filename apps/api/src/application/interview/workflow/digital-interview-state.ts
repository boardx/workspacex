import { Annotation } from "@langchain/langgraph";
import type { interview } from "@repo/contracts";
import type { z } from "zod";

export type DigitalInterviewStep = z.infer<typeof interview.DigitalInterviewStep>;
export type DigitalInterviewQuestion = z.infer<typeof interview.DigitalInterviewQuestion>;

export type DigitalInterviewCommand =
  | { readonly kind: "confirm_topic"; readonly topic: string; readonly expectedVersion: number; readonly requestId: string }
  | { readonly kind: "confirm_experts"; readonly expertIds: readonly string[]; readonly expectedVersion: number; readonly requestId: string }
  | { readonly kind: "confirm_questions"; readonly questions: readonly DigitalInterviewQuestion[]; readonly expectedVersion: number; readonly requestId: string }
  | { readonly kind: "skill_refine"; readonly originStep: DigitalInterviewStep; readonly expectedVersion: number; readonly requestId: string };

export interface DigitalInterviewGraphState {
  readonly interviewId: string;
  readonly orgId: string;
  readonly actorId: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly currentStep: DigitalInterviewStep;
  readonly topicVersionId: string | null;
  readonly expertSnapshotVersionId: string | null;
  readonly questionVersionId: string | null;
  readonly skillThreadId: string;
  readonly lastOperationId: string | null;
  readonly lastRequestId: string | null;
  readonly aggregateVersion: number;
  readonly errorCode: string | null;
  readonly command: DigitalInterviewCommand | null;
}

export const DigitalInterviewStateAnnotation = Annotation.Root({
  interviewId: Annotation<string>(),
  orgId: Annotation<string>(),
  actorId: Annotation<string>(),
  revisionId: Annotation<string>(),
  revisionNumber: Annotation<number>(),
  currentStep: Annotation<DigitalInterviewStep>(),
  topicVersionId: Annotation<string | null>(),
  expertSnapshotVersionId: Annotation<string | null>(),
  questionVersionId: Annotation<string | null>(),
  skillThreadId: Annotation<string>(),
  lastOperationId: Annotation<string | null>(),
  lastRequestId: Annotation<string | null>(),
  aggregateVersion: Annotation<number>(),
  errorCode: Annotation<string | null>(),
  command: Annotation<DigitalInterviewCommand | null>(),
});

export function initialDigitalInterviewState(input: {
  readonly interviewId: string;
  readonly orgId: string;
  readonly actorId: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly skillThreadId: string;
  readonly currentStep?: DigitalInterviewStep;
  readonly topicVersionId?: string | null;
  readonly expertSnapshotVersionId?: string | null;
  readonly questionVersionId?: string | null;
}): DigitalInterviewGraphState {
  return {
    ...input,
    currentStep: input.currentStep ?? "topic",
    topicVersionId: input.topicVersionId ?? null,
    expertSnapshotVersionId: input.expertSnapshotVersionId ?? null,
    questionVersionId: input.questionVersionId ?? null,
    lastOperationId: null,
    lastRequestId: null,
    aggregateVersion: 1,
    errorCode: null,
    command: null,
  };
}
