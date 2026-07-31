/**
 * F69 — capture use cases. **One implementation, three carriers.**
 *
 * `startRecording` / `setMicState` / `ingestSegment` live in one file and take `sourceType`
 * as data. There is no `ingestWorkshopSegment`, no `ingestInterviewSegment`, no
 * `ingestThreadSegment`, and by construction there cannot usefully be one: only
 * `domain/recording/transcription-core.transcribe` can mint a `TranscribedSegment`, and only
 * a `TranscribedSegment` can be appended (see `ports.ts`).
 *
 * What that buys, concretely: change `TranscriptionPolicy.isLowConfidence` or the masking port
 * once, and all three carriers change together — asserted in lockstep by
 * `tests/rec/multi-track-no-crosstalk.test.ts`, which also runs its whole table over
 * `CARRIERS` read off the contract rather than over a hand-written list of three.
 */
import {
  CARRIERS,
  transcribe,
  type RecordingErrorCode,
  type SegmentAnchor,
  type SourceType,
  type TranscribedSegment,
  type TranscriptionPolicy,
} from "../../domain/recording/transcription-core";
import {
  applyMicState,
  canProduceSegments,
  initialTimeline,
  intersectsGap,
  type MicState,
} from "../../domain/recording/mic-state";
import type {
  ConsentGate,
  IdGenerator,
  RetentionResolver,
  SegmentStore,
  SessionStore,
  TrackStore,
} from "./ports";

export type Fail = { readonly ok: false; readonly reason: RecordingErrorCode };
export type Ok<T> = { readonly ok: true } & T;
export type Result<T> = Ok<T> | Fail;

const fail = (reason: RecordingErrorCode): Fail => ({ ok: false, reason });

export interface CaptureDeps {
  readonly sessions: SessionStore;
  readonly tracks: TrackStore;
  readonly segments: SegmentStore;
  readonly consent: ConsentGate;
  readonly retention: RetentionResolver;
  readonly policy: TranscriptionPolicy;
  readonly ids: IdGenerator;
}

export interface StartRecordingInput {
  readonly sourceType: SourceType;
  readonly sourceRefId: string;
  readonly projectId: string;
  readonly orgId: string;
  /**
   * One entry per track. `micState` is the **browser permission outcome at entry** — a
   * participant who refused the prompt joins as `denied` and stays that way (see
   * `mic-state.ts`), which is what makes 「本路显式标『未录制』」 a stored fact rather than a
   * rendering choice.
   */
  readonly trackPlan: readonly {
    readonly participantId: string | null;
    readonly micState: MicState;
  }[];
}

export interface StartRecordingOutput {
  readonly sessionId: string;
  readonly tracks: readonly { readonly trackId: string; readonly micState: MicState }[];
  readonly retention: {
    readonly resolvedDays: number;
    readonly resolvedFrom: "project" | "org";
  };
}

/**
 * `startRecording` — identical for a workshop, an interview and a chat thread.
 *
 * Order of refusals is a contract detail, not an accident: consent before retention before
 * anything is written. A session that exists with zero tracks because we checked halfway is
 * worse than no session.
 */
export async function startRecording(
  deps: CaptureDeps,
  input: StartRecordingInput,
): Promise<Result<StartRecordingOutput>> {
  // Belt and braces for the one thing the type system already guarantees: if the contract
  // ever gains a carrier, this throws loudly here rather than mis-routing quietly.
  if (!CARRIERS.includes(input.sourceType)) return fail("SOURCE_REF_NOT_FOUND");

  if (await deps.sessions.liveSessionFor(input.sourceRefId)) {
    return fail("SESSION_ALREADY_RECORDING");
  }
  if (await deps.consent.blocksStart(input.sourceRefId)) return fail("CONSENT_NOT_COMPLETED");

  // I-33: no implicit constant. Missing org default ⇒ refuse, and create nothing.
  const retention = await deps.retention.resolve({
    projectId: input.projectId,
    orgId: input.orgId,
  });
  if (retention === undefined) return fail("RETENTION_POLICY_MISSING");

  const sessionId = deps.ids.next("rec-session");
  await deps.sessions.create({
    sessionId,
    projectId: input.projectId,
    sourceType: input.sourceType,
    sourceRefId: input.sourceRefId,
  });

  const tracks: { trackId: string; micState: MicState }[] = [];
  for (const plan of input.trackPlan) {
    const trackId = deps.ids.next("rec-track");
    await deps.tracks.create({
      trackId,
      sessionId,
      participantId: plan.participantId,
      timeline: initialTimeline(plan.micState),
    });
    tracks.push({ trackId, micState: plan.micState });
  }

  return {
    ok: true,
    sessionId,
    tracks,
    retention: { resolvedDays: retention.resolvedDays, resolvedFrom: retention.resolvedFrom },
  };
}

