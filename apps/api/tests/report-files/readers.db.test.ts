// @global-scope-fixture seeder:ensurePlatformSkillCatalogSeeded: The isolation runner drops its owned test database and platform seed rows.
import 'reflect-metadata';
import {PgReportFileJobStore} from '../../src/infrastructure/report-files/pg-job-store';
import {PgNativeOutputStaging} from '../../src/infrastructure/agent-run/pg-native-output-staging';
import {PgParentRunControlReader} from '../../src/infrastructure/agent-run/pg-parent-run-control';
import {ToolExecutionAuthority} from '../../src/application/agent-run/tool-execution-authority';
import {PgAgentRunRepository} from '../../src/infrastructure/agent-run/pg-agent-run-repository';
import {reportFilePublication} from '../../src/application/report-files/publication';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import type {NativeSessionOwner} from '../../src/application/agent-run/native-session-owner';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import { randomUUID } from 'node:crypto';
import { beforeAll, beforeEach, afterAll, it, expect } from 'vitest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ensureDatabase, migrateOnce, seedOrg, addOrgMember, addProjectMember, asApp, asOwner, resetOrgs } from '../support/db';
import { seedCredential, resetCredentials } from '../support/auth';
import { toOrgId } from '../../src/domain/org-id';
import { DATABASE_PORT, type DatabasePort } from '../../src/application/ports/database.port';
import { REPORT_FILE_SERVICE, type ReportFileService } from '../../src/application/report-files/service';
import { ENSURE_DEFAULT_AGENT_REPOSITORY, ensureDefaultAgent } from '../../src/application/agent/ensure-default-agent';
import { ensurePlatformSkillCatalogSeeded } from '../../src/infrastructure/skill/ensure-platform-skill-catalog';
import { PgDigitalInterviewRepository } from '../../src/infrastructure/interview/pg-digital-interview-repository';
import { appendInterviewMarkdownDocument } from '../../src/infrastructure/interview/interview-markdown-migration';
import { resolveReportFilePolicyProject } from '../../src/infrastructure/report-files/pg-report-file-policy-project';
import { PgAiAdmissionRepository } from '../../src/infrastructure/auth/pg-ai-admission-repository';
import { mutateThread, NoWriteRoleError } from '../../src/application/chat/mutate-thread';
import { IDENTITY_REPOSITORY, DECISION_ID_FACTORY } from '../../src/application/identity/ports';
import { CHAT_REPOSITORY } from '../../src/application/chat/ports';
import { PROVENANCE_WRITER } from '../../src/application/provenance/ports';
import { ID_FACTORY } from '../../src/application/artifact/ports';
import { AGENT_RUN_STORE, type AgentRunStore } from '../../src/application/agent-run/ports';
const org = toOrgId('org-report-readers-5656'), project = 'project-report-readers-5656';
const owner = `${org}-owner`, observer = `${org}-observer`, collaborator = `${org}-collaborator`;
const interviewId = 'interview-report-readers-5656', revisionId = 'revision-report-readers-5656';
let app: NestExpressApplication, db: DatabasePort, service: ReportFileService;
beforeAll(async () => {
  ensureDatabase(); await migrateOnce(); await ensurePlatformSkillCatalogSeeded();
  process.env.KERNEL_AGENT_RUN_AUTOSTART = '0';
  process.env.KERNEL_DEFAULT_AGENT_MODEL_ID = 'report-readers-no-dispatch';
  const { createApp } = await import('../../src/main'); app = await createApp();
  db = app.get(DATABASE_PORT); service = app.get(REPORT_FILE_SERVICE);
}, 180000);
beforeEach(async () => {
  await resetOrgs(org); await resetCredentials([observer, collaborator], []);
  await seedOrg({ orgId: org, projectId: project });
  for (const userId of [observer, collaborator]) {
    await seedCredential({ userId, email: `${userId}@example.test`, password: 'isolated-test-password', emailVerified: true });
    await addOrgMember(org, userId, 'consultant', null);
  }
  await addProjectMember(org, project, observer, 'observer', null);
  await new PgDigitalInterviewRepository(db).createDraft({ orgId: org, actorId: owner, interviewId,
    scope: { kind: 'project', projectId: project, researchProjectId: null }, name: '已保存报告', tags: [], topic: '访谈' });
  await db.withTenant(org, async s => {
    await s.query('INSERT INTO interview_collaborators(org_id,interview_id,user_id,added_by) VALUES($1,$2,$3,$4)', [org, interviewId, collaborator, owner]);
    await s.query('INSERT INTO digital_interview_revisions(org_id,id,interview_id,revision_number,created_by) VALUES($1,$2,$3,1,$4)', [org, revisionId, interviewId, owner]);
    await appendInterviewMarkdownDocument(s, { orgId: org, interviewId, revisionId, step: 'report', title: '报告',
      markdown: '# 已保存报告\n\n需要真人验证的访谈结论。', evidenceMode: 'simulated', references: [], expectedVersion: 0, status: 'draft' });
  });
  await ensureDefaultAgent({ repo: app.get(ENSURE_DEFAULT_AGENT_REPOSITORY) }, { orgId: org, actorId: owner });
});
afterAll(async () => { await resetOrgs(org); await resetCredentials([observer, collaborator], []); await app?.close(); });
async function accept(userId: string) {
  const source = await service.source({ orgId: org, userId }, { kind: 'interview', id: interviewId });
  const job = await service.start({ orgId: org, userId }, { source: { kind: source.kind, id: source.id,
    reportVersion: source.reportVersion, reportHash: source.reportHash }, format: 'pdf', requestId: randomUUID() });
  expect(job.status).toBe('running');
  const record = (await asApp(org, c => c.query('SELECT metadata FROM report_skill_file_jobs WHERE id=$1', [job.id]))).rows[0]!.metadata;
  const run = (await asApp(org, c => c.query('SELECT r.status,t.project_id,t.visibility_scope,t.created_by FROM agent_runs r JOIN chat_threads t ON t.id=r.thread_id AND t.org_id=r.org_id WHERE r.org_id=$1 AND r.id=$2', [org, record.runId]))).rows[0];
  expect(run).toEqual({ status: 'queued', project_id: null, visibility_scope: 'private', created_by: userId });
  return record;
}
it.each([observer, collaborator])('read-authorized %s accepts a genuine private conversion run with original project policy', async userId => {
  const record = await accept(userId);
  expect(await db.withTenant(org, s => resolveReportFilePolicyProject(s, org, record.runId, userId, record.threadId, null))).toBe(project);
  const [claimed] = await app.get<AgentRunStore>(AGENT_RUN_STORE).claimQueued(org, 1);
  expect(claimed).toMatchObject({ kind: 'executable', run: { runId: record.runId, requesterUserId: userId,
    projectId: null, policyProjectId: project, skillVersionIds: [record.skill.versionId] } });
  if (userId === observer) await expect(mutateThread({ repo: app.get(IDENTITY_REPOSITORY), ids: app.get(DECISION_ID_FACTORY), chat: app.get(CHAT_REPOSITORY),
    provenance: app.get(PROVENANCE_WRITER), artifactIds: app.get(ID_FACTORY) }, { orgId: org, userId, op: 'create', projectId: project,
    threadId: null, groupId: null, title: '普通项目聊天', visibilityScope: 'private', expectedVersion: null, reason: null })).rejects.toBeInstanceOf(NoWriteRoleError);
});
it.each([observer, collaborator])('revoking %s blocks new jobs and revalidates an already accepted run', async userId => {
  const record = await accept(userId);
  // Controlled fixture revocation; app_rw intentionally cannot delete collaborator history.
  await asOwner(c => c.query(userId === observer ? 'DELETE FROM project_memberships WHERE org_id=$1 AND user_id=$2' : 'DELETE FROM interview_collaborators WHERE org_id=$1 AND user_id=$2', [org, userId]));
  await expect(service.source({ orgId: org, userId }, { kind: 'interview', id: interviewId })).rejects.toMatchObject({ code: 'REPORT_NOT_FOUND' });
  await expect(service.start({ orgId: org, userId }, { source: record.job.source, format: 'docx', requestId: randomUUID() })).rejects.toMatchObject({ code: 'REPORT_NOT_FOUND' });
  await expect(db.withTenant(org, s => resolveReportFilePolicyProject(s, org, record.runId, userId, record.threadId, null))).rejects.toMatchObject({ code: 'REPORT_NOT_FOUND' });
  expect(await app.get<AgentRunStore>(AGENT_RUN_STORE).claimQueued(org, 1)).toEqual([expect.objectContaining({ kind: 'unresolvable', runId: record.runId })]);
  expect((await asApp(org, c => c.query('SELECT id FROM agent_runs WHERE org_id=$1', [org]))).rows).toHaveLength(1);
});
it('foreign actor, tenant, thread or accepted request cannot inject a source policy scope', async () => {
  const r = await accept(collaborator);
  for (const [tenant, userId, threadId] of [[org, observer, r.threadId], [toOrgId('other-org'), collaborator, r.threadId], [org, collaborator, 'other-thread']] as const)
    expect(await db.withTenant(tenant, s => resolveReportFilePolicyProject(s, tenant, r.runId, userId, threadId, null))).toBeNull();
  await asApp(org, c => c.query("UPDATE report_skill_file_jobs SET request_id=$2 WHERE id=$1", [r.job.id, randomUUID()]));
  expect(await db.withTenant(org, s => resolveReportFilePolicyProject(s, org, r.runId, collaborator, r.threadId, null))).toBeNull();
});
it('expired initialization and changed canonical source refuse policy scope instead of falling back to personal AI', async () => {
  const r = await accept(collaborator);
  await asApp(org, c => c.query("UPDATE report_skill_file_jobs SET metadata=metadata-'runId',lease_token=$2,lease_until=now()-interval '1 second' WHERE id=$1", [r.job.id, randomUUID()]));
  await expect(db.withTenant(org, s => resolveReportFilePolicyProject(s, org, r.runId, collaborator, r.threadId, null))).rejects.toThrow('REPORT_POLICY_BINDING_DENIED');
  await asApp(org, c => c.query("UPDATE report_skill_file_jobs SET metadata=jsonb_set(metadata,'{runId}',to_jsonb($2::text)) WHERE id=$1", [r.job.id, r.runId]));
  await asApp(org, c => c.query('UPDATE interview_sessions SET version=version+1 WHERE org_id=$1 AND id=$2', [org, interviewId]));
  await expect(db.withTenant(org, s => resolveReportFilePolicyProject(s, org, r.runId, collaborator, r.threadId, null))).rejects.toThrow('REPORT_POLICY_BINDING_DENIED');
});
it('private conversion does not bypass actual unconfigured AI admission or member token limits', async () => {
  const r = await accept(observer), admission = new PgAiAdmissionRepository(db);
  expect((await admission.resolveBudgetPolicy(org, observer)).decision).toBe('PLAN_UNCONFIGURED');
  const start = new Date(Date.now()-60000).toISOString(), end = new Date(Date.now()+60000).toISOString();
  await asApp(org, async c => {
    await c.query("INSERT INTO organization_plans(org_id,plan,version,updated_by) VALUES($1,'ordinary',1,$2)", [org, owner]);
    await c.query("INSERT INTO ai_budget_windows(org_id,user_id,window_start,window_end,timezone,token_limit,cost_limit_micros,currency,price_version,configured_by) VALUES($1,$2,$3,$4,'Etc/UTC',0,1000,'CNY','reader-test',$5)", [org, observer, start, end, owner]);
  });
  const policyProjectId = await db.withTenant(org, s => resolveReportFilePolicyProject(s, org, r.runId, observer, r.threadId, null));
  expect(policyProjectId).toBe(project);
  expect((await admission.reserve(org, { requestId: randomUUID(), userId: observer,
    windowStart: start, windowEnd: end, maximumTokens: 1n, maximumCostMicros: 1n, modelProvider: 'test', modelId: 'test', currency: 'CNY', priceVersion: 'reader-test' })).decision).toBe('TOKEN_LIMIT_REACHED');
});

