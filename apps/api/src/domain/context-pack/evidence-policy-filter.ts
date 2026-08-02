/**
 * F42 — server-side enforcement of `QueryContext.evidencePolicy` (uc-22-3 R7 / R12 V5, D-25).
 *
 * ## The gap this closes
 *
 * `evidencePolicy` has been on the `QueryContext` schema since F09/F10 (`context-pack.ts`),
 * accepted by every test fixture in `tests/kernel/*` — and used by nothing. Nowhere in
 * `retrieve-candidates.ts` or `build-items.ts` does the value change what comes back. A
 * `generated` (`synthesized: true`) segment ranks and appears in `items[]` identically under
 * `"primary-only"` and `"all"`. R7's own words are "生成内容不得在下一次检索中伪装成一手证据 …
 * 必须服务端强制，不只是视觉标记" — a field the pipeline never reads is exactly a visual
 * marker with nothing behind it.
 *
 * ## Placement: front-filter, same position as O-05's consent prefilter
 *
 * After disclosure (the judgement it applies to has to be real) and before fusion (so an
 * excluded segment can never be ranked, reranked, budgeted, or become an item —
 * `consent-prefilter.ts`'s header explains why "front-filter, not exit mask" means exactly
 * this position; the same argument applies verbatim here).
 *
 * ## Why exclusion becomes `out-of-scope`, not `unauthorized`
 *
 * `unauthorized` (`OMISSION_REASONS`) means "the two-layer permission intersection denied
 * it" (UC-0.3) — that is a statement about WHO is asking. Evidence-policy exclusion is a
 * statement about WHAT KIND of evidence this query accepts, independent of who is asking: the
 * same requester, same segment, gets a different answer only because `task`/`evidencePolicy`
 * changed. `out-of-scope`'s own explain text — "不在本次检索的范围内 … 或本轮限定的材料集之
 * 外" — is the seven-reason enum's existing member for exactly that shape, and reusing it
 * costs nothing (D-U4's closed enum forbids inventing an eighth without an ADR; this one
 * already fits).
 *
 * ## Why `synthesized` is derived, not a new field
 *
 * `ContextItem`/`CandidateRow` have no `synthesized` column, and none is added here.
 * `artifacts_ai_is_synthesized` (migration 0006) is a DB-level invariant: `source =
 * 'ai-generated' ⇒ synthesized = true`, and every non-generated row has `synthesized = false`
 * by construction (`materializeArtifact`/`materializeSource` never set it any other way — see
 * `input.source === "ai-generated"` / `input.sourceType === "generated"` at their call sites).
 * So `sourceType === "ai-generated"` (already on `CandidateRow.sourceType` and on
 * `ContextItem.sourceType`) *is* the `synthesized` tag; a second boolean carrying the same
 * fact would be the same drift `AGENTS.md` names five prior incidents of ("同一事实不得声明
 * 在两处"). `isSynthesizedSource` below is the one place that equivalence is spelled out, so
 * a caller never re-derives it ad hoc.
 */

/** The half of a candidate this filter needs. */
export interface EvidenceGatedCandidate {
  readonly segmentId: string;
  readonly sourceType: string;
}

export interface EvidencePolicyOutcome<T extends EvidenceGatedCandidate> {
  /** May proceed to fusion / rerank / budget / items[]. */
  readonly eligible: readonly T[];
  /** Excluded here, at the front door — never fused, never ranked, never budgeted. */
  readonly excluded: readonly T[];
}

/**
 * A `sourceType === "ai-generated"` candidate IS a synthesized one (DB invariant, see header).
 * Exported so nothing downstream reinvents this check against a fact that already exists.
 */
export function isSynthesizedSource(sourceType: string): boolean {
  return sourceType === "ai-generated";
}

/**
 * `evidencePolicy === "primary-only"` excludes every synthesized candidate. `"reviewed"` and
 * `"all"` both admit it — R7/V5 draw the line at `"primary-only"` vs `"all"` specifically
 * (「以 evidencePolicy: primary-only 检索时不含任何 generated segment、以 all 检索时含
 * 它」); `"reviewed"` is not given a different rule anywhere in the spec, so it is not
 * invented one here.
 */
export function evidencePolicyExcludesSynthesized(policy: string): boolean {
  return policy === "primary-only";
}

/**
 * Split candidates into what this query's evidence policy admits and what it does not.
 *
 * Mirrors `applyConsentPrefilter`'s shape deliberately (same fast path for "nothing to
 * exclude", same "front door" placement) — two independent front-filters that happen to look
 * alike because front-filtering is the only placement that is actually correct for either one.
 */
export function applyEvidencePolicyFilter<T extends EvidenceGatedCandidate>(
  candidates: readonly T[],
  policy: string,
): EvidencePolicyOutcome<T> {
  if (!evidencePolicyExcludesSynthesized(policy)) {
    // Counter-proof-shaped fast path: under "reviewed"/"all", EVERY candidate — including a
    // synthesized one — must survive untouched. A version that excluded on `isSynthesizedSource`
    // regardless of policy would pass a "primary-only excludes it" test and fail this one
    // silently.
    return { eligible: candidates, excluded: [] };
  }

  const eligible: T[] = [];
  const excluded: T[] = [];
  for (const c of candidates) {
    if (isSynthesizedSource(c.sourceType)) excluded.push(c);
    else eligible.push(c);
  }
  return { eligible, excluded };
}
