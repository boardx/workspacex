/**
 * issue #465 — `endRecording` and `materializeRecordingArtifacts` as use cases.
 *
 * F69 shipped `startRecording` / `setMicState` / `ingestSegment` and stopped: nothing ended
 * a session, and F73's `materializeSessionFiles` was written to be handed bytes rather than
 * to go and find them. Both halves are here, and both are thin on purpose — every judgement
 * they make is already made somewhere else:
 *
 *   · what files a session owes            → `domain/recording/file-first.ts`
 *   · what a transcript contains           → `domain/recording/transcript-file.ts`
 *   · how a file becomes an artifact       → `application/recording/materialize-file-first.ts`
 *
 * What is genuinely decided here is ORDER, and the order is the same one `capture.ts` states
 * for `startRecording`: refuse before writing. A session that is half-materialised because
 * the "has it ended" check ran after the first artifact was registered is worse than one
 * that was never materialised at all — `MATERIALIZE_PARTIAL_FAILURE` exists precisely
 * because partial success must not be reported as success.
 */
import type { OrgId } from "../../domain/org-id";
import { RECORDING_FILE_ARTIFACT_KIND } from "../../domain/recording/transcript-file";
import { renderTranscriptJsonl } from "../../domain/recording/transcript-file";
import type { RecordingFilePlanEntry } from "../../domain/recording/file-first";
import {
  materializeSessionFiles,
  RecordingDependencyUnavailableError,
  RecordingMaterializationFailedError,
  type MaterializeSessionDeps,
} from "./materialize-file-first";
import type { Result } from "./capture";
import type { RecordingErrorCode } from "../../domain/recording/transcription-core";
import type { IdGenerator } from "./ports";
import type { SegmentLifecycleStore, SessionLifecycleStore } from "./session-lifecycle-ports";

const fail = (reason: RecordingErrorCode): { ok: false; reason: RecordingErrorCode } =>
  ({ ok: false, reason });

/** Wall clock, injected so "how long did this session run" is assertable. */
export interface Clock {
  nowIso(): string;
}

export interface EndRecordingDeps {
  readonly sessions: SessionLifecycleStore;
  readonly ids: IdGenerator;
  readonly clock: Clock;
}

export interface EndRecordingOutput {
  readonly sessionId: string;
  readonly endedAt: string;
  readonly durationMs: number;
  readonly materializeJobId: string;
}

/**
 * End a live session.
 *
 * The job id is minted here and STORED rather than returned and forgotten: the contract
 * splits ending from materialising into two operations, so "which materialisation belongs
 * to this session" has to survive between the two calls, and a client-held id would let two
 * different clients each believe they owned the same session's output.
 */
export async function endRecordingSession(
  deps: EndRecordingDeps,
  input: { readonly sessionId: string },
): Promise<Result<EndRecordingOutput>> {
  const session = await deps.sessions.lifecycleSession(input.sessionId);
  if (session === undefined) return fail("SESSION_NOT_FOUND");
  if (session.endedAt !== null) return fail("SESSION_ALREADY_ENDED");

  const endedAt = deps.clock.nowIso();
  // `durationMs` on a live session is elapsed wall clock (the repository computes it), which
  // is the same number `ingestSegment` has been range-checking anchors against all along.
  const durationMs = session.durationMs;
  const materializeJobId = deps.ids.next("rec-job");
  await deps.sessions.end({ sessionId: input.sessionId, endedAt, durationMs, materializeJobId });

  return { ok: true, sessionId: input.sessionId, endedAt, durationMs, materializeJobId };
}

export interface MaterializeRecordingDeps extends MaterializeSessionDeps {
  readonly sessions: SessionLifecycleStore;
  readonly segments: SegmentLifecycleStore;
}

export interface MaterializedRecordingArtifact {
  readonly kind: (typeof RECORDING_FILE_ARTIFACT_KIND)[RecordingFilePlanEntry["fileName"]];
  readonly artifactId: string;
  readonly versionId: string;
  readonly contentHash: string;
  readonly derivedFrom: string | null;
}

/**
 * Materialize a finished session's files.
 *
 * ⚠ Only the transcript's bytes are produced here. Audio arrives from the client and this
 * bundle has no route that accepts it, so a `workshop`/`interview` session materialised
 * through this path fails with `MATERIALIZE_PARTIAL_FAILURE` rather than registering a
 * transcript and quietly dropping the recording it was derived from. That is a missing
 * upload operation, reported on issue #465 — not something to be worked around by declaring
 * the audio optional, which would make "this session has no audio" and "we lost the audio"
 * the same stored fact.
 */
export async function materializeRecordingSession(
  deps: MaterializeRecordingDeps,
  input: {
    readonly orgId: OrgId;
    readonly sessionId: string;
    readonly actorId: string;
  },
): Promise<Result<{ artifacts: readonly MaterializedRecordingArtifact[] }>> {
  const session = await deps.sessions.lifecycleSession(input.sessionId);
  if (session === undefined) return fail("SESSION_NOT_FOUND");
  if (session.endedAt === null) return fail("SESSION_NOT_ENDED");

  const segments = await deps.segments.ofSession(input.sessionId);
  const transcript = renderTranscriptJsonl(segments);

  try {
    const files = await materializeSessionFiles(
      { store: deps.store, repo: deps.repo, ids: deps.ids },
      {
        orgId: input.orgId,
        projectId: session.projectId,
        sessionId: input.sessionId,
        sourceType: session.sourceType,
        actorId: input.actorId,
        parts: { "transcript.jsonl": transcript },
      },
    );
    return {
      ok: true,
      artifacts: files.map((f) => ({
        kind: RECORDING_FILE_ARTIFACT_KIND[f.fileName],
        artifactId: f.artifactId,
        versionId: f.versionId,
        contentHash: f.contentHash,
        derivedFrom: f.derivedFrom,
      })),
    };
  } catch (e) {
    if (e instanceof RecordingMaterializationFailedError) return fail("MATERIALIZE_PARTIAL_FAILURE");
    if (e instanceof RecordingDependencyUnavailableError) return fail("OBJECT_STORE_UNAVAILABLE");
    throw e;
  }
}
