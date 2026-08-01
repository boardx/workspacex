/**
 * Materialize a Studio product into real files and one immutable version (uc-0-1 R1/R3-1).
 *
 * This is the file-first half of F04: whatever a Studio produced -- survey answers, a chat
 * log, an interview -- becomes actual objects in object storage, and a row that points at
 * them. "Saved" and "there is a file you can download" are the same event; there is no path
 * through this module that records one without the other.
 *
 * ## Order of operations, and why it is this way round
 *
 *   1. object storage first (write-once)
 *   2. hash, and read back to verify
 *   3. PostgreSQL row last
 *
 * The reverse order produces a metadata row pointing at an object that was never written --
 * a dangling pointer that reads as a healthy version until somebody downloads it. This
 * order's failure mode is an orphaned object with no row: invisible, costs storage, harms
 * nobody, and a sweeper can find it. Between "silently wrong" and "wasteful", the model has
 * to fail towards wasteful.
 *
 * Step 2 is not paranoia about our own writes. It is the only place I-3 is ever established:
 * everywhere downstream, `content_hash` is trusted. If the claim is recorded from the bytes
 * in memory rather than from the bytes that came back, the row asserts something about the
 * object store that was never checked against it.
 *
 * ## What this does NOT do
 *
 * No binding, no draft/live/pinned mode, no optimistic concurrency response. Those are
 * F05/F06. What is here is the model those sit on: a version exists, it has files, its hash
 * is verified, and nothing can rewrite it afterwards.
 *
 * ⚠ **Contract gap, not worked around.** `operations.saveDraft.in` carries
 * `{artifactId?, orgId, projectId, source, title}` and no content of any kind, while its
 * `out` promises `materializedKeys` -- so no HTTP request as specified can produce a file.
 * The bytes therefore enter through this use case's `parts`, supplied by the caller, and
 * F04 ships no `/artifacts/draft` controller. Inventing a body shape here would be a second
 * declaration of the request contract, which is the one thing ADR-020 forbids outright.
 */
import { MATERIALIZATION_PLAN, requiredFiles, storageKey } from "../../domain/artifact/materialization";
import { computeContentHash, verifyContentHash, versionContentHash } from "../../domain/artifact/content-hash";
import type { OrgId } from "../../domain/org-id";
import {
  ObjectExistsError,
  ObjectStoreUnavailableError,
  type ArtifactRepository,
  type ArtifactSource,
  type IdFactory,
  type ObjectStore,
} from "./ports";

export interface MaterializeDeps {
  readonly store: ObjectStore;
  readonly repo: ArtifactRepository;
  readonly ids: IdFactory;
}

export interface MaterializeInput {
  readonly orgId: OrgId;
  readonly artifactId?: string;
  readonly projectId: string | null;
  readonly source: ArtifactSource;
  readonly title: string;
  readonly actorId: string;
  /** File name (as named by the materialization plan) to bytes. */
  readonly parts: Readonly<Record<string, Uint8Array>>;
  /**
   * Write EXACTLY this version number, instead of "whatever comes after the current head".
   *
   * ⚠ Added by F05, and not a convenience -- the default is unsafe for any caller that has
   * already made a decision about the head.
   *
   * The default re-reads the head here and takes `head + 1`. Under concurrency that turns a
   * lost race into a SUCCESS at a different number: two writers both check that the head is
   * 1, the first commits v2, and the second -- arriving a moment later -- reads head 2 and
   * cheerfully writes v3. Nothing collides, nothing is refused, and the second writer's
   * snapshot is recorded as succeeding v2, a version it never saw. Its lineage is then a
   * statement that is not true, and E4's "the other party is told the version changed" never
   * happens.
   *
   * Measured, not theorised: `snapshot-concurrent-single-version.test.ts` produced exactly
   * that (two fulfilled pins, numbered 2 and 3) before this parameter existed.
   *
   * So a caller holding an `expectedHeadVersion` passes the number it means, and the
   * collision it is entitled to gets to happen.
   */
  readonly versionNumber?: number;

