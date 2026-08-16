import type { z } from "zod";
import type { research as C } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";

export type GuidedResearchWorkflowProjection = z.infer<typeof C.GuidedResearchWorkflowProjection>;

export interface GuidedResearchNodeReceiptReplay {
  readonly payloadFingerprint: string;
  readonly stableResponse: GuidedResearchWorkflowProjection | null;
}

export interface GuidedResearchNodeReceiptRepository {
  find(input: {
    readonly orgId: OrgId;
    readonly sessionId: string;
    readonly requestId: string;
  }): Promise<GuidedResearchNodeReceiptReplay | null>;

  begin(input: {
    readonly orgId: OrgId;
    readonly sessionId: string;
    readonly requestId: string;
    readonly node: string;
    readonly action: string;
    readonly payloadFingerprint: string;
  }): Promise<void>;

  finalize(input: {
    readonly orgId: OrgId;
    readonly sessionId: string;
    readonly requestId: string;
    readonly checkpointId: string;
    readonly graphVersion: number;
    readonly stableResponse: GuidedResearchWorkflowProjection;
  }): Promise<void>;
}

export const GUIDED_RESEARCH_NODE_RECEIPT_REPOSITORY = Symbol("GuidedResearchNodeReceiptRepository");
