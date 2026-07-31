/**
 * F73 — materialize a finished recording session's products as real files (uc-5-1 R10).
 *
 * ## Reuses F04, does not reinvent it
 *
 * `domain.md` X-1 (recording bundle, cross-bundle constraints) says in as many words: this
 * feature must NOT build a second index for recording materials. So this use case writes
 * through the SAME `ObjectStore` / `ArtifactRepository` ports F04's own
 * `application/artifact/materialize-artifact.ts` uses — the recording bundle owns none of the
 * storage, only the decision of WHICH files a session produces (`domain/recording/file-first.ts`).
 * A row this writes is indistinguishable, to F31's file browser, from any other artifact row:
 * that IS the acceptance criterion (「在项目文件浏览器可见、可下载」), not a side effect of it.
 *
 * ## Why this is not simply a call to `materializeArtifact`
 *
 * `materializeArtifact` bundles ALL of a source's files into ONE artifact + ONE version (see
 * its `MATERIALIZATION_PLAN.interview`, which is transcript + notes + audio together). That
 * model has no `derivedFrom`, and no way to keep "the audio's own SHA-256" stable and
 * separately addressable from "the transcript's SHA-256" — the two would be hashed together
 * into one version content hash. F73's acceptance is explicit that the transcript carries a
 * pointer back to the ORIGINAL audio `artifact_version` while that audio version's own hash
 * never changes (uc-5-1 R10 / I-28). That needs three independent artifacts (one per file),
 * linked by `artifact_versions.derived_from` (migration `20260731153640_f73_recording_file_first`)
 * — so this module writes each file as its own artifact + version rather than delegating to
 * the bundled writer.
 *
 * ## Order of operations
 *
 * The original (audio, when captured) is always materialized FIRST, so its version id exists
 * before anything claims to be derived from it. Same write-once / read-back-and-verify
 * discipline as `materializeArtifact` for each file, for the same reason (I-3: a recorded hash
 * is worthless if it was never checked against what the store actually holds).
 */
import { computeContentHash, verifyContentHash } from "../../domain/artifact/content-hash";
import { storageKey } from "../../domain/artifact/materialization";
import {
  originalFileOf,
  plannedRecordingFiles,
  type RecordingFilePlanEntry,
} from "../../domain/recording/file-first";
import type { SourceType } from "../../domain/recording/transcription-core";
import type { OrgId } from "../../domain/org-id";
import {
  ObjectExistsError,
  ObjectStoreUnavailableError,
  type ArtifactRepository,
  type IdFactory,
  type ObjectStore,
} from "../artifact/ports";

export interface MaterializeSessionDeps {
  readonly store: ObjectStore;
  readonly repo: ArtifactRepository;
  readonly ids: IdFactory;
}

export interface MaterializeSessionInput {
  readonly orgId: OrgId;
  readonly projectId: string | null;
  readonly sessionId: string;
  readonly sourceType: SourceType;
  readonly actorId: string;
  /** File name (as named by `domain/recording/file-first.ts`) to bytes. */
  readonly parts: Readonly<Partial<Record<RecordingFilePlanEntry["fileName"], Uint8Array>>>;
}

export interface MaterializedRecordingFile {
  readonly fileName: RecordingFilePlanEntry["fileName"];
  readonly artifactId: string;
  readonly versionId: string;
  readonly contentHash: string;
  readonly objectStorageKey: string;
  /** The audio version's id this file was produced from, or `null` for the original itself
   *  and for a session with no audio at all (uc-5-1 R10). */
  readonly derivedFrom: string | null;
}

export class RecordingMaterializationFailedError extends Error {}
export class RecordingDependencyUnavailableError extends Error {}

/**
 * Materialize every planned file of a finished session, in one call.
 *
 * ⚠ `input.parts` must supply every file `plannedRecordingFiles` requires for this carrier
 * (audio is only required when the caller actually captured it — see `hasAudio` below, derived
 * from whether `parts["audio.webm"]` was supplied, never from a separate boolean the caller
 * could get out of sync with the bytes it sent).
 */
