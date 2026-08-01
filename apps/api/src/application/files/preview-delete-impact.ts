/**
 * F45 -- `previewDeleteImpact` (uc-22-4 R3.c step 8): "删除前必须让人看见代价".
 *
 * Read-only, and gated the same way `requestDeletion` is (`AGENT_CANNOT_DELETE` /
 * `PROJECT_ROLE_INSUFFICIENT`) rather than the looser `read.allHands` the browser uses --
 * this is a preview of a PRIVILEGED action, not a general read, and the contract's own `err`
 * list (`ARTIFACT_NOT_FOUND | PROJECT_ROLE_INSUFFICIENT | AGENT_CANNOT_DELETE`) says so: it
 * has no `NO_PROJECT_ROLE`, matching `requestDeletion`'s shape exactly, not `browse-
 * artifacts.ts`'s.
 */
import { files as C } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import { authorize, type AuthorizeDeps } from "../identity/authorize";
import { discloseDecided, isDisclosed } from "../security/permission-filter";
import type { DeleteImpactRepository } from "./deletion-ports";
import type { LegalHoldGate } from "./deletion-ports";
import { DELETE_ACTION } from "./request-deletion";

export type PreviewDeleteImpactResult = z.infer<typeof C.operations.previewDeleteImpact.out>;

export type PreviewDeleteImpactReasonCode =
  | "ARTIFACT_NOT_FOUND"
  | "PROJECT_ROLE_INSUFFICIENT"
  | "AGENT_CANNOT_DELETE";

export class PreviewDeleteImpactError extends Error {
  constructor(readonly reasonCode: PreviewDeleteImpactReasonCode) {
    super("preview_delete_impact_failed");
  }
}

export interface PreviewDeleteImpactDeps extends AuthorizeDeps {
  readonly impact: DeleteImpactRepository;
  readonly legalHold: LegalHoldGate;
}

export interface PreviewDeleteImpactInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly artifactId: string;
  /** D-39: agent-initiated preview is refused the same as agent-initiated deletion. */
  readonly actorKind: "user" | "agent";
}

export async function previewDeleteImpact(
  deps: PreviewDeleteImpactDeps,
  input: PreviewDeleteImpactInput,
): Promise<PreviewDeleteImpactResult> {
  // Unconditional, resource-independent bar -- checked before any lookup, same reasoning as
  // `requestDeletion`'s header: it discloses nothing about whether the artifact exists.
  if (input.actorKind === "agent") throw new PreviewDeleteImpactError("AGENT_CANNOT_DELETE");

  const membership = await deps.repo.findOrgMembership(input.userId, input.orgId);
  const found = await deps.impact.findDeletable({
    orgId: input.orgId,
    artifactId: input.artifactId,
    requesterTeamId: membership?.teamId ?? null,
  });
  if (!found) throw new PreviewDeleteImpactError("ARTIFACT_NOT_FOUND");

  const decision = await authorize(deps, {
    userId: input.userId,
    orgId: input.orgId,
    projectId: found.projectId ?? undefined,
    object: { kind: "artifact", id: found.artifactId },
    action: DELETE_ACTION,
  });
  if (!decision.allowed) throw new PreviewDeleteImpactError("PROJECT_ROLE_INSUFFICIENT");
  if (!isDisclosed(discloseDecided(found.artifact, decision))) {
    throw new PreviewDeleteImpactError("PROJECT_ROLE_INSUFFICIENT");
  }

  const [counts, legalHold] = await Promise.all([
    deps.impact.countsFor(input.orgId, found.artifactId),
    deps.legalHold.isActive(input.orgId, found.artifactId),
  ]);

  return {
    versionCount: counts.versionCount,
    derivedCount: counts.derivedCount,
    segmentCount: counts.segmentCount,
    referencingClaims: counts.referencingClaims.map((c) => ({ kind: "claim", id: c.id, label: c.label })),
    referencingReportSections: counts.referencingReportSections.map((r) => ({
      kind: "report-section",
      id: r.id,
      label: r.label,
    })),
    legalHold,
    exportedOutOfOrg: counts.exportedOutOfOrg.map((e) => ({ ...e })),
  };
}