export interface SetMicStateInput {
  readonly trackId: string;
  readonly micState: MicState;
  readonly atMs: number;
  /** The caller, for `NOT_TRACK_OWNER`. The session facilitator is passed separately. */
  readonly actorParticipantId: string;
  readonly actorIsFacilitator: boolean;
}

/** `setMicState` — pause/resume a track. Same code path for all three carriers. */
export async function setMicState(
  deps: CaptureDeps,
  input: SetMicStateInput,
): Promise<Result<{ trackId: string; micState: MicState; gapRanges: readonly { fromMs: number; toMs: number }[] }>> {
  const track = await deps.tracks.track(input.trackId);
  if (track === undefined) return fail("TRACK_NOT_FOUND");

  // 「隐藏入口不构成安全控制」 — the owner check is here, server side, not in the button.
  const isOwner = track.participantId !== null && track.participantId === input.actorParticipantId;
  if (!isOwner && !input.actorIsFacilitator) return fail("NOT_TRACK_OWNER");

  const applied = applyMicState(track.timeline, input.micState, input.atMs);
  if (!applied.ok) return fail(applied.reason);

  await deps.tracks.updateTimeline(track.trackId, applied.timeline);
  return {
    ok: true,
    trackId: track.trackId,
    micState: applied.timeline.micState,
    gapRanges: applied.timeline.gapRanges,
  };
}

export interface IngestSegmentInput {
  readonly sessionId: string;
  readonly trackId: string;
  readonly anchor: SegmentAnchor;
  readonly rawText: string;
  readonly asrConfidence: number;
  readonly diarization: { readonly channelId: string | null; readonly overlap: boolean };
  readonly draft: boolean;
}

export interface IngestSegmentOutput {
  readonly segmentId: string;
  readonly segment: TranscribedSegment;
}

/**
 * `ingestSegment` — **the** write path for transcript segments.
 *
 * Every guard here is a data-layer guard because every one of them has already been described
 * as a rendering rule somewhere in the prototype, and a rendering rule is not a control:
 *
 *   · `MIC_NOT_GRANTED` — I-4. A `denied` track produces nothing. Not "renders nothing".
 *   · `MIC_NOT_GRANTED` for a gap-overlapping anchor — I-5. `paused` time is missing time; a
 *     segment covering it would splice the timeline back into a continuous-looking whole.
 *   · `SESSION_ENDED` — nothing lands after the session closes.
 *
 * `sourceType` is read from the session and handed to the one core. That is the whole of the
 * per-carrier logic in this function.
 */
export async function ingestSegment(
  deps: CaptureDeps,
  input: IngestSegmentInput,
): Promise<Result<IngestSegmentOutput>> {
  const session = await deps.sessions.session(input.sessionId);
  if (session === undefined) return fail("SESSION_NOT_FOUND");
  if (session.endedAt !== null) return fail("SESSION_ENDED");

  const track = await deps.tracks.track(input.trackId);
  if (track === undefined || track.sessionId !== input.sessionId) return fail("TRACK_NOT_FOUND");

  // I-4. Checked before anything else touches the text: a refused microphone must not even
  // reach the masking kernel, let alone the store.
  if (!canProduceSegments(track.timeline.micState)) return fail("MIC_NOT_GRANTED");

  const { startMs, endMs } = input.anchor;
  if (startMs !== null && endMs !== null && intersectsGap(track.timeline, startMs, endMs)) {
    return fail("MIC_NOT_GRANTED");
  }

  const result = transcribe(
    {
      sessionId: input.sessionId,
      trackId: input.trackId,
      sourceType: session.sourceType,
      anchor: input.anchor,
      rawText: input.rawText,
      asrConfidence: input.asrConfidence,
      diarization: input.diarization,
      draft: input.draft,
      sessionDurationMs: session.durationMs,
    },
    deps.policy,
  );
  if (!result.ok) return fail(result.reason);

  const { segmentId } = await deps.segments.append(result.segment);
  return { ok: true, segmentId, segment: result.segment };
}
