import type { DigitalInterviewCommand, DigitalInterviewStep } from "./digital-interview-state";
import type { DigitalInterviewWorkflowView } from "./digital-interview-runtime.port";
import type { OrgId } from "../../../domain/org-id";
import type { ScopeSelector } from "../../../domain/interview/scope";

export type ConfirmationNodeName = "confirm_topic" | "confirm_experts" | "confirm_questions";

export interface CommitDigitalInterviewStepInput {
  readonly orgId: string;
  readonly actorId: string;
  readonly interviewId: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly nodeName: ConfirmationNodeName;
  readonly command: Exclude<DigitalInterviewCommand, { readonly kind: "skill_refine" }>;
  readonly operationId: string;
}

export interface CommitDigitalInterviewStepResult {
  readonly interviewId: string;
  readonly revisionId: string;
  readonly revisionNumber: number;
  readonly currentStep: DigitalInterviewStep;
  readonly topicVersionId: string | null;
  readonly expertSnapshotVersionId: string | null;
  readonly questionVersionId: string | null;
  readonly skillThreadId: string;
  readonly operationId: string;
}

export interface DigitalInterviewEffects {
  commitStep(input: CommitDigitalInterviewStepInput): Promise<CommitDigitalInterviewStepResult>;
  createDraft(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly revisionId: string; readonly skillThreadId: string; readonly scope: ScopeSelector;
    readonly name: string; readonly tags: readonly string[]; readonly requestId: string;
  }): Promise<DigitalInterviewWorkflowView>;
  findReceipt(input: {
    readonly orgId: OrgId; readonly operationName: string; readonly requestId: string;
    readonly payload: unknown;
  }): Promise<DigitalInterviewWorkflowView | null>;
  appendSkillMessage(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly currentStep: DigitalInterviewStep; readonly text: string;
    readonly assistantText: string; readonly proposalPatch: Readonly<Record<string, unknown>>;
    readonly expectedVersion: number; readonly requestId: string;
    readonly userMessageId: string; readonly assistantMessageId: string; readonly proposalId: string;
  }): Promise<DigitalInterviewWorkflowView>;
  setSkillProposalStatus(input: {
    readonly orgId: OrgId; readonly actorId: string; readonly interviewId: string;
    readonly proposalId: string; readonly status: "applied_to_draft" | "rejected";
    readonly expectedVersion: number; readonly requestId: string;
  }): Promise<DigitalInterviewWorkflowView>;
}

export const DIGITAL_INTERVIEW_EFFECTS = Symbol("DigitalInterviewEffects");
