import {afterAll,beforeAll,expect,it} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {createServer,type Server} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import type {NestExpressApplication} from '@nestjs/platform-express';
import {schemas as sandboxSchemas} from '@repo/contracts/sandbox-session';
import {DocumentParseOutput,DocumentStructure} from '@repo/contracts/standard-document-tools';
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asApp,resetOrgs} from '../support/db';
import {addChatThread} from '../support/chat-db';
import {seedAgentRun} from '../support/agent-run-db';
import {toOrgId} from '../../src/domain/org-id';
import {DATABASE_PORT,type DatabasePort} from '../../src/application/ports/database.port';
import {OBJECT_STORE,type ObjectStore} from '../../src/application/artifact/ports';
import {NATIVE_SESSION_OWNER,type NativeSessionOwner} from '../../src/application/agent-run/native-session-owner';
import {TOOL_PERMISSION_GRANT_STORE,type ToolPermissionGrantStore} from '../../src/application/agent-run/tool-permission-grants';
import {uploadAttachment} from '../../src/application/chat/upload-attachment';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {PgChatRepository} from '../../src/infrastructure/chat/pg-chat-repository';
import {PgChatAttachmentRepository} from '../../src/infrastructure/chat/pg-chat-attachment-repository';
import {createNativeSessionFiles} from '../../src/infrastructure/agent-run/native-session-files';

