/** QA-only live-stack reader. No HTTP, migrations, dispatch, ledger writes, or service startup. */
import { verifyLiveAuditRestore } from './audit-restore-binding';
import { createHash,randomUUID } from 'node:crypto';
import { readFileSync,realpathSync,writeFileSync,mkdirSync } from 'node:fs';
import { dirname,isAbsolute,resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { z } from 'zod';
import { SharedStage } from '@repo/contracts/aidt-stages';
import { AidtContextSelector,AidtContextReceipt,aidtContextSelectorJson,aidtContextSnapshotJson,aidtContextCanonicalJson } from '@repo/contracts/aidt-run-context';
import { readConfirmedAidtReturn,readAidtQuestionSnapshot } from '@repo/contracts/aidt-return-reflection';
import { deriveTestIsolation } from '../../../../.harness/scripts/lib/test-isolation';
import { toOrgId } from '../../src/domain/org-id';
import { resolveVisibility } from '../../src/application/chat/resolve-visibility';
import { discloseDecided,isDisclosed,guard } from '../../src/application/security/permission-filter';
import { verifyAidtPinnedSkill } from '../../src/application/aidt-run-context/approved-packs';
import { reduceAidtApplication } from '../../src/application/aidt-run-context/application-receipt';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { PgIdentityRepository } from '../../src/infrastructure/identity/pg-identity-repository';
import { PgChatRepository } from '../../src/infrastructure/chat/pg-chat-repository';
import { PgAgentRunRepository } from '../../src/infrastructure/agent-run/pg-agent-run-repository';
import { PgAidtRunContextStore } from '../../src/infrastructure/aidt-run-context/pg-aidt-run-context-store';
import { FileSkillStarterPackSource,REPO_SKILL_STARTER_PACK_ROOT } from '../../src/infrastructure/skill/file-skill-starter-pack-source';

const id=z.string().min(1).max(256);
const Request=z.object({orgId:id,userId:id,projectId:id,threadId:id,runId:id,expectedSelector:AidtContextSelector.optional(),expectedSkillVersionId:id.optional(),receipt:AidtContextReceipt.optional(),expectedHumanTextHash:z.string().regex(/^[a-f0-9]{64}$/).optional(),approvedRestorePlanSha256:z.string().regex(/^[a-f0-9]{64}$/).optional(),priorRunIds:z.array(id).max(5).optional()}).strict();
const hash=(value:string)=>createHash('sha256').update(value,'utf8').digest('hex');
function need(value:unknown,code:string):asserts value {if(!value)throw new Error(code);}
async function audit(runtimePath:string,requestPath:string,outputPath:string){
 need([runtimePath,requestPath,outputPath].every(isAbsolute),'ABSOLUTE_PATHS_REQUIRED');
 need(resolve(outputPath).startsWith('/workspace/scratch/aidt-source-audit-20261116/'),'OWNED_AUDIT_OUTPUT_REQUIRED');
 // Credentials remain inside this process. No CN env, source/eval, owner role or RLS bypass.
 const runtime=JSON.parse(readFileSync(runtimePath,'utf8')) as {isolation:Record<string,string>;composeProject:string;restoreReceiptFile?:string;restoredCheckpoint?:string};
 const request=Request.parse(JSON.parse(readFileSync(requestPath,'utf8'))),repo=realpathSync('/workspace/aidt-module-latest');
 const seed=runtime.isolation?.WORKSPACEX_ISOLATION_SEED;need(seed,'ISOLATION_SEED_REQUIRED');
 const derived=deriveTestIsolation({worktreePath:repo,isolationId:seed});
 let restored:ReturnType<typeof verifyLiveAuditRestore>|null=null;
 if(runtime.restoreReceiptFile||runtime.restoredCheckpoint){need(request.approvedRestorePlanSha256,'EXPLICIT_APPROVED_RESTORE_PLAN_REQUIRED');restored=verifyLiveAuditRestore(repo,runtime,derived,request.approvedRestorePlanSha256);need(restored.plan.orgId===request.orgId,'AUDIT_RESTORE_ACTOR_ORG_MISMATCH');}
 else {need(!request.approvedRestorePlanSha256,'RESTORE_RECEIPT_REQUIRED');need(derived.WORKSPACEX_DB===runtime.isolation.WORKSPACEX_DB&&derived.COMPOSE_PROJECT_NAME===runtime.composeProject,'ISOLATION_SCOPE_MISMATCH');}
 Object.assign(process.env,derived,runtime.isolation,...(restored?[{PGDATABASE:restored.plan.database,PGHOST:'127.0.0.1'}]:[]));
 const binding=execFileSync('docker',['compose','-f',`${repo}/apps/api/docker-compose.dev.yml`,'-p',runtime.composeProject,'port','postgres','5432'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const port=/^127\.0\.0\.1:(\d+)$/.exec(binding)?.[1];need(port,'OWNED_LOOPBACK_DATABASE_REQUIRED');process.env.PGPORT=port;
 const config={...appConfig(),options:'-c default_transaction_read_only=on'};need(config.user==='app_rw'&&config.host==='127.0.0.1'&&config.database===(restored?restored.plan.database:derived.WORKSPACEX_DB),'APPLICATION_READ_ONLY_DATABASE_REQUIRED');
 const db=new PgDatabase(config,{info(){},error(){}}),orgId=toOrgId(request.orgId);
 try{return await db.withTenant(orgId,async session=>{
  const mode=await session.query<{transaction_read_only:string}>('SHOW transaction_read_only');need(mode.rows[0]?.transaction_read_only==='on','DATABASE_READ_ONLY_REQUIRED');
  const profile=(await session.query<{kind:string;status:string;aidt:boolean}>(`SELECT p.kind,p.status,EXISTS(SELECT 1 FROM project_tags t WHERE t.org_id=p.org_id AND t.project_id=p.id AND t.tag='workspacex:aidt') AS aidt FROM projects p WHERE p.org_id=$1 AND p.id=$2`,[orgId,request.projectId])).rows[0];need(profile?.kind==='general'&&profile.aidt,'CURRENT_AIDT_PROFILE_REQUIRED');
  const identity=new PgIdentityRepository(db),membership=await identity.findNonWorkshopStanding(request.userId,request.projectId,orgId);need(membership?.memberRole,'EXPLICIT_GROUP_MEMBERSHIP_REQUIRED');
  const visibility=await resolveVisibility({repo:identity,chat:new PgChatRepository(db),ids:{next:randomUUID}},{...request,orgId});need(visibility.kind==='allow'&&visibility.thread.projectId===request.projectId,'ACTUAL_THREAD_ACCESS_REQUIRED');
  const store=new PgAidtRunContextStore(db),protectedSnapshot=await store.readIn(session,orgId,request.runId);need(protectedSnapshot,'SNAPSHOT_MISSING');
  const disclosed=discloseDecided(protectedSnapshot,visibility.base);need(isDisclosed(disclosed),'SNAPSHOT_NOT_DISCLOSED');const frozen=disclosed.payload;
  need(frozen.orgId===orgId&&frozen.projectId===request.projectId&&frozen.threadId===request.threadId&&frozen.requestedBy===request.userId,'ACTUAL_PRINCIPAL_SNAPSHOT_SCOPE_MISMATCH');
  const run=(await session.query<{id:string;thread_id:string;input_message_id:string;skill_version_ids:unknown;aidt_selector_hash:string;status:string;agent_id:string;agent_version_id:string;remote_run_id:string|null}>(`SELECT id,thread_id,input_message_id,skill_version_ids,aidt_selector_hash,status,agent_id,agent_version_id,remote_run_id FROM agent_runs WHERE org_id=$1 AND id=$2`,[orgId,request.runId])).rows[0];need(run,'ACTUAL_RUN_REQUIRED');
  const pins=z.array(z.string()).parse(run.skill_version_ids);
  need(run.thread_id===request.threadId&&run.input_message_id===frozen.inputMessageId&&run.aidt_selector_hash===frozen.selectorHash&&pins.length===1&&pins[0]===frozen.snapshot.focus.skillVersionId,'ACTUAL_RUN_FOCUS_OR_BINDING_MISMATCH');
  if(request.expectedSelector)need(aidtContextSelectorJson(request.expectedSelector)===aidtContextSelectorJson(frozen.snapshot.selector),'EXPECTED_SELECTOR_MISMATCH');
  if(request.expectedSkillVersionId)need(request.expectedSkillVersionId===frozen.snapshot.focus.skillVersionId,'EXPECTED_FOCUS_MISMATCH');
  const pin=(await new PgAgentRunRepository(db).readPinnedSkills(orgId,pins))[0];need(pin?.package&&pin.package.skillId===frozen.snapshot.focus.skillId&&pin.stableName===frozen.snapshot.focus.skillStableName,'READABLE_FROZEN_PACKAGE_REQUIRED');
  const pack=await verifyAidtPinnedSkill(pin,new FileSkillStarterPackSource(REPO_SKILL_STARTER_PACK_ROOT));
  const humanRow=(await session.query<{author_id:string;author_kind:string;thread_id:string;body:string}>(`SELECT author_id,author_kind,thread_id,body FROM chat_messages WHERE org_id=$1 AND id=$2`,[orgId,frozen.inputMessageId])).rows[0];need(humanRow&&humanRow.thread_id===request.threadId&&humanRow.author_id===request.userId&&humanRow.author_kind==='human','ACTUAL_HUMAN_BINDING_REQUIRED');const humanResult=discloseDecided(guard({kind:'project',id:request.projectId},humanRow),visibility.base);need(isDisclosed(humanResult),'HUMAN_NOT_DISCLOSED');const humanTextHash=hash(humanResult.payload.body);if(request.expectedHumanTextHash)need(humanTextHash===request.expectedHumanTextHash,'HUMAN_TEXT_CHANGED');
  const heads=new Map((await session.query<{stage_id:number;revision:number}>(`SELECT stage_id,MAX(revision) AS revision FROM aidt_stage_revisions WHERE org_id=$1 AND project_id=$2 GROUP BY stage_id`,[orgId,request.projectId])).rows.map(row=>[row.stage_id,row.revision]));
  const selector=frozen.snapshot.selector,projection=JSON.parse(frozen.snapshot.modelReferenceBlock.split('\n')[2]!) as {materials:{kind:string;stageId:number;revision:number;excerpt:string;truncated:boolean}[]};
  const sourceFacts=[];
  for(const source of frozen.snapshot.sources){
   const row=(await session.query<{project_id:string;stage_id:number;revision:number;content:unknown;source_stage_revisions:unknown;updated_by:string;updated_at:Date|string}>(`SELECT project_id,stage_id,revision,content,source_stage_revisions,updated_by,updated_at FROM aidt_stage_revisions WHERE org_id=$1 AND project_id=$2 AND stage_id=$3 AND revision=$4`,[orgId,request.projectId,source.stageId,source.revision])).rows[0];need(row,'EXACT_SAVED_REVISION_MISSING');
   const protectedStage=guard({kind:'project',id:request.projectId},SharedStage.parse({projectId:row.project_id,stageId:row.stage_id,revision:row.revision,content:row.content,sourceStageRevisions:row.source_stage_revisions,updatedBy:row.updated_by,updatedAt:new Date(row.updated_at).toISOString()}));
   const savedResult=discloseDecided(protectedStage,visibility.base);need(isDisclosed(savedResult),'SOURCE_NOT_DISCLOSED');const saved=savedResult.payload;
   const material=projection.materials.find(m=>m.kind===source.kind&&m.stageId===source.stageId&&m.revision===source.revision);need(material,'FROZEN_MATERIAL_COORDINATES_MISSING');
   let payload:unknown={draft:saved.content.draft,...(saved.content.summaryReport?{studentReportDraft:saved.content.summaryReport}:{}),sourceStageRevisions:saved.sourceStageRevisions};
   let reflectionFacts:unknown;
   if(source.kind==='return'){
    need(selector.purpose==='stage'&&selector.returnRevision===source.revision,'RETURN_SELECTOR_MISMATCH');const reflection=readConfirmedAidtReturn(saved.content.draft,selector.stageId);need(reflection,'CONFIRMED_MATCHED_RETURN_REQUIRED');
    payload={trust:'untrusted-student-material',evidenceStatus:'not-verified',reviewStatus:'editor-confirmed',targetStage:reflection.targetStage,questionSourceStageRevision:reflection.snapshot.sourceStageRevision,fields:reflection.fields};
    reflectionFacts={confirmed:true,targetStage:reflection.targetStage,questionSourceStageRevision:reflection.snapshot.sourceStageRevision,fieldNames:Object.keys(reflection.fields).sort(),fieldHashes:Object.fromEntries(Object.entries(reflection.fields).map(([k,v])=>[k,hash(v)]))};
   }
   const full=aidtContextCanonicalJson(payload);need(full.startsWith(material.excerpt)&&material.truncated===source.truncated&&(source.truncated||full===material.excerpt),'SAVED_PROJECTION_DOES_NOT_MATCH_FROZEN_EXCERPT');
   const question=saved.stageId===6?readAidtQuestionSnapshot(saved.content.draft):null;
   sourceFacts.push({kind:source.kind,stageId:source.stageId,revision:source.revision,currentHeadRevision:heads.get(source.stageId)??null,selectedIsCurrentHead:heads.get(source.stageId)===source.revision,sourceStageRevisions:saved.sourceStageRevisions,updatedByHash:hash(saved.updatedBy),updatedAt:saved.updatedAt,contentHash:hash(aidtContextCanonicalJson(saved.content)),excerptHash:hash(material.excerpt),excerptUtf8Bytes:Buffer.byteLength(material.excerpt),truncated:source.truncated,exactSavedProjectionMatches:true,...(question?{questionSnapshot:{sourceStageRevision:question.sourceStageRevision,prototypeDesignIdHash:question.prototypeDesignId?hash(question.prototypeDesignId):null,prototypeVersionIdHash:question.prototypeVersionId?hash(question.prototypeVersionId):null}}:{}),...(reflectionFacts?{reflection:reflectionFacts}:{})});
  }
  const events=await store.eventsIn(session,orgId,request.runId),application=reduceAidtApplication(request.runId,events);
  const dispatch=events.filter(e=>e.event.kind==='message-dispatch-observed'),resume=events.filter(e=>e.event.kind==='checkpoint-resume-observed');
  const hashes={selector:hash(aidtContextSelectorJson(selector)),snapshot:hash(aidtContextSnapshotJson(frozen.snapshot)),block:hash(frozen.snapshot.modelReferenceBlock)};
  need(hashes.selector===frozen.selectorHash&&hashes.snapshot===frozen.snapshotHash&&hashes.block===frozen.snapshot.modelReferenceBlockHash,'CANONICAL_HASH_MISMATCH');
  for(const event of dispatch)need(event.event.kind==='message-dispatch-observed'&&event.event.snapshotHash===frozen.snapshotHash&&event.event.assembledContextHash===hashes.block,'DISPATCH_OBSERVATION_HASH_MISMATCH');
  for(const event of resume){need(event.event.kind==='checkpoint-resume-observed','RESUME_KIND_MISMATCH');const fact=event.event;if(fact.inheritedMessageDispatchAttemptId!==null)need(dispatch.some(prior=>prior.seq<event.seq&&prior.event.attemptId===fact.inheritedMessageDispatchAttemptId)&&fact.assembledContextHash===hashes.block,'RESUME_INHERITANCE_MISMATCH');}
  if(request.receipt){const receipt=request.receipt;need(receipt.runId===request.runId&&receipt.projectId===request.projectId&&receipt.skillVersionId===frozen.snapshot.focus.skillVersionId&&receipt.snapshotHash===hashes.snapshot,'INDEPENDENT_RECEIPT_SCOPE_MISMATCH');const receiptSelector=AidtContextSelector.parse({schemaVersion:1,projectId:receipt.projectId,purpose:receipt.purpose,stageRevisions:receipt.stageRevisions,...(receipt.purpose==='stage'?{stageId:receipt.stageId,...(receipt.returnRevision===undefined?{}:{returnRevision:receipt.returnRevision})}:{historyRevisions:receipt.historyRevisions})});need(aidtContextSelectorJson(receiptSelector)===aidtContextSelectorJson(selector),'INDEPENDENT_RECEIPT_SELECTOR_MISMATCH');if(receipt.application.state===application.state)need(aidtContextCanonicalJson(receipt.application)===aidtContextCanonicalJson(application),'INDEPENDENT_RECEIPT_APPLICATION_MISMATCH');}
  let oldProtection:unknown=null;
  if(restored&&request.priorRunIds?.length){
   const oldIds=request.priorRunIds,baseline=restored.plan.protectedBaseline.protectedHashes;
   const protectedRows=[];
   for(const table of ['agent_runs','agent_run_context_snapshots','aidt_run_context_snapshots','aidt_run_context_applications','chat_messages'] as const){
    const filter=table==='chat_messages'?'created_at<=$2::timestamptz':table==='agent_runs'?'id=ANY($2::text[])':'run_id=ANY($2::text[])';
    const second=table==='chat_messages'?restored.checkpointCreatedAt:oldIds;
    const rows=(await session.query<{row:unknown}>(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE org_id=$1 AND ${filter} ORDER BY to_jsonb(t)::text`,[orgId,second])).rows.map(r=>r.row);
    const actual={count:rows.length,sha256:hash(JSON.stringify(rows))};need(actual.count===baseline[table].count&&actual.sha256===baseline[table].sha256,'ORIGINAL_RUN_OR_MESSAGE_SUBSET_CHANGED');protectedRows.push({table,...actual,matchesOriginal:true});
   }
   const oldVersion=(await session.query<{row:unknown}>('SELECT to_jsonb(v) AS row FROM agent_versions v WHERE org_id=$1 AND id=$2',[orgId,restored.plan.protectedBaseline.oldVersionId])).rows[0]?.row;need(oldVersion&&hash(JSON.stringify(oldVersion))===restored.plan.protectedBaseline.oldVersionHash,'ORIGINAL_IMMUTABLE_VERSION_CHANGED');
   const oldRuns=(await session.query<{id:string;thread_id:string;status:string;remote_run_id:string|null}>('SELECT id,thread_id,status,remote_run_id FROM agent_runs WHERE org_id=$1 AND id=ANY($2::text[])',[orgId,oldIds])).rows;
   const isNew=!oldIds.includes(request.runId);if(isNew){need(oldRuns.length===oldIds.length&&oldRuns.every(r=>r.thread_id!==request.threadId),'NEW_RUN_REUSES_OLD_THREAD');need(run.agent_version_id===restored.plan.protectedBaseline.newVersionId,'NEW_RUN_NOT_CANONICAL_AGENT_VERSION');}
   const oldEvents=(await session.query<{event:{remoteThreadId?:string;remoteRunId?:string}}>('SELECT event FROM aidt_run_context_applications WHERE org_id=$1 AND run_id=ANY($2::text[])',[orgId,oldIds])).rows;
   const oldRemoteThreads=new Set(oldEvents.flatMap(r=>r.event.remoteThreadId?[r.event.remoteThreadId]:[]));
   const currentRemote=events.flatMap(r=>'remoteThreadId'in r.event&&r.event.remoteThreadId?[r.event.remoteThreadId]:[]);
   if(isNew)need(currentRemote.every(id=>!oldRemoteThreads.has(id))&&oldRuns.every(r=>!run.remote_run_id||r.remote_run_id!==run.remote_run_id),'NEW_REMOTE_CHECKPOINT_REUSES_OLD_RUN');
   oldProtection={protectedRows,oldImmutableVersionHashMatches:true,newRunUsesCanonicalAgentVersion:isNew?run.agent_version_id===restored.plan.protectedBaseline.newVersionId:null,currentRunIsNew:isNew,oldRuns:oldRuns.map(r=>({runId:r.id,status:r.status,threadIdHash:hash(r.thread_id),remoteRunIdHash:r.remote_run_id?hash(r.remote_run_id):null})),newLocalThreadSeparate:isNew?oldRuns.every(r=>r.thread_id!==request.threadId):null,newRemoteNamespaceSeparate:isNew?currentRemote.length>0&&currentRemote.every(id=>!oldRemoteThreads.has(id)):null,currentRemoteThreadIdHashes:[...new Set(currentRemote)].map(hash),currentRemoteRunIdHash:run.remote_run_id?hash(run.remote_run_id):null};
  }
  const report={kind:'authorized-read-only-real-run-source-audit',auditedAt:new Date().toISOString(),runId:request.runId,projectId:request.projectId,threadId:request.threadId,principalUserIdHash:hash(request.userId),agentVersionId:run.agent_version_id,runStatus:run.status,restoredResourceBinding:restored?.report??null,oldProtection,currentProjectStatus:profile.status,selector,focus:frozen.snapshot.focus,approvedPackage:pack,hashes,canonicalHashesMatch:true,persistedHumanTextHash:humanTextHash,persistedHumanMatchesExpected:request.expectedHumanTextHash?humanTextHash===request.expectedHumanTextHash:null,exactSources:sourceFacts,omissions:frozen.snapshot.omissions,truncated:frozen.snapshot.truncated,application,journal:events.map(e=>({seq:e.seq,kind:e.event.kind,attemptId:e.event.attemptId,occurredAt:e.occurredAt,snapshotHash:e.event.snapshotHash,...('assembledContextHash'in e.event?{assembledContextHash:e.event.assembledContextHash}:{}),...(e.event.kind==='checkpoint-resume-observed'?{inheritedMessageDispatchAttemptId:e.event.inheritedMessageDispatchAttemptId}:{})})),dispatchObservationCount:dispatch.length,resumeObservationCount:resume.length,serverDispatchObservationMatchesFrozenBlock:dispatch.length>0,independentReceiptProvided:!!request.receipt,supplierConsumptionProvenByAudit:false,studentResearchValidityProven:false,rawStudentTextIncluded:false,privateConfigurationIncluded:false,databaseReadOnly:true,modelRequestsSent:0,dataWrites:0};
  mkdirSync(dirname(outputPath),{recursive:true,mode:0o700});writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n',{mode:0o600});return {status:'audited',runId:request.runId,reportPath:outputPath,runStatus:run.status,dispatchObservations:dispatch.length,resumeObservations:resume.length};
 });}finally{await db.close();}
}
const [runtimePath,requestPath,outputPath]=process.argv.slice(2);
if(!runtimePath||!requestPath||!outputPath){console.error('AUDIT_EXPLICIT_PATHS_REQUIRED');process.exitCode=2;}
else await audit(runtimePath,requestPath,outputPath).then(result=>console.log(JSON.stringify(result))).catch(error=>{const code=error instanceof Error&&/^[A-Z][A-Z0-9_]{1,100}$/.test(error.message)?error.message:'AUDIT_FAILED_CLOSED';console.error(code);process.exitCode=1;});
