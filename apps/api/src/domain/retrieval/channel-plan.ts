/**
 * The "query-planned" half of query-planned hybrid retrieval (UC-0.2 R3 step ②).
 *
 * ## What "query-planned" is actually claiming
 *
 * `context-engine.md` overturned graph-first with a specific complaint: a fixed pipeline
 * systematically misses a whole class of query. Graph-first misses freshly uploaded material
 * that has not been entity-linked yet -- the workshop recording from an hour ago, which is the
 * single most likely thing somebody is looking for. The fix is not "add more channels and
 * always run all of them"; it is *decide per query*.
 *
 * So a plan that always returns the same five weights is not a plan, and it would pass any
 * test that merely checks a `retrievalPlan` array came back. The property worth asserting is
 * that two DIFFERENT queries produce different plans, and the tests assert that in both
 * directions (a plan that varied randomly would also pass a "they differ" check, so the
 * specific shape of each difference is asserted too).
 *
 * ## The one channel that is never planned away
 *
 * `fts` is a first-class channel (R3, V11): graph and vector are both bad at exact matching,
 * and without FTS "what did the client actually say, word for word" has no answer. Dropping it
 * for a query that looks paraphrase-y would be the exact regression V11 exists to catch, so it
 * is structurally impossible here -- `planChannels` always includes it, and a test asserts that
 * over a corpus of query shapes rather than over one example.
 *
 * ## Weights are ordering hints, not permissions
 *
 * A channel's weight scales its contribution to the fused rank (`rrf.ts`). It never decides
 * whether a document may be returned -- that is the permission filter's job and it happens in
 * SQL, before any of this. Keeping the two ideas apart in the code is deliberate: a weight of
 * zero must read as "this channel had nothing useful to add", never as "this was filtered".
 */
import { contextPack as CP } from "@repo/contracts";
import type { z } from "zod";

export type RetrievalChannel = z.infer<typeof CP.RetrievalChannel>;
export type QueryTask = z.infer<typeof CP.QueryTask>;

/** Every channel, straight from the contract. Never a second list. */
export const RETRIEVAL_CHANNELS = CP.RetrievalChannel.options as readonly RetrievalChannel[];

/**
 * The graph channel's contribution is a FIXED bonus (R3 "线索": 图谱路径只给固定加成,
 * 不单独决定结果).
 *
 * It is a constant rather than a planned weight because the moment it becomes tunable, a
 * tuning that makes it large re-creates graph-first -- the thing `context-engine.md`
 * overturned -- and does so through configuration, where no review would catch it.
 */
export const GRAPH_FIXED_BONUS = 0.5;

/**
 * What the planner can tell about a query without reading the corpus.
 *
 * Deliberately shallow. A real intent classifier is a model call, and a model call here would
 * make the plan non-deterministic -- which breaks I-5 (same runId replays to the same items).
 * These are syntactic facts about the string, and they are exactly the ones that distinguish
 * the query shapes R3 names.
 */
export interface QueryFeatures {
  /** `"..."` or `「...」`: the user is asking for words, not meaning. */
  readonly quoted: boolean;
  /** A reference number, code or version (`ISO 27001`, `v2.3`, `#4471`). */
  readonly identifierLike: boolean;
  /** A time expression (`上个月`, `2026-07`, `last quarter`). */
  readonly timeScoped: boolean;
  /** Names a research method or a cohort (`访谈`, `问卷`, `interview`, `survey`). */
  readonly methodOrCohort: boolean;
  /** Asks about a relationship between named things (`谁决定`, `导致`, `who decided`). */
  readonly relational: boolean;
}