it('binds publication to the genuine accepted report job and preserves normal ready writeback',async()=>{
 const record=await accept(collaborator),store=new PgReportFileJobStore(db);
 const ctx={orgId:org,parentRunId:record.runId,attemptId:record.runId+':1',leaseEpoch:1,bindingId:randomUUID(),toolCallId:'report-publish'};
 const check={...ctx,toolName:'execute',toolArgs:{command:'generate'}};
 expect(await store.artifactPolicyForRun(check)).toMatchObject({jobId:record.job.id,published:false});
 expect(await store.artifactPolicyForRun({...check,orgId:toOrgId('other')})).toBeNull();
 // Acceptance starts dispatch before finish persists runId: accepted message/request/thread still bind it.
 await asApp(org,c=>c.query("UPDATE report_skill_file_jobs SET metadata=metadata-'runId',lease_token=$2,lease_until=now()+interval '90 seconds' WHERE id=$1",[record.job.id,randomUUID()]));
 expect(await store.artifactPolicyForRun(check)).toMatchObject({jobId:record.job.id,published:false});
 await asApp(org,c=>c.query("UPDATE report_skill_file_jobs SET metadata=jsonb_set(metadata,'{runId}',to_jsonb($2::text)) WHERE id=$1",[record.job.id,record.runId]));
 await asApp(org,c=>c.query("UPDATE chat_messages SET client_message_id=$2 WHERE id=(SELECT input_message_id FROM agent_runs WHERE id=$1)",[record.runId,randomUUID()]));
 expect(await store.artifactPolicyForRun(check)).toBeNull();
 await asApp(org,c=>c.query("UPDATE chat_messages SET client_message_id=$2 WHERE id=(SELECT input_message_id FROM agent_runs WHERE id=$1)",[record.runId,record.requestId]));
 await asApp(org,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE id=$1",[record.runId]));
 await asApp(org,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,2,'context_built','succeeded',now(),now())",[randomUUID(),org,record.runId]));
 for(const change of [{actor:{orgId:org,userId:observer}},{skill:{...record.skill,versionId:'wrong-version'}},{renderHash:'invalid'}]){
  await asApp(org,c=>c.query('UPDATE report_skill_file_jobs SET metadata=$2::jsonb WHERE id=$1',[record.job.id,JSON.stringify({...record,...change})]));
  await expect(store.artifactPolicyForRun(check)).rejects.toThrow('report_file_binding_invalid');
 }
 await asApp(org,c=>c.query('UPDATE report_skill_file_jobs SET metadata=$2::jsonb WHERE id=$1',[record.job.id,JSON.stringify(record)]));
 const authority=new ToolExecutionAuthority(new PgParentRunControlReader(db),{readPinnedSkills:async()=>[]},{hasGrant:async()=>true,grantForRun:async()=>{},grantStanding:async()=>{},revokeAllForRun:async()=>{},listStanding:async()=>[],revokeStanding:async()=>false},input=>store.artifactPolicyForRun(input));
 const root=await mkdtemp(join(tmpdir(),'report-publish-5709-'));
 try{
  const objects=new FsObjectStore(root),input=reportFilePublication(record),bytes=Buffer.from('%PDF-1.4\nfixture structural PDF\n%%EOF');
  const owner:NativeSessionOwner={provision:async()=>{throw new Error('unused');},release:async()=>{},releaseForRun:async()=>{},resolve:async()=>({sessionId:randomUUID(),token:'a'.repeat(64),expiresAt:Date.now()+60000,interruptOn:{},packageDigest:'b'.repeat(64),inputs:[]})};
  const files=()=>({read:async()=>({path:input.workspacePath,sizeBytes:bytes.length,contentBase64:bytes.toString('base64')})});
  const failed=new PgNativeOutputStaging(db,owner,{putOnce:async()=>{throw new Error('object write failure');},get:objects.get.bind(objects),head:objects.head.bind(objects)},authority,files);
  await expect(failed.stage(ctx,input)).rejects.toThrow('object write failure');
  expect(await store.artifactPolicyForRun(check)).toMatchObject({published:false});
  const staging=new PgNativeOutputStaging(db,owner,objects,authority,files);
  expect(await staging.stage(ctx,input)).toMatchObject({status:'staged',completion:{kind:'report-file',jobId:record.job.id}});
  expect(await authority.check(check)).toMatchObject({allowed:false,reason:'report_output_published'});
  expect(await authority.check({...check,toolName:'wx_artifact_publish',toolArgs:input})).toMatchObject({allowed:false,reason:'report_output_published'});
  expect(await authority.check({...check,toolName:'read_file'})).toMatchObject({allowed:true});
  expect(await authority.check({...check,leaseEpoch:2})).toMatchObject({allowed:false,reason:'lease_lost'});
  const staged=await staging.listFiles(org,record.runId),repo=new PgAgentRunRepository(db);
  expect(staged).toHaveLength(1);
  await repo.storeOutputAwaitingWriteback(org,record.runId,{text:'Report file staged.',finalStepSeq:2,files:staged});
  const pending=(await repo.claimWritebackPending(org,1))[0]!;
  await repo.commitWriteback(org,{runId:record.runId,threadId:pending.threadId,inputMessageId:pending.inputMessageId,agentId:pending.agentId,text:pending.text,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),outputDigest:'a'.repeat(64),files:staged});
  const attachments=await db.withTenant(org,s=>s.query<{storage_ref:string}>('SELECT a.storage_ref FROM chat_message_attachments a JOIN chat_messages m ON m.id=a.message_id AND m.org_id=a.org_id WHERE m.org_id=$1 AND m.agent_run_id=$2',[org,record.runId]));
  expect(attachments.rows).toHaveLength(1);expect(await objects.get(attachments.rows[0]!.storage_ref)).toEqual(new Uint8Array(bytes));
  expect((await asApp(org,c=>c.query('SELECT status FROM agent_runs WHERE id=$1',[record.runId]))).rows[0]!.status).toBe('succeeded');
 }finally{await rm(root,{recursive:true,force:true});}
});

