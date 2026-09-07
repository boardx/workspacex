import {createHash,randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,it} from 'vitest';
import {addChatMessage,addChatThread} from '../support/chat-db';
import {addOrgMember,asApp,ensureDatabase,migrateOnce,resetOrgs,seedOrg} from '../support/db';
import {testTlsMaterial} from '../support/tls';
import {ToolExecutionAuthority} from '../../src/application/agent-run/tool-execution-authority';
import {toContractTool} from '../../src/application/mcp/discover-tools';
import {sealCredential} from '../../src/domain/model/credential-vault';
import {toOrgId} from '../../src/domain/org-id';
import {PgAgentRunRepository} from '../../src/infrastructure/agent-run/pg-agent-run-repository';
import {PgParentRunControlReader} from '../../src/infrastructure/agent-run/pg-parent-run-control';
import {PgToolPermissionGrantRepository} from '../../src/infrastructure/agent-run/pg-tool-permission-grant-repository';
import {PgChatRepository} from '../../src/infrastructure/chat/pg-chat-repository';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig,migrationConfig} from '../../src/infrastructure/db/pg-config';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {AesCredentialCipher} from '../../src/infrastructure/model/aes-credential-cipher';
import {createHttpMcpExecution} from '../../src/infrastructure/mcp/http-mcp-execution';
import {createHttpMcpGateway} from '../../src/infrastructure/mcp/http-mcp-gateway';
import {McpCredentialExecutionBroker} from '../../src/infrastructure/mcp/mcp-credential-execution-broker';
import {PgMcpExecutionSnapshot} from '../../src/infrastructure/mcp/pg-mcp-execution-snapshot';
import {createPgMcpServerStore} from '../../src/infrastructure/mcp/pg-mcp-server-store';
import {createPgMcpToolStore} from '../../src/infrastructure/mcp/pg-mcp-tool-store';
import {setupMcpExecutor} from '../../src/infrastructure/mcp/setup-mcp-executor';
import {controlledMcpServer} from './support/controlled-mcp-http-server';

const runtimeToolName='mcp__secure__wait';
const serverId='mcp-secure';
const password='test-password-'+randomUUID();
const key='test-key-'+randomUUID();
const keyId='k-'+createHash('sha256').update(key).digest('hex').slice(0,8);
const network={extraTrustedCa:testTlsMaterial().cert.toString(),testNetwork:{lookupAddress:'127.0.0.1',allowPrivateAddress:true}};
const lookup=((_host:unknown,options:{all?:boolean},callback:Function)=>options?.all
 ? callback(null,[{address:'127.0.0.1',family:4}])
 : callback(null,'127.0.0.1',4)) as unknown as typeof import('node:dns').lookup;

type Server=Awaited<ReturnType<typeof controlledMcpServer>>;
type Fixture={orgId:ReturnType<typeof toOrgId>;threadId:string;agentId:string;versionId:string;token:string;server:Server};
let db:PgDatabase;
let broker:McpCredentialExecutionBroker;
let service:PgMcpExecutionSnapshot;
let first:Fixture;
let second:Fixture;

async function seedFixture(label:string):Promise<Fixture>{
 const orgId=toOrgId(`broker-concurrency-${label}-${randomUUID()}`);
 const threadId=`thread-${orgId}`,agentId=`agent-${orgId}`,versionId=`version-${orgId}`;
 const token=`credential-${label}-${randomUUID()}`;
 const server=await controlledMcpServer({credential:()=>token,autoRelease:false});
 await seedOrg({orgId,projectId:`project-${orgId}`});
 await addOrgMember(orgId,'actor','consultant',null);
 await addOrgMember(orgId,'reviewer','admin',null);
 await addChatThread({orgId,id:threadId,projectId:null,visibilityScope:'private',createdBy:'actor'});
 await asApp(orgId,async client=>{
  await client.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at,tool_whitelist) VALUES($1,$2,$3,$4,'enabled','actor',now(),now(),$5::jsonb)",[agentId,orgId,`secure-mcp-${label}`,`secure-${label}`,JSON.stringify([{toolFullName:'mcp:secure.wait',state:'在授权范围内',elevationDecision:null}])]);
  await client.query("INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES($1,$2,$3,'v1',$4,'fixed','{}','test','test','[]','actor',now(),now())",[versionId,orgId,agentId,createHash('sha256').update(`fixed-${label}`).digest('hex')]);
 });
 const discovered=await createHttpMcpGateway({credential:token,policy:{localOnlyOrg:false},extraTrustedCa:testTlsMaterial().cert,seams:{lookup,checkAddress:()=>{}}}).listTools(serverId,server.url);
 await createPgMcpServerStore(db).upsertDiscovered({orgId,serverId,endpoint:server.url,registeredByActorId:'actor',toolCount:1,discoveredAt:new Date().toISOString(),initialStatus:{reviewStatus:'待安全评审',connectionStatus:'已隔离'},sealedCredential:sealCredential(token,new AesCredentialCipher({key,keyId}),new Date().toISOString())});
 await createPgMcpToolStore(db,orgId).replace(serverId,discovered.map(tool=>toContractTool(serverId,tool)));
 await service.review(orgId,'reviewer',{serverId,verdict:'放行',reason:`credential account ${label} reviewed`,authScope:'全体成员',grantedToolIds:['mcp:secure.wait']});
 return {orgId,threadId,agentId,versionId,token,server};
}

