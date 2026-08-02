/**
 * F42 / uc-22-3 R7 「架构第五节」: "交集生成内容取所有来源权限的最严格结果，避免摘要造成越权
 * 信息洗白" -- R12 V7 is the same rule stated for the conversation case ("其
 * `messages.jsonl` 至少与该材料同级敏感"); this is the general form for any `generated`
 * artifact assembled from more than one source.
 *
 * ## Why this cannot be "whatever the generator says"
 *
 * A summarizer/report-writer produces ONE new artifact out of several source materials. If
 * that artifact's `confidential` flag is whatever the generation call happens to pass, a
 * generator that (correctly or by a bug) marks its OWN output non-confidential launders every
 * confidential source it read into a document anyone can read -- the exact "摘要造成越权信息
 * 洗白" this rule exists to block. The fix is not "trust the generator less" in the abstract;
 * it is a single, mechanical rule: the effective visibility of a generated artifact is the
 * strictest of (what the caller asked for) and (every source it was built from), and nothing
 * downstream can loosen that.
 *
 * ## Same shape as `identity.strictestScope`, deliberately
 *
 * `domain/identity/permission-decision.ts`'s `strictestScope` already states I-7 (scope
 * intersection, not union) for the org/project two-layer model. `confidential` here is a
 * different axis (a per-artifact flag, not a scope), but the same "no single source may
 * loosen the whole" argument applies, and OR is to a boolean flag what `strictestScope` is to
 * a scope enum: the moment ANY source is confidential, the assembled result is confidential --
 * there is no partial-credit reading where a summary of nine public documents and one
 * confidential one comes out non-confidential because it is "mostly public".
 */

/** The per-source fact this rule needs. */
export interface SourceVisibility {
  readonly confidential: boolean;
}

/**
 * The strictest (most restrictive) `confidential` reading across a generated artifact's own
 * requested visibility and every source it draws from. `true` wins over `false` unconditionally
 * -- this is OR, not majority vote, not "the first source", not "the primary source".
 */
export function strictestConfidential(
  requested: boolean,
  sources: readonly SourceVisibility[],
): boolean {
  return requested || sources.some((s) => s.confidential);
}
