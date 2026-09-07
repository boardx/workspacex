/**
 * S018 (#2935) — 撤权后同一个仍 active 的 run 也读不到解析缓存。
 *
 * 已有的 `standard-document-locators-http.test.ts` 用真实 sandbox 容器跑完整链路
 * （READY → 撤权 → read_file/execute 双拒 → 恢复），但它整个文件在没有
 * `WX_NATIVE_SANDBOX_CONTAINER` 时直接 throw，因此**默认套件里没有任何一条**用例
 * 钉住"撤权发生在哪一层、run 级授权是不是仍然放行、拒绝有没有副作用"。
 *
 * 这一条补的就是那个缺口，且刻意不依赖容器：它用真实 PG + 真实
 * `PgNativeSessionOwner` / `PgNativeRunInputs` / `ToolExecutionAuthority` +
 * 生产的两个 controller，取证的顺序是**先证明 run 级授权仍然 allowed**
 * （read_file 是 L0、execute 已授权），**再证明 binding 重解析被拒**——
 * 也就是说拦住缓存的不是"run 结束了"或"授权掉了"，而是
 * `pg-native-session-owner.ts` resolve 里那段"任何访问 session（含 execute 能
 * 触达的缓存派生物）之前先复检当前来源可见性"。
 *
 * 反证（issue #2935 交付要求）：把 resolve 里的 `if(pinnedInputs.length)` 改成
 * `if(false)`，本文件必须变红——见 PR 正文记录的实测。
 */
import 'reflect-metadata';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Module} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {NativeSessionResolved} from '@repo/contracts/native-session-binding';
import {ToolExecutionCheckOutput} from '@repo/contracts/run-control';
import {ensureDatabase,migrateOnce,seedOrg,addOrgMember,asApp,resetOrgs} from '../support/db';
import {addChatThread,addChatMessage} from '../support/chat-db';
import {toOrgId} from '../../src/domain/org-id';
import {PgDatabase} from '../../src/infrastructure/db/pg-database';
import {appConfig} from '../../src/infrastructure/db/pg-config';
import {FsObjectStore} from '../../src/infrastructure/storage/fs-object-store';
import {PgIdentityRepository} from '../../src/infrastructure/identity/pg-identity-repository';
import {PgChatRepository} from '../../src/infrastructure/chat/pg-chat-repository';
import {PgNativeRunInputs} from '../../src/infrastructure/agent-run/pg-native-run-inputs';
import {PgNativeSessionOwner} from '../../src/infrastructure/agent-run/pg-native-session-owner';
import {PgParentRunControlReader} from '../../src/infrastructure/agent-run/pg-parent-run-control';
import {PgAgentRunRepository} from '../../src/infrastructure/agent-run/pg-agent-run-repository';
import {PgToolPermissionGrantRepository} from '../../src/infrastructure/agent-run/pg-tool-permission-grant-repository';
import {PgInterjectionStore} from '../../src/infrastructure/agent-run/pg-interjection-store';
import {ToolExecutionAuthority,TOOL_EXECUTION_AUTHORITY} from '../../src/application/agent-run/tool-execution-authority';
import {NATIVE_SESSION_OWNER} from '../../src/application/agent-run/native-session-owner';
import {AGENT_RUN_STORE} from '../../src/application/agent-run/ports';
import {INTERJECTION_STORE} from '../../src/application/agent-run/interjection-store';
import {TOOL_PERMISSION_GRANT_STORE} from '../../src/application/agent-run/tool-permission-grants';
import {NativeSessionController} from '../../src/interface/controllers/native-session.controller';
import {RunInterjectionController} from '../../src/interface/controllers/run-interjection.controller';

