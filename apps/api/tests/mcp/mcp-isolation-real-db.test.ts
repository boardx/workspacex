import {McpIsolationOutput} from '@repo/contracts/mcp-execution-snapshot';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {beforeAll,afterAll,expect,it} from 'vitest';
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asApp,asOwner,resetOrgs} from '../support/db';
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
import {createHttpMcpGateway} from '../../src/infrastructure/mcp/http-mcp-gateway';
import {createHttpMcpExecution} from '../../src/infrastructure/mcp/http-mcp-execution';
import {toContractTool} from '../../src/application/mcp/discover-tools';
import {controlledMcpServer} from './support/controlled-mcp-http-server';
import {testTlsMaterial} from '../support/tls';
const org=toOrgId('isolation-'+randomUUID()),thread='thread-'+org,agent='agent-'+org,version='version-'+org;
let db:PgDatabase,service:PgMcpExecutionSnapshot,app:Awaited<ReturnType<typeof import('../../src/main')['createApp']>>,base:string;
let a:Awaited<ReturnType<typeof controlledMcpServer>>,b:typeof a;
const old=Object.fromEntries(['KERNEL_QUIET','KERNEL_AGENT_RUN_AUTOSTART','KERNEL_ALLOW_TEST_PRINCIPAL'].map(k=>[k,process.env[k]]));
const auth=(user='reviewer')=>({'content-type':'application/json','x-kernel-test-principal':`${user}:${org}`});
async function newRun(){const run='run-'+randomUUID();await addChatMessage({orgId:org,id:'message-'+run,threadId:thread,body:'MCP',authorId:'actor'});
 await asApp(org,async c=>{
  await c.query("INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES($1,$2,$3,$4,$5,$6,'[]','test','test','running',now(),1,now()+interval '10 minutes')",[run,org,thread,'message-'+run,agent,version]);
  await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,run]);
 });await service.capture({orgId:org,parentRunId:run,attemptId:run+':0',leaseEpoch:1});
 const grants=new PgToolPermissionGrantRepository(db);for(const name of ['mcp__a__wait','mcp__b__wait'])await grants.grantForRun(org,run,name);return run;}
