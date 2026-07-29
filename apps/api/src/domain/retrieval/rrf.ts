/**
 * Reciprocal Rank Fusion -- how five rankings become one (UC-0.2 R3 step ④).
 *
 * ## Why RRF rather than adding up the scores
 *
 * The five channels do not produce comparable numbers. `ts_rank` is an unbounded relevance
 * figure, cosine distance is in [0, 2] and smaller is better, the graph channel emits a
 * constant, and the metadata channel is a boolean dressed as a score. Normalising them onto a
 * common scale requires knowing each channel's distribution, which nobody does; the usual
 * result is that whichever channel happens to produce the largest magnitudes silently wins
 * every fusion, and the system looks like it is using five channels while behaving like one.
 *
 * RRF sidesteps that by throwing the magnitudes away and keeping only the ORDER: a document at
 * rank r in a channel contributes `weight / (K + r)`. Nothing needs to be comparable except
 * position, which always is.
 *
 * ## What the fused score is NOT
 *
 * It is not a probability, not a similarity, and not comparable across two different queries.
 * `ContextItem.score` carries it because the contract requires a relevance number, and the
 * relevance THRESHOLD (0.45 in the prototype, per-task configurable under O-36) is applied by
 * F11 against its own scale -- not against this one. Feeding an RRF score into a 0.45 cut-off
 * would discard nearly everything, since `1/(60+1)` is already 0.016. Named here because the
 * two numbers look interchangeable and are not.
 */

/**
 * The rank-damping constant. 60 is the value from the original RRF paper (Cormack et al.),
 * kept because a different constant changes only how sharply top ranks dominate, and inventing
 * a project-specific one would be a tuning decision with no evidence behind it.
 *
 * ⚠ This is NOT one of the registered pending thresholds. It is a property of the fusion
 * formula, not a product judgement about how much recall is enough -- that one is
 * `THRESHOLDS.vectorRecallBaseline` and it is deliberately unavailable.
 */
export const RRF_K = 60;

export interface ChannelRanking<Id extends string = string> {
  readonly channel: string;
  readonly weight: number;
  /** Best first. Position in this array IS the rank; no rank field to fall out of sync. */
  readonly ids: readonly Id[];
}

export interface FusedResult<Id extends string = string> {
  readonly id: Id;
  readonly score: number;
  /**
   * Which channels reached this document, in the plan's order.
   *
   * This is what `ContextItem.channels` is populated from, and it is the only evidence V11 can
   * be asserted with: "FTS is a first-class channel" is a claim about a specific document
   * having been reached by FTS, which no aggregate number can express.
   */
  readonly channels: readonly string[];
  /** Rank held in each channel that reached it (1-based). Debugging surface for A3 tuning. */
  readonly ranks: Readonly<Record<string, number>>;
}

/**
 * Fuse channel rankings.
 *
 * Ties broken by id, not left to insertion order. Two documents with identical fused scores are
 * ordinary (one channel each, same rank), and if the order between them depended on which
 * channel's promise resolved first, replaying the same runId would produce a different
 * `items[]` -- violating I-5 without changing a single retrieved document. A deterministic
 * tie-break costs nothing and removes the whole class.
 */
export function fuse<Id extends string = string>(
  rankings: readonly ChannelRanking<Id>[],
  k: number = RRF_K,
): readonly FusedResult<Id>[] {
  const acc = new Map<Id, { score: number; channels: string[]; ranks: Record<string, number> }>();

  for (const r of rankings) {
    // Per RANKING, not global: the same id appearing twice in ONE channel is a duplicate row
    // and must contribute once. That is not paranoia -- a JOIN-shaped SQL channel returning a
    // row per anchor is the ordinary way it happens, and the effect is a document that
    // outranks everything because it was listed twice.
    const seenInChannel = new Set<Id>();
    r.ids.forEach((id, i) => {
      if (seenInChannel.has(id)) return;
      seenInChannel.add(id);
      const rank = i + 1;
      const cur = acc.get(id) ?? { score: 0, channels: [], ranks: {} };
      cur.score += r.weight / (k + rank);
      if (!cur.channels.includes(r.channel)) cur.channels.push(r.channel);
      cur.ranks[r.channel] = rank;
      acc.set(id, cur);
    });
  }

  return [...acc.entries()]
    .map(([id, v]) => ({ id, score: v.score, channels: v.channels, ranks: v.ranks }))
    .sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Reorder a fused list with an external judge (cross-encoder / LLM), keeping the fusion honest.
 *
 * Rerank REORDERS. It does not drop, and it cannot introduce a document the fusion did not
 * produce -- both are enforced here rather than trusted, because the reranker is a model call
 * and a model that returns a shorter list is how documents disappear from a Context Pack
 * without a corresponding `omissions[]` entry (I-2). A truncating reranker is a discard
 * decision wearing an ordering decision's clothes.
 *
 * Anything the judge does not mention keeps its fused order, appended after what it did.
 */
export function applyRerank<Id extends string = string>(
  fused: readonly FusedResult<Id>[],
  rerankedIds: readonly Id[],
): readonly FusedResult<Id>[] {
  const byId = new Map(fused.map((f) => [f.id, f]));
  const seen = new Set<Id>();
  const out: FusedResult<Id>[] = [];

  for (const id of rerankedIds) {
    const f = byId.get(id);
    if (f === undefined) {
      throw new Error(
        `rerank returned "${id}", which was not in the fused candidate set -- a reranker may ` +
          `reorder evidence, never introduce it (the Pack would then cite something no channel found)`,
      );
    }
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(f);
  }
  for (const f of fused) if (!seen.has(f.id)) out.push(f);
  return out;
}
