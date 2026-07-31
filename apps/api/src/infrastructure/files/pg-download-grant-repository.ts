/**
 * PostgreSQL implementation of F32's delivery reads and the download grant (migration 0027).
 *
 * Dependency inversion: this file imports the application-layer port in order to implement it.
 *
 * ## The version lookup goes through `wsx_visible_artifacts()` -- the SAME predicate as F31
 *
 * Not a copy of it, not a re-derivation of the scope rule in a second place: the same function
 * call. That is what makes 「浏览器里看不见的版本也预览不了、下载不了」 a property of there
 * being one predicate rather than a rule somebody has to remember when adding the third reader.
 * `preview-five-types.test.ts` neuters the function inside a rolled-back transaction and
 * requires the forbidden version to stop resolving.
 *
 * ## Tenant scoping is doubled on purpose
 *
 * `withTenant` sets `app.current_org` (RLS, the first line) and every query also carries an
 * explicit `org_id = $1` (the second). Same convention as `pg-artifact-browser-repository.ts`:
 * RLS is the guarantee, the predicate is the thing a reader can see.
 */
import type { DatabasePort, TenantSession } from "../../application/ports/database.port";
import type {
  ConsumedDownloadGrant,
  DeliverableVersion,
  DownloadGrantRepository,
  NewDownloadGrant,
  RedeemFailure,
  VisibleVersionLookup,
} from "../../application/files/download-ports";
import type { IngestionStatus } from "../../domain/files/ingestion-visibility";
import { guard } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";

interface VersionRow {
  version_id: string;
  artifact_id: string;
  project_id: string | null;
  object_storage_key: string;
  mime: string;
  size_bytes: string | number;
  content_hash: string;
  ingestion_status: string;
}

interface GrantRow {
  id: string;
  artifact_id: string;
  version_id: string;
  object_key: string;
  permission_decision_id: string;
  purpose: string;
  consumed_at: Date;
}

/** `size_bytes` is `bigint`; node-postgres hands bigints back as strings. */
const toNumber = (v: string | number): number => (typeof v === "number" ? v : Number(v));

export class PgDownloadGrantRepository implements DownloadGrantRepository {
  constructor(private readonly db: DatabasePort) {}

  async findVisibleVersion(input: {
    orgId: OrgId;
    versionId: string;
    requesterTeamId: string | null;
  }): Promise<VisibleVersionLookup | null> {
    const row = await this.db.withTenant(input.orgId, async (s) => {
      const r = await s.query<VersionRow>(
        `SELECT av.id AS version_id, a.id AS artifact_id, a.project_id,
                av.object_storage_key, av.mime, av.size_bytes, av.content_hash,
                a.ingestion_status
           FROM artifact_versions av
           JOIN artifacts a ON a.id = av.artifact_id AND a.org_id = av.org_id
           -- 🔴 The row gate, in SQL, once. a.project_id is passed to the predicate rather
           -- than the caller supplying a project: the caller only has a version id, and
           -- letting it name the project would let it name a DIFFERENT project's predicate.
           -- (A function call in FROM is implicitly LATERAL, so the reference to a is legal.)
           --
           -- ⚠ Consequence, stated: an artifact with project_id IS NULL resolves to zero
           --   rows, because the predicate's WHERE a.project_id = p_project_id never matches
           --   NULL. So an UNBOUND artifact cannot be previewed or downloaded through F32.
           --   That is fail-closed and it is the same set F31's browser shows (project-scoped),
           --   which is the point -- but it is a real limitation, not an oversight, and it is
           --   pinned by a test rather than left for someone to discover as a 404.
           JOIN wsx_visible_artifacts(a.project_id, $3) vis ON vis.artifact_id = a.id
          WHERE av.org_id = $1 AND av.id = $2`,
        [input.orgId, input.versionId, input.requesterTeamId],
      );
      return r.rows[0] ?? null;
    });
    if (!row) return null;

    const payload: DeliverableVersion = {
      versionId: row.version_id,
      artifactId: row.artifact_id,
      projectId: row.project_id,
      objectKey: row.object_storage_key,
      mime: row.mime,
      sizeBytes: toNumber(row.size_bytes),
      contentHash: row.content_hash,
      ingestionStatus: row.ingestion_status as IngestionStatus,
    };
    return {
      artifactId: row.artifact_id,
      projectId: row.project_id,
      version: guard({ kind: "artifact", id: row.artifact_id }, payload),
    };
  }

