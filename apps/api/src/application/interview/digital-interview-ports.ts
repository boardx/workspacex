import type { OrgId } from "../../domain/org-id";
import type { DigitalInterviewStatusName } from "../../domain/interview/digital-interview";
import type { ScopeSelector } from "../../domain/interview/scope";
import type { InterviewVisibilityFacts } from "../../domain/interview/scope";
import type { Guarded } from "../security/permission-filter";
import type { DigitalInterviewWorkflowView } from "./workflow/digital-interview-runtime.port";

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

export interface StoredDigitalInterviewListItem extends StoredDigitalInterview {
  readonly updatedAt: string;
  readonly kind: "quick" | "batch";
}

export interface StoredDigitalExpert {
  readonly expertId: string;
  readonly initials: string;
  readonly displayName: string;
  readonly role: string;
  readonly domains: readonly string[];
  readonly materialContextPackId: string | null;
  readonly materialVersion: string | null;
}

export interface StoredQuickMessage {
  readonly messageId: string; readonly role: "user" | "assistant"; readonly text: string;
  readonly sourcePointers: readonly string[]; readonly createdAt: string;
}

export interface StoredQuickInterview {
  readonly interviewId: string; readonly expert: StoredDigitalExpert;
  readonly messages: readonly StoredQuickMessage[]; readonly version: number;
}

export interface StoredDigitalInterviewSourceMaterial {
  readonly sourceMessageId: string;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly sourcePointers: readonly string[];
}

export interface StoredConvertedDigitalInterview extends StoredDigitalInterview {
  readonly sourceMaterials: readonly StoredDigitalInterviewSourceMaterial[];
}

export interface DigitalExpertContextMaterial {
  readonly packId: string;
  readonly runId: string;
  readonly items: readonly {
    readonly segmentId: string;
    readonly content: string;
    readonly artifactVersionId: string;
    readonly permissionDecisionId: string;
  }[];
}

/** Adapter boundary to the signed Context Pack API; interview never reads its tables. */
export interface DigitalExpertContextApi {
  read(input: { readonly orgId: OrgId; readonly actorId: string; readonly runId: string }): Promise<DigitalExpertContextMaterial | null>;
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
  loadWorkflow(orgId: OrgId, interviewId: string): Promise<DigitalInterviewWorkflowView | null>;
  updateStatus(input: {
    readonly orgId: OrgId;
    readonly interviewId: string;
    readonly expectedVersion: number;
    readonly fromStatus: DigitalInterviewStatusName;
    readonly toStatus: DigitalInterviewStatusName;
  }): Promise<void>;
  listVisible(input: {
    readonly orgId: OrgId;
    readonly viewerUserId: string;
    readonly status?: DigitalInterviewStatusName;
  }): Promise<readonly {
    readonly item: Guarded<StoredDigitalInterviewListItem>;
    readonly facts: InterviewVisibilityFacts;
  }[]>;
  listVisibleExperts(input: {
    readonly orgId: OrgId;
    readonly viewerUserId: string;
    readonly domain?: string;
  }): Promise<readonly StoredDigitalExpert[]>;
  createQuick(input: { readonly orgId: OrgId; readonly interviewId: string; readonly actorId: string; readonly requestId: string; readonly expert: StoredDigitalExpert }): Promise<StoredQuickInterview>;
  loadQuick(orgId: OrgId, interviewId: string): Promise<StoredQuickInterview | null>;
  appendQuickExchange(input: { readonly orgId: OrgId; readonly interviewId: string; readonly expectedVersion: number; readonly userMessageId: string; readonly assistantMessageId: string; readonly question: string; readonly answer: string; readonly sourcePointers: readonly string[] }): Promise<void>;
  convertQuick(input: { readonly orgId: OrgId; readonly sourceInterviewId: string; readonly interviewId: string; readonly actorId: string; readonly expectedVersion: number; readonly name: string; readonly tags: readonly string[]; readonly topic: string }): Promise<StoredConvertedDigitalInterview>;
}

export const DIGITAL_INTERVIEW_REPOSITORY = Symbol("DigitalInterviewRepository");
export const DIGITAL_EXPERT_CONTEXT_API = Symbol("DigitalExpertContextApi");
