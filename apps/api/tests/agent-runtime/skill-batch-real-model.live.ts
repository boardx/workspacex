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
import {seedOrg,addOrgMember,asApp,ensureDatabase,migrateOnce,resetOrgs} from '../support/db';
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

async function officeEditFixture(id:SkillBatchId):Promise<{bytes:Buffer;mime:string}|null>{
 if(id==='S003_EDIT')return {mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:await Packer.toBuffer(new Document({sections:[{headers:{default:new Header({children:[new Paragraph('页眉保持') ]})},children:[new Paragraph('季度状态：待确认'),new Paragraph('无关段落保持'),new Table({rows:[new TableRow({children:[new TableCell({children:[new Paragraph('表格保持') ]})]})]})]}]}))};
 if(id==='S004_EDIT'){const book=new ExcelJS.Workbook(),data=book.addWorksheet('Data'),other=book.addWorksheet('Other');data.getCell('A1').value=1;data.getCell('B2').value='样式保持';data.getCell('B2').font={bold:true,color:{argb:'FF336699'}};other.getCell('A1').value='工作表保持';other.getCell('C1').value={formula:'Data!A1*2',result:2};return {mime:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',bytes:Buffer.from(await book.xlsx.writeBuffer())};}
 if(id==='S005_EDIT'){const deck=new PptxGenJS(),first=deck.addSlide();first.addText('状态：待确认',{x:1,y:1,w:4,h:1,fontFace:'Noto Sans CJK SC'});first.addImage({data:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',x:1,y:3,w:1,h:1});deck.addSlide().addText('第二页保持',{x:1,y:1,w:4,h:1,fontFace:'Noto Sans CJK SC'});return {mime:'application/vnd.openxmlformats-officedocument.presentationml.presentation',bytes:(await deck.write({outputType:'nodebuffer'})) as Buffer};}
 return null;
}

beforeAll(async()=>{await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());root=await mkdtemp(join(tmpdir(),'wx-chain-'));await seed(org,parent);
 await asApp(org,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE id=$1",[parent]));
 await asApp(org,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,parent]));
});
afterAll(async()=>{await db?.close();await resetOrgs(org);await rm(root,{recursive:true,force:true});});
import {verifySkillStarterPack} from '../../src/domain/skill/starter-pack';
it('real configured model executes the selected synthetic skill scenario',async()=>{
 for(const key of ['DASHSCOPE_API_KEY','DASHSCOPE_BASE_URL','DASHSCOPE_MODEL','WX_SKILL_BATCH_EVIDENCE'])if(!process.env[key])throw new Error(`missing ${key}`);
 const packVersion=process.env.WX_SKILL_BATCH_PACK_VERSION??'1.0.0';if(!['1.0.0','1.1.0'].includes(packVersion)||(packVersion==='1.1.0'&&scenario.packId!=='standard-context'))throw new Error('unsupported case package version');
 const container=process.env.WX_NATIVE_SANDBOX_CONTAINER;if(!container)throw new Error('owned sandbox required');
 const fixture=await readFile(join(workspace,'apps/deep-agent-service/tests/native_sandbox_fixture.py'),'utf8'),relayCode=fixture.split('_UDS_RELAY = r"""')[1]?.split('"""')[0];if(!relayCode)throw new Error('relay missing');
 const socket=join(root,'sandbox.sock');const relay=createServer(async(req,res)=>{try{req.setEncoding('utf8');let body='';for await(const c of req)body+=c;const output=JSON.parse(await processRun('docker',['exec','-i',container,'node','-e',relayCode.replace("let input = '';", "process.stdin.setEncoding('utf8'); let input = '';").replace("let body='';res.on", "res.setEncoding('utf8'); let body='';res.on")],JSON.stringify({method:req.method,path:req.url,headers:req.headers,body})));res.writeHead(output.status,{'content-type':'application/json'});res.end(output.body);}catch{res.writeHead(503);res.end('{}');}});await new Promise<void>(r=>relay.listen(socket,r));
 const objects=new FsObjectStore(root),repo=new PgAgentRunRepository(db),grants=new PgToolPermissionGrantRepository(db),identity=new PgIdentityRepository(db),chat=new PgChatRepository(db);
 const owner=new PgNativeSessionOwner(db,new PgParentRunControlReader(db),createNativeSessionTransport(socket),'e'.repeat(64),new PgNativeRunInputs(db,objects,{repo:identity,ids:{next:()=>randomUUID()},chat}));
 const authority=new ToolExecutionAuthority(new PgParentRunControlReader(db),repo,grants),staging=new PgNativeOutputStaging(db,owner,objects,authority,b=>createNativeSessionFiles({socketPath:socket,...b}));
 const oldKey=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=randomUUID();let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 const previousEnv={WORKSPACEX_OBJECT_ROOT:process.env.WORKSPACEX_OBJECT_ROOT,KERNEL_AGENT_RUN_AUTOSTART:process.env.KERNEL_AGENT_RUN_AUTOSTART};
 process.env.WORKSPACEX_OBJECT_ROOT=root;process.env.KERNEL_AGENT_RUN_AUTOSTART='0';
 let production:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 try{
  for(const tool of ['write_todos','read_file','write_file','edit_file','ls','glob','execute','wx_artifact_publish','wx_knowledge_search','wx_knowledge_read','wx_project_list','wx_project_read','web_search','fetch_url'])await grants.grantForRun(org,parent,tool);
  const transcript=scenario.input;const editFixture=await officeEditFixture(caseId);const inputBytes=editFixture?.bytes??Buffer.from(transcript);
  const uploaded=await uploadAttachment({repo:identity,ids:{next:()=>randomUUID()},chat,attachments:new PgChatAttachmentRepository(db),store:objects,attachmentIds:{next:()=>randomUUID()},clock:{now:()=>new Date().toISOString()}},{orgId:org,userId:'actor',threadId:`thread-${org}`,filename:scenario.inputName,mime:editFixture?.mime??'text/plain',bytes:inputBytes});
  await asApp(org,c=>c.query('UPDATE chat_message_attachments SET message_id=$3 WHERE org_id=$1 AND id=$2',[org,uploaded.id,`message-${org}`]));
  expect(await extractAttachment({store:objects,extraction:new PgAttachmentExtractionRepository(db),converter:new AnydocAttachmentToMarkdown()},org,uploaded.id)).toBe('extracted');
  const pack=scenario.packId==='office'?null:verifySkillStarterPack(await new FileSkillStarterPackSource(join(workspace,'skills/starter-packs')).load(scenario.packId,packVersion),{packId:scenario.packId,packVersion});
  const content={ 'docx-create':DOCX_CREATE_SKILL_MD,'xlsx-create':XLSX_CREATE_SKILL_MD,'pptx-create':PPTX_CREATE_SKILL_MD,'pdf-create':PDF_CREATE_SKILL_MD };
  const skills=pack?pack.skills.map(s=>({stableName:s.stableName,package:{skillId:s.stableName,versionId:s.semanticVersion,files:s.files}})):
   PLATFORM_SKILL_CATALOG.map(spec=>({stableName:spec.stableName,package:officeSkillPackage({...spec,content:content[spec.stableName as keyof typeof content]}).package}));
  const ctx={orgId:org,parentRunId:parent,attemptId:parent+':0',leaseEpoch:1};const policy:Record<string,boolean>=Object.fromEntries(['execute','wx_artifact_publish','write_todos','read_file','write_file','edit_file','ls','glob','grep'].map(name=>[name,false]));
  if(caseId==='S001'||caseId==='S008')for(const name of ['wx_knowledge_search','wx_knowledge_read','wx_project_list','wx_project_read'])policy[name]=false;
  if(caseId==='S002')for(const name of ['web_search','fetch_url'])policy[name]=false;
  const ref=await owner.provision(ctx,skills,policy);
  production=await(await import('../../src/main')).createApp();
  class TestModule{};Module({controllers:[NativeSessionController,NativeOutputStagingController,RunInterjectionController,StandardContextToolsController,StandardWebToolsController],providers:[{provide:STANDARD_CONTEXT_SERVICE,useValue:production!.get(STANDARD_CONTEXT_SERVICE)},{provide:STANDARD_WEB_SERVICE,useValue:production!.get(STANDARD_WEB_SERVICE)},{provide:IDENTITY_REPOSITORY,useValue:identity},{provide:DECISION_ID_FACTORY,useValue:{next:()=>randomUUID()}},{provide:CHAT_REPOSITORY,useValue:chat},{provide:NATIVE_SESSION_OWNER,useValue:owner},{provide:NATIVE_OUTPUT_STAGING,useValue:staging},{provide:TOOL_EXECUTION_AUTHORITY,useValue:authority},{provide:AGENT_RUN_STORE,useValue:repo},{provide:INTERJECTION_STORE,useValue:new PgInterjectionStore(db)},{provide:TOOL_PERMISSION_GRANT_STORE,useValue:grants}]})(TestModule);
  app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const config={configurable:{native_runtime:ref,org_skills:skills.map(s=>({stable_name:s.stableName,package:s.package})),disable_task_auto_classify:true,run_control_callback:{base_url:base,key:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY,org_id:org,run_id:parent,attempt_id:ctx.attemptId,lease_epoch:1}}};
  const raw=await processRun(join(workspace,'apps/deep-agent-service/.venv/bin/python'),[join(workspace,'apps/deep-agent-service/tests/skill_batch_real_model_runner.py')],JSON.stringify({config,prompt:scenario.prompt}),{...process.env,PYTHONPATH:join(workspace,'apps/deep-agent-service/src'),NATIVE_SESSION_SOCKET:socket,NATIVE_SESSION_SERVICE_BASE_URL:base,NATIVE_SESSION_SERVICE_KEY:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY});
  const evidence=process.env.WX_SKILL_BATCH_EVIDENCE!;await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'model-trace.json'),raw);const report=JSON.parse(raw);
  expect(report.skillActivity.some((fact:{skillStableName:string;stage:string})=>fact.skillStableName===scenario.stableName&&fact.stage==='body_read')).toBe(true);
  expect(report.calls.some((c:{name:string})=>c.name==='wx_artifact_publish')).toBe(true);
  expect(report.negativeCalls).toEqual([]);
  const files=await staging.listFiles(org,parent);expect(files.length).toBeGreaterThan(0);
  const primary=files.find(f=>f.name===scenario.output);expect(primary).toBeDefined();
  if(caseId==='S003_EDIT'||caseId==='S004_EDIT'||caseId==='S005_EDIT'){
   expect(report.calls.some((call:{name:string;args:{command?:string}})=>call.name==='execute'&&call.args.command?.includes('render-office.py'))).toBe(true);
   expect(files.some(file=>file.name.endsWith('.pdf'))).toBe(true);expect(files.some(file=>file.name.endsWith('.png'))).toBe(true);
  }
  const bytes=Buffer.from((await objects.get(primary!.objectKey))!);
  for(const file of files){if(!/^[a-zA-Z0-9_.-]+$/.test(file.name))throw new Error('unsafe evidence filename');await writeFile(join(evidence,file.name),Buffer.from((await objects.get(file.objectKey))!));}
  await writeFile(join(evidence,'source.txt'),transcript);
  if(caseId==='S003_EDIT'||caseId==='S005_EDIT'){
   const changedPart=caseId==='S003_EDIT'?'word/document.xml':'ppt/slides/slide1.xml',before=new Map(unzip(inputBytes).map(e=>[e.name,e.bytes])),after=new Map(unzip(bytes).map(e=>[e.name,e.bytes]));expect([...after.keys()]).toEqual([...before.keys()]);
   for(const[name,original]of before)if(name!==changedPart)expect(createHash('sha256').update(after.get(name)!).digest('hex')).toBe(createHash('sha256').update(original).digest('hex'));
   const changed=after.get(changedPart)!.toString('utf8');expect(changed).toContain('已确认');expect(changed).not.toContain('待确认');
  }
  if(caseId==='S004_EDIT'){const before=new ExcelJS.Workbook(),after=new ExcelJS.Workbook();await before.xlsx.load(inputBytes as unknown as Parameters<typeof before.xlsx.load>[0]);await after.xlsx.load(bytes as unknown as Parameters<typeof after.xlsx.load>[0]);expect(after.getWorksheet('Data')!.getCell('A1').value).toBe(7);expect(after.getWorksheet('Other')!.getCell('A1').value).toBe('工作表保持');expect(after.getWorksheet('Other')!.getCell('C1').value).toEqual(before.getWorksheet('Other')!.getCell('C1').value);expect(after.getWorksheet('Data')!.getCell('B2').font).toEqual(before.getWorksheet('Data')!.getCell('B2').font);const xml=new Map(unzip(bytes).map(e=>[e.name,e.bytes])).get('xl/workbook.xml')!.toString('utf8');expect(xml).toMatch(/fullCalcOnLoad="1"/);}
  if(scenario.output.endsWith('.md')){
   const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
   if(caseId==='S007'){expect(files.some(f=>f.name.endsWith('.py'))).toBe(true);expect(files.some(f=>f.name.endsWith('.csv'))).toBe(true);expect(report.calls.some((c:{name:string;args:{command?:string}})=>c.name==='execute'&&/python/.test(c.args.command??''))).toBe(true);expect(text).toMatch(/52/);expect(text).toMatch(/40/);expect(text).toMatch(/12/);expect(text).toMatch(/缺失|空值|missing/i);expect(text).toMatch(/重复|duplicate/i);}
   if(caseId==='S002'){expect(report.calls.some((c:{name:string})=>c.name==='web_search')).toBe(true);expect(report.calls.some((c:{name:string})=>c.name==='fetch_url')).toBe(true);expect(text).toMatch(/https:\/\//);const fetched=report.results.filter((r:{name:string;status:string})=>r.name==='fetch_url'&&r.status==='success').map((r:{content:string})=>JSON.parse(r.content) as {sourceId:string;contentHash:string;url:string});expect(fetched.length).toBeGreaterThan(0);expect(fetched.some((f:{sourceId:string;contentHash:string})=>text.includes(f.sourceId)&&text.includes(f.contentHash))).toBe(true);}
   if(caseId==='S001'){expect(text).toMatch(/14/);expect(text).toMatch(/未知|未确定|undecided|unknown/i);expect(report.calls.some((c:{name:string})=>c.name==='wx_knowledge_read')).toBe(true);}
   if(caseId==='S008'){expect(text).toMatch(/3/);expect(text).toMatch(/议程|agenda/i);expect(text).toMatch(/未知|未确定|unknown/i);expect(report.calls.some((c:{name:string})=>c.name==='wx_knowledge_read')).toBe(true);}
  }
  await repo.storeOutputAwaitingWriteback(org,parent,{text:report.final,finalStepSeq:1,files});const pending=(await repo.claimWritebackPending(org,1))[0]!;await repo.commitWriteback(org,{runId:parent,threadId:pending.threadId,inputMessageId:pending.inputMessageId,agentId:pending.agentId,text:pending.text,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),outputDigest:'a'.repeat(64),files});
  const versions=await db.withTenant(org,s=>s.query<{storage_key:string}>('SELECT storage_key FROM agent_artifact_versions WHERE org_id=$1 AND produced_by_run_id=$2',[org,parent]));expect(versions.rows).toHaveLength(files.length);
  const published=versions.rows.find(row=>row.storage_key===primary!.objectKey);expect(published).toBeDefined();const downloaded=await objects.get(published!.storage_key);expect(downloaded).not.toBeNull();const outputSha256=createHash('sha256').update(bytes).digest('hex'),artifactDownloadSha256=createHash('sha256').update(downloaded!).digest('hex');expect(artifactDownloadSha256).toBe(outputSha256);
  await writeFile(join(evidence,'result.json'),JSON.stringify({model:report.model,caseId,packages:skills.map(s=>({name:s.stableName,version:s.package.versionId})),outputSha256,artifactDownloadSha256,artifacts:files.length,actualWriteback:true}));
 }finally{
  const evidence=process.env.WX_SKILL_BATCH_EVIDENCE!;await mkdir(evidence,{recursive:true});
  for(const file of await staging.listFiles(org,parent)){if(/^[a-zA-Z0-9_.-]+$/.test(file.name)){const data=await objects.get(file.objectKey);if(data)await writeFile(join(evidence,file.name),Buffer.from(data));}}
  try{await owner.releaseForRun(org,parent);}finally{await app?.close();await production?.close();for(const[k,v]of Object.entries(previousEnv)){if(v===undefined)delete process.env[k];else process.env[k]=v;}await new Promise<void>(r=>relay.close(()=>r()));if(oldKey===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=oldKey;}}
},300000);
