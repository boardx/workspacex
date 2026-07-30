/**
 * Composite models (F48 / O-22③, invariants I-3 I-4 I-5).
 *
 * O-22③: a composite -- `whisper ＋ sonnet` -- is ONE row in the pool with ONE `model_id`
 * and an ordered member pipeline. It is not two fields on the agent. The reason is I-3:
 * every consumer's model reference is a single `ModelId`, so a two-model capability that
 * lived on the agent would need the agent side to hold two, and then "which model ran this"
 * has two answers in the audit trail (UC-4.4) and the confidential routing check has two
 * verdicts to reconcile at call time.
 *
 * The contract already encodes this and `combo-model-single-record.test.ts` asserts it:
 * `registerModel.in` carries `members[]` and `registerModel.out` returns exactly one
 * `modelId`; there is no `registerCompositeModel`, and no consumer takes an array.
 */
import type { ModelKind, ModelStatus } from "./registry";

/**
 * What the composite rules read off each member. Narrower than the pool row on purpose:
 * a predicate handed more than it reads can pass for the wrong reason.
 */
export interface CompositeMemberState {
  readonly modelId: string;
  readonly role: string;
  readonly kind: ModelKind;
  readonly status: ModelStatus;
  /** From the organization's controlled vocabulary (O-38); the code knows no values. */
  readonly complianceAttrs: readonly string[];
}

/**
 * The kind the whole chain counts as (I-4).
 *
 * ⚠ ANY closed-api member makes the chain closed-api. Stated as "any", not "all", because
 * the failure mode is one-directional: a chain wrongly called self-hosted routes
 * confidential material out of the building, while a chain wrongly called closed-api merely
 * refuses work. `whisper(self-hosted) → sonnet(closed-api)` transcribes locally and then
 * hands the transcript to a vendor -- the material has left either way, so the local first
 * hop buys nothing and must not launder the chain's kind.
 *
 * ⚠ An EMPTY member list is `closed-api`, not `self-hosted`. "We do not know what runs" is
 * not evidence that it runs here -- the same closed-unknown rule `selectableModels` follows
 * for a null endpoint.
 */
export function effectiveKind(members: readonly CompositeMemberState[]): ModelKind {
  return members.some((m) => m.kind === "closed-api") || members.length === 0
    ? "closed-api"
    : "self-hosted";
}

/**
 * The chain's compliance attributes: the INTERSECTION of its members' (O-22③, "取最严").
 *
 * Intersection and not union, because an attribute is a promise the chain keeps. A union
 * would let a chain claim a residency guarantee that only its first hop honours, which is
 * precisely the claim the second hop breaks.
 *
 * ⚠ Empty member list ⇒ empty set, again the closed-unknown reading: a chain with no
 * members promises nothing. (An intersection over zero sets is conventionally the universe;
 * that convention is wrong for a guarantee, so it is not used.)
 *
 * Order of the result follows the first member, so the value is stable for a snapshot test
 * and for a database round-trip.
 */
export function effectiveComplianceAttrs(
  members: readonly CompositeMemberState[],
): readonly string[] {
  const first = members[0];
  if (first === undefined) return [];
  return first.complianceAttrs.filter((attr) =>
    members.every((m) => m.complianceAttrs.includes(attr)),
  );
}

/** Why a composite is not usable right now. `null` = it is. */
export type CompositeBlock = { readonly reason: "COMPOSITE_MEMBER_DISABLED"; readonly memberIds: readonly string[] };

/**
 * Is the chain usable, and if not, which members broke it (I-5)?
 *
 * A member that is anything other than `已启用` blocks the whole chain. There is no
 * fallback to the surviving member: `domain.md` I-5 says the composite must disappear from
 * `listSelectableModels` and must NOT "降级为单模型静默运行". Silently running the
 * transcription half of `whisper ＋ sonnet` would return something that looks like an
 * answer and is not one.
 *
 * Returns the offending ids because "this composite is unavailable" is not actionable --
 * the admin has to be told which member to re-enable.
 */
export function compositeBlock(members: readonly CompositeMemberState[]): CompositeBlock | null {
  const broken = members.filter((m) => m.status !== "已启用").map((m) => m.modelId);
  return broken.length === 0 ? null : { reason: "COMPOSITE_MEMBER_DISABLED", memberIds: broken };
}

/**
 * Can this record be selected for a confidential round?
 *
 * ⚠ This is a PROJECTION of `effectiveKind`, not a second confidentiality judgement. The
 * routing decision itself belongs to `routeModelCall` (the bundle's single execution point,
 * I-10 / I-15) and to `identity`'s `resolveModelConstraint`; what this answers is only the
 * per-record half -- "does this row's kind survive a local-only constraint" -- which is
 * exactly what a composite needs and a single model gets from its own `kind`.
 *
 * ⚠ Under D-U1 the confidential-routing wording is still contradictory across the
 * repository (`domain.md` 三①, `design-signoff.md` X-3). This function takes no position on
 * it: it answers only "is this chain closed-api", which is agreed in all three versions.
 */
export function survivesLocalOnly(members: readonly CompositeMemberState[]): boolean {
  return effectiveKind(members) === "self-hosted";
}
