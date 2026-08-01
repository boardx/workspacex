/**
 * Ports for five-way recall. Defined here, implemented by `infrastructure`.
 *
 * ## One port, five methods -- not five ports
 *
 * `usecases.md` argues the case for the use case ("五路是一个用例而不是五个": RRF requires the
 * channels to run and fuse together, and splitting them pushes fusion and quota onto the
 * caller). The same argument applies one level down. Five separate retriever ports would let a
 * composition root wire four of them and leave the fifth unbound, and the system would run,
 * return plausible results, and be systematically blind to one class of query -- which is
 * precisely the failure `context-engine.md` overturned graph-first over.
 *
 * ## Everything comes back `Guarded`
 *
 * Not one of these methods returns a row. They return `Guarded<CandidateRow>`, whose payload is
 * unreachable except through `disclose()`. That is what makes UC-0.3 R7 structural for
 * retrieval rather than a rule a retriever author has to remember: a channel that reads
 * `segment_text` and hands back plain rows does not type-check against this interface, and
 * `lint-permission-paths.mjs` catches the version that skips the interface entirely.
 *
 * `sources` on each guarded value names the originating ARTIFACT, never the segment: a
 * segment's effective visibility is its original's and may only be narrower (F04 I-13). A
 * segment judged on its own binding is how a team-only artifact's text leaves through an
 * unbound segment.
 */
import type { contextPack as CP } from "@repo/contracts";
import type { z } from "zod";
import type { OrgId } from "../../domain/org-id";
import type { RetrievalChannel } from "../../domain/retrieval/channel-plan";
import type { Guarded } from "../security/permission-filter";

export type ContextSourceType = z.infer<typeof CP.ContextSourceType>;
export type ClaimStatus = z.infer<typeof CP.ClaimStatus>;

/**
 * The lifecycle states R3 step 3 distinguishes.
 *
 * `revoked` never appears in a candidate list -- the SQL excludes it, permanently (R3 "排除").
 * It is in the type because the ingestion side writes it and a type that omitted it would push
 * that writer to invent a second vocabulary.
 */
export type Lifecycle = "effective" | "review-pending" | "expired" | "revoked";

/** One row from the index, before any permission decision has been made about it. */
export interface CandidateRow {
  readonly segmentId: string;
  readonly artifactId: string;
  readonly artifactVersionId: string;
  readonly projectId: string | null;
  readonly sourceType: ContextSourceType;
  readonly content: string;
  readonly lifecycle: Lifecycle;
  /** False => applicability does not match: keep it, mark cross-scope, downweight (R3 "降权"). */
  readonly inScope: boolean;
  readonly confidential: boolean;
  readonly occurredAt: string;
  readonly method: string | null;
  readonly cohort: string | null;
  /**
   * F93/O-05: the `interview_subjects.id` this segment is attributed to, when the source is an
   * interview transcript with a resolved speaker. `null` = not attributable to a consent-gated
   * subject (most segments -- files, surveys, workshop notes, or an interview segment whose
   * speaker has not been resolved). Judged by
   * `domain/context-pack/consent-prefilter.ts` in `retrieveCandidates`, the same way
   * `lifecycle`/`in_scope`/`confidential` are judged from row facts rather than re-derived.
   */
  readonly speakerSubjectId: string | null;
  /**
   * The channel's own relevance figure, kept for diagnostics only.
   *
   * Fusion uses RANK, not this number -- see `domain/retrieval/rrf.ts` for why the five
   * channels' scores are not comparable and what happens when they are added up anyway.
   */
  readonly channelScore: number;
}

export interface ChannelQuery {
  readonly orgId: OrgId;
  /** null = the "not attached to any project" scope (A1): org and personal layers only. */
  readonly projectId: string | null;
  readonly query: string;
  readonly timeRange: { readonly from: string | null; readonly to: string | null } | null;
  /** Per-channel candidate cap. The budget is applied later, on the fused list. */
  readonly limit: number;
}

