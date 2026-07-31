/**
 * PostgreSQL implementation of F33's two export ports.
 *
 * `PgExportContentRepository.visibleExportRows` joins `wsx_visible_artifacts()` -- the SAME
 * function `pg-artifact-browser-repository.ts` uses -- for the reason stated in
 * `export-ports.ts`'s header: an export must not be able to reach further than the browser
 * already can.
 *
 * `PgExportJobRepository` is a plain record store. There is no "queued -> running -> done"
 * state transition here because there is no worker; see `export-artifacts.ts`'s header.
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  ExportableRow,
  ExportContentRepository,
  ExportJobRecord,
  ExportJobRepository,
  ExportSelection,
  NewExportJob,
} from "../../application/files/export-ports";
import { guard, type Guarded } from "../../application/security/permission-filter";
import { UNSEGMENTED_KEY } from "../../domain/files/artifact-tree";
import type { OrgId } from "../../domain/org-id";

const VISIBLE = `
  FROM wsx_visible_artifacts($2, $3) vis
  JOIN artifacts a ON a.id = vis.artifact_id AND a.org_id = $1`;

const HEAD_VERSION = `
  JOIN LATERAL (
    SELECT av.version_number, av.object_storage_key, av.content_hash, av.mime
      FROM artifact_versions av
     WHERE av.artifact_id = a.id AND av.org_id = a.org_id
     ORDER BY av.version_number DESC
     LIMIT 1
  ) v ON true`;

interface Row {
  id: string;
  title: string;
  source: string;
  agenda_segment_id: string | null;
  confidential: boolean;
  version_number: number;
  object_storage_key: string;
  content_hash: string;
  mime: string;
}

function toGuarded(row: Row): Guarded<ExportableRow> {
  const record: ExportableRow = {
    artifactId: row.id,
    name: row.title,
    sourceType: row.source,
    agendaSegmentId: row.agenda_segment_id,
    confidential: row.confidential,
    versionNumber: row.version_number,
    objectKey: row.object_storage_key,
    contentHash: row.content_hash,
    mime: row.mime,
  };
  return guard<ExportableRow>({ kind: "artifact", id: row.id }, record);
}

export class PgExportContentRepository implements ExportContentRepository {
  constructor(private readonly db: DatabasePort) {}

  async visibleExportRows(input: {
    orgId: OrgId;
    projectId: string;
    requesterTeamId: string | null;
    selection: ExportSelection;
  }): Promise<readonly Guarded<ExportableRow>[]> {
    const { selection } = input;
    return this.db.withTenant(input.orgId, async (s) => {
      const r = await s.query<Row>(
        `SELECT a.id, a.title, a.source, a.agenda_segment_id, a.confidential,
                v.version_number, v.object_storage_key, v.content_hash, v.mime
         ${VISIBLE}
         ${HEAD_VERSION}
          WHERE ($4::text[] IS NULL OR a.id = ANY($4))
            AND (
              $4::text[] IS NOT NULL
              OR $5::text IS NULL
              OR a.source = $5
              OR a.agenda_segment_id = $5
              OR ($5 = $6 AND a.agenda_segment_id IS NULL)
            )
          ORDER BY a.id`,
        [
          input.orgId, input.projectId, input.requesterTeamId,
          selection.artifactIds === null ? null : [...selection.artifactIds],
          selection.treeNodeId,
          UNSEGMENTED_KEY,
        ],
      );
      return r.rows.map(toGuarded);
    });
  }
}

interface JobRow {
  id: string;
  project_id: string;
  status: string;
  item_count: number;
  download_url: string;
  expires_at: Date;
  failure_reason: string | null;
}

function toRecord(row: JobRow): ExportJobRecord {
  return {
    jobId: row.id,
    status: row.status as ExportJobRecord["status"],
    downloadUrl: row.download_url,
    expiresAt: row.expires_at.toISOString(),
    failureReason: row.failure_reason,
  };
}

export class PgExportJobRepository implements ExportJobRepository {
  constructor(private readonly db: DatabasePort) {}

  async saveDone(job: NewExportJob): Promise<void> {
    await this.db.withTenant(job.orgId, async (s) => {
      await s.query(
        `INSERT INTO export_jobs
           (id, org_id, project_id, requested_by, status, item_count, object_key,
            manifest_sha256, download_url, expires_at)
         VALUES ($1,$2,$3,$4,'done',$5,$6,$7,$8,$9)`,
        [
          job.jobId, job.orgId, job.projectId, job.requestedBy, job.itemCount,
          job.objectKey, job.manifestSha256, job.downloadUrl, job.expiresAt.toISOString(),
        ],
      );
    });
  }

  async findById(input: { orgId: OrgId; jobId: string }):
    Promise<{ readonly projectId: string; readonly job: ExportJobRecord } | null> {
    return this.db.withTenant(input.orgId, async (s) => {
      const r = await s.query<JobRow>(
        `SELECT id, project_id, status, item_count, download_url, expires_at, failure_reason
           FROM export_jobs WHERE org_id = $1 AND id = $2`,
        [input.orgId, input.jobId],
      );
      const row = r.rows[0];
      if (!row) return null;
      return { projectId: row.project_id, job: toRecord(row) };
    });
  }
}