const invoke=(run:string,server:string,label:string)=>service.invoke(run,{orgId:org,attemptId:run+':0',leaseEpoch:1,toolName:`mcp__${server}__wait`,toolCallId:randomUUID(),toolArgs:{label}});
async function review(serverId:string){const response=await fetch(`${base}/mcp-servers/${serverId}/review`,{method:'POST',headers:auth(),body:JSON.stringify({serverId,verdict:'放行',reason:'Reviewed controlled endpoint',authScope:'全体成员',grantedToolIds:[`mcp:${serverId.slice(4)}.wait`]})});expect(response.status).toBe(200);}
async function isolate(mode:'interrupt'|'drain'){const response=await fetch(`${base}/mcp-servers/mcp-a/isolate`,{method:'POST',headers:auth(),body:JSON.stringify({serverId:'mcp-a',mode,reason:'Controlled governance test'})});expect(response.status).toBe(200);const result=McpIsolationOutput.parse(await response.json());if(!result.requestId)throw new Error('missing isolation receipt');return {...result,requestId:result.requestId};}
beforeAll(async()=>{
 await ensureDatabase();await migrateOnce();await seedOrg({orgId:org,projectId:'p-'+org});await addOrgMember(org,'actor','consultant',null);await addOrgMember(org,'reviewer','admin',null);
 await addChatThread({orgId:org,id:thread,projectId:null,visibilityScope:'private',createdBy:'actor'});
 await asApp(org,async c=>{
  await c.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at,tool_whitelist) VALUES($1,$2,'mcp-isolate','MCP','enabled','actor',now(),now(),$3::jsonb)",[agent,org,JSON.stringify(['a','b'].map(x=>({toolFullName:`mcp:${x}.wait`,state:'在授权范围内',elevationDecision:null})))]);
  await c.query("INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES($1,$2,$3,'v1',$4,'fixed','{}','test','test','[]','actor',now(),now())",[version,org,agent,createHash('sha256').update('fixed').digest('hex')]);
 });db=new PgDatabase(appConfig());a=await controlledMcpServer();b=await controlledMcpServer();
 const lookup=((_host:unknown,opts:{all?:boolean},cb:Function)=>opts?.all?cb(null,[{address:'127.0.0.1',family:4}]):cb(null,'127.0.0.1',4)) as unknown as typeof import('node:dns').lookup;
 for(const [id,server] of [['mcp-a',a],['mcp-b',b]] as const){const tools=await createHttpMcpGateway({credential:null,policy:{localOnlyOrg:false},extraTrustedCa:testTlsMaterial().cert,seams:{lookup,checkAddress:()=>{}}}).listTools(id,server.url);
  await createPgMcpServerStore(db).upsertDiscovered({orgId:org,serverId:id,endpoint:server.url,registeredByActorId:'actor',toolCount:1,discoveredAt:new Date().toISOString(),initialStatus:{reviewStatus:'待安全评审',connectionStatus:'已隔离'},sealedCredential:null});await createPgMcpToolStore(db,org).replace(id,tools.map(t=>toContractTool(id,t)));
 }
 const reader=new PgParentRunControlReader(db);service=new PgMcpExecutionSnapshot(db,reader,new ToolExecutionAuthority(reader,new PgAgentRunRepository(db),new PgToolPermissionGrantRepository(db)),{repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},chat:new PgChatRepository(db)},createHttpMcpExecution({extraTrustedCa:testTlsMaterial().cert.toString(),testNetwork:{lookupAddress:'127.0.0.1',allowPrivateAddress:true}}));
 Object.assign(process.env,{KERNEL_QUIET:'1',KERNEL_AGENT_RUN_AUTOSTART:'0',KERNEL_ALLOW_TEST_PRINCIPAL:'1'});app=await(await import('../../src/main')).createApp();await app.listen(0,'127.0.0.1');base=await app.getUrl();await review('mcp-a');await review('mcp-b');
});
afterAll(async()=>{await a?.close();await b?.close();await app?.close();await db?.close();await resetOrgs(org);for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
it('interrupt from another service instance acknowledges actual Worker termination, never parent or sibling cancellation',async()=>{
 const run=await newRun();let siblingDone=false;
 const first=invoke(run,'a','interrupt-a').then(value=>({value}),error=>({error}));
 const second=invoke(run,'b','interrupt-b').then(value=>{siblingDone=true;return value;});
 await Promise.all([a.started('interrupt-a'),b.started('interrupt-b')]);const request=await isolate('interrupt');
 expect(request.remoteOutcome).toBe('unknown');expect('error'in await first).toBe(true);expect(siblingDone).toBe(false);
 const status=await(await fetch(`${base}/mcp-servers/mcp-a/isolation-requests/${request.requestId}`,{headers:auth()})).json();expect(status).toMatchObject({interruptedCalls:1,localAcknowledgedCalls:1,pendingCalls:0,remoteOutcome:'unknown'});
 a.release('interrupt-a');b.release('interrupt-b');expect(await second).toMatchObject({structuredContent:{label:'interrupt-b'}});
 await asApp(org,async c=>{expect((await c.query('SELECT status,cancel_requested_at FROM agent_runs WHERE org_id=$1 AND id=$2',[org,run])).rows[0]).toEqual({status:'running',cancel_requested_at:null});});
 await review('mcp-a');await expect(invoke(run,'a','old-snapshot')).rejects.toThrow('revoked');
});
it('drain permits only the already claimed call to finish and rejects new calls',async()=>{
 const run=await newRun(),pending=invoke(run,'a','drain-a');await a.started('drain-a');const request=await isolate('drain');
 expect(request.interruptedCalls).toBe(0);await expect(invoke(run,'a','new-after-drain')).rejects.toThrow('revoked');a.release('drain-a');expect(await pending).toMatchObject({structuredContent:{label:'drain-a'}});
 const status=await(await fetch(`${base}/mcp-servers/mcp-a/isolation-requests/${request.requestId}`,{headers:auth()})).json();expect(status).toMatchObject({interruptedCalls:0,localAcknowledgedCalls:0,pendingCalls:0,completedCalls:1});await review('mcp-a');
});
it('expired lost-instance receipts become unconfirmed without invented acknowledgement; admin and tenant boundaries hold',async()=>{
 const run=await newRun();await asApp(org,c=>c.query("INSERT INTO mcp_tool_executions(org_id,run_id,tool_call_id,tool_name,args_digest,status,server_id,deadline_at) VALUES($1,$2,'orphan','mcp__a__wait',$3,'pending','mcp-a',now()-interval '1 second')",[org,run,'a'.repeat(64)]));
 const request=await isolate('interrupt');expect(request).toMatchObject({localAcknowledgedCalls:0,pendingCalls:0,unconfirmedCalls:1});
 expect((await fetch(`${base}/mcp-servers/mcp-a/isolate`,{method:'POST',headers:auth('actor'),body:JSON.stringify({serverId:'mcp-a',mode:'interrupt',reason:'unauthorized'})})).status).toBe(403);
 expect((await fetch(`${base}/mcp-servers/mcp-a/isolation-requests/${request.requestId}`,{headers:auth('actor')})).status).toBe(403);
 await asApp(org,async c=>{expect((await c.query("SELECT status,local_stop_ack_at FROM mcp_tool_executions WHERE org_id=$1 AND run_id=$2 AND tool_call_id='orphan'",[org,run])).rows[0]).toEqual({status:'unconfirmed',local_stop_ack_at:null});});
});
it('isolation migration replays against populated tables without deleting requests or changing acknowledgements',async()=>{
 const sql=await readFile(new URL('../../migrations/20260909060000_mcp_isolation_requests.sql',import.meta.url),'utf8');
 const before=await asApp(org,async c=>(await c.query('SELECT request_id FROM mcp_isolation_requests WHERE org_id=$1 ORDER BY request_id',[org])).rows);
 await asOwner(c=>c.query(sql));await asOwner(c=>c.query(sql));
 expect(await asApp(org,async c=>(await c.query('SELECT request_id FROM mcp_isolation_requests WHERE org_id=$1 ORDER BY request_id',[org])).rows)).toEqual(before);
});