const QUOTE = /["'“”「」『』]/;
const IDENTIFIER = /(?:\b[A-Z]{2,}[- ]?\d+|\bv\d+(?:\.\d+)+|#\d+|\b\d{4,}\b)/;
const TIME = /(?:上个?[月周年]|本[月周年]|去年|昨[天日]|\d{4}[-/年]\d{1,2}|last\s+(?:month|week|quarter|year)|\bQ[1-4]\b)/i;
const METHOD_OR_COHORT = /(?:访谈|问卷|工作坊|调研|用户|受访者|interview|survey|workshop|cohort|participants?)/i;
const RELATIONAL = /(?:谁(?:决定|提出|负责)|为什么|导致|依据|来自|who\s+(?:decided|proposed|owns)|because|caused|derived\s+from)/i;

export function analyzeQuery(query: string): QueryFeatures {
  return {
    quoted: QUOTE.test(query),
    identifierLike: IDENTIFIER.test(query),
    timeScoped: TIME.test(query),
    methodOrCohort: METHOD_OR_COHORT.test(query),
    relational: RELATIONAL.test(query),
  };
}

export interface PlannedChannel {
  readonly channel: RetrievalChannel;
  readonly weight: number;
  /** Written for the person reading `retrievalPlan` and asking "why did it search that way". */
  readonly why: string;
}

/**
 * Decide which channels run, and how much each one counts.
 *
 * A channel absent from the result is not run at all -- that is the "not always all five" the
 * feature statement asks for, and it is the difference between planning and decorating. A
 * channel present with weight 0 would be a lie of a different kind (work done, contribution
 * discarded), so it cannot happen: every returned channel has a positive weight.
 */
export function planChannels(task: QueryTask, features: QueryFeatures): readonly PlannedChannel[] {
  const plan: PlannedChannel[] = [];

  // ── fts: always. See the header. ──────────────────────────────────────────────────────
  const ftsWeight = features.quoted || features.identifierLike ? 2 : 1;
  plan.push({
    channel: "fts",
    weight: ftsWeight,
    why:
      ftsWeight > 1
        ? "the query carries a quotation or an identifier -- exact match is what was asked for"
        : "first-class channel: exact wording, numbers and names have no other route (R3/V11)",
  });

  // ── vector: paraphrase. Skipped only when the query is nothing BUT an identifier. ──────
  //
  // "#4471" has no semantic neighbourhood; embedding it returns whatever happens to be near
  // an arbitrary point, which is noise ranked as if it were evidence. That is the one case
  // where running the channel is worse than not running it.
  const identifierOnly = features.identifierLike && !features.quoted && !features.relational;
  if (!identifierOnly) {
    plan.push({
      channel: "vector",
      weight: task === "search" ? 1 : 2,
      why: "semantic neighbourhood -- the '换句话说' half of recall",
    });
  }

  // ── graph: only when the query is about relationships, and only as a fixed bonus. ──────
  if (features.relational || task === "decision-support") {
    plan.push({
      channel: "graph",
      weight: GRAPH_FIXED_BONUS,
      why: "relationship query: paths give a fixed bonus and never decide a result alone (R3 线索)",
    });
  }

  // ── metadata: only when the query actually constrains metadata. ────────────────────────
  if (features.timeScoped || features.methodOrCohort) {
    plan.push({
      channel: "metadata",
      weight: 1,
      why: "the query names a time range, a method or a cohort -- '上个月能源组做的访谈'",
    });
  }

  // ── claim: reviewed conclusions. Not for a raw lookup. ─────────────────────────────────
  if (task !== "search") {
    plan.push({
      channel: "claim",
      weight: task === "decision-support" ? 2 : 1,
      why: "reviewed insights and decisions, injected in pairs when they conflict (R3 成对)",
    });
  }

  return plan;
}

/** Apply the A3 "adjust retrieval weights" override, keeping the plan's shape auditable. */
export function applyWeightOverrides(
  plan: readonly PlannedChannel[],
  overrides: Readonly<Partial<Record<RetrievalChannel, number>>>,
): readonly PlannedChannel[] {
  return plan.map((p) => {
    const o = overrides[p.channel];
    if (o === undefined || o === p.weight) return p;
    return { channel: p.channel, weight: o, why: `${p.why} (weight overridden by the user, A3)` };
  });
}
