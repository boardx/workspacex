/**
 * issue #465 — the ports the four session-lifecycle ROUTES need, on top of F69's.
 *
 * F69's `ports.ts` describes capture: create a session, create tracks, append a segment.
 * It stops there because at the time nothing outside a test ever ended a session or read
 * one back. The HTTP boundary does both, so this file adds exactly those two questions and
 * nothing else — it is an extension of F69's shapes, not a replacement, which is why every
 * interface here extends rather than restates.
 *
 * ## Why a unit of work rather than one repository per store
 *
 * `startRecording` writes a session row and N track rows and must leave NOTHING behind when
 * the consent gate refuses. With one `withTenant` transaction per repository method, "leave
 * nothing behind" would be a compensating delete — i.e. cleanup code that runs only if the
 * process survives long enough to run it. `withOrg` hands every store in one transaction, so
 * the refusal path rolls back because it never committed, not because something tidied up.
 *
 * ## Why `ConsentMatrixReader` takes the participants
 *
 * F69's `ConsentGate.blocksStart(sourceRefId)` asks "is any cell pending". That question
 * cannot see the case that matters most at the boundary: a participant with NO cells at
 * all. Nothing is pending for someone who was never asked, so the F69 gate would open. This
 * port therefore takes the participant set the caller is about to record, and the adapter in
 * the controller closes over it to satisfy F69's narrower interface — the use case keeps its
 * signature, and the completeness judgement lives where the participant list exists.
 */
import type { OrgId } from "../../domain/org-id";
import type { TranscriptionPolicy } from "../../domain/recording/transcription-core";
import type { TranscriptLineSource } from "../../domain/recording/transcript-file";
import type {
  RecordingSessionState,
  RetentionResolver,
  SegmentStore,
  SessionStore,
  TrackStore,
} from "./ports";

/** A session plus the two facts only the lifecycle routes need. */
export interface RecordingSessionLifecycleState extends RecordingSessionState {
  readonly startedAt: string;
  readonly sourceRefId: string;
  readonly materializeJobId: string | null;
  /**
   * The retention that was resolved AT START, read back from the row rather than recomputed.
   *
   * `startRecording`'s response carries `resolvedDays` / `resolvedFrom` / `expiresAt`, and
   * computing those a second time in the controller would be the same fact in two places —
   * the failure this repository has already had five times. The row is the fact.
   */
  readonly retention: {
    readonly resolvedDays: number;
    readonly resolvedFrom: "project" | "org";
    readonly expiresAt: string;
  };
}

export interface SessionLifecycleStore extends SessionStore {
  /** The extended read. `session()` stays as F69 declared it so `capture.ts` is untouched. */
  lifecycleSession(sessionId: string): Promise<RecordingSessionLifecycleState | undefined>;
  /** Ending is one write: `ended_at`, `duration_ms` and `materialize_job_id` together. */
  end(input: {
    readonly sessionId: string;
    readonly endedAt: string;
    readonly durationMs: number;
    readonly materializeJobId: string;
  }): Promise<void>;
}

/** Reading a session's segments back, in the stored order. */
export interface SegmentLifecycleStore extends SegmentStore {
  /** ⚠ Ordered by the stored `ordinal`, never by insertion timing or by id. */
  ofSession(sessionId: string): Promise<readonly TranscriptLineSource[]>;
}

export interface ConsentMatrixReader {
  /**
   * True ⇒ `startRecording` must refuse.
   *
   * Fail closed: a participant with no rows blocks, and an empty participant set blocks. A
   * session nobody has consented to is not a session with nothing to check.
   */
  blocksStart(sourceRefId: string, participantIds: readonly string[]): Promise<boolean>;
}

export type RecordingOperationName =
  | "startRecording"
  | "ingestSegment"
  | "endRecording"
  | "materializeRecordingArtifacts";

export type IdempotencyLookup<T> =
  | { readonly kind: "missing" }
  | { readonly kind: "replay"; readonly result: T }
  | { readonly kind: "conflict" };

export interface IdempotencyStore {
  /**
   * `conflict` ⇒ the key was used with a DIFFERENT payload. That is
   * `IDEMPOTENCY_KEY_CONFLICT`, and it must be distinguishable from a replay — collapsing
   * the two would let a client reuse one key for two different recordings and get the first
   * one's answer back for the second.
   */
  lookup<T>(operation: RecordingOperationName, key: string, payloadDigest: string): Promise<IdempotencyLookup<T>>;
  remember(input: {
    readonly operation: RecordingOperationName;
    readonly key: string;
    readonly payloadDigest: string;
    readonly result: unknown;
  }): Promise<void>;
}

/** Every store the four routes touch, all bound to ONE tenant transaction. */
export interface RecordingStores {
  readonly sessions: SessionLifecycleStore;
  readonly tracks: TrackStore;
  readonly segments: SegmentLifecycleStore;
  readonly consent: ConsentMatrixReader;
  readonly idempotency: IdempotencyStore;
  /**
   * F69's resolver, backed by F46's `retention_policies`.
   *
   * ⚠ Ordering is load-bearing and is `capture.ts`'s own ("consent before retention before
   * anything is written"): `sessions.create()` stores the resolution this returns, so a
   * `create` that was not preceded by a `resolve` for the same project THROWS rather than
   * inventing a number. That is the whole of I-33 at this layer — there is no default here
   * and there must never be one.
   */
  readonly retention: RetentionResolver;
}

export interface RecordingUnitOfWork {
  /**
   * Run `fn` inside one tenant-scoped transaction, on behalf of one actor.
   *
   * ⚠ Throwing out of `fn` rolls the transaction back, and the routes rely on exactly that
   * for their refusal paths. A future implementation that commits early would turn every
   * "and writes nothing" assertion in `tests/rec/recording-http-session-lifecycle.test.ts`
   * red, which is the intended alarm.
   */
  withOrg<T>(
    orgId: OrgId,
    actor: { readonly userId: string },
    fn: (stores: RecordingStores) => Promise<T>,
  ): Promise<T>;
}

export const RECORDING_UNIT_OF_WORK = Symbol("RecordingUnitOfWork");

/**
 * The `TranscriptionPolicy` provider (`isLowConfidence` + `mask`).
 *
 * A provider rather than the policy itself, because resolving it can FAIL: D-1 (「多低算低」)
 * is undecided, so the threshold is a deployment parameter with no built-in default, and a
 * deployment that has not set one must not silently transcribe everything as
 * `lowConfidence: false`. Flagging nothing is picking a threshold.
 */
export const TRANSCRIPTION_POLICY_PROVIDER = Symbol("TranscriptionPolicyProvider");

/** Raised when the deployment has not supplied the parameters `TranscriptionPolicy` needs. */
export class TranscriptionPolicyUnconfiguredError extends Error {}

export interface TranscriptionPolicyProvider {
  /** ⚠ Throws `TranscriptionPolicyUnconfiguredError`; it never returns a stand-in policy. */
  policy(): TranscriptionPolicy;
}

export const RECORDING_ID_GENERATOR = Symbol("RecordingIdGenerator");
