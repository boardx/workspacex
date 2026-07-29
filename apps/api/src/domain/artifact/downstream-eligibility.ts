/**
 * Who may be cited downstream, as a rule rather than as a comment on an endpoint (F07).
 *
 * Pure: no clock, no I/O, no storage. A total function of the citation target and the
 * bindings that name it, which is what makes the refusal exhaustively testable rather than
 * sampled through HTTP.
 *
 * ## The question this file answers, and the one it refuses to answer
 *
 * R6 / AC1: 只有固定快照可被决策引用、进验收、进报告正式版、写回图谱与组织大脑.
 * `usecases.md` gives the operation `referenceForDownstream` an `in` of `{ versionId,
 * purpose, referencedBy }` and an `err` containing `REQUIRES_PINNED`.
 *
 * Those two cannot both be read literally. An `artifact_versions` row IS an immutable
 * snapshot -- `domain.md` says so in as many words ("「固定快照」= 一条 ArtifactVersion
 * 记录") -- so if the input names a version, every input is already a snapshot, the refusal
 * has no reachable case, and the feature whose entire value is a refusal can never refuse.
 * A gate that cannot fail is worse than an absent one, because it reads as coverage. This
 * project has recorded that shape nine times.
 *
 * So eligibility is taken to be a property of the BINDING, which is what "实时关联/草稿模式
 * 产出" in F07's acceptance actually describes:
 *
 *   pinned  frozen to one version. What the citer saw is what a later reader gets (I-8).
 *   live    resolves to the head AT READ TIME. The source moving is the whole point of the
 *           mode, so a citation of it promises nothing.
 *   draft   not on the project side at all (I-12). Nothing has been backflowed to cite.
 *
 *   citable(version) ⟺ ∃ binding b : b.mode = "pinned" ∧ b.pinnedVersionId = version
 *
 * ⚠ The divergence from the literal contract is REPORTED, not chosen quietly -- see the F07
 * report and the note added to `referenceForDownstream` in `packages/contracts`.
 *
 * ## Why an unbound version is refused too
 *
 * An artifact may exist with versions and no binding at all (A1: Studio 可独立发起). Under
 * the rule above it is not citable, and that is deliberate rather than an oversight of the
 * predicate: the five purposes are all project-side acts (报告正式版 / 验收 / 决策依据 /
 * 图谱写回 / 大脑晋升), and a product that was never backflowed to a step has no project
 * that committed to it. The remedy is one bind away and the refusal names the artifact so
 * the interface can offer it (E1).
 */
import { artifact as A } from "@repo/contracts";
import type { z } from "zod";
import type { BindingModeName } from "./binding-modes";

export type DownstreamPurposeName = z.infer<typeof A.DownstreamPurpose>;

/**
 * The five purposes, from the contract, in the contract's order.
 *
 * `z.infer`red rather than restated: R6 names five downstream acts and a sixth arriving in
 * `packages/contracts` must not be able to appear here as a silently missing case. The
 * migration's CHECK constraint is asserted equal to this list member for member, so the
 * database and the contract cannot drift apart either.
 */
export const DOWNSTREAM_PURPOSES: readonly DownstreamPurposeName[] = A.DownstreamPurpose.options;

/**
 * One binding that names the version a caller wants to cite.
 *
 * Deliberately not the whole `Binding`: the rule reads exactly two fields, and a predicate
 * given more than it reads is a predicate whose tests can pass for the wrong reason.
 */
export interface CitationAnchor {
  readonly mode: BindingModeName;
  readonly pinnedVersionId: string | null;
}

/** Why a citation was refused. `null` in `EligibilityVerdict` means it was not. */
export type IneligibleReason =
  /** No binding pins this exact version: it is live, draft, or not backflowed at all. */
  | "NOT_PINNED";

export interface EligibilityVerdict {
  readonly eligible: boolean;
  readonly reason: IneligibleReason | null;
}

/**
 * May this version be cited, given every binding in the tenant that names its artifact?
 *
 * The anchors are passed in whole rather than pre-filtered by the caller. A4 permits one
 * artifact to be bound to several steps at several versions -- live at one, pinned at
 * another, pinned at a third to an older version -- so "is THIS version pinned somewhere"
 * is a question about the set, and a repository that filtered first would be making the
 * judgement in SQL where the only way to assert it is to assert the query.
 */
export function judgeCitation(
  versionId: string,
  anchors: readonly CitationAnchor[],
): EligibilityVerdict {
  const pinned = anchors.some((a) => a.mode === "pinned" && a.pinnedVersionId === versionId);
  return pinned ? { eligible: true, reason: null } : { eligible: false, reason: "NOT_PINNED" };
}
