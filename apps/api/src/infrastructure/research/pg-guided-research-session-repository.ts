import type { DatabasePort } from "../../application/ports/database.port";
import type {
  GuidedResearchBrief,
  GuidedResearchSession,
  GuidedResearchSessionRepository,
  GuardedGuidedResearchSession,
} from "../../application/research/guided-session-ports";
import type { OrgId } from "../../domain/org-id";
import { guard } from "../../application/security/permission-filter";

interface Row {
  id: string;
  title: string;
  brief: GuidedResearchBrief;
  stage: GuidedResearchSession["stage"];
  resume_stage: GuidedResearchSession["resumeStage"];
  progress: number;
  source_count: number;
  report_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  owner_user_id: string;
  is_collaborator: boolean;
}

const COLUMNS = "g.id, g.title, g.brief, g.stage, g.resume_stage, g.progress, g.source_count, g.report_id, g.created_at, g.updated_at, g.owner_user_id";
const COLLABORATOR_PROJECTION = `EXISTS (
  SELECT 1 FROM guided_research_session_collaborators c
   WHERE c.org_id = g.org_id AND c.session_id = g.id AND c.user_id = $2
) AS is_collaborator`;

function project(row: Row): GuidedResearchSession {
  return {
    sessionId: row.id,
    title: row.title,
    brief: row.brief,
    stage: row.stage,
    resumeStage: row.resume_stage,
    status: row.stage === "report" ? "completed" : row.stage === "failed" ? "failed" : "active",
    progress: row.progress,
    sourceCount: row.source_count,
    reportId: row.report_id,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function guarded(row: Row): GuardedGuidedResearchSession {
  return {
    item: guard({ kind: "research", id: row.id }, project(row)),
    ownerUserId: row.owner_user_id,
    isExplicitCollaborator: row.is_collaborator,
  };
}

export class PgGuidedResearchSessionRepository implements GuidedResearchSessionRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(input: {
    orgId: OrgId; ownerUserId: string; idempotencyKey: string; brief: GuidedResearchBrief;
  }): Promise<GuardedGuidedResearchSession> {
    return this.db.withTenant(input.orgId, async (session) => {
      const inserted = await session.query<Row>(
        `INSERT INTO guided_research_sessions
           (id, org_id, owner_user_id, idempotency_key, title, brief, stage, resume_stage, progress)
         VALUES ('grs_' || replace(gen_random_uuid()::text, '-', ''), $1, $2, $3, $4, $5::jsonb, 'directions', 'directions', 20)
         ON CONFLICT (org_id, owner_user_id, idempotency_key) DO NOTHING
         RETURNING id, title, brief, stage, resume_stage, progress, source_count, report_id, created_at, updated_at, owner_user_id, false AS is_collaborator`,
        [input.orgId, input.ownerUserId, input.idempotencyKey, input.brief.topic, JSON.stringify(input.brief)],
      );
      const row = inserted.rows[0] ?? (await session.query<Row>(
        `SELECT ${COLUMNS}, false AS is_collaborator FROM guided_research_sessions g
          WHERE g.org_id = $1 AND g.owner_user_id = $2 AND g.idempotency_key = $3`,
        [input.orgId, input.ownerUserId, input.idempotencyKey],
      )).rows[0];
      if (!row) throw new Error("guided research session idempotency replay disappeared");
      return guarded(row);
    });
  }

  async listVisible(orgId: OrgId, viewerUserId: string): Promise<readonly GuardedGuidedResearchSession[]> {
    return this.db.withTenant(orgId, async (session) => {
      const result = await session.query<Row>(
        `SELECT ${COLUMNS}, ${COLLABORATOR_PROJECTION} FROM guided_research_sessions g
          WHERE g.org_id = $1
            AND (g.owner_user_id = $2 OR ${COLLABORATOR_PROJECTION.replace(" AS is_collaborator", "")})
          ORDER BY g.updated_at DESC, g.id DESC`,
        [orgId, viewerUserId],
      );
      return result.rows.map(guarded);
    });
  }

  async findVisible(orgId: OrgId, viewerUserId: string, sessionId: string): Promise<GuardedGuidedResearchSession | null> {
    return this.db.withTenant(orgId, async (session) => {
      const result = await session.query<Row>(
        `SELECT ${COLUMNS}, ${COLLABORATOR_PROJECTION} FROM guided_research_sessions g
          WHERE g.org_id = $1 AND g.id = $3
            AND (g.owner_user_id = $2 OR ${COLLABORATOR_PROJECTION.replace(" AS is_collaborator", "")})`,
        [orgId, viewerUserId, sessionId],
      );
      return result.rows[0] ? guarded(result.rows[0]) : null;
    });
  }
}