const workspace=resolve('../..'),org=toOrgId('w08-http-'+randomUUID()),run='run-'+randomUUID(),thread='thread-'+randomUUID();
const context={orgId:org,parentRunId:run,attemptId:run+':0',leaseEpoch:1};
const originals=[
 ['pdf','cross-page-table.pdf','application/pdf'],
 ['docx','native-locators.docx','application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
 ['pptx','native-locators.pptx','application/vnd.openxmlformats-officedocument.presentationml.presentation'],
 ['xlsx','native-locators.xlsx','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
] as const;
const envNames=['NATIVE_SESSION_SOCKET','NATIVE_SESSION_BINDING_KEY','DEEP_AGENT_SERVICE_INTERNAL_KEY','WORKSPACEX_OBJECT_ROOT','KERNEL_QUIET'];
const previous=Object.fromEntries(envNames.map(k=>[k,process.env[k]]));
let app:NestExpressApplication,db:DatabasePort,owner:NativeSessionOwner,relay:Server,root:string,base:string,socket:string,bindingId:string;
let inputs:Awaited<ReturnType<NativeSessionOwner['resolve']>>['inputs']=[];
let cachedPath='',pinnedPackage:Parameters<NativeSessionOwner['provision']>[1]=[];
const executedCommands:string[]=[];
let executionCount=0,afterExecution:(()=>Promise<void>)|undefined;
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
function relayProcess(container:string,code:string,input:string):Promise<string>{return new Promise((resolveResult,reject)=>{
 const child=spawn('docker',['exec','-i',container,'node','-e',code],{stdio:['pipe','pipe','pipe']});const chunks:Buffer[]=[];let size=0;
 const timer=setTimeout(()=>child.kill('SIGKILL'),130000);
 child.stdout.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>24*1024*1024)child.kill('SIGKILL');else chunks.push(chunk);});
 child.stderr.resume();child.on('error',reject);child.on('close',code=>{clearTimeout(timer);if(code===0)resolveResult(Buffer.concat(chunks).toString());else reject(new Error('fixture relay failed'));});child.stdin.end(input);
});}
const invoke=(path:string,override:Record<string,unknown>={})=>fetch(base+`/internal/agent-runs/${run}/document/parse`,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':'w08-http-key'},body:JSON.stringify({orgId:org,attemptId:context.attemptId,leaseEpoch:1,bindingId,toolCallId:randomUUID(),toolName:'wx_document_parse',toolArgs:{workspacePath:path,outputMode:'chunks',ocr:false},...override})});
beforeAll(async()=>{
 const container=process.env.WX_NATIVE_SANDBOX_CONTAINER;if(!container)throw new Error('actual W08 sandbox container required');
 // Probe the exact provider setup with its mandatory BPF before HTTP hides OS diagnostics.
 // This is a fixed /usr/bin/true command, not user input and not a policy relaxation.
 const probe=JSON.parse(await relayProcess(container,`const fs=require('node:fs'),cp=require('node:child_process');const fd=fs.openSync('/opt/sandbox/session-seccomp.bpf','r');try{const r=cp.spawnSync('/usr/bin/bwrap',['--seccomp','3','--unshare-all','--unshare-user','--die-with-parent','--new-session','--cap-drop','ALL','--ro-bind','/usr','/usr','--ro-bind','/lib','/lib','--ro-bind-try','/lib64','/lib64','--clearenv','--','/usr/bin/true'],{env:{},timeout:5000,maxBuffer:4096,stdio:['ignore','pipe','pipe',fd]});process.stdout.write(JSON.stringify({arch:process.arch,status:r.status,signal:r.signal,error:r.error?.code,stderr:r.stderr?.toString().slice(0,2048)}));}finally{fs.closeSync(fd);}`,'')) as {arch:string;status:number|null;stderr?:string};
 expect(probe.status,JSON.stringify(probe)).toBe(0);

 ensureDatabase();await migrateOnce();root=await mkdtemp(join(tmpdir(),'wx-w08-http-'));socket=join(root,'sandbox.sock');
 const fixture=await readFile(join(workspace,'apps/deep-agent-service/tests/native_sandbox_fixture.py'),'utf8');
 const code=fixture.split('_UDS_RELAY = r"""')[1]?.split('"""')[0];if(!code)throw new Error('relay missing');
 relay=createServer(async(req,res)=>{try{let body='';for await(const chunk of req)body+=chunk;
  const output=JSON.parse(await relayProcess(container,code,JSON.stringify({method:req.method,path:req.url,headers:req.headers,body}))) as {status:number;body:string};
  if(req.method==='POST'&&req.url?.endsWith('/executions')){
   // Only synthetic fixture execution responses; never log request headers/session tokens.
   const result=JSON.parse(output.body) as {error?:string;exitCode?:number|null;output?:string;timedOut?:boolean;cancelled?:boolean;truncated?:boolean};
   if(output.status!==200||result.exitCode!==0)console.error('[native-document execution]',JSON.stringify({status:output.status,error:result.error,exitCode:result.exitCode,timedOut:result.timedOut,cancelled:result.cancelled,truncated:result.truncated,output:result.output?.slice(0,2048)}));
   executionCount++;executedCommands.push(String((JSON.parse(body) as {command:string}).command));const hook=afterExecution;afterExecution=undefined;if(hook)await hook();}
  res.writeHead(output.status,{'content-type':'application/json'});res.end(output.body);
 }catch{res.writeHead(503);res.end('{}');}});await new Promise<void>(done=>relay.listen(socket,done));
 process.env.NATIVE_SESSION_SOCKET=socket;process.env.NATIVE_SESSION_BINDING_KEY='d'.repeat(64);process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY='w08-http-key';process.env.WORKSPACEX_OBJECT_ROOT=root;process.env.KERNEL_QUIET='1';
 const {createApp}=await import('../../src/main');app=await createApp();await app.listen(0,'127.0.0.1');base=await app.getUrl();db=app.get(DATABASE_PORT);owner=app.get(NATIVE_SESSION_OWNER);
 await seedOrg({orgId:org,projectId:'project-'+org});await addOrgMember(org,'actor','consultant',null);await addOrgMember(org,'intruder','consultant',null);
 await addChatThread({orgId:org,id:thread,projectId:null,visibilityScope:'private',createdBy:'actor'});await seedAgentRun({orgId:org,id:run,threadId:thread,authorId:'actor',status:'running'});
 await asApp(org,async c=>{
  const agent='agent-'+run,version='version-'+run;
  await c.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,$2,'w08-fixture','W08 fixture','enabled','actor',now(),now())",[agent,org]);
  await c.query("INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES($1,$2,$3,'v1',$4,'fixture instructions','{}','test-provider','test-model','[]','actor',now(),now())",[version,org,agent,hash(Buffer.from('fixture instructions'))]);
  await c.query('UPDATE agent_runs SET agent_id=$3,agent_version_id=$4 WHERE org_id=$1 AND id=$2',[org,run,agent,version]);
 });
 await asApp(org,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,run]));
 await asApp(org,c=>c.query("UPDATE agent_runs SET started_at=now()-interval '1 second',lease_epoch=1,lease_expires_at=now()+interval '15 minutes' WHERE org_id=$1 AND id=$2",[org,run]));
 const objects=app.get<ObjectStore>(OBJECT_STORE),deps={repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},chat:new PgChatRepository(db),attachments:new PgChatAttachmentRepository(db),store:objects,attachmentIds:{next:()=>randomUUID()},clock:{now:()=>new Date().toISOString()}};
 for(const [,filename,mime] of originals){const bytes=await readFile(join(workspace,'apps/skill-sandbox/tests/fixtures/document-structure',filename));const uploaded=await uploadAttachment(deps,{orgId:org,userId:'actor',threadId:thread,filename,mime,bytes});await asApp(org,c=>c.query('UPDATE chat_message_attachments SET message_id=$3 WHERE org_id=$1 AND id=$2',[org,uploaded.id,run+'-input']));}
 const content=Buffer.from('---\nname: w08-fixture\ndescription: Read supplied documents.\n---\nUse wx_document_parse.\n');
 pinnedPackage=[{stableName:'w08-fixture',package:{skillId:'w08-fixture',versionId:'v1',files:[{path:'SKILL.md',mediaType:'text/markdown',contentBase64:content.toString('base64'),digest:hash(content)}]}}];
 const ref=await owner.provision(context,pinnedPackage,{wx_document_parse:true,read_file:false,execute:false});bindingId=ref.bindingId;inputs=(await owner.resolve(bindingId,context)).inputs;
},60000);
afterAll(async()=>{afterExecution=undefined;if(bindingId)await owner.release(bindingId,org,run);await app?.close();if(relay)await new Promise<void>((done,reject)=>relay.close(error=>error?reject(error):done()));await resetOrgs(org);if(root)await rm(root,{recursive:true,force:true});for(const k of envNames){if(previous[k]===undefined)delete process.env[k];else process.env[k]=previous[k];}},30000);
it('production authority rejects missing grants, stale lease and forged source before execution',async()=>{
 const path=inputs[0]!.path,before=executionCount;expect((await invoke(path)).status).toBe(503);
 await app.get<ToolPermissionGrantStore>(TOOL_PERMISSION_GRANT_STORE).grantForRun(org,run,'wx_document_parse');
 expect((await invoke(path,{leaseEpoch:2})).status).toBe(503);expect((await invoke('/inputs/forged.pdf')).status).toBe(503);expect(executionCount).toBe(before);
});
for(const [format,filename] of originals)it(`production HTTP parses actual ${format} bytes into AnyDoc text and native locators`,async()=>{
 const source=inputs.find(i=>i.path.endsWith(filename))!;const response=await invoke(source.path);expect(response.status,await response.clone().text()).toBe(200);
 const result=DocumentParseOutput.parse(await response.json());if(!('structurePath' in result))throw new Error('native structure missing');
 const bound=await owner.resolve(bindingId,context),files=createNativeSessionFiles({socketPath:socket,...bound});
 const textFile=sandboxSchemas.file.parse(await files.read(result.textPath)),structureFile=sandboxSchemas.file.parse(await files.read(result.structurePath)),original=sandboxSchemas.file.parse(await files.read(source.path));
 const text=Buffer.from(textFile.contentBase64,'base64'),structureBytes=Buffer.from(structureFile.contentBase64,'base64');
 expect(hash(text)).toBe(result.textHash);expect(text.length).toBeGreaterThan(10);expect(hash(structureBytes)).toBe(result.structureHash);expect(hash(Buffer.from(original.contentBase64,'base64'))).toBe(source.digest);expect(result.sourceHash).toBe(source.digest);
 const structure=DocumentStructure.parse(JSON.parse(structureBytes.toString()));if(!('chunks' in structure))throw new Error('wrong structure format');expect(structure.sourceFormat).toBe(format);
 if(format==='pdf'){cachedPath=result.textPath;expect(structure.tables?.map(t=>t.pageNumber)).toEqual([1,2]);expect(structure.tables?.[0]?.tableId).toBe(structure.tables?.[1]?.tableId);expect(structure.tables?.[1]?.continuationDetection).toBe('repeated_header_and_columns');expect(structure.chunks).toContainEqual(expect.objectContaining({text:'450',locator:expect.objectContaining({pageNumber:2})}));}
 if(format==='docx'){expect(structure.chunks).toContainEqual(expect.objectContaining({type:'docx_table_cell',text:'120',locator:{tableIndex:0,rowIndex:1,columnIndex:1}}));expect(result.warnings).toContain('docx_page_numbers_unavailable');}
 if(format==='pptx')expect(structure.chunks).toContainEqual(expect.objectContaining({type:'pptx_table_cell',text:'120',locator:expect.objectContaining({slideNumber:2})}));
 if(format==='xlsx'){expect(structure.chunks).toContainEqual(expect.objectContaining({text:'=B2*2',locator:expect.objectContaining({address:'C2'})}));expect(structure.chunks).toContainEqual(expect.objectContaining({locator:expect.objectContaining({address:'A4',mergedRange:'A4:B4'})}));}
},120000);
it('revocation after actual sandbox parsing prevents returning text or structure references',async()=>{
 const before=executionCount;afterExecution=async()=>{await asApp(org,c=>c.query('UPDATE chat_threads SET created_by=$3 WHERE org_id=$1 AND id=$2',[org,thread,'intruder']));};
 try{const response=await invoke(inputs[0]!.path);expect(response.status).toBe(503);expect(executionCount).toBe(before+1);const error=await response.text();expect(error).not.toContain('/workspace/');expect(error).not.toContain('structurePath');}
 finally{await asApp(org,c=>c.query('UPDATE chat_threads SET created_by=$3 WHERE org_id=$1 AND id=$2',[org,thread,'actor']));}
},120000);

