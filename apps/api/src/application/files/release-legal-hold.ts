/**
 * F46 -- `releaseLegalHold` (uc-22-4 R3.d 点 15: "解除同样全程留痕——解除比施加更需要问责").
 * Same authorization/lookup shape as `apply-legal-hold.ts`; see that file's header.
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import { buildHoldRelease, LegalHoldError } from "../../domain/files/legal-hold";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { DeleteImpactRepository } from "./deletion-ports";
import type { LegalHoldWriteRepository } from "./legal-hold-ports";
import type { ProvenanceWriter } from "../provenance/ports";

export type ReleaseLegalHoldResult = z.infer<typeof C.operations.releaseLegalHold.out>;

export type ReleaseLegalHoldReasonCode = "ARTIFACT_NOT_FOUND" | "PROJECT_ROLE_INSUFFICIENT";

export class ReleaseLegalHoldError extends Error {
  constructor(readonly reasonCode: ReleaseLegalHoldReasonCode) {
    super("release_legal_hold_failed");
  }
}

const COMPLIANCE_ACTION = "artifact.complianceOps";

export interface ReleaseLegalHoldDeps extends AuthorizeDeps {
  readonly impact: DeleteImpactRepository;
  readonly holds: LegalHoldWriteRepository;
  readonly provenance: ProvenanceWriter;
  readonly now: () => Date;
}

export interface ReleaseLegalHoldInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly artifactId: string;
  readonly reason: string;
}

export async function releaseLegalHold(
  deps: ReleaseLegalHoldDeps,
  input: ReleaseLegalHoldInput,
): Promise<ReleaseLegalHoldResult> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  const found = await deps.impact.findDeletable({
    orgId: input.orgId,
    artifactId: input.artifactId,
    requesterTeamId: membership?.teamId ?? null,
  });
  if (!found) throw new ReleaseLegalHoldError("ARTIFACT_NOT_FOUND");

  const decision = await authorize(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: found.projectId ?? undefined,
    object: { kind: "artifact", id: found.artifactId },
    action: COMPLIANCE_ACTION,
  });
  if (!decision.allowed) throw new ReleaseLegalHoldError("PROJECT_ROLE_INSUFFICIENT");
  if (!isDisclosed(discloseDecided(found.artifact, decision))) {
    throw new ReleaseLegalHoldError("PROJECT_ROLE_INSUFFICIENT");
  }

  const activeHold = await deps.holds.getActive(input.orgId, found.artifactId);
  let release;
  try {
    release = buildHoldRelease({
      activeHold,
      releasedBy: input.userId,
      releasedAt: deps.now(),
      releaseReason: input.reason,
    });
  } catch (e) {
    // Same collapse `apply-legal-hold.ts` makes: `releaseLegalHold.err` is exactly
    // `["PROJECT_ROLE_INSUFFICIENT", "ARTIFACT_NOT_FOUND"]`, signed, closed -- "there is no
    // active hold to release" has no third reason code to be.
    if (e instanceof LegalHoldError) throw new ReleaseLegalHoldError("PROJECT_ROLE_INSUFFICIENT");
    throw e;
  }

  await deps.holds.release({
    orgId: input.orgId,
    holdId: release.holdId,
    releasedBy: release.releasedBy,
    releasedAt: release.releasedAt,
    releaseReason: release.releaseReason,
  });

  await deps.provenance.append({
    orgId: input.orgId,
    type: "legal-hold-released",
    actorId: input.userId,
    target: { kind: "artifact", id: found.artifactId },
    detail: { holdId: release.holdId, releaseReason: release.releaseReason },
  });

  return {
    holdId: release.holdId,
    releasedBy: release.releasedBy,
    releasedAt: release.releasedAt.toISOString(),
  };
}
