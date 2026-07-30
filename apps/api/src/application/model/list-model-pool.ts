/**
 * The organization's model pool, as configured (F48, cashing F15 acceptance V1).
 *
 * ## The whole content of this file is the branch it does NOT have
 *
 * There is no `if (rows.length === 0) return DEFAULT_MODELS`. uc-20-1 R6 and uc-0-5 R12 V1
 * both say the same thing from different ends: the prototype's eighteen models are one
 * organization's configuration, and an organization with none must SEE none.
 *
 * F15 already removed built-in capability lists and proved it with a static gate. This
 * function exists so the model half has a runtime counterpart -- V1's own wording is that
 * verifying configuration can be READ, without verifying there is no built-in fallback,
 * means the second customer discovers the list was hardcoded all along. A static scan
 * cannot see a fallback that lives on a branch; a two-way test can.
 */
import type { ModelPoolRepository, StoredModel } from "./ports";

/**
 * Every model this organization configured, in repository order.
 *
 * Returns the repository's rows unchanged. `credentialConfigured` travels with each row and
 * the credential itself does not -- `StoredModel` has no field for it.
 */
export async function listModelPool(
  orgId: string,
  repository: ModelPoolRepository,
): Promise<readonly StoredModel[]> {
  return repository.listForOrg(orgId);
}

/**
 * Does the console render the empty state rather than a list?
 *
 * A named predicate rather than `rows.length === 0` at the call site, because "empty pool"
 * is a product state with a required rendering (uc-0-5 R12 V1: an empty state, not a blank
 * table and not a seeded one), and a state with a required rendering should be nameable in
 * a test.
 */
export function isEmptyPool(rows: readonly StoredModel[]): boolean {
  return rows.length === 0;
}
