/**
 * Five-way query-planned recall, permission-filtered, RRF-fused, reranked.
 *
 * This is step ①–⑥ of `AssembleContextPack` (`contracts/context-pack/usecases.md`). Budget
 * compression (⑦) and the three-section response (⑧) are F11's and F09's; this module stops at
 * a ranked, disclosed candidate list plus the omissions its own decisions imply.
 *
 * ## Order of operations, and why it is not negotiable
 *
 *   1. tenant + candidate-set construction  in SQL, under RLS
 *   2. plan the channels                     `domain/retrieval/channel-plan`
 *   3. run the planned channels in parallel
 *   4. DISCLOSE each channel's rows          `application/security/permission-filter`
 *   5. fuse the survivors (RRF)              `domain/retrieval/rrf`
 *   6. rerank
 *
 * Step 4 sits before step 5, not after it. Fusing first and filtering afterwards produces the
 * same final set in the easy case and is wrong in the case that matters: a withheld document
 * occupying rank 1 in three channels pushes a visible one out of the top-k, so the requester
 * loses a document they are entitled to *because of* one they are not. That is the same silent
 * under-recall R9 describes, arriving through the front door.
 *
 * ## Two propagation paths, deliberately
 *
 * `PROPAGATION_PATHS` registers both `retrieval` and `embedding-similarity` to F10, and they
 * are separate entries because R7 lists them separately: a document surfaced by vector
 * similarity was not surfaced by anything the user typed, and the point of enumerating the six
 * paths is that each one is a distinct way permission can fail to travel. So the vector
 * channel's disclosure is made on `embedding-similarity` and the other four on `retrieval`
 * (`propagationPathFor`). Routing everything through one path would leave a registered path
 * with no traffic while the coverage claim was made on its behalf.
 *
 * ## What blocks, and what must never degrade
 *
 * A channel failure raises `RetrievalUnavailableError`, which the interface layer maps to the
 * contract's `RETRIEVAL_UNAVAILABLE`. It does NOT return partial results: usecases.md is
 * explicit that a retrieval dependency failure blocks the AI call and "不得降级为「无上下文直接
 * 生成」". A four-of-five result would be exactly that degradation, and it would look like a
 * successful assembly.
 */
import { contextPack as CP, omissionReason as OR } from "@repo/contracts";
import type { z } from "zod";
import { applyConsentPrefilter } from "../../domain/context-pack/consent-prefilter";
import { coerceEvidencePolicy, type EvidencePolicy } from "../../domain/context-pack/coerce-evidence-policy";
import { applyEvidencePolicyFilter } from "../../domain/context-pack/evidence-policy-filter";
import type { Omission } from "../../domain/context-pack/pack-structure";
import type { OrgId } from "../../domain/org-id";
import {
  analyzeQuery,
  applyWeightOverrides,
  planChannels,
  type PlannedChannel,
  type QueryTask,
  type RetrievalChannel,
} from "../../domain/retrieval/channel-plan";
import { applyRerank, fuse, type ChannelRanking } from "../../domain/retrieval/rrf";
import { disclose, type Disclosed, type Withheld } from "../security/permission-filter";
import {
  propagationPathFor,
  type CandidateRow,
  type ChannelQuery,
  type ClaimHit,
  type EmbeddingPort,
  type RerankPort,
  type SegmentRetriever,
} from "./ports";
import type { AuthorizeDeps } from "../identity/authorize";

export type FilterAction = z.infer<typeof CP.FilterAction>;
export type RetrievalChannelPlan = z.infer<typeof CP.RetrievalChannelPlan>;
export type ClaimRef = z.infer<typeof CP.ClaimRef>;

/**
 * A dependency failed. Distinct from "nothing matched", and the distinction is the whole point:
 * an empty result is E1 (a real empty state, reported honestly) and a failure is E3/V6 (block
 * the AI call). Collapsing them is how "the retrieval service was down" becomes "your project
 * has no material".
 */
export class RetrievalUnavailableError extends Error {
  readonly reason: z.infer<typeof CP.ContextPackReason> = "RETRIEVAL_UNAVAILABLE";
  constructor(readonly channel: RetrievalChannel, readonly cause: unknown) {
    super(`retrieval channel "${channel}" failed: ${(cause as Error)?.message ?? String(cause)}`);
  }
}

export interface RankedCandidate {
  readonly row: CandidateRow;
  /** From a decision that was actually made about this requester and this segment (I-11). */
  readonly permissionDecisionId: string;
  readonly channels: readonly RetrievalChannel[];
  readonly score: number;
  readonly retrievalReasons: readonly FilterAction[];
}

