import type { OrgId } from "../../domain/org-id";

export interface RevokeDeletionRepository {
  /** Un-does cascade ① (`artifacts.deleted_at = NULL`) -- the object becomes visible again. */
  restoreArtifact(orgId: OrgId, artifactId: string): Promise<void>;
}

export const REVOKE_DELETION_REPOSITORY = Symbol("RevokeDeletionRepository");
