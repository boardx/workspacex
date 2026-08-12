import type { DatabasePort } from "../../application/ports/database.port";
import type {
  CreateDigitalInterviewRecordInput,
  DigitalInterviewRepository,
  StoredDigitalInterview,
  StoredDigitalInterviewListItem,
  StoredDigitalExpert,
  StoredDigitalInterviewSourceMaterial,
  StoredQuickInterview,
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
  quick_interview_id?: string | null;
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
  return { ...toStored(row), updatedAt: new Date(row.updated_at).toISOString(), kind: row.quick_interview_id ? "quick" : "batch" };
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
        `SELECT s.id, s.org_id, s.title, s.tags, s.topic, s.digital_status,
                s.source_quick_interview_id, s.selected_expert_ids, s.report_id,
                s.version, s.created_by, s.updated_at, s.project_id,
                q.interview_id AS quick_interview_id, ${INTERVIEW_VISIBILITY_FACT_COLUMNS}
           FROM interview_sessions s
           LEFT JOIN digital_quick_interviews q ON q.org_id=s.org_id AND q.interview_id=s.id
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
        `SELECT s.id, s.org_id, s.title, s.tags, s.topic, s.digital_status,
                s.source_quick_interview_id, s.selected_expert_ids, s.report_id,
                s.version, s.created_by, s.updated_at, s.project_id,
                q.interview_id AS quick_interview_id, ${INTERVIEW_VISIBILITY_FACT_COLUMNS}
           FROM interview_sessions s
           LEFT JOIN digital_quick_interviews q ON q.org_id=s.org_id AND q.interview_id=s.id
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

  async createQuick(input: { readonly orgId: OrgId; readonly interviewId: string; readonly actorId: string; readonly requestId: string; readonly expert: StoredDigitalExpert }): Promise<StoredQuickInterview> {
    return this.db.withTenant(input.orgId, async s => {
      await s.query("BEGIN");
      try {
        await s.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${input.orgId}:${input.requestId}`]);
        const existing = await s.query<{interview_id:string;expert_snapshot:StoredDigitalExpert;version:string}>(
          `SELECT q.interview_id,q.expert_snapshot,i.version FROM digital_quick_interviews q
             JOIN interview_sessions i ON i.org_id=q.org_id AND i.id=q.interview_id
            WHERE q.org_id=$1 AND q.start_request_id=$2`, [input.orgId,input.requestId]);
        if (existing.rows[0]) {
          const messages = await this.readQuickMessages(s, input.orgId, existing.rows[0].interview_id);
          await s.query("COMMIT");
          return { interviewId: existing.rows[0].interview_id, expert: existing.rows[0].expert_snapshot,
            messages, version: Number(existing.rows[0].version) };
        }
        await s.query(`INSERT INTO interview_sessions
          (id,org_id,source_kind,title,created_by,tags,topic,digital_status,selected_expert_ids,version)
          VALUES ($1,$2,'virtual',$3,$4,ARRAY['快捷访谈'],$5,'running',ARRAY[$6],1)`,
          [input.interviewId,input.orgId,`${input.expert.displayName} · 快捷访谈`,input.actorId,"快捷探索性对话",input.expert.expertId]);
        await s.query(`INSERT INTO digital_quick_interviews(org_id,interview_id,expert_snapshot,start_request_id) VALUES($1,$2,$3::jsonb,$4)`,
          [input.orgId,input.interviewId,JSON.stringify(input.expert),input.requestId]);
        await s.query("COMMIT"); return { interviewId: input.interviewId, expert: input.expert, messages: [], version: 1 };
      } catch (e) { await s.query("ROLLBACK"); throw e; }
    });
  }

  async loadQuick(orgId: OrgId, interviewId: string): Promise<StoredQuickInterview | null> {
    return this.db.withTenant(orgId, async s => {
      const header = await s.query<{ expert_snapshot: StoredDigitalExpert; version: string }>(
        `SELECT q.expert_snapshot, i.version FROM digital_quick_interviews q JOIN interview_sessions i
           ON i.org_id=q.org_id AND i.id=q.interview_id WHERE q.org_id=$1 AND q.interview_id=$2`, [orgId,interviewId]);
      if (!header.rows[0]) return null;
      const messages = await this.readQuickMessages(s, orgId, interviewId);
      return { interviewId, expert: header.rows[0].expert_snapshot, version:Number(header.rows[0].version),
        messages };
    });
  }

  async appendQuickExchange(input: { readonly orgId: OrgId; readonly interviewId: string; readonly expectedVersion: number; readonly userMessageId: string; readonly assistantMessageId: string; readonly question: string; readonly answer: string; readonly sourcePointers: readonly string[] }): Promise<void> {
    await this.db.withTenant(input.orgId, async s => {
      await s.query("BEGIN"); try {
        const updated=await s.query(`UPDATE interview_sessions SET version=version+1,updated_at=now()
          WHERE org_id=$1 AND id=$2 AND version=$3 RETURNING version`,[input.orgId,input.interviewId,input.expectedVersion]);
        if (!updated.rows[0]) throw new Error("CONCURRENT_MODIFICATION");
        const n=await s.query<{next:string}>(`SELECT COALESCE(max(ordinal),0)+1 AS next FROM digital_quick_messages WHERE org_id=$1 AND interview_id=$2`,[input.orgId,input.interviewId]);
        const ordinal=Number(n.rows[0]!.next);
        await s.query(`INSERT INTO digital_quick_messages(org_id,interview_id,id,ordinal,role,body,source_pointers) VALUES
          ($1,$2,$3,$4,'user',$5,'{}'),($1,$2,$6,$7,'assistant',$8,$9)`,[input.orgId,input.interviewId,input.userMessageId,ordinal,input.question,input.assistantMessageId,ordinal+1,input.answer,[...input.sourcePointers]]);
        await s.query("COMMIT");
      } catch(e){await s.query("ROLLBACK");throw e;}
    });
  }

  async convertQuick(input: { readonly orgId: OrgId; readonly sourceInterviewId: string; readonly interviewId: string; readonly actorId: string; readonly expectedVersion: number; readonly name: string; readonly tags: readonly string[]; readonly topic: string }) {
    return this.db.withTenant(input.orgId, async s => {
      await s.query("BEGIN");
      try {
        const source=await s.query<{expert_snapshot:StoredDigitalExpert;converted_interview_id:string|null}>(`SELECT q.expert_snapshot,q.converted_interview_id FROM digital_quick_interviews q JOIN interview_sessions i ON i.org_id=q.org_id AND i.id=q.interview_id WHERE q.org_id=$1 AND q.interview_id=$2 AND i.version=$3 FOR UPDATE OF q`,[input.orgId,input.sourceInterviewId,input.expectedVersion]);
        if(!source.rows[0]) throw new Error("CONCURRENT_MODIFICATION");
        if(source.rows[0].converted_interview_id){
          const existing=await s.query<DigitalInterviewRow>(`SELECT ${COLUMNS},project_id,false AS is_collaborator FROM interview_sessions WHERE org_id=$1 AND id=$2`,[input.orgId,source.rows[0].converted_interview_id]);
          const sourceMaterials=await this.readSourceMaterials(s,input.orgId,source.rows[0].converted_interview_id);
          await s.query("COMMIT"); return {...toStored(existing.rows[0]!),sourceMaterials};
        }
        const expert=source.rows[0].expert_snapshot;
        await s.query(`INSERT INTO interview_sessions(id,org_id,source_kind,title,created_by,tags,topic,digital_status,source_quick_interview_id,selected_expert_ids,version)
          VALUES($1,$2,'virtual',$3,$4,$5,$6,'draft',$7,ARRAY[$8],1)`,[input.interviewId,input.orgId,input.name,input.actorId,[...input.tags],input.topic,input.sourceInterviewId,expert.expertId]);
        await s.query(`UPDATE digital_quick_interviews SET converted_interview_id=$3 WHERE org_id=$1 AND interview_id=$2`,[input.orgId,input.sourceInterviewId,input.interviewId]);
        await s.query(`INSERT INTO digital_interview_source_materials
          (org_id,interview_id,source_quick_interview_id,source_message_id,ordinal,role,body,source_pointers)
          SELECT org_id,$3,interview_id,id,ordinal,role,body,source_pointers
            FROM digital_quick_messages WHERE org_id=$1 AND interview_id=$2 ORDER BY ordinal`,
          [input.orgId,input.sourceInterviewId,input.interviewId]);
        const sourceMaterials=await this.readSourceMaterials(s,input.orgId,input.interviewId);
        await s.query("COMMIT");
        return {interviewId:input.interviewId,orgId:input.orgId,name:input.name,tags:input.tags,topic:input.topic,status:"draft" as const,sourceQuickInterviewId:input.sourceInterviewId,selectedExpertIds:[expert.expertId],reportId:null,version:1,createdBy:input.actorId,sourceMaterials};
      } catch(e){await s.query("ROLLBACK");throw e;}
    });
  }

  private async readQuickMessages(session: {query<T>(sql:string,params?:readonly unknown[]):Promise<{rows:T[]}>}, orgId: OrgId, interviewId: string) {
    const messages = await session.query<{id:string;role:"user"|"assistant";body:string;source_pointers:string[];created_at:Date|string}>(
      `SELECT id,role,body,source_pointers,created_at FROM digital_quick_messages
        WHERE org_id=$1 AND interview_id=$2 ORDER BY ordinal`,[orgId,interviewId]);
    return messages.rows.map(m=>({messageId:m.id,role:m.role,text:m.body,sourcePointers:m.source_pointers,createdAt:new Date(m.created_at).toISOString()}));
  }

  private async readSourceMaterials(session: {query<T>(sql:string,params?:readonly unknown[]):Promise<{rows:T[]}>}, orgId: OrgId, interviewId: string): Promise<StoredDigitalInterviewSourceMaterial[]> {
    const materials=await session.query<{source_message_id:string;role:"user"|"assistant";body:string;source_pointers:string[]}>(
      `SELECT source_message_id,role,body,source_pointers FROM digital_interview_source_materials
        WHERE org_id=$1 AND interview_id=$2 ORDER BY ordinal`,[orgId,interviewId]);
    return materials.rows.map(row=>({sourceMessageId:row.source_message_id,role:row.role,text:row.body,sourcePointers:row.source_pointers}));
  }
}
