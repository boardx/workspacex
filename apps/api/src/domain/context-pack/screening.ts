/**
 * Screening: the four ways a candidate stops being an item, each with a reason (F11).
 *
 * `AssembleContextPack` step ⑦ is one sentence -- "按 tokenBudget 压缩，超限按相关度截断，被截断
 * 项进 omissions[]" -- and it is the step where evidence disappears. Everything here exists so
 * that a candidate that does not make it into `items[]` leaves a row behind saying why, in a word
 * from the closed enum (I-2 / I-3 / D-U4).
 *
 * ## The relevance figure is NOT the fused score, and that is enforced by the type
 *
 * `rrf.ts` says it plainly: the fused score is not a probability, not a similarity, and
 * `1/(60+1)` is already 0.016 -- feeding it into a 0.45 cut-off discards essentially everything.
 * The two numbers look interchangeable, which is exactly why passing one where the other belongs
 * must not be a thing a caller can do by accident.
 *
 * So `Relevance` is branded: the only way to make one is `relevanceOf(value, provenance)`, which
 * demands, in writing, where the number came from. A caller who wants to threshold the RRF score
 * anyway has to type `relevanceOf(f.score, "...")` and name it -- the mistake becomes a sentence
 * somebody reads in review rather than an implicit unit error nothing can see.
 *
 * ⚠ **phase-00 has no source for this number** (registered as `KNOWN_CONTRACT_GAPS.G6` in
 * `packages/contracts/src/context-pack.ts`): the reranker port returns an ORDER, not scores, and
 * there is no model gateway. That is why the threshold rule is implemented and asserted here
 * while the number itself must be supplied by the caller. Inventing a normalisation of the RRF
 * score would produce a plausible-looking 0.38 that means nothing, and it would be screenshotted.
 */
import { omissionReason as OR } from "@repo/contracts";
import { thresholds as TH } from "@repo/contracts";
import type { QueryTaskName } from "@repo/contracts/context-pack";
import type { Omission } from "./pack-structure";

declare const RELEVANCE_BRAND: unique symbol;

/** A relevance figure on the threshold's own scale ([0,1]), with its provenance attached. */
export interface Relevance {
  readonly [RELEVANCE_BRAND]: true;
  readonly value: number;
  /** Where the number came from. Non-empty, and it travels with the value. */
  readonly provenance: string;
}

/**
 * Build a relevance figure.
 *
 * Range-checked because the threshold is stated on [0,1] (O-36's 0.45), and a number from a
 * different scale silently changes what "below the threshold" means for every candidate at once.
 */
export function relevanceOf(value: number, provenance: string): Relevance {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(
      `relevance must be a finite number in [0,1] (the scale O-36's threshold is stated on), got ${value} ` +
        `-- if this is an RRF fused score it is NOT on that scale (domain/retrieval/rrf.ts)`,
    );
  }
  if (provenance.trim() === "") {
    throw new Error("a relevance figure without a provenance cannot be audited -- name where it came from");
  }
  return { value, provenance } as Relevance;
}

/** A candidate as screening sees it. Retrieval facts are F10's; this is what step ⑦ needs. */
export interface ScreenableCandidate {
  readonly segmentId: string;
  readonly relevance: Relevance;
  /** What it would cost to put this in the Pack. */
  readonly tokens: number;
  /**
   * Content fingerprint for dedup. Supplied rather than computed here so the domain does not
   * grow an opinion about hashing, and so two segments deduped for a reason other than exact
   * text (near-duplicate, same source) can still be expressed.
   */
  readonly fingerprint: string;
  /** A4 manual items: exempt from the threshold, and a budget overflow is an ERROR not a discard. */
  readonly manual?: boolean;
}

export interface ScreenStep {
  readonly kept: readonly ScreenableCandidate[];
  readonly omissions: readonly Omission[];
}

