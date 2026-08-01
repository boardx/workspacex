/**
 * F39 ports -- REVIEW_PENDING's two new concerns: reading whether an ARTIFACT (not a
 * version -- confidential is a material-level flag, O-17) was marked confidential, and
 * recording a human's accept/reject disposition once one has been made.
 *
 * Kept separate from `application/artifact/ports.ts` (`ArtifactRepository`, F04/F35/F37's own
 * growing surface) the same way F36 kept `ingestion-ports.ts` separate: this is F39's own new
 * concern -- everything the REVIEW_PENDING fork and its resolution need that nothing before
 * it had a reason to expose.
 */
import type { z } from "zod";
import { files as C } from "@repo/contracts";
import type { OrgId } from "../../domain/org-id";

/** O-17: read-only lookup of the material-level confidential flag F35 already writes. */
export interface ConfidentialityLookup {
  isConfidential(orgId: OrgId, artifactId: string): Promise<boolean>;
}

export const CONFIDENTIALITY_LOOKUP = Symbol("ConfidentialityLookup");

export type ReviewDecision = z.infer<typeof C.ReviewResolutionDecision>;

export interface ReviewDispositionRecord {
  readonly artifactId: string;
  readonly decision: ReviewDecision;
  readonly note: string;
  readonly actorId: string;
  readonly resolvedAt: string;
}

export interface NewReviewDisposition {
  readonly orgId: OrgId;
  readonly artifactId: string;
  readonly decision: ReviewDecision;
  readonly note: string;
  readonly actorId: string;
}

/**
 * The human disposition trail (uc-22-2 R3 step 11 / R8's 接受/拒绝). A disposition is
 * recorded once and never overwritten -- a second `resolve` call on an already-resolved
 * artifact is `resolveReviewPending`'s own job to refuse (`REVIEW_REQUIRED`), not this port's.
 */
export interface ReviewDispositionRepository {
  record(d: NewReviewDisposition): Promise<void>;
  find(orgId: OrgId, artifactId: string): Promise<ReviewDispositionRecord | null>;
}

export const REVIEW_DISPOSITION_REPOSITORY = Symbol("ReviewDispositionRepository");
