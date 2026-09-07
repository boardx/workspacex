import {toolArgumentsDigest} from '../../src/application/agent-run/tool-arguments-digest';
import {MCP_EXECUTION_SNAPSHOT} from '../../src/application/agent-run/mcp-execution-snapshot';
import {createHash,randomUUID} from 'node:crypto';
import {beforeAll,afterAll,expect,it} from 'vitest';
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asApp,resetOrgs} from '../support/db';
import {addChatThread,addChatMessage} from '../support/chat-db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {toOrgId} from '../../src/domain/org-id';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {PgChatRepository} from '../../src/infrastructure/chat/pg-chat-repository';
import {PgParentRunControlReader} from '../../src/infrastructure/agent-run/pg-parent-run-control';
import {PgAgentRunRepository} from '../../src/infrastructure/agent-run/pg-agent-run-repository';
import {PgToolPermissionGrantRepository} from '../../src/infrastructure/agent-run/pg-tool-permission-grant-repository';
import {ToolExecutionAuthority} from '../../src/application/agent-run/tool-execution-authority';
import {PgMcpExecutionSnapshot} from '../../src/infrastructure/mcp/pg-mcp-execution-snapshot';
import {createPgMcpServerStore} from '../../src/infrastructure/mcp/pg-mcp-server-store';
import {createPgMcpToolStore} from '../../src/infrastructure/mcp/pg-mcp-tool-store';
import {toContractTool} from '../../src/application/mcp/discover-tools';
const org=toOrgId('mcp-run-'+randomUUID()),run='run-'+randomUUID(),agent='agent-'+randomUUID(),version='version-'+randomUUID(),thread='thread-'+randomUUID();
let app:Awaited<ReturnType<typeof import('../../src/main')['createApp']>>,base:string;
const old=Object.fromEntries(['KERNEL_QUIET','KERNEL_AGENT_RUN_AUTOSTART','KERNEL_ALLOW_TEST_PRINCIPAL','DEEP_AGENT_SERVICE_INTERNAL_KEY'].map(k=>[k,process.env[k]]));
let db:PgDatabase,service:PgMcpExecutionSnapshot,grants:PgToolPermissionGrantRepository,calls=0,fail=false;let during:(()=>Promise<void>)|undefined;
const tool=toContractTool('mcp-fixture',{name:'search',signature:'search(q)',sideEffect:'只读',description:'Search',inputSchema:{type:'object',properties:{q:{type:'string'}},required:['q'],additionalProperties:false}});
const context={orgId:org,parentRunId:run,attemptId:run+':0',leaseEpoch:1};
const input=(id=randomUUID())=>({orgId:org,attemptId:context.attemptId,leaseEpoch:1,toolName:'mcp__fixture__search',toolCallId:id,toolArgs:{q:'hello'}});
beforeAll(async()=>{
 await ensureDatabase();await migrateOnce();await seedOrg({orgId:org,projectId:'p-'+org});
 await addOrgMember(org,'actor','consultant',null);await addOrgMember(org,'reviewer','admin',null);
 await addChatThread({orgId:org,id:thread,projectId:null,visibilityScope:'private',createdBy:'actor'});
 await addChatMessage({orgId:org,id:'message-'+org,threadId:thread,body:'run',authorId:'actor'});
 await asApp(org,async c=>{
  await c.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,$2,'mcp-runtime','MCP','enabled','actor',now(),now())",[agent,org]);
  await c.query("INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES($1,$2,$3,'v1',$4,'fixed','{}','test','test','[]','actor',now(),now())",[version,org,agent,createHash('sha256').update('fixed').digest('hex')]);
  await c.query("INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES($1,$2,$3,$4,$5,$6,'[]','test','test','running',now(),1,now()+interval '10 minutes')",[run,org,thread,'message-'+org,agent,version]);
  await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,run]);
 });
 db=new PgDatabase(appConfig());const reader=new PgParentRunControlReader(db);grants=new PgToolPermissionGrantRepository(db);
 service=new PgMcpExecutionSnapshot(db,reader,new ToolExecutionAuthority(reader,new PgAgentRunRepository(db),grants),{repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},chat:new PgChatRepository(db)},async()=>{calls++;if(during)await during();if(fail)throw new Error('remote secret');return {content:[{type:'text',text:'actual receipt'}]};});
 await createPgMcpServerStore(db).upsertDiscovered({orgId:org,serverId:'mcp-fixture',endpoint:'https://example.com/mcp',registeredByActorId:'actor',toolCount:1,discoveredAt:new Date().toISOString(),initialStatus:{reviewStatus:'待安全评审',connectionStatus:'已隔离'},sealedCredential:null});
 await createPgMcpToolStore(db,org).replace('mcp-fixture',[tool]);
 Object.assign(process.env,{KERNEL_QUIET:'1',KERNEL_AGENT_RUN_AUTOSTART:'0',KERNEL_ALLOW_TEST_PRINCIPAL:'1',DEEP_AGENT_SERVICE_INTERNAL_KEY:'mcp-test-key'});
 app=await(await import('../../src/main')).createApp();await app.listen(0,'127.0.0.1');base=await app.getUrl();
});
afterAll(async()=>{await app?.close();await db?.close();await resetOrgs(org);for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
it('real review rejects non-admin and self review; persists exact approved tool schemas',async()=>{
 const review={serverId:'mcp-fixture',verdict:'放行' as const,reason:'Audited schema',authScope:'全体成员' as const,grantedToolIds:[tool.fullName]};
 await expect(service.review(org,'actor',review)).rejects.toThrow('denied');
 await asApp(org,c=>c.query("UPDATE org_memberships SET org_role='admin' WHERE org_id=$1 AND user_id='actor'",[org]));await expect(service.review(org,'actor',review)).rejects.toThrow('SELF_REVIEW_FORBIDDEN');
 await asApp(org,c=>c.query("UPDATE org_memberships SET org_role='consultant' WHERE org_id=$1 AND user_id='actor'",[org]));
 const response=await fetch(`${base}/mcp-servers/mcp-fixture/review`,{method:'POST',headers:{'content-type':'application/json','x-kernel-test-principal':`reviewer:${org}`},body:JSON.stringify(review)});expect(response.status).toBe(200);
 expect(await response.json()).toMatchObject({reviewerId:'reviewer',grantedToolIds:[tool.fullName]});
 await asApp(org,async c=>{expect((await c.query('SELECT tools FROM mcp_review_snapshots WHERE org_id=$1',[org])).rows[0].tools[0].schemaFingerprint).toBe(tool.schemaFingerprint);});
});
it('empty fixed tool_policy is not permission: only actual trusted whitelist becomes a frozen run snapshot',async()=>{
 await asApp(org,c=>c.query('UPDATE agents SET tool_whitelist=$3::jsonb WHERE org_id=$1 AND id=$2',[org,agent,JSON.stringify([{toolFullName:tool.fullName,state:'在授权范围内',elevationDecision:null}])]));
 const snapshot=await service.capture(context);expect(snapshot.tools.map(t=>t.name)).toEqual(['mcp__fixture__search']);expect(JSON.stringify(snapshot)).not.toContain('https://');
 expect(await service.resolve(context)).toEqual(snapshot);
 await expect(service.resolve({...context,leaseEpoch:2})).rejects.toThrow('unavailable');
 await expect(service.resolve({...context,orgId:toOrgId('foreign-org')})).rejects.toThrow('unavailable');
 await asApp(org,async c=>{await expect(c.query('UPDATE mcp_run_snapshots SET digest=$2 WHERE org_id=$1',[org,'0'.repeat(64)])).rejects.toThrow();});
});
it('shared real authority denies first, grant allows once; receipts refuse replay with changed args or unknown outcome',async()=>{
 const request=input();await expect(service.invoke(run,request)).rejects.toThrow('denied');expect(calls).toBe(0);
 await grants.grantForRun(org,run,request.toolName);
 expect(await service.invoke(run,request)).toMatchObject({content:[{text:'actual receipt'}]});expect(await service.invoke(run,request)).toMatchObject({content:[{text:'actual receipt'}]});expect(calls).toBe(1);
 await expect(service.invoke(run,{...request,toolArgs:{q:'changed'}})).rejects.toThrow('unconfirmed');expect(calls).toBe(1);
 fail=true;const failed=input();await expect(service.invoke(run,failed)).rejects.toThrow('unconfirmed');fail=false;
 await expect(service.invoke(run,failed)).rejects.toThrow('unconfirmed');expect(calls).toBe(2);
});
it('current whitelist removal and endpoint/schema scope changes revoke frozen tools',async()=>{
 await asApp(org,c=>c.query('UPDATE mcp_servers SET endpoint=$2 WHERE org_id=$1',[org,'https://other.example/mcp']));
 await expect(service.invoke(run,input())).rejects.toThrow('revoked');
 await asApp(org,c=>c.query('UPDATE mcp_servers SET endpoint=$2 WHERE org_id=$1',[org,'https://example.com/mcp']));
 await asApp(org,c=>c.query("UPDATE agents SET tool_whitelist='[]' WHERE org_id=$1 AND id=$2",[org,agent]));
 await expect(service.invoke(run,input())).rejects.toThrow('revoked');expect(calls).toBe(2);
});

async function restoreWhitelist(){await asApp(org,c=>c.query('UPDATE agents SET tool_whitelist=$3::jsonb WHERE org_id=$1 AND id=$2',[org,agent,JSON.stringify([{toolFullName:tool.fullName,state:'在授权范围内',elevationDecision:null}])]));}
it('late cancellation or requester revocation suppresses result and leaves an unreplayable receipt',async()=>{
 await restoreWhitelist();
 for(const kind of ['cancel','visibility']){
  const request=input();
  during=async()=>{await asApp(org,c=>kind==='cancel'?c.query('UPDATE agent_runs SET cancel_requested_at=now() WHERE org_id=$1 AND id=$2',[org,run]):c.query("DELETE FROM org_memberships WHERE org_id=$1 AND user_id='actor'",[org]));};
  await expect(service.invoke(run,request)).rejects.toThrow('unconfirmed');during=undefined;
  await asApp(org,async c=>{const row=(await c.query('SELECT status,result FROM mcp_tool_executions WHERE org_id=$1 AND run_id=$2 AND tool_call_id=$3',[org,run,request.toolCallId])).rows[0];expect(row).toEqual({status:'unconfirmed',result:null});});
  if(kind==='cancel')await asApp(org,c=>c.query('UPDATE agent_runs SET cancel_requested_at=NULL WHERE org_id=$1 AND id=$2',[org,run]));else await addOrgMember(org,'actor','consultant',null);
  await expect(service.invoke(run,request)).rejects.toThrow('unconfirmed');
 }
});
it('one actual approval remains idempotently valid through predispatch and result rechecks',async()=>{
 const onceRun='once-'+randomUUID();
 await addChatMessage({orgId:org,id:'message-'+onceRun,threadId:thread,body:'once run',authorId:'actor'});
 await asApp(org,async c=>{
  await c.query("INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES($1,$2,$3,$4,$5,$6,'[]','test','test','running',now(),1,now()+interval '10 minutes')",[onceRun,org,thread,'message-'+onceRun,agent,version]);
  await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,onceRun]);
 });
 await service.capture({...context,parentRunId:onceRun,attemptId:onceRun+':0'});
 const permissionRequestId=randomUUID(),request={...input(),attemptId:onceRun+':0',permissionRequestId};
 await asApp(org,c=>c.query("UPDATE agent_runs SET pending_permission_request_id=$3,pending_tool_call_id=$4,pending_tool_name=$5,pending_tool_args_digest=$6,pending_decision='approve',pending_tool_authorized_attempt=NULL WHERE org_id=$1 AND id=$2",[org,onceRun,permissionRequestId,request.toolCallId,request.toolName,toolArgumentsDigest(request.toolArgs)]));
 expect(await service.invoke(onceRun,request)).toMatchObject({content:[{text:'actual receipt'}]});
 await asApp(org,async c=>{expect((await c.query('SELECT pending_tool_authorized_attempt FROM agent_runs WHERE org_id=$1 AND id=$2',[org,onceRun])).rows[0].pending_tool_authorized_attempt).toBe(onceRun+':0');});
 await expect(service.invoke(onceRun,{...request,toolCallId:randomUUID()})).rejects.toThrow('denied');
});
it('runtime can test credential presence but cannot read ciphertext',async()=>{
 await asApp(org,async c=>{expect((await c.query('SELECT EXISTS(SELECT 1 FROM mcp_server_secrets WHERE org_id=$1) AS present',[org])).rows[0].present).toBe(false);});
 await expect(asApp(org,c=>c.query('SELECT ciphertext FROM mcp_server_secrets WHERE org_id=$1',[org]))).rejects.toThrow('permission denied');
});

