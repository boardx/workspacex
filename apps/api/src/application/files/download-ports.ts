/**
 * F32 ports: preview metadata, and the download grant's two halves (issue / redeem).
 *
 * Defined here, implemented by `infrastructure`. Kept in their own file rather than added to
 * F31's `ports.ts` because they are a different concern -- F31 is 「哪些行你看得见」, F32 is
 * 「这一份字节能不能出去，出去了留没留痕」 -- and a single 300-line port file is how the two
 * end up sharing a repository that nobody can reason about.
 *
 * ## Rows still arrive as `Guarded<T>`
 *
 * Same doorway as F31 (`lint-permission-paths` / `permission-filter`). The per-row visibility
 * predicate is still `wsx_visible_artifacts()` in SQL and there is still no second filter in
 * TypeScript, for the reason F31's port file spells out at length: an application-side filter
 * makes 「谓词写错了」 and 「谓词根本没跑」 both invisible.
 */
import type { OrgId } from "../../domain/org-id";
import type { IngestionStatus } from "../../domain/files/ingestion-visibility";
import type { TenantSession } from "../ports/database.port";
import type { Guarded } from "../security/permission-filter";

/**
 * One version, as the delivery paths need it.
 *
 * `projectId` is here because both use cases need it to run the REQUESTER gate, and the
 * caller only has a `versionId`. It is nullable because `artifacts.project_id` is
 * (migration 0006: an artifact can exist before it is bound to a project).
 */
export interface DeliverableVersion {
  readonly versionId: string;
  readonly artifactId: string;
  readonly projectId: string | null;
  readonly objectKey: string;
  readonly mime: string;
  readonly sizeBytes: number;
  readonly contentHash: string;
  readonly ingestionStatus: IngestionStatus;
}

/**
 * The lookup's envelope.
 *
 * ⚠ `artifactId` and `projectId` sit OUTSIDE the `Guarded` wrapper, and that needs a reason.
 * `authorize()` has to be told which object and which project layer to judge -- but the caller
 * only supplies a `versionId`, so those two facts have to come out of the row BEFORE the row
 * has been judged. A genuine chicken-and-egg.
 *
 * They are safe to expose because they are **routing keys, not content**: an id the requester
 * already typed (transitively) and the project it hangs under. Everything a human would see --
 * name, size, mime, object key, ingestion state -- stays inside `version` and can only leave
 * through `discloseDecided`. `Guarded.ref` already works exactly this way for the same reason.
 *
 * The row gate has ALREADY run when this is non-null: `wsx_visible_artifacts()` is in the
 * query. So the pair leaks nothing about rows the requester may not see -- an invisible
 * version returns null, not an envelope with empty content.
 */
export interface VisibleVersionLookup {
  readonly artifactId: string;
  readonly projectId: string | null;
  readonly version: Guarded<DeliverableVersion>;
}

/** What `issueDownloadUrl` persists. `tokenHash`, never the token. */
export interface NewDownloadGrant {
  readonly id: string;
  readonly orgId: OrgId;
  readonly artifactId: string;
  readonly versionId: string;
  readonly objectKey: string;
  readonly principalUserId: string;
  readonly permissionDecisionId: string;
  readonly purpose: "download" | "export";
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

/** What a successful redemption hands back -- enough to serve the bytes and to audit it. */
export interface ConsumedDownloadGrant {
  readonly id: string;
  readonly artifactId: string;
  readonly versionId: string;
  readonly objectKey: string;
  readonly permissionDecisionId: string;
  readonly purpose: "download" | "export";
  readonly consumedAt: string;
}

/**
 * Why a redemption failed, when it failed.
 *
 * ⚠ These come from a DIAGNOSTIC query that runs **only after** the authoritative UPDATE
 * matched zero rows. They never grant anything. See `consume` below.
 */
export type RedeemFailure = "expired" | "consumed" | "not-found";

export interface DownloadGrantRepository {
  /**
   * The version, through the SAME `wsx_visible_artifacts()` predicate the browser uses.
   *
   * Null when it does not exist OR when the requester may not see it -- deliberately
   * indistinguishable (N-25). The contract's `previewArtifactVersion` / `issueDownloadUrl`
   * have no permission error code at all, which is that rule already baked into the signed
   * shape: both collapse into `ARTIFACT_NOT_FOUND`.
   */
  findVisibleVersion(input: {
    readonly orgId: OrgId;
    readonly versionId: string;
    readonly requesterTeamId: string | null;
  }): Promise<VisibleVersionLookup | null>;

  issue(grant: NewDownloadGrant): Promise<void>;

  /**
   * 🔴 Redeem, **in one statement**, with the audit write inside the same transaction.
   *
   * ## Every condition lives in the WHERE clause
   *
   * `token_hash = $ AND consumed_at IS NULL AND expires_at > now() AND principal_user_id = $`.
   * Zero rows updated is the refusal. The alternative -- SELECT, check `consumed_at` in
   * TypeScript, then UPDATE -- passes every single-threaded test and stops nobody: two
   * concurrent requests both read NULL, both pass the check, both update, both get the file.
   * No exception, no error, no log line. F15's agent found exactly that shape in the invite
   * redemption path.
   *
   * The test that separates the two designs is a CONCURRENT one, and it is in
   * `tests/files/download-url-short-lived-onetime.test.ts`.
   *
   * ## Why the audit write is a callback and not the caller's next line
   *
   * 「下载动作写 provenance_events」 has to mean *the byte release and the audit row are one
   * atom*. Written as `const g = await consume(...); await provenance.append(...)`, a crash or
   * a rollback between them yields a consumed grant with no trail -- and that is
   * indistinguishable from a download that never happened, which is precisely what the audit
   * exists to answer. So the writer runs inside the repository's transaction via
   * `ProvenanceWriter.appendWithin`; if it throws, the consumption rolls back with it.
   *
   * @param onConsumed runs INSIDE the consuming transaction, only when a row was consumed.
   */
  consume(
    input: {
      readonly orgId: OrgId;
      readonly tokenHash: string;
      readonly principalUserId: string;
    },
    onConsumed: (session: TenantSession, grant: ConsumedDownloadGrant) => Promise<void>,
  ): Promise<{ readonly grant: ConsumedDownloadGrant } | { readonly failure: RedeemFailure }>;
}

/**
 * Where a download URL points.
 *
 * A port because the contract requires an **isolated domain** for anything served as an
 * attachment, and 「主域」 is deployment configuration, not a constant this layer may know. It
 * also keeps the URL shape in one place: a second `${origin}/downloads/${token}` somewhere
 * would be the sixth instance of this repository's recurring 「同一事实两处」 failure.
 */
export interface DownloadUrlBuilder {
  build(token: string): string;
}

export const DOWNLOAD_GRANT_REPOSITORY = Symbol("DownloadGrantRepository");
export const DOWNLOAD_URL_BUILDER = Symbol("DownloadUrlBuilder");
