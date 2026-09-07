import {reflectsMcpCredential} from '../../src/infrastructure/mcp/mcp-credential-reflection';
import {MCP_EXECUTION_SNAPSHOT} from '../../src/application/agent-run/mcp-execution-snapshot';
import {McpFrozenTool} from '@repo/contracts/mcp-execution-snapshot';
import {mcpExecutionDigest} from '../../src/infrastructure/mcp/mcp-execution-digest';
import {createHash,randomUUID} from 'node:crypto';
import {Client} from 'pg';
import {readFile} from 'node:fs/promises';
import {beforeAll,afterAll,expect,it,vi} from 'vitest';
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asApp,asOwner,resetOrgs} from '../support/db';
import {addChatThread,addChatMessage} from '../support/chat-db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig,migrationConfig} from '../../src/infrastructure/db/pg-config';
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
import {McpCredentialExecutionBroker} from '../../src/infrastructure/mcp/mcp-credential-execution-broker';
import {setupMcpExecutor} from '../../src/infrastructure/mcp/setup-mcp-executor';
import {AesCredentialCipher} from '../../src/infrastructure/model/aes-credential-cipher';
import {sealCredential} from '../../src/domain/model/credential-vault';
import {toContractTool} from '../../src/application/mcp/discover-tools';
import {controlledMcpServer} from './support/controlled-mcp-http-server';
import {testTlsMaterial} from '../support/tls';
let appClosed=false;
let app:Awaited<ReturnType<typeof import('../../src/main')['createApp']>>;
const envNames=['MCP_EXECUTOR_DB_USER','MCP_EXECUTOR_DB_PASSWORD','MODEL_CREDENTIAL_KEY','KERNEL_QUIET','KERNEL_AGENT_RUN_AUTOSTART'];
const oldEnv=Object.fromEntries(envNames.map(name=>[name,process.env[name]]));
const org=toOrgId('broker-'+randomUUID()),foreign=toOrgId('other-'+org),thread='thread-'+org,agent='agent-'+org,version='version-'+org;
const key='test-key-'+randomUUID(),password='test-password-'+randomUUID(),keyId='k-'+createHash('sha256').update(key).digest('hex').slice(0,8);
let token='secret-token-'+randomUUID(),reflect=false,db:PgDatabase,broker:McpCredentialExecutionBroker,service:PgMcpExecutionSnapshot,without:PgMcpExecutionSnapshot,server:Awaited<ReturnType<typeof controlledMcpServer>>;
const options={extraTrustedCa:testTlsMaterial().cert.toString(),testNetwork:{lookupAddress:'127.0.0.1',allowPrivateAddress:true}};
const executorConfig=()=>({...appConfig(),user:'mcp_executor',password});
async function saveSecret(){await createPgMcpServerStore(db).upsertDiscovered({orgId:org,serverId:'mcp-secure',endpoint:server.url,registeredByActorId:'actor',toolCount:1,discoveredAt:new Date().toISOString(),initialStatus:{reviewStatus:'待安全评审',connectionStatus:'已隔离'},sealedCredential:sealCredential(token,new AesCredentialCipher({key,keyId}),new Date().toISOString())});}
async function review(){await service.review(org,'reviewer',{serverId:'mcp-secure',verdict:'放行',reason:'Exact credential account reviewed',authScope:'全体成员',grantedToolIds:['mcp:secure.wait']});}
async function run(captureWith=service){const id='run-'+randomUUID();await addChatMessage({orgId:org,id:'msg-'+id,threadId:thread,body:'secure tool',authorId:'actor'});
 await asApp(org,async c=>{await c.query("INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES($1,$2,$3,$4,$5,$6,'[]','test','test','running',now(),1,now()+interval '10 minutes')",[id,org,thread,'msg-'+id,agent,version]);await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,id]);});
 const view=await captureWith.capture({orgId:org,parentRunId:id,attemptId:id+':0',leaseEpoch:1});await new PgToolPermissionGrantRepository(db).grantForRun(org,id,'mcp__secure__wait');return {id,view};}
