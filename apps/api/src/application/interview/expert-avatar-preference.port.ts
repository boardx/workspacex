import type { ExpertAvatarPreference } from "@repo/contracts/interview-expert-avatar";
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

export type ExpertAvatarScope = { orgId: OrgId; actorId: string; expertId: string; interviewId?: string; revisionId?: string };
export type StoredExpertAvatarPreference = { orgId: string; actorId: string; item: Guarded<ExpertAvatarPreference> };
export interface ExpertAvatarPreferenceRepository {
  read(input: ExpertAvatarScope): Promise<StoredExpertAvatarPreference>;
  save(input: ExpertAvatarScope & { avatarKey: ExpertAvatarPreference["avatarKey"]; expectedVersion: number }): Promise<StoredExpertAvatarPreference | null>;
}
export const EXPERT_AVATAR_PREFERENCE_REPOSITORY = Symbol("ExpertAvatarPreferenceRepository");
export class ExpertAvatarSourceAccessError extends Error {}
export class ExpertAvatarSourceRevisionConflictError extends Error {}