async function createRun(fixture:Fixture){
 const runId=`run-${randomUUID()}`,messageId=`message-${runId}`;
 await addChatMessage({orgId:fixture.orgId,id:messageId,threadId:fixture.threadId,body:'secure concurrent tool',authorId:'actor'});
 await asApp(fixture.orgId,async client=>{
  await client.query("INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES($1,$2,$3,$4,$5,$6,'[]','test','test','running',now(),1,now()+interval '10 minutes')",[runId,fixture.orgId,fixture.threadId,messageId,fixture.agentId,fixture.versionId]);
  await client.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),fixture.orgId,runId]);
 });
 const view=await service.capture({orgId:fixture.orgId,parentRunId:runId,attemptId:`${runId}:0`,leaseEpoch:1});
 await new PgToolPermissionGrantRepository(db).grantForRun(fixture.orgId,runId,runtimeToolName);
 return {runId,view};
}

async function receipts(fixture:Fixture,runId:string){
 return await asApp(fixture.orgId,async client=>(await client.query(
  'SELECT status,result,broker_started_at FROM mcp_tool_executions WHERE org_id=$1 AND run_id=$2',
  [fixture.orgId,runId],
 )).rows);
}

beforeAll(async()=>{
 await ensureDatabase();
 await migrateOnce();
 db=new PgDatabase(appConfig());
 await setupMcpExecutor(migrationConfig(),password);
 broker=new McpCredentialExecutionBroker({...appConfig(),user:'mcp_executor',password},key,network);
 const control=new PgParentRunControlReader(db);
 const authority=new ToolExecutionAuthority(control,new PgAgentRunRepository(db),new PgToolPermissionGrantRepository(db));
 const visibility={repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},chat:new PgChatRepository(db)};
 service=new PgMcpExecutionSnapshot(db,control,authority,visibility,createHttpMcpExecution(network),broker);
 first=await seedFixture('first');
 second=await seedFixture('second');
});

afterAll(async()=>{
 await first?.server.close();
 await second?.server.close();
 await broker?.close();
 await db?.close();
 await resetOrgs(...[first?.orgId,second?.orgId].filter((value):value is Fixture['orgId']=>Boolean(value)));
});

it('keeps distinct credentials isolated when two runs invoke the same MCP tool concurrently',async()=>{
 const runA=await createRun(first),runB=await createRun(second);
 expect(runA.view.tools.map(tool=>tool.name)).toEqual([runtimeToolName]);
 expect(runB.view.tools.map(tool=>tool.name)).toEqual([runtimeToolName]);
 expect(JSON.stringify([runA.view,runB.view])).not.toContain(first.token);
 expect(JSON.stringify([runA.view,runB.view])).not.toContain(second.token);

 const labelA=`first-${randomUUID()}`,labelB=`second-${randomUUID()}`;
 const callA=service.invoke(runA.runId,{orgId:first.orgId,attemptId:`${runA.runId}:0`,leaseEpoch:1,toolName:runtimeToolName,toolCallId:randomUUID(),toolArgs:{label:labelA}});
 const callB=service.invoke(runB.runId,{orgId:second.orgId,attemptId:`${runB.runId}:0`,leaseEpoch:1,toolName:runtimeToolName,toolCallId:randomUUID(),toolArgs:{label:labelB}});
 const calls=Promise.all([callA,callB]);
 let timer:ReturnType<typeof setTimeout>;
 const timeout=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('both Worker requests did not enter their remote handlers')),10_000);});
 try{
  await Promise.race([Promise.all([first.server.started(labelA),second.server.started(labelB)]),calls.then(()=>{throw new Error('calls completed before explicit release');}),timeout]);
  expect(first.server.finished(labelA)).toBe(false);
  expect(second.server.finished(labelB)).toBe(false);
  first.server.release(labelA);
  second.server.release(labelB);
  const [resultA,resultB]=await calls;
  expect(resultA).toMatchObject({structuredContent:{label:labelA}});
  expect(resultB).toMatchObject({structuredContent:{label:labelB}});
  const persisted=await Promise.all([receipts(first,runA.runId),receipts(second,runB.runId)]);
  expect(persisted.flat().map(row=>row.status)).toEqual(['succeeded','succeeded']);
  expect(persisted.flat().every(row=>row.broker_started_at!==null)).toBe(true);
  const observable=JSON.stringify([resultA,resultB,persisted]);
  expect(observable).not.toContain(first.token);
  expect(observable).not.toContain(second.token);
 }finally{
  clearTimeout(timer!);
  first.server.release(labelA);
  second.server.release(labelB);
 }
 expect(first.server.finished(labelA)).toBe(true);
 expect(second.server.finished(labelB)).toBe(true);
});
