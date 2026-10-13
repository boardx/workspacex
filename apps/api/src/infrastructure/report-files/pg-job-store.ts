import { randomUUID } from 'node:crypto';
import { ReportFileJob } from '@repo/contracts/report-files';
import type { DatabasePort } from '../../application/ports/database.port';
import type { ReportFileActor } from '../../application/report-files/ports';
import type { ClaimedReportFileJob, ReportFileJobStore, StoredReportFileJob } from '../../application/report-files/job-ports';
/** Tenant/actor filters on every access; request IDs cannot silently cross actor or tenant. */
export class PgReportFileJobStore implements ReportFileJobStore {
  constructor(private readonly db: DatabasePort) {}
  private parse(metadata: StoredReportFileJob): StoredReportFileJob { return { ...metadata, job: ReportFileJob.parse(metadata.job) }; }
  async findByRequest(actor: ReportFileActor, requestId: string) {
    return this.db.withTenant(actor.orgId, async session => {
      const rows = (await session.query<{ metadata: StoredReportFileJob }>(
        'SELECT metadata FROM report_skill_file_jobs WHERE org_id=$1 AND actor_user_id=$2 AND request_id=$3', [actor.orgId, actor.userId, requestId])).rows;
      return rows[0] ? this.parse(rows[0].metadata) : null;
    });
  }
  async insert(record: StoredReportFileJob) {
    return this.db.withTenant(record.actor.orgId, async session => (await session.query(
      `INSERT INTO report_skill_file_jobs(id,org_id,actor_user_id,request_id,metadata,state)
       VALUES($1,$2,$3,$4,$5::jsonb,'queued') ON CONFLICT(request_id) DO NOTHING RETURNING id`,
      [record.job.id, record.actor.orgId, record.actor.userId, record.requestId, JSON.stringify(record)])).rows.length === 1);
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
