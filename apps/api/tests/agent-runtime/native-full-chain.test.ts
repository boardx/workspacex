import {decodeWav} from '../../src/infrastructure/agent-run/audio-wav-decoder';
import {WebSocketServer} from 'ws';
import {STANDARD_AUDIO_SERVICE} from '../../src/application/agent-run/standard-audio-tools';
import {DefaultStandardAudioService} from '../../src/infrastructure/agent-run/standard-audio-service';
import {StandardAudioController} from '../../src/interface/controllers/standard-audio.controller';
import {ConfiguredRealtimeAsrProvider} from '../../src/infrastructure/recording/configured-realtime-asr-provider';
import {STANDARD_IMAGE_SERVICE} from '../../src/application/agent-run/standard-image-tools';
import {DefaultStandardImageService} from '../../src/infrastructure/agent-run/standard-image-service';
import {StandardImageController} from '../../src/interface/controllers/standard-image.controller';
import {createGeneratedImageDownloader} from '../../src/infrastructure/agent-run/generated-image-downloader';
import {BailianImageProvider} from '../../src/infrastructure/agent-run/bailian-image-provider';
import {DefaultSkillDraftService,SKILL_DRAFT_SERVICE} from '../../src/application/agent-run/skill-draft';
import {createNativeDraftSession} from '../../src/infrastructure/agent-run/native-draft-session';
import {SkillDraftController} from '../../src/interface/controllers/skill-draft.controller';
import {SkillArtifactImportController} from '../../src/interface/controllers/skill-artifact-import.controller';
import {SKILL_ARTIFACT_IMPORT_DEPS} from '../../src/application/skill-import/import-skill-artifact';
import {PgArtifactStore} from '../../src/infrastructure/artifacts-steering/pg-artifact-store';
import {PgSkillStarterImportRepository} from '../../src/infrastructure/skill/pg-skill-starter-import-repository';
import 'reflect-metadata';
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
import https from 'node:https';
import dns from 'node:dns';
import {testTlsMaterial} from '../support/tls';
import {StandardWebToolsController} from '../../src/interface/controllers/standard-web-tools.controller';
import {STANDARD_WEB_SERVICE} from '../../src/application/agent-run/standard-web-tools';
import {DefaultStandardWebService} from '../../src/infrastructure/agent-run/standard-web-service';
import {createStandardWebFetch} from '../../src/infrastructure/agent-run/standard-web-fetch';
import {GoogleGuidedSearch} from '../../src/infrastructure/research/google-guided-search';
import {IDENTITY_REPOSITORY} from '../../src/application/identity/ports';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import { PgNativeRunInputs } from '../../src/infrastructure/agent-run/pg-native-run-inputs';
import { uploadAttachment } from '../../src/application/chat/upload-attachment';
import { PgChatAttachmentRepository } from '../../src/infrastructure/chat/pg-chat-attachment-repository';
import { PgChatRepository } from '../../src/infrastructure/chat/pg-chat-repository';
import { createRequire } from 'node:module';
import { STANDARD_DOCUMENT_SERVICE } from '../../src/application/agent-run/standard-document-tools';
import { DefaultStandardDocumentService } from '../../src/infrastructure/agent-run/standard-document-service';
import { createNativeDocumentSession } from '../../src/infrastructure/agent-run/native-document-session';
import { StandardDocumentToolsController } from '../../src/interface/controllers/standard-document-tools.controller';
const org=toOrgId('native-chain-'+randomUUID()),parent='run-'+randomUUID();
const workspace=join(process.cwd(),'../..');let db:PgDatabase;let root:string;
function processRun(cmd:string,args:string[],input='',env=process.env):Promise<string>{return new Promise((resolve,reject)=>{
 const child=spawn(cmd,args,{env});const timer=setTimeout(()=>child.kill('SIGKILL'),90000);child.on('close',()=>clearTimeout(timer));let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);
 child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(new Error(`${cmd} exited ${code}: ${err}`)));child.stdin.end(input);
});}
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
      VALUES($1,$2,$3,'v1',$4,'pinned instructions','{}','test-provider','pinned-model','[]','actor',now(),now())`,
    [version,scope,agent,createHash("sha256").update("pinned instructions").digest("hex")]);
    await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,
      skill_version_ids,model_provider,model_id,status) VALUES($1,$2,$3,$4,$5,$6,'[]','test-provider','pinned-model','queued')`,
    [id,scope,thread,`message-${scope}`,agent,version]);
  });
}

