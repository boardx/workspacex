/**
 * F41 -- uc-22-3 R3 step 2: the fixed per-source file-name contract table, keyed by F40's
 * `MaterializationSourceType` (not by `@repo/contracts`'s `ArtifactSource`).
 *
 * ## Why this is its OWN table, not an extension of `MATERIALIZATION_PLAN`
 *
 * `domain/artifact/materialization.ts`'s `MATERIALIZATION_PLAN` is keyed by the SIGNED
 * `ArtifactSource` enum (7 values, per `packages/contracts/src/files.ts`'s own `FS1` note --
 * "SIGNED artifact.ArtifactSource has 7 values ... deliberately NOT resolved here"). That
 * enum has no `workshop` or `canvas` member, and adding one is a contract-signoff action
 * (ADR-023), not something this feature does on its own authority -- exactly the same
 * constraint `domain/recording/file-first.ts`'s header already documents for F73's own
 * workshop handling.
 *
 * So this table answers a DIFFERENT question than `MATERIALIZATION_PLAN`: not "what does
 * `artifacts.source` hold", but "what file names must exist for this uc-22-3 business
 * domain" -- literally R3's seven-row table, restated as data so
 * `materialize-seven-sources.test.ts` can walk it exhaustively (`MaterializationSourceType`
 * is a closed union; a source added there without a row here is a compile error, the same
 * exhaustiveness discipline `MATERIALIZATION_PLAN` already uses).
 *
 * `SOURCE_TYPE_ARTIFACT_SOURCE_TAG` is the necessary bridge back to the signed enum: every
 * artifact row this feature writes still needs a legal `ArtifactSource` value to sit in its
 * `source` column. Where R3's row already lines up with an existing signed member
 * (survey/conversation/interview/ai-generated, and research-run for "research" -- a naming
 * difference only, not a structural one), the tag is that member verbatim. For `workshop`
 * and `canvas` -- the two R3 domains with NO signed member -- the tag reuses the closest
 * existing member (`interview`, the same workaround F73 already ships; `prototype-run`, the
 * nearest existing "a Studio product became an artifact" member) rather than inventing a
 * new one here. This is a documented workaround pending the FS1 signoff, not a claim that a
 * canvas IS a prototype run.
 */
import type { ArtifactSource } from "../artifact/materialization";
import type { MaterializationSourceType } from "./materialization-events";

/** One required-or-optional file this source domain must materialize. Same shape as
 *  `domain/artifact/materialization.ts`'s `MaterializedFile` -- deliberately NOT imported
 *  from there, because these two tables answer different questions (see this file's header)
 *  and importing the type would read as though this table were a sub-view of that one. */
export interface SourceMaterializedFile {
  readonly name: string;
  readonly mime: string;
  /** False for a file that must be present in every call for this source (I-5's per-domain
   *  counterpart); true for one that only exists when the run happened to produce it (e.g.
   *  an interview with no recording still owes `transcript.jsonl` + `notes.md`, never audio). */
  readonly optional?: boolean;
}

/**
 * uc-22-3 R3 step 2's table, verbatim. `satisfies Record<MaterializationSourceType, ...>` so
 * a new event source added to `domain/files/materialization-events.ts` fails HERE at compile
 * time until someone decides what files it produces -- the same guard
 * `MATERIALIZATION_PLAN` already gives F04's own seven-source table.
 */
export const SEVEN_SOURCE_FILE_PLAN = {
  survey: [
    { name: "responses.csv", mime: "text/csv" },
    { name: "schema.json", mime: "application/json" },
  ],
  // 🔴 R7 "以会话为文件粒度": exactly one file, however many messages the session held.
  conversation: [{ name: "messages.jsonl", mime: "application/jsonl" }],
  interview: [
    { name: "transcript.jsonl", mime: "application/jsonl" },
    { name: "notes.md", mime: "text/markdown" },
    { name: "audio.webm", mime: "audio/webm", optional: true },
  ],
  workshop: [
    { name: "transcript.jsonl", mime: "application/jsonl" },
    { name: "audio.webm", mime: "audio/webm", optional: true },
    // R3: "白板照片（原图 + EXIF）" -- optional because not every workshop uses a whiteboard,
    // the same "optional does not mean skippable at will" discipline `MaterializedFile`'s own
    // doc comment states (I-5 still requires at least one real file per version overall).
    { name: "whiteboard.jpg", mime: "image/jpeg", optional: true },
  ],
  research: [
    // R3: "网页快照（每个来源一份，保留原始 HTML/PDF）" -- modelled as one combined snapshot
    // bundle here (a single file this table can name); a real multi-source research run
    // materializing N per-source snapshots is this domain's own follow-up, not re-litigated
    // by this feature (see the issue's own "跨分片依赖待确认" note -- 09-research is not one
    // of the five modules this feature's cross-cutting contract enumerates).
    { name: "snapshot.html", mime: "text/html", optional: true },
    { name: "citations.json", mime: "application/json" },
  ],
  // R7 D-08: mermaid source is the AUTHORITATIVE form; the layout snapshot is auxiliary
  // (A3). Both file names are new (R7's fixed-seven list is the OTHER five domains' files --
  // canvas's own two names are not yet locked by that list), so this feature is free to name
  // them; picked to read unambiguously in a file browser next to the fixed seven.
  canvas: [
    { name: "diagram.mermaid.md", mime: "text/markdown" },
    { name: "layout-snapshot.json", mime: "application/json" },
  ],
  generated: [
    { name: "content.md", mime: "text/markdown" },
    { name: "provenance.json", mime: "application/json" },
  ],
} as const satisfies Record<MaterializationSourceType, readonly SourceMaterializedFile[]>;

/** The files that MUST be present for a source-type call to be valid at all -- this domain's
 *  counterpart to `materialization.ts`'s `requiredFiles`. */
export function requiredSourceFiles(sourceType: MaterializationSourceType): readonly SourceMaterializedFile[] {
  return SEVEN_SOURCE_FILE_PLAN[sourceType].filter((f) => !("optional" in f && f.optional));
}

/**
 * The `ArtifactSource` value to tag rows of this business domain with. See this file's
 * header for why `workshop`/`canvas` reuse an existing member rather than a new one.
 */
export const SOURCE_TYPE_ARTIFACT_SOURCE_TAG = {
  survey: "survey",
  conversation: "conversation",
  interview: "interview",
  workshop: "interview",
  research: "research-run",
  canvas: "prototype-run",
  generated: "ai-generated",
} as const satisfies Record<MaterializationSourceType, ArtifactSource>;
