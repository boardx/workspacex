import {schemas as SandboxSchemas} from '@repo/contracts/sandbox-session';
import {STANDARD_BROWSER_SERVICE} from '../../src/application/agent-run/standard-browser-tools';
import {StandardBrowserToolsController} from '../../src/interface/controllers/standard-browser-tools.controller';
import {PlaywrightMcpBrowserAdapter,PublicBrowserNetworkPolicy,RemotePlaywrightMcpSessionFactory} from '../../src/infrastructure/agent-run/playwright-mcp-browser-adapter';
import {PgBrowserExecutionReceipts} from '../../src/infrastructure/agent-run/pg-browser-execution-receipts';
import {createNativeDraftSession} from '../../src/infrastructure/agent-run/native-draft-session';
import {STANDARD_AUDIO_SERVICE} from '../../src/application/agent-run/standard-audio-tools';
import {StandardAudioController} from '../../src/interface/controllers/standard-audio.controller';
import {NestFactory} from '@nestjs/core';
import {Module} from '@nestjs/common';
import {NativeOutputStagingController} from '../../src/interface/controllers/native-output-staging.controller';
import {NATIVE_OUTPUT_STAGING} from '../../src/application/agent-run/native-output-staging';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeEach,afterEach,it,expect} from 'vitest';
import {browserScenarios as methodScenarios} from './browser-skill-real-model.cases';
import {realMethodContext} from './method-skills-context.fixture';
import {STANDARD_CONTEXT_SERVICE} from '../../src/application/agent-run/standard-context-tools';
import {StandardContextToolsController} from '../../src/interface/controllers/standard-context-tools.controller';
import {IDENTITY_REPOSITORY,DECISION_ID_FACTORY} from '../../src/application/identity/ports';
import {CHAT_REPOSITORY} from '../../src/application/chat/ports';
import {seedOrg,addOrgMember,addProjectMember,asApp,ensureDatabase,migrateOnce,resetOrgs} from '../support/db';
import {addChatThread,addChatMessage} from '../support/chat-db';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {toOrgId} from '../../src/domain/org-id';
import {PgNativeOutputStaging} from '../../src/infrastructure/agent-run/pg-native-output-staging';
import {PgParentRunControlReader} from '../../src/infrastructure/agent-run/pg-parent-run-control';
import {ToolExecutionAuthority} from '../../src/application/agent-run/tool-execution-authority';
import {PgAgentRunRepository} from '../../src/infrastructure/agent-run/pg-agent-run-repository';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {PgNativeSessionOwner} from '../../src/infrastructure/agent-run/pg-native-session-owner';
import {createNativeSessionTransport} from '../../src/infrastructure/agent-run/native-session-transport';
import {createNativeSessionFiles} from '../../src/infrastructure/agent-run/native-session-files';
import {createNativeDocumentSession} from '../../src/infrastructure/agent-run/native-document-session';
import {NativeSessionController} from '../../src/interface/controllers/native-session.controller';
import {NATIVE_SESSION_OWNER} from '../../src/application/agent-run/native-session-owner';
import {RunInterjectionController} from '../../src/interface/controllers/run-interjection.controller';
import {TOOL_EXECUTION_AUTHORITY} from '../../src/application/agent-run/tool-execution-authority';
import {AGENT_RUN_STORE} from '../../src/application/agent-run/ports';
import {INTERJECTION_STORE} from '../../src/application/agent-run/interjection-store';
import {TOOL_PERMISSION_GRANT_STORE} from '../../src/application/agent-run/tool-permission-grants';
import {PgToolPermissionGrantRepository} from '../../src/infrastructure/agent-run/pg-tool-permission-grant-repository';
import {PgInterjectionStore} from '../../src/infrastructure/agent-run/pg-interjection-store';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import { PgNativeRunInputs } from '../../src/infrastructure/agent-run/pg-native-run-inputs';
import { uploadAttachment } from '../../src/application/chat/upload-attachment';
import { PgChatAttachmentRepository } from '../../src/infrastructure/chat/pg-chat-attachment-repository';
import { PgChatRepository } from '../../src/infrastructure/chat/pg-chat-repository';
import {writeFile,mkdir} from 'node:fs/promises';
import {FileSkillStarterPackSource} from '../../src/infrastructure/skill/file-skill-starter-pack-source';
let org=toOrgId('methods-real-'+randomUUID()),parent='run-'+randomUUID();
const workspace=join(process.cwd(),'../..');let db:PgDatabase;let root:string;
function processRun(cmd:string,args:string[],input='',env=process.env):Promise<string>{return new Promise((resolve,reject)=>{const child=spawn(cmd,args,{env});child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');const timer=setTimeout(()=>child.kill('SIGKILL'),240000);child.on('close',()=>clearTimeout(timer));let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(new Error(`real model process exited ${code}; ${err.replaceAll(process.env.DASHSCOPE_API_KEY??'never-match-secret','[redacted]')}`)));child.stdin.end(input);});}
async function seed(scope: typeof org, id: string) {
  const project = `project-${scope}`, thread = `thread-${scope}`, agent = `agent-${scope}`, version = `version-${scope}`;
  await seedOrg({ orgId: scope, projectId: project });
  await addOrgMember(scope,"actor","consultant",null);
  await addProjectMember(scope,project,'actor','member',null);
  await asApp(scope,c=>c.query("UPDATE projects SET name='Cedar' WHERE org_id=$1 AND id=$2",[scope,project]));
  await addOrgMember(scope,"intruder","consultant",null);
  await addChatThread({ orgId: scope, id: thread, projectId: null, visibilityScope: "private", createdBy: "actor" });
  await addChatMessage({ orgId: scope, id: `message-${scope}`, threadId: thread, body: "parent", authorId: "actor" });
  await asApp(scope, async (c) => {
    await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at)
      VALUES($1,$2,'t042','T042','enabled','actor',now(),now())`, [agent,scope]);
    await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,
      skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at)
      VALUES($1,$2,$3,'v1',$4,'pinned instructions','{}','dashscope',$5,'[]','actor',now(),now())`,
    [version,scope,agent,createHash("sha256").update("pinned instructions").digest("hex"),process.env.DASHSCOPE_MODEL]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,
      skill_version_ids,model_provider,model_id,status) VALUES($1,$2,$3,$4,$5,$6,'[]','dashscope',$7,'queued')`,
    [id,scope,thread,`message-${scope}`,agent,version,process.env.DASHSCOPE_MODEL]);
  });
}

beforeEach(async()=>{org=toOrgId('methods-real-'+randomUUID());parent='run-'+randomUUID();await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());root=await mkdtemp(join(tmpdir(),'wx-chain-'));await seed(org,parent);
 await asApp(org,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE id=$1",[parent]));
 await asApp(org,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,parent]));
});
afterEach(async()=>{await db?.close();await resetOrgs(org);await rm(root,{recursive:true,force:true});});
import {verifySkillStarterPack} from '../../src/domain/skill/starter-pack';
it.each(methodScenarios)('$id real configured model selects skill and delivers source-grounded artifact',async(scenario)=>{
 for(const key of ['DASHSCOPE_API_KEY','DASHSCOPE_BASE_URL','DASHSCOPE_MODEL','WX_AUDIO_REAL_EVIDENCE'])if(!process.env[key])throw new Error(`missing ${key}`);
 const container=process.env.WX_NATIVE_SANDBOX_CONTAINER;if(!container)throw new Error('owned sandbox required');
 const fixture=await readFile(join(workspace,'apps/deep-agent-service/tests/native_sandbox_fixture.py'),'utf8'),relayCode=fixture.split('_UDS_RELAY = r"""')[1]?.split('"""')[0]?.replace("let input = '';","process.stdin.setEncoding('utf8'); let input = '';").replace("let body='';res.on","res.setEncoding('utf8'); let body='';res.on");if(!relayCode)throw new Error('relay missing');
 const socket=join(root,'sandbox.sock');const relay=createServer(async(req,res)=>{try{req.setEncoding('utf8');let body='';for await(const c of req)body+=c;const output=JSON.parse(await processRun('docker',['exec','-i',container,'node','-e',relayCode],JSON.stringify({method:req.method,path:req.url,headers:req.headers,body})));if(output.status>=400){const detail=JSON.parse(output.body);const code=typeof detail.error==='string'&&/^[A-Za-z0-9_ -]{1,100}$/.test(detail.error)?detail.error:'unclassified';const dir=join(process.env.WX_AUDIO_REAL_EVIDENCE!,scenario.id);await mkdir(dir,{recursive:true});await writeFile(join(dir,'transport-failure.json'),JSON.stringify({status:output.status,code}));}res.writeHead(output.status,{'content-type':'application/json'});res.end(output.body);}catch{res.writeHead(503);res.end('{}');}});await new Promise<void>(r=>relay.listen(socket,r));
 const objects=new FsObjectStore(root),repo=new PgAgentRunRepository(db),grants=new PgToolPermissionGrantRepository(db),identity=new PgIdentityRepository(db),chat=new PgChatRepository(db);
 const owner=new PgNativeSessionOwner(db,new PgParentRunControlReader(db),createNativeSessionTransport(socket),'e'.repeat(64),new PgNativeRunInputs(db,objects,{repo:identity,ids:{next:()=>randomUUID()},chat}));
 const authority=new ToolExecutionAuthority(new PgParentRunControlReader(db),repo,grants),staging=new PgNativeOutputStaging(db,owner,objects,authority,b=>createNativeSessionFiles({socketPath:socket,...b}));
 const browser=new PlaywrightMcpBrowserAdapter(owner,b=>createNativeDraftSession({socketPath:socket,...b}),authority,new PgBrowserExecutionReceipts(db),new PublicBrowserNetworkPolicy(),new RemotePlaywrightMcpSessionFactory(process.env.WORKSPACEX_BROWSER_MCP_ENDPOINT!));
 const oldKey=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=randomUUID();let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;let browserBinding:string|undefined;
 try{
  for(const tool of ['wx_project_list','wx_project_read','wx_knowledge_search','wx_knowledge_read','write_todos','read_file','write_file','edit_file','ls','glob','execute','wx_artifact_publish','wx_audio_transcribe','browser_navigate','browser_snapshot','browser_click','browser_fill_form','browser_take_screenshot'])await grants.grantForRun(org,parent,tool);
  const transcript=scenario.source;
  const uploaded=await uploadAttachment({repo:identity,ids:{next:()=>randomUUID()},chat,attachments:new PgChatAttachmentRepository(db),store:objects,attachmentIds:{next:()=>randomUUID()},clock:{now:()=>new Date().toISOString()}},{orgId:org,userId:'actor',threadId:`thread-${org}`,filename:scenario.filename,mime:'text/plain',bytes:Buffer.from(transcript)});
  await asApp(org,c=>c.query('UPDATE chat_message_attachments SET message_id=$3 WHERE org_id=$1 AND id=$2',[org,uploaded.id,`message-${org}`]));
  const pack=verifySkillStarterPack(await new FileSkillStarterPackSource(join(workspace,'skills/starter-packs')).load(scenario.packId,scenario.packVersion),{packId:scenario.packId,packVersion:scenario.packVersion});
  const skills=pack.skills.map(s=>({stableName:s.stableName,package:{skillId:s.stableName,versionId:s.semanticVersion,files:s.files}}));
  const ctx={orgId:org,parentRunId:parent,attemptId:parent+':0',leaseEpoch:1};const ref=await owner.provision(ctx,skills,{execute:false,wx_artifact_publish:false,wx_audio_transcribe:false,wx_project_list:false,wx_project_read:false,wx_knowledge_search:false,wx_knowledge_read:false,browser_navigate:false,browser_snapshot:false,browser_click:false,browser_fill_form:false,browser_take_screenshot:false});
  browserBinding=ref.bindingId;
  class TestModule{};Module({controllers:[StandardBrowserToolsController,StandardContextToolsController,NativeSessionController,NativeOutputStagingController,RunInterjectionController,StandardAudioController],providers:[{provide:STANDARD_BROWSER_SERVICE,useValue:browser},{provide:STANDARD_CONTEXT_SERVICE,useValue:realMethodContext(db,identity,chat,objects)},{provide:IDENTITY_REPOSITORY,useValue:identity},{provide:DECISION_ID_FACTORY,useValue:{next:()=>randomUUID()}},{provide:CHAT_REPOSITORY,useValue:chat},{provide:NATIVE_SESSION_OWNER,useValue:owner},{provide:NATIVE_OUTPUT_STAGING,useValue:staging},{provide:TOOL_EXECUTION_AUTHORITY,useValue:authority},{provide:AGENT_RUN_STORE,useValue:repo},{provide:INTERJECTION_STORE,useValue:new PgInterjectionStore(db)},{provide:TOOL_PERMISSION_GRANT_STORE,useValue:grants},{provide:STANDARD_AUDIO_SERVICE,useValue:null}]})(TestModule);
  app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const config={configurable:{native_runtime:ref,org_skills:skills.map(s=>({stable_name:s.stableName,package:s.package})),disable_task_auto_classify:true,run_control_callback:{base_url:base,key:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY,org_id:org,run_id:parent,attempt_id:ctx.attemptId,lease_epoch:1}}};
  const raw=await processRun(join(workspace,'apps/deep-agent-service/.venv/bin/python'),[join(workspace,'apps/deep-agent-service/tests/method_skills_real_model_runner.py')],JSON.stringify({...config,livePrompt:scenario.prompt}),{...process.env,WX_AUDIO_REAL_EVIDENCE:join(process.env.WX_AUDIO_REAL_EVIDENCE!,scenario.id),PYTHONPATH:join(workspace,'apps/deep-agent-service/src'),NATIVE_SESSION_SOCKET:socket,NATIVE_SESSION_SERVICE_BASE_URL:base,NATIVE_SESSION_SERVICE_KEY:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY});
  const evidence=join(process.env.WX_AUDIO_REAL_EVIDENCE!,scenario.id);await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'model-trace.json'),raw);const report=JSON.parse(raw);
  const instructions=Buffer.from(pack.skills.find(s=>s.stableName===scenario.skill)!.files.find(f=>f.path==='SKILL.md')!.contentBase64,'base64').toString('utf8');
  expect(report.calls.some((c:{id:string;name:string;args:{file_path?:string;command?:string}})=>
   (c.name==='read_file'&&c.args.file_path===`/skills/${scenario.skill}/SKILL.md`) ||
   (c.name==='execute'&&c.args.command===`cat /skills/${scenario.skill}/SKILL.md`&&report.results.some((r:{toolCallId:string;status:string;content:string})=>r.toolCallId===c.id&&r.status==='success'&&r.content.includes(instructions))))).toBe(true);
  expect(report.skillActivity.some((fact:{skillStableName:string;skillVersion:string;stage:string})=>fact.skillStableName===scenario.skill&&fact.stage==='body_read')).toBe(true);
  expect(report.modelCallBudget).toBe(25);expect(report.modelCalls).toBeGreaterThan(0);expect(report.modelCalls).toBeLessThanOrEqual(report.modelCallBudget);
  expect(String(report.final)).not.toMatch(/model call limit|model call.*exceed|模型调用.*上限/i);
  expect(report.calls.some((c:{name:string})=>c.name==='wx_artifact_publish')).toBe(true);expect(report.negativeCalls).toEqual([]);
  for(const name of ['browser_navigate','browser_snapshot','browser_click','browser_take_screenshot'])expect(report.calls.some((c:{name:string})=>c.name===name)).toBe(true);
  for(const viewport of ['desktop','mobile'])expect(report.calls.some((c:{name:string;args:{url?:string}})=>c.name==='browser_navigate'&&c.args.url?.includes('viewport='+viewport))).toBe(true);
  const deniedBrowserCall={...ctx,bindingId:ref.bindingId,toolCallId:'s013-private-network-counterproof'};
  const receiptsBefore=await asApp(org,async c=>(await c.query<{n:number}>('SELECT count(*)::int AS n FROM mcp_tool_executions WHERE org_id=$1 AND run_id=$2',[org,parent])).rows[0]!.n);
  await expect(browser.invoke(deniedBrowserCall,{toolName:'browser_navigate',toolArgs:{url:'http://169.254.169.254/latest/meta-data'}})).rejects.toThrow('browser_network_denied');
  const receiptsAfter=await asApp(org,async c=>(await c.query<{n:number}>('SELECT count(*)::int AS n FROM mcp_tool_executions WHERE org_id=$1 AND run_id=$2',[org,parent])).rows[0]!.n);expect(receiptsAfter).toBe(receiptsBefore);
  const bound=await owner.resolve(ref.bindingId,ctx);const scriptNetwork=await createNativeDocumentSession({socketPath:socket,...bound}).execute({executionId:randomUUID(),command:"node -e \"fetch('http://169.254.169.254/latest/meta-data').then(()=>process.exit(0),()=>process.exit(23))\"",timeoutMs:5000});
  expect(scriptNetwork.exitCode===0&&!scriptNetwork.timedOut).toBe(false);await writeFile(join(evidence,'network-counterproof.json'),JSON.stringify({browser:{url:'http://169.254.169.254/latest/meta-data',error:'browser_network_denied',receiptDelta:receiptsAfter-receiptsBefore,forwarded:false},script:{exitCode:scriptNetwork.exitCode,timedOut:scriptNetwork.timedOut,cancelled:scriptNetwork.cancelled}}));
  const priorClick=report.calls.find((c:{name:string;args:{pageRef?:string;elementRef?:string}})=>c.name==='browser_click'&&c.args.pageRef&&c.args.elementRef);expect(priorClick).toBeDefined();
  await expect(browser.invoke({...ctx,bindingId:ref.bindingId,toolCallId:'s013-stale-ref-counterproof'},{toolName:'browser_click',toolArgs:{pageRef:priorClick.args.pageRef,elementRef:priorClick.args.elementRef}})).rejects.toThrow('browser_element_ref_stale_or_foreign');
  const files=await staging.listFiles(org,parent);expect(files.length).toBeGreaterThan(0);const minutes=files.find(f=>f.name==='report.md');expect(minutes).toBeDefined();
  const bytes=Buffer.from((await objects.get(minutes!.objectKey))!);const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);await writeFile(join(evidence,'report.md'),bytes);await writeFile(join(evidence,'source.txt'),transcript);
  for(const pattern of scenario.required)expect(text).toMatch(pattern);for(const pattern of scenario.forbidden)expect(text).not.toMatch(pattern);
  expect(files.some(f=>f.name==='bundle.html')).toBe(true);expect(files.some(f=>f.name==='index.html')).toBe(true);expect(files.some(f=>f.name==='test-record.json')).toBe(true);expect(files.filter(f=>f.name.endsWith('.png')).length).toBeGreaterThanOrEqual(2);
  await repo.storeOutputAwaitingWriteback(org,parent,{text:report.final,finalStepSeq:1,files});const pending=(await repo.claimWritebackPending(org,1))[0]!;await repo.commitWriteback(org,{runId:parent,threadId:pending.threadId,inputMessageId:pending.inputMessageId,agentId:pending.agentId,text:pending.text,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),outputDigest:'a'.repeat(64),files});
  const versions=await db.withTenant(org,s=>s.query('SELECT storage_key FROM agent_artifact_versions WHERE org_id=$1 AND produced_by_run_id=$2',[org,parent]));expect(versions.rows).toHaveLength(files.length);await writeFile(join(evidence,'result.json'),JSON.stringify({model:report.model,modelCalls:report.modelCalls,modelCallBudget:report.modelCallBudget,packDigest:pack.packDigest,outputSha256:createHash('sha256').update(bytes).digest('hex'),artifacts:files.length,actualWriteback:true}));
 }finally{try{if(browserBinding){const bound=await owner.resolve(browserBinding,{orgId:org,parentRunId:parent,attemptId:parent+':0',leaseEpoch:1}),session=createNativeDraftSession({socketPath:socket,...bound});const dir=join(process.env.WX_AUDIO_REAL_EVIDENCE!,scenario.id,'workspace-readback');await mkdir(dir,{recursive:true});for(const name of ['bundle.html','index.html','test-record.json','report.md','desktop.png','mobile.png']){try{const path='/workspace/web-artifact/'+name,file=SandboxSchemas.file.parse(await session.read(path));const bytes=Buffer.from(file.contentBase64,'base64');if(file.path===path&&file.sizeBytes===bytes.length)await writeFile(join(dir,name),bytes);}catch{/* Missing files remain absent evidence. */}}}}catch{/* Preserve original error. */}try{const dir=join(process.env.WX_AUDIO_REAL_EVIDENCE!,scenario.id);await mkdir(dir,{recursive:true});for(const output of await staging.listFiles(org,parent)){const saved=await objects.get(output.objectKey);if(saved)await writeFile(join(dir,output.name),Buffer.from(saved));}}catch{/* Keep the original failure; best-effort evidence only. */}try{if(browserBinding)await browser.release(browserBinding);await owner.releaseForRun(org,parent);}finally{await app?.close();await new Promise<void>(r=>relay.close(()=>r()));if(oldKey===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=oldKey;}}
},300000);
