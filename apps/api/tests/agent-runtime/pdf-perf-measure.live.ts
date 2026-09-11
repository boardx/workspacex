/**
 * issue #3401 measurement instrument (stage 1: measure, do not change the implementation).
 *
 * Real configured model + production native graph + a real owned skill sandbox.
 * It records a wall-clock timeline per graph node so the model turns and the
 * `execute` calls can be attributed separately, and it keeps every tool result
 * verbatim (that is where the failing script output lives).
 *
 * Not a CI test: `vitest.pdf-perf-measure.config.ts` includes this file only and
 * refuses to start without an explicitly owned sandbox and evidence directory.
 */
import {randomUUID,createHash} from 'node:crypto';
import {mkdtemp,rm,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {beforeAll,afterAll,it} from 'vitest';
import {NestFactory} from '@nestjs/core';
import {Module} from '@nestjs/common';
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
import {PgNativeSessionOwner} from '../../src/infrastructure/agent-run/pg-native-session-owner';
import {createNativeSessionTransport} from '../../src/infrastructure/agent-run/native-session-transport';
import {createNativeSessionFiles} from '../../src/infrastructure/agent-run/native-session-files';
import {NativeSessionController} from '../../src/interface/controllers/native-session.controller';
import {NATIVE_SESSION_OWNER} from '../../src/application/agent-run/native-session-owner';
import {NativeOutputStagingController} from '../../src/interface/controllers/native-output-staging.controller';
import {NATIVE_OUTPUT_STAGING} from '../../src/application/agent-run/native-output-staging';
import {RunInterjectionController} from '../../src/interface/controllers/run-interjection.controller';
import {TOOL_EXECUTION_AUTHORITY} from '../../src/application/agent-run/tool-execution-authority';
import {AGENT_RUN_STORE} from '../../src/application/agent-run/ports';
import {INTERJECTION_STORE} from '../../src/application/agent-run/interjection-store';
import {TOOL_PERMISSION_GRANT_STORE} from '../../src/application/agent-run/tool-permission-grants';
import {PgToolPermissionGrantRepository} from '../../src/infrastructure/agent-run/pg-tool-permission-grant-repository';
import {PgInterjectionStore} from '../../src/infrastructure/agent-run/pg-interjection-store';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {PgNativeRunInputs} from '../../src/infrastructure/agent-run/pg-native-run-inputs';
import {PgChatRepository} from '../../src/infrastructure/chat/pg-chat-repository';
import {officeSkillPackage} from '../../scripts/office-skill-packages';
import {DOCX_CREATE_SKILL_MD,XLSX_CREATE_SKILL_MD,PPTX_CREATE_SKILL_MD,PDF_CREATE_SKILL_MD} from '../../scripts/office-docs-skill-content';
import {FileSkillStarterPackSource} from '../../src/infrastructure/skill/file-skill-starter-pack-source';
import {verifySkillStarterPack} from '../../src/domain/skill/starter-pack';
import {PLATFORM_SKILL_CATALOG} from '../../src/domain/skill/platform-skill-catalog';

const org=toOrgId('pdf-perf-'+randomUUID()),parent='run-'+randomUUID();
const workspace=join(process.cwd(),'../..');
let db:PgDatabase;let root:string;
const prompt=process.env.WX_PDF_PERF_PROMPT??'生成一个 pdf，总结你可以做的事情';
const evidence=process.env.WX_PDF_PERF_EVIDENCE!;

function processRun(cmd:string,args:string[],input='',env=process.env):Promise<string>{return new Promise((resolve,reject)=>{const child=spawn(cmd,args,{env});const timer=setTimeout(()=>child.kill('SIGKILL'),1_800_000);child.on('close',()=>clearTimeout(timer));let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(new Error(`real model process exited ${code}; ${err.replaceAll(process.env.DASHSCOPE_API_KEY??'never-match-secret','[redacted]')}`)));child.stdin.end(input);});}

