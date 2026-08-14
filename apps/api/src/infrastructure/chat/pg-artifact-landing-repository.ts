/**
 * `ArtifactLandingRepository` 的 PostgreSQL 实现（F114 · uc-8-3）。
 *
 * 同 `pg-chat-repository.ts` 的既有纪律：每个查询经 `withTenant`，本文件不做
 * 任何可见性/资格判定——那属于 `application/chat/land-as-artifact.ts` /
 * `check-downstream-eligibility.ts`。
 */
import type { DatabasePort } from "../../application/ports/database.port";
import type {
  ArtifactLandingRepository,
  ArtifactLandingRow,
  NewArtifactLanding,
} from "../../application/chat/artifact-landing-ports";
import type { LandingModeName } from "../../domain/chat/artifact-landing";
import type { OrgId } from "../../domain/org-id";

interface LandingDbRow {
  id: string;
  thread_id: string;
  message_id: string;
  artifact_id: string;
  version_id: string | null;
  title: string;
  mode: string;
  has_source: boolean;
  created_by: string;
  created_at: string;
}

function toRow(r: LandingDbRow): ArtifactLandingRow {
  return {
    id: r.id,
    threadId: r.thread_id,
    messageId: r.message_id,
    artifactId: r.artifact_id,
    versionId: r.version_id,
    title: r.title,
    mode: r.mode as LandingModeName,
    hasSource: r.has_source,
    createdBy: r.created_by,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const SELECT_COLUMNS = `id, thread_id, message_id, artifact_id, version_id, title, mode, has_source, created_by, created_at`;

export class PgArtifactLandingRepository implements ArtifactLandingRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(row: NewArtifactLanding): Promise<void> {
    await this.db.withTenant(row.orgId, (s) =>
      s.query(
        `INSERT INTO chat_artifact_landings
           (id, org_id, thread_id, message_id, artifact_id, version_id, title, mode,
            has_source, citation_count, created_by, content_excerpt)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          row.id, row.orgId, row.threadId, row.messageId, row.artifactId, row.versionId,
          row.title, row.mode, row.hasSource, row.citationCount, row.createdBy,
          // F155：写进来的这一刻，`search_tsv` 生成列就自动有了正文——落地即可检索。
          row.contentExcerpt,
        ],
      ),
    );
  }

  async findByArtifactId(orgId: OrgId, artifactId: string): Promise<ArtifactLandingRow | null> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<LandingDbRow>(
        `SELECT ${SELECT_COLUMNS} FROM chat_artifact_landings
          WHERE artifact_id = $1 AND org_id = $2`,
        [artifactId, orgId],
      );
      const row = r.rows[0];
      return row ? toRow(row) : null;
    });
  }

  async listByThread(orgId: OrgId, threadId: string): Promise<readonly ArtifactLandingRow[]> {
    return this.db.withTenant(orgId, async (s) => {
      const r = await s.query<LandingDbRow>(
        `SELECT ${SELECT_COLUMNS} FROM chat_artifact_landings
          WHERE thread_id = $1 AND org_id = $2
          ORDER BY created_at ASC`,
        [threadId, orgId],
      );
      return r.rows.map(toRow);
    });
  }
}
