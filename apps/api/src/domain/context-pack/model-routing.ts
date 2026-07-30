/**
 * V9 / I-10 -- which models a round may use once its Context Pack contains confidential
 * material.
 *
 * ## This file makes NO judgement of its own, twice over
 *
 * "Must this round stay local" is `identity`'s (`resolveModelConstraintRule`, coherence
 * B-3 / X-5). "Is this endpoint on this machine" is the contract's (`isLocalModelEndpoint`,
 * reached through `domain/identity/local-org.isLocalEndpoint`, F16). Both are imported. What
 * is here is the one thing neither of them says: given a verdict and a list of configured
 * models, WHICH ROWS SURVIVE.
 *
 * The reason to keep it that way is not tidiness. F16's report records that the local-org
 * judgement had been written out three times before it was collapsed, and that this
 * particular fact is the one whose drift means data leaves a machine. A second predicate
 * here -- `endpoint.startsWith("http://localhost")`, say -- would pass every test in this
 * file and admit `http://localhost.attacker.example`.
 *
 * ## Why this FILTERS while F16's `projectListingForOrg` GREYS OUT
 *
 * They answer different questions and the contract asks for different things.
 *
 *   F15/F16, `listCapabilities`: "what does this organization have?" -- a cloud model is
 *   returned with `enabled: false` and a reason, because hiding it reads as "this product
 *   has no cloud models" (uc-0-5 R8).
 *
 *   F13, V9: "模型选择接口**只返回**自托管模型" -- this is the picker for ONE round that is
 *   already confined. A greyed-out row here is a control a user can try to click while
 *   holding confidential material, and the answer to "why can I not use this" belongs to the
 *   constraint's `reason`, which travels with the verdict rather than with each row.
 *
 * Stated because the two look like the same function and the difference is a product ruling,
 * not an implementation preference.
 */
import { isLocalEndpoint } from "../identity/local-org";
import type { ContextItem } from "./context-item";

/** The two fields the rule reads. A predicate given more than it reads can pass for the wrong reason. */
export interface SelectableModel {
  readonly id: string;
  readonly endpoint: string | null;
}

/**
 * The models this round may choose from.
 *
 * ⚠ A model with a NULL endpoint is refused under the constraint. "We do not know where it
 * runs" is not evidence that it runs here, and the unknown case of a guard must be the closed
 * one -- the same rule the egress guard's argument parser follows after its own near miss.
 */
export function selectableModels<T extends SelectableModel>(
  models: readonly T[],
  constraint: { readonly localOnly: boolean },
): readonly T[] {
  if (!constraint.localOnly) return [...models];
  return models.filter((m) => isLocalEndpoint(m.endpoint));
}

/**
 * The `dataScope` `identity.resolveModelConstraint` expects, built from what the pack shows.
 *
 * I-10 is stated over `items[]`, not over the candidate set: a confidential candidate that
 * was DISCARDED never reached a model, and confining a round because of something it did not
 * see would make the constraint fire on packs whose confidential material was dropped for
 * budget -- unexplainable to the person looking at the pack.
 *
 * `confidentialSegmentIds` is passed in rather than read off the item, because `ContextItem`
 * has no confidentiality field at all (`KNOWN_CONTRACT_GAPS.G7`).
 */
export function packDataScope(
  items: readonly ContextItem[],
  confidentialSegmentIds: ReadonlySet<string>,
): readonly { readonly itemId: string; readonly confidential: boolean }[] {
  return items.map((i) => ({
    itemId: i.segmentId,
    confidential: confidentialSegmentIds.has(i.segmentId),
  }));
}

/** How many of this pack's items are confidential -- the contract's `confidentialItemCount`. */
export function confidentialItemCount(
  items: readonly ContextItem[],
  confidentialSegmentIds: ReadonlySet<string>,
): number {
  return packDataScope(items, confidentialSegmentIds).filter((d) => d.confidential).length;
}
