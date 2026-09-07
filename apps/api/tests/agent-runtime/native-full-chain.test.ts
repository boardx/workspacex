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
 const script="from pathlib import Path\nimport csv,zipfile,hashlib\nfiles=list(Path('/inputs').glob('*/*'))\nassert len(files)==2\nbefore={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}\nfor p in files:\n try: p.write_bytes(b'bad'); raise AssertionError('writable original')\n except OSError: pass\n try: p.unlink(); raise AssertionError('deletable original')\n except OSError: pass\n Path('/workspace',p.name).write_bytes(p.read_bytes())\nwith zipfile.ZipFile(next(p for p in files if p.suffix=='.docx')) as z: assert '原始文档保持不变' in z.read('word/document.xml').decode()\nwith open(next(p for p in files if p.suffix=='.csv')) as f: assert sum(int(r['value']) for r in csv.DictReader(f))==50\nassert before=={str(p):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}\nprint('UPLOADED_INPUTS_VERIFIED')\nPath('/workspace/report.txt').write_text('真实跨语言产物 UTF8',encoding='utf-8')\n";
 const contents=[{path:'SKILL.md',text:'---\nname: example\ndescription: Generate a UTF8 report.\n---\nRun /skills/example/scripts/report.py then publish /workspace/report.txt.\n',mediaType:'text/markdown'},{path:'scripts/report.py',text:script,mediaType:'text/x-python'}];
 const pack={skillId:'s1',versionId:'v1',files:contents.map(f=>({path:f.path,mediaType:f.mediaType,contentBase64:Buffer.from(f.text).toString('base64'),digest:createHash('sha256').update(f.text).digest('hex')}))};
 const ctx={orgId:org,parentRunId:parent,attemptId:parent+':0',leaseEpoch:1};
 let webServer:https.Server|undefined;let provisioned=false;let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 const oldKey=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY='native-chain-service-key';
 try{
  expect(await authority.check({...ctx,toolName:'execute'})).toEqual({allowed:false,reason:'approval_required'});
  for(const tool of ['read_file','execute','wx_artifact_publish','web_search','fetch_url'])await grants.grantForRun(org,parent,tool);
  const {Document,Packer,Paragraph}=createRequire(join(workspace,'apps/skill-sandbox/package.json'))('docx');
  const originals=[{filename:'original.docx',mime:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',bytes:await Packer.toBuffer(new Document({sections:[{children:[new Paragraph('原始文档保持不变')]}]}))},{filename:'original.csv',mime:'text/csv',bytes:Buffer.from('group,value\n甲,10\n乙,40\n')}];
  const uploadDeps={repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},chat:new PgChatRepository(db),attachments:new PgChatAttachmentRepository(db),store:objects,attachmentIds:{next:()=>randomUUID()},clock:{now:()=>new Date().toISOString()}};
  for(const source of originals){const uploaded=await uploadAttachment(uploadDeps,{orgId:org,userId:'actor',threadId:`thread-${org}`,...source});
   await asApp(org,c=>c.query('UPDATE chat_message_attachments SET message_id=$3 WHERE org_id=$1 AND id=$2',[org,uploaded.id,`message-${org}`]));}
  const ref=await owner.provision(ctx,[{stableName:'example',package:pack}],{execute:false,wx_artifact_publish:false,web_search:false,fetch_url:false});provisioned=true;
  const originalInputs=(await owner.resolve(ref.bindingId,ctx)).inputs;expect(originalInputs).toHaveLength(2);
  let webUrl='';let webRequests=0;
  webServer=https.createServer(testTlsMaterial(),(req,res)=>{webRequests++;
   if(req.url?.startsWith('/search')){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({results:[{title:'真实来源',url:webUrl+'/article',snippet:'Search excerpt only.'}]}));}
   else{res.writeHead(200,{'content-type':'text/html;charset=utf-8'});res.end('<html><head><title>真实来源</title></head><body><article><h1>真实来源</h1><p>'+('This real article substantiates the search result with actual extracted body text. '.repeat(15))+'</p></article></body></html>');}});
  await new Promise<void>(resolve=>webServer!.listen(0,'127.0.0.1',resolve));webUrl=`https://allowed.example:${(webServer.address() as {port:number}).port}`;
  const lookup=((host:string,opts:{all?:boolean},cb:Function)=>opts.all?cb(null,[{address:'127.0.0.1',family:4}]):cb(null,'127.0.0.1',4)) as unknown as typeof dns.lookup;
  const webFetch=createStandardWebFetch({connectTimeoutMs:10000,extraTrustedCa:testTlsMaterial().cert,seams:{lookup,checkAddress:()=>{}}});
  const webService=new DefaultStandardWebService(new GoogleGuidedSearch(webFetch,webUrl+'/search'),webFetch);
  class TestModule{};Module({controllers:[NativeSessionController,NativeOutputStagingController,RunInterjectionController,StandardWebToolsController],providers:[
   {provide:STANDARD_WEB_SERVICE,useValue:webService},{provide:IDENTITY_REPOSITORY,useValue:new PgIdentityRepository(db)},
   {provide:NATIVE_SESSION_OWNER,useValue:owner},{provide:NATIVE_OUTPUT_STAGING,useValue:staging},{provide:TOOL_EXECUTION_AUTHORITY,useValue:authority},
   {provide:AGENT_RUN_STORE,useValue:repo},{provide:INTERJECTION_STORE,useValue:new PgInterjectionStore(db)},{provide:TOOL_PERMISSION_GRANT_STORE,useValue:grants}]})(TestModule);
  app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const denied=await fetch(`${base}/internal/agent-runs/${parent}/tool-execution/check`,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY},body:JSON.stringify({orgId:org,attemptId:ctx.attemptId,leaseEpoch:2,toolName:'execute'})});expect(denied.status).toBe(200);expect((await denied.json() as {allowed:boolean}).allowed).toBe(false);
  const deniedWeb=await fetch(`${base}/internal/agent-runs/${parent}/standard-web/invoke`,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY},body:JSON.stringify({orgId:org,attemptId:ctx.attemptId,leaseEpoch:2,toolCallId:'stale-web',toolName:'fetch_url',toolArgs:{url:webUrl+'/article'}})});expect(deniedWeb.status).toBe(403);expect(webRequests).toBe(0);
  const config={configurable:{native_runtime:ref,org_skills:[{stable_name:'example',package:pack}],disable_task_auto_classify:true,run_control_callback:{base_url:base,key:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY,org_id:org,run_id:parent,attempt_id:ctx.attemptId,lease_epoch:1}}};
  const output=await processRun(join(workspace,'apps/deep-agent-service/.venv/bin/python'),[join(workspace,'apps/deep-agent-service/tests/native_full_chain_runner.py')],JSON.stringify(config),{...process.env,PYTHONPATH:join(workspace,'apps/deep-agent-service/src'),WX_WEB_TEST_URL:webUrl+'/article',WX_INPUT_PATHS:JSON.stringify(originalInputs.map(i=>i.path)),NATIVE_SESSION_SOCKET:socket,NATIVE_SESSION_SERVICE_BASE_URL:base,NATIVE_SESSION_SERVICE_KEY:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY});
  const report=JSON.parse(output);expect(report.skillStages).toEqual(['metadata_discovered','body_read']);expect(report.tools).toEqual(['read_file','execute','wx_artifact_publish','web_search','fetch_url']);expect(report.webSourceLinked).toBe(true);expect(report.inputsVerified).toBe(true);expect(report.inputPromptVerified).toBe(true);expect(webRequests).toBe(2);
  expect((await owner.resolve(ref.bindingId,ctx)).inputs).toEqual(originalInputs);
  const files=await staging.listFiles(org,parent);expect(files).toHaveLength(1);expect(Buffer.from((await objects.get(files[0]!.objectKey))!)).toEqual(Buffer.from('真实跨语言产物 UTF8'));
  await repo.storeOutputAwaitingWriteback(org,parent,{text:report.final,finalStepSeq:1,files});const pending=(await repo.claimWritebackPending(org,1))[0]!;
  const write={runId:parent,threadId:pending.threadId,inputMessageId:pending.inputMessageId,agentId:pending.agentId,text:pending.text,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),outputDigest:'a'.repeat(64),files};
  await repo.commitWriteback(org,write);await repo.commitWriteback(org,write);
  const versions=await db.withTenant(org,s=>s.query('SELECT storage_key FROM agent_artifact_versions WHERE org_id=$1 AND produced_by_run_id=$2',[org,parent]));expect(versions.rows).toHaveLength(1);
  const attachments=await db.withTenant(org,s=>s.query('SELECT a.id FROM chat_message_attachments a JOIN chat_messages m ON m.id=a.message_id AND m.org_id=a.org_id WHERE m.org_id=$1 AND m.agent_run_id=$2',[org,parent]));expect(attachments.rows).toHaveLength(1);
  console.log(JSON.stringify({chain:'native_factory→UDS→isolated sandbox→PG authority→FsObjectStore→writeback',...report,artifacts:versions.rows.length,attachments:attachments.rows.length}));
 }finally{try{if(provisioned)await owner.releaseForRun(org,parent);}finally{try{await app?.close();}finally{if(webServer){webServer.closeAllConnections();await new Promise<void>(resolve=>webServer!.close(()=>resolve()));}await new Promise<void>((resolve,reject)=>relay.close(e=>e?reject(e):resolve()));if(oldKey===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=oldKey;}}}
},120000);
