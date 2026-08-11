import type { OrgId } from "../../domain/org-id";
import type { DigitalInterviewStatusName } from "../../domain/interview/digital-interview";
import type { ScopeSelector } from "../../domain/interview/scope";
import type { InterviewVisibilityFacts } from "../../domain/interview/scope";
import type { Guarded } from "../security/permission-filter";

export interface StoredDigitalInterview {
  readonly interviewId: string;
  readonly orgId: OrgId;
  readonly name: string;
  readonly tags: readonly string[];
  readonly topic: string;
  readonly status: DigitalInterviewStatusName;
  readonly sourceQuickInterviewId: string | null;
  readonly selectedExpertIds: readonly string[];
  readonly reportId: string | null;
  readonly version: number;
  readonly createdBy: string;
}

export interface CreateDigitalInterviewRecordInput {
  readonly orgId: OrgId;
  readonly interviewId: string;
  readonly actorId: string;
  readonly scope: ScopeSelector;
  readonly name: string;
  readonly tags: readonly string[];
  readonly topic: string;
}

export interface DigitalInterviewRepository {
  createDraft(input: CreateDigitalInterviewRecordInput): Promise<StoredDigitalInterview>;
  findVisibleById(
    orgId: OrgId,
    viewerUserId: string,
    interviewId: string,
  ): Promise<{
    readonly item: Guarded<StoredDigitalInterview>;
    readonly facts: InterviewVisibilityFacts;
  } | null>;
  updateStatus(input: {
    readonly orgId: OrgId;
    readonly interviewId: string;
    readonly expectedVersion: number;
    readonly fromStatus: DigitalInterviewStatusName;
    readonly toStatus: DigitalInterviewStatusName;
  }): Promise<void>;
}

export const DIGITAL_INTERVIEW_REPOSITORY = Symbol("DigitalInterviewRepository");