  /**
   * F35 passthrough to `NewArtifact` -- see that type for why these are optional and what
   * "undefined" means. Only the upload use case sets them; every other caller (F05 pin,
   * F06 binding, the F04 tests) is unaffected.
   */
  readonly agendaSegmentId?: string | null;
  readonly confidential?: boolean;
  readonly ingestionStatus?: string;

  /**
   * F44 passthrough to `NewArtifactVersion` -- see that type for why these are optional.
   * `uploadNewVersion` (F44) is the first caller to set them explicitly (a human or agent
   * adding a version to an EXISTING artifact, via upload or a derivation rerun); every other
   * caller is unaffected and keeps the column defaults.
   */
  readonly versionCreatorKind?: "user" | "agent";
  readonly versionAgentRunId?: string | null;
  readonly versionChangeSource?: "upload" | "materialize" | "rerun";
}

export interface MaterializeResult {
  readonly artifactId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  /** One per file actually written. Non-empty by construction -- see below. */
  readonly materializedKeys: readonly string[];
  readonly contentHash: string;
}

/** The contract's `MATERIALIZATION_FAILED`. */
export class MaterializationFailedError extends Error {}

/**
 * A storage key for this version number was already taken -- i.e. another writer got there
 * first with the same head.
 *
 * A SUBCLASS, so every existing `MATERIALIZATION_FAILED` mapping keeps working unchanged and
 * `pin-version.ts` can still tell this one case apart. It is the only materialization failure
 * where retrying against the new head succeeds; the rest ("you did not supply schema.json")
 * fail identically forever, and reporting them all as `VERSION_CHANGED` would tell a user to
 * refresh their way out of a missing file.
 */
export class VersionKeyTakenError extends MaterializationFailedError {}
/** The contract's `DEPENDENCY_UNAVAILABLE`. */
export class DependencyUnavailableError extends Error {}

