/**
 * F75 — the ports `destroyVoiceprintsOnAssignmentComplete` / `sweepVoiceprints` need.
 *
 * Same call as `assignment-ports.ts` (F74): ships **no PostgreSQL implementation** — the
 * `voiceprint_embeddings` / `derived_representations` / `provenance_events` tables this port
 * set assumes belong to F69–F71's storage layer, which has not created them yet. What this
 * feature owns is the shape of the questions destruction asks, plus the domain rules in
 * `domain/recording/voiceprint-destruction.ts`; `tests/support/voiceprint-destruction-fakes.ts`
 * supplies the in-memory doubles the use cases run against.
 */
import type {
  ChannelAssignmentState,
  DerivedRepresentation,
  VoiceprintDestroyReason,
  VoiceprintEmbeddingRecord,
} from "../../domain/recording/voiceprint-destruction";

export interface ChannelAssignmentInspector {
  /** All of a session's anonymous channels + whether each currently has an active assignment. */
  channelsOf(sessionId: string): Promise<readonly ChannelAssignmentState[]>;
}

export interface VoiceprintStore {
  /** Live (not-yet-destroyed) embeddings for a session. */
  listBySession(sessionId: string): Promise<readonly VoiceprintEmbeddingRecord[]>;
  /**
   * Physical delete (I-15) — not a soft mark. The fake/production store must make these rows
   * unreadable through any path, including any `includeDeleted` escape hatch (I-13).
   */
  deleteAll(embeddingIds: readonly string[]): Promise<void>;
}

export interface DerivedRepresentationStore {
  /** Every derived representation whose `inputEmbeddingId` is in this set, valid or not. */
  listReferencing(embeddingIds: readonly string[]): Promise<readonly DerivedRepresentation[]>;
  /** Marks the given derived representations invalidated as of `at` (I-16). */
  invalidate(ids: readonly string[], at: string): Promise<void>;
}

export interface ProvenanceLog {
  /** Writes one `voiceprint-destroyed` audit event and returns its id (I-15). */
  recordVoiceprintDestroyed(event: {
    readonly sessionId: string;
    readonly reason: VoiceprintDestroyReason;
    readonly actor: string;
    readonly at: string;
    readonly destroyedEmbeddingIds: readonly string[];
  }): Promise<string>;
}

export interface SessionInspector {
  /**
   * Sessions that have ended and still have at least one live (not-yet-destroyed) embedding,
   * as of the sweep's reference time. Eligibility by day-count is a **domain** decision
   * (`isSweepEligible`) — this port only narrows the candidate set to "ended + still has
   * something to destroy", it does not itself apply the fallback-day threshold.
   */
  endedSessionsWithLiveEmbeddings(
    asOf: string,
  ): Promise<readonly { readonly sessionId: string; readonly endedAt: string }[]>;
}

export interface VoiceprintPolicyProvider {
  /**
   * The fallback destroy threshold, in days. `null` ⇒ not configured ⇒ the sweep must refuse
   * rather than assume any implicit default (same no-hardcode discipline as
   * `RetentionParameters` in `retention.ts` — see the day-literal note at the top of
   * `voiceprint-destruction.ts`).
   */
  fallbackDestroyDays(): Promise<number | null>;
}

export type {
  ChannelAssignmentState,
  DerivedRepresentation,
  VoiceprintDestroyReason,
  VoiceprintEmbeddingRecord,
};