/**
 * One place builds an `Omission`, and it reads `compliance`/`explain` off the single source.
 *
 * Writing either by hand at a call site is how a compliance discard ends up with
 * `compliance: false` and gets folded away behind "showing the first 5" (I-3 / I-4).
 */
export function omissionFor(ref: string, reason: OR.OmissionReason, detail?: string): Omission {
  return {
    ref,
    reason,
    compliance: OR.isComplianceOmission(reason),
    explain: detail === undefined ? OR.omissionExplain(reason) : `${OR.omissionExplain(reason)}（${detail}）`,
  };
}

/**
 * ADR-021: a candidate that cannot be anchored is EXPLAINED rather than silently dropped.
 *
 * Before the eighth reason existed, `buildContextItems` had to hand these back separately and
 * they ended up in neither `items[]` nor `omissions[]` -- the exact state I-2 exists to abolish
 * (see the F09 report and `context-pack-items-from-disclosure.test.ts`).
 *
 * ⚠ ADR-021 also asks that this NOT become a routine path: a high `unlocatable` count means the
 * anchor model has a hole, so `screenOutcome.unlocatableCount` is returned for observability
 * rather than left as a bare enum value nobody counts.
 */
export function unlocatableOmission(segmentId: string): Omission {
  return omissionFor(segmentId, "unlocatable");
}

/**
 * Step ⑦a -- drop what is below the task's relevance threshold (O-36).
 *
 * The threshold comes from `THRESHOLDS.contextPackRelevance` via `relevanceThresholdFor`, never
 * from a literal here: the prototype's 0.45 was quoted in four separate places before F11, and
 * the first per-task override would have made three of them lie.
 *
 * Manual items are exempt (A4: "人工指定项不受相关度阈值裁剪").
 */
export function applyRelevanceThreshold(
  candidates: readonly ScreenableCandidate[],
  task: QueryTaskName,
): ScreenStep & { readonly thresholdUsed: number } {
  const thresholdUsed = TH.relevanceThresholdFor(task);
  const kept: ScreenableCandidate[] = [];
  const omissions: Omission[] = [];
  for (const c of candidates) {
    if (c.manual === true || c.relevance.value >= thresholdUsed) {
      kept.push(c);
      continue;
    }
    omissions.push(
      omissionFor(c.segmentId, "low-confidence", `相关度 ${c.relevance.value} < 本次阈值 ${thresholdUsed}`),
    );
  }
  return { kept, omissions, thresholdUsed };
}

/**
 * Step ⑦b -- collapse duplicates, keeping the first occurrence in the ranked order.
 *
 * First rather than "best source": source reliability is not modelled in phase-00, and picking
 * by a field that does not exist would be a fiction. The ranked order is the one real ordering
 * available, so the survivor is the higher-ranked one, and the omission says so.
 */
export function dedupeCandidates(candidates: readonly ScreenableCandidate[]): ScreenStep {
  const seen = new Map<string, string>();
  const kept: ScreenableCandidate[] = [];
  const omissions: Omission[] = [];
  for (const c of candidates) {
    const winner = seen.get(c.fingerprint);
    if (winner === undefined) {
      seen.set(c.fingerprint, c.segmentId);
      kept.push(c);
      continue;
    }
    omissions.push(omissionFor(c.segmentId, "deduped", `与已纳入的 ${winner} 内容重复`));
  }
  return { kept, omissions };
}

export interface BudgetTrim extends ScreenStep {
  readonly tokensUsed: number;
  /** Manual items that did not fit => the caller raises BUDGET_EXCEEDS_MANUAL (E2). */
  readonly manualOverflow: readonly ScreenableCandidate[];
}