it('production Python graph refuses cached read/execute after real source revocation and resumes the same restored binding',async()=>{
 expect(cachedPath).toMatch(/^\/workspace\/parsed-/);
 await app.get<ToolPermissionGrantStore>(TOOL_PERMISSION_GRANT_STORE).grantForRun(org,run,'execute');
 const config={configurable:{native_runtime:{bindingId,profile:'native-v1',policy:'native-v1'},org_skills:pinnedPackage.map(pin=>({stable_name:pin.stableName,package:pin.package})),disable_task_auto_classify:true,run_control_callback:{base_url:base,key:'w08-http-key',org_id:org,run_id:run,attempt_id:context.attemptId,lease_epoch:1}},cachedPath};
 const initialSession=(await owner.resolve(bindingId,context)).sessionId;
 let ready=false,denied=false,restored=false,before=0;
 try{
  await new Promise<void>((done,reject)=>{
   const child=spawn(join(workspace,'apps/deep-agent-service/.venv/bin/python'),[join(workspace,'apps/deep-agent-service/tests/native_cached_source_revocation_runner.py')],{env:{...process.env,PYTHONPATH:join(workspace,'apps/deep-agent-service/src'),NATIVE_SESSION_SERVICE_BASE_URL:base,NATIVE_SESSION_SERVICE_KEY:'w08-http-key'},stdio:['pipe','pipe','pipe']});
   const timer=setTimeout(()=>child.kill('SIGKILL'),90000);let pending='',error='';let work=Promise.resolve();
   child.stdout.on('data',(chunk:Buffer)=>{pending+=chunk.toString();let newline:number;while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline).trim();pending=pending.slice(newline+1);work=work.then(async()=>{
    if(line==='READY'){ready=true;before=executionCount;await asApp(org,c=>c.query('UPDATE chat_threads SET created_by=$3 WHERE org_id=$1 AND id=$2',[org,thread,'intruder']));child.stdin.write('REVOKED\n');}
    if(line==='DENIED'){denied=true;const discovery=executedCommands.slice(before);console.info('revoked fixture commands',JSON.stringify(discovery));expect(discovery).toHaveLength(2);expect(discovery.every(command=>command.includes("base64.b64decode('L3NraWxscy8=')")&&command.includes('with os.scandir(path)')&&!command.includes(cachedPath)&&!command.includes('cat '))).toBe(true);await asApp(org,c=>c.query('UPDATE chat_threads SET created_by=$3 WHERE org_id=$1 AND id=$2',[org,thread,'actor']));child.stdin.write('RESTORED\n');}
    if(line==='RESTORED_READ_AND_EXECUTE_VERIFIED')restored=true;
   }).catch(cause=>{child.kill('SIGKILL');reject(cause);});}});
   child.stderr.on('data',(chunk:Buffer)=>{if(error.length<12000)error+=chunk.toString();});
   child.on('error',reject);child.on('close',code=>{clearTimeout(timer);void work.then(()=>code===0?done():reject(new Error('Python binding verification failed: '+error)));});child.stdin.write(JSON.stringify(config)+'\n');
  });
  expect({ready,denied,restored}).toEqual({ready:true,denied:true,restored:true});expect((await owner.resolve(bindingId,context)).sessionId).toBe(initialSession);
 }finally{await asApp(org,c=>c.query('UPDATE chat_threads SET created_by=$3 WHERE org_id=$1 AND id=$2',[org,thread,'actor']));}
},120000);
