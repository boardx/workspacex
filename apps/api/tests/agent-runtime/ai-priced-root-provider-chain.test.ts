import {createServer,type Server} from 'node:http';
import {createHash,randomUUID} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {withCommittedAiPolicyDecision} from '../../src/application/agent-run/committed-ai-policy-decision';
import {AiQuotaPolicyError} from '../../src/application/agent-run/ai-quota-policy-error';
import {executeQueuedRuns} from '../../src/application/agent-run/execute-run';
import {writeBackPendingRuns} from '../../src/application/agent-run/writeback';
import {PgAgentRunRepository} from '../../src/infrastructure/agent-run/pg-agent-run-repository';
import type {RunAiAdmission} from '../../src/application/agent-run/priced-run-model';
import {Configuration} from '@repo/contracts/ai-policy';
import {executePricedModelCall,type AiModelSelection} from '../../src/application/agent-run/execute-priced-model-call';
import {ConfiguredModelProvider} from '../../src/infrastructure/agent-run/configured-model-provider';
import {PgAiAdmissionRepository} from '../../src/infrastructure/auth/pg-ai-admission-repository';
import {PgTokenUsageRepository} from '../../src/infrastructure/auth/pg-token-usage-repository';
import {PgAiUsageRepository} from '../../src/infrastructure/auth/pg-ai-usage-repository';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {toOrgId} from '../../src/domain/org-id';
import {addChatThread,addChatMessage} from '../support/chat-db';
import {seedAgentRun} from '../support/agent-run-db';
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asApp,resetOrgs} from '../support/db';
/** Real HTTP/PG coordinator boundary, not executeQueuedRuns/lease acceptance.
 * Classification/bounds are test-only fixtures, not deployment/tokenizer proof. */
