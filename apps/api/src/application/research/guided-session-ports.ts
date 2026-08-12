import type { z } from "zod";
import { research } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

export type GuidedResearchSession = z.infer<typeof research.GuidedResearchSession>;
export type GuidedResearchBrief = z.infer<typeof research.GuidedResearchBrief>;
export interface GuardedGuidedResearchSession {
  item: Guarded<GuidedResearchSession>;
  ownerUserId: string;
}

export interface GuidedResearchSessionRepository {
  create(input: {
    orgId: OrgId;
    ownerUserId: string;
    idempotencyKey: string;
    brief: GuidedResearchBrief;
  }): Promise<GuardedGuidedResearchSession>;
  listOwned(orgId: OrgId, ownerUserId: string): Promise<readonly GuardedGuidedResearchSession[]>;
  findOwned(orgId: OrgId, ownerUserId: string, sessionId: string): Promise<GuardedGuidedResearchSession | null>;
}

export const GUIDED_RESEARCH_SESSION_REPOSITORY = Symbol("GuidedResearchSessionRepository");
