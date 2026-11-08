import { afterAll, beforeAll, beforeEach, expect, it } from 'vitest';
import { PgReportFileJobStore } from '../../src/infrastructure/report-files/pg-job-store';
import type { StoredReportFileJob } from '../../src/application/report-files/job-ports';
import type { DatabasePort } from '../../src/application/ports/database.port';
import { toOrgId } from '../../src/domain/org-id';
import { asApp, ensureDatabase, migrateOnce, resetOrgs, seedOrg } from '../support/db';
import { resetCredentials, seedCredential } from '../support/auth';
const org = toOrgId('org-report-credit-6424');
const actor = { orgId: org, userId: `${org}-owner` };
const id = '00000000-0000-4000-8000-000000006424';
const db: DatabasePort = { withTenant: (orgId, work) => asApp(orgId, c => work({ query: async(sql, params=[]) => ({rows:(await c.query(sql,[...params])).rows}) })), withoutTenant: async()=>{throw new Error('tenant required');}, close:async()=>{} };
const store = new PgReportFileJobStore(db);
function record(): StoredReportFileJob { return {
  actor, requestId:id, threadId:'report-thread',runId:'report-run',bindingKey:'report-revision',renderHash:'b'.repeat(64),skill:{stableName:'pdf-create',versionId:'pin',digest:'c'.repeat(64)},
  job:{id,status:'failed',errorCode:'GENERATION_FAILED',source:{kind:'interview',id:'report',reportVersion:1,reportHash:'a'.repeat(64)},format:'pdf',createdAt:'2026-11-08T00:00:00Z'},
}; }
async function seed() { const value=record();await asApp(org,c=>c.query(`INSERT INTO report_skill_file_jobs(id,org_id,actor_user_id,request_id,metadata,state) VALUES($1,$2,$3,$1,$4::jsonb,'failed')`,[id,org,actor.userId,JSON.stringify(value)]));return value; }
beforeAll(async()=>{await ensureDatabase();await migrateOnce();},180000);
beforeEach(async()=>{await resetOrgs(org);await resetCredentials([actor.userId],[]);await seedCredential({userId:actor.userId,email:'report-credit-6424@example.test',password:'isolated-test-password',emailVerified:true});await seedOrg({orgId:org,projectId:'report-credit-project'});});
afterAll(async()=>{await resetOrgs(org);await resetCredentials([actor.userId],[]);});
it('the actual PostgreSQL store retains recovered Credit guidance on an already-failed generic job',async()=>{
 const old=await seed();const creditFailure={code:'credit_required' as const,ownerType:'user' as const,ownerId:actor.userId,rechargePath:'/billing?purchase=1'};
 expect(await store.update({...old,job:{...old.job,status:'failed',errorCode:'CREDIT_REQUIRED',creditFailure}})).toBe(true);
 const restarted=await new PgReportFileJobStore(db).get(actor,id);
 expect(restarted?.job).toMatchObject({status:'failed',errorCode:'CREDIT_REQUIRED',creditFailure});
 expect((await asApp(org,c=>c.query('SELECT state FROM report_skill_file_jobs WHERE id=$1',[id]))).rows[0]?.state).toBe('failed');
});
it('terminal enrichment cannot resurrect work, overwrite another outcome, or cross actor/run/source fences',async()=>{
 const old=await seed();const enriched={...old,job:{...old.job,status:'failed' as const,errorCode:'CREDIT_ACCOUNTING_UNAVAILABLE' as const}};
 expect(await store.update({...enriched,actor:{...actor,userId:'other'}})).toBe(false);
 expect(await store.update({...enriched,actor:{...actor,orgId:toOrgId('other-org')}})).toBe(false);
 expect(await store.update({...enriched,threadId:'new-thread'})).toBe(false);
 expect(await store.update({...enriched,renderHash:'d'.repeat(64)})).toBe(false);
 expect(await store.update({...enriched,job:{...enriched.job,format:'docx'}})).toBe(false);
 expect(await store.update({...enriched,runId:'new-run'})).toBe(false);
 expect(await store.update({...enriched,bindingKey:'new-revision'})).toBe(false);
 expect(await store.update({...enriched,job:{...enriched.job,source:{...enriched.job.source,reportVersion:2}}})).toBe(false);
 expect(await store.update({...old,job:{id:old.job.id,source:old.job.source,format:old.job.format,createdAt:old.job.createdAt,status:'running'}})).toBe(false);
 expect(await store.update(enriched)).toBe(true);
 expect(await store.update({...old,job:{...old.job,status:'failed',errorCode:'CREDIT_REQUIRED'}})).toBe(false);
 expect((await store.get(actor,id))?.job).toMatchObject({status:'failed',errorCode:'CREDIT_ACCOUNTING_UNAVAILABLE'});
});

