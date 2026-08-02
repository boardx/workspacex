/**
 * F46 -- `applyLegalHold` (uc-22-4 R3.d 点 15). Authorization mirrors `requestDeletion`'s
 * shape exactly (see `project-role-matrix.ts`'s `artifact.complianceOps` comment for why
 * facilitator is the stand-in "合规负责人" pending FS9's ruling), and the artifact lookup
 * reuses F45's `DeleteImpactRepository.findDeletable` -- applying a hold needs the SAME
 * "does this artifact exist and is it visible to me" answer requestDeletion needs, and a
 * second lookup port for the identical question would be exactly the kind of duplicate this
 * repo keeps finding after the fact.
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import { buildHoldApplication, LegalHoldError } from "../../domain/files/legal-hold";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { DeleteImpactRepository } from "./deletion-ports";
import type { LegalHoldWriteRepository } from "./legal-hold-ports";
import type { ProvenanceWriter } from "../provenance/ports";
import type { IdFactory } from "../artifact/ports";

export type ApplyLegalHoldResult = z.infer<typeof C.operations.applyLegalHold.out>;

export type ApplyLegalHoldReasonCode = "ARTIFACT_NOT_FOUND" | "PROJECT_ROLE_INSUFFICIENT";

export class ApplyLegalHoldError extends Error {
  constructor(readonly reasonCode: ApplyLegalHoldReasonCode) {
    super("apply_legal_hold_failed");
  }
}

const COMPLIANCE_ACTION = "artifact.complianceOps";

export interface ApplyLegalHoldDeps extends AuthorizeDeps {
  readonly impact: DeleteImpactRepository;
  readonly holds: LegalHoldWriteRepository;
  readonly provenance: ProvenanceWriter;
  readonly idFactory: IdFactory;
  readonly now: () => Date;
}

export interface ApplyLegalHoldInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly artifactId: string;
  readonly reason: string;
}

export async function applyLegalHold(
  deps: ApplyLegalHoldDeps,
  input: ApplyLegalHoldInput,
): Promise<ApplyLegalHoldResult> {
  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  const found = await deps.impact.findDeletable({
    orgId: input.orgId,
    artifactId: input.artifactId,
    requesterTeamId: membership?.teamId ?? null,
  });
  if (!found) throw new ApplyLegalHoldError("ARTIFACT_NOT_FOUND");

  const decision = await authorize(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: found.projectId ?? undefined,
    object: { kind: "artifact", id: found.artifactId },
    action: COMPLIANCE_ACTION,
  });
  if (!decision.allowed) throw new ApplyLegalHoldError("PROJECT_ROLE_INSUFFICIENT");
  if (!isDisclosed(discloseDecided(found.artifact, decision))) {
    throw new ApplyLegalHoldError("PROJECT_ROLE_INSUFFICIENT");
  }

  const existingActiveHold = (await deps.holds.getActive(input.orgId, found.artifactId)) !== null;
  let application;
  try {
    application = buildHoldApplication({
      holdId: deps.idFactory.next("legal-hold"),
      artifactId: found.artifactId,
      reason: input.reason,
      appliedBy: input.userId,
      appliedAt: deps.now(),
      existingActiveHold,
    });
  } catch (e) {
    // A blank reason cannot reach here (contract's `.min(1)` blocks it at the boundary);
    // an already-active hold collapses to PROJECT_ROLE_INSUFFICIENT rather than a THIRD
    // reason code the contract's `err` list does not have room for (`applyLegalHold.err`
    // is exactly `["PROJECT_ROLE_INSUFFICIENT", "ARTIFACT_NOT_FOUND"]`, signed, closed).
    if (e instanceof LegalHoldError) throw new ApplyLegalHoldError("PROJECT_ROLE_INSUFFICIENT");
    throw e;
  }

  await deps.holds.apply({
    orgId: input.orgId,
    holdId: application.holdId,
    artifactId: application.artifactId,
    reason: application.reason,
    appliedBy: application.appliedBy,
    appliedAt: application.appliedAt,
  });

  await deps.provenance.append({
    orgId: input.orgId,
    type: "legal-hold-applied",
    actorId: input.userId,
    target: { kind: "artifact", id: found.artifactId },
    detail: { holdId: application.holdId, reason: application.reason },
  });

  return {
    holdId: application.holdId,
    appliedBy: application.appliedBy,
    appliedAt: application.appliedAt.toISOString(),
  };
}
