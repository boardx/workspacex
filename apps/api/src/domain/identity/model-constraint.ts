/**
 * `ResolveModelConstraint` -- the ONE place that decides whether a round of model calls must
 * stay local, and WHY (uc-0-5 R7 / R10 rulings of 2026-07-28, R12 V12; domain I-10;
 * coherence B-3 / X-5).
 *
 * Pure. No I/O, no clock. The organization's facts come in as arguments so that this rule
 * can be exercised over every combination without a database.
 *
 * ## Why `source` matters as much as `localOnly`
 *
 * Two organizations can both answer "yes, local only" for reasons that are not the same kind
 * of thing:
 *
 *   promise -- a personal-local organization. Derived from `kind`. No interface can turn it
 *              off, because it is what the user was promised, not what an admin chose.
 *   policy  -- a real organization with `modelPolicy = "self-hosted-only"`. An admin set it,
 *              an admin can unset it, and the change is recorded.
 *
 * The ruling that added the policy says the difference must not be flattened: "expressing a
 * promise with the same switch demotes it to a default". So the two never share a field --
 * `modelPolicy` is not read at all for a personal-local organization, and migration 0008
 * makes the database refuse to store one there so the confusion has nowhere to live.
 *
 * ## D-U1: any confidential item makes the WHOLE round local
 *
 * Not "the confidential parts go local and the cloud handles the rest". Splitting would make
 * privacy depend on the accuracy of per-fragment confidentiality classification, which is a
 * classification problem nobody gets right every time, and one miss is an irreversible leak.
 *
 * ⚠ CONTRACT GAP, reported rather than papered over: `ConstraintSource` has three values and
 * this rule needs a fourth. A regular organization processing confidential data is under an
 * unclosable PRODUCT rule -- so it is a `promise` by category -- but not the personal-local
 * promise the enum's comment describes. `none` would be worse: it is documented as "no
 * restriction" and would flatly contradict `localOnly: true`. So this returns `promise` and
 * puts the discriminator in `reason`, which is prose. A UI that needs to tell the two apart
 * today has to parse prose; the fix is a fourth enum value, and it belongs to whoever owns
 * the contract.
 */
import { identity } from "@repo/contracts";
import type { z } from "zod";
import { isLocalOrg } from "./local-org";

/** All three DERIVED from the contract, never restated -- same reasoning as `roles.ts`. */
export type OrgKind = z.infer<typeof identity.OrgKind>;
export type ModelPolicy = z.infer<typeof identity.ModelPolicy>;
export type ConstraintSource = z.infer<typeof identity.ConstraintSource>;

export interface ModelConstraintInput {
  readonly orgKind: OrgKind;
  /**
   * Optional on purpose: for a personal-local organization there IS no policy to read, and
   * accepting `undefined` means a caller cannot accidentally supply one and have it matter.
   */
  readonly modelPolicy?: ModelPolicy;
  readonly dataScope: readonly { readonly itemId: string; readonly confidential: boolean }[];
}

export interface ModelConstraint {
  readonly localOnly: boolean;
  readonly source: ConstraintSource;
  readonly reason: string;
}

export function resolveModelConstraintRule(input: ModelConstraintInput): ModelConstraint {
  // Checked FIRST, and `modelPolicy` is never consulted on this branch. That ordering is the
  // invariant, not a style choice: if the policy were read first, a local organization whose
  // policy column said "any" would answer "no restriction", and the promise would have been
  // switched off by a field the domain says local organizations do not have.
  // ⚠ `isLocalOrg`, not `=== "personal-local"` (F16). The literal used to appear here, in
  // `resolve-model-constraint.ts` and in the web shell -- three copies of the judgement that
  // decides whether data may leave the machine. The other five drifts this project has had
  // cost a wrong number on a screen; this one would cost the promise.
  if (isLocalOrg(input.orgKind)) {
    return {
      localOnly: true,
      source: "promise",
      reason:
        "personal-local organization: model calls stay on local or self-hosted endpoints. " +
        "This is a product promise derived from the organization's kind and cannot be turned off.",
    };
  }

  // Before the policy check, because D-U1 cannot be switched off and a policy can. Reporting
  // the changeable source while an unchangeable one also applies would tell an admin they can
  // lift a restriction that would still be there afterwards.
  if (input.dataScope.some((d) => d.confidential)) {
    return {
      localOnly: true,
      source: "promise",
      reason:
        "confidential data in scope (D-U1): the entire round runs locally, cloud models are " +
        "unavailable for all calls in it -- not only the confidential ones.",
    };
  }

  if (input.modelPolicy === "self-hosted-only") {
    return {
      localOnly: true,
      source: "policy",
      reason:
        "organization policy modelPolicy=self-hosted-only: an administrator configured this " +
        "organization to use self-hosted models only. It is changeable by an administrator " +
        "and the change is recorded.",
    };
  }

  return { localOnly: false, source: "none", reason: "no model constraint applies." };
}
