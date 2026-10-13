import { randomUUID } from 'node:crypto';
import type { DatabasePort, TenantSession } from '../../application/ports/database.port';
import type { OrgId } from '../../domain/org-id';
import type { StoredReportFileJob } from '../../application/report-files/job-ports';
import { reportRenderHash } from '../../application/report-files/service';
import { InterviewReportFileSource } from '../../application/interview/interview-report-file-source';
import { authorizeDigitalInterview } from '../../application/interview/get-digital-interview';
import { guard, discloseDecided, isDisclosed } from '../../application/security/permission-filter';
import { PgDigitalInterviewRepository } from '../interview/pg-digital-interview-repository';
import { PgInterviewScopeRepository } from '../interview/pg-interview-scope-repository';
import { PgInterviewMarkdownReader } from '../interview/pg-interview-markdown-reader';

/** Private export conversations do not grant project chat/retrieval permissions.
 * Their AI policy identity comes only from the server-owned, exactly accepted job.
 * Revalidate the canonical source on every claim/resume/private model admission.
 */
export async function resolveReportFilePolicyProject(s: TenantSession, orgId: OrgId,
  runId: string, userId: string, threadId: string, threadProjectId: string | null): Promise<string | null> {
  if (threadProjectId !== null) return threadProjectId;
  const row = (await s.query<{ metadata: StoredReportFileJob; active: boolean; request_id: string }>(`
    SELECT j.metadata, j.request_id::text AS request_id, (j.state='running' AND ((j.metadata->>'runId'=r.id) OR
      (j.metadata->>'runId' IS NULL AND j.lease_token IS NOT NULL AND j.lease_until>now()))) AS active
    FROM report_skill_file_jobs j
    JOIN agent_runs r ON r.org_id=j.org_id AND r.id=$2 AND r.thread_id=$4
    JOIN chat_messages m ON m.org_id=r.org_id AND m.id=r.input_message_id
    JOIN chat_threads t ON t.org_id=r.org_id AND t.id=r.thread_id
    WHERE j.org_id=$1 AND j.actor_user_id=$3 AND m.author_id=$3
      AND t.created_by=$3 AND t.project_id IS NULL AND t.visibility_scope='private'
      AND j.request_id=m.client_message_id AND j.metadata->>'threadId'=t.id
      AND j.metadata->>'projectId' IS NOT NULL
    FOR SHARE OF j`, [orgId, runId, userId, threadId])).rows[0];
  if (!row) return null; // Ordinary personal messages never acquire a project policy scope.
  if (!row.active || row.metadata.job.source.kind !== 'interview') throw new Error('REPORT_POLICY_BINDING_DENIED');
  const db: DatabasePort = { withTenant: async (tenant, work) => {
    if (tenant !== orgId) throw new Error('REPORT_POLICY_BINDING_DENIED');
    return work(s);
  }, withoutTenant: async () => { throw new Error('REPORT_POLICY_BINDING_DENIED'); }, close: async () => {} };
  const deps = { repo: new PgDigitalInterviewRepository(db),
    scope: new PgInterviewScopeRepository(db), reader: new PgInterviewMarkdownReader(db),
    decisions: { next: randomUUID } };
  const sourceId = row.metadata.job.source.id;
  const source = await new InterviewReportFileSource(deps).read({ orgId, userId }, sourceId);
  const authorized = await authorizeDigitalInterview(deps, { orgId, viewerUserId: userId, interviewId: sourceId });
  const disclosed = discloseDecided(guard({ kind: 'interview', id: sourceId }, row.metadata), authorized.decision);
  if (!isDisclosed(disclosed)) throw new Error('REPORT_POLICY_BINDING_DENIED');
  const record = disclosed.payload;
  if (record.requestId !== row.request_id || record.actor.orgId !== orgId || record.actor.userId !== userId
    || record.threadId !== threadId || !record.projectId) throw new Error('REPORT_POLICY_BINDING_DENIED');
  if (source.projectId !== record.projectId || source.bindingKey !== record.bindingKey
    || reportRenderHash(source) !== record.renderHash || source.reportVersion !== record.job.source.reportVersion
    || source.reportHash !== record.job.source.reportHash) throw new Error('REPORT_POLICY_BINDING_DENIED');
  return source.projectId;
}
