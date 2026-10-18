import {resolveVisibility} from '../../application/chat/resolve-visibility';
import {guard,discloseDecided,isDisclosed} from '../../application/security/permission-filter';
import {PgChatRepository} from '../chat/pg-chat-repository';
import {PgIdentityRepository} from '../identity/pg-identity-repository';
import { randomUUID } from 'node:crypto';
import {ReportFileArtifactPolicy} from '@repo/contracts/native-artifact-publish';
import {REPORT_FILE_FORMATS} from '@repo/contracts/report-files';
import {reportFilePublication} from '../../application/report-files/publication';
import type {ToolExecutionCheck} from '../../application/agent-run/tool-execution-authority';
import { ReportFileJob } from '@repo/contracts/report-files';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import type { ReportFileActor } from '../../application/report-files/ports';
import type { ClaimedReportFileJob, ReportFileJobStore, ReportFileReuseKey, StoredReportFileJob } from '../../application/report-files/job-ports';
/** Tenant/actor filters on every access; request IDs cannot silently cross actor or tenant. */
export class PgReportFileJobStore implements ReportFileJobStore {
  constructor(private readonly db: DatabasePort) {}
  private parse(metadata: StoredReportFileJob): StoredReportFileJob { return { ...metadata, job: ReportFileJob.parse(metadata.job) }; }
  /** Internal dispatch constraint only: derive identity from the accepted message, never model args. */
  async artifactPolicyForRun(input:ToolExecutionCheck):Promise<ReportFileArtifactPolicy|null>{
    return this.db.withTenant(input.orgId,async s=>{
      const rows=await s.query<{metadata:StoredReportFileJob;actor_user_id:string;request_id:string;thread_id:string;skill_version_ids:string[];published:boolean}>(
       `SELECT j.metadata,j.actor_user_id,j.request_id::text,r.thread_id,r.skill_version_ids,
         EXISTS(SELECT 1 FROM native_output_staging n WHERE n.org_id=r.org_id AND n.run_id=r.id AND n.idempotency_key='report-file:'||j.request_id::text) AS published
        FROM agent_runs r JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id AND m.thread_id=r.thread_id AND m.author_kind='human'
        JOIN report_skill_file_jobs j ON j.org_id=r.org_id AND j.actor_user_id=m.author_id AND j.request_id=m.client_message_id
          AND j.metadata->>'threadId'=r.thread_id AND (j.metadata->>'runId'=r.id OR (j.metadata->>'runId' IS NULL AND j.lease_token IS NOT NULL AND j.lease_until>now()))
        WHERE r.org_id=$1 AND r.id=$2 AND j.state='running' LIMIT 2`,[input.orgId,input.parentRunId]);
      if(!rows.rows.length)return null;
      if(rows.rows.length!==1)throw new Error('report_file_binding_ambiguous');
      const row=rows.rows[0]!;
      const scoped:DatabasePort={withTenant:async(tenant,work)=>{if(tenant!==input.orgId)throw new Error('report_file_binding_invalid');return work(s);},withoutTenant:async()=>{throw new Error('report_file_binding_invalid');},close:async()=>{}};
      const visibility=await resolveVisibility({repo:new PgIdentityRepository(scoped),chat:new PgChatRepository(scoped),ids:{next:randomUUID}},
        {orgId:input.orgId,userId:row.actor_user_id,threadId:row.thread_id,projectId:null});
      if(visibility.kind!=='allow')throw new Error('report_file_binding_denied');
      const disclosed=discloseDecided(guard({kind:'project',id:`personal:${row.thread_id}`},row.metadata),visibility.base);
      if(!isDisclosed(disclosed))throw new Error('report_file_binding_denied');
      const record=this.parse(disclosed.payload);
      if(record.actor.orgId!==input.orgId||record.actor.userId!==row.actor_user_id||record.requestId!==row.request_id||record.threadId!==row.thread_id
        ||(record.runId!==undefined&&record.runId!==input.parentRunId)||row.skill_version_ids.length!==1||row.skill_version_ids[0]!==record.skill.versionId
        ||record.skill.stableName!==REPORT_FILE_FORMATS[record.job.format].skillStableName||!/^[a-f0-9]{64}$/.test(record.renderHash)||!record.bindingKey)throw new Error('report_file_binding_invalid');
      return ReportFileArtifactPolicy.parse({jobId:record.job.id,publication:reportFilePublication(record),published:row.published});
    });
  }
  async findByRequest(actor: ReportFileActor, requestId: string) {
    return this.db.withTenant(actor.orgId, async session => {
      const rows = (await session.query<{ metadata: StoredReportFileJob }>(
        'SELECT metadata FROM report_skill_file_jobs WHERE org_id=$1 AND actor_user_id=$2 AND request_id=$3', [actor.orgId, actor.userId, requestId])).rows;
      return rows[0] ? this.parse(rows[0].metadata) : null;
    });
  }
  private async reusable(session: TenantSession, key: ReportFileReuseKey) {
    const rows = (await session.query<{metadata: StoredReportFileJob}>(
      `SELECT metadata FROM report_skill_file_jobs WHERE org_id=$1 AND actor_user_id=$2
       AND metadata->'job'->'source'=$3::jsonb AND metadata->'job'->>'format'=$4
       AND metadata->>'bindingKey'=$5 AND metadata->>'renderHash'=$6
       AND state IN ('queued','running','succeeded') ORDER BY (state='succeeded') DESC,created_at DESC LIMIT 1`,
      [key.actor.orgId,key.actor.userId,JSON.stringify(key.source),key.format,key.bindingKey,key.renderHash])).rows;
    return rows[0] ? this.parse(rows[0].metadata) : null;
  }
  async findReusable(key: ReportFileReuseKey) {
    return this.db.withTenant(key.actor.orgId, session => this.reusable(session,key));
  }
  async insert(record: StoredReportFileJob) {
    const key = {actor:record.actor,source:record.job.source,format:record.job.format,bindingKey:record.bindingKey,renderHash:record.renderHash};
    return this.db.withTenant(record.actor.orgId, async session => {
      // Cross-process serialization of one authorized representation. Failed jobs release the slot.
      await session.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [JSON.stringify([record.actor.orgId,record.actor.userId,record.job.source.kind,record.job.source.id,record.job.source.reportVersion,record.job.source.reportHash,record.job.format,record.bindingKey,record.renderHash])]);
      if (await this.reusable(session,key)) return false;
      return (await session.query(
        `INSERT INTO report_skill_file_jobs(id,org_id,actor_user_id,request_id,metadata,state)
         VALUES($1,$2,$3,$4,$5::jsonb,'queued') ON CONFLICT(request_id) DO NOTHING RETURNING id`,
        [record.job.id,record.actor.orgId,record.actor.userId,record.requestId,JSON.stringify(record)])).rows.length===1;
    });
  }
  async get(actor: ReportFileActor, id: string) {
    return this.db.withTenant(actor.orgId, async session => {
      const rows = (await session.query<{ metadata: StoredReportFileJob }>(
        'SELECT metadata FROM report_skill_file_jobs WHERE org_id=$1 AND actor_user_id=$2 AND id=$3', [actor.orgId, actor.userId, id])).rows;
      return rows[0] ? this.parse(rows[0].metadata) : null;
    });
  }
  async claim(actor: ReportFileActor, id: string) {
    return this.db.withTenant(actor.orgId, async session => {
      await session.query(`UPDATE report_skill_file_jobs SET state='failed',lease_token=NULL,lease_until=NULL,
        metadata=jsonb_set(jsonb_set(metadata,'{job,status}','"failed"'::jsonb),'{job,errorCode}','"GENERATION_FAILED"'::jsonb)
        WHERE org_id=$1 AND actor_user_id=$2 AND id=$3 AND state='running' AND lease_until<=now() AND attempts>=3`, [actor.orgId, actor.userId, id]);
      const leaseToken = randomUUID();
      const rows = (await session.query<{ metadata: StoredReportFileJob }>(
        `UPDATE report_skill_file_jobs SET state='running',attempts=attempts+1,lease_token=$4,lease_until=now()+interval '90 seconds',
         metadata=jsonb_set(metadata,'{job,status}','"running"'::jsonb)
         WHERE org_id=$1 AND actor_user_id=$2 AND id=$3 AND attempts<3
         AND metadata->>'runId' IS NULL AND (state='queued' OR (state='running' AND lease_until<=now())) RETURNING metadata`, [actor.orgId, actor.userId, id, leaseToken])).rows;
      return rows[0] ? { record: this.parse(rows[0].metadata), leaseToken } : null;
    });
  }
  async saveThread(claim: ClaimedReportFileJob, threadId: string) {
    const { actor, job } = claim.record;
    return this.db.withTenant(actor.orgId, async session => (await session.query(
      `UPDATE report_skill_file_jobs SET metadata=jsonb_set(metadata,'{threadId}',to_jsonb($5::text))
       WHERE org_id=$1 AND actor_user_id=$2 AND id=$3 AND lease_token=$4 AND state='running' AND lease_until>now() RETURNING id`,
      [actor.orgId, actor.userId, job.id, claim.leaseToken, threadId])).rows.length === 1);
  }
  async update(record: StoredReportFileJob) {
    return this.db.withTenant(record.actor.orgId, async session => (await session.query(
      `UPDATE report_skill_file_jobs SET metadata=$4::jsonb,state=$5
       WHERE org_id=$1 AND actor_user_id=$2 AND id=$3 AND metadata->>'runId'=$6 AND state='running' RETURNING id`,
      [record.actor.orgId, record.actor.userId, record.job.id, JSON.stringify(record), record.job.status, record.runId])).rows.length === 1);
  }
  async finish(claim: ClaimedReportFileJob, record: StoredReportFileJob) {
    const { actor, job } = claim.record;
    return this.db.withTenant(actor.orgId, async session => (await session.query(
      `UPDATE report_skill_file_jobs SET metadata=$5::jsonb,state=$6,lease_token=NULL,lease_until=NULL
       WHERE org_id=$1 AND actor_user_id=$2 AND id=$3 AND lease_token=$4 AND state='running' AND lease_until>now() RETURNING id`,
      [actor.orgId, actor.userId, job.id, claim.leaseToken, JSON.stringify({ ...record, job: ReportFileJob.parse(record.job) }), record.job.status])).rows.length === 1);
  }
}
