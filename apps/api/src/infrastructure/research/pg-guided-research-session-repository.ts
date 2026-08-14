import type { DatabasePort } from "../../application/ports/database.port";
import {
  InvalidGuidedResearchCollaboratorError,
  GuidedResearchCreateReplayMismatchError,
  type GuidedResearchBrief,
  GuidedResearchCheckpointConflictError,
  GuidedResearchDirectionsNotConfirmedError,
  type GuidedResearchDirection,
  type GuidedResearchOutlineSection,
  type GuidedResearchSession,
  type GuidedResearchSessionRepository,
  type GuardedGuidedResearchSession,
} from "../../application/research/guided-session-ports";
import type { OrgId } from "../../domain/org-id";
import { guard } from "../../application/security/permission-filter";

interface Row {
  id: string;
  title: string;
  tags: string[];
  brief: GuidedResearchBrief;
  brief_version: number;
  brief_confirmed_at: Date | string | null;
  directions: GuidedResearchSession["directions"];
  outline: GuidedResearchSession["outline"];
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

const COLUMNS = "g.id, g.title, g.tags, g.brief, g.brief_version, g.brief_confirmed_at, g.directions, g.outline, g.stage, g.resume_stage, g.progress, g.source_count, g.report_id, g.created_at, g.updated_at, g.owner_user_id";
const COLLABORATOR_PROJECTION = `EXISTS (
  SELECT 1 FROM guided_research_session_collaborators c
   WHERE c.org_id = g.org_id AND c.session_id = g.id AND c.user_id = $2
) AS is_collaborator`;

function project(row: Row): GuidedResearchSession {
  return {
    sessionId: row.id,
    title: row.title,
    tags: row.tags,
    brief: row.brief,
    briefVersion: row.brief_version,
    briefConfirmedAt: row.brief_confirmed_at === null ? null : new Date(row.brief_confirmed_at).toISOString(),
    directions: row.directions,
    outline: row.outline,
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

function sameBrief(left: GuidedResearchBrief, right: GuidedResearchBrief): boolean {
  return left.topic === right.topic
    && left.goal === right.goal
    && left.timeRange === right.timeRange
    && left.region === right.region
    && left.focus === right.focus;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left]) === JSON.stringify([...right]);
}

export class PgGuidedResearchSessionRepository implements GuidedResearchSessionRepository {
  constructor(private readonly db: DatabasePort) {}

