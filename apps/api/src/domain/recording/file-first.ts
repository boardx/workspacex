/**
 * F73 — what "a recording session's products become files" means, per carrier (uc-5-1 R10).
 *
 * ## Why this is a table, not a switch inside the write path
 *
 * Same reasoning as `domain/artifact/materialization.ts`: a switch inside the writer answers
 * "what files did we happen to write". This answers "what files MUST exist for this carrier",
 * which `tests/rec/file-first-materialization.test.ts` walks exhaustively over `CARRIERS`
 * (the contract's own enum, not a hand-written list) so a fourth carrier added to the contract
 * fails this file's own exhaustiveness check rather than silently materializing nothing.
 *
 * ## What this deliberately does NOT decide
 *
 * `ArtifactSource` (packages/contracts/src/artifact.ts) has no `workshop` / `thread` member —
 * only `interview` — and domain.md XC-03 already flags that the recording bundle's three
 * carriers, files' own source vocabulary, and `segment_text.source_type` are three unequal
 * vocabularies with no ruling yet. This module does not resolve that: every plan below reuses
 * the closed contract's `"interview"` `ArtifactSource` for whichever carrier produced the
 * session, because it is the only member shaped like "audio + transcript + notes". That is a
 * stated workaround, not a decision that workshops or threads ARE interviews.
 */
import type { SourceType } from "./transcription-core";

/** One file this carrier's session must materialize, keyed by its role in the plan. */
export interface RecordingFilePlanEntry {
  /** Canonical file name — the same three names `artifact/materialization.ts` already uses
   *  for `interview`, so a browser row for a recording session's audio looks like any other
   *  audio row rather than inventing a fourth naming scheme. */
  readonly fileName: "audio.webm" | "transcript.jsonl" | "notes.md";
  readonly mime: string;
  /** True for the ONE entry every session of this carrier must have if it has any audio at
   *  all captured — i.e. the thing everything else in the plan is `derivedFrom`. */
  readonly isOriginalWhenPresent: boolean;
  /** False ⇒ this file must exist for every session of this carrier, audio or not. */
  readonly requiresAudio: boolean;
}

/**
 * The plan, keyed by the recording contract's own `SourceType` enum (`satisfies` — not a
 * plain annotation — for the same exhaustiveness reason `MATERIALIZATION_PLAN` uses one).
 *
 * `transcript.jsonl` is required for every carrier: a session that ended with zero segments
 * still owes its (possibly empty) transcript file, and "there is no transcript file" is not
 * how "nothing was said" gets represented (that is an empty `transcript.jsonl`, not an absent
 * one — same discipline as I-5 for F04's own materialization).
 *
 * `notes.md` is interview-only, per this feature's `user_visible_behavior` verbatim: "音频文件 +
 * transcript.jsonl（访谈另有 notes.md）".
 */
export const RECORDING_FILE_PLAN = {
  workshop: [
    { fileName: "audio.webm", mime: "audio/webm", isOriginalWhenPresent: true, requiresAudio: true },
    { fileName: "transcript.jsonl", mime: "application/jsonl", isOriginalWhenPresent: false, requiresAudio: false },
  ],
  interview: [
    { fileName: "audio.webm", mime: "audio/webm", isOriginalWhenPresent: true, requiresAudio: true },
    { fileName: "transcript.jsonl", mime: "application/jsonl", isOriginalWhenPresent: false, requiresAudio: false },
    { fileName: "notes.md", mime: "text/markdown", isOriginalWhenPresent: false, requiresAudio: false },
  ],
  thread: [
    // A chat thread carries no audio track (uc-5-1 R1: 「对话线程」anchors are `messageId`, not
    // timecodes — see `transcription-core.ts` `ANCHOR_RULES`). Its transcript is its own
    // original: `derivedFrom` is null by construction, never "pending an audio that never
    // comes".
    { fileName: "transcript.jsonl", mime: "application/jsonl", isOriginalWhenPresent: false, requiresAudio: false },
  ],
} as const satisfies Record<SourceType, readonly RecordingFilePlanEntry[]>;

/**
 * The plan entries this session actually produces, given whether it captured audio.
 *
 * `hasAudio: false` for a workshop drops its `audio.webm` entry (the only `requiresAudio`
 * entry any carrier has) rather than materializing a zero-byte audio file — the same "empty
 * file wearing a file's name" refusal `materialize-artifact.ts` applies to its own required
 * parts.
 */
export function plannedRecordingFiles(
  sourceType: SourceType,
  hasAudio: boolean,
): readonly RecordingFilePlanEntry[] {
  return RECORDING_FILE_PLAN[sourceType].filter((f) => hasAudio || !f.requiresAudio);
}

/** The one entry (if any) everything else in the plan is `derivedFrom`. */
export function originalFileOf(
  sourceType: SourceType,
  hasAudio: boolean,
): RecordingFilePlanEntry | undefined {
  return plannedRecordingFiles(sourceType, hasAudio).find((f) => f.isOriginalWhenPresent);
}
