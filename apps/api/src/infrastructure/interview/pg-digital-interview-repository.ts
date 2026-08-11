import type { DatabasePort } from "../../application/ports/database.port";
import type {
  CreateDigitalInterviewRecordInput,
  DigitalInterviewRepository,
  StoredDigitalInterview,
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
  project_id: string | null;
  is_collaborator: boolean;
}

const COLUMNS = `id, org_id, title, tags, topic, digital_status,
  source_quick_interview_id, selected_expert_ids, report_id, version, created_by`;

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
}
