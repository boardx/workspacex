/**
 * Compliance attributes: a CONTROLLED vocabulary whose values live in configuration
 * (F48 / O-38, invariant I-8).
 *
 * ## Why the value domain is not in this file, and not in the contract either
 *
 * O-38: the vocabulary is `部署区域清单 ∩ 目标客户法域清单`. Both are external inputs that
 * do not exist yet, so the ruling was "controlled enum, values read from configuration,
 * vocabulary currently EMPTY -- and that does not block coding" (`domain.md` 三③).
 *
 * The trap that ruling avoids is specific: an empty enum is uncomfortable, so the natural
 * move is to seed a plausible `["境内", "境外"]` to have something to render. That literal
 * would then be the tenth "same fact in two places" on this project, and the one that
 * decides which models may touch a jurisdiction's data. `no-hardcoded-model-list.test.ts`
 * scans this file for a value-domain literal for that reason.
 *
 * ## The empty vocabulary is not a wildcard
 *
 * With no configured values, the only valid submission is the empty list. `[]` is accepted
 * (a model may carry no compliance attributes) and any non-empty submission is
 * `COMPLIANCE_ATTR_UNKNOWN`. The alternative reading -- "nothing configured, so allow
 * anything" -- turns the day before configuration into a window where arbitrary strings
 * enter the column that a later routing rule will trust.
 */

/** The contract's error code for a value outside the organization's vocabulary. */
export const COMPLIANCE_ATTR_UNKNOWN = "COMPLIANCE_ATTR_UNKNOWN";

export type ComplianceAttrCheck =
  | { readonly ok: true; readonly attrs: readonly string[] }
  | { readonly ok: false; readonly code: typeof COMPLIANCE_ATTR_UNKNOWN; readonly unknown: readonly string[] };

/**
 * Check a submission against the organization's configured vocabulary.
 *
 * `vocabulary` is a parameter, never a module constant -- that is the whole of I-8. The
 * function has no idea what a compliance attribute is called, and cannot acquire one
 * without a caller passing it.
 *
 * Reports EVERY unknown value, not the first. An admin fixing them one round-trip at a time
 * is how a five-value paste becomes five rejections.
 */
export function checkComplianceAttrs(
  submitted: readonly string[],
  vocabulary: readonly string[],
): ComplianceAttrCheck {
  const allowed = new Set(vocabulary);
  const unknown = submitted.filter((v) => !allowed.has(v));
  if (unknown.length > 0) return { ok: false, code: COMPLIANCE_ATTR_UNKNOWN, unknown };
  // De-duplicated, order preserved: two identical attributes are one promise, and a
  // duplicate would make the composite intersection depend on how many times it was typed.
  return { ok: true, attrs: [...new Set(submitted)] };
}
