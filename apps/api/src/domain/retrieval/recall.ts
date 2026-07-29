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
 * ## Two questions, and only one of them is answerable today
 *
 * **(a) Did the permission filter lose anything it should not have?** Answerable now, with no
 * threshold at all: take the documents the requester IS entitled to, run the query with and
 * without the permission predicate, and assert the filtered arm lost none of them.
 * `entitledRecallLoss` is that, and it is exactly the sentence in F10's acceptance --
 * "不出现『有权访问却召不回』".
 *
 * **(b) Is the channel's absolute recall good enough to ship?** NOT answerable. That needs a
 * baseline, the baseline is `THRESHOLDS.vectorRecallBaseline`, and it is registered
 * `{ known: false }` because the product has not given it.
 *
 * `judgeRecall` therefore THROWS rather than returning a verdict. That is the registered rule
 * made executable -- "低于基线即判失败，**不得静默放行**" -- and the throw is the only
 * implementation of it that is honest: there is no baseline, so there is no pass. A default
 * would have manufactured one, and this project has already had an incident of precisely that
 * shape (an invented `sampleSize=18` and a "口径表 v3" that produced the appearance of a
 * measured, passing result).
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
 * ⚠ ALWAYS THROWS today, and that is the correct behaviour, not a stub. See the header:
 * `vectorRecallBaseline` is undecided, the rule says a recall below it FAILS and must not be
 * let through silently, and the only way to honour both is to refuse to return a verdict.
 * `requireValue` produces the message naming who owes the number and what it blocks.
 *
 * Callers must not catch this and continue. A test may assert that it throws -- that assertion
 * IS the rule.
 */
export function judgeRecall(measured: number): { pass: boolean; baseline: number } {
  const baseline = TH.requireValue<number>(
    TH.THRESHOLDS.vectorRecallBaseline as never,
    "vectorRecallBaseline",
  );
  return { pass: measured >= baseline, baseline };
}