it('serializes concurrent fresh request IDs for one representation and does not reuse failed work',async()=>{
 const original=await accept(collaborator);const store=new PgReportFileJobStore(db);
 const records=Array.from({length:6},()=>({...original,requestId:randomUUID(),threadId:undefined,runId:undefined,attachmentId:undefined,
   bindingKey:`${original.bindingKey}/concurrency`,job:{...original.job,id:randomUUID(),status:'queued' as const,execution:undefined}}));
 const inserted=await Promise.all(records.map(record=>store.insert(record)));
 expect(inserted.filter(Boolean)).toHaveLength(1);
 const key={actor:original.actor,source:original.job.source,format:original.job.format,bindingKey:records[0]!.bindingKey,renderHash:original.renderHash};
 const found=await store.findReusable(key);expect(found).not.toBeNull();
 expect(await store.findReusable({...key,actor:{...key.actor,userId:observer}})).toBeNull();
 expect(await store.findReusable({...key,renderHash:'f'.repeat(64)})).toBeNull();
 await asApp(org,c=>c.query(`UPDATE report_skill_file_jobs SET state='failed',metadata=jsonb_set(metadata,'{job}',jsonb_build_object('id',id,'source',metadata->'job'->'source','format',metadata->'job'->'format','createdAt',metadata->'job'->'createdAt','status','failed','errorCode','GENERATION_FAILED')) WHERE org_id=$1 AND id=$2`,[org,found!.job.id]));
 expect(await store.findReusable(key)).toBeNull();
 expect(await store.insert({...records[0]!,requestId:randomUUID(),job:{...records[0]!.job,id:randomUUID()}})).toBe(true);
});