it('concurrent terminal enrichment has one winner and leaves all nonfailure fields untouched',async()=>{
 const old=await seed();
 await asApp(org,c=>c.query("UPDATE report_skill_file_jobs SET attempts=2,lease_token='00000000-0000-4000-8000-000000000002',lease_until='2026-11-08T00:00:00Z' WHERE id=$1",[id]));
 const before=(await asApp(org,c=>c.query('SELECT metadata,state,attempts,lease_token,lease_until,request_id FROM report_skill_file_jobs WHERE id=$1',[id]))).rows[0]!;
 const personal={...old,job:{...old.job,status:'failed' as const,errorCode:'CREDIT_REQUIRED' as const,creditFailure:{code:'credit_required' as const,ownerType:'user' as const,ownerId:actor.userId,rechargePath:'/billing?purchase=1'}}};
 const outage={...old,job:{...old.job,status:'failed' as const,errorCode:'CREDIT_ACCOUNTING_UNAVAILABLE' as const}};
 expect((await Promise.all([store.update(personal),store.update(outage)])).filter(Boolean)).toHaveLength(1);
 const after=(await asApp(org,c=>c.query('SELECT metadata,state,attempts,lease_token,lease_until,request_id FROM report_skill_file_jobs WHERE id=$1',[id]))).rows[0]!;
 expect(after).toMatchObject({state:before.state,attempts:before.attempts,lease_token:before.lease_token,lease_until:before.lease_until,request_id:before.request_id});
 const removeFailure=(row:typeof before)=>{const copy=structuredClone(row.metadata);delete copy.job.errorCode;delete copy.job.creditFailure;return copy;};
 expect(removeFailure(after)).toEqual(removeFailure(before));
 expect((await new PgReportFileJobStore(db).get(actor,id))?.job.status).toBe('failed');
});
it('successful output is never downgraded and an active run still persists a typed failure normally',async()=>{
 const old=await seed();const typed={...old,job:{...old.job,status:'failed' as const,errorCode:'CREDIT_REQUIRED' as const}};
 const succeeded={...old,job:{id,source:old.job.source,format:'pdf',createdAt:old.job.createdAt,status:'succeeded',skill:old.skill,file:{filename:'report.pdf',mediaType:'application/pdf',sizeBytes:100,sha256:'f'.repeat(64)}}};
 await asApp(org,c=>c.query("UPDATE report_skill_file_jobs SET state='succeeded',metadata=$2::jsonb WHERE id=$1",[id,JSON.stringify(succeeded)]));
 expect(await store.update(typed)).toBe(false);
 expect((await store.get(actor,id))?.job.status).toBe('succeeded');
 await asApp(org,c=>c.query("UPDATE report_skill_file_jobs SET state='running',metadata=$2::jsonb WHERE id=$1",[id,JSON.stringify({...old,job:{id,source:old.job.source,format:old.job.format,createdAt:old.job.createdAt,status:'running'}})]));
 expect(await store.update(typed)).toBe(true);
 expect((await store.get(actor,id))?.job).toMatchObject({status:'failed',errorCode:'CREDIT_REQUIRED'});
});
