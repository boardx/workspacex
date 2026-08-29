import type { interview } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../../domain/org-id";

export type DigitalInterviewWorkflowView = z.infer<typeof interview.DigitalInterviewWorkflowView>;

interface ActorInput {
  readonly orgId: OrgId;
  readonly actorId: string;
}

export interface DigitalInterviewRuntime {
  createDraft(input: ActorInput & z.infer<typeof interview.operations.createDigitalInterviewDraft.in>): Promise<DigitalInterviewWorkflowView>;
  get(input: ActorInput & { readonly interviewId: string }): Promise<DigitalInterviewWorkflowView>;
  confirmTopic(input: ActorInput & z.infer<typeof interview.operations.confirmDigitalInterviewTopic.in>): Promise<DigitalInterviewWorkflowView>;
  confirmExperts(input: ActorInput & z.infer<typeof interview.operations.confirmDigitalInterviewExperts.in>): Promise<DigitalInterviewWorkflowView>;
  confirmQuestions(input: ActorInput & z.infer<typeof interview.operations.confirmDigitalInterviewQuestions.in>): Promise<DigitalInterviewWorkflowView>;
  appendSkillMessage(input: ActorInput & z.infer<typeof interview.operations.appendDigitalInterviewSkillMessage.in>): Promise<DigitalInterviewWorkflowView>;
  applySkillProposal(input: ActorInput & z.infer<typeof interview.operations.applyDigitalInterviewSkillProposal.in>): Promise<DigitalInterviewWorkflowView>;
  rejectSkillProposal(input: ActorInput & z.infer<typeof interview.operations.rejectDigitalInterviewSkillProposal.in>): Promise<DigitalInterviewWorkflowView>;
}

export class DigitalInterviewWorkflowError extends Error {
  constructor(
    readonly code:
      | "NO_INTERVIEW_ACCESS"
      | "DIGITAL_INTERVIEW_INPUT_INVALID"
      | "DIGITAL_INTERVIEW_STEP_INVALID"
      | "CONCURRENT_MODIFICATION"
      | "IDEMPOTENCY_KEY_REUSED"
      | "PERMISSION_REVOKED_MIDWAY"
      | "AI_GENERATION_UNAVAILABLE"
      | "DEPENDENCY_UNAVAILABLE",
  ) {
    super(code);
  }
}

export const DIGITAL_INTERVIEW_RUNTIME = Symbol("DigitalInterviewRuntime");
