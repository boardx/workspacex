/**
 * `pinVersion` -- freeze the current content into a new immutable snapshot (uc-0-1 R3-3 / A2).
 *
 * "Pinning" adds a version. It never edits one. Everything downstream of a pin -- a decision
 * citing evidence, a report's final draft, a graph write-back -- is anchored to the version
 * number this returns, and D-30 says those anchors do not move. So the only correction
 * available for a bad snapshot is another snapshot, and this module has no path that writes
 * to an existing row: it delegates the write to `materializeArtifact`, which only ever
 * INSERTs, and the database refuses an UPDATE outright (0006) and now a DELETE too (0007).
 *
 * ## What is here that is not in `materializeArtifact`
 *
 * Optimistic concurrency, and only that. E4/V6: two people pinning the same artifact at the
 * same moment must produce ONE new version number, with the loser told the head moved rather
 * than silently overwriting or silently creating a second v2.
 *
 * ## Three ways to lose the race, and why all three are handled
 *
 *   1. `expectedHeadVersion` does not match the head we read.
 *      The polite case: the other writer finished before this one started. Caught before any
 *      bytes are written, so nothing is left behind.
 *
 *   2. The storage key for vN is taken (`VersionKeyTakenError`).
 *      Both writers read head=N-1, both computed N, and `putOnce` is write-once, so the
 *      second one's PUT is refused.
 *
 *   3. The version row for vN exists (`DuplicateVersionNumberError`).
 *      Same race, decided by `artifact_versions_uniq_number` instead. Reachable when the two
 *      writers do not collide in object storage first -- different part names, an ingested
 *      original alongside a Studio pin, or any future store whose keys are not derived from
 *      the version number alone.
 *
 * Only (1) is reachable by a check, and a check alone is what makes this look correct while
 * being wrong: `read head` then `write head+1` is check-then-act, and the window between them
 * is precisely where the concurrent pin lives. (2) and (3) are the enforcement; (1) exists so
 * that the ordinary case gets a clear answer without touching storage. Asserted separately,
 * because a test that only exercises (1) passes against an implementation with no enforcement
 * at all.
 *
 * ## Deliberately no controller
 *
 * `operations.pinVersion.in` is `{ artifactId, expectedHeadVersion }` -- no content of any
 * kind -- while `out` promises `contentHash` and `objectStorageKey` of freshly frozen bytes.
 * Contractually, "pin" freezes the artifact's mutable DRAFT BUFFER (domain.md: "the save
 * button only writes the draft buffer, pinVersion is what freezes it"), but no draft buffer
 * exists in the model: 0006 has no column for one, and F04's save path writes a version
 * directly. So there is nowhere for an HTTP handler to get bytes from.
 *
 * This is the same wall F04 hit at `saveDraft` (coherence 修订 D-2) and it is answered the
 * same way: the bytes enter through this use case's `parts`, and F05 ships no
 * `POST /artifacts/:artifactId/versions` route. Inventing a body shape would be a second
 * declaration of the request contract, which is the failure ADR-020 exists to prevent, and
 * inventing a draft-buffer table would be a second declaration of where content lives.
 * Reported rather than worked around.
 */
import type { OrgId } from "../../domain/org-id";
import {
  VersionKeyTakenError,
  materializeArtifact,
  type MaterializeDeps,
} from "./materialize-artifact";
import { DuplicateVersionNumberError, type ArtifactSource } from "./ports";

/**
 * The contract's `VERSION_CHANGED` (E4/V6).
 *
 * Carries both numbers so the interface layer can say "you were looking at v1, it is now v3"
 * -- R8 requires refresh / compare / re-pin as the offered next steps, and "compare" needs to
 * know against what. `actual` is null for the two cases detected at write time, where all
 * that is known is that somebody else got there first.
 */
export class VersionChangedError extends Error {
  constructor(
    readonly artifactId: string,
    readonly expected: number,
    readonly actual: number | null,
  ) {
    super(
      actual === null
        ? `the head of ${artifactId} moved while version ${expected + 1} was being written`
        : `expected head ${expected} of ${artifactId}, found ${actual}`,
    );
  }
}

export interface PinVersionInput {
  readonly orgId: OrgId;
  readonly artifactId: string;
  /**
   * The head the caller believes it is pinning on top of. 0 means "no version yet", which is
   * why it is `nonnegative` and not `positive` in the contract.
   */
  readonly expectedHeadVersion: number;
  readonly source: ArtifactSource;
  readonly title: string;
  readonly actorId: string;
  /** The content being frozen. See the header on why this is not an HTTP body. */
  readonly parts: Readonly<Record<string, Uint8Array>>;
}

/**
 * `operations.pinVersion.out`, plus the artifact id.
 *
 * Not `z.infer`red from the contract even though the four fields match it: the contract's
 * `out` is the HTTP response body, this is a use-case return value, and there is no route
 * between them (see the header). Deriving it would assert a link that does not exist yet.
 * `contract-response.test.ts` is where the two are checked against each other, and it will
 * cover this operation when the route it describes can exist.
 */
export interface PinVersionResult {
  readonly artifactId: string;
  readonly versionId: string;
  readonly versionNumber: number;
  readonly contentHash: string;
  readonly objectStorageKey: string;
}

export async function pinVersion(
  deps: MaterializeDeps,
  input: PinVersionInput,
): Promise<PinVersionResult> {
  // (1) The pre-check. Cheap, gives the better error, and keeps the ordinary stale-client
  // case from writing objects that then have to be abandoned.
  const head = await deps.repo.headVersionNumber(input.orgId, input.artifactId);
  if (head !== input.expectedHeadVersion) {
    throw new VersionChangedError(input.artifactId, input.expectedHeadVersion, head);
  }

  try {
    const r = await materializeArtifact(deps, {
      orgId: input.orgId,
      // Always supplied: pinning is always onto an artifact that exists. Omitting it would
      // make `materializeArtifact` mint a new one, and the caller would get back a version
      // of something else with no indication anything went wrong.
      artifactId: input.artifactId,
      // The number this pin CLAIMED, not "the next free one". Without it the pre-check above
      // is decorative: the loser of a race re-reads the head inside `materializeArtifact`,
      // finds the winner's version already there, and succeeds at the number after it --
      // recording a snapshot as succeeding a version its author never saw, and never raising
      // VERSION_CHANGED at all. That is what actually happened before this argument existed.
      versionNumber: input.expectedHeadVersion + 1,
      projectId: null,
      source: input.source,
      title: input.title,
      actorId: input.actorId,
      parts: input.parts,
    });
    return {
      artifactId: r.artifactId,
      versionId: r.versionId,
      versionNumber: r.versionNumber,
      contentHash: r.contentHash,
      objectStorageKey: r.materializedKeys[0]!,
    };
  } catch (e) {
    // (2) and (3): the two enforcement points. Both mean the same thing to a user and both
    // must, because which one fires depends on whether the object store or the unique index
    // was reached first -- an implementation detail no user can act on.
    //
    // ⚠ `VersionKeyTakenError` is checked FIRST because it extends `MaterializationFailedError`.
    // Reordering these two silently turns every lost race back into MATERIALIZATION_FAILED.
    if (e instanceof VersionKeyTakenError || e instanceof DuplicateVersionNumberError) {
      throw new VersionChangedError(input.artifactId, input.expectedHeadVersion, null);
    }
    // Everything else keeps its own meaning and is rethrown untouched. MATERIALIZATION_FAILED
    // and DEPENDENCY_UNAVAILABLE are separate codes in the contract precisely because one
    // says "this will never work" and the other says "retry is safe".
    throw e;
  }
}