let db:PgDatabase,server:Server,model:ConfiguredModelProvider;
const orgs:string[]=[],requests:Array<{model:string;max_tokens:number}>=[];
beforeAll(async()=>{
 await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());
 server=createServer(async(req,res)=>{
  if(req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return;}
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  requests.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  res.setHeader('content-type','application/json');res.end(JSON.stringify({choices:[{message:{content:'HTTP answer'}}],usage:{prompt_tokens:2,completion_tokens:1,total_tokens:3}}));
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(!address||typeof address==='string')throw new Error('missing address');
 model=new ConfiguredModelProvider({provider:'test-http',baseUrl:`http://127.0.0.1:${address.port}/v1`,apiKey:'fixture-only',timeoutMs:5000,streamEnabled:false,visionModelIds:new Set(),thinkingDisableModelIds:new Set(),bailianExtensionsEnabled:false});
});
afterAll(async()=>{
 await model?.close();
 if(server)await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 await db?.close();await resetOrgs(orgs);
});
async function fixture(plan:'ordinary'|'enterprise',cost='100',degrade=false,tokens='100',rules=false){
 const org=toOrgId('priced-http-'+randomUUID());orgs.push(org);const project='project-'+org,user='caller';
 await seedOrg({orgId:org,projectId:project});await addOrgMember(org,user,'consultant',null);
 const thread='thread-'+org,run='root-'+org;
 await addChatThread({orgId:org,id:thread,projectId:project,visibilityScope:'plenary',createdBy:user});
 await seedAgentRun({orgId:org,id:run,threadId:thread,authorId:user});
 const window={start:new Date(Date.now()-60000).toISOString(),end:new Date(Date.now()+3600000).toISOString(),timezone:'Etc/UTC'};
 const prices=['primary','cheap'].map((modelId,index)=>({modelId,modelProvider:'test-http',runtimeModelId:'runtime-'+modelId,inputMicrosPerMillion:index?'1000000':'2000000',outputMicrosPerMillion:index?'1000000':'2000000',cachedInputMicrosPerMillion:index?'1000000':'2000000',maxInputTokens:10,maxOutputTokens:2}));
 const configuration=Configuration.parse({window,ordinaryTokensPerUser:plan==='enterprise'?'0':tokens,costMicrosPerUser:cost,currency:'CNY',prices,fallbackModelIds:['cheap'],maxAttempts:2,...(degrade||rules?{tokenControls:{quotaSource:'organization-template',warningAtTokens:degrade?'0':null,degradeAtTokens:degrade?'0':null,memberOverrides:[],enforceLimitRules:rules}}:{})});
 const priceVersion=randomUUID();await asApp(org,async c=>{
  await c.query('INSERT INTO organization_plans(org_id,plan,version,updated_by) VALUES($1,$2,1,$3)',[org,plan,user]);
  await c.query('INSERT INTO organization_ai_policy_changes(id,org_id,version,configuration,price_version,actor_id,reason) VALUES($1,$2,1,$3::jsonb,$4,$5,$6)',[randomUUID(),org,JSON.stringify(configuration),priceVersion,user,'HTTP acceptance fixture']);
  await c.query('INSERT INTO organization_ai_policies(org_id,version,configuration,price_version,updated_by) VALUES($1,1,$2::jsonb,$3,$4)',[org,JSON.stringify(configuration),priceVersion,user]);
 });
 const admission=new PgAiAdmissionRepository(db),usage=new PgTokenUsageRepository(db),read=new PgAiUsageRepository(db);
 const subject={orgId:org,userId:user,runId:run,executionAttemptId:'root-attempt-'+org,logicalCallId:randomUUID(),projectId:project,threadId:thread,agentId:null,callPurpose:'primary' as const,primaryModelId:'primary',confidentiality:'non-confidential' as const,requiredCapabilities:[]};
 const notices:Array<{selection:AiModelSelection;httpCount:number}>=[];
 const deps={onModelSelection:async(selection:AiModelSelection)=>{notices.push({selection,httpCount:requests.length});},model,policy:admission,admission,usage,currentCandidates:async()=>({pool:prices.map(p=>({modelId:p.modelId,kind:'closed-api' as const,shape:'single' as const,status:'已启用' as const,complianceAttrs:[],members:[],contextWindow:100,capabilityTags:[]})),bindings:prices.map(p=>({...p,contextWindow:100,capabilityTags:[],outputCapSupported:true,billedOutputBoundVerified:true,accountingComplete:true}))}),measure:async(request:{modelProvider:string;modelId:string;serializedBody:string})=>({modelProvider:request.modelProvider,runtimeModelId:request.modelId,tokens:2,implementation:'HTTP fixture only',version:'1',serializedBodySha256:createHash('sha256').update(request.serializedBody).digest('hex'),source:'provider-count' as const})};
 return {org,subject,deps,read,notices,configuration,query:{...window,userId:user,projectId:project,runId:subject.runId,limit:20},priceVersion};
}
it('ordinary HTTP receipt settles and intersects user/project/run/model reads',async()=>{
 const f=await fixture('ordinary'),before=requests.length;
 expect((await executePricedModelCall(f.subject,{system:'s',user:'u'},f.deps)).text).toBe('HTTP answer');
 expect(requests.slice(before)).toEqual([expect.objectContaining({model:'runtime-primary',max_tokens:2})]);
 const detail=await f.read.calls(f.org,{...f.query,modelProvider:'test-http',modelId:'runtime-primary'});
 expect(detail.calls).toHaveLength(1);expect(detail.calls[0]).toMatchObject({userId:'caller',projectId:f.subject.projectId,runId:f.subject.runId,executionAttemptId:f.subject.executionAttemptId,inputTokens:'2',outputTokens:'1',totalTokens:'3',costMicros:'6',priceVersion:f.priceVersion});
 expect((await f.read.summary(f.org,f.query)).current).toMatchObject({callCount:1,totalTokens:'3',unknownCalls:0});
 expect((await f.read.calls(f.org,{...f.query,userId:'different'})).calls).toEqual([]);
 expect((await asApp(f.org,c=>c.query('SELECT state,settled_tokens,settled_cost_micros FROM ai_request_reservations WHERE org_id=$1',[f.org]))).rows).toEqual([{state:'settled',settled_tokens:'3',settled_cost_micros:'6'}]);
});
it('soft threshold sends only authorized cheaper model to HTTP',async()=>{
 const f=await fixture('ordinary','100',true),before=requests.length;
 expect((await executePricedModelCall(f.subject,{system:'s',user:'u'},f.deps)).aiSelection).toMatchObject({modelId:'cheap',fallbackUsed:true,logicalAttempt:1});
 expect(requests.slice(before).map(request=>request.model)).toEqual(['runtime-cheap']);
 expect(f.notices.map(row=>[row.selection.modelId,row.selection.notice??null,row.httpCount])).toEqual([['primary',null,before],['cheap','quota-degradation',before],['cheap','token-warning',before]]);
 expect((await f.read.calls(f.org,f.query)).calls).toHaveLength(1);
});
it('enterprise zero token allowance still admits once and enforces finite money',async()=>{
 const f=await fixture('enterprise','9'),before=requests.length;
 await executePricedModelCall(f.subject,{system:'s',user:'u'},f.deps);
 await expect(executePricedModelCall({...f.subject,logicalCallId:randomUUID()},{system:'s',user:'u'},f.deps)).rejects.toThrow('COST_LIMIT_REACHED');
 expect(requests.slice(before)).toHaveLength(1);
});

it('ordinary hard token allowance cannot be bypassed with an authorized cheaper model',async()=>{
 const f=await fixture('ordinary','100',false,'3'),before=requests.length;
 await expect(executePricedModelCall(f.subject,{system:'s',user:'u'},f.deps)).rejects.toThrow('TOKEN_LIMIT_REACHED');
 expect(requests.slice(before)).toEqual([]);
 expect((await f.read.summary(f.org,f.query)).current.callCount).toBe(0);
});
it('confidential task never degrades or dispatches to closed API despite cheap authorization',async()=>{
 const f=await fixture('ordinary','100',true),before=requests.length;
 await expect(executePricedModelCall({...f.subject,confidentiality:'confidential'},{system:'s',user:'u'},f.deps)).rejects.toThrow('AI_MODEL_UNAVAILABLE');
 expect(requests.slice(before)).toEqual([]);
 expect((await asApp(f.org,c=>c.query('SELECT id FROM ai_request_reservations WHERE org_id=$1',[f.org]))).rows).toEqual([]);
});

async function addBlockRule(f:Awaited<ReturnType<typeof fixture>>,scope:'model'|'team',threshold:string){
 const id=randomUUID(),ref=scope==='model'?'primary':`${f.org}-team-energy`;
 await asApp(f.org,c=>c.query(`INSERT INTO limit_rules(id,org_id,scope_kind,scope_ref,model_id,window_kind,threshold_tokens,action,enabled)
  VALUES($1,$2,$3,$4,NULL,'hour',$5,'block',true)`,[id,f.org,scope,ref,threshold]));
 return id;
}
function reserveInput(f:Awaited<ReturnType<typeof fixture>>,userId='caller'){
 return {requestId:randomUUID(),userId,windowStart:f.configuration.window.start,windowEnd:f.configuration.window.end,
  maximumTokens:4n,maximumCostMicros:8n,modelProvider:'test-http',modelId:'runtime-primary',currency:'CNY',priceVersion:f.priceVersion,
  formalModelId:'primary',agentId:null,tokenPolicy:{primaryModelId:'primary',selectedModelId:'primary',allowDegradation:true}};
}
it('model and team rules count actual used plus cross-user held plus projected maximum atomically',async()=>{
 for(const scope of ['model','team'] as const){
  const f=await fixture('ordinary','100',false,'100',true),before=requests.length;
  await addOrgMember(f.org,'second','consultant',`${f.org}-team-energy`);
  await asApp(f.org,c=>c.query('UPDATE org_memberships SET team_id=$2 WHERE org_id=$1 AND user_id=$3',[f.org,`${f.org}-team-energy`,'caller']));
  await executePricedModelCall(f.subject,{system:'s',user:'u'},f.deps); // actual settled usage = 3
  await addBlockRule(f,scope,'10');
  for(const user of ['caller','second'])await f.deps.policy.resolveBudgetPolicy(f.org,user);
  const inputs=[reserveInput(f),reserveInput(f,'second')];
  const decisions=await Promise.all(inputs.map(input=>f.deps.admission.reserve(f.org,input)));
  expect(decisions.map(row=>row.decision).sort()).toEqual(['AI_LIMIT_RULE_BLOCKED','allowed']);
  const snapshot=await asApp(f.org,c=>c.query(`SELECT (SELECT count(*)::int FROM ai_request_reservations WHERE org_id=$1 AND state='held') AS held,
   (SELECT count(*)::int FROM ai_limit_rule_decisions WHERE org_id=$1) AS decisions,
   (SELECT count(*)::int FROM limit_events WHERE org_id=$1) AS events`,[f.org]));
  expect(snapshot.rows).toEqual([{held:1,decisions:3,events:1}]); // first actual call also retained its allowed decision
  expect(requests.slice(before)).toHaveLength(1); // reservations never dispatch independently
 }
});
it('blocked decisions and events survive refusal, replay once, and reject changed formal model or agent',async()=>{
 const f=await fixture('ordinary','100',false,'100',true),before=requests.length;
 const ruleId=await addBlockRule(f,'model','1');await f.deps.policy.resolveBudgetPolicy(f.org,'caller');
 const input=reserveInput(f);
 expect((await f.deps.admission.reserve(f.org,input)).decision).toBe('AI_LIMIT_RULE_BLOCKED');
 expect((await f.deps.admission.reserve(f.org,input)).decision).toBe('AI_LIMIT_RULE_BLOCKED');
 await expect(f.deps.admission.reserve(f.org,{...input,formalModelId:'cheap'})).rejects.toThrow();
 await expect(f.deps.admission.reserve(f.org,{...input,agentId:'changed-agent'})).rejects.toThrow('AI_LIMIT_RULE_REPLAY_MISMATCH');
 const audit=await asApp(f.org,c=>c.query(`SELECT d.request_id,d.result->>'decision' AS decision,e.rule_id,e.action_taken,
   e.observed_tokens::text,e.threshold_tokens::text FROM ai_limit_rule_decisions d JOIN limit_events e ON e.id=d.event_id
   WHERE d.org_id=$1`,[f.org]));
 expect(audit.rows).toEqual([{request_id:input.requestId,decision:'AI_LIMIT_RULE_BLOCKED',rule_id:ruleId,action_taken:'block',observed_tokens:'4',threshold_tokens:'1'}]);
 expect((await asApp(f.org,c=>c.query('SELECT id FROM ai_request_reservations WHERE org_id=$1',[f.org]))).rows).toEqual([]);
 expect(requests.slice(before)).toEqual([]);
});
it('enterprise bypasses opted-in product token rules while HTTP calls remain subject to finite cost',async()=>{
 const f=await fixture('enterprise','9',false,'0',true),before=requests.length;
 await addBlockRule(f,'model','1');
 await executePricedModelCall(f.subject,{system:'s',user:'u'},f.deps);
 await expect(executePricedModelCall({...f.subject,logicalCallId:randomUUID()},{system:'s',user:'u'},f.deps)).rejects.toThrow('COST_LIMIT_REACHED');
 expect(requests.slice(before)).toHaveLength(1);
 expect((await asApp(f.org,c=>c.query('SELECT id FROM limit_events WHERE org_id=$1',[f.org]))).rows).toEqual([]);
});

// Instrument real tenant sessions solely for deterministic scheduling. Every SQL
// reaches PostgreSQL; no result/lock/transaction is fabricated by this barrier.
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
function scheduledDb(pauseAfter:(sql:string)=>boolean){
 const entered=deferred(),release=deferred(),attempted=deferred();let pid=0,paused=false;
 const database:import('../../src/application/ports/database.port').DatabasePort={
  withTenant:(org,fn)=>db.withTenant(org,async session=>{
   await session.query("SET LOCAL statement_timeout='4500ms'");await session.query("SET LOCAL lock_timeout='3500ms'");
   pid=(await session.query<{pid:number}>('SELECT pg_backend_pid() AS pid')).rows[0]!.pid;
   return fn({query:async<R>(sql:string,params?:readonly unknown[])=>{
    attempted.resolve();const result=await session.query<R>(sql,params);
    if(!paused&&pauseAfter(sql)){paused=true;entered.resolve();await release.promise;}
    return result;
   }});
  }),withoutTenant:fn=>db.withoutTenant(fn),close:async()=>{},
 };
 return {database,entered,release,attempted,get pid(){return pid;}};
}
async function bounded<T>(operation:Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([operation,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('PG concurrency fixture deadline')),6000);})]);}
 finally{if(timer)clearTimeout(timer);}
}
async function assertWaiting(org:ReturnType<typeof toOrgId>,pid:()=>number){
 for(let attempt=0;attempt<100;attempt++){
  const rows=await asApp(org,c=>c.query('SELECT 1 FROM pg_locks WHERE pid=$1 AND NOT granted',[pid()]));
  if(rows.rows.length)return;
 }
 throw new Error('second PostgreSQL transaction never reached a lock wait');
}
it('policy org UPDATE and concurrent physical start/ledger inserts finish under shared rule-first lock',async()=>{
 for(const write of ['start','ledger'] as const){
  const f=await fixture('ordinary'),held=scheduledDb(sql=>sql.includes("kind='organization' FOR UPDATE")),writer=scheduledDb(()=>false);
  const resolving=new PgAiAdmissionRepository(held.database).resolveBudgetPolicy(f.org,'caller');
  let recording:Promise<void>|undefined;
  try{
   await bounded(held.entered.promise);
   const usage=new PgTokenUsageRepository(writer.database),requestId=randomUUID(),startedAt=new Date().toISOString();
   recording=write==='start'?usage.startRequest(f.org,{requestId,userId:'caller',runId:f.subject.runId,executionAttemptId:f.subject.executionAttemptId,projectId:f.subject.projectId,threadId:f.subject.threadId,modelProvider:'test-http',modelId:'runtime-primary',startedAt})
    :usage.record(f.org,{eventId:requestId,userId:'caller',runId:f.subject.runId,modelProvider:'test-http',modelId:'runtime-primary',tokensTotal:3,promptTokens:2,completionTokens:1,outcome:'succeeded',totalSource:'reported'});
   // Attach rejection immediately so a fixture failure cannot produce unhandled work.
   const completed=Promise.allSettled([resolving,recording]);
   await bounded(writer.attempted.promise);await assertWaiting(f.org,()=>writer.pid);
   held.release.resolve();expect((await bounded(completed)).map(row=>row.status)).toEqual(['fulfilled','fulfilled']);
   expect((await f.deps.policy.resolveBudgetPolicy(f.org,'caller')).decision).toBe('configured');
   const state=await asApp(f.org,c=>c.query('SELECT p.plan,a.configuration->>\'ordinaryTokensPerUser\' AS tokens FROM organization_plans p JOIN organization_ai_policies a ON a.org_id=p.org_id WHERE p.org_id=$1',[f.org]));
   expect(state.rows).toEqual([{plan:'ordinary',tokens:'100'}]);
  }finally{held.release.resolve();await Promise.allSettled([resolving,...(recording?[recording]:[])]);}
 }
});
it('target z role writer and ordered F162 membership shares serialize and preserve last admin',async()=>{
 const f=await fixture('ordinary','100',false,'100',true);
 await addOrgMember(f.org,'a','admin',null);await addOrgMember(f.org,'z','admin',null);
 await addBlockRule(f,'model','100');await f.deps.policy.resolveBudgetPolicy(f.org,'caller');
 const held=scheduledDb(sql=>sql.includes('SELECT org_role FROM org_memberships')&&sql.includes('FOR UPDATE'));
 const reader=scheduledDb(()=>false);
 const {PgOrgMemberRepository}=await import('../../src/infrastructure/auth/pg-org-member-repository');
 const changing=new PgOrgMemberRepository(held.database).changeRole(f.org,'z','consultant');
 let admitting:ReturnType<PgAiAdmissionRepository['reserve']>|undefined;
 try{
  await bounded(held.entered.promise);
  admitting=new PgAiAdmissionRepository(reader.database).reserve(f.org,reserveInput(f));
  const complete=Promise.allSettled([changing,admitting]);
  await bounded(reader.attempted.promise);await assertWaiting(f.org,()=>reader.pid);
  held.release.resolve();expect((await bounded(complete)).map(row=>row.status)).toEqual(['fulfilled','fulfilled']);
  expect(await changing).toMatchObject({ok:true,changed:true});expect((await admitting).decision).toBe('allowed');
  expect(await new PgOrgMemberRepository(db).changeRole(f.org,'a','consultant')).toEqual({ok:false,reason:'last-admin'});
  expect((await asApp(f.org,c=>c.query('SELECT user_id,org_role FROM org_memberships WHERE org_id=$1 AND user_id IN ($2,$3) ORDER BY user_id',[f.org,'a','z']))).rows).toEqual([{user_id:'a',org_role:'admin'},{user_id:'z',org_role:'consultant'}]);
  expect((await f.deps.policy.resolveBudgetPolicy(f.org,'caller')).decision).toBe('configured');
  expect((await asApp(f.org,c=>c.query("SELECT p.plan,a.configuration->>'ordinaryTokensPerUser' AS tokens FROM organization_plans p JOIN organization_ai_policies a ON a.org_id=p.org_id WHERE p.org_id=$1",[f.org]))).rows).toEqual([{plan:'ordinary',tokens:'100'}]);
 }finally{held.release.resolve();await Promise.allSettled([changing,...(admitting?[admitting]:[])]);}
});

