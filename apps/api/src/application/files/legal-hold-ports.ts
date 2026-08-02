/**
 * F46 -- the write-side legal hold ports (`applyLegalHold`/`releaseLegalHold`, uc-22-4
 * R3.d 点 15). Read-side (`LegalHoldGate.isActive`) is F45's, in `deletion-ports.ts`, and
 * stays there unchanged -- this file only adds what F45's own header already reserved for
 * F46: "施加/解除 write paths".
 */
import type { OrgId } from "../../domain/org-id";
import type { ActiveHold } from "../../domain/files/legal-hold";

export interface LegalHoldWriteRepository {
  /** Null when the artifact does not exist (caller checks visibility separately). */
  getActive(orgId: OrgId, artifactId: string): Promise<ActiveHold | null>;

  /** Inserts the hold row. Caller has already checked there is no active hold. */
  apply(input: {
    readonly orgId: OrgId;
    readonly holdId: string;
    readonly artifactId: string;
    readonly reason: string;
    readonly appliedBy: string;
    readonly appliedAt: Date;
  }): Promise<void>;

  /** Sets the three release columns on the existing active hold row. */
  release(input: {
    readonly orgId: OrgId;
    readonly holdId: string;
    readonly releasedBy: string;
    readonly releasedAt: Date;
    readonly releaseReason: string;
  }): Promise<void>;
}

export const LEGAL_HOLD_WRITE_REPOSITORY = Symbol("LegalHoldWriteRepository");