export interface RetrievalOutcome {
  /** The contract's auditable projection of the plan: channel, weight, hit count. */
  readonly plan: readonly RetrievalChannelPlan[];
  readonly ranked: readonly RankedCandidate[];
  readonly claims: readonly ClaimRef[];
  /**
   * `unauthorized` for withheld candidates, `withdrawn` for revoked ones.
   *
   * Budget omissions are NOT here -- `applyChannelBudget` produces those, after this, once a
   * budget exists to exceed.
   */
  readonly omissions: readonly Omission[];
  /** For the D-U1 local-model decision, which belongs to identity (X-5) and is not made here. */
  readonly confidentialCount: number;
  /**
   * F93/O-05: subject ids actually excluded THIS run by the per-speaker consent prefilter —
   * the category-only trace A2 asks for, without naming segments or content. Empty when
   * `declinedSpeakerSubjectIds` was empty or matched nothing.
   */
  readonly consentExcludedSubjectIds: readonly string[];
  /**
   * F42: the policy actually enforced THIS run, after server-side coercion -- never the raw
   * caller value. Exposed so a caller (or a test) can confirm what was applied without
   * re-deriving it, the same way `consentExcludedSubjectIds` exposes O-05's decision.
   */
  readonly evidencePolicyEnforced: EvidencePolicy;
}

export interface RetrieveInput {
  readonly userId: string;
  readonly orgId: OrgId;
  readonly projectId: string | null;
  readonly task: QueryTask;
  readonly query: string;
  readonly timeRange: { readonly from: string | null; readonly to: string | null } | null;
  readonly limit: number;
  readonly action?: string;
  /** A3: user-adjusted channel weights. Recorded in the plan, never applied silently. */
  readonly weightOverrides?: Readonly<Partial<Record<RetrievalChannel, number>>>;
  /** Graph traversal seeds. Entity resolution is phase-01 09-kg; callers pass what they know. */
  readonly graphSeeds?: readonly { kind: string; id: string }[];
  /**
   * F93/O-05: `interview_subjects.id`s whose `ai_analysis` bit is currently declined. Segments
   * attributed to one of these (`CandidateRow.speakerSubjectId`) are excluded before fusion —
   * see `domain/context-pack/consent-prefilter.ts`. This module does not look the set up
   * itself: which subjects are declined is `interview`'s fact
   * (`deriveConsentStatus === "ai_analysis_declined"`), not retrieval's, and a caller that has
   * no interview context at all (e.g. a non-interview project) simply omits it.
   */
  readonly declinedSpeakerSubjectIds?: ReadonlySet<string>;
  /**
   * F42/R7: the caller's `QueryContext.evidencePolicy`, taken as `unknown` and NEVER trusted
   * directly -- see `coerceEvidencePolicy`'s header for why a value that merely type-checks
   * as a string is not the same thing as a validated enum member. Omitted callers get the
   * fail-closed default (`"primary-only"`), not the loosest reading.
   */
  readonly evidencePolicyRaw?: unknown;
}

export interface RetrieveDeps extends AuthorizeDeps {
  readonly retriever: SegmentRetriever;
  readonly embeddings: EmbeddingPort;
  readonly rerank: RerankPort;
}

/** One channel's disclosed output, kept per channel so fusion sees five orderings. */
interface ChannelOutcome {
  readonly planned: PlannedChannel;
  readonly visible: readonly Disclosed<CandidateRow>[];
  readonly withheld: readonly Withheld[];
}

