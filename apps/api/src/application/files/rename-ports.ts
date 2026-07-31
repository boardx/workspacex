/**
 * Ports for F34's contract-state pair: `renameArtifact` / `resolveArtifactAlias`
 * (uc-22-1 R7, N-23 / V11·22-1).
 *
 * Defined here, implemented by `infrastructure` (migration 0033's `artifact_aliases`).
 *
 * ## Rows still arrive as `Guarded<T>`
 *
 * Same doorway as F31/F32: an artifact's CURRENT name is content, not routing metadata, and
 * both operations here eventually hand it back to the caller (`aliasFrom`/`aliasTo`,
 * `currentPath`). Reading it straight off `artifacts.title` with no decision attached is
 * exactly the bypass `lint-permission-paths.mjs` exists to catch -- and rightly: an alias
 * resolver that ignores per-artifact visibility would let anyone with a stale link recover
 * the current name of a team-only file they were never granted access to.
 *
 * `artifactId` / `projectId` sit OUTSIDE the `Guarded` wrapper for the same chicken-and-egg
 * reason `download-ports.ts`'s `VisibleVersionLookup` gives: `authorize()` needs to know
 * which project layer to judge, but the caller only supplies an id or a path, so those two
 * facts have to come out of the row BEFORE the row has been judged.
 */
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

/** The content half -- what a rename/resolve response eventually discloses. */
export interface RenamableArtifact {
  readonly currentName: string;
}

export interface RenamableArtifactLookup {
  readonly artifactId: string;
  readonly projectId: string | null;
  readonly artifact: Guarded<RenamableArtifact>;
}

export interface NewArtifactAlias {
  readonly id: string;
  readonly orgId: OrgId;
  readonly projectId: string | null;
  readonly artifactId: string;
  readonly oldName: string;
  readonly reason: string;
  readonly changedBy: string;
}

export interface ArtifactRenameRepository {
  /**
   * Null when the artifact does not exist OR the requester may not see it through
   * `wsx_visible_artifacts()` -- deliberately indistinguishable (N-25 collapses both into
   * `ARTIFACT_NOT_FOUND` at the use-case layer), same shape as F32's `findVisibleVersion`.
   */
  findRenamable(input: {
    readonly orgId: OrgId;
    readonly artifactId: string;
    readonly requesterTeamId: string | null;
  }): Promise<RenamableArtifactLookup | null>;

  /**
   * Insert the alias row (the artifact's name AS IT WAS, right before this call) and rename
   * the artifact, atomically. One transaction: a rename that recorded the alias but did not
   * take effect (or the reverse) is exactly the state N-23 exists to make impossible -- a
   * changelog entry pointing at a name the artifact was never actually given, or a live
   * rename with no trail backing it.
   */
  renameAndAlias(input: NewArtifactAlias & { readonly newName: string }): Promise<void>;

  /**
   * `path` is CURRENT ⟺ some artifact VISIBLE to this requester in this project is named
   * exactly that right now. Checked first in `resolveArtifactAlias`: a name that was never
   * renamed away from has no alias row at all, and that must resolve rather than 404.
   */
  findByCurrentName(input: {
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly requesterTeamId: string | null;
    readonly name: string;
  }): Promise<Guarded<{ artifactId: string }> | null>;

  /**
   * The most recent alias row naming `oldName` in this project whose artifact is still
   * VISIBLE to this requester, or null. "Most recent" is what makes a rename-back-and-forth
   * (A -> B -> A) resolve correctly: two rows both say `old_name = 'A'`, and only the latest
   * is the one whose target is still valid to look up a current name for.
   */
  findLatestAlias(input: {
    readonly orgId: OrgId;
    readonly projectId: string;
    readonly requesterTeamId: string | null;
    readonly oldName: string;
  }): Promise<Guarded<{ artifactId: string }> | null>;

  /**
   * The artifact's name RIGHT NOW -- what `resolveArtifactAlias.out.currentPath` reports.
   * Null when the artifact no longer exists or is no longer visible to this requester
   * (the artifact an alias points at may have been deleted or rescoped since).
   */
  currentName(input: {
    readonly orgId: OrgId;
    readonly artifactId: string;
    readonly requesterTeamId: string | null;
  }): Promise<Guarded<{ currentName: string }> | null>;
}

export const ARTIFACT_RENAME_REPOSITORY = Symbol("ArtifactRenameRepository");
