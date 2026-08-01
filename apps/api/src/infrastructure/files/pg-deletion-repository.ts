/**
 * PostgreSQL implementation of F45's delete-impact / cascade-invalidation / task ports
 * (migration `20260801190000_f45_deletion_cascade.sql`).
 *
 * ## Every content read goes through `wsx_visible_artifacts()` -- the SAME predicate as F31/
 * F32/F34, now with `deleted_at IS NULL` folded in (see the migration's header)
 *
 * `findDeletable` joins it exactly the way `pg-artifact-rename-repository.ts` does, so an
 * artifact already logically deleted (or never visible to this requester) answers
 * `ARTIFACT_NOT_FOUND` uniformly -- N-25, and it is also what makes `requestDeletion` on an
 * already-deleted artifact idempotent-safe rather than a second cascade racing the first.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type { CascadeResultEntry } from "../../domain/files/deletion-cascade";
import type {
  CascadeInvalidationInput,
  CascadeInvalidationRepository,
  DeletableArtifactLookup,
  DeleteImpactCounts,
  DeleteImpactRepository,
  DeletionTaskRepository,
  DeletionTaskRow,
  LegalHoldGate,
  NewDeletionTask,
} from "../../application/files/deletion-ports";
import { guard } from "../../application/security/permission-filter";
import type { OrgId } from "../../domain/org-id";

export class PgDeleteImpactRepository implements DeleteImpactRepository {
  constructor(private readonly db: DatabasePort) {}

  async findDeletable(input: {
    orgId: OrgId;
    artifactId: string;
    requesterTeamId: string | null;
  }): Promise<DeletableArtifactLookup | null> {
    const row = await this.db.withTenant(input.orgId, async (s) => {
      const r = await s.query<{ id: string; project_id: string | null; title: string }>(
        `SELECT a.id, a.project_id, a.title
           FROM artifacts a
           JOIN wsx_visible_artifacts(a.project_id, $3) vis ON vis.artifact_id = a.id
          WHERE a.org_id = $1 AND a.id = $2`,
        [input.orgId, input.artifactId, input.requesterTeamId],
      );
      return r.rows[0] ?? null;
    });
    if (!row) return null;
    return {
      artifactId: row.id,
      projectId: row.project_id,
      artifact: guard({ kind: "artifact", id: row.id }, { title: row.title }),
    };
  }

  async countsFor(orgId: OrgId, artifactId: string): Promise<DeleteImpactCounts> {
    return this.db.withTenant(orgId, async (s) => {
      const versions = await s.query<{ id: string }>(
        `SELECT id FROM artifact_versions WHERE org_id = $1 AND artifact_id = $2`,
        [orgId, artifactId],
      );
      const versionIds = versions.rows.map((r) => r.id);

      const derived = await s.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM derived_representations
          WHERE org_id = $1 AND derived_from = ANY($2::text[])`,
        [orgId, versionIds],
      );

      const segments = await s.query<{ id: string }>(
        `SELECT id FROM segments WHERE org_id = $1 AND artifact_version_id = ANY($2::text[])`,
        [orgId, versionIds],
      );
      const segmentIds = segments.rows.map((r) => r.id);

      const claims = segmentIds.length === 0
        ? { rows: [] as { id: string; statement: string }[] }
        : await s.query<{ id: string; statement: string }>(
            `SELECT DISTINCT c.id, c.statement
               FROM claims c
               JOIN claim_segments cs ON cs.claim_id = c.id AND cs.org_id = c.org_id
              WHERE c.org_id = $1 AND cs.segment_id = ANY($2::text[])`,
            [orgId, segmentIds],
          );

      // F32's `download_grants` is explicitly the "已导出到组织外" data source (see that
      // table's own header comment, migration 0027) -- one consumed export-purpose grant is
      // one item that left the organization. There is no artifact-level linkage on the
      // BATCH zip path (`export_jobs` records only an item COUNT, not which artifact ids),
      // so this reports the single-file export path only; a documented gap, not a silent one.
      const exported = await s.query<{ id: string; consumed_at: Date; consumed_by: string }>(
        `SELECT id, consumed_at, consumed_by FROM download_grants
          WHERE org_id = $1 AND artifact_id = $2 AND purpose = 'export' AND consumed_at IS NOT NULL`,
        [orgId, artifactId],
      );

      const count = (r: { n: string }) => Number(r.n);
      return {
        versionCount: versionIds.length,
        derivedCount: count(derived.rows[0] ?? { n: "0" }),
        segmentCount: segmentIds.length,
        referencingClaims: claims.rows.map((c) => ({ id: c.id, label: c.statement })),
        referencingReportSections: [], // phase-01 has no report-section table; see the port's doc.
        exportedOutOfOrg: exported.rows.map((row) => ({
          jobId: row.id,
          exportedAt: row.consumed_at.toISOString(),
          exportedBy: row.consumed_by,
          itemCount: 1,
        })),
      };
    });
  }
}

export class PgLegalHoldGate implements LegalHoldGate {
  constructor(private readonly db: DatabasePort) {}

  async isActive(orgId: OrgId, artifactId: string): Promise<boolean> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query(
        `SELECT 1 FROM legal_holds WHERE org_id = $1 AND artifact_id = $2 AND released_at IS NULL`,
        [orgId, artifactId],
      );
      return r.rows.length > 0;
    });
  }
}

export class PgCascadeInvalidationRepository implements CascadeInvalidationRepository {
  constructor(private readonly db: DatabasePort) {}

  async invalidateLocalCascades(input: CascadeInvalidationInput): Promise<{
    results: readonly CascadeResultEntry[];
    versionIds: readonly string[];
    segmentIds: readonly string[];
  }> {
    const { orgId, artifactId } = input;
    return this.db.withTenant(orgId, async (s) => {
      const versions = await s.query<{ id: string }>(
        `SELECT id FROM artifact_versions WHERE org_id = $1 AND artifact_id = $2`,
        [orgId, artifactId],
      );
      const versionIds = versions.rows.map((r) => r.id);

      // ① browser-entry: the ONE flag `wsx_visible_artifacts()` reads (V4·22-4).
      await s.query(`UPDATE artifacts SET deleted_at = now() WHERE org_id = $1 AND id = $2`, [
        orgId, artifactId,
      ]);

      const segments = versionIds.length === 0
        ? { rows: [] as { id: string }[] }
        : await s.query<{ id: string }>(
            `SELECT id FROM segments WHERE org_id = $1 AND artifact_version_id = ANY($2::text[])`,
            [orgId, versionIds],
          );
      const segmentIds = segments.rows.map((r) => r.id);

      // ② derived-files: no separate "queued" flag -- a derivative under a deleted artifact
      // IS the queue (joined at read time), same discipline the module's header explains.
      const derivedCount = versionIds.length === 0
        ? 0
        : (
            await s.query<{ n: string }>(
              `SELECT count(*)::text AS n FROM derived_representations
                WHERE org_id = $1 AND derived_from = ANY($2::text[])`,
              [orgId, versionIds],
            )
          ).rows[0]?.n ?? "0";

      // ③ pgvector: deleting the rows is immediate zero-recall, not eventual.
      if (segmentIds.length > 0) {
        await s.query(`DELETE FROM segment_embeddings WHERE org_id = $1 AND segment_id = ANY($2::text[])`, [
          orgId, segmentIds,
        ]);
      }

      // ④ FTS/segments: same reasoning for the full-text channel.
      if (segmentIds.length > 0) {
        await s.query(`DELETE FROM segment_text WHERE org_id = $1 AND segment_id = ANY($2::text[])`, [
          orgId, segmentIds,
        ]);
      }

      // ⑥ context-pack-cache: annotate NEXT TO the pack (`context_pack_invalidations`), never
      // mutate `context_packs` itself -- 0016's pin trigger refuses any UPDATE on a pinned run
      // (I-7), and treating pinned/unpinned packs differently here would be exactly the kind
      // of inconsistency that lets a pinned pack's cache silently outlive the artifact it
      // cites. Two independent ways a pack can reference this artifact: pinned directly to
      // one of its versions, or having recorded one of its segments as a candidate at
      // assembly time -- both land in the SAME table via the SAME insert shape.
      if (versionIds.length > 0) {
        await s.query(
          `INSERT INTO context_pack_invalidations (pack_id, org_id, reason)
           SELECT run_id, $1, 'F45: source artifact deleted (pinned snapshot)'
             FROM context_packs
            WHERE org_id = $1 AND pinned_snapshot_id = ANY($2::text[])
           ON CONFLICT (pack_id) DO NOTHING`,
          [orgId, versionIds],
        );
      }
      if (segmentIds.length > 0) {
        await s.query(
          `INSERT INTO context_pack_invalidations (pack_id, org_id, reason)
           SELECT run_id, $1, 'F45: source artifact deleted (recorded candidate)'
             FROM context_packs
            WHERE org_id = $1 AND recorded IS NOT NULL
              AND EXISTS (
                SELECT 1 FROM jsonb_array_elements(recorded -> 'candidates') c
                 WHERE c ->> 'segmentId' = ANY($2::text[])
              )
           ON CONFLICT (pack_id) DO NOTHING`,
          [orgId, segmentIds],
        );
      }

      const results: CascadeResultEntry[] = [
        { kind: "browser-entry", result: "ok", detail: null },
        { kind: "derived-files", result: "ok", detail: `${derivedCount} derived representation(s) queued` },
        { kind: "pgvector", result: "ok", detail: null },
        { kind: "fts-segments", result: "ok", detail: null },
        { kind: "context-pack-cache", result: "ok", detail: null },
      ];
      return { results, versionIds, segmentIds };
    });
  }
}

export class PgDeletionTaskRepository implements DeletionTaskRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(input: NewDeletionTask): Promise<void> {
    await this.db.withTenant(input.orgId, async (s) => {
      await s.query(
        `INSERT INTO deletion_tasks
           (id, org_id, artifact_id, requested_by, actor_kind, reason, scope, status,
            requested_at, logical_invalidation_deadline, physical_deletion_deadline)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          input.id, input.orgId, input.artifactId, input.requestedBy, input.actorKind,
          input.reason, input.scope, input.status, input.requestedAt,
          input.logicalInvalidationDeadline, input.physicalDeletionDeadline,
        ],
      );
      for (const r of input.cascadeResults) {
        await s.query(
          `INSERT INTO deletion_cascade_results (task_id, org_id, kind, result, detail)
           VALUES ($1,$2,$3,$4,$5)`,
          [input.id, input.orgId, r.kind, r.result, r.detail],
        );
      }
    });
  }

  async getTask(orgId: OrgId, taskId: string): Promise<DeletionTaskRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const t = await s.query<{
        id: string; artifact_id: string; status: DeletionTaskRow["status"];
        requested_at: Date; logical_invalidation_deadline: Date; physical_deletion_deadline: Date;
        receipt_id: string | null;
      }>(
        `SELECT id, artifact_id, status, requested_at, logical_invalidation_deadline,
                physical_deletion_deadline, receipt_id
           FROM deletion_tasks WHERE org_id = $1 AND id = $2`,
        [orgId, taskId],
      );
      const row = t.rows[0];
      if (!row) return null;
      const cascades = await s.query<{ kind: CascadeResultEntry["kind"]; result: CascadeResultEntry["result"]; detail: string | null }>(
        `SELECT kind, result, detail FROM deletion_cascade_results WHERE org_id = $1 AND task_id = $2`,
        [orgId, taskId],
      );
      return {
        taskId: row.id,
        artifactId: row.artifact_id,
        status: row.status,
        requestedAt: row.requested_at,
        logicalInvalidationDeadline: row.logical_invalidation_deadline,
        physicalDeletionDeadline: row.physical_deletion_deadline,
        receiptId: row.receipt_id,
        cascadeResults: cascades.rows,
      };
    });
  }
}