/**
 * Step ⑦c -- fit the pack into `tokenBudget`, cutting the least relevant first.
 *
 * ⚠ Every dropped candidate gets its own omission, not one "the budget was exceeded" note. The
 * question a reader asks is "why is THIS not here", and it is only answerable per document
 * (`domain/retrieval/channel-budget.ts` makes the same argument for the per-channel quotas; this
 * function is the total-budget half that runs on the fused list, after them).
 *
 * Manual items are placed FIRST and never dropped: E2 says a budget that cannot hold the pinned
 * items is an error the user resolves, not something the assembler decides quietly. Returning
 * them as `budget` omissions would be the silent version.
 */
export function trimToBudget(
  candidates: readonly ScreenableCandidate[],
  tokenBudget: number,
): BudgetTrim {
  if (!Number.isInteger(tokenBudget) || tokenBudget <= 0) {
    throw new Error(`token budget must be a positive integer, got ${tokenBudget}`);
  }
  const manual = candidates.filter((c) => c.manual === true);
  const rest = candidates.filter((c) => c.manual !== true);

  let used = 0;
  const kept: ScreenableCandidate[] = [];
  const manualOverflow: ScreenableCandidate[] = [];
  for (const c of manual) {
    if (used + c.tokens <= tokenBudget) {
      used += c.tokens;
      kept.push(c);
    } else {
      manualOverflow.push(c);
    }
  }

  // Highest relevance first: "超限按相关度截断" (O-36) is an ordering statement, and the ranked
  // input order is not necessarily the relevance order once manual items have been hoisted.
  const byRelevance = [...rest].sort(
    (a, b) => b.relevance.value - a.relevance.value || (a.segmentId < b.segmentId ? -1 : 1),
  );
  const omissions: Omission[] = [];
  for (const c of byRelevance) {
    if (used + c.tokens <= tokenBudget) {
      used += c.tokens;
      kept.push(c);
      continue;
    }
    omissions.push(
      omissionFor(c.segmentId, "budget", `本次预算 ${tokenBudget} tokens，已用 ${used}，该条需 ${c.tokens}`),
    );
  }

  // Restore the caller's order so the Pack's items[] stay in ranked order (I-5 replay stability).
  const keptIds = new Set(kept.map((c) => c.segmentId));
  return {
    kept: candidates.filter((c) => keptIds.has(c.segmentId)),
    omissions,
    tokensUsed: used,
    manualOverflow,
  };
}

export interface ScreenOutcome {
  readonly kept: readonly ScreenableCandidate[];
  readonly omissions: readonly Omission[];
  readonly thresholdUsed: number;
  readonly tokensUsed: number;
  readonly manualOverflow: readonly ScreenableCandidate[];
  /** ADR-021 asks for this to be watched, not just enumerated. */
  readonly unlocatableCount: number;
}

/**
 * The whole of step ⑦, in a fixed order: threshold → dedup → budget.
 *
 * The order is not cosmetic. Dedup before the threshold would let a below-threshold duplicate
 * survive as the representative of an above-threshold one; budget before the threshold would
 * spend the budget on candidates that were never eligible, and the resulting `budget` omissions
 * would blame the budget for a relevance decision.
 */
export function screenCandidates(input: {
  readonly candidates: readonly ScreenableCandidate[];
  readonly task: QueryTaskName;
  readonly tokenBudget: number;
  /** Segments that could not be anchored (I-1) -- explained as `unlocatable` (ADR-021). */
  readonly unanchorable?: readonly string[];
}): ScreenOutcome {
  const threshold = applyRelevanceThreshold(input.candidates, input.task);
  const deduped = dedupeCandidates(threshold.kept);
  const budget = trimToBudget(deduped.kept, input.tokenBudget);
  const unanchorable = input.unanchorable ?? [];

  return {
    kept: budget.kept,
    omissions: [
      ...threshold.omissions,
      ...deduped.omissions,
      ...budget.omissions,
      ...unanchorable.map(unlocatableOmission),
    ],
    thresholdUsed: threshold.thresholdUsed,
    tokensUsed: budget.tokensUsed,
    manualOverflow: budget.manualOverflow,
    unlocatableCount: unanchorable.length,
  };
}