beforeAll(async()=>{
 await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());root=await mkdtemp(join(tmpdir(),'wx-pdfperf-'));
 const project=`project-${org}`,thread=`thread-${org}`,agent=`agent-${org}`,version=`version-${org}`;
 await seedOrg({orgId:org,projectId:project});
 await addOrgMember(org,'actor','consultant',null);
 await addProjectMember(org,project,'actor','member',null);
 await addChatThread({orgId:org,id:thread,projectId:null,visibilityScope:'private',createdBy:'actor'});
 await addChatMessage({orgId:org,id:`message-${org}`,threadId:thread,body:'parent',authorId:'actor'});
 await asApp(org,async c=>{
  await c.query(`INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,$2,'t042','T042','enabled','actor',now(),now())`,[agent,org]);
  await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES($1,$2,$3,'v1',$4,'pinned instructions','{}','dashscope',$5,'[]','actor',now(),now())`,[version,org,agent,createHash('sha256').update('pinned instructions').digest('hex'),process.env.DASHSCOPE_MODEL]);
  await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES($1,$2,$3,$4,$5,$6,'[]','dashscope',$7,'running',now(),1,now()+interval '60 minutes')`,[parent,org,thread,`message-${org}`,agent,version,process.env.DASHSCOPE_MODEL]);
  await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,parent]);
 });
});
afterAll(async()=>{await db?.close();await resetOrgs(org);await rm(root,{recursive:true,force:true});});

