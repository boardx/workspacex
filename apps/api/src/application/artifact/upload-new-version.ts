/**
 * `uploadNewVersion` -- add a version to an EXISTING artifact from the file browser's
 * "上传新版本" action (uc-22-4 R3.a step 1, R3.a step 2 caption "变更来源: 上传",
 * contract's `uploadNewVersion`).
 *
 * ## What is here that `materializeArtifact` does not already do
 *
 *   1. **Idempotency (V2 / UC-22.2 A3)**: re-uploading content that hashes the SAME as the
 *      CURRENT head must not create a new version at all -- `duplicateHit: true`, the
 *      existing head's id and number are returned unchanged. This is checked BEFORE any
 *      write, off `listVersions`' own read path (no separate "get head hash" query -- one
 *      source for what the head's hash is, the version list and this check agree by
 *      construction because they are the same read).
 *   2. **Optimistic concurrency**, identical in shape to `pinVersion`'s (F05): the caller
 *      states the head it believes it is adding on top of, and a mismatch -- read at the
 *      precheck OR discovered at write time via a lost race -- is `VERSION_CHANGED`, never a
 *      silent extra version or a silent overwrite.
 *
 * ## Why old versions are untouched by construction, not by a check here
 *
 * This function only ever calls `materializeArtifact` with `versionNumber =
 * expectedHeadVersion + 1` -- an INSERT of a brand new row at a brand new number. It has no
 * code path that reads then rewrites `versionNumber <= expectedHeadVersion`. Combined with
 * `artifact_versions`' immutability trigger (0006) and the object store's write-once
 * `putOnce`, "旧版本对象保持原地不动" (R7 🔴) is true across three independent layers, not
 * asserted by this module alone.
 */
import { computeContentHash, versionContentHash } from "../../domain/artifact/content-hash";
import { VersionChangedError } from "./pin-version";
import {
  DuplicateVersionNumberError,
  type ArtifactSource,
} from "./ports";
import {
  VersionKeyTakenError,
  materializeArtifact,
  type MaterializeDeps,
} from "./materialize-artifact";
import type { OrgId } from "../../domain/org-id";

export interface UploadNewVersionInput {
  readonly orgId: OrgId;
  readonly artifactId: string;
  /** The head the caller believes it is adding on top of. Same semantics as `pinVersion`'s. */
  readonly expectedHeadVersion: number;
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly actorId: string;
  /**
   * WHO is uploading -- distinct per version (see `NewArtifactVersion.creatorKind`).
   * Defaults to `"user"`, same as the column default, because every route this reaches from
   * the file browser today is a human clicking "上传新版本"; an agent caller states it.
   */
  readonly creatorKind?: "user" | "agent";
  readonly agentRunId?: string | null;
  /**
   * The artifact's `ArtifactSource`, needed because `materializeArtifact`'s file plan is
   * keyed by it (`requiredFiles`/`mimeFor`). Not read from the database here: the file
   * browser's "上传新版本" action only ever targets browser-uploaded artifacts (`"upload"`
   * source, F35's `MATERIALIZATION_PLAN.upload` = one `original` part), so the caller states
   * it rather than this function silently assuming a value that could be wrong for a
   * Studio-materialized artifact it was never meant to touch.
   */
  readonly source?: ArtifactSource;
}

export interface UploadNewVersionResult {
  readonly versionId: string;
  readonly versionNumber: number;
  /** True when no new row was written -- the upload matched the current head byte-for-byte. */
  readonly duplicateHit: boolean;
}

export async function uploadNewVersion(
  deps: MaterializeDeps,
  input: UploadNewVersionInput,
): Promise<UploadNewVersionResult> {
  // (1) The pre-check, same shape as `pinVersion`'s: cheap, and avoids writing an object that
  // then has to be abandoned for the ordinary stale-client case.
  const versions = await deps.repo.listVersions(input.orgId, input.artifactId);
  const head = versions[0]; // `listVersions` orders newest-first; undefined iff no version yet.
  const headNumber = head?.versionNumber ?? 0;
  if (headNumber !== input.expectedHeadVersion) {
    throw new VersionChangedError(input.artifactId, input.expectedHeadVersion, headNumber);
  }

  // (2) Idempotency (V2): same bytes as the CURRENT head -> no new version, ever. Checked
  // against `head`, never against an older version -- re-uploading v1's content after v2 and
  // v3 exist is a legitimate new version (A1's "rollback = re-upload"), not a duplicate.
  //
  // `versionContentHash([computeContentHash(bytes)])`, not a bare `computeContentHash(bytes)`
  // -- a version's recorded hash is `materializeArtifact`'s digest OF the per-file hashes (see
  // that function and `versionContentHash`'s own comment), and this upload path always
  // produces exactly one file (`source: "upload"`'s single `original` part). Comparing a raw
  // file hash against a version hash would never match, and idempotency would silently never
  // fire -- every "duplicate" re-upload would mint a needless new version instead.
  if (head !== undefined && head.sha256 === versionContentHash([computeContentHash(input.bytes)])) {
    return { versionId: head.versionId, versionNumber: head.versionNumber, duplicateHit: true };
  }

  try {
    const r = await materializeArtifact(deps, {
      orgId: input.orgId,
      artifactId: input.artifactId,
      versionNumber: input.expectedHeadVersion + 1,
      projectId: null, // ignored: `materializeArtifact` only sets it when creating a NEW artifact.
      source: input.source ?? "upload",
      title: input.filename,
      actorId: input.actorId,
      parts: { original: input.bytes },
      versionCreatorKind: input.creatorKind,
      versionAgentRunId: input.agentRunId,
      versionChangeSource: "upload",
    });
    return { versionId: r.versionId, versionNumber: r.versionNumber, duplicateHit: false };
  } catch (e) {
    // Same two enforcement points as `pinVersion` -- see that module's header for why both
    // must map to the same user-facing outcome.
    if (e instanceof VersionKeyTakenError || e instanceof DuplicateVersionNumberError) {
      throw new VersionChangedError(input.artifactId, input.expectedHeadVersion, null);
    }
    throw e;
  }
}
