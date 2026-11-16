import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { afterAll,afterEach,beforeAll,beforeEach,expect,it } from 'vitest';
import { AIDT_STAGE_IDENTITIES,type AidtContextSelector } from '@repo/contracts/aidt-run-context';
import { PgAidtRunContextProvider } from '../../src/infrastructure/aidt-run-context/pg-aidt-run-context-provider';
import { PgAidtRunContextStore } from '../../src/infrastructure/aidt-run-context/pg-aidt-run-context-store';
import { PgChatMessageCommandRepository } from '../../src/infrastructure/chat/pg-chat-message-command-repository';
import { PgDatabase } from '../../src/infrastructure/db/pg-database';
import { appConfig } from '../../src/infrastructure/db/pg-config';
import { FileSkillStarterPackSource,REPO_SKILL_STARTER_PACK_ROOT } from '../../src/infrastructure/skill/file-skill-starter-pack-source';
import { asApp,ensureDatabase,migrateOnce } from '../support/db';
import { createBridgePgFixture } from './support/real-pg-fixture';

/** Real PostgreSQL acceptance only. No execution worker, HTTP/model provider, or prototype generation. */
let db:PgDatabase,fixture:Awaited<ReturnType<typeof createBridgePgFixture>>;
let contexts:PgAidtRunContextProvider,store:PgAidtRunContextStore,commands:PgChatMessageCommandRepository;
let pin:Awaited<ReturnType<typeof fixture.mountApprovedSkill>>,agent:Awaited<ReturnType<typeof fixture.publishAgent>>;
const evidence:{name:string;facts:unknown}[]=[];
beforeAll(async()=>{ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());});
beforeEach(async()=>{
 fixture=await createBridgePgFixture(db);
 pin=await fixture.mountApprovedSkill('aidt-methods','1.3.0',AIDT_STAGE_IDENTITIES[1].skill);
 agent=await fixture.publishAgent([pin.versionId]);
 store=new PgAidtRunContextStore(db);
 contexts=new PgAidtRunContextProvider(db,new FileSkillStarterPackSource(REPO_SKILL_STARTER_PACK_ROOT),store,()=>true);
 commands=new PgChatMessageCommandRepository(db,undefined,contexts);
});
afterEach(async()=>{await fixture?.cleanup();});
afterAll(async()=>{await db?.close();const out=process.env.AIDT_RETURN_PG_EVIDENCE_FILE;if(out){if(!isAbsolute(out))throw new Error('ABSOLUTE_EVIDENCE_PATH_REQUIRED');writeFileSync(out,JSON.stringify({kind:'real-pg-return-acceptance-only',modelProviderConstructed:false,executionWorkerCalled:false,supplierCalls:0,prototypeGenerationClaimed:false,evidence},null,2));}});
function selector(revision:number):AidtContextSelector{return {schemaVersion:1,projectId:fixture.projectId,purpose:'stage',stageId:2,stageRevisions:[{stageId:1,revision:fixture.s1.revision},{stageId:2,revision:fixture.s2.revision}],returnRevision:revision};}
function input(revision:number){return {projectId:fixture.projectId,threadId:fixture.threadId,actorId:fixture.studentId,clientMessageId:randomUUID(),text:'Synthetic student asks for help; saved reflection is not copied into this message.',selectedAgentId:agent.agentId,messageId:`${fixture.prefix}-message-${randomUUID()}`,runId:`${fixture.prefix}-run-${randomUUID()}`,snapshot:agent,aidtContext:selector(revision)};}
async function counts(orgId=fixture.orgId){return asApp(orgId,async s=>(await s.query<{human:string;runs:string;snapshots:string;applications:string}>(`SELECT (SELECT count(*) FROM chat_messages WHERE org_id=$1 AND author_kind='human') AS human,(SELECT count(*) FROM agent_runs WHERE org_id=$1) AS runs,(SELECT count(*) FROM aidt_run_context_snapshots WHERE org_id=$1) AS snapshots,(SELECT count(*) FROM aidt_run_context_applications WHERE org_id=$1) AS applications`,[orgId])).rows[0]!);}
async function savedReflection(overrides:Record<string,string>={}){
 const fifth=await fixture.save(5,{verificationQuestion:`OLD_QUESTION_${fixture.prefix}`,version:'Synthetic legacy paper label; not a generated prototype'});
 const fields={questionSnapshot:JSON.stringify({schemaVersion:1,question:fifth.content.draft.fields.verificationQuestion,beforeTestBelief:`BEFORE_${fixture.prefix}`,verificationBasis:'Synthetic discussion, not evidence',verificationLimits:'No real user test',prototypeRef:'Synthetic legacy paper label; not a generated prototype',sourceStageRevision:fifth.revision}),version:'Synthetic legacy paper label; not a generated prototype',understandingChangeStatus:'changed',afterTestBelief:`AFTER_${fixture.prefix}`,understandingEvidence:'Synthetic student explanation; unverified',unresolvedQuestions:'No real field study',returnStep:'2',returnReason:`REASON_${fixture.prefix}`,nextAction:`NEXT_${fixture.prefix}`,reflectionConfirmed:'true',secretOtherField:`OMITTED_EXTRA_${fixture.prefix}`,...overrides};
 return {fifth,sixth:await fixture.save(6,fields,[{stageId:5,revision:fifth.revision}]),fields};
}
it('confirmed old S6 revision targets S2 and freezes only its whitelisted reflection despite newer S5/S6 heads',async()=>{
 const {fifth,sixth,fields}=await savedReflection();
 const newFifth=await fixture.save(5,{verificationQuestion:`NEW_HEAD_${fixture.prefix}`});
 const newSixth=await fixture.save(6,{...fields,reflectionConfirmed:'false',returnStep:'3',returnReason:`NEW_REFLECTION_${fixture.prefix}`},[{stageId:5,revision:newFifth.revision}]);
 const beforeStages=await Promise.all([1,2,3,4,5,6].map(id=>fixture.stages.get(fixture.actor,id)));
 const request=input(sixth.revision);await commands.accept(fixture.orgId,request);
 const guarded=await db.withTenant(fixture.orgId,s=>store.readIn(s,fixture.orgId,request.runId));expect(guarded).not.toBeNull();
 const frozen=await contexts.resolve(fixture.orgId,fixture.actor,guarded!);
 expect(frozen.snapshot.sources.map(({kind,stageId,revision})=>({kind,stageId,revision}))).toEqual([{kind:'stage',stageId:2,revision:fixture.s2.revision},{kind:'return',stageId:6,revision:sixth.revision},{kind:'stage',stageId:1,revision:fixture.s1.revision}]);
 const projection=JSON.parse(frozen.snapshot.modelReferenceBlock.split('\n')[2]!) as {materials:{kind:string;excerpt:string}[]};
 const reflected=JSON.parse(projection.materials.find(row=>row.kind==='return')!.excerpt) as {fields:Record<string,string>;questionSourceStageRevision:number};
 expect(Object.keys(reflected).sort()).toEqual(['evidenceStatus','fields','questionSourceStageRevision','reviewStatus','targetStage','trust']);
 expect(Object.keys(reflected.fields).sort()).toEqual(['afterTestBelief','beforeTestBelief','nextAction','originalQuestion','prototypeRef','returnReason','understandingChangeStatus','understandingEvidence','unresolvedQuestions']);
 expect(reflected.questionSourceStageRevision).toBe(fifth.revision);
 expect(reflected.fields).toMatchObject({originalQuestion:fifth.content.draft.fields.verificationQuestion,beforeTestBelief:JSON.parse(fields.questionSnapshot!).beforeTestBelief,afterTestBelief:fields.afterTestBelief,returnReason:fields.returnReason,nextAction:fields.nextAction});
 for(const forbidden of [fields.secretOtherField,newFifth.content.draft.fields.verificationQuestion,newSixth.content.draft.fields.returnReason])expect(frozen.snapshot.modelReferenceBlock.includes(forbidden!)).toBe(false);
 expect(await counts()).toEqual({human:'1',runs:'1',snapshots:'1',applications:'0'});
 const receipt=await contexts.receipt(fixture.actor,request.runId);expect(receipt.application.state).toBe('prepared');expect(receipt.returnRevision).toBe(sixth.revision);expect(receipt.skillVersionId).toBe(pin.versionId);
 expect(await Promise.all([1,2,3,4,5,6].map(id=>fixture.stages.get(fixture.actor,id)))).toEqual(beforeStages);
 evidence.push({name:'confirmed-old-return',facts:{selectedS6Revision:sixth.revision,currentS6Revision:newSixth.revision,questionSourceS5Revision:fifth.revision,currentS5Revision:newFifth.revision,targetStage:2,whitelistOnly:true,extraFieldExcluded:true,currentHeadsExcluded:true,snapshotHash:frozen.snapshotHash,blockHash:frozen.snapshot.modelReferenceBlockHash,preparedNotDispatched:true,stageRowsUnchanged:true,modelCalls:0}});
});
it.each(['unconfirmed','wrong-target','missing-exact-revision','foreign-project-revision','cross-org','nonmember'] as const)('%s rejects before any human/run/snapshot/application insertion',async problem=>{
 const {sixth,fields}=await savedReflection(problem==='unconfirmed'?{reflectionConfirmed:'false'}:problem==='wrong-target'?{returnStep:'3'}:{});
 let request=input(sixth.revision),orgId=fixture.orgId;
 if(problem==='missing-exact-revision')request={...request,aidtContext:selector(999999)};
 if(problem==='cross-org')orgId=fixture.otherOrgId;
 if(problem==='nonmember')request={...request,actorId:fixture.outsiderId};
 if(problem==='foreign-project-revision'){
  const actor={orgId:fixture.orgId,projectId:fixture.privateProjectId,userId:fixture.outsiderId};
  const foreignFields={...fields,questionSnapshot:JSON.stringify({...JSON.parse(fields.questionSnapshot!),sourceStageRevision:null})};
  for(let n=0;n<2;n++)await fixture.stages.save(actor,{projectId:actor.projectId,stageId:6,operationId:randomUUID(),expectedRevision:n,content:{schemaVersion:1,draft:{fields:foreignFields,ideas:[],selectedIdeaId:''}},sourceStageRevisions:[]});
  request={...request,aidtContext:selector(2)};
 }
 const before=await counts(),otherBefore=await counts(fixture.otherOrgId);
 await expect(commands.accept(orgId,request)).rejects.toThrow();
 expect(await counts()).toEqual(before);expect(await counts(fixture.otherOrgId)).toEqual(otherBefore);
 evidence.push({name:`reject-${problem}`,facts:{humanRunSnapshotApplicationRowsUnchanged:true,modelCalls:0,stageScopeSubstitution:false}});
});