  async create(input: {
    orgId: OrgId; ownerUserId: string; idempotencyKey: string;
    title: string; tags: readonly string[];
    collaboratorUserIds: readonly string[]; brief: GuidedResearchBrief;
  }): Promise<GuardedGuidedResearchSession> {
    return this.db.withTenant(input.orgId, async (session) => {
      if (input.collaboratorUserIds.length > 0) {
        const members = await session.query<{ user_id: string }>(
          `SELECT user_id FROM org_memberships WHERE org_id = $1 AND user_id = ANY($2::text[])`,
          [input.orgId, input.collaboratorUserIds],
        );
        if (members.rows.length !== input.collaboratorUserIds.length) {
          throw new InvalidGuidedResearchCollaboratorError();
        }
      }
      const inserted = await session.query<Row>(
        `INSERT INTO guided_research_sessions
           (id, org_id, owner_user_id, idempotency_key, title, tags, brief, brief_confirmed_at, stage, resume_stage, progress)
         VALUES ('grs_' || replace(gen_random_uuid()::text, '-', ''), $1, $2, $3, $4, $5::text[], $6::jsonb, now(), 'directions', 'directions', 20)
         ON CONFLICT (org_id, owner_user_id, idempotency_key) DO NOTHING
         RETURNING id, title, tags, brief, brief_version, brief_confirmed_at, directions, outline, stage, resume_stage, progress, source_count, report_id, created_at, updated_at, owner_user_id, false AS is_collaborator`,
        [input.orgId, input.ownerUserId, input.idempotencyKey, input.title, input.tags, JSON.stringify(input.brief)],
      );
      const row = inserted.rows[0] ?? (await session.query<Row>(
        `SELECT ${COLUMNS}, false AS is_collaborator FROM guided_research_sessions g
          WHERE g.org_id = $1 AND g.owner_user_id = $2 AND g.idempotency_key = $3`,
        [input.orgId, input.ownerUserId, input.idempotencyKey],
      )).rows[0];
      if (!row) throw new Error("guided research session idempotency replay disappeared");
      if (inserted.rows.length === 0) {
        const existingCollaborators = await session.query<{ user_id: string }>(
          `SELECT user_id FROM guided_research_session_collaborators
            WHERE org_id = $1 AND session_id = $2 ORDER BY user_id`,
          [input.orgId, row.id],
        );
        const requested = [...input.collaboratorUserIds].sort();
        const existing = existingCollaborators.rows.map((item) => item.user_id);
        if (row.title !== input.title || !sameStrings(row.tags, input.tags)
          || !sameBrief(row.brief, input.brief) || JSON.stringify(existing) !== JSON.stringify(requested)) {
          throw new GuidedResearchCreateReplayMismatchError();
        }
      }
      if (input.collaboratorUserIds.length > 0) {
        await session.query(
          `INSERT INTO guided_research_session_collaborators (session_id, org_id, user_id, added_by)
           SELECT $1, $2, unnest($3::text[]), $4
           ON CONFLICT (session_id, user_id) DO NOTHING`,
          [row.id, input.orgId, input.collaboratorUserIds, input.ownerUserId],
        );
      }
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

  private async mutateCheckpoint(input: {
    orgId: OrgId; viewerUserId: string; sessionId: string;
    mutation: "generate-directions" | "confirm-directions" | "generate-outline" | "confirm-outline";
    candidateVersion?: number; items: readonly GuidedResearchDirection[] | readonly GuidedResearchOutlineSection[];
  }): Promise<GuardedGuidedResearchSession | null> {
    return this.db.withTenant(input.orgId, async (session) => {
      const currentResult = await session.query<Row>(
        `SELECT ${COLUMNS}, ${COLLABORATOR_PROJECTION} FROM guided_research_sessions g
          WHERE g.org_id = $1 AND g.id = $3
            AND (g.owner_user_id = $2 OR ${COLLABORATOR_PROJECTION.replace(" AS is_collaborator", "")})
          FOR UPDATE`,
        [input.orgId, input.viewerUserId, input.sessionId],
      );
      const current = currentResult.rows[0];
      if (!current) return null;
      const now = new Date().toISOString();
      let directions = current.directions;
      let outline = current.outline;
      let stage = current.stage;
      let resumeStage = current.resume_stage;

      if (input.mutation === "generate-directions") {
        const version = Math.max(0, ...directions.versions.map((item) => item.version)) + 1;
        directions = { ...directions, candidateVersion: version, versions: [...directions.versions, { version, items: input.items as GuidedResearchDirection[], createdAt: now, confirmedAt: null }] };
      } else if (input.mutation === "confirm-directions") {
        if (directions.candidateVersion !== input.candidateVersion) throw new GuidedResearchCheckpointConflictError();
        const version = Math.max(0, ...directions.versions.map((item) => item.version)) + 1;
        directions = { candidateVersion: version, confirmedVersion: version, versions: [...directions.versions, { version, items: input.items as GuidedResearchDirection[], createdAt: now, confirmedAt: now }] };
        stage = "outline"; resumeStage = "outline";
      } else if (input.mutation === "generate-outline") {
        if (directions.confirmedVersion === null) throw new GuidedResearchDirectionsNotConfirmedError();
        const version = Math.max(0, ...outline.versions.map((item) => item.version)) + 1;
        outline = { ...outline, candidateVersion: version, versions: [...outline.versions, { version, items: input.items as GuidedResearchOutlineSection[], createdAt: now, confirmedAt: null }] };
      } else {
        if (outline.candidateVersion !== input.candidateVersion) throw new GuidedResearchCheckpointConflictError();
        const version = Math.max(0, ...outline.versions.map((item) => item.version)) + 1;
        outline = { candidateVersion: version, confirmedVersion: version, versions: [...outline.versions, { version, items: input.items as GuidedResearchOutlineSection[], createdAt: now, confirmedAt: now }] };
      }
      const updated = await session.query<Row>(
        `UPDATE guided_research_sessions g SET directions = $4::jsonb, outline = $5::jsonb,
           stage = $6, resume_stage = $7, updated_at = now()
         WHERE g.org_id = $1 AND g.id = $3
           AND (g.owner_user_id = $2 OR ${COLLABORATOR_PROJECTION.replace(" AS is_collaborator", "")})
         RETURNING id, title, brief, brief_version, brief_confirmed_at, directions, outline, stage, resume_stage,
           progress, source_count, report_id, created_at, updated_at, owner_user_id,
           ${COLLABORATOR_PROJECTION}`,
        [input.orgId, input.viewerUserId, input.sessionId, JSON.stringify(directions), JSON.stringify(outline), stage, resumeStage],
      );
      return updated.rows[0] ? guarded(updated.rows[0]) : null;
    });
  }

  generateDirections(input: { orgId: OrgId; viewerUserId: string; sessionId: string; items: readonly GuidedResearchDirection[] }) {
    return this.mutateCheckpoint({ ...input, mutation: "generate-directions" });
  }
  confirmDirections(input: { orgId: OrgId; viewerUserId: string; sessionId: string; candidateVersion: number; items: readonly GuidedResearchDirection[] }) {
    return this.mutateCheckpoint({ ...input, mutation: "confirm-directions" });
  }
  generateOutline(input: { orgId: OrgId; viewerUserId: string; sessionId: string; items: readonly GuidedResearchOutlineSection[] }) {
    return this.mutateCheckpoint({ ...input, mutation: "generate-outline" });
  }
  confirmOutline(input: { orgId: OrgId; viewerUserId: string; sessionId: string; candidateVersion: number; items: readonly GuidedResearchOutlineSection[] }) {
    return this.mutateCheckpoint({ ...input, mutation: "confirm-outline" });
  }
}