it('outer scoped transaction commits only typed policy refusal audit and rolls back same-text ordinary error',async()=>{
 const f=await fixture('ordinary','100',false,'100',true),before=requests.length;
 await addBlockRule(f,'model','1');
 const typed=reserveInput(f),ordinary=reserveInput(f);
 const refuse=async(input:typeof typed,typedError:boolean)=>withCommittedAiPolicyDecision(db,f.org,async session=>{
  // Real outer transaction is reused by policy and reserve, just like private/artifact admission.
  const scoped:import('../../src/application/ports/database.port').DatabasePort={
   withTenant:async(org,work)=>{if(org!==f.org)throw new Error('fixture tenant mismatch');return work(session);},
   withoutTenant:async()=>{throw new Error('fixture tenant required');},close:async()=>{},
  };
  const repository=new PgAiAdmissionRepository(scoped);
  expect((await repository.resolveBudgetPolicy(f.org,'caller')).decision).toBe('configured');
  const result=await repository.reserve(f.org,input);expect(result.decision).toBe('AI_LIMIT_RULE_BLOCKED');
  if(typedError)throw new AiQuotaPolicyError('AI_LIMIT_RULE_BLOCKED');
  throw new Error('AI_LIMIT_RULE_BLOCKED');
 });
 await expect(refuse(typed,true)).rejects.toBeInstanceOf(AiQuotaPolicyError);
 await expect(refuse(ordinary,false)).rejects.toThrow('AI_LIMIT_RULE_BLOCKED');
 const snapshot=await asApp(f.org,c=>c.query(`SELECT d.request_id,d.result->>'decision' AS decision,e.action_taken
  FROM ai_limit_rule_decisions d JOIN limit_events e ON e.id=d.event_id WHERE d.org_id=$1`,[f.org]));
 expect(snapshot.rows).toEqual([{request_id:typed.requestId,decision:'AI_LIMIT_RULE_BLOCKED',action_taken:'block'}]);
 expect((await asApp(f.org,c=>c.query(`SELECT
  (SELECT count(*)::int FROM ai_request_reservations WHERE org_id=$1) AS reservations,
  (SELECT count(*)::int FROM model_request_starts WHERE org_id=$1) AS starts,
  (SELECT count(*)::int FROM limit_events WHERE org_id=$1) AS events`,[f.org]))).rows).toEqual([{reservations:0,starts:0,events:1}]);
 expect(requests.slice(before)).toEqual([]);
});