export async function materializeSessionFiles(
  deps: MaterializeSessionDeps,
  input: MaterializeSessionInput,
): Promise<readonly MaterializedRecordingFile[]> {
  const hasAudio = input.parts["audio.webm"] !== undefined && input.parts["audio.webm"]!.byteLength > 0;
  const planned = plannedRecordingFiles(input.sourceType, hasAudio);
  const original = originalFileOf(input.sourceType, hasAudio);

  const missing = planned.filter((f) => {
    const bytes = input.parts[f.fileName];
    // Zero bytes is a missing file wearing a file's name (same refusal as F04's own check).
    return bytes === undefined || bytes.byteLength === 0;
  });
  if (missing.length > 0) {
    throw new RecordingMaterializationFailedError(
      `session ${input.sessionId} (${input.sourceType}) is missing required file(s): ${missing
        .map((f) => f.fileName)
        .join(", ")}`,
    );
  }

  const results: MaterializedRecordingFile[] = [];
  let originalVersionId: string | null = null;

  // The original first (if there is one) — everything else's `derivedFrom` needs its id.
  const ordered = original === undefined
    ? planned
    : [original, ...planned.filter((f) => f !== original)];

  for (const entry of ordered) {
    const bytes = input.parts[entry.fileName]!;
    const derivedFrom = entry === original ? null : originalVersionId;
    const written = await materializeOne(deps, {
      orgId: input.orgId,
      projectId: input.projectId,
      actorId: input.actorId,
      sessionId: input.sessionId,
      entry,
      bytes,
      derivedFrom,
    });
    if (entry === original) originalVersionId = written.versionId;
    results.push(written);
  }

  return results;
}

async function materializeOne(
  deps: MaterializeSessionDeps,
  args: {
    readonly orgId: OrgId;
    readonly projectId: string | null;
    readonly actorId: string;
    readonly sessionId: string;
    readonly entry: RecordingFilePlanEntry;
    readonly bytes: Uint8Array;
    readonly derivedFrom: string | null;
  },
): Promise<MaterializedRecordingFile> {
  const { store, repo, ids } = deps;
  const artifactId = ids.next("art");

  await repo.createArtifact({
    id: artifactId,
    orgId: args.orgId,
    projectId: args.projectId,
    // XC-03 unruled — see the header of `domain/recording/file-first.ts`.
    source: "interview",
    title: `${args.sessionId} · ${args.entry.fileName}`,
    createdBy: args.actorId,
    synthesized: false,
  });

  const versionNumber = (await repo.headVersionNumber(args.orgId, artifactId)) + 1;
  const versionId = ids.next("ver");
  const key = storageKey({
    orgId: args.orgId,
    artifactId,
    versionNumber,
    fileName: args.entry.fileName,
  });

  try {
    await store.putOnce(key, args.bytes, args.entry.mime);
  } catch (e) {
    if (e instanceof ObjectExistsError) {
      throw new RecordingMaterializationFailedError(`object already exists at ${key}`);
    }
    if (e instanceof ObjectStoreUnavailableError) {
      throw new RecordingDependencyUnavailableError(e.message);
    }
    throw e;
  }

  // Read back and verify. Not paranoia about our own write — see `materialize-artifact.ts`'s
  // header for why this is the only place I-3 is ever established.
  const back = await store.get(key);
  if (back === null || back.byteLength === 0) {
    throw new RecordingMaterializationFailedError(`object ${key} is not readable after write`);
  }
  const contentHash = computeContentHash(args.bytes);
  verifyContentHash(key, contentHash, back);

  await repo.createVersion({
    id: versionId,
    orgId: args.orgId,
    artifactId,
    versionNumber,
    objectStorageKey: key,
    contentHash,
    mime: args.entry.mime,
    sizeBytes: back.byteLength,
    pinnedBy: args.actorId,
    contextPackId: null,
    derivedFrom: args.derivedFrom,
  });

  return {
    fileName: args.entry.fileName,
    artifactId,
    versionId,
    contentHash,
    objectStorageKey: key,
    derivedFrom: args.derivedFrom,
  };
}
