/**
 * `markEvidenceWithdrawn` -- E5: the evidence a fixed snapshot rests on has been withdrawn.
 *
 * ## The one thing this must NOT do
 *
 * Touch the snapshot. I-1/I-11 say a version is immutable, and the tempting implementation
 * -- flip a `withdrawn` flag on `artifact_versions` -- breaks that in the exact way the
 * whole feature exists to prevent: the bytes a decision cited would no longer be the bytes
 * that decision reader sees. The database refuses the UPDATE anyway (0006), so the design
 * and the enforcement agree, and the test asserts the version's `contentHash` is byte-equal
 * before and after.
 *
 * So the withdrawal is recorded NEXT to the snapshot, in three places that already exist:
 *
 *   1. an append-only `evidence-withdrawn` event, targeting the VERSION -- so a reference
 *      site's question ("was this snapshot withdrawn?") is one `queryProvenance` call;
 *   2. the reference sites themselves, which are the `pinned` bindings citing that version;
 *   3. a review notice per approver, so somebody is actually told.
 *
 * ## ⚠ Nothing here changes a signed decision, deliberately
 *
 * usecases.md: 「不自动改已签字决策」. The output is an annotation and a notification, and
 * the human decides. A use case that retracted conclusions automatically would be making
 * the judgement E5 explicitly reserves for a person.
 *
 * ## ⚠ Contract gaps found while writing this, none of them invented around
 *
 *   * `markEvidenceWithdrawn.err` is `ARTIFACT_NOT_FOUND | DEPENDENCY_UNAVAILABLE` and its
 *     `pre:` is empty -- the contract as signed gives this operation NO authorization at
 *     all, so any member could annotate any citation and mail the project leads. The one
 *     refusal the contract CAN express is not-found, so that is what a non-member gets;
 *     anything finer would need a code the contract does not have. Reported.
 *   * 「在引用处标注」 has no rendering surface: `BackflowEntry` has no field for it, so a
 *     project-side list cannot show 「证据已撤回」 today. The fact is queryable; the badge is
 *     not expressible. Reported rather than added -- a field on a signed contract is an
 *     amendment.
 *   * `notifiedApprovers` is best defined as "whoever created the citations", because
 *     phase-00 has no decision entity and therefore no 拍板人. Stated in `ReferenceSite`.
 */
import type { OrgId } from "../../domain/org-id";
import type { IdentityRepository } from "../identity/ports";
import type { ProvenanceWriter, ReviewNotifier } from "../provenance/ports";
import type { BindingRepository } from "./binding-ports";
import { ArtifactNotFoundError } from "./binding-errors";
import type { ArtifactRepository } from "./ports";

export interface WithdrawEvidenceDeps {
  readonly artifacts: ArtifactRepository;
  readonly bindings: BindingRepository;
  readonly identity: IdentityRepository;
  readonly provenance: ProvenanceWriter;
  readonly notifier: ReviewNotifier;
}

export interface WithdrawEvidenceInput {
  readonly orgId: OrgId;
  readonly actorId: string;
  readonly versionId: string;
  readonly reason: string;
}

export interface WithdrawEvidenceResult {
  readonly annotatedReferences: readonly string[];
  readonly notifiedApprovers: readonly string[];
  readonly provenanceEventId: string;
}

export async function withdrawEvidence(
  deps: WithdrawEvidenceDeps,
  input: WithdrawEvidenceInput,
): Promise<WithdrawEvidenceResult> {
  const { artifacts, bindings, identity, provenance, notifier } = deps;
  const { orgId, actorId, versionId, reason } = input;

  // Membership first, and reported as not-found. A stranger must not be able to tell a real
  // version id from an invented one by comparing two refusals -- the rule `decideContentRead`
  // and `bindToProjectStep` already follow.
  if ((await identity.findOrgMembership(actorId, orgId)) === null) {
    throw new ArtifactNotFoundError(`version ${versionId} not found`);
  }

  const version = await artifacts.findVersion(orgId, versionId);
  if (version === null) throw new ArtifactNotFoundError(`version ${versionId} not found`);

  const sites = await bindings.listPinnedBindingsForVersion(orgId, versionId);

  const provenanceEventId = await provenance.append({
    orgId,
    type: "evidence-withdrawn",
    actorId,
    target: { kind: "artifact-version", id: versionId },
    // `artifactId` is denormalised here on purpose and it is the one copy in this feature.
    // `queryProvenance` filters on a single (kind, id) pair with no join, so without it
    // there is no query that finds "everything about this artifact" -- the version's events
    // would be unreachable from the artifact. Reported as a gap in the shared query surface;
    // the alternative was to target the artifact and lose the by-version lookup, which is
    // the lookup a reference site actually performs.
    detail: { reason, artifactId: version.artifactId },
  });

  // The version's pinner is included alongside the citing authors: they are the person who
  // asserted "these are the bytes", and a withdrawal is news to them whether or not they
  // cited it anywhere. Sorted so the response is stable to compare.
  const approvers = [...new Set([...sites.map((s) => s.createdBy), version.pinnedBy])].sort();
  const notified = await notifier.notify(orgId, provenanceEventId, approvers);

  return {
    annotatedReferences: sites.map((s) => s.bindingId),
    // What is on record, not what was intended. If the notice did not persist, the response
    // does not claim the person was told.
    notifiedApprovers: notified,
    provenanceEventId,
  };
}