it('production createApp DI and internal HTTP reject untrusted identity without secret disclosure',async()=>{
 expect(app.get(MCP_EXECUTION_SNAPSHOT)).toBeInstanceOf(PgMcpExecutionSnapshot);
 const url=`${base}/internal/agent-runs/${run}/mcp/invoke`,headers={'content-type':'application/json','x-deep-agent-internal-key':'mcp-test-key'};
 expect((await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input())})).status).toBe(401);
 expect((await fetch(url,{method:'POST',headers,body:JSON.stringify({...input(),snapshotId:randomUUID()})})).status).toBe(400);
 const denied=await fetch(url,{method:'POST',headers,body:JSON.stringify({...input(),orgId:'foreign-org'})});expect(denied.status).toBe(503);expect(await denied.text()).not.toMatch(/mcp-test-key|SELECT|endpoint/);
});
it('real HTTPS MCP worker, frozen PG review, shared authority and actual internal HTTP controller form one execution chain',async()=>{
 const {startLocalMcpHttpServer}=await import('./support/local-mcp-http-server');
 const {createHttpMcpGateway}=await import('../../src/infrastructure/mcp/http-mcp-gateway');
 const {createHttpMcpExecution}=await import('../../src/infrastructure/mcp/http-mcp-execution');
 const {McpExecutionSnapshotController}=await import('../../src/interface/controllers/mcp-execution-snapshot.controller');
 const {NestFactory}=await import('@nestjs/core'),{Module}=await import('@nestjs/common');
 const {testTlsMaterial}=await import('../support/tls');
 const server=await startLocalMcpHttpServer('allowed.example');
 let httpApp:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 try{
  const lookup=((_host:unknown,opts:{all?:boolean},cb:Function)=>opts?.all?cb(null,[{address:'127.0.0.1',family:4}]):cb(null,'127.0.0.1',4)) as unknown as typeof import('node:dns').lookup;
  const discovered=await createHttpMcpGateway({credential:null,policy:{localOnlyOrg:false},extraTrustedCa:testTlsMaterial().cert,seams:{lookup,checkAddress:()=>{}}}).listTools('mcp-native',server.url);
  const remoteTool=toContractTool('mcp-native',discovered.find(t=>t.name==='query_contact')!);
  await createPgMcpServerStore(db).upsertDiscovered({orgId:org,serverId:'mcp-native',endpoint:server.url,registeredByActorId:'actor',toolCount:1,discoveredAt:new Date().toISOString(),initialStatus:{reviewStatus:'待安全评审',connectionStatus:'已隔离'},sealedCredential:null});
  await createPgMcpToolStore(db,org).replace('mcp-native',[remoteTool]);
  const reader=new PgParentRunControlReader(db),real=new PgMcpExecutionSnapshot(db,reader,new ToolExecutionAuthority(reader,new PgAgentRunRepository(db),grants),{repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},chat:new PgChatRepository(db)},createHttpMcpExecution({extraTrustedCa:testTlsMaterial().cert.toString(),testNetwork:{lookupAddress:'127.0.0.1',allowPrivateAddress:true}}));
  await real.review(org,'reviewer',{serverId:'mcp-native',verdict:'放行',reason:'Actual protocol test review',authScope:'全体成员',grantedToolIds:[remoteTool.fullName]});
  await asApp(org,c=>c.query('UPDATE agents SET tool_whitelist=$3::jsonb WHERE org_id=$1 AND id=$2',[org,agent,JSON.stringify([{toolFullName:remoteTool.fullName,state:'在授权范围内',elevationDecision:null}])]));
  const remoteRun='remote-'+randomUUID();await addChatMessage({orgId:org,id:'message-'+remoteRun,threadId:thread,body:'remote tool',authorId:'actor'});
  await asApp(org,async c=>{
   await c.query("INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES($1,$2,$3,$4,$5,$6,'[]','test','test','running',now(),1,now()+interval '10 minutes')",[remoteRun,org,thread,'message-'+remoteRun,agent,version]);
   await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,remoteRun]);
  });
  expect((await real.capture({...context,parentRunId:remoteRun,attemptId:remoteRun+':0'})).tools.map(t=>t.name)).toEqual(['mcp__native__query_contact']);
  await grants.grantForRun(org,remoteRun,'mcp__native__query_contact');
  class FixtureModule{};Module({controllers:[McpExecutionSnapshotController],providers:[{provide:MCP_EXECUTION_SNAPSHOT,useValue:real}]})(FixtureModule);
  httpApp=await NestFactory.create(FixtureModule,{logger:false});await httpApp.listen(0,'127.0.0.1');
  const callId=randomUUID(),response=await fetch(`${await httpApp.getUrl()}/internal/agent-runs/${remoteRun}/mcp/invoke`,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':'mcp-test-key'},body:JSON.stringify({orgId:org,attemptId:remoteRun+':0',leaseEpoch:1,toolCallId:callId,toolName:'mcp__native__query_contact',toolArgs:{company:'full-chain'}})});
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({structuredContent:{result:'queried full-chain'}});
  await asApp(org,async c=>{const row=(await c.query('SELECT status,result FROM mcp_tool_executions WHERE org_id=$1 AND run_id=$2 AND tool_call_id=$3',[org,remoteRun,callId])).rows[0];expect(row.status).toBe('succeeded');expect(row.result.structuredContent.result).toBe('queried full-chain');});
 }finally{await httpApp?.close();await server.close();}
});
it('local organization still captures an empty snapshot and invisible or stale runs remain errors',async()=>{
 const local=toOrgId('local-mcp-'+randomUUID()),localRun='run-'+local,localThread='thread-'+local;
 await seedOrg({orgId:local,kind:'personal-local',ownerUserId:'local-owner',projectId:'project-'+local});
 try{
  await addOrgMember(local,'local-owner','admin',null);
  await addChatThread({orgId:local,id:localThread,projectId:null,visibilityScope:'private',createdBy:'local-owner'});
  await addChatMessage({orgId:local,id:'message-'+local,threadId:localThread,body:'local',authorId:'local-owner'});
  await asApp(local,async c=>{
   await c.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,$2,'local-mcp','Local','enabled','local-owner',now(),now())",['agent-'+local,local]);
   await c.query("INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES($1,$2,$3,'v1',$4,'fixed','{}','test','test','[]','local-owner',now(),now())",['version-'+local,local,'agent-'+local,createHash('sha256').update('fixed').digest('hex')]);
   await c.query("INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES($1,$2,$3,$4,$5,$6,'[]','test','test','running',now(),1,now()+interval '10 minutes')",[localRun,local,localThread,'message-'+local,'agent-'+local,'version-'+local]);
   await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),local,localRun]);
  });
  const ctx={orgId:local,parentRunId:localRun,attemptId:localRun+':0',leaseEpoch:1};
  expect((await service.capture(ctx)).tools).toEqual([]);
  await expect(service.capture({...ctx,leaseEpoch:2})).rejects.toThrow('unavailable');
 }finally{await resetOrgs(local);}
});
