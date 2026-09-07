import {STANDARD_CONTEXT_SERVICE} from '../../src/application/agent-run/standard-context-tools';
import {STANDARD_WEB_SERVICE} from '../../src/application/agent-run/standard-web-tools';
import {StandardContextToolsController} from '../../src/interface/controllers/standard-context-tools.controller';
import {StandardWebToolsController} from '../../src/interface/controllers/standard-web-tools.controller';
import {IDENTITY_REPOSITORY,DECISION_ID_FACTORY} from '../../src/application/identity/ports';
import {CHAT_REPOSITORY} from '../../src/application/chat/ports';
import {extractAttachment} from '../../src/application/chat/attachment-extraction-worker';
import {PgAttachmentExtractionRepository} from '../../src/infrastructure/chat/pg-attachment-extraction-repository';
import {AnydocAttachmentToMarkdown} from '../../src/infrastructure/chat/anydoc-attachment-to-markdown';
import {SKILL_BATCH_SCENARIOS,type SkillBatchId} from './skill-batch-scenarios';
import {officeSkillPackage} from '../../scripts/office-skill-packages';
import {DOCX_CREATE_SKILL_MD,XLSX_CREATE_SKILL_MD,PPTX_CREATE_SKILL_MD,PDF_CREATE_SKILL_MD} from '../../scripts/office-docs-skill-content';
import {PLATFORM_SKILL_CATALOG} from '../../src/domain/skill/platform-skill-catalog';
import {NestFactory} from '@nestjs/core';
import {Module} from '@nestjs/common';
import {NativeOutputStagingController} from '../../src/interface/controllers/native-output-staging.controller';
import {NATIVE_OUTPUT_STAGING} from '../../src/application/agent-run/native-output-staging';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {beforeAll,afterAll,it,expect} from 'vitest';
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
import {Document,Header,Packer,Paragraph,Table,TableCell,TableRow} from 'docx';
import ExcelJS from 'exceljs';
import PptxGenJS from 'pptxgenjs';
import {unzip} from '@repo/skill-sandbox/ooxml';
import {inspectPdf} from '@repo/skill-sandbox/inspect-pdf';
import {canonicalSkillPackageManifest} from '@repo/contracts/skill-package-manifest';
const caseId=process.env.WX_SKILL_BATCH_CASE as SkillBatchId;
if(!Object.hasOwn(SKILL_BATCH_SCENARIOS,caseId))throw new Error('unknown skill batch case');
const scenario=SKILL_BATCH_SCENARIOS[caseId];
const org=toOrgId('skill-batch-'+randomUUID()),parent='run-'+randomUUID();
const workspace=join(process.cwd(),'../..');let db:PgDatabase;let root:string;
function processRun(cmd:string,args:string[],input='',env=process.env):Promise<string>{return new Promise((resolve,reject)=>{const child=spawn(cmd,args,{env});const timer=setTimeout(()=>child.kill('SIGKILL'),240000);child.on('close',()=>clearTimeout(timer));let out='',err='';child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(new Error(`real model process exited ${code}; ${err.replaceAll(process.env.DASHSCOPE_API_KEY??'never-match-secret','[redacted]')}`)));child.stdin.end(input);});}
async function seed(scope: typeof org, id: string) {
  const project = `project-${scope}`, thread = `thread-${scope}`, agent = `agent-${scope}`, version = `version-${scope}`;
  await seedOrg({ orgId: scope, projectId: project });
  await addOrgMember(scope,"actor","consultant",null);
  await addProjectMember(scope,project,'actor','member',null);
  await addOrgMember(scope,"intruder","consultant",null);
  await addChatThread({ orgId: scope, id: thread, projectId: null, visibilityScope: "private", createdBy: "actor" });
  await addChatMessage({ orgId: scope, id: `message-${scope}`, threadId: thread, body: "parent", authorId: "actor" });
  await asApp(scope, async (c) => {
    await c.query("UPDATE projects SET name='Cedar' WHERE org_id=$1 AND id=$2",[scope,project]);
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

async function officeEditFixture(id:SkillBatchId):Promise<{bytes:Buffer;mime:string}|null>{
 if(id==='S003_EDIT')return {mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:await Packer.toBuffer(new Document({sections:[{headers:{default:new Header({children:[new Paragraph('页眉保持') ]})},children:[new Paragraph('季度状态：待确认'),new Paragraph('无关段落保持'),new Table({rows:[new TableRow({children:[new TableCell({children:[new Paragraph('表格保持') ]})]})]})]}]}))};
 if(id==='S004_EDIT'){const book=new ExcelJS.Workbook(),data=book.addWorksheet('Data'),other=book.addWorksheet('Other');data.getCell('A1').value=1;data.getCell('B2').value='样式保持';data.getCell('B2').font={bold:true,color:{argb:'FF336699'}};other.getCell('A1').value='工作表保持';other.getCell('C1').value={formula:'Data!A1*2',result:2};return {mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes:Buffer.from(await book.xlsx.writeBuffer())};}
 if(id==='S005_EDIT'){const deck=new PptxGenJS(),first=deck.addSlide();first.addText('状态：待确认',{x:1,y:1,w:4,h:1,fontFace:'Noto Sans CJK SC'});first.addImage({data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',x:1,y:3,w:1,h:1});deck.addSlide().addText('第二页保持',{x:1,y:1,w:4,h:1,fontFace:'Noto Sans CJK SC'});return {mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation',bytes:(await deck.write({outputType:'nodebuffer'})) as Buffer};}
 return null;
}
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const zipManifest=(bytes:Buffer)=>Object.fromEntries(unzip(bytes).map(entry=>[entry.name,{sizeBytes:entry.bytes.length,sha256:sha(entry.bytes)}]));
function packagePins(skills:readonly {stableName:string;package:{skillId:string;versionId:string;files:readonly {path:string;digest:string}[]}}[]){return skills.map(skill=>({stableName:skill.stableName,skillId:skill.package.skillId,versionId:skill.package.versionId,packageDigest:sha(canonicalSkillPackageManifest(skill.package.files))}));}

beforeAll(async()=>{await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());root=await mkdtemp(join(tmpdir(),'wx-chain-'));await seed(org,parent);
 await asApp(org,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE id=$1",[parent]));
 await asApp(org,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,parent]));
});
afterAll(async()=>{await db?.close();await resetOrgs(org);await rm(root,{recursive:true,force:true});});
import {verifySkillStarterPack} from '../../src/domain/skill/starter-pack';
it('real configured model executes the selected synthetic skill scenario',async()=>{
 for(const key of ['DASHSCOPE_API_KEY','DASHSCOPE_BASE_URL','DASHSCOPE_MODEL','WX_SKILL_BATCH_EVIDENCE'])if(!process.env[key])throw new Error(`missing ${key}`);
 const packVersion=('packVersion' in scenario?scenario.packVersion:process.env.WX_SKILL_BATCH_PACK_VERSION)??'1.0.0';
 if(!['1.0.0','1.1.0','1.1.2'].includes(packVersion)||(packVersion==='1.1.0'&&scenario.packId!=='standard-context')||(packVersion==='1.1.2'&&scenario.packId!=='standard-web'))throw new Error('unsupported case package version');
 const container=process.env.WX_NATIVE_SANDBOX_CONTAINER;if(!container)throw new Error('owned sandbox required');
 const fixture=await readFile(join(workspace,'apps/deep-agent-service/tests/native_sandbox_fixture.py'),'utf8'),relayCode=fixture.split('_UDS_RELAY = r"""')[1]?.split('"""')[0];if(!relayCode)throw new Error('relay missing');
 const socket=join(root,'sandbox.sock');const relay=createServer(async(req,res)=>{try{req.setEncoding('utf8');let body='';for await(const c of req)body+=c;const output=JSON.parse(await processRun('docker',['exec','-i',container,'node','-e',relayCode.replace("let input = '';", "process.stdin.setEncoding('utf8'); let input = '';").replace("let body='';res.on", "res.setEncoding('utf8'); let body='';res.on")],JSON.stringify({method:req.method,path:req.url,headers:req.headers,body})));res.writeHead(output.status,{'content-type':'application/json'});res.end(output.body);}catch(error){const evidence=process.env.WX_SKILL_BATCH_EVIDENCE;if(evidence){let detail=String(error);for(const key of ['DASHSCOPE_API_KEY','NATIVE_SESSION_SERVICE_KEY','DEEP_AGENT_SERVICE_INTERNAL_KEY'])if(process.env[key])detail=detail.replaceAll(process.env[key]!,'[redacted]');await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'sandbox-transport-failure.json'),JSON.stringify({code:'sandbox_transport_failed',detail}));}res.writeHead(503);res.end('{"error":"sandbox_transport_failed"}');}});await new Promise<void>(r=>relay.listen(socket,r));
 const objects=new FsObjectStore(root),repo=new PgAgentRunRepository(db),grants=new PgToolPermissionGrantRepository(db),identity=new PgIdentityRepository(db),chat=new PgChatRepository(db);
 const owner=new PgNativeSessionOwner(db,new PgParentRunControlReader(db),createNativeSessionTransport(socket),'e'.repeat(64),new PgNativeRunInputs(db,objects,{repo:identity,ids:{next:()=>randomUUID()},chat}));
 const authority=new ToolExecutionAuthority(new PgParentRunControlReader(db),repo,grants),staging=new PgNativeOutputStaging(db,owner,objects,authority,b=>createNativeSessionFiles({socketPath:socket,...b}));
 const oldKey=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=randomUUID();let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 const previousEnv={WORKSPACEX_OBJECT_ROOT:process.env.WORKSPACEX_OBJECT_ROOT,KERNEL_AGENT_RUN_AUTOSTART:process.env.KERNEL_AGENT_RUN_AUTOSTART};
 process.env.WORKSPACEX_OBJECT_ROOT=root;process.env.KERNEL_AGENT_RUN_AUTOSTART='0';
 let production:Awaited<ReturnType<typeof NestFactory.create>>|undefined,provisioned=false;
 try{
  for(const tool of ['write_todos','read_file','write_file','edit_file','ls','glob','execute','wx_artifact_publish','wx_knowledge_search','wx_knowledge_read','wx_project_list','wx_project_read','web_search','fetch_url'])await grants.grantForRun(org,parent,tool);
  const transcript=scenario.input;const editFixture=await officeEditFixture(caseId);const inputBytes=editFixture?.bytes??Buffer.from(transcript);
  if(!['S001_REVOKED','S008_EMPTY','S011_REVOKED'].includes(caseId)){
   const uploaded=await uploadAttachment({repo:identity,ids:{next:()=>randomUUID()},chat,attachments:new PgChatAttachmentRepository(db),store:objects,attachmentIds:{next:()=>randomUUID()},clock:{now:()=>new Date().toISOString()}},{orgId:org,userId:'actor',threadId:`thread-${org}`,filename:scenario.inputName,mime:editFixture?.mime??'text/plain',bytes:inputBytes});
   await asApp(org,c=>c.query('UPDATE chat_message_attachments SET message_id=$3 WHERE org_id=$1 AND id=$2',[org,uploaded.id,`message-${org}`]));
   expect(await extractAttachment({store:objects,extraction:new PgAttachmentExtractionRepository(db),converter:new AnydocAttachmentToMarkdown()},org,uploaded.id)).toBe('extracted');
  }
  const pack=scenario.packId==='office'?null:verifySkillStarterPack(await new FileSkillStarterPackSource(join(workspace,'skills/starter-packs')).load(scenario.packId,packVersion),{packId:scenario.packId,packVersion});
  const content={ 'docx-create':DOCX_CREATE_SKILL_MD,'xlsx-create':XLSX_CREATE_SKILL_MD,'pptx-create':PPTX_CREATE_SKILL_MD,'pdf-create':PDF_CREATE_SKILL_MD };
  const skills=pack?pack.skills.map(s=>({stableName:s.stableName,package:{skillId:s.stableName,versionId:s.semanticVersion,files:s.files}})):
   PLATFORM_SKILL_CATALOG.map(spec=>({stableName:spec.stableName,package:officeSkillPackage({...spec,content:content[spec.stableName as keyof typeof content]}).package}));
  const originalPins=packagePins(skills),originalPinsJson=JSON.stringify(originalPins);
  const ctx={orgId:org,parentRunId:parent,attemptId:parent+':0',leaseEpoch:1};const policy:Record<string,boolean>=Object.fromEntries(['execute','wx_artifact_publish','write_todos','read_file','write_file','edit_file','ls','glob','grep'].map(name=>[name,false]));
  if(caseId.startsWith('S001')||caseId.startsWith('S008')||caseId.startsWith('S011')||caseId.startsWith('S014'))for(const name of ['wx_knowledge_search','wx_knowledge_read','wx_project_list','wx_project_read'])policy[name]=false;
  if(caseId.startsWith('S002'))for(const name of ['web_search','fetch_url'])policy[name]=false;
  const ref=await owner.provision(ctx,skills,policy);provisioned=true;
  const initialResolved=await owner.resolve(ref.bindingId,ctx);
  production=await(await import('../../src/main')).createApp();
  const conflictSources=[
   {url:'https://docs.example.test/widget-current',title:'Current widget status',text:'Acme Widget is generally available in release 2.0.'},
   {url:'https://archive.example.test/widget-preview',title:'Archived widget status',text:'Acme Widget remains preview-only in release 1.5.'},
  ].map(source=>({...source,sourceId:'web:'+createHash('sha256').update(source.url).digest('hex'),contentHash:createHash('sha256').update(source.text).digest('hex')}));
  const webService=caseId==='S002_CONFLICT'?{
   search:async()=>({results:conflictSources.map(source=>({sourceId:source.sourceId,url:source.url,title:source.title,snippet:source.text,contentHash:source.contentHash,retrievedAt:new Date().toISOString()})),truncated:false,provider:'boardx-google',candidateLimit:5,domainFilter:'post-filter-provider-candidates',contentKind:'search-snippet'}),
   fetch:async(input:{url:string})=>{const source=conflictSources.find(item=>item.url===input.url);if(!source)throw new Error('fixture_source_missing');return {sourceId:source.sourceId,url:source.url,resolvedUrl:source.url,title:source.title,text:source.text,contentHash:source.contentHash,retrievedAt:new Date().toISOString(),truncated:false,contentKind:'extracted-text',extractor:'utf8-text',hashScope:'full-extracted-text'};},
  }:production!.get(STANDARD_WEB_SERVICE);
  class TestModule{};Module({controllers:[NativeSessionController,NativeOutputStagingController,RunInterjectionController,StandardContextToolsController,StandardWebToolsController],providers:[{provide:STANDARD_CONTEXT_SERVICE,useValue:production!.get(STANDARD_CONTEXT_SERVICE)},{provide:STANDARD_WEB_SERVICE,useValue:webService},{provide:IDENTITY_REPOSITORY,useValue:identity},{provide:DECISION_ID_FACTORY,useValue:{next:()=>randomUUID()}},{provide:CHAT_REPOSITORY,useValue:chat},{provide:NATIVE_SESSION_OWNER,useValue:owner},{provide:NATIVE_OUTPUT_STAGING,useValue:staging},{provide:TOOL_EXECUTION_AUTHORITY,useValue:authority},{provide:AGENT_RUN_STORE,useValue:repo},{provide:INTERJECTION_STORE,useValue:new PgInterjectionStore(db)},{provide:TOOL_PERMISSION_GRANT_STORE,useValue:grants}]})(TestModule);
  app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const revoked=caseId==='S001_REVOKED'||caseId==='S011_REVOKED';
  if(revoked){
   const projectId=`project-${org}`,sourceThread=`source-thread-${org}`,sourceMessage=`source-message-${org}`;
   await addChatThread({orgId:org,id:sourceThread,projectId,visibilityScope:'plenary',createdBy:'actor'});
   await addChatMessage({orgId:org,id:sourceMessage,threadId:sourceThread,body:'revocable source',authorId:'actor'});
   const secret='AX-17 confidential launch date is 2039-04-03 and adoption is 91 percent.';
   const sourceUpload=await uploadAttachment({repo:identity,ids:{next:()=>randomUUID()},chat,attachments:new PgChatAttachmentRepository(db),store:objects,attachmentIds:{next:()=>randomUUID()},clock:{now:()=>new Date().toISOString()}},{orgId:org,userId:'actor',threadId:sourceThread,filename:'revocable.txt',mime:'text/plain',bytes:Buffer.from(secret)});
   await asApp(org,c=>c.query('UPDATE chat_message_attachments SET message_id=$3 WHERE org_id=$1 AND id=$2',[org,sourceUpload.id,sourceMessage]));
   expect(await extractAttachment({store:objects,extraction:new PgAttachmentExtractionRepository(db),converter:new AnydocAttachmentToMarkdown()},org,sourceUpload.id)).toBe('extracted');
   const invoke=async(toolName:string,toolArgs:unknown)=>{const response=await fetch(`${base}/internal/agent-runs/${parent}/standard-context/invoke`,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY!},body:JSON.stringify({orgId:org,attemptId:ctx.attemptId,leaseEpoch:1,toolCallId:randomUUID(),toolName,toolArgs})});return {status:response.status,body:await response.text()};};
   const searched=await invoke('wx_knowledge_search',{query:'AX-17',projectId});expect(searched.status).toBe(200);const hit=(JSON.parse(searched.body) as {items:Array<{sourceId:string;versionId:string}>}).items[0];expect(hit).toBeDefined();
   const read=await invoke('wx_knowledge_read',{sourceId:hit!.sourceId,versionId:hit!.versionId,projectId});expect(read.status).toBe(200);expect(read.body).toContain('2039-04-03');
   await asApp(org,c=>c.query('DELETE FROM project_memberships WHERE org_id=$1 AND project_id=$2 AND user_id=$3',[org,projectId,'actor']));
   const denied=await invoke('wx_knowledge_read',{sourceId:hit!.sourceId,versionId:hit!.versionId,projectId});expect(denied.status).toBe(503);expect(denied.body).not.toContain(secret);
   const evidence=process.env.WX_SKILL_BATCH_EVIDENCE!,readBody=JSON.parse(read.body);await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'revocation-proof.json'),JSON.stringify({sourceId:hit!.sourceId,versionId:hit!.versionId,before:{status:read.status,body:readBody,contentHash:createHash('sha256').update(readBody.content).digest('hex')},after:{status:denied.status,body:JSON.parse(denied.body)}}));
  }
  const config={configurable:{native_runtime:ref,org_skills:skills.map(s=>({stable_name:s.stableName,package:s.package})),disable_task_auto_classify:true,run_control_callback:{base_url:base,key:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY,org_id:org,run_id:parent,attempt_id:ctx.attemptId,lease_epoch:1}}};
  const raw=await processRun(join(workspace,'apps/deep-agent-service/.venv/bin/python'),[join(workspace,'apps/deep-agent-service/tests/skill_batch_real_model_runner.py')],JSON.stringify({config,prompt:scenario.prompt}),{...process.env,PYTHONPATH:join(workspace,'apps/deep-agent-service/src'),NATIVE_SESSION_SOCKET:socket,NATIVE_SESSION_SERVICE_BASE_URL:base,NATIVE_SESSION_SERVICE_KEY:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY});
  const evidence=process.env.WX_SKILL_BATCH_EVIDENCE!;await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'model-trace.json'),raw);const report=JSON.parse(raw);
  expect(report.skillActivity.some((fact:{skillStableName:string;stage:string})=>fact.skillStableName===scenario.stableName&&fact.stage==='body_read')).toBe(true);
  expect(report.calls.some((c:{name:string})=>c.name==='wx_artifact_publish')).toBe(true);
  expect(report.negativeCalls).toEqual([]);
  if(['S011_REVOKED','S014_CURRENT'].includes(caseId))expect(report.calls.some((c:{name:string})=>['send_email','send_notification','create_task','post_message'].includes(c.name))).toBe(false);
  const files=await staging.listFiles(org,parent);expect(files.length).toBeGreaterThan(0);
  const primary=files.find(f=>f.name===scenario.output);expect(primary).toBeDefined();
  if(caseId==='S003_EDIT'||caseId==='S004_EDIT'||caseId==='S005_EDIT'){
   expect(report.calls.some((call:{name:string;args:{command?:string}})=>call.name==='execute'&&call.args.command?.includes('render-office.py'))).toBe(true);
   expect(files.some(file=>file.name.endsWith('.pdf'))).toBe(true);expect(files.some(file=>file.name.endsWith('.png'))).toBe(true);
  }
  const bytes=Buffer.from((await objects.get(primary!.objectKey))!);
  for(const file of files){if(!/^[a-zA-Z0-9_.-]+$/.test(file.name))throw new Error('unsafe evidence filename');await writeFile(join(evidence,file.name),Buffer.from((await objects.get(file.objectKey))!));}
  await writeFile(join(evidence,'source.txt'),transcript);
  const assertions:Record<string,boolean>={targetChanged:false,unrelatedEntriesPreserved:false,pinUsed:false,oldPinUnchanged:false,artifactHashPreserved:false,freshSandboxReopen:false,rendererBoundToEditedSource:false,pageCountVerified:false,reviewableScreenshots:false};
  if(editFixture){await writeFile(join(evidence,scenario.inputName),inputBytes);await writeFile(join(evidence,'original-structure.json'),JSON.stringify(zipManifest(inputBytes),null,2));await writeFile(join(evidence,'result-structure.json'),JSON.stringify(zipManifest(bytes),null,2));}
  if(caseId==='S003_EDIT'||caseId==='S005_EDIT'){
   const changedPart=caseId==='S003_EDIT'?'word/document.xml':'ppt/slides/slide1.xml',before=new Map(unzip(inputBytes).map(e=>[e.name,e.bytes])),after=new Map(unzip(bytes).map(e=>[e.name,e.bytes]));expect([...after.keys()]).toEqual([...before.keys()]);
   const unrelated=[...before].filter(([name])=>name!==changedPart).map(([name,original])=>({name,originalSha256:sha(original),resultSha256:sha(after.get(name)!)}));for(const entry of unrelated)expect(entry.resultSha256).toBe(entry.originalSha256);await writeFile(join(evidence,'unrelated-entry-hashes.json'),JSON.stringify(unrelated,null,2));assertions.unrelatedEntriesPreserved=true;
   const changed=after.get(changedPart)!.toString('utf8');expect(changed).toContain('已确认');expect(changed).not.toContain('待确认');
   await writeFile(join(evidence,'target-diff.json'),JSON.stringify({part:changedPart,beforeSha256:sha(before.get(changedPart)!),afterSha256:sha(after.get(changedPart)!),beforeText:caseId==='S003_EDIT'?'季度状态：待确认':'状态：待确认',afterText:caseId==='S003_EDIT'?'季度状态：已确认':'状态：已确认'},null,2));assertions.targetChanged=true;
  }
  if(caseId==='S004_EDIT'){const before=new ExcelJS.Workbook(),after=new ExcelJS.Workbook();await before.xlsx.load(inputBytes as unknown as Parameters<typeof before.xlsx.load>[0]);await after.xlsx.load(bytes as unknown as Parameters<typeof after.xlsx.load>[0]);expect(after.getWorksheet('Data')!.getCell('A1').value).toBe(7);expect(after.getWorksheet('Other')!.getCell('A1').value).toBe('工作表保持');expect(after.getWorksheet('Other')!.getCell('C1').value).toEqual(before.getWorksheet('Other')!.getCell('C1').value);expect(after.getWorksheet('Data')!.getCell('B2').font).toEqual(before.getWorksheet('Data')!.getCell('B2').font);const xml=new Map(unzip(bytes).map(e=>[e.name,e.bytes])).get('xl/workbook.xml')!.toString('utf8');expect(xml).toMatch(/fullCalcOnLoad="1"/);const beforeZip=zipManifest(inputBytes),afterZip=zipManifest(bytes),targetParts=['xl/workbook.xml','xl/worksheets/sheet1.xml'],unrelated=Object.keys(beforeZip).filter(name=>!targetParts.includes(name)).map(name=>({name,originalSha256:beforeZip[name]!.sha256,resultSha256:afterZip[name]?.sha256}));for(const entry of unrelated)expect(entry.resultSha256).toBe(entry.originalSha256);expect(unrelated.some(entry=>entry.name.includes('sheet2.xml'))).toBe(true);await writeFile(join(evidence,'unrelated-entry-hashes.json'),JSON.stringify(unrelated,null,2));await writeFile(join(evidence,'target-diff.json'),JSON.stringify({parts:targetParts,cell:'Data!A1',before:1,after:7,recalculationRequested:/fullCalcOnLoad="1"/.test(xml)},null,2));assertions.targetChanged=true;assertions.unrelatedEntriesPreserved=true;}
  if(scenario.output.endsWith('.md')){
   const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   if(caseId==='S007'){expect(files.some(f=>f.name.endsWith('.py'))).toBe(true);expect(files.some(f=>f.name.endsWith('.csv'))).toBe(true);expect(report.calls.some((c:{name:string;args:{command?:string}})=>c.name==='execute'&&/python/.test(c.args.command??''))).toBe(true);expect(text).toMatch(/52/);expect(text).toMatch(/40/);expect(text).toMatch(/12/);expect(text).toMatch(/缺失|空值|missing/i);expect(text).toMatch(/重复|duplicate/i);}
   if(caseId==='S002'||caseId==='S002_CONFLICT'){expect(report.calls.some((c:{name:string})=>c.name==='web_search')).toBe(true);expect(report.calls.some((c:{name:string})=>c.name==='fetch_url')).toBe(true);expect(text).toMatch(/https:\/\//);const fetched=report.results.filter((r:{name:string;status:string})=>r.name==='fetch_url'&&r.status==='success').map((r:{content:string})=>JSON.parse(r.content) as {sourceId:string;contentHash:string;url:string;text?:string});expect(fetched.length).toBeGreaterThan(0);expect(fetched.some((f:{sourceId:string;contentHash:string})=>text.includes(f.sourceId)&&text.includes(f.contentHash))).toBe(true);if(caseId==='S002_CONFLICT'){expect(fetched).toHaveLength(2);for(const source of conflictSources){expect(text).toContain(source.sourceId);expect(text).toContain(source.contentHash);expect(text).toContain(source.url);expect(fetched.some((f:{text?:string})=>f.text===source.text)).toBe(true);}expect(text).toMatch(/冲突|矛盾|conflict/i);}}
   if(caseId==='S001'){expect(text).toMatch(/14/);expect(text).toMatch(/未知|未确定|undecided|unknown/i);expect(report.calls.some((c:{name:string})=>c.name==='wx_knowledge_read')).toBe(true);}
   if(caseId==='S008'){expect(text).toMatch(/3/);expect(text).toMatch(/议程|agenda/i);expect(text).toMatch(/未知|未确定|unknown/i);expect(report.calls.some((c:{name:string})=>c.name==='wx_knowledge_read')).toBe(true);}
   if(caseId==='S008_EMPTY'){expect(report.calls.some((c:{name:string})=>c.name==='wx_knowledge_search')).toBe(true);expect(text).toMatch(/待补|未知|unknown|missing/i);expect(text).toMatch(/目标|时间|参会|议程|项目事实/);expect(text).not.toMatch(/(?:负责人|参会人|项目经理)[：:]\s*[\u4e00-\u9fff]{2,4}|\b\d+%/);}
   if(caseId==='S001_REVOKED'||caseId==='S011_REVOKED'){expect(report.calls.some((c:{name:string})=>c.name==='wx_knowledge_search'||c.name==='wx_knowledge_read')).toBe(false);expect(text).toMatch(/未知|无法访问|撤权|无权|unknown|unavailable/i);expect(text).not.toMatch(/2039-04-03|91\s*(?:percent|%)/i);}
   if(caseId==='S014_CURRENT'){expect(report.calls.some((c:{name:string})=>c.name==='wx_project_list')).toBe(true);expect(report.calls.some((c:{name:string})=>c.name==='wx_project_read')).toBe(true);expect(text).toMatch(/Cedar/);expect(text).toMatch(/预算[\s\S]{0,50}(?:未知|未提供)|(?:未知|未提供)[\s\S]{0,50}预算/i);expect(text).toMatch(/任务[\s\S]{0,50}(?:未知|未提供)|(?:未知|未提供)[\s\S]{0,50}任务/i);expect(text).toMatch(/blueprint.{0,20}(?:null|未实现|未配置|不可用)/i);expect(text).not.toMatch(/blueprint\s*(?:已上线|已实现|可用)/i);const apiResults=report.results.filter((r:{name:string;status:string})=>['wx_project_list','wx_project_read'].includes(r.name)&&r.status==='success').map((r:{name:string;content:string})=>({name:r.name,body:JSON.parse(r.content)}));expect(apiResults).toHaveLength(2);const overview=apiResults.find((r:{name:string})=>r.name==='wx_project_read')!.body.overview;expect(overview.name).toBe('Cedar');expect(overview.status).toBe('active');expect(overview.roleCounts.member).toBe(1);await writeFile(join(evidence,'api-fixture.json'),JSON.stringify(apiResults));}
  }
  await repo.storeOutputAwaitingWriteback(org,parent,{text:report.final,finalStepSeq:1,files});const pending=(await repo.claimWritebackPending(org,1))[0]!;await repo.commitWriteback(org,{runId:parent,threadId:pending.threadId,inputMessageId:pending.inputMessageId,agentId:pending.agentId,text:pending.text,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),outputDigest:'a'.repeat(64),files});
  const versions=await db.withTenant(org,s=>s.query<{storage_key:string}>('SELECT storage_key FROM agent_artifact_versions WHERE org_id=$1 AND produced_by_run_id=$2',[org,parent]));expect(versions.rows).toHaveLength(files.length);
  if(editFixture){
  const published=versions.rows.find(row=>row.storage_key===primary!.objectKey);expect(published).toBeDefined();const downloaded=await objects.get(published!.storage_key);expect(downloaded).not.toBeNull();const outputSha256=createHash('sha256').update(bytes).digest('hex'),artifactDownloadSha256=createHash('sha256').update(downloaded!).digest('hex');expect(artifactDownloadSha256).toBe(outputSha256);
  assertions.artifactHashPreserved=true;
  const selectedPin=originalPins.find(pin=>pin.stableName===scenario.stableName)!;const activity=report.skillActivity.find((fact:{skillStableName:string;stage:string})=>fact.skillStableName===scenario.stableName&&fact.stage==='body_read');expect(activity?.skillVersion).toBe(selectedPin.versionId);expect(activity?.packageDigest).toBe(selectedPin.packageDigest);assertions.pinUsed=true;expect(JSON.stringify(packagePins(skills))).toBe(originalPinsJson);assertions.oldPinUnchanged=true;await writeFile(join(evidence,'package-pins.json'),JSON.stringify({selected:selectedPin,all:originalPins,activity:{skillVersion:activity.skillVersion,packageDigest:activity.packageDigest},unchangedAfterRun:true},null,2));
   const pdf=files.find(file=>file.name.endsWith('.pdf')),pngs=files.filter(file=>file.name.endsWith('.png')).sort((a,b)=>a.name.localeCompare(b.name));expect(pdf).toBeDefined();const pdfBytes=Buffer.from((await objects.get(pdf!.objectKey))!),pageCount=(await inspectPdf(pdfBytes)).pageCount,expectedPageCount=caseId==='S005_EDIT'?2:1;expect(pageCount).toBe(expectedPageCount);expect(pngs).toHaveLength(expectedPageCount);const renderCall=report.calls.find((call:{name:string;args:{command?:string}})=>call.name==='execute'&&call.args.command?.includes('render-office.py')&&call.args.command.includes(scenario.output));expect(renderCall).toBeDefined();const renderResult=report.results.find((result:{callId?:string;name:string;status:string;content?:string})=>result.name==='execute'&&result.status==='success'&&(!renderCall.id||result.callId===renderCall.id)&&result.content?.includes('visualInspection'));expect(renderResult).toBeDefined();assertions.rendererBoundToEditedSource=true;assertions.pageCountVerified=true;assertions.reviewableScreenshots=true;await writeFile(join(evidence,'visual-review.json'),JSON.stringify({source:{name:primary!.name,sha256:outputSha256},rendererCommand:renderCall.args.command,pdf:{name:pdf!.name,sha256:sha(pdfBytes),pageCount},screenshots:await Promise.all(pngs.map(async file=>({name:file.name,sha256:sha(Buffer.from((await objects.get(file.objectKey))!))}))),expectedPageCount,rendererManifestObserved:true,visualInspection:'required'},null,2));
   await owner.releaseForRun(org,parent);
   const reopenRun='run-'+randomUUID(),reopenMessage=`message-${reopenRun}`;await addChatMessage({orgId:org,id:reopenMessage,threadId:`thread-${org}`,body:'Reopen the exact edited Office artifact in a fresh sandbox.',authorId:'actor'});const reopenUpload=await uploadAttachment({repo:identity,ids:{next:()=>randomUUID()},chat,attachments:new PgChatAttachmentRepository(db),store:objects,attachmentIds:{next:()=>randomUUID()},clock:{now:()=>new Date().toISOString()}},{orgId:org,userId:'actor',threadId:`thread-${org}`,filename:scenario.output,mime:editFixture.mime,bytes});await asApp(org,async c=>{await c.query('UPDATE chat_message_attachments SET message_id=$3 WHERE org_id=$1 AND id=$2',[org,reopenUpload.id,reopenMessage]);await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) SELECT $2,org_id,thread_id,$3,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,'running',now(),1,now()+interval '10 minutes' FROM agent_runs WHERE org_id=$1 AND id=$4`,[org,reopenRun,reopenMessage,parent]);await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,reopenRun]);});const reopenCtx={orgId:org,parentRunId:reopenRun,attemptId:reopenRun+':0',leaseEpoch:1};const freshRef=await owner.provision(reopenCtx,skills,policy),fresh=await owner.resolve(freshRef.bindingId,reopenCtx);expect(fresh.sessionId).not.toBe(initialResolved.sessionId);expect(fresh.packageDigest).toBe(initialResolved.packageDigest);const input=fresh.inputs.find(item=>item.filename===scenario.output);expect(input).toBeDefined();const reopened=await createNativeSessionFiles({socketPath:socket,sessionId:fresh.sessionId,token:fresh.token}).read(input!.path) as {contentBase64:string;sizeBytes:number};const reopenedBytes=Buffer.from(reopened.contentBase64,'base64');expect(sha(reopenedBytes)).toBe(outputSha256);assertions.freshSandboxReopen=true;await writeFile(join(evidence,'fresh-sandbox-reopen.json'),JSON.stringify({releasedSessionId:initialResolved.sessionId,freshSessionId:fresh.sessionId,packageSetDigest:initialResolved.packageDigest,inputPath:input!.path,inputManifestDigest:input!.digest,reopenedSha256:sha(reopenedBytes),outputSha256,exactBytes:true},null,2));await owner.releaseForRun(org,reopenRun);
  expect(Object.values(assertions).every(Boolean)).toBe(true);await writeFile(join(evidence,'assertions.json'),JSON.stringify(assertions,null,2));
  await writeFile(join(evidence,'result.json'),JSON.stringify({model:report.model,modelSnapshot:{provider:'dashscope',modelId:process.env.DASHSCOPE_MODEL},caseId,packId:scenario.packId,packVersion,packDigest:pack?.packDigest??null,pins:originalPins,selectedPin,outputSha256,artifactDownloadSha256,artifacts:files.length,actualWriteback:true,assertions},null,2));
  }else await writeFile(join(evidence,'result.json'),JSON.stringify({model:report.model,modelSnapshot:{provider:'dashscope',modelId:process.env.DASHSCOPE_MODEL},caseId,packId:scenario.packId,packVersion,packDigest:pack?.packDigest??null,packages:skills.map(s=>({name:s.stableName,version:s.package.versionId})),outputSha256:createHash('sha256').update(bytes).digest('hex'),artifacts:files.length,actualWriteback:true}));
 }finally{
  const evidence=process.env.WX_SKILL_BATCH_EVIDENCE!;await mkdir(evidence,{recursive:true});
  for(const file of await staging.listFiles(org,parent)){if(/^[a-zA-Z0-9_.-]+$/.test(file.name)){const data=await objects.get(file.objectKey);if(data)await writeFile(join(evidence,file.name),Buffer.from(data));}}
  try{if(provisioned)await owner.releaseForRun(org,parent);}finally{await app?.close();await production?.close();for(const[k,v]of Object.entries(previousEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await new Promise<void>(r=>relay.close(()=>r()));if(oldKey===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=oldKey;}}
},300000);
