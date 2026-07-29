/**
 * file-first: what "anything that can be a file IS a file" means per source (uc-0-1 R1).
 *
 * ## The rule, and the thing it forbids
 *
 * Every artifact version has a real, downloadable object behind it. There is no such thing
 * as a product that "only lives in a database table" -- a survey is `responses.csv` plus
 * `schema.json`, a conversation is `messages.jsonl`, an interview is audio plus
 * `transcript.jsonl` plus `notes.md`.
 *
 * The point is not tidiness. The project file browser (22-files, phase-01) is a VIEW over
 * this model, not a second store; anything that skips materialization is invisible there
 * while appearing to have been saved, and "saved but not in the file list" is
 * indistinguishable from data loss for the person who saved it.
 *
 * ## Why the plan is a table and not a switch inside the save path
 *
 * A switch inside the writer answers "what files did we happen to write". This answers
 * "what files MUST exist", which is a different question and the one an assertion needs:
 * `file-first-materialization.test.ts` walks every source in the contract and checks the
 * produced objects against this table. A source added to the contract with no entry here is
 * a TYPE error (the record is keyed by the contract's enum, exhaustively), not a silent
 * pass -- which is what a switch with a `default:` branch would give.
 */
import { artifact as A } from "@repo/contracts";
import type { z } from "zod";

export type ArtifactSource = z.infer<typeof A.ArtifactSource>;

/** One required file in a source's materialized form. */
export interface MaterializedFile {
  /** Relative name under the version's storage prefix, e.g. `responses.csv`. */
  readonly name: string;
  readonly mime: string;
  /**
   * False for parts that only exist when the run produced them -- an interview without a
   * recording still materializes its transcript and notes.
   *
   * ⚠ Optional does NOT mean "skippable at will": I-5 requires at least one real object per
   * version, and `requiredFiles()` is what proves the required set is never empty.
   */
  readonly optional?: boolean;
}

/**
 * The materialization plan, keyed by the contract's source enum.
 *
 * `satisfies Record<ArtifactSource, ...>` rather than a plain annotation: the annotation
 * would widen the value type and lose the per-key literals, and the whole reason this is a
 * record is that adding `"video-call"` to the contract must not compile until someone
 * decides what files a video call becomes.
 */
export const MATERIALIZATION_PLAN = {
  survey: [
    { name: "responses.csv", mime: "text/csv" },
    // The schema travels WITH the responses. A CSV whose columns are `q1..q17` is not
    // interpretable a year later, and the questionnaire it came from is mutable.
    { name: "schema.json", mime: "application/json" },
  ],
  conversation: [{ name: "messages.jsonl", mime: "application/jsonl" }],
  interview: [
    { name: "transcript.jsonl", mime: "application/jsonl" },
    { name: "notes.md", mime: "text/markdown" },
    { name: "audio.webm", mime: "audio/webm", optional: true },
  ],
  "prototype-run": [{ name: "run.json", mime: "application/json" }],
  "research-run": [
    { name: "run.json", mime: "application/json" },
    // The cited pages, frozen. A citation to a URL is a citation to whatever that URL says
    // today, which is not evidence.
    { name: "citations.jsonl", mime: "application/jsonl" },
  ],
  upload: [{ name: "original", mime: "application/octet-stream" }],
  "ai-generated": [
    { name: "content.md", mime: "text/markdown" },
    // Non-optional on purpose: `synthesized` is a flag on a row, and a row can be read
    // without it. The provenance file travels with the bytes, so the marking survives
    // export, download and anything that reads the object without reading the database.
    { name: "provenance.json", mime: "application/json" },
  ],
} as const satisfies Record<ArtifactSource, readonly MaterializedFile[]>;

/** The files that MUST exist for a version of this source to be a version at all (I-5). */
export function requiredFiles(source: ArtifactSource): readonly MaterializedFile[] {
  return MATERIALIZATION_PLAN[source].filter((f) => !("optional" in f && f.optional));
}

/**
 * The storage key for one file of one version.
 *
 * Every axis that makes a version distinct is in the key, so two versions can never collide
 * on it -- which is the application-side half of I-2. The database enforces the other half
 * (`artifact_versions_uniq_key`); this function is what makes collisions not happen in the
 * first place rather than merely be caught.
 *
 * ⚠ `orgId` leads. A key without it lets two tenants' objects share a path, and object
 * storage has no RLS to catch that afterwards.
 */
export function storageKey(input: {
  orgId: string;
  artifactId: string;
  versionNumber: number;
  fileName: string;
}): string {
  return `${input.orgId}/artifacts/${input.artifactId}/v${input.versionNumber}/${input.fileName}`;
}

/**
 * The storage key for a derived representation.
 *
 * Deliberately a DIFFERENT prefix from `storageKey`, so a derivative can never be written to
 * the key of the original it was derived from (I-6). The database refuses that collision
 * too, via `derived_key_not_an_original_trg` -- this is the half that means the refusal
 * never has to fire.
 */
export function derivedStorageKey(input: {
  orgId: string;
  artifactVersionId: string;
  kind: string;
  fileName: string;
}): string {
  return `${input.orgId}/derived/${input.artifactVersionId}/${input.kind}/${input.fileName}`;
}
