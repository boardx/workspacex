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
const org=toOrgId('audio-real-'+randomUUID()),parent='run-'+randomUUID();
const workspace=join(process.cwd(),'../..');let db:PgDatabase;let root:string;
function processRun(cmd:string,args:string[],input='',env=process.env):Promise<string>{return new Promise((resolve,reject)=>{const child=spawn(cmd,args,{env});const timer=setTimeout(()=>child.kill('SIGKILL'),240000);child.on('close',()=>clearTimeout(timer));let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('exit',code=>code===0?resolve(out):reject(new Error(`real model process exited ${code}; ${err.replaceAll(process.env.DASHSCOPE_API_KEY??'never-match-secret','[redacted]')}`)));child.stdin.end(input);});}
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

beforeAll(async()=>{await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());root=await mkdtemp(join(tmpdir(),'wx-chain-'));await seed(org,parent);
 await asApp(org,c=>c.query("UPDATE agent_runs SET status='running',started_at=now(),lease_epoch=1,lease_expires_at=now()+interval '10 minutes' WHERE id=$1",[parent]));
 await asApp(org,c=>c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,parent]));
});
afterAll(async()=>{await db?.close();await resetOrgs(org);await rm(root,{recursive:true,force:true});});
import {verifySkillStarterPack} from '../../src/domain/skill/starter-pack';
it('real configured model selects the minutes skill and writes a source-grounded artifact',async()=>{
 for(const key of ['DASHSCOPE_API_KEY','DASHSCOPE_BASE_URL','DASHSCOPE_MODEL','WX_AUDIO_REAL_EVIDENCE'])if(!process.env[key])throw new Error(`missing ${key}`);
 const container=process.env.WX_NATIVE_SANDBOX_CONTAINER;if(!container)throw new Error('owned sandbox required');
 const fixture=await readFile(join(workspace,'apps/deep-agent-service/tests/native_sandbox_fixture.py'),'utf8'),relayCode=fixture.split('_UDS_RELAY = r"""')[1]?.split('"""')[0];if(!relayCode)throw new Error('relay missing');
 const socket=join(root,'sandbox.sock');const relay=createServer(async(req,res)=>{try{let body='';for await(const c of req)body+=c;const output=JSON.parse(await processRun('docker',['exec','-i',container,'node','-e',relayCode],JSON.stringify({method:req.method,path:req.url,headers:req.headers,body})));res.writeHead(output.status,{'content-type':'application/json'});res.end(output.body);}catch{res.writeHead(503);res.end('{}');}});await new Promise<void>(r=>relay.listen(socket,r));
 const objects=new FsObjectStore(root),repo=new PgAgentRunRepository(db),grants=new PgToolPermissionGrantRepository(db),identity=new PgIdentityRepository(db),chat=new PgChatRepository(db);
 const owner=new PgNativeSessionOwner(db,new PgParentRunControlReader(db),createNativeSessionTransport(socket),'e'.repeat(64),new PgNativeRunInputs(db,objects,{repo:identity,ids:{next:()=>randomUUID()},chat}));
 const authority=new ToolExecutionAuthority(new PgParentRunControlReader(db),repo,grants),staging=new PgNativeOutputStaging(db,owner,objects,authority,b=>createNativeSessionFiles({socketPath:socket,...b}));
 const oldKey=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=randomUUID();let app:Awaited<ReturnType<typeof NestFactory.create>>|undefined;
 try{
  for(const tool of ['write_todos','read_file','write_file','edit_file','ls','glob','execute','wx_artifact_publish','wx_audio_transcribe'])await grants.grantForRun(org,parent,tool);
  const transcript='[s1 00:00-00:30] 主持人：确认决定：继续保留原始录音。\n[s2 00:30-01:00] 参与者：I suggest buying a new microphone. 主持人：这只是建议，今天不作购买决定。\n[s3 01:00-01:30] 主持人：行动项：核对转录文本。责任人和截止日期尚未确定。\n';
  const uploaded=await uploadAttachment({repo:identity,ids:{next:()=>randomUUID()},chat,attachments:new PgChatAttachmentRepository(db),store:objects,attachmentIds:{next:()=>randomUUID()},clock:{now:()=>new Date().toISOString()}},{orgId:org,userId:'actor',threadId:`thread-${org}`,filename:'meeting-transcript.txt',mime:'text/plain',bytes:Buffer.from(transcript)});
  await asApp(org,c=>c.query('UPDATE chat_message_attachments SET message_id=$3 WHERE org_id=$1 AND id=$2',[org,uploaded.id,`message-${org}`]));
  const pack=verifySkillStarterPack(await new FileSkillStarterPackSource(join(workspace,'skills/starter-packs')).load('standard-audio','1.1.1'),{packId:'standard-audio',packVersion:'1.1.1'});
  const skills=pack.skills.map(s=>({stableName:s.stableName,package:{skillId:s.stableName,versionId:s.semanticVersion,files:s.files}}));
  const ctx={orgId:org,parentRunId:parent,attemptId:parent+':0',leaseEpoch:1};const ref=await owner.provision(ctx,skills,{execute:false,wx_artifact_publish:false,wx_audio_transcribe:false});
  class TestModule{};Module({controllers:[NativeSessionController,NativeOutputStagingController,RunInterjectionController,StandardAudioController],providers:[{provide:NATIVE_SESSION_OWNER,useValue:owner},{provide:NATIVE_OUTPUT_STAGING,useValue:staging},{provide:TOOL_EXECUTION_AUTHORITY,useValue:authority},{provide:AGENT_RUN_STORE,useValue:repo},{provide:INTERJECTION_STORE,useValue:new PgInterjectionStore(db)},{provide:TOOL_PERMISSION_GRANT_STORE,useValue:grants},{provide:STANDARD_AUDIO_SERVICE,useValue:null}]})(TestModule);
  app=await NestFactory.create(TestModule,{logger:false});await app.listen(0,'127.0.0.1');const base=await app.getUrl();
  const config={configurable:{native_runtime:ref,org_skills:skills.map(s=>({stable_name:s.stableName,package:s.package})),disable_task_auto_classify:true,run_control_callback:{base_url:base,key:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY,org_id:org,run_id:parent,attempt_id:ctx.attemptId,lease_epoch:1}}};
  const raw=await processRun(join(workspace,'apps/deep-agent-service/.venv/bin/python'),[join(workspace,'apps/deep-agent-service/tests/audio_skill_real_model_runner.py')],JSON.stringify(config),{...process.env,PYTHONPATH:join(workspace,'apps/deep-agent-service/src'),NATIVE_SESSION_SOCKET:socket,NATIVE_SESSION_SERVICE_BASE_URL:base,NATIVE_SESSION_SERVICE_KEY:process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY});
  const evidence=process.env.WX_AUDIO_REAL_EVIDENCE!;await mkdir(evidence,{recursive:true});await writeFile(join(evidence,'model-trace.json'),raw);const report=JSON.parse(raw);
  const instructions=Buffer.from(pack.skills.find(s=>s.stableName==='meeting-minutes')!.files.find(f=>f.path==='SKILL.md')!.contentBase64,'base64').toString('utf8');
  expect(report.calls.some((c:{id:string;name:string;args:{file_path?:string;command?:string}})=>
   (c.name==='read_file'&&c.args.file_path==='/skills/meeting-minutes/SKILL.md') ||
   (c.name==='execute'&&c.args.command==='cat /skills/meeting-minutes/SKILL.md'&&report.results.some((r:{toolCallId:string;status:string;content:string})=>r.toolCallId===c.id&&r.status==='success'&&r.content.includes(instructions))))).toBe(true);
  expect(report.skillActivity.some((fact:{skillStableName:string;skillVersion:string;stage:string})=>fact.skillStableName==='meeting-minutes'&&fact.skillVersion==='1.1.1'&&fact.stage==='body_read')).toBe(true);
  expect(report.calls.some((c:{name:string})=>c.name==='wx_artifact_publish')).toBe(true);expect(report.negativeCalls).not.toContain('wx_audio_transcribe');expect(report.negativeCalls).not.toContain('wx_artifact_publish');
  const files=await staging.listFiles(org,parent);expect(files.length).toBeGreaterThan(0);const minutes=files.find(f=>f.name==='minutes.md');expect(minutes).toBeDefined();
  const bytes=Buffer.from((await objects.get(minutes!.objectKey))!);const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);await writeFile(join(evidence,'minutes.md'),bytes);await writeFile(join(evidence,'source.txt'),transcript);
  expect(text).toMatch(/保留.*原始录音/);expect(text).toMatch(/建议/);expect(text.replace(/(?:未|没有|并非|不是)(?:被)?(?:拒绝|否决|驳回)/g,'')).not.toMatch(/拒绝|否决|驳回|rejected|denied/i);expect(text).toMatch(/未知|未确定|待定|Unknown/i);expect(text).toMatch(/s1|00:00/);expect(text).toMatch(/s3|01:00/);
  await repo.storeOutputAwaitingWriteback(org,parent,{text:report.final,finalStepSeq:1,files});const pending=(await repo.claimWritebackPending(org,1))[0]!;await repo.commitWriteback(org,{runId:parent,threadId:pending.threadId,inputMessageId:pending.inputMessageId,agentId:pending.agentId,text:pending.text,startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),outputDigest:'a'.repeat(64),files});
  const versions=await db.withTenant(org,s=>s.query('SELECT storage_key FROM agent_artifact_versions WHERE org_id=$1 AND produced_by_run_id=$2',[org,parent]));expect(versions.rows).toHaveLength(files.length);await writeFile(join(evidence,'result.json'),JSON.stringify({model:report.model,packDigest:pack.packDigest,minutesSha256:createHash('sha256').update(bytes).digest('hex'),artifacts:files.length,actualWriteback:true}));
 }finally{try{await owner.releaseForRun(org,parent);}finally{await app?.close();await new Promise<void>(r=>relay.close(()=>r()));if(oldKey===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=oldKey;}}
},300000);