  async issue(g: NewDownloadGrant): Promise<void> {
    await this.db.withTenant(g.orgId, async (s) => {
      await s.query(
        `INSERT INTO download_grants
           (id, org_id, artifact_id, version_id, object_key, principal_user_id,
            permission_decision_id, purpose, token_hash, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          g.id, g.orgId, g.artifactId, g.versionId, g.objectKey, g.principalUserId,
          g.permissionDecisionId, g.purpose, g.tokenHash, g.expiresAt.toISOString(),
        ],
      );
    });
  }

  /**
   * 🔴 The whole feature, in one statement.
   *
   * ## Read the WHERE clause -- every condition is in it
   *
   *   `token_hash = $2`            the credential
   *   `consumed_at IS NULL`        ONE-TIME
   *   `expires_at > now()`         SHORT-LIVED
   *   `principal_user_id = $3`     BOUND TO PRINCIPAL (a forwarded link is worthless)
   *   `org_id = $1` + RLS          the tenant
   *
   * None of these is checked before the statement, and none may ever be. A pre-check makes
   * the one-time property a lie under concurrency: two requests both SELECT `consumed_at IS
   * NULL`, both pass, both UPDATE, both download -- silently, with no exception and nothing in
   * the logs. That exact shape was found in F15's invite redemption. What makes the single
   * statement correct is row-level locking: the second transaction blocks on the row, and when
   * the first commits, PostgreSQL RE-EVALUATES the WHERE against the new version of the row,
   * finds `consumed_at` no longer NULL, and updates zero rows.
   *
   * ⇒ **Zero rows updated is the refusal.** Deleting `AND consumed_at IS NULL` from this
   *   clause must make `download-url-short-lived-onetime.test.ts` go red; that counter-proof
   *   is the only thing separating this from a comment claiming atomicity.
   *
   * ## The classification query runs ONLY on the failure path
   *
   * The contract distinguishes `DOWNLOAD_URL_EXPIRED` from `DOWNLOAD_URL_CONSUMED`, and a
   * zero-row UPDATE cannot say which. So a second, read-only SELECT runs AFTER the
   * authoritative decision has already been made, purely to name the failure. It cannot grant
   * anything -- it does not touch `consumed_at`, and its result is only ever mapped to an
   * error code. Ordering is the entire safety argument here: a classifier that ran FIRST would
   * be the pre-check this method exists to avoid.
   */
  async consume(
    input: { orgId: OrgId; tokenHash: string; principalUserId: string },
    onConsumed: (session: TenantSession, grant: ConsumedDownloadGrant) => Promise<void>,
  ): Promise<{ grant: ConsumedDownloadGrant } | { failure: RedeemFailure }> {
    return this.db.withTenant(input.orgId, async (s) => {
      const updated = await s.query<GrantRow>(
        `UPDATE download_grants
            SET consumed_at = now(), consumed_by = $3
          WHERE org_id = $1
            AND token_hash = $2
            AND consumed_at IS NULL
            AND expires_at > now()
            AND principal_user_id = $3
      RETURNING id, artifact_id, version_id, object_key, permission_decision_id, purpose,
                consumed_at`,
        [input.orgId, input.tokenHash, input.principalUserId],
      );

      const row = updated.rows[0];
      if (row) {
        const grant: ConsumedDownloadGrant = {
          id: row.id,
          artifactId: row.artifact_id,
          versionId: row.version_id,
          objectKey: row.object_key,
          permissionDecisionId: row.permission_decision_id,
          purpose: row.purpose as ConsumedDownloadGrant["purpose"],
          consumedAt: row.consumed_at.toISOString(),
        };
        // Inside THIS transaction. If the audit write throws, the consumption rolls back with
        // it -- there is no path to "the bytes were released and nothing recorded it".
        await onConsumed(s, grant);
        return { grant };
      }

      return { failure: await this.classify(s, input) };
    });
  }

  /** Diagnosis only. See `consume`: this runs after the refusal, never before it. */
  private async classify(
    s: TenantSession,
    input: { orgId: OrgId; tokenHash: string; principalUserId: string },
  ): Promise<RedeemFailure> {
    const r = await s.query<{ consumed: boolean; expired: boolean }>(
      `SELECT (consumed_at IS NOT NULL) AS consumed, (expires_at <= now()) AS expired
         FROM download_grants
        WHERE org_id = $1 AND token_hash = $2 AND principal_user_id = $3`,
      [input.orgId, input.tokenHash, input.principalUserId],
    );
    const row = r.rows[0];
    // No row for THIS principal: never existed, another tenant's, or issued to somebody else.
    // One answer for all three -- telling a holder of a forwarded link that it is real and
    // merely not theirs is information they did not have.
    if (!row) return "not-found";
    // Consumed wins over expired when both are true: 「用过了」 is the more specific and more
    // actionable fact, and a link that was used and then aged out is not an expiry story.
    if (row.consumed) return "consumed";
    if (row.expired) return "expired";
    // Neither, yet the UPDATE matched nothing. Only reachable if a condition exists in the
    // UPDATE and not here -- report it as not-found rather than inventing a fourth code.
    return "not-found";
  }
}
