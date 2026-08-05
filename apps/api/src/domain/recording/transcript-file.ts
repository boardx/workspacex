/**
 * issue #465 — what `transcript.jsonl` actually CONTAINS, and which artifact kind each
 * planned file is registered as.
 *
 * `file-first.ts` (F73) decides WHICH files a session owes and `materialize-file-first.ts`
 * writes them, but between the two there was nothing that turned stored segments into
 * bytes: `materializeSessionFiles` takes `parts` and the caller was expected to already
 * hold them. For audio that is right (the bytes come from the client). For the transcript
 * it is not — the transcript is derived from rows this system owns, so the derivation is a
 * rule, and a rule belongs here rather than inside a repository or a controller.
 *
 * ## Why one JSON object per line, and why these fields
 *
 * The file name is the decision: `file-first.ts` named it `transcript.jsonl` and typed it
 * `application/jsonl`, so the format is not open. The FIELDS are read off the contract's
 * own `Segment` shape rather than chosen here — a transcript that carried fields the API
 * does not return, or omitted ones it does, would be a second description of a segment.
 * `resolvedSpeaker` is the one contract field deliberately absent: I-10 says it is derived
 * from `SpeakerAssignment` at read time and is not stored on the segment, so writing it
 * into a frozen file would freeze an answer that is supposed to still be changeable.
 *
 * ## Why the text is the masked text
 *
 * There is no other text. I-21 is that the raw string never survives `transcribe()`, so
 * "the transcript file holds the original" is not an option that exists — and the file
 * being masked is what lets it be registered as an ordinary artifact readable through the
 * ordinary file browser.
 */
import type { RecordingFilePlanEntry } from "./file-first";
import type { PiiFinding, SegmentAnchor, SegmentStatus, SourceType } from "./transcription-core";

/** The recording contract's four `RecordingArtifactKind` members, keyed by planned file. */
export const RECORDING_FILE_ARTIFACT_KIND = {
  "audio.webm": "audio",
  "transcript.jsonl": "transcript",
  "notes.md": "notes",
} as const satisfies Record<RecordingFilePlanEntry["fileName"], string>;

export type RecordingFileArtifactKind =
  (typeof RECORDING_FILE_ARTIFACT_KIND)[keyof typeof RECORDING_FILE_ARTIFACT_KIND];

/** One stored segment, as the transcript needs to see it. */
export interface TranscriptLineSource {
  readonly id: string;
  readonly sessionId: string;
  readonly trackId: string;
  readonly sourceType: SourceType;
  readonly anchor: SegmentAnchor;
  readonly speakerChannelId: string | null;
  readonly status: SegmentStatus;
  readonly lowConfidence: boolean;
  readonly text: string;
  readonly piiFindings: readonly PiiFinding[];
}

/**
 * Render a session's segments as JSONL bytes, in the order given.
 *
 * ⚠ Ordering is the CALLER's, not this function's. Sorting here would put the transcript's
 * order in two places (this function and the `ordinal` column) and they would eventually
 * disagree; the repository reads by `ordinal` and hands the result straight through.
 *
 * ⚠ Zero segments produces ZERO BYTES, and `materializeSessionFiles` refuses a zero-byte
 * required file. That refusal is deliberate there ("an empty file wearing a file's name")
 * and `file-first.ts` is equally deliberate that a silent session still owes an *empty*
 * `transcript.jsonl`. The two rules contradict each other for exactly one case — a session
 * that ended having recorded nothing — and this function does not resolve it by inventing a
 * placeholder line: a fabricated record in an evidence file is worse than a loud refusal.
 * Reported on issue #465 rather than papered over.
 */
export function renderTranscriptJsonl(segments: readonly TranscriptLineSource[]): Uint8Array {
  const lines = segments.map((s) =>
    JSON.stringify({
      id: s.id,
      sessionId: s.sessionId,
      trackId: s.trackId,
      sourceType: s.sourceType,
      anchor: s.anchor,
      speakerChannelId: s.speakerChannelId,
      status: s.status,
      lowConfidence: s.lowConfidence,
      text: s.text,
      piiFindings: s.piiFindings,
    }),
  );
  return new TextEncoder().encode(lines.map((l) => `${l}\n`).join(""));
}
