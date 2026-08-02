/**
 * F46 -- `getRetentionPolicy`/`setRetentionPolicy`'s persistence port (O-01, D-14, N-20).
 *
 * Named distinctly from `application/recording/retention-ports.ts` (F78): that module
 * resolves a DIFFERENT fact (per-material retention lifecycle, with test-supplied
 * parameters and no organizational default of its own) -- same-name-different-meaning is
 * exactly the trap this repo has legislated against, so this file gets its own name
 * (`RetentionPolicyRepository`, not `RetentionParameterStore`) even though both are about
 * "how many days".
 */
import type { OrgId } from "../../domain/org-id";
import type { PartialRetentionParams } from "../../domain/files/retention-policy";

export interface RetentionPolicyRepository {
  /** Null when the project has never called `setRetentionPolicy` -- no override on file. */
  getOverride(orgId: OrgId, projectId: string): Promise<PartialRetentionParams | null>;

  /** Upserts the project's override (merged result, already validated by the caller). */
  setOverride(input: {
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly params: PartialRetentionParams;
    readonly updatedBy: string;
  }): Promise<void>;
}

export const RETENTION_POLICY_REPOSITORY = Symbol("RetentionPolicyRepository");
