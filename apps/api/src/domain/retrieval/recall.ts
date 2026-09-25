/**
 * Recall measurement for the permission-filtered pgvector channel (V12, registered threshold
 * N-2).
 *
 * ## The failure this is aimed at
 *
 * R9 spells it out: an approximate vector index recalls top-k FIRST and the permission /
 * tenant / project predicate filters SECOND. If most of the top-k is filtered away, what comes
 * back is short -- and the user is told "there is no such material" about a document they are
 * entitled to read. No error is raised, no log line is written, and the symptom is a person
 * saying "the AI didn't see the file I uploaded". R9 calls this a silent failure and says it is
 * more dangerous than an error, which is right.
 *
 * ## Two questions
 *
 * **(a) Did the permission filter lose anything it should not have?** Answerable with no
 * threshold at all: take the documents the requester IS entitled to, run the query with and
 * without the permission predicate, and assert the filtered arm lost none of them.
 * `entitledRecallLoss` is that, and it is exactly the sentence in F10's acceptance --
 * "不出现『有权访问却召不回』".
 *
 * **(b) Is the channel's absolute recall good enough to ship?** Judged against
 * `THRESHOLDS.vectorRecallBaseline`. It was registered `{ known: false }` until phase-18 S0-4
 * gave the number (2026-09-24); until then `judgeRecall` threw rather than return a verdict,
 * because a default would have manufactured a pass (this project has had exactly that incident:
 * an invented `sampleSize=18` and a "口径表 v3"). The number still lives ONLY in the registry;
 * `requireValue` is still the only way to read it, so un-resolving it restores the throw.
 * The gate that measures against it is `tests/retrieval/kg-hnsw-permission-recall.test.ts`
 * (F05: recall through the HNSW index, after RLS and the scope predicate).
 */
import { thresholds as TH } from "@repo/contracts";

/**
 * |retrieved ∩ relevant| / |relevant|.
 *
 * Returns `null`, not 1, for an empty relevant set. Recall over nothing is undefined, and
 * returning 1 is how an empty ground-truth fixture reports a perfect score -- the exact way a
 * recall suite passes while measuring nothing.
 */
export function recall(retrieved: Iterable<string>, relevant: Iterable<string>): number | null {
  const rel = new Set(relevant);
  if (rel.size === 0) return null;
  const got = new Set(retrieved);
  let hit = 0;
  for (const id of rel) if (got.has(id)) hit++;
  return hit / rel.size;
}

export interface RecallComparison {
  /** Recall when the permission predicate is NOT applied, over the entitled ground truth. */
  readonly unfiltered: number | null;
  /** Recall of the same query WITH the permission predicate, over the same ground truth. */
  readonly filtered: number | null;
  /**
   * Entitled documents the unfiltered arm found and the filtered arm did not.
   *
   * MUST be empty. Every id in here is a "有权访问却召不回" -- a document the requester may
   * read, that the retrieval reached, and that the permission filter removed anyway.
   */
  readonly lostWhileEntitled: readonly string[];
}

/**
 * Compare the two arms.
 *
 * `entitled` is the ground truth: the documents this requester is allowed to see AND that
 * answer the query. It is supplied by the caller because deriving it from the same query the
 * system under test runs would make the measurement circular.
 */
export function compareRecall(input: {
  readonly entitled: readonly string[];
  readonly unfilteredHits: readonly string[];
  readonly filteredHits: readonly string[];
}): RecallComparison {
  const entitled = new Set(input.entitled);
  const filtered = new Set(input.filteredHits);
  return {
    unfiltered: recall(input.unfilteredHits, entitled),
    filtered: recall(input.filteredHits, entitled),
    lostWhileEntitled: input.unfilteredHits.filter((id) => entitled.has(id) && !filtered.has(id)),
  };
}

/**
 * The half that needs no product decision: the permission filter must not cost an entitled
 * document.
 *
 * Separate from `judgeRecall` on purpose. Collapsing them would make the whole acceptance
 * unjudgeable for want of one number, when in fact the sentence F10 is accepted on is this one.
 */
export class EntitledRecallLossError extends Error {
  constructor(readonly lost: readonly string[]) {
    super(
      `permission-filtered retrieval lost ${lost.length} document(s) the requester is entitled ` +
        `to read: ${lost.join(", ")}. This is the silent failure R9/V12 names -- the user is ` +
        `told the material does not exist rather than that it was withheld.`,
    );
  }
}

export function assertNoEntitledRecallLoss(c: RecallComparison): void {
  if (c.lostWhileEntitled.length > 0) throw new EntitledRecallLossError(c.lostWhileEntitled);
}

/**
 * Judge measured recall against the shipping baseline.
 *
 * The baseline is read through `requireValue`, so if the registry entry is ever set back to
 * `{ known: false }` this throws again (naming who owes the number) instead of passing. A
 * measurement that is not a finite number in [0, 1] -- e.g. recall over an empty ground truth,
 * which `recall()` reports as `null` -- is refused rather than compared: `NaN >= 0.9` is false
 * today, but "no measurement" must never be one refactor away from "passed".
 */
export function judgeRecall(measured: number): { pass: boolean; baseline: number } {
  if (!Number.isFinite(measured) || measured < 0 || measured > 1) {
    throw new RangeError(`recall measurement must be a number in [0, 1], got ${String(measured)}`);
  }
  const baseline = TH.requireValue<number>(
    TH.THRESHOLDS.vectorRecallBaseline as never,
    "vectorRecallBaseline",
  );
  return { pass: measured >= baseline, baseline };
}