beforeAll(async()=>{await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());root=await mkdtemp(join(tmpdir(),'wx-chain-'));await seed(org,parent);
 await asApp(org,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE id=$1",[parent]));
 await asApp(org,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,parent]));
});
afterAll(async()=>{await db?.close();await resetOrgs(org);await rm(root,{recursive:true,force:true});});
it('official Python factory crosses real UDS isolated sandbox and PG authority into durable artifact writeback',async()=>{
 const container=process.env.WX_NATIVE_SANDBOX_CONTAINER;if(!container)throw new Error('real sandbox container required');
 const fixture=await readFile(join(workspace,'apps/deep-agent-service/tests/native_sandbox_fixture.py'),'utf8');
 const relayCode=fixture.split('_UDS_RELAY = r"""')[1]?.split('"""')[0];if(!relayCode)throw new Error('relay source missing');
 const socket=join(root,'sandbox.sock');
 const relay=createServer(async(req,res)=>{try{let body='';for await(const chunk of req)body+=chunk;
 const output=JSON.parse(await processRun('docker',['exec','-i',container,'node','-e',relayCode],JSON.stringify({method:req.method,path:req.url,headers:req.headers,body})));
 res.writeHead(output.status,{'content-type':'application/json'});res.end(output.body);
 }catch{res.writeHead(503);res.end('{}');}});
 await new Promise<void>(resolve=>relay.listen(socket,resolve));
 const objects=new FsObjectStore(root);
 const owner=new PgNativeSessionOwner(db,new PgParentRunControlReader(db),createNativeSessionTransport(socket),'c'.repeat(64),new PgNativeRunInputs(db,objects,{repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},chat:new PgChatRepository(db)}));
 const repo=new PgAgentRunRepository(db),grants=new PgToolPermissionGrantRepository(db);
 const authority=new ToolExecutionAuthority(new PgParentRunControlReader(db),repo,grants);
 const staging=new PgNativeOutputStaging(db,owner,objects,authority,bound=>createNativeSessionFiles({socketPath:socket,...bound}));
 const script="from pathlib import Path\nimport csv,zipfile,hashlib,subprocess\nfiles=list(Path('/inputs').glob('*/*'))\nassert len(files)==4\nbefore={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}\nfor p in files:\n try: p.write_bytes(b'bad'); raise AssertionError('writable original')\n except OSError: pass\n try: p.unlink(); raise AssertionError('deletable original')\n except OSError: pass\n Path('/workspace',p.name).write_bytes(p.read_bytes())\nwith zipfile.ZipFile(next(p for p in files if p.suffix=='.docx')) as z: assert '原始文档保持不变' in z.read('word/document.xml').decode()\nwith open(next(p for p in files if p.suffix=='.csv')) as f: assert sum(int(r['value']) for r in csv.DictReader(f))==50\nassert before=={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}\nprint('UPLOADED_INPUTS_VERIFIED')\nPath('/workspace/report.txt').write_text('真实跨语言产物 UTF8',encoding='utf-8')\nPath('/workspace/draft-SKILL.md').write_text('---\\nname: generated-example\\ndescription: Print verified output.\\n---\\nRun scripts/report.py.\\n')\nPath('/workspace/draft-script.py').write_text('print(42)\\n')\nassert subprocess.run(['python3','/workspace/draft-script.py'],check=True,capture_output=True,text=True,timeout=5).stdout.strip()=='42'\nprint('DRAFT_FIXTURE_VERIFIED')\n";
 const contents=[{path:'SKILL.md',text:'---\nname: example\ndescription: Generate a UTF8 report.\n---\nRun /skills/example/scripts/report.py then publish /workspace/report.txt.\n',mediaType:'text/markdown'},{path:'scripts/report.py',text:script,mediaType:'text/x-python'}];
 const pack={skillId:'s1',versionId:'v1',files:contents.map(f=>({path:f.path,mediaType:f.mediaType,contentBase64:Buffer.from(f.text).toString('base64'),digest:createHash('sha256').update(f.text).digest('hex')}))};
 const ctx={orgId:org,parentRunId:parent,attemptId:parent+':0',leaseEpoch:1};
 let asrServer:WebSocketServer|undefined;let audioSubmits=0;let audioHadIntent=false;const audioFrames:Buffer[]=[];
 let imageServer:ReturnType<typeof createServer>|undefined;let imageSubmits=0;let submitHadIntent=false;let webServer:https.Server|undefined;let provisioned=false;let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 const oldKey=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY='native-chain-service-key';
 try{
  expect(await authority.check({...ctx,toolName:'execute'})).toEqual({allowed:false,reason:'approval_required'});
  for(const tool of ['read_file','execute','wx_artifact_publish','web_search','fetch_url','wx_skill_create_draft','wx_image_generate','wx_audio_transcribe'])await grants.grantForRun(org,parent,tool);
  const {Document,Packer,Paragraph}=createRequire(join(workspace,'apps/skill-sandbox/package.json'))('docx');
  const originals=[{filename:'original.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('原始文档保持不变')]}]}))},{filename:'original.csv',mime:'text/csv',bytes:Buffer.from('group,value\n甲,10\n乙,40\n')}];
  originals.push({filename:'scan.png',mime:'image/png',bytes:await readFile(join(workspace,'apps/api/tests/fixtures/document-ocr/scan.png'))});
  originals.push({filename:'original.wav',mime:'audio/wav',bytes:await readFile(join(workspace,'apps/api/tests/fixtures/audio/source.wav'))});
  const uploadDeps={repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},chat:new PgChatRepository(db),attachments:new PgChatAttachmentRepository(db),store:objects,attachmentIds:{next:()=>randomUUID()},clock:{now:()=>new Date().toISOString()}};
  for(const source of originals){const uploaded=await uploadAttachment(uploadDeps,{orgId:org,userId:'actor',threadId:`thread-${org}`,...source});
   await asApp(org,c=>c.query('UPDATE chat_message_attachments SET message_id=$3 WHERE org_id=$1 AND id=$2',[org,uploaded.id,`message-${org}`]));}
  const ref=await owner.provision(ctx,[{stableName:'example',package:pack}],{execute:false,wx_artifact_publish:false,web_search:false,fetch_url:false,wx_document_parse:false,wx_skill_create_draft:false,wx_image_generate:false,wx_audio_transcribe:false});provisioned=true;
  const originalInputs=(await owner.resolve(ref.bindingId,ctx)).inputs;expect(originalInputs).toHaveLength(4);
  const imageFixture=await readFile(join(workspace,'apps/api/tests/fixtures/generated-image/square.png'));
  let webUrl='';let webRequests=0;
  webServer=https.createServer(testTlsMaterial(),(req,res)=>{webRequests++;
   if(req.url==='/image.png'){res.writeHead(200,{'content-type':'image/png'});res.end(imageFixture);}
   else if(req.url?.startsWith('/search')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({results:[{title:'真实来源',url:webUrl+'/article',snippet:'Search excerpt only.'}]}));}
   else{res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<html><head><title>真实来源</title></head><body><article><h1>真实来源</h1><p>'+('This real article substantiates the search result with actual extracted body text. '.repeat(15))+'</p></article></body></html>');}});
  await new Promise<void>(resolve=>webServer!.listen(0,'127.0.0.1',resolve));webUrl=`https://allowed.example:${(webServer.address() as {port:number}).port}`;
  const lookup=((host:string,opts:{all?:boolean},cb:Function)=>opts.all?cb(null,[{address:'127.0.0.1',family:4}]):cb(null,'127.0.0.1',4)) as unknown as typeof dns.lookup;
  const webFetch=createStandardWebFetch({connectTimeoutMs:10000,extraTrustedCa:testTlsMaterial().cert,seams:{lookup,checkAddress:()=>{}}});
  const webService=new DefaultStandardWebService(new GoogleGuidedSearch(webFetch,webUrl+'/search'),webFetch);
  const documentService=new DefaultStandardDocumentService(owner,new PgNativeRunInputs(db,objects,{repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},chat:new PgChatRepository(db)}),bound=>createNativeDocumentSession({socketPath:socket,...bound}),authority);
  imageServer=createServer(async(req,res)=>{res.setHeader('content-type','application/json');
   if(req.method==='POST'){imageSubmits++;const h=(x:string)=>createHash('sha256').update(x).digest('hex');submitHadIntent=(await objects.get(`image-generation/${h(org)}/${h(parent)}/${h('image-v1')}/intent.json`))!==null;res.end(JSON.stringify({output:{task_id:'generated-task'}}));}
   else res.end(JSON.stringify({output:{task_status:'SUCCEEDED',results:[{url:webUrl+'/image.png'}]}}));});
  await new Promise<void>(resolve=>imageServer!.listen(0,'127.0.0.1',resolve));
  const audioId=originalInputs.find(i=>i.path.endsWith('.wav'))!.attachmentId;
  asrServer=new WebSocketServer({server:imageServer});
  asrServer.on('connection',ws=>ws.on('message',async raw=>{
   const frame=JSON.parse(String(raw));
   if(frame.type==='session.update')expect(frame.session.turn_detection).toBeNull();
   if(frame.type==='input_audio_buffer.append')audioFrames.push(Buffer.from(frame.audio,'base64'));
   if(frame.type==='session.finish'){
    audioSubmits++;const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
    audioHadIntent=Boolean(await objects.get(`audio-transcription/${digest(org)}/${digest(parent)}/${digest(JSON.stringify({attachmentId:audioId}))}/intent.json`));
    ws.send(JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'1',event_id:'1',transcript:'会议决定保留原件。'}));
    ws.send(JSON.stringify({type:'conversation.item.input_audio_transcription.completed',item_id:'2',event_id:'2',transcript:'Review the transcript before publication.'}));
    ws.send(JSON.stringify({type:'session.finished'}));
   }
  }));
  const audioProvider=new ConfiguredRealtimeAsrProvider({provider:'realtime',baseUrl:`ws://127.0.0.1:${(imageServer.address() as {port:number}).port}`,apiKey:'test',model:'fixture-asr'});
  const audioService=new DefaultStandardAudioService(owner,new PgNativeRunInputs(db,objects,{repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},chat:new PgChatRepository(db)}),bound=>({...createNativeDraftSession({socketPath:socket,...bound}),execute:createNativeDocumentSession({socketPath:socket,...bound}).execute}),authority,new PgIdentityRepository(db),objects,audioProvider);
  const imageProvider=new BailianImageProvider({apiKey:'test-key',modelId:'fixture-model',timeoutMs:5000,pollIntervalMs:1,baseUrl:`http://127.0.0.1:${(imageServer.address() as {port:number}).port}`});
  const imageService=new DefaultStandardImageService(owner,new PgNativeRunInputs(db,objects,{repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},chat:new PgChatRepository(db)}),bound=>({...createNativeDraftSession({socketPath:socket,...bound}),execute:createNativeDocumentSession({socketPath:socket,...bound}).execute}),authority,new PgIdentityRepository(db),objects,{modelRef:'fixture-model',generateImage:imageProvider.generateImage.bind(imageProvider)},createGeneratedImageDownloader({connectTimeoutMs:5000,extraTrustedCa:testTlsMaterial().cert,seams:{lookup,checkAddress:()=>{}}}));
  const draftService=new DefaultSkillDraftService(owner,bound=>createNativeDraftSession({socketPath:socket,...bound}),authority,objects);
  const importDeps={artifacts:new PgArtifactStore(db),repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},chat:new PgChatRepository(db),objects,identities:new PgIdentityRepository(db),imports:new PgSkillStarterImportRepository(db)};
  class TestModule{};Module({controllers:[StandardAudioController,StandardImageController,SkillDraftController,SkillArtifactImportController,StandardDocumentToolsController,NativeSessionController,NativeOutputStagingController,RunInterjectionController,StandardWebToolsController],providers:[
   {provide:STANDARD_AUDIO_SERVICE,useValue:audioService},{provide:STANDARD_IMAGE_SERVICE,useValue:imageService},{provide:SKILL_DRAFT_SERVICE,useValue:draftService},{provide:SKILL_ARTIFACT_IMPORT_DEPS,useValue:importDeps},{provide:STANDARD_DOCUMENT_SERVICE,useValue:documentService},
   {provide:STANDARD_WEB_SERVICE,useValue:webService},{provide:IDENTITY_REPOSITORY,useValue:new PgIdentityRepository(db)},
   {provide:NATIVE_SESSION_OWNER,useValue:owner},{provide:NATIVE_OUTPUT_STAGING,useValue:staging},{provide:TOOL_EXECUTION_AUTHORITY,useValue:authority},
   {provide:AGENT_RUN_STORE,useValue:repo},{provide:INTERJECTION_STORE,useValue:new PgInterjectionStore(db)},{provide:TOOL_PERMISSION_GRANT_STORE,useValue:grants}]})(TestModule);
  app=await NestFactory.create(TestModule,{logger:false});app.use((req:{headers:Record<string,string>;principal?:{orgId:typeof org;userId:string}},_res:unknown,next:()=>void)=>{if(req.headers['x-fixture-user'])req.principal={orgId:org,userId:req.headers['x-fixture-user']};next();});await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const denied=await fetch(`${base}/internal/agent-runs/${parent}/tool-execution/check`,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY},body:JSON.stringify({orgId:org,attemptId:ctx.attemptId,leaseEpoch:2,toolName:'execute'})});expect(denied.status).toBe(200);expect((await denied.json() as {allowed:boolean}).allowed).toBe(false);
  const deniedWeb=await fetch(`${base}/internal/agent-runs/${parent}/standard-web/invoke`,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY},body:JSON.stringify({orgId:org,attemptId:ctx.attemptId,leaseEpoch:2,toolCallId:'stale-web',toolName:'fetch_url',toolArgs:{url:webUrl+'/article'}})});expect(deniedWeb.status).toBe(403);expect(webRequests).toBe(0);
  const documentBody={orgId:org,attemptId:ctx.attemptId,leaseEpoch:1,bindingId:ref.bindingId,toolCallId:'parse-original',toolName:'wx_document_parse',toolArgs:{workspacePath:originalInputs.find(i=>i.path.endsWith('.docx'))!.path,outputMode:'markdown',ocr:false}};
  const callDocument=(body:unknown)=>fetch(`${base}/internal/agent-runs/${parent}/document/parse`,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY!},body:JSON.stringify(body)});
  expect((await callDocument(documentBody)).status).toBe(503); // Actual PG tool grant is absent.
  expect((await callDocument({...documentBody,toolArgs:{...documentBody.toolArgs,outputMode:'chunks'}})).status).toBe(400);
  await grants.grantForRun(org,parent,'wx_document_parse');
  expect((await callDocument({...documentBody,leaseEpoch:2})).status).toBe(503);
  const ocrResponse=await callDocument({...documentBody,toolCallId:'ocr-original',toolArgs:{workspacePath:originalInputs.find(i=>i.path.endsWith('.png'))!.path,ocr:true}});expect(ocrResponse.status).toBe(200);
  const ocrResult=await ocrResponse.json() as {structurePath:string;structureHash:string};
  const ocrFile=await createNativeSessionFiles({socketPath:socket,...await owner.resolve(ref.bindingId,ctx)}).read(ocrResult.structurePath) as {contentBase64:string};
  const ocrBytes=Buffer.from(ocrFile.contentBase64,'base64');expect(createHash('sha256').update(ocrBytes).digest('hex')).toBe(ocrResult.structureHash);
  const ocrStructure=JSON.parse(ocrBytes.toString('utf8'));expect(ocrStructure.pages[0].pageNumber).toBe(1);expect(ocrStructure.pages[0].words.some((w:{text:string})=>w.text==='120')).toBe(true);
  expect((await callDocument({...documentBody,toolArgs:{...documentBody.toolArgs,workspacePath:'/inputs/forged.docx'}})).status).toBe(503);
  const config={configurable:{native_runtime:ref,org_skills:[{stable_name:'example',package:pack}],disable_task_auto_classify:true,run_control_callback:{base_url:base,key:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY,org_id:org,run_id:parent,attempt_id:ctx.attemptId,lease_epoch:1}}};
  const output=await processRun(join(workspace,'apps/deep-agent-service/.venv/bin/python'),[join(workspace,'apps/deep-agent-service/tests/native_full_chain_runner.py')],JSON.stringify(config),{...process.env,PYTHONPATH:join(workspace,'apps/deep-agent-service/src'),WX_AUDIO_ATTACHMENT_ID:audioId,WX_WEB_TEST_URL:webUrl+'/article',WX_INPUT_PATHS:JSON.stringify(originalInputs.map(i=>i.path)),NATIVE_SESSION_SOCKET:socket,NATIVE_SESSION_SERVICE_BASE_URL:base,NATIVE_SESSION_SERVICE_KEY:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY});
  const report=JSON.parse(output);expect(report.skillStages).toEqual(['metadata_discovered','body_read']);expect(report.tools).toEqual(['read_file','wx_document_parse','read_file','execute','wx_skill_create_draft','wx_artifact_publish','wx_artifact_publish','wx_image_generate','wx_artifact_publish','wx_audio_transcribe','wx_artifact_publish','web_search','fetch_url']);expect(report.webSourceLinked).toBe(true);expect(report.draftFixtureVerified).toBe(true);expect(report.inputsVerified).toBe(true);expect(report.inputPromptVerified).toBe(true);expect(webRequests).toBe(3);expect(imageSubmits).toBe(1);expect(submitHadIntent).toBe(true);expect(audioSubmits).toBe(1);expect(audioHadIntent).toBe(true);expect(Buffer.concat(audioFrames)).toEqual((await readFile(join(workspace,'apps/api/tests/fixtures/audio/source.wav'))).subarray(44));expect(report.audio.segments).toEqual([{id:'chunk-0',startMs:0,endMs:1000,text:'会议决定保留原件。\nReview the transcript before publication.'}]);
  const audioBody={orgId:org,attemptId:ctx.attemptId,leaseEpoch:1,bindingId:ref.bindingId,toolCallId:'audio-replay',toolName:'wx_audio_transcribe',toolArgs:{attachmentId:audioId}};
  const callAudio=(body:unknown)=>fetch(`${base}/internal/agent-runs/${parent}/audio-transcribe`,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY!},body:JSON.stringify(body)});
  const replay=await callAudio(audioBody);expect(replay.status).toBe(200);expect(await replay.json()).toEqual(report.audio);
  expect((await callAudio({...audioBody,orgId:'foreign-org'})).status).toBe(503);
  await asApp(org,c=>c.query('DELETE FROM org_memberships WHERE org_id=$1 AND user_id=$2',[org,'actor']));
  expect((await callAudio(audioBody)).status).toBe(503);await addOrgMember(org,'actor','consultant',null);
  await asApp(org,c=>c.query('UPDATE chat_threads SET created_by=$3 WHERE org_id=$1 AND id=$2',[org,`thread-${org}`,'intruder']));
  expect((await callAudio(audioBody)).status).toBe(503);
  await asApp(org,c=>c.query('UPDATE chat_threads SET created_by=$3 WHERE org_id=$1 AND id=$2',[org,`thread-${org}`,'actor']));expect(audioSubmits).toBe(1);
  const finalBinding=await owner.resolve(ref.bindingId,ctx);expect(finalBinding.inputs).toEqual(originalInputs);
  expect(report.documentParsed).toBe(true);const markdown=await createNativeSessionFiles({socketPath:socket,...finalBinding}).read(report.document.textPath) as {contentBase64:string};
  const parsedBytes=Buffer.from(markdown.contentBase64,'base64');expect(parsedBytes.toString('utf8')).toContain('原始文档保持不变');expect(createHash('sha256').update(parsedBytes).digest('hex')).toBe(report.document.textHash);
  expect(report.document.sourceHash).toBe(originalInputs.find(i=>i.path.endsWith('.docx'))!.digest);
  const audioSession={...createNativeDraftSession({socketPath:socket,...finalBinding}),execute:createNativeDocumentSession({socketPath:socket,...finalBinding}).execute};
  await expect(decodeWav(audioSession,'/workspace/report.txt',createHash('sha256').update('真实跨语言产物 UTF8').digest('hex'))).rejects.toThrow('audio_decode_failed');
  await expect(decodeWav(audioSession,originalInputs.find(i=>i.path.endsWith('.wav'))!.path,'0'.repeat(64))).rejects.toThrow('audio_decode_failed');
  const files=await staging.listFiles(org,parent);expect(files).toHaveLength(4);expect(Buffer.from((await objects.get(files.find(f=>f.name==='generated.png')!.objectKey))!)).toEqual(imageFixture);expect(Buffer.from((await objects.get(files.find(f=>f.name==='report.txt')!.objectKey))!)).toEqual(Buffer.from('真实跨语言产物 UTF8'));
  const transcriptBytes=Buffer.from((await objects.get(files.find(f=>f.name==='transcript.json')!.objectKey))!);expect(createHash('sha256').update(transcriptBytes).digest('hex')).toBe(report.audio.sha256);expect(JSON.parse(transcriptBytes.toString('utf8')).segments).toEqual(report.audio.segments);
  await repo.storeOutputAwaitingWriteback(org,parent,{text:report.final,finalStepSeq:1,files});const pending=(await repo.claimWritebackPending(org,1))[0]!;
  const write={runId:parent,threadId:pending.threadId,inputMessageId:pending.inputMessageId,agentId:pending.agentId,text:pending.text,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),outputDigest:'a'.repeat(64),files};
  await repo.commitWriteback(org,write);await repo.commitWriteback(org,write);
  const versions=await db.withTenant(org,s=>s.query('SELECT storage_key FROM agent_artifact_versions WHERE org_id=$1 AND produced_by_run_id=$2',[org,parent]));expect(versions.rows).toHaveLength(4);
  const attachments=await db.withTenant(org,s=>s.query('SELECT a.id FROM chat_message_attachments a JOIN chat_messages m ON m.id=a.message_id AND m.org_id=a.org_id WHERE m.org_id=$1 AND m.agent_run_id=$2',[org,parent]));expect(attachments.rows).toHaveLength(4);
  const draftVersion=await db.withTenant(org,s=>s.query('SELECT artifact_id,version FROM agent_artifact_versions WHERE org_id=$1 AND storage_key=$2',[org,files.find(f=>f.name==='draft.json')!.objectKey]));
  const importBody={artifactId:draftVersion.rows[0]!.artifact_id,version:Number(draftVersion.rows[0]!.version),expectedDigest:report.draft.fileDigest,idempotencyKey:'draft-import'};
  const importRequest=(user:string,body=importBody)=>fetch(`${base}/admin/skills/artifact-imports`,{method:'POST',headers:{'content-type':'application/json','x-fixture-user':user},body:JSON.stringify(body)});
  expect((await importRequest('actor')).status).toBe(403);
  await asApp(org,c=>c.query("UPDATE org_memberships SET org_role='admin' WHERE org_id=$1 AND user_id IN ('actor','intruder')",[org]));
  expect((await importRequest('intruder')).status).toBe(404);
  expect((await importRequest('actor',{...importBody,expectedDigest:'a'.repeat(64)})).status).toBe(422);
  const imported=await importRequest('actor');expect(imported.status).toBe(201);const importedBody=await imported.json() as {versionIds:string[]};expect((await importRequest('actor')).status).toBe(200);
  const stored=await db.withTenant(org,s=>s.query('SELECT path,content,digest FROM skill_version_files WHERE org_id=$1 AND version_id=$2',[org,importedBody.versionIds[0]]));expect(stored.rows).toHaveLength(2);
  for(const file of stored.rows)expect(createHash('sha256').update(String(file.content)).digest('hex')).toBe(file.digest);
  console.log(JSON.stringify({chain:'native_factory→UDS→isolated sandbox→PG authority→FsObjectStore→writeback',...report,artifacts:versions.rows.length,attachments:attachments.rows.length}));
 }finally{try{if(provisioned)await owner.releaseForRun(org,parent);}finally{try{await app?.close();}finally{if(asrServer){for(const client of asrServer.clients)client.terminate();await new Promise<void>(resolve=>asrServer!.close(()=>resolve()));}if(imageServer){imageServer.closeAllConnections();await new Promise<void>(resolve=>imageServer!.close(()=>resolve()));}if(webServer){webServer.closeAllConnections();await new Promise<void>(resolve=>webServer!.close(()=>resolve()));}await new Promise<void>((resolve,reject)=>relay.close(e=>e?reject(e):resolve()));if(oldKey===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=oldKey;}}}
},120000);
