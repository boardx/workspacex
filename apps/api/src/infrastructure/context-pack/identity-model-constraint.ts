/**
 * The adapter that makes `context-pack`'s `ModelConstraintPort` be `identity`'s
 * `resolveModelConstraint`, and nothing else.
 *
 * ## Why an adapter and not an import
 *
 * `resolvePackModelConstraint` could simply call the identity use case -- both live in
 * `application`, and the layering gate permits it. It goes through a port instead so that the
 * delegation is STRUCTURAL: the context-pack use case has no rule in reach, only somebody
 * else's answer. The contract's own comment on the operation is written in the imperative
 * (「不得在此处重新实现判定逻辑」), and a rule that depends on nobody feeling like reimplementing
 * it is the shape this repository keeps finding at the bottom of its drifts.
 *
 * ## Why this file contains no logic
 *
 * Everything it could plausibly add -- defaulting `source`, shortcutting when the pack has no
 * confidential item, caching a verdict -- is a way of answering the question a second time.
 * The "no confidential items" shortcut is the tempting one and it is wrong: a personal-local
 * organization is `localOnly: true` with an EMPTY dataScope (the promise comes from `kind`),
 * so the shortcut would hand a local organization's confidential-free pack to a cloud model.
 */
import { resolveModelConstraint } from "../../application/identity/resolve-model-constraint";
import type { IdentityRepository } from "../../application/identity/ports";
import type { ModelConstraintPort } from "../../application/context-pack/ports";
import type { ModelConstraint } from "../../domain/identity/model-constraint";
import type { OrgId } from "../../domain/org-id";

export class IdentityModelConstraint implements ModelConstraintPort {
  constructor(private readonly repo: IdentityRepository) {}

  resolve(input: {
    readonly userId: string;
    readonly orgId: OrgId;
    readonly dataScope: readonly { readonly itemId: string; readonly confidential: boolean }[];
  }): Promise<ModelConstraint> {
    return resolveModelConstraint(this.repo, input);
  }
}
