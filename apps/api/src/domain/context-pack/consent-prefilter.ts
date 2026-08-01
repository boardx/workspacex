/**
 * O-05 — the per-speaker Context Pack front-filter (F93, uc-6-5 R4/A2, uc-6-3 同意位).
 *
 * ## The property, and why it has to sit here and not at the edge
 *
 * A2's exact words: a subject who declined "交给 AI 分析" still appears in the product — their
 * words can be quoted verbatim by a human — but their segments must never become AI input,
 * "包括本用例的归纳链路与 UC-6.4 的 AI 副驾驶". The implementation location the decision names is
 * "Context Pack 构建阶段的 per-speaker 前置过滤，不是出口遮盖": the exclusion has to happen
 * before a segment can become a candidate the fusion/rerank/budget steps could ever rank into
 * `items[]`, not as a check bolted onto the response after assembly finished. A filter placed
 * after assembly would still let the segment be fused, reranked and counted toward the token
 * budget — a `blockReason`/redaction added at the door of a room the content already sat in.
 *
 * This is a pure decision, deliberately: it takes the set of subjects who are OFF (declined),
 * not a database, so that "does this segment enter the AI-facing set" is answerable without a
 * connection, and so `retrieve-candidates.ts` (which does have a connection) is the only place
 * that has to say where the declined-subject set comes from.
 *
 * ## Why exclusion, not a lower relevance score
 *
 * `screening.ts`'s threshold cut is a relevance judgement — a candidate that is real material
 * just did not rank high enough this time, and a different query could rank it back in. This is
 * not that: a declined subject's segment is not "less relevant", it is categorically forbidden
 * as AI input regardless of how well it matches the query. Folding it into the relevance score
 * would make it re-appear the moment a query happened to match it strongly enough to clear the
 * threshold, which is exactly the silent failure O-05 exists to prevent.
 *
 * ## Why `speakerSubjectId: null` always passes
 *
 * Most segments (files, surveys, workshop notes, or an interview segment whose speaker has not
 * been resolved yet) are not attributable to any consent-gated subject at all. Treating `null`
 * as "exclude to be safe" would silently starve the Context Pack of everything that is not an
 * attributed interview segment, which is a much bigger and unrelated failure than the one this
 * filter is responsible for. `null` means "this filter has no opinion", not "unknown, so no".
 */

/** The half of a candidate this filter needs — anything with a segment id and a speaker. */
export interface ConsentGatedCandidate {
  readonly segmentId: string;
  readonly speakerSubjectId: string | null;
}

export interface ConsentPrefilterOutcome<T extends ConsentGatedCandidate> {
  /** May enter the AI-facing candidate set (fusion, rerank, budget, items[]). */
  readonly eligible: readonly T[];
  /**
   * Excluded here, at the front door. Still exists for a human to quote verbatim elsewhere —
   * this function does not delete anything, it only decides what may cross into an AI input.
   */
  readonly excluded: readonly T[];
  /**
   * Deduplicated, sorted subject ids actually excluded THIS run — the trace A2 asks for
   * ("记录本次归纳排除了哪些受访者") without naming which segments or what they said, which
   * would be the content leak `omissions[]` is built to avoid elsewhere in this bundle.
   */
  readonly excludedSubjectIds: readonly string[];
}

/**
 * Split candidates into what may feed AI generation and what may not, per O-05.
 *
 * `declinedSpeakerSubjectIds` is the caller's fact, not this function's: it names the subjects
 * whose CURRENT `ai_analysis` bit is false (`domain/interview/subject.ts`'s
 * `deriveConsentStatus(...) === "ai_analysis_declined"`). Nothing here reads a database or a
 * point-in-time snapshot, which is also what makes the promise in the F93 issue's
 * `user_visible_behavior` true for free: flip the bit to "是" and re-run with the now-smaller
 * declined set, and the same segment that was excluded a moment ago is `eligible` this time —
 * there is no separate "unlock" code path to keep in sync with the filter, because it is the
 * same function reading a different input.
 */
export function applyConsentPrefilter<T extends ConsentGatedCandidate>(
  candidates: readonly T[],
  declinedSpeakerSubjectIds: ReadonlySet<string>,
): ConsentPrefilterOutcome<T> {
  if (declinedSpeakerSubjectIds.size === 0) {
    // Counter-proof-shaped fast path, not an optimisation: with nothing declined, EVERY
    // candidate — including one that happens to carry a `speakerSubjectId` — must survive
    // untouched. A version of this function that excluded on `speakerSubjectId !== null` alone
    // would pass every "the declined subject is gone" test and fail this one silently.
    return { eligible: candidates, excluded: [], excludedSubjectIds: [] };
  }

  const eligible: T[] = [];
  const excluded: T[] = [];
  const excludedSubjectIds = new Set<string>();

  for (const c of candidates) {
    if (c.speakerSubjectId !== null && declinedSpeakerSubjectIds.has(c.speakerSubjectId)) {
      excluded.push(c);
      excludedSubjectIds.add(c.speakerSubjectId);
    } else {
      eligible.push(c);
    }
  }

  return { eligible, excluded, excludedSubjectIds: [...excludedSubjectIds].sort() };
}