const input=(id:string,label='safe-result')=>({orgId:org,attemptId:id+':0',leaseEpoch:1,toolName:'mcp__secure__wait',toolCallId:randomUUID(),toolArgs:{label}});
beforeAll(async()=>{
 await ensureDatabase();await migrateOnce();await seedOrg({orgId:org,projectId:'p-'+org});await seedOrg({orgId:foreign,projectId:'p-'+foreign});await addOrgMember(org,'actor','consultant',null);await addOrgMember(org,'reviewer','admin',null);await addChatThread({orgId:org,id:thread,projectId:null,visibilityScope:'private',createdBy:'actor'});
 await asApp(org,async c=>{await c.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at,tool_whitelist) VALUES($1,$2,'secure-mcp','secure','enabled','actor',now(),now(),$3::jsonb)",[agent,org,JSON.stringify([{toolFullName:'mcp:secure.wait',state:'在授权范围内',elevationDecision:null}])]);await c.query("INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES($1,$2,$3,'v1',$4,'fixed','{}','test','test','[]','actor',now(),now())",[version,org,agent,createHash('sha256').update('fixed').digest('hex')]);});
 db=new PgDatabase(appConfig());await setupMcpExecutor(migrationConfig(),password);broker=new McpCredentialExecutionBroker(executorConfig(),key,options);const reader=new PgParentRunControlReader(db),authority=new ToolExecutionAuthority(reader,new PgAgentRunRepository(db),new PgToolPermissionGrantRepository(db)),visibility={repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},chat:new PgChatRepository(db)};
 service=new PgMcpExecutionSnapshot(db,reader,authority,visibility,createHttpMcpExecution(options),broker);without=new PgMcpExecutionSnapshot(db,reader,authority,visibility,createHttpMcpExecution(options));server=await controlledMcpServer({credential:()=>token,autoRelease:true,reflectCredential:()=>reflect});
 const lookup=((_host:unknown,opts:{all?:boolean},cb:Function)=>opts?.all?cb(null,[{address:'127.0.0.1',family:4}]):cb(null,'127.0.0.1',4)) as unknown as typeof import('node:dns').lookup;
 const discovered=await createHttpMcpGateway({credential:token,policy:{localOnlyOrg:false},extraTrustedCa:testTlsMaterial().cert,seams:{lookup,checkAddress:()=>{}}}).listTools('mcp-secure',server.url);await saveSecret();await createPgMcpToolStore(db,org).replace('mcp-secure',discovered.map(t=>toContractTool('mcp-secure',t)));await review();
 Object.assign(process.env,{MCP_EXECUTOR_DB_USER:'mcp_executor',MCP_EXECUTOR_DB_PASSWORD:password,MODEL_CREDENTIAL_KEY:key,KERNEL_QUIET:'1',KERNEL_AGENT_RUN_AUTOSTART:'0'});app=await(await import('../../src/main')).createApp();
});
afterAll(async()=>{if(!appClosed)await app?.close();for(const[name,value]of Object.entries(oldEnv)){if(value===undefined)delete process.env[name];else process.env[name]=value;}await server?.close();await broker?.close();await db?.close();await resetOrgs(org,foreign);});
it('dedicated login has no table secrets and app_rw cannot call the broker function',async()=>{
 await asApp(org,async c=>{await expect(c.query('SELECT ciphertext FROM mcp_server_secrets WHERE org_id=$1',[org])).rejects.toThrow('permission denied');});
 await asApp(org,async c=>{await expect(c.query('SELECT * FROM public.kernel_claim_mcp_credential($1,$2,$3,$4,$5,$6,$7,$8)',[org,'missing','missing','missing',1,randomUUID(),'x','x'])).rejects.toThrow('permission denied');});
 const client=new Client(executorConfig());await client.connect();try{await expect(client.query('SELECT ciphertext FROM mcp_server_secrets')).rejects.toThrow('permission denied');expect((await client.query('SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0]).toEqual({rolsuper:false,rolbypassrls:false,rolcreatedb:false,rolcreaterole:false});expect((await client.query('SELECT * FROM public.kernel_claim_mcp_credential($1,$2,$3,$4,$5,$6,$7,$8)',[foreign,'missing','missing','missing',1,randomUUID(),'x','x'])).rows).toEqual([]);}finally{await client.end();}
});
it('real sealed AES credential reaches only the approved HTTPS transport; snapshots and receipts contain no secret',async()=>{
 expect((await run(without)).view.tools).toEqual([]);const {id,view}=await run();expect(view.tools).toHaveLength(1);expect(JSON.stringify(view)).not.toContain(token);expect(JSON.stringify(view)).not.toContain('credentialRevision');
 const request=input(id);const result=await service.invoke(id,request);expect(result).toMatchObject({structuredContent:{label:'safe-result'}});expect(JSON.stringify(result)).not.toContain(token);
 await asApp(org,async c=>{const rows=(await c.query('SELECT result,status,broker_started_at FROM mcp_tool_executions WHERE org_id=$1 AND run_id=$2',[org,id])).rows;expect(rows[0].status).toBe('succeeded');expect(rows[0].broker_started_at).not.toBeNull();expect(JSON.stringify(rows)).not.toContain(token);});expect(await service.invoke(id,request)).toEqual(result);
});
it('secret rotation revokes old review immediately; new approval does not upgrade a frozen old run',async()=>{
 const old=await run();token='rotated-token-'+randomUUID();await saveSecret();await expect(service.invoke(old.id,input(old.id))).rejects.toThrow('revoked');await review();await expect(service.invoke(old.id,input(old.id))).rejects.toThrow('revoked');const next=await run();expect(await service.invoke(next.id,input(next.id))).toMatchObject({structuredContent:{label:'safe-result'}});
});
it('a remote server reflecting the bearer is rejected before persistence and is not replayed',async()=>{
 const {id}=await run();reflect=true;const request=input(id);await expect(service.invoke(id,request)).rejects.toThrow('unconfirmed');reflect=false;await expect(service.invoke(id,request)).rejects.toThrow('unconfirmed');await asApp(org,async c=>{expect((await c.query('SELECT status,result FROM mcp_tool_executions WHERE org_id=$1 AND run_id=$2',[org,id])).rows[0]).toEqual({status:'unconfirmed',result:null});});
});
it('tampering with AES authentication tag fails without reflecting ciphertext or key',async()=>{
 await asApp(org,c=>c.query("UPDATE mcp_server_secrets SET ciphertext=$3 WHERE org_id=$1 AND server_id=$2",[org,'mcp-secure','0'.repeat(24)+'.'+'0'.repeat(32)+'.00']));await review();const {id}=await run();await expect(service.invoke(id,input(id))).rejects.toThrow('unconfirmed');await saveSecret();await review();
});
it('migration replays without changing a fixed credential revision',async()=>{
 const get=()=>asApp(org,async c=>(await c.query('SELECT revision FROM mcp_server_secrets WHERE org_id=$1',[org])).rows);const before=await get();const sql=await readFile(new URL('../../migrations/20260909070000_mcp_credential_execution.sql',import.meta.url),'utf8');await asOwner(c=>c.query(sql));await asOwner(c=>c.query(sql));expect(await get()).toEqual(before);
});

async function pendingReceipt(){
 const {id}=await run(),request=input(id,'delayed-never-execute');
 const frozen=await asApp(org,async c=>McpFrozenTool.parse((await c.query('SELECT tools FROM mcp_run_snapshots WHERE org_id=$1 AND run_id=$2',[org,id])).rows[0].tools[0]));
 await asApp(org,c=>c.query("INSERT INTO mcp_tool_executions(org_id,run_id,tool_call_id,tool_name,args_digest,status,server_id,review_id,attempt_id,lease_epoch,deadline_at) VALUES($1,$2,$3,$4,$5,'pending','mcp-secure',$6,$7,1,now()+interval '30 seconds')",[org,id,request.toolCallId,request.toolName,mcpExecutionDigest(request.toolArgs),frozen.reviewId,request.attemptId]));
 return {id,request,frozen};
}
it('broker function rejects wrong org, arguments, attempt and replay of an already claimed receipt',async()=>{
 const {id,request,frozen}=await pendingReceipt();const client=new Client(executorConfig());await client.connect();
 const args=[org,id,request.toolCallId,request.attemptId,1,frozen.credentialRevision,request.toolName,mcpExecutionDigest(request.toolArgs)];const sql='SELECT * FROM public.kernel_claim_mcp_credential($1,$2,$3,$4,$5,$6,$7,$8)';
 try{for(const[index,value]of [[0,foreign],[3,'other-attempt'],[4,2],[7,'f'.repeat(64)]] as const){const altered=[...args];altered[index]=value;expect((await client.query(sql,altered)).rows).toEqual([]);}expect((await client.query(sql,args)).rows).toHaveLength(1);expect((await client.query(sql,args)).rows).toEqual([]);}finally{await client.end();}
});
it('absolute cancellation deadline discards a late blocked DB claim without starting the remote Worker',async()=>{
 const {id,request,frozen}=await pendingReceipt(),lock=new Client(migrationConfig());await lock.connect();await lock.query('BEGIN');await lock.query('SELECT tool_call_id FROM mcp_tool_executions WHERE org_id=$1 AND run_id=$2 AND tool_call_id=$3 FOR UPDATE',[org,id,request.toolCallId]);
 const signal=new AbortController(),start=Date.now(),deadlineAt=start+100;const timer=setTimeout(()=>signal.abort(),100);
 try{await expect(broker.execute(frozen,request.toolArgs,{signal:signal.signal,deadlineAt,receipt:{orgId:org,runId:id,toolCallId:request.toolCallId,attemptId:request.attemptId,leaseEpoch:1}})).rejects.toThrow('unconfirmed');expect(Date.now()-start).toBeLessThan(2000);}finally{clearTimeout(timer);await lock.query('ROLLBACK');await lock.end();}
 // The control plane may finish its claim late, but there must be no post-abort remote execution.
 await new Promise(resolve=>setTimeout(resolve,200));expect(server.finished('delayed-never-execute')).toBe(false);
});

it('production Kernel DI preserves and closes the managed dedicated broker instance',async()=>{const managed=app.get(McpCredentialExecutionBroker);expect(managed).toBeInstanceOf(McpCredentialExecutionBroker);expect(Reflect.get(app.get(MCP_EXECUTION_SNAPSHOT),'broker')).toBe(managed);expect(typeof managed.onModuleDestroy).toBe('function');expect(JSON.stringify(managed)).not.toContain(token);expect(JSON.stringify(managed)).not.toContain(key);const closed=vi.spyOn(managed,'onModuleDestroy');await app.close();appClosed=true;expect(closed).toHaveBeenCalledOnce();});

it('credential discovery refuses direct bearer reflection in tool metadata before storage',async()=>{
 const reflected=await controlledMcpServer({credential:()=>token,autoRelease:true,reflectMetadata:()=>true});
 const lookup=((_host:unknown,opts:{all?:boolean},cb:Function)=>opts?.all?cb(null,[{address:'127.0.0.1',family:4}]):cb(null,'127.0.0.1',4)) as unknown as typeof import('node:dns').lookup;
 try{await expect(createHttpMcpGateway({credential:token,policy:{localOnlyOrg:false},extraTrustedCa:testTlsMaterial().cert,seams:{lookup,checkAddress:()=>{}}}).listTools('mcp-reflect',reflected.url)).rejects.toThrow();}finally{await reflected.close();}
});

it('literal reflection matching handles JSON escaped token bytes',()=>{const credential='token-\"slash\\';expect(reflectsMcpCredential({text:credential},credential)).toBe(true);expect(reflectsMcpCredential({text:'safe'},credential)).toBe(false);});

it('discovery rejects an oversized tools metadata response before projection',async()=>{
 const oversized=await controlledMcpServer({description:'x'.repeat(1048576)});
 const lookup=((_host:unknown,opts:{all?:boolean},cb:Function)=>opts?.all?cb(null,[{address:'127.0.0.1',family:4}]):cb(null,'127.0.0.1',4)) as unknown as typeof import('node:dns').lookup;
 try{await expect(createHttpMcpGateway({credential:null,timeoutMs:1500,policy:{localOnlyOrg:false},extraTrustedCa:testTlsMaterial().cert,seams:{lookup,checkAddress:()=>{}}}).listTools('mcp-large',oversized.url)).rejects.toThrow();}finally{await oversized.close();}
});