const org=toOrgId('s018-cache-'+randomUUID()),run='run-'+randomUUID(),thread='thread-'+randomUUID(),message='message-'+randomUUID();
const context={orgId:org,parentRunId:run,attemptId:run+':0',leaseEpoch:1};
const key='s018-internal-key';
const hash=(bytes:string|Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
/** 解析产物落在 sandbox 里；这里只需要它的路径形状，读它必须先拿到 session token。 */
const source=Buffer.from('page 1\ntotal,450\npage 2 continuation,450\n');
const cachedPath=`/workspace/parsed-${hash(source)}/text.txt`;
const previousKey=process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;
let db:PgDatabase,owner:PgNativeSessionOwner,grants:PgToolPermissionGrantRepository,root:string,base:string,bindingId:string;
let app:Awaited<ReturnType<typeof NestFactory.create>>;
let created=0,destroyed=0;

const resolveOverHttp=(override:Record<string,unknown>={},headerKey=key)=>fetch(`${base}/internal/native-sessions/${bindingId}/resolve`,
 {method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':headerKey},
  body:JSON.stringify({orgId:org,runId:run,attemptId:context.attemptId,leaseEpoch:context.leaseEpoch,...override})});
const checkTool=(toolName:string,toolArgs:Record<string,unknown>)=>fetch(`${base}/internal/agent-runs/${run}/tool-execution/check`,
 {method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':key},
  body:JSON.stringify({orgId:org,attemptId:context.attemptId,leaseEpoch:context.leaseEpoch,toolName,toolCallId:randomUUID(),toolArgs})});
const decisionOf=async(response:Response)=>{expect(response.status).toBe(200);return ToolExecutionCheckOutput.parse(await response.json());};
/** 拒绝不能留下任何痕迹：绑定行、run 身份、暂存产物、artifact 版本全部逐字段比对。 */
const sideEffects=()=>asApp(org,async c=>({
 binding:(await c.query('SELECT id,status,session_id,token_cipher,expires_at,package_digest,input_manifest,input_digest,interrupt_on FROM native_session_bindings WHERE org_id=$1 AND run_id=$2 ORDER BY id',[org,run])).rows,
 run:(await c.query('SELECT status,lease_epoch,runtime_profile,cancel_requested_at,pending_decision,model_output_files FROM agent_runs WHERE org_id=$1 AND id=$2',[org,run])).rows,
 steps:(await c.query('SELECT id,seq,kind,status FROM agent_run_steps WHERE org_id=$1 AND run_id=$2 ORDER BY seq',[org,run])).rows,
 staging:Number((await c.query('SELECT count(*)::int AS count FROM native_output_staging WHERE org_id=$1 AND run_id=$2',[org,run])).rows[0]!.count),
 artifacts:Number((await c.query('SELECT count(*)::int AS count FROM agent_artifact_versions WHERE org_id=$1 AND produced_by_run_id=$2',[org,run])).rows[0]!.count),
 grants:(await c.query('SELECT tool_name FROM tool_permission_grants WHERE org_id=$1 AND run_id=$2 ORDER BY tool_name',[org,run])).rows,
}));

beforeAll(async()=>{
 await ensureDatabase();await migrateOnce();db=new PgDatabase(appConfig());root=await mkdtemp(join(tmpdir(),'s018-cache-'));
 await seedOrg({orgId:org,projectId:'project-'+org});
 await addOrgMember(org,'actor','consultant',null);await addOrgMember(org,'intruder','consultant',null);
 await addChatThread({orgId:org,id:thread,projectId:null,visibilityScope:'private',createdBy:'actor'});
 await addChatMessage({orgId:org,id:message,threadId:thread,body:'parse this document',authorId:'actor'});
 await asApp(org,async c=>{
  const agent='agent-'+run,version='version-'+run;
  await c.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,$2,'s018','S018','enabled','actor',now(),now())",[agent,org]);
  await c.query("INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES($1,$2,$3,'v1',$4,'pinned instructions','{}','test-provider','pinned-model','[]','actor',now(),now())",[version,org,agent,hash('pinned instructions')]);
  await c.query("INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES($1,$2,$3,$4,$5,$6,'[]','test-provider','pinned-model','running',now(),1,now()+interval '15 minutes')",[run,org,thread,message,agent,version]);
  await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,run]);
 });
 const objects=new FsObjectStore(root);await objects.putOnce('original.pdf',source,'application/pdf');
 await asApp(org,c=>c.query("INSERT INTO chat_message_attachments(id,org_id,thread_id,message_id,storage_ref,filename,mime,bytes) VALUES($1,$2,$3,$4,'original.pdf','cross-page-table.pdf','application/pdf',$5)",['attachment-'+run,org,thread,message,source.length]));
 const reader=new PgParentRunControlReader(db);
 const inputs=new PgNativeRunInputs(db,objects,{repo:new PgIdentityRepository(db),ids:{next:()=>randomUUID()},chat:new PgChatRepository(db)});
 owner=new PgNativeSessionOwner(db,reader,{
  create:async()=>{created++;return {sessionId:randomUUID(),token:'a'.repeat(64),expiresAt:Date.now()+900000};},
  destroy:async()=>{destroyed++;},
 },'b'.repeat(64),inputs);
 const runs=new PgAgentRunRepository(db);grants=new PgToolPermissionGrantRepository(db);
 const authority=new ToolExecutionAuthority(reader,runs,grants);
 class Fixture{}
 Module({controllers:[NativeSessionController,RunInterjectionController],providers:[
  {provide:NATIVE_SESSION_OWNER,useValue:owner},{provide:AGENT_RUN_STORE,useValue:runs},
  {provide:INTERJECTION_STORE,useValue:new PgInterjectionStore(db)},
  {provide:TOOL_PERMISSION_GRANT_STORE,useValue:grants},{provide:TOOL_EXECUTION_AUTHORITY,useValue:authority},
 ]})(Fixture);
 process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=key;
 app=await NestFactory.create(Fixture,{logger:false});await app.listen(0,'127.0.0.1');base=await app.getUrl();
 bindingId=(await owner.provision(context,[],{})).bindingId;
},120000);
afterAll(async()=>{
 try{if(bindingId)await owner.release(bindingId,org,run);}catch{}
 await app?.close();await db?.close();await resetOrgs(org);if(root)await rm(root,{recursive:true,force:true});
 if(previousKey===undefined)delete process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY;else process.env.DEEP_AGENT_SERVICE_INTERNAL_KEY=previousKey;
},30000);

