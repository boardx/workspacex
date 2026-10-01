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

  /**
   * 占位一条 receipt。返回 null = 本请求拿到了执行权；返回投影 = 与本请求**同指纹**的并发请求
   * 已先一步完成，调用方直接回放。同指纹但仍在执行 → RESEARCH_WORKFLOW_BUSY；
   * 异指纹 → RESEARCH_IDEMPOTENCY_REPLAY_MISMATCH（WF07 review：竞态按指纹区分）。
   */
  begin(input: {
    readonly orgId: OrgId;
    readonly sessionId: string;
    readonly requestId: string;
    readonly node: string;
    readonly action: string;
    readonly payloadFingerprint: string;
  }): Promise<GuidedResearchWorkflowProjection | null>;

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
