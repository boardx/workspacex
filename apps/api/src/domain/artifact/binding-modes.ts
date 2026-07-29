/**
 * The three binding modes, as rules rather than as three strings that happen to differ.
 *
 * Pure: no clock, no I/O, no storage. Everything here is a total function of the mode and
 * the two sides of a transition, which is what makes the transition table exhaustively
 * testable rather than sampled.
 *
 * ## The one fact the modes encode
 *
 * `draft` / `live` / `pinned` are not three labels on one behaviour. Each answers "what
 * does the project side see, and does it move when the source moves":
 *
 *   draft   nothing. The row exists and belongs to its author; the project side does not
 *           list it, for anybody, administrators included (I-12).
 *   live    the head. The source moving IS the point -- the badge says 实时 · 随源变动.
 *   pinned  one frozen version. The source moving must not reach it (I-8), which is the
 *           half of I-8 F05 left to F06.
 *
 * ## Why the rank is here and not in SQL alone
 *
 * Migration 0008 enforces the same monotonicity in a trigger, and that is not duplication of
 * a FACT -- it is the same rule at two enforcement points, which the domain doc asks for
 * (an endpoint-level rule holds until the second endpoint; a database-level rule cannot tell
 * the caller which of the three refusals applied). What is NOT restated is the mode
 * vocabulary itself: it is `z.infer`red from the contract, so adding a fourth mode there
 * makes `MODE_RANK` a compile error instead of a silently missing case.
 */
import { artifact as A } from "@repo/contracts";
import type { z } from "zod";

export type BindingModeName = z.infer<typeof A.BindingMode>;

/**
 * How much a mode commits to. Higher may replace lower; never the reverse (A3 / I-11).
 *
 * `Record<BindingModeName, number>` and not a lookup with a default: a default would make a
 * mode nobody thought about rank 0, i.e. downgradable from everything, which is the most
 * permissive answer to a question whose whole purpose is to refuse.
 */
export const MODE_RANK: Readonly<Record<BindingModeName, number>> = {
  draft: 0,
  live: 1,
  pinned: 2,
};

/** Does this mode freeze to a specific `artifact_version`? The IFF in 0008's CHECK. */
export function requiresPinnedVersion(mode: BindingModeName): boolean {
  return mode === "pinned";
}

/**
 * Does the project side list a binding in this mode? (I-12 / `listBackflow`.)
 *
 * A predicate rather than a `WHERE mode <> 'draft'` in the repository, so that the rule is
 * asserted where it is decided. A SQL-side filter is equally correct and completely
 * untestable apart from its query: "no drafts came back" and "no rows came back" are the
 * same observation, and this project has nine recorded instances of that shape passing while
 * testing nothing.
 */
export function isProjectSideVisible(mode: BindingModeName): boolean {
  return mode !== "draft";
}

/**
 * The badge the project side renders (R8: 草稿 / 实时 · 随源变动 / 已定版 vN).
 *
 * ⚠ `BackflowEntry` in the contract declares `mode: BindingMode` AND
 * `badge: z.enum(["draft","live","pinned"])` -- the same fact, twice, inside the file that
 * exists to be the single source of it. They are returned equal here rather than computed
 * separately, so the two can never disagree, and the duplication is reported rather than
 * quietly honoured. A response builder that derived the badge from anything else would be
 * the seventh instance of this project's recurring defect.
 */
export function badgeFor(mode: BindingModeName): BindingModeName {
  return mode;
}

/**
 * What a transition is, from the point of view of the rule that permits or refuses it.
 *
 * `repoint` is separated from `same` because it is the case a rank comparison cannot see: a
 * pinned binding moved to a different version has an unchanged mode and an unchanged rank,
 * and it destroys exactly the guarantee pinning exists to give. An implementation that only
 * compares ranks refuses every downgrade, passes every test written about downgrades, and
 * allows this.
 */
export type TransitionKind = "upgrade" | "downgrade" | "same" | "repoint";

export interface TransitionInput {
  readonly from: BindingModeName;
  readonly to: BindingModeName;
  /** The version the existing binding is frozen at; null for draft/live. */
  readonly fromVersionId: string | null;
  /** The version the transition wants to freeze at; null for draft/live. */
  readonly toVersionId: string | null;
}

export function classifyTransition(input: TransitionInput): TransitionKind {
  const { from, to, fromVersionId, toVersionId } = input;
  if (MODE_RANK[to] > MODE_RANK[from]) return "upgrade";
  if (MODE_RANK[to] < MODE_RANK[from]) return "downgrade";
  if (from === "pinned" && fromVersionId !== toVersionId) return "repoint";
  return "same";
}

/**
 * Is this transition allowed?
 *
 * Only `upgrade` is. `same` is refused rather than treated as idempotent success: a caller
 * re-binding an already-pinned artifact at the same version is either confused or racing,
 * and answering "fine" to both makes the two indistinguishable in the audit trail -- which
 * is the record A3 exists to protect. The refusal is cheap to recover from; a silent success
 * is not recoverable at all.
 */
export function isAllowedTransition(input: TransitionInput): boolean {
  return classifyTransition(input) === "upgrade";
}
