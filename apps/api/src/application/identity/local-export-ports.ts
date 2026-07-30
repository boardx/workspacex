/**
 * Ports for the export aperture (F17). Defined here, implemented by `infrastructure`.
 *
 * ## Why the commit is ONE port method and not four
 *
 * The obvious decomposition -- copy artifacts, copy versions, write the local audit event,
 * write the target audit event -- is the wrong one, and the reason is V11④: **两侧都写
 * provenance_events**, and an export whose audit did not land must not have happened.
 *
 * Four methods means four transactions, which means "the copy exists and the trail does not"
 * is a reachable state. Nothing would report it: the rows are there, the response is 200,
 * and the only way anyone finds out is by asking the audit surface a question it cannot
 * answer. So the port exposes the atom, and the implementation is one transaction that
 * re-points `app.current_org` between the two tenants (the same technique
 * `insertPersonalLocalOrg` uses, and legitimate for the same reason: the setting is
 * transaction-local).
 */
import type { OrgId } from "../../domain/org-id";
import type { Guarded } from "../security/permission-filter";

/** One version's worth of bytes, as the export needs to see it. */
export interface ExportableVersion {
  readonly versionId: string;
  readonly versionNumber: number;
  readonly objectStorageKey: string;
  readonly contentHash: string;
  readonly mime: string;
  readonly sizeBytes: number;
}

/** An artifact that really exists in the local organization and can be copied out. */
export interface ExportableArtifact {
  readonly artifactId: string;
  readonly title: string;
  readonly source: string;
  readonly synthesized: boolean;
  readonly versions: readonly ExportableVersion[];
}

/** Who, in the TARGET organization, would end up able to see a copied item. */
export interface ExportVisibilitySubject {
  readonly kind: string;
  readonly id: string;
  readonly name: string;
}

/** The token as it comes back out of a successful single-use consume. */
export interface ConsumedPreview {
  readonly toOrgId: string;
  readonly artifactIds: readonly string[];
  readonly issuedAtMs: number;
}

/** What a commit is asked to write. Ids and keys are decided BEFORE the bytes move. */
export interface ExportPlanItem {
  readonly sourceArtifactId: string;
  readonly targetArtifactId: string;
  readonly title: string;
  readonly source: string;
  readonly synthesized: boolean;
  readonly versions: readonly {
    readonly sourceVersionId: string;
    readonly targetVersionId: string;
    readonly versionNumber: number;
    readonly sourceObjectKey: string;
    readonly targetObjectKey: string;
    readonly contentHash: string;
    readonly mime: string;
    readonly sizeBytes: number;
  }[];
}

export interface ExportCommitResult {
  readonly localProvenanceEventId: string;
  readonly targetProvenanceEventId: string;
}

export interface LocalExportRepository {
  /**
   * The artifacts of `artifactIds` that actually exist in this local organization.
   *
   * ⚠ Absent ids are simply ABSENT, not an error -- the contract has no failure code for
   * "this artifact does not exist" (`KNOWN_CONTRACT_GAPS.C_F17_1`). The preview therefore
   * lists what is real, the token freezes exactly that, and an export naming anything else
   * fails as `EXPORT_PREVIEW_REQUIRED`, which is true: the confirmed preview does not cover
   * that request.
   */
  findExportable(
    fromLocalOrgId: OrgId,
    artifactIds: readonly string[],
  ): Promise<readonly Guarded<ExportableArtifact>[]>;

  /**
   * Who would see a freshly imported item in the target organization.
   *
   * ⚠ Computed from the TARGET's own membership and bindings, never from the local
   * organization's -- the whole question the preview answers is "and who gets to read this
   * once it is over there". Answering it with the source side's ACLs would show the user
   * their own reflection.
   */
  previewVisibility(toOrgId: OrgId): Promise<readonly ExportVisibilitySubject[]>;

  /**
   * Record one human confirmation. Returns the token and when it was issued.
   *
   * The direction rule is enforced by the database on this insert (migration 0016), so a
   * preview that points the wrong way cannot exist -- not even as a screen someone looked at.
   */
  createPreview(input: {
    readonly fromLocalOrgId: OrgId;
    readonly toOrgId: string;
    readonly actorId: string;
    readonly artifactIds: readonly string[];
  }): Promise<{ readonly token: string; readonly issuedAtMs: number }>;

  /**
   * Spend the token, atomically. `null` when it is absent, already spent, or not this
   * actor's.
   *
   * ⚠ A conditional UPDATE, not read-then-write. Two concurrent exports both reading "not
   * consumed" and both proceeding is the failure this shape exists to make impossible, and
   * it is invisible when it happens: two copies land, one confirmation was given.
   */
  consumePreview(
    fromLocalOrgId: OrgId,
    token: string,
    actorId: string,
  ): Promise<ConsumedPreview | null>;

  /**
   * The copies AND both audit events, or neither. See this file's header.
   *
   * `ownerDisplayId` is what the target-side mark names -- "来自成员 X 的本地组织". A mark
   * that does not say whose local organization is not attributable, and an unattributable
   * provenance note is the kind nobody acts on.
   */
  commitExport(input: {
    readonly fromLocalOrgId: OrgId;
    readonly toOrgId: OrgId;
    readonly actorId: string;
    readonly ownerDisplayId: string;
    readonly items: readonly ExportPlanItem[];
  }): Promise<ExportCommitResult>;
}

export const LOCAL_EXPORT_REPOSITORY = Symbol("LocalExportRepository");