/** A claim and the evidence on both sides of it. */
export interface ClaimHit {
  readonly claimId: string;
  readonly statement: string;
  readonly status: ClaimStatus;
  readonly supportingSegmentIds: readonly string[];
  /**
   * ⚠ Never filtered, never truncated (R7 / I-12). It is a separate field rather than a
   * `stance` on a merged list so that "drop the opposing evidence" cannot be expressed as
   * narrowing a filter -- it would have to be written as deleting a field.
   */
  readonly contradictingSegmentIds: readonly string[];
}

export interface ClaimChannelResult {
  readonly claims: readonly ClaimHit[];
  /** The segments those claims cite -- guarded like every other candidate. */
  readonly candidates: readonly Guarded<CandidateRow>[];
}

/**
 * A vector query needs a vector, and producing one is a model call.
 *
 * Separate port because it is a different dependency with a different failure mode: the model
 * gateway being down must surface as `RETRIEVAL_UNAVAILABLE` (blocking the AI call), not as an
 * empty vector channel silently reducing recall.
 *
 * ⚠ **No production implementation exists in phase-00.** No embedding model has been chosen --
 * the model gateway is out of this phase -- and that is why `segment_embeddings.embedding` has
 * no fixed dimension and no ANN index (migration 0009). Tests supply vectors directly, which is
 * the right shape for what V12 measures: the recall comparison holds the embedding constant
 * across both arms, so the model cancels out and what is measured is the permission filter.
 */
export interface EmbeddingPort {
  readonly model: string;
  readonly modelVersion: string;
  embed(text: string): Promise<readonly number[]>;
}

/**
 * Cross-encoder / LLM rerank (R3 step ⑤).
 *
 * Returns an ORDER, not a set. `applyRerank` refuses ids the fusion did not produce and
 * re-appends anything the judge left out, so a reranker cannot drop evidence -- a truncating
 * reranker is a discard decision with no `omissions[]` entry behind it (I-2).
 */
export interface RerankPort {
  rerank(query: string, candidates: readonly { id: string; content: string }[]): Promise<readonly string[]>;
}

export interface SegmentRetriever {
  /** PostgreSQL full-text. The first-class channel: exact wording, numbers, names (V11). */
  fts(q: ChannelQuery): Promise<readonly Guarded<CandidateRow>[]>;
  /** pgvector nearest neighbours for an already-computed query embedding. */
  vector(
    q: ChannelQuery,
    embedding: readonly number[],
    model: { model: string; modelVersion: string },
  ): Promise<readonly Guarded<CandidateRow>[]>;
  /** `ontology_edges` traversal from the query's entities. Fixed bonus only (R3 "线索"). */
  graph(q: ChannelQuery, seeds: readonly { kind: string; id: string }[]): Promise<readonly Guarded<CandidateRow>[]>;
  /** Project / source / time / method / cohort filtering: "上个月能源组做的访谈". */
  metadata(q: ChannelQuery): Promise<readonly Guarded<CandidateRow>[]>;
  /** Reviewed insights and decisions, with both sides of every disputed one. */
  claim(q: ChannelQuery): Promise<ClaimChannelResult>;
}

export const SEGMENT_RETRIEVER = Symbol("SegmentRetriever");
export const EMBEDDING_PORT = Symbol("EmbeddingPort");
export const RERANK_PORT = Symbol("RerankPort");

/** Which propagation path a channel's disclosure is made on (`PROPAGATION_PATHS`). */
export function propagationPathFor(channel: RetrievalChannel): "retrieval" | "embedding-similarity" {
  // Two of the six R7 paths are registered to F10, and they are not interchangeable labels:
  // `embedding-similarity` is the one R7 names for the case where a vector neighbourhood, not
  // a query the user typed, is what surfaced the document. Sending everything down `retrieval`
  // would leave a registered path with nothing on it while claiming coverage.
  return channel === "vector" ? "embedding-similarity" : "retrieval";
}
