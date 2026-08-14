import type { z } from "zod";
import { research } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

export type GuidedResearchSession = z.infer<typeof research.GuidedResearchSession>;
export type GuidedResearchBrief = z.infer<typeof research.GuidedResearchBrief>;
export type GuidedResearchDirection = z.infer<typeof research.GuidedResearchDirection>;
export type GuidedResearchOutlineSection = z.infer<typeof research.GuidedResearchOutlineSection>;
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
    title: string;
    tags: readonly string[];
    collaboratorUserIds: readonly string[];
    brief: GuidedResearchBrief;
  }): Promise<GuardedGuidedResearchSession>;
  listVisible(orgId: OrgId, viewerUserId: string): Promise<readonly GuardedGuidedResearchSession[]>;
  findVisible(orgId: OrgId, viewerUserId: string, sessionId: string): Promise<GuardedGuidedResearchSession | null>;
  generateDirections(input: { orgId: OrgId; viewerUserId: string; sessionId: string; items: readonly GuidedResearchDirection[] }): Promise<GuardedGuidedResearchSession | null>;
  confirmDirections(input: { orgId: OrgId; viewerUserId: string; sessionId: string; candidateVersion: number; items: readonly GuidedResearchDirection[] }): Promise<GuardedGuidedResearchSession | null>;
  generateOutline(input: { orgId: OrgId; viewerUserId: string; sessionId: string; items: readonly GuidedResearchOutlineSection[] }): Promise<GuardedGuidedResearchSession | null>;
  confirmOutline(input: { orgId: OrgId; viewerUserId: string; sessionId: string; candidateVersion: number; items: readonly GuidedResearchOutlineSection[] }): Promise<GuardedGuidedResearchSession | null>;
  finishCollection(input: { orgId: OrgId; viewerUserId: string; sessionId: string; sourceCount: number }): Promise<GuardedGuidedResearchSession | null>;
  complete(input: { orgId: OrgId; viewerUserId: string; sessionId: string }): Promise<GuardedGuidedResearchSession | null>;
}

export const GUIDED_RESEARCH_SESSION_REPOSITORY = Symbol("GuidedResearchSessionRepository");

export class InvalidGuidedResearchCollaboratorError extends Error {
  readonly reasonCode = "INVALID_RESEARCH_COLLABORATOR";
}

export class GuidedResearchCreateReplayMismatchError extends Error {
  readonly reasonCode = "RESEARCH_CREATE_REPLAY_MISMATCH";
}

export class GuidedResearchCheckpointConflictError extends Error {
  readonly reasonCode = "RESEARCH_CHECKPOINT_CONFLICT";
}

export class GuidedResearchDirectionsNotConfirmedError extends Error {
  readonly reasonCode = "RESEARCH_DIRECTIONS_NOT_CONFIRMED";
}

export class GuidedResearchStageConflictError extends Error {
  readonly reasonCode = "RESEARCH_STAGE_CONFLICT";
}
