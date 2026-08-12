import type { z } from "zod";
import { research } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

export type GuidedResearchSession = z.infer<typeof research.GuidedResearchSession>;
export type GuidedResearchBrief = z.infer<typeof research.GuidedResearchBrief>;
export interface GuardedGuidedResearchSession {
  item: Guarded<GuidedResearchSession>;
  ownerUserId: string;
  isExplicitCollaborator: boolean;
}

export interface GuidedResearchSessionRepository {
  create(input: {
    orgId: OrgId;
    ownerUserId: string;
    idempotencyKey: string;
    collaboratorUserIds: readonly string[];
    brief: GuidedResearchBrief;
  }): Promise<GuardedGuidedResearchSession>;
  listVisible(orgId: OrgId, viewerUserId: string): Promise<readonly GuardedGuidedResearchSession[]>;
  findVisible(orgId: OrgId, viewerUserId: string, sessionId: string): Promise<GuardedGuidedResearchSession | null>;
}

export const GUIDED_RESEARCH_SESSION_REPOSITORY = Symbol("GuidedResearchSessionRepository");

export class InvalidGuidedResearchCollaboratorError extends Error {
  readonly reasonCode = "INVALID_RESEARCH_COLLABORATOR";
}