async function enqueueActualRoot(f:Awaited<ReturnType<typeof fixture>>,agent:string,version:string){
 const run=randomUUID(),message=randomUUID();
 await addChatMessage({orgId:f.org,id:message,threadId:f.subject.threadId!,body:'ROOT_HTTP_INPUT',authorId:'caller'});
 await asApp(f.org,c=>c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,
  skill_version_ids,model_provider,model_id,status) VALUES($1,$2,$3,$4,$5,$6,'[]'::jsonb,'test-http','runtime-primary','queued')`,
  [run,f.org,f.subject.threadId,message,agent,version]));
 return run;
}
async function rootFixture(f:Awaited<ReturnType<typeof fixture>>){
 const agent=randomUUID(),version=randomUUID(),instructions='ROOT_PINNED_INSTRUCTIONS';
 await asApp(f.org,async c=>{
  await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
   VALUES($1,$2,$1,'HTTP root test','enabled','caller',now(),now())`,[agent,f.org]);
  await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,
   model_provider,model_id,tool_policy,creator_id,created_at,published_at)
   VALUES($1,$2,$3,'v1',$4,$5,'{}'::text[],'test-http','runtime-primary','[]'::jsonb,'caller',now(),now())`,
   [version,f.org,agent,createHash('sha256').update(instructions).digest('hex'),instructions]);
 });
 const repo=new PgAgentRunRepository(db),clock={now:()=>new Date().toISOString(),newStepId:()=>randomUUID()};
 const logs:Array<{message:string;detail:Record<string,unknown>}>=[];
 // Unknown remains private under I-12. A self-hosted HTTP fixture can run;
 // this does not manufacture a public classification for the assembled root input.
 const admission:RunAiAdmission={primaryModelId:async()=> 'primary',facts:async()=>({confidentiality:'unknown',requiredCapabilities:[]}),
  dependencies:()=>({...f.deps,currentCandidates:async()=>{
   const candidates=await f.deps.currentCandidates();return {...candidates,pool:candidates.pool.map(row=>({...row,kind:'self-hosted' as const}))};
  }}),selection:async(_org,_run,selection)=>f.deps.onModelSelection(selection)};
 const deps={runs:repo,model,aiAdmission:admission,clock,log:(message:string,detail:Record<string,unknown>)=>{logs.push({message,detail});}};
 return {agent,version,repo,deps,logs,enqueue:()=>enqueueActualRoot(f,agent,version)};
}
it('actual root claim/lease executor ordinary hard cap fails before HTTP or durable start',async()=>{
 const f=await fixture('ordinary','100',false,'3'),root=await rootFixture(f),before=requests.length,run=await root.enqueue();
 await executeQueuedRuns(root.deps,{orgId:f.org});
 const state=await asApp(f.org,c=>c.query('SELECT status,lease_epoch FROM agent_runs WHERE org_id=$1 AND id=$2',[f.org,run]));
 expect(state.rows,JSON.stringify(root.logs)).toEqual([{status:'failed',lease_epoch:1}]);
 expect(requests.slice(before)).toEqual([]);
 expect((await asApp(f.org,c=>c.query(`SELECT (SELECT count(*)::int FROM model_request_starts WHERE org_id=$1) AS starts,
  (SELECT count(*)::int FROM ai_request_reservations WHERE org_id=$1) AS reservations`,[f.org]))).rows).toEqual([{starts:0,reservations:0}]);
});
it('actual enterprise root HTTP receipt carries lease/attempt attribution, writes chat, and next root hits finite cost',async()=>{
 const f=await fixture('enterprise','9'),root=await rootFixture(f),before=requests.length,run=await root.enqueue();
 await executeQueuedRuns(root.deps,{orgId:f.org});
 expect((await asApp(f.org,c=>c.query('SELECT status,lease_epoch FROM agent_runs WHERE org_id=$1 AND id=$2',[f.org,run]))).rows,JSON.stringify(root.logs)).toEqual([{status:'writeback_pending',lease_epoch:1}]);
 expect(requests.slice(before)).toEqual([expect.objectContaining({model:'runtime-primary',max_tokens:2})]);
 expect(JSON.stringify(requests[before])).toContain('ROOT_PINNED_INSTRUCTIONS');
 expect(JSON.stringify(requests[before])).toContain('ROOT_HTTP_INPUT');
 await writeBackPendingRuns(root.deps,{orgId:f.org});
 const answer=await asApp(f.org,c=>c.query('SELECT r.status,m.body FROM agent_runs r JOIN chat_messages m ON m.org_id=r.org_id AND m.agent_run_id=r.id WHERE r.org_id=$1 AND r.id=$2',[f.org,run]));
 expect(answer.rows).toEqual([{status:'succeeded',body:'HTTP answer'}]);
 const calls=await f.read.calls(f.org,{...f.query,runId:run});
 expect(calls.calls).toHaveLength(1);expect(calls.calls[0]).toMatchObject({userId:'caller',agentId:root.agent,projectId:f.subject.projectId,threadId:f.subject.threadId,runId:run,executionAttemptId:`${run}:1`,totalTokens:'3',costMicros:'6',priceVersion:f.priceVersion});
 expect((await asApp(f.org,c=>c.query('SELECT execution_lease_epoch FROM model_request_starts WHERE org_id=$1 AND run_id=$2',[f.org,run]))).rows).toEqual([{execution_lease_epoch:1}]);
 const refused=await root.enqueue();await executeQueuedRuns(root.deps,{orgId:f.org});
 expect((await asApp(f.org,c=>c.query('SELECT status,lease_epoch FROM agent_runs WHERE org_id=$1 AND id=$2',[f.org,refused]))).rows).toEqual([{status:'failed',lease_epoch:1}]);
 expect(requests.slice(before)).toHaveLength(1);
 expect((await asApp(f.org,c=>c.query('SELECT id FROM model_request_starts WHERE org_id=$1 AND run_id=$2',[f.org,refused]))).rows).toEqual([]);
});