it('a still-running run keeps read_file/execute authorized yet cannot re-resolve the parsed cache after the real source is revoked',async()=>{
 await grants.grantForRun(org,run,'execute');
 // ① 解析成功后的正常态：绑定可解析，session token 是读缓存的唯一凭据。
 const granted=await resolveOverHttp();expect(granted.status).toBe(200);
 const opened=NativeSessionResolved.parse(await granted.json());
 expect(opened.token).toBe('a'.repeat(64));expect(opened.inputs).toHaveLength(1);
 expect(opened.inputs[0]!.digest).toBe(hash(source));
 expect(created).toBe(1);
 const before=await sideEffects();

 // ② run 级授权在撤权前就已经是 allowed——后面证明它撤权后仍然 allowed，
 //    所以拒绝缓存的不是 run 级授权，也不是 run 结束/租约丢失。
 expect(await decisionOf(await checkTool('read_file',{file_path:cachedPath}))).toEqual({allowed:true});
 expect(await decisionOf(await checkTool('execute',{command:`cat '${cachedPath}'`}))).toEqual({allowed:true});

 // ③ 真实撤权：来源线程换主人，run 本身一个字段都不动。
 await asApp(org,c=>c.query('UPDATE chat_threads SET created_by=$3 WHERE org_id=$1 AND id=$2',[org,thread,'intruder']));

 // ④ 时间线取证：同一个 run/attempt/lease，run 级授权仍然放行两个工具……
 const live=await asApp(org,async c=>(await c.query("SELECT status,lease_epoch,lease_expires_at>now() AS lease_valid FROM agent_runs WHERE org_id=$1 AND id=$2",[org,run])).rows[0]!);
 expect(live).toMatchObject({status:'running',lease_epoch:1,lease_valid:true});
 expect(await decisionOf(await checkTool('read_file',{file_path:cachedPath}))).toEqual({allowed:true});
 expect(await decisionOf(await checkTool('execute',{command:`cat '${cachedPath}'`}))).toEqual({allowed:true});

 // ⑤ ……而 binding 重解析（native 运行时读缓存前必经的那一跳）fail closed。
 const refused=await resolveOverHttp();expect(refused.status).toBe(503);
 const body=await refused.text();
 expect(body).not.toContain('a'.repeat(64));expect(body).not.toContain(opened.sessionId);
 expect(body).not.toContain(cachedPath);expect(body).not.toContain('/inputs/');
 await expect(owner.resolve(bindingId,context)).rejects.toThrow('scope_denied');

 // ⑥ 拒绝没有任何下游副作用：没有新 session、没有暂存产物、没有 artifact 版本、
 //    绑定行与 run 身份逐字段不变。
 expect(created).toBe(1);expect(destroyed).toBe(0);
 expect(await sideEffects()).toEqual(before);

 // ⑦ 来源恢复后仍然是同一个 binding/session，不是重新开一个。
 await asApp(org,c=>c.query('UPDATE chat_threads SET created_by=$3 WHERE org_id=$1 AND id=$2',[org,thread,'actor']));
 const restored=await resolveOverHttp();expect(restored.status).toBe(200);
 const reopened=NativeSessionResolved.parse(await restored.json());
 expect(reopened.sessionId).toBe(opened.sessionId);expect(reopened.token).toBe(opened.token);
 expect(reopened.inputs).toEqual(opened.inputs);expect(created).toBe(1);
 expect(await sideEffects()).toEqual(before);
},120000);

it('forged run identity and a wrong service key never reach the binding at all',async()=>{
 expect((await resolveOverHttp({},'wrong-key')).status).toBe(401);
 for(const forged of [{attemptId:run+':9'},{leaseEpoch:2},{orgId:'other-org'},{runId:'other-run'}]){
  const response=await resolveOverHttp(forged);expect(response.status,JSON.stringify(forged)).toBe(503);
  expect(await response.text()).not.toContain('a'.repeat(64));
 }
 expect(created).toBe(1);expect(destroyed).toBe(0);
},60000);
