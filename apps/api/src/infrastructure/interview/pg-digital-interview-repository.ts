import type { DatabasePort } from "../../application/ports/database.port";
import type {
  CreateDigitalInterviewRecordInput,
  DigitalInterviewRepository,
  StoredDigitalInterview,
  StoredDigitalInterviewListItem,
  StoredDigitalExpert,
} from "../../application/interview/digital-interview-ports";
import type { DigitalInterviewStatusName } from "../../domain/interview/digital-interview";
import type { OrgId } from "../../domain/org-id";
import { guard } from "../../application/security/permission-filter";
import {
  INTERVIEW_VISIBILITY_FACT_COLUMNS,
  VISIBILITY_PREDICATE,
} from "./pg-interview-scope-repository";

interface DigitalInterviewRow {
  id: string;
  org_id: string;
  title: string;
  tags: string[];
  topic: string;
  digital_status: string;
  source_quick_interview_id: string | null;
  selected_expert_ids: string[];
  report_id: string | null;
  version: string;
  created_by: string;
  updated_at: Date | string;
  project_id: string | null;
  is_collaborator: boolean;
}

const COLUMNS = `id, org_id, title, tags, topic, digital_status,
  source_quick_interview_id, selected_expert_ids, report_id, version, created_by, updated_at`;

function toStored(row: DigitalInterviewRow): StoredDigitalInterview {
  return {
    interviewId: row.id,
    orgId: row.org_id as OrgId,
    name: row.title,
    tags: row.tags,
    topic: row.topic,
    status: row.digital_status as DigitalInterviewStatusName,
    sourceQuickInterviewId: row.source_quick_interview_id,
    selectedExpertIds: row.selected_expert_ids,
    reportId: row.report_id,
    version: Number(row.version),
    createdBy: row.created_by,
  };
}

function toListItem(row: DigitalInterviewRow): StoredDigitalInterviewListItem {
  return { ...toStored(row), updatedAt: new Date(row.updated_at).toISOString() };
}

export class PgDigitalInterviewRepository implements DigitalInterviewRepository {
  constructor(private readonly db: DatabasePort) {}

  async createDraft(input: CreateDigitalInterviewRecordInput): Promise<StoredDigitalInterview> {
    return this.db.withTenant(input.orgId, async (session) => {
      await session.query(
        `INSERT INTO interview_sessions
           (id, org_id, project_id, research_project_id, source_kind, title, created_by, tags,
            topic, digital_status, selected_expert_ids, version)
         VALUES ($1,$2,$3,$4,'virtual',$5,$6,$7,$8,'draft','{}',1)
        `,
        [
          input.interviewId,
          input.orgId,
          input.scope.projectId,
          input.scope.researchProjectId,
          input.name,
          input.actorId,
          [...input.tags],
          input.topic,
        ],
      );
      return {
        interviewId: input.interviewId,
        orgId: input.orgId,
        name: input.name,
        tags: input.tags,
        topic: input.topic,
        status: "draft",
        sourceQuickInterviewId: null,
        selectedExpertIds: [],
        reportId: null,
        version: 1,
        createdBy: input.actorId,
      };
    });
  }

  async findVisibleById(orgId: OrgId, viewerUserId: string, interviewId: string) {
    return this.db.withTenant(orgId, async (session) => {
      const result = await session.query<DigitalInterviewRow>(
        `SELECT ${COLUMNS}, s.project_id, ${INTERVIEW_VISIBILITY_FACT_COLUMNS}
           FROM interview_sessions s
          WHERE s.org_id = $1 AND s.id = $3 AND s.digital_status IS NOT NULL
            AND ${VISIBILITY_PREDICATE}`,
        [orgId, viewerUserId, interviewId],
      );
      const row = result.rows[0];
      return row === undefined
        ? null
        : {
            item: guard({ kind: "interview", id: row.id }, toStored(row)),
            facts: {
              projectId: row.project_id,
              createdBy: row.created_by,
              isExplicitCollaborator: row.is_collaborator,
            },
          };
    });
  }

  async updateStatus(input: {
    readonly orgId: OrgId;
    readonly interviewId: string;
    readonly expectedVersion: number;
    readonly fromStatus: DigitalInterviewStatusName;
    readonly toStatus: DigitalInterviewStatusName;
  }): Promise<void> {
    await this.db.withTenant(input.orgId, async (session) => {
      await session.query(
        `UPDATE interview_sessions
            SET digital_status = $1, version = version + 1, updated_at = now()
          WHERE org_id = $2 AND id = $3 AND digital_status = $4 AND version = $5`,
        [input.toStatus, input.orgId, input.interviewId, input.fromStatus, input.expectedVersion],
      );
    });
  }

  async listVisible(input: {
    readonly orgId: OrgId;
    readonly viewerUserId: string;
    readonly status?: DigitalInterviewStatusName;
  }) {
    return this.db.withTenant(input.orgId, async (session) => {
      const result = await session.query<DigitalInterviewRow>(
        `SELECT ${COLUMNS}, s.project_id, ${INTERVIEW_VISIBILITY_FACT_COLUMNS}
           FROM interview_sessions s
          WHERE s.org_id = $1 AND s.digital_status IS NOT NULL
            AND ($3::text IS NULL OR s.digital_status = $3)
            AND ${VISIBILITY_PREDICATE}
          ORDER BY s.updated_at DESC, s.id DESC`,
        [input.orgId, input.viewerUserId, input.status ?? null],
      );
      return result.rows.map((row) => ({
        item: guard({ kind: "interview", id: row.id }, toListItem(row)),
        facts: {
          projectId: row.project_id,
          createdBy: row.created_by,
          isExplicitCollaborator: row.is_collaborator,
        },
      }));
    });
  }

  async listVisibleExperts(input: {
    readonly orgId: OrgId;
    readonly viewerUserId: string;
    readonly domain?: string;
  }): Promise<readonly StoredDigitalExpert[]> {
    return this.db.withTenant(input.orgId, async (session) => {
      const result = await session.query<{
        id: string;
        initials: string;
        name: string;
        role: string;
        domains: string[];
        material_context_pack_id: string | null;
        material_version: string | null;
      }>(
        `SELECT a.id, a.initials, a.name, a.role, p.domains,
                p.material_context_pack_id, p.material_version
           FROM agents a
           JOIN capability_listings c
             ON c.org_id = a.org_id AND c.id = a.id AND c.kind = 'agent'
           JOIN digital_expert_profiles p
             ON p.org_id = a.org_id AND p.agent_id = a.id
          WHERE a.org_id = $1 AND a.status = 'enabled' AND a.publish_state = '运行中'
            AND c.enabled = true
            AND ($3::text IS NULL OR $3 = ANY(p.domains))
            AND (c.scope = 'org-wide' OR c.owner_team_id = (
              SELECT om.team_id FROM org_memberships om
               WHERE om.org_id = $1 AND om.user_id = $2
            ))
          ORDER BY a.name`,
        [input.orgId, input.viewerUserId, input.domain ?? null],
      );
      return result.rows.map((row): StoredDigitalExpert => ({
        expertId: row.id,
        initials: row.initials,
        displayName: row.name,
        role: row.role,
        domains: row.domains,
        materialContextPackId: row.material_context_pack_id,
        materialVersion: row.material_version,
      }));
    });
  }
}
