/**
 * `referenceForDownstream` -- the downstream citation gate (F07, uc-0-1 R6 / AC1 / R12 V1).
 *
 * ## What this use case is for
 *
 * R11 makes the point that this gate is the value core of uc-0-1 and must be its own feature
 * with its own acceptance, not a clause inside the binding service. The reason is visible in
 * the five purposes: 报告正式版 / 验收 / 决策依据 / 图谱写回 / 大脑晋升 are five different
 * bundles, each with its own tests, and if each decides for itself whether something is "a
 * snapshot", AC1 is bypassed by whichever one gets it wrong -- with everything green.
 *
 * So there is one function, and underneath it one table with one trigger (0010). The trigger
 * is not a duplicate of the check below: this layer exists to name the ARTIFACT in the
 * refusal (E1's 一键定版 needs an id the caller did not supply), the trigger exists so a
 * consumer that never calls this function is still refused.
 *
 * ## What "pinned" means here
 *
 * Not "the version row exists" -- every `artifact_versions` row is immutable by
 * construction, so that reading makes `REQUIRES_PINNED` unreachable and the gate vacuous.
 * The judgement is `judgeCitation` in the domain, and the divergence from the literal
 * contract text is reported there and in `packages/contracts`.
 *
 * ## Permission
 *
 * ⚠ `referenceForDownstream` declares `pre: —` and an `err` with no `NO_PROJECT_ROLE` and no
 * `PROJECT_ROLE_INSUFFICIENT` -- for an operation that WRITES a row. So no role check is
 * made here, because inventing one would invent a rule the signed contract does not have and
 * an error code it cannot name (the F06 precedent: implement, map to null, report). What
 * does hold is tenant isolation: every query runs under RLS in the caller's organization, so
 * a version in another tenant is indistinguishable from one that does not exist. Reported as
 * a contract gap, and asserted as a gap in `reference-eligibility-gate.test.ts` so that
 * adding the codes turns the assertion red.
 */
import { judgeCitation, type DownstreamPurposeName } from "../../domain/artifact/downstream-eligibility";
import type { OrgId } from "../../domain/org-id";
import type { BindingRepository } from "./binding-ports";
import type { ArtifactRepository, IdFactory } from "./ports";
import type { DownstreamReferenceRepository } from "./reference-ports";
import { ArtifactNotFoundError, RequiresPinnedError } from "./binding-errors";

export interface ReferenceDeps {
  readonly references: DownstreamReferenceRepository;
  readonly bindings: BindingRepository;
  readonly artifacts: ArtifactRepository;
  readonly ids: IdFactory;
}

export interface ReferenceForDownstreamInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly versionId: string;
  readonly purpose: DownstreamPurposeName;
  readonly referencedBy: { readonly kind: string; readonly id: string };
}

export interface ReferenceForDownstreamOut {
  readonly referenceId: string;
  readonly eligible: boolean;
}

export async function referenceForDownstream(
  deps: ReferenceDeps,
  input: ReferenceForDownstreamInput,
): Promise<ReferenceForDownstreamOut> {
  const { references, bindings, artifacts, ids } = deps;
  const { userId, orgId, versionId, purpose, referencedBy } = input;

  // RLS scopes this to the caller's tenant, so "belongs to somebody else" and "does not
  // exist" produce the same answer -- the rule V4 states for drafts, applied here for the
  // same reason: a distinguishable refusal makes the endpoint an oracle for ids.
  const version = await artifacts.findVersion(orgId, versionId);
  if (version === null) {
    throw new ArtifactNotFoundError(`version ${versionId} not found`);
  }

  const anchors = await bindings.findAnchorsForArtifact(orgId, version.artifactId);
  const verdict = judgeCitation(versionId, anchors);
  if (!verdict.eligible) {
    throw new RequiresPinnedError(
      version.artifactId,
      `version ${versionId} is not pinned to any step (${verdict.reason}); it cannot be cited for ${purpose}`,
    );
  }

  const { id } = await references.insertOrFind({
    id: ids.next("dref"),
    orgId,
    versionId,
    purpose,
    referencedBy,
    createdBy: userId,
  });

  // `eligible` is `true` on every path that reaches here, and that is not this function
  // hard-coding a success flag -- the contract's own `out` in `usecases.md` is written
  // `{ referenceId, eligible: true }` while `REQUIRES_PINNED` sits in `err`, so the field
  // is a constant by construction. Reported: a boolean that cannot be false invites a
  // client to "check eligibility" and get a gate that never says no.
  return { referenceId: id, eligible: true };
}