export async function retrieveCandidates(
  deps: RetrieveDeps,
  input: RetrieveInput,
): Promise<RetrievalOutcome> {
  const action = input.action ?? "read.allHands";
  const q: ChannelQuery = {
    orgId: input.orgId,
    projectId: input.projectId,
    query: input.query,
    timeRange: input.timeRange,
    limit: input.limit,
  };

  const plan = applyWeightOverrides(
    planChannels(input.task, analyzeQuery(input.query)),
    input.weightOverrides ?? {},
  );

  // Channels run concurrently -- that is what "五路并行" means, and it is also why a failure
  // must be re-thrown rather than swallowed per channel (see RetrievalUnavailableError).
  let claimHits: readonly ClaimHit[] = [];
  const raw = await Promise.all(
    plan.map(async (planned) => {
      try {
        switch (planned.channel) {
          case "fts":
            return { planned, rows: await deps.retriever.fts(q) };
          case "vector": {
            const embedding = await deps.embeddings.embed(input.query);
            return {
              planned,
              rows: await deps.retriever.vector(q, embedding, {
                model: deps.embeddings.model,
                modelVersion: deps.embeddings.modelVersion,
              }),
            };
          }
          case "graph":
            return { planned, rows: await deps.retriever.graph(q, input.graphSeeds ?? []) };
          case "metadata":
            return { planned, rows: await deps.retriever.metadata(q) };
          case "claim": {
            const r = await deps.retriever.claim(q);
            claimHits = r.claims;
            return { planned, rows: r.candidates };
          }
        }
      } catch (e) {
        if (e instanceof RetrievalUnavailableError) throw e;
        throw new RetrievalUnavailableError(planned.channel, e);
      }
    }),
  );

  // Judged per channel, on that channel's propagation path. One `disclose` call per channel
  // rather than one per document: batch judgement exists because per-item calls make the
  // correct path the slow one, and that is how R7 gets hollowed out (coherence X-1).
  const outcomes: ChannelOutcome[] = [];
  for (const { planned, rows } of raw) {
    const d = await disclose<CandidateRow>(deps, {
      userId: input.userId,
      orgId: input.orgId,
      projectId: input.projectId ?? undefined,
      action,
      path: propagationPathFor(planned.channel),
      items: rows,
    });
    outcomes.push({ planned, visible: d.visible, withheld: d.withheld });
  }

  /* ── omissions: withheld first, then revoked ────────────────────────────────────────── */

  const omissions: Omission[] = [];
  const explained = new Set<string>();
  const omit = (ref: string, reason: "unauthorized" | "withdrawn" | "out-of-scope"): void => {
    // Deduplicated by ref: a document withheld in three channels is one thing the user did not
    // get, and three identical rows in the discard list is a worse answer to "why", not a
    // better one.
    if (explained.has(ref)) return;
    explained.add(ref);
    omissions.push({
      ref,
      reason,
      compliance: OR.isComplianceOmission(reason),
      explain: OR.omissionExplain(reason),
    });
  };

  for (const o of outcomes) for (const w of o.withheld) omit(w.ref.id, "unauthorized");

  /* ── candidate bookkeeping ──────────────────────────────────────────────────────────── */

  const byId = new Map<string, CandidateRow>();
  const decisionOf = new Map<string, string>();
  const revoked = new Set<string>();

  for (const o of outcomes) {
    for (const v of o.visible) {
      const row = v.payload;
      if (row.lifecycle === "revoked") {
        // R3 "排除": a revoked item is permanently excluded. It is still EXPLAINED -- the
        // exclusion is a compliance discard and I-4 keeps it visible under any folding. (Its
        // counter-example text is recalled separately as a lesson; that is a different row.)
        revoked.add(row.segmentId);
        // Only now, after disclosure: emitting it before would tell somebody with no access
        // that a withdrawn document exists.
        omit(row.segmentId, "withdrawn");
        continue;
      }
      byId.set(row.segmentId, row);
      // First decision wins; every one of them is a real judgement about this requester and
      // this segment, so any is correct and picking deterministically keeps replay stable (I-5).
      if (!decisionOf.has(row.segmentId)) decisionOf.set(row.segmentId, v.permissionDecisionId);
    }
  }

  /* ── F93/O-05: per-speaker consent prefilter ───────────────────────────────────────────
   *
   * After disclosure (so the judgement it is layered on is real) and before fusion (so an
   * excluded segment can never be ranked, reranked, budgeted or become an item -- see
   * `consent-prefilter.ts` for why "front-filter, not exit mask" means exactly this position).
   */
  const declinedSpeakerSubjectIds = input.declinedSpeakerSubjectIds ?? new Set<string>();
  const consentPrefilter = applyConsentPrefilter([...byId.values()], declinedSpeakerSubjectIds);
  const consentExcluded = new Set(consentPrefilter.excluded.map((c) => c.segmentId));
  for (const c of consentPrefilter.excluded) {
    byId.delete(c.segmentId);
    // Compliance discard, same shape as `unauthorized`: the AI pipeline is not a permitted
    // consumer of this segment while its speaker's consent is declined. Traced by ref/reason
    // only -- never the content, and never which subject, on this per-segment row (the subject
    // trace is `consentExcludedSubjectIds` on the outcome, aggregated and deduplicated).
    omit(c.segmentId, "unauthorized");
  }

  /* ── F42/R7: evidence-policy front-filter ──────────────────────────────────────────────
   *
   * Same position as the consent prefilter immediately above, and for the same reason: after
   * disclosure (the judgement it applies to is real), before fusion (so a synthesized segment
   * excluded here can never be ranked, reranked, budgeted, or become an item). The raw caller
   * value is coerced ONCE, here, through `coerceEvidencePolicy` -- everything downstream
   * (including `evidencePolicyEnforced` on the outcome) uses the coerced value, never the raw
   * one, so a forged value cannot reach any decision point unfiltered (R12 V5 ③).
   */
  const evidencePolicy = coerceEvidencePolicy(input.evidencePolicyRaw);
  const evidenceFilter = applyEvidencePolicyFilter([...byId.values()], evidencePolicy);
  const evidenceExcluded = new Set(evidenceFilter.excluded.map((c) => c.segmentId));
  for (const c of evidenceFilter.excluded) {
    byId.delete(c.segmentId);
    // `out-of-scope`, not `unauthorized` -- see `evidence-policy-filter.ts`'s header for why
    // this is a statement about what kind of evidence the query accepts, not about who is
    // asking.
    omit(c.segmentId, "out-of-scope");
  }

  /* ── fusion ─────────────────────────────────────────────────────────────────────────── */

  const rankings: ChannelRanking[] = outcomes.map((o) => ({
    channel: o.planned.channel,
    weight: o.planned.weight,
    ids: o.visible
      .map((v) => v.payload)
      .filter(
        (r) =>
          !revoked.has(r.segmentId) && !consentExcluded.has(r.segmentId) && !evidenceExcluded.has(r.segmentId),
      )
      .sort((a, b) => b.channelScore - a.channelScore || (a.segmentId < b.segmentId ? -1 : 1))
      .map((r) => r.segmentId),
  }));

  const fused = fuse(rankings);

  const rerankedIds = await deps.rerank
    .rerank(
      input.query,
      fused.map((f) => ({ id: f.id, content: byId.get(f.id)?.content ?? "" })),
    )
    .catch((e: unknown) => {
      throw new RetrievalUnavailableError("vector", e);
    });
  const ordered = applyRerank(fused, rerankedIds);

  /* ── filter actions, per document ───────────────────────────────────────────────────── */

  const pairedSegments = new Set<string>();
  for (const c of claimHits) {
    // "成对": a contested claim's two sides are injected together and the engine does not
    // choose between them (R3). Both sides are marked, not just the opposing one -- marking
    // only one side would make the pair look like a document plus a rebuttal.
    if (c.status === "contested" || c.contradictingSegmentIds.length > 0) {
      for (const s of [...c.supportingSegmentIds, ...c.contradictingSegmentIds]) pairedSegments.add(s);
    }
  }

  const ranked: RankedCandidate[] = ordered.map((f) => {
    const row = byId.get(f.id)!;
    const reasons: FilterAction[] = ["recall"];
    // R3 "降权": applicability mismatch is kept and marked cross-scope, never excluded.
    if (!row.inScope) reasons.push("downweight");
    // R3 "线索": the graph only ever contributes a bonus, so its trace is a reason, not a rank.
    if (f.channels.includes("graph")) reasons.push("lead");
    if (pairedSegments.has(f.id)) reasons.push("paired");
    return {
      row,
      permissionDecisionId: decisionOf.get(f.id)!,
      channels: f.channels as readonly RetrievalChannel[],
      score: f.score,
      retrievalReasons: reasons,
    };
  });

  /* ── claims ─────────────────────────────────────────────────────────────────────────── */

  const claims: ClaimRef[] = claimHits.map((c) => ({
    statement: c.statement,
    status: c.status,
    supportingSegmentIds: [...c.supportingSegmentIds],
    // ⚠ Copied through untouched, and never intersected with what survived ranking. R7 / I-12:
    // opposing evidence is not filtered. Narrowing this to "the contradicting segments that
    // made the cut" is the single most natural-looking way to violate that, because it reads
    // as tidying up dangling references.
    contradictingSegmentIds: [...c.contradictingSegmentIds],
  }));

  /* ── the plan, as the contract's auditable projection ───────────────────────────────── */

  const hitCounts = new Map<string, number>();
  for (const o of outcomes) {
    hitCounts.set(
      o.planned.channel,
      o.visible.filter(
        (v) =>
          !revoked.has(v.payload.segmentId) &&
          !consentExcluded.has(v.payload.segmentId) &&
          !evidenceExcluded.has(v.payload.segmentId),
      ).length,
    );
  }

  return {
    plan: plan.map((p) => ({
      channel: p.channel,
      weight: p.weight,
      hitCount: hitCounts.get(p.channel) ?? 0,
    })),
    ranked,
    claims,
    omissions,
    confidentialCount: ranked.filter((r) => r.row.confidential).length,
    consentExcludedSubjectIds: consentPrefilter.excludedSubjectIds,
    evidencePolicyEnforced: evidencePolicy,
  };
}