it('records a wall-clock timeline for one real-model PDF generation',async()=>{
 for(const key of ['DASHSCOPE_API_KEY','DASHSCOPE_BASE_URL','DASHSCOPE_MODEL','WX_PDF_PERF_EVIDENCE','WX_NATIVE_SANDBOX_CONTAINER'])if(!process.env[key])throw new Error(`missing ${key}`);
 const container=process.env.WX_NATIVE_SANDBOX_CONTAINER!;
 const fixture=await readFile(join(workspace,'apps/deep-agent-service/tests/native_sandbox_fixture.py'),'utf8'),relayCode=fixture.split('_UDS_RELAY = r"""')[1]?.split('"""')[0];if(!relayCode)throw new Error('relay missing');
 const socket=join(root,'sandbox.sock');
 const relay=createServer(async(req,res)=>{try{req.setEncoding('utf8');let body='';for await(const c of req)body+=c;const output=JSON.parse(await processRun('docker',['exec','-i',container,'node','-e',relayCode.replace("let input = '';","process.stdin.setEncoding('utf8'); let input = '';").replace("let body='';res.on","res.setEncoding('utf8'); let body='';res.on")],JSON.stringify({method:req.method,path:req.url,headers:req.headers,body})));res.writeHead(output.status,{'content-type':'application/json'});res.end(output.body);}catch(error){res.writeHead(503);res.end('{"error":"sandbox_transport_failed"}');}});
 await new Promise<void>(r=>relay.listen(socket,r));
 const objects=new FsObjectStore(root),repo=new PgAgentRunRepository(db),grants=new PgToolPermissionGrantRepository(db),identity=new PgIdentityRepository(db),chat=new PgChatRepository(db);
 const owner=new PgNativeSessionOwner(db,new PgParentRunControlReader(db),createNativeSessionTransport(socket),'e'.repeat(64),new PgNativeRunInputs(db,objects,{repo:identity,ids:{next:()=>randomUUID()},chat}));
 const authority=new ToolExecutionAuthority(new PgParentRunControlReader(db),repo,grants),staging=new PgNativeOutputStaging(db,owner,objects,authority,b=>createNativeSessionFiles({socketPath:socket,...b}));
 process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=randomUUID();
 const previousObjectRoot=process.env.WORKSPACEX_OBJECT_ROOT;process.env.WORKSPACEX_OBJECT_ROOT=root;
 let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;let provisioned=false;
 try{
  for(const tool of ['write_todos','read_file','write_file','edit_file','ls','glob','execute','wx_artifact_publish'])await grants.grantForRun(org,parent,tool);
  const content={'docx-create':DOCX_CREATE_SKILL_MD,'xlsx-create':XLSX_CREATE_SKILL_MD,'pptx-create':PPTX_CREATE_SKILL_MD,'pdf-create':PDF_CREATE_SKILL_MD};
  const office=PLATFORM_SKILL_CATALOG.map(spec=>({stableName:spec.stableName,package:officeSkillPackage({...spec,content:content[spec.stableName as keyof typeof content]}).package}));
  // WX_PDF_PERF_PACKS=all reproduces the devapp shape: 17 starter-pack skills + the 4 office ones = the 21 the user saw.
  const source=new FileSkillStarterPackSource(join(workspace,'skills/starter-packs'));
  const packVersions:Record<string,string>={'data-workflows':'1.0.0','standard-audio':'1.1.1','standard-authoring':'1.0.0','standard-canvas':'1.0.0','standard-context':'1.1.0','standard-document':'1.2.0','standard-methods':'1.3.0','standard-visual':'1.0.1','standard-web':'1.1.2'};
  const extra=process.env.WX_PDF_PERF_PACKS==='all'?(await Promise.all(Object.entries(packVersions).map(async([packId,packVersion])=>verifySkillStarterPack(await source.load(packId,packVersion),{packId,packVersion})))).flatMap(pack=>pack.skills.map(s=>({stableName:s.stableName,package:{skillId:s.stableName,versionId:s.semanticVersion,files:s.files}}))):[];
  const skills=[...office,...extra];
  const ctx={orgId:org,parentRunId:parent,attemptId:parent+':0',leaseEpoch:1};
  const policy:Record<string,boolean>=Object.fromEntries(['execute','wx_artifact_publish','write_todos','read_file','write_file','edit_file','ls','glob','grep'].map(name=>[name,false]));
  const ref=await owner.provision(ctx,skills,policy);provisioned=true;
  class TestModule{};Module({controllers:[NativeSessionController,NativeOutputStagingController,RunInterjectionController],providers:[{provide:NATIVE_SESSION_OWNER,useValue:owner},{provide:NATIVE_OUTPUT_STAGING,useValue:staging},{provide:TOOL_EXECUTION_AUTHORITY,useValue:authority},{provide:AGENT_RUN_STORE,useValue:repo},{provide:INTERJECTION_STORE,useValue:new PgInterjectionStore(db)},{provide:TOOL_PERMISSION_GRANT_STORE,useValue:grants}]})(TestModule);
  app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const config={configurable:{native_runtime:ref,org_skills:skills.map(s=>({stable_name:s.stableName,package:s.package})),disable_task_auto_classify:true,run_control_callback:{base_url:base,key:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY,org_id:org,run_id:parent,attempt_id:ctx.attemptId,lease_epoch:1}}};
  const startedAt=Date.now();
  const raw=await processRun(join(workspace,'apps/deep-agent-service/.venv/bin/python'),[join(workspace,'apps/deep-agent-service/tests/pdf_perf_runner.py')],JSON.stringify({config,prompt}),{...process.env,PYTHONPATH:join(workspace,'apps/deep-agent-service/src'),NATIVE_SESSION_SOCKET:socket,NATIVE_SESSION_SERVICE_BASE_URL:base,NATIVE_SESSION_SERVICE_KEY:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY});
  await mkdir(evidence,{recursive:true});
  await writeFile(join(evidence,(process.env.WX_PDF_PERF_LABEL??'run')+'-timeline.json'),JSON.stringify({wallClockSeconds:(Date.now()-startedAt)/1000,...JSON.parse(raw)},null,2));
  const files=await staging.listFiles(org,parent);
  await writeFile(join(evidence,(process.env.WX_PDF_PERF_LABEL??'run')+'-files.json'),JSON.stringify(files.map(f=>({name:f.name,objectKey:f.objectKey})),null,2));
 }finally{
  await app?.close();
  if(provisioned)await owner.releaseForRun(org,parent).catch(()=>{});
  relay.close();
  if(previousObjectRoot===undefined)delete process.env.WORKSPACEX_OBJECT_ROOT;else process.env.WORKSPACEX_OBJECT_ROOT=previousObjectRoot;
 }
},1_800_000);