export async function materializeArtifact(
  deps: MaterializeDeps,
  input: MaterializeInput,
): Promise<MaterializeResult> {
  const { store, repo, ids } = deps;
  const required = requiredFiles(input.source);

  // Checked before anything is written. A partial write followed by a validation failure
  // leaves objects behind for no reason, and E3 says a failed save keeps the user's input
  // intact rather than half-committing it.
  const missing = required.filter((f) => {
    const b = input.parts[f.name];
    // Zero bytes is a missing file wearing a file's name -- and `size_bytes > 0` in the
    // schema would reject it several steps later, with a constraint name for a message.
    return b === undefined || b.byteLength === 0;
  });
  if (missing.length > 0) {
    throw new MaterializationFailedError(
      `source "${input.source}" requires ${missing.map((f) => f.name).join(", ")}`,
    );
  }

  const artifactId = input.artifactId ?? ids.next("art");
  if (input.artifactId === undefined) {
    await repo.createArtifact({
      id: artifactId,
      orgId: input.orgId,
      projectId: input.projectId,
      source: input.source,
      title: input.title,
      createdBy: input.actorId,
      // Derived, never taken from the caller. A request that could say
      // `source: "ai-generated", synthesized: false` is exactly the disguise the flag
      // exists to prevent; the schema refuses that combination too.
      synthesized: input.source === "ai-generated",
      agendaSegmentId: input.agendaSegmentId,
      confidential: input.confidential,
      ingestionStatus: input.ingestionStatus,
    });
  }

  // Re-reading the head is only correct when nobody upstream has already decided which
  // number this is. See `versionNumber` on the input type.
  const versionNumber =
    input.versionNumber ?? (await repo.headVersionNumber(input.orgId, artifactId)) + 1;
  const versionId = ids.next("ver");

  // Every part named by the plan that the caller supplied -- required ones are guaranteed
  // present by the check above, optional ones appear when they exist.
  const planned = required
    .map((f) => f.name)
    .concat(Object.keys(input.parts).filter((n) => !required.some((f) => f.name === n)));

  const written: string[] = [];
  const hashes: string[] = [];
  let totalBytes = 0;
  let primaryMime = "application/octet-stream";

  for (const name of planned) {
    const bytes = input.parts[name];
    if (bytes === undefined || bytes.byteLength === 0) continue;
    const key = storageKey({ orgId: input.orgId, artifactId, versionNumber, fileName: name });
    const mime = mimeFor(input.source, name);
    if (written.length === 0) primaryMime = mime;

    try {
      await store.putOnce(key, bytes, mime);
    } catch (e) {
      // A taken key means a version number was reused, i.e. two writers raced on the head.
      // Still NOT retried under a new number here: choosing the new number is the pin path's
      // optimistic-concurrency decision, and guessing at it from two places is how two
      // versions end up claiming to be v2. F05 gave it a distinguishable type so that path
      // can map it to VERSION_CHANGED without string-matching.
      if (e instanceof ObjectExistsError) throw new VersionKeyTakenError(e.message);
      if (e instanceof ObjectStoreUnavailableError) throw new DependencyUnavailableError(e.message);
      throw e;
    }

    // Read back. See the header: this is where the hash claim is earned rather than assumed.
    const back = await store.get(key);
    if (back === null || back.byteLength === 0) {
      throw new MaterializationFailedError(`object ${key} is not readable after write`);
    }
    verifyContentHash(key, computeContentHash(bytes), back);

    written.push(key);
    hashes.push(computeContentHash(back));
    totalBytes += back.byteLength;
  }

  if (written.length === 0) {
    // Unreachable given the `missing` check, and asserted anyway: I-5 is "every version has
    // a real downloadable file", and a version row written after zero objects is precisely
    // the state that makes it false.
    throw new MaterializationFailedError("nothing was materialized");
  }

  // One hash for the version, over the per-file hashes in plan order. A version is often
  // several files (survey = responses + schema), so hashing "the file" has no referent; the
  // ordered digest of the parts does, and it changes if any part changes.
  const contentHash = versionContentHash(hashes);

  await repo.createVersion({
    id: versionId,
    orgId: input.orgId,
    artifactId,
    versionNumber,
    // The first file is the version's addressable object; the others hang off the same
    // version prefix. `artifact_versions_uniq_key` makes reusing it across versions
    // impossible, which is the PG-side shadow of write-once.
    objectStorageKey: written[0]!,
    contentHash,
    mime: primaryMime,
    sizeBytes: totalBytes,
    pinnedBy: input.actorId,
    // No Context Pack yet: assembly is F09/F10. Recorded as null rather than as an empty
    // string so "there was none" stays distinguishable from "one was recorded and lost".
    contextPackId: null,
    // F04 never derives what it materializes -- everything this module writes is an
    // original (F73's `derived_from`, migration `20260731153640_f73_recording_file_first`).
    derivedFrom: null,
    // F36: a version that lands STORED has the rest of the nine-state pipeline still ahead
    // of it -- queue the first step (`EXTRACTED`) in the SAME transaction as this INSERT.
    // Every other caller's `ingestionStatus` is undefined/`"READY"`, so this is `null` for
    // them and nothing gets queued behind an already-finished version.
    enqueueIngestionOutboxStep: input.ingestionStatus === "STORED" ? "EXTRACTED" : null,
    creatorKind: input.versionCreatorKind,
    agentRunId: input.versionAgentRunId,
    changeSource: input.versionChangeSource,
  });

  return { artifactId, versionId, versionNumber, materializedKeys: written, contentHash };
}

/**
 * The plan's declared mime for a named part; octet-stream for anything the caller added.
 *
 * Reads the FULL plan, not `requiredFiles()`. Optional parts have declared mimes too, and
 * looking them up in the required subset would silently store an interview's audio as
 * `application/octet-stream` -- a downloaded file that no player opens.
 */
function mimeFor(source: ArtifactSource, name: string): string {
  const planned = MATERIALIZATION_PLAN[source].find((f) => f.name === name);
  return planned?.mime ?? "application/octet-stream";
}
