import {toOrgId} from '../../src/domain/org-id';
import {randomUUID,createHash} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {canvas as C} from '@repo/contracts';
import {CanvasReadOutput,CanvasUpdateOutput} from '@repo/contracts/standard-canvas-tools';
import {seedOrg,addOrgMember,addProjectMember,seedAgendaSegment,asApp,ensureDatabase,migrateOnce,resetOrgs} from '../support/db';
import {addChatThread,addChatMessage} from '../support/chat-db';
import {TOOL_PERMISSION_GRANT_STORE,type ToolPermissionGrantStore} from '../../src/application/agent-run/tool-permission-grants';
const org=toOrgId('canvas-tool-'+randomUUID()),project='project-'+org,run='run-'+org,segment='segment-'+org;
let app:Awaited<ReturnType<typeof import('../../src/main')['createApp']>>,base:string,canvasId:string,g1:string,g2:string;
const old=Object.fromEntries(['KERNEL_QUIET','KERNEL_AGENT_RUN_AUTOSTART','KERNEL_ALLOW_TEST_PRINCIPAL','DEEP_AGENT_SERVICE_INTERNAL_KEY'].map(k=>[k,process.env[k]]));
const auth={'content-type':'application/json','x-kernel-test-principal':`alice:${org}`};
const invoke=(toolName:string,toolArgs:unknown,extra:Record<string,unknown>={})=>fetch(`${base}/internal/agent-runs/${run}/standard-canvas/invoke`,{method:'POST',headers:{'content-type':'application/json','x-deep-agent-internal-key':'canvas-test-key'},body:JSON.stringify({orgId:org,attemptId:run+':0',leaseEpoch:1,toolCallId:randomUUID(),toolName,toolArgs,...extra})});
beforeAll(async()=>{
 await ensureDatabase();await migrateOnce();const fixture=await seedOrg({orgId:org,projectId:project});g1=fixture.groups.g1!;g2=fixture.groups.g2!;
 await addOrgMember(org,'alice','consultant',null);await addOrgMember(org,'fac','admin',null);await addProjectMember(org,project,'alice','member',g1);await addProjectMember(org,project,'fac','facilitator',null,true);await seedAgendaSegment(org,project,segment);
 await addChatThread({orgId:org,id:'parent-'+org,projectId:null,visibilityScope:'private',createdBy:'alice'});await addChatMessage({orgId:org,id:'message-'+org,threadId:'parent-'+org,body:'canvas request',authorId:'alice'});
 await asApp(org,async c=>{
  await c.query("INSERT INTO canvas_templates(org_id,key,version,display_name,status,builtin,visibility,underlying_type,sections) VALUES($1,'swot',1,'SWOT','published',false,'org-wide','canvas','[]')",[org]);
  await c.query("INSERT INTO canvas_template_bindings(id,org_id,agenda_segment_id,workshop_id,template_key,template_version) VALUES($1,$2,$3,$4,'swot',1)",[randomUUID(),org,segment,project]);
  await c.query("INSERT INTO agents(id,org_id,stable_name,name,status,creator_id,created_at,updated_at) VALUES($1,$2,'canvas','Canvas','enabled','alice',now(),now())",['agent-'+org,org]);
  await c.query(`INSERT INTO agent_versions(id,org_id,agent_id,semantic_label,instruction_digest,instructions,skill_version_ids,model_provider,model_id,tool_policy,creator_id,created_at,published_at) VALUES($1,$2,$3,'v1',$4,'canvas','{}','test','test','[]','alice',now(),now())`,['version-'+org,org,'agent-'+org,createHash('sha256').update('canvas').digest('hex')]);
  await c.query(`INSERT INTO agent_runs(id,org_id,thread_id,input_message_id,agent_id,agent_version_id,skill_version_ids,model_provider,model_id,status,started_at,lease_epoch,lease_expires_at) VALUES($1,$2,$3,$4,$5,$6,'[]','test','test','running',now(),1,now()+interval '10 minutes')`,[run,org,'parent-'+org,'message-'+org,'agent-'+org,'version-'+org]);
  await c.query("INSERT INTO agent_run_steps(id,org_id,run_id,seq,kind,status,started_at,ended_at) VALUES($1,$2,$3,1,'context_built','succeeded',now(),now())",[randomUUID(),org,run]);
 });
 Object.assign(process.env,{KERNEL_QUIET:'1',KERNEL_AGENT_RUN_AUTOSTART:'0',KERNEL_ALLOW_TEST_PRINCIPAL:'1',DEEP_AGENT_SERVICE_INTERNAL_KEY:'canvas-test-key'});
 app=await(await import('../../src/main')).createApp();await app.listen(0,'127.0.0.1');base=await app.getUrl();
 const res=await fetch(`${base}/canvas/agenda-segments/${segment}/instances`,{method:'POST',headers:{...auth,'x-kernel-test-principal':`fac:${org}`},body:JSON.stringify({agendaSegmentId:segment,groupIds:[g1],idempotencyKey:'fixture'})});expect(res.status).toBe(200);
 const result=C.operations.instantiateForSegment.out.parse(await res.json());canvasId=result.instances[0]!.instanceId;
});
afterAll(async()=>{await app?.close();await resetOrgs(org);for(const[k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}});
it('read matches actual source and render projection at one immutable version',async()=>{
 const response=await invoke('wx_canvas_read',{canvasId});expect(response.status).toBe(200);const result=CanvasReadOutput.parse(await response.json());
 const canonical=await fetch(`${base}/canvas/instances/${canvasId}/source`,{headers:auth});expect(canonical.status).toBe(200);expect(C.operations.getSource.out.parse(await canonical.json())).toEqual({markdown:result.source,versionId:result.versionId,contentHash:result.contentHash});
 const render=await fetch(`${base}/canvas/instances/${canvasId}/render?versionId=${result.versionId}`,{headers:auth});expect(render.status).toBe(200);expect(result.renderSource).toEqual(C.operations.renderCanvas.out.parse(await render.json()));
 expect(result.revision).toBe(1);expect(result.supportedOperations).toEqual(['replace-source']);
 expect((await invoke('wx_canvas_read',{canvasId},{leaseEpoch:2})).status).toBe(403);expect((await invoke('wx_canvas_read',{canvasId},{orgId:'foreign'})).status).toBe(403);
});
it('writes require actual tool authorization; concurrent same-key executes once and conflicts do not overwrite',async()=>{
 const args={canvasId,expectedRevision:1,changes:{kind:'replace-source',markdown:'# Evidence\n\n```mermaid\ngraph TD\n A-->B\n```\n'},idempotencyKey:'operation-1'};
 expect((await invoke('wx_canvas_update',args)).status).toBe(403);
 const grants=app.get<ToolPermissionGrantStore>(TOOL_PERMISSION_GRANT_STORE);await grants.grantForRun(org,run,'wx_canvas_update');
 const responses=await Promise.all([invoke('wx_canvas_update',args),invoke('wx_canvas_update',args)]);expect(responses.map(r=>r.status)).toEqual([200,200]);
 const results=await Promise.all(responses.map(async r=>CanvasUpdateOutput.parse(await r.json())));expect(results[0]!.versionId).toBe(results[1]!.versionId);expect(results.map(r=>r.replayed).sort()).toEqual([false,true]);
 const versions=await asApp(org,async c=>(await c.query('SELECT version,markdown FROM canvas_instance_versions WHERE org_id=$1 AND instance_id=$2 ORDER BY version',[org,canvasId])).rows);expect(versions).toHaveLength(2);expect(versions[1].markdown).toBe(args.changes.markdown);
 expect((await invoke('wx_canvas_update',{...args,changes:{kind:'replace-source',markdown:'changed'}})).status).toBe(409);
 expect((await invoke('wx_canvas_update',{...args,idempotencyKey:'new-operation'})).status).toBe(409);
 await asApp(org,c=>c.query('UPDATE project_memberships SET group_id=$3 WHERE org_id=$1 AND project_id=$2 AND user_id=\'alice\'',[org,project,g2]));
 expect((await invoke('wx_canvas_read',{canvasId})).status).toBe(200); // existing cross-group read semantics
 expect((await invoke('wx_canvas_update',args)).status).toBe(404); // replay also requires current write group
 await asApp(org,c=>c.query('DELETE FROM project_memberships WHERE org_id=$1 AND project_id=$2 AND user_id=\'alice\'',[org,project]));
 expect((await invoke('wx_canvas_read',{canvasId})).status).toBe(404);
});
it('known durable version resolves lost write acknowledgement without issuing a second write',async()=>{
 await addProjectMember(org,project,'alice','member',g1);
 const {PgCanvasInstanceRepository}=await import('../../src/infrastructure/canvas/pg-canvas-instance-repository');
 const {DATABASE_PORT}=await import('../../src/application/ports/database.port');
 const {IDENTITY_REPOSITORY,DECISION_ID_FACTORY}=await import('../../src/application/identity/ports');
 const {StandardCanvasService}=await import('../../src/application/agent-run/standard-canvas-tools');
 const instances=new PgCanvasInstanceRepository(app.get(DATABASE_PORT)),append=instances.appendVersion.bind(instances);let writes=0;
 instances.appendVersion=async input=>{writes++;await append(input);throw new Error('simulated acknowledgement loss after actual PG write');};
 const service=new StandardCanvasService({instances,auth:{repo:app.get(IDENTITY_REPOSITORY),ids:app.get(DECISION_ID_FACTORY)}});
 const result=await service.update({orgId:org,userId:'alice'},{canvasId,expectedRevision:2,changes:{kind:'replace-source',markdown:'# Final actual durable source'},idempotencyKey:'lost-ack'});
 expect(result.replayed).toBe(true);expect(result.newRevision).toBe(3);expect(writes).toBe(1);
 const saved=await asApp(org,async c=>(await c.query('SELECT markdown FROM canvas_instance_versions WHERE org_id=$1 AND id=$2',[org,result.versionId])).rows[0]);expect(saved.markdown).toBe('# Final actual durable source');
});
/**
 * S012 (#2935) —— 无权限用户对**既有** canvas 的实际写入被拒，且 revision/对象身份不变。
 *
 * 上面第二条用例已经证明"撤权后 update 返回 404"，但它只看状态码：状态码是**声明**，
 * 不是反证。真正要钉的是三件事——拒绝发生在 append 之前（没有下游 dispatch）、
 * 库里 revision/版本行/内容 hash 逐字段不变、以及 run/attempt/lease 身份没被拒绝动过。
 *
 * 反证（issue #2935 交付要求）：把 `standard-canvas-tools.ts` update 开头那句
 * `await getCanvasSource(...)` 删掉，本用例必须变红——见 PR 正文记录的实测。
 */
it('an unauthorized writer is refused before any append and leaves canvas revision and version identity byte-identical',async()=>{
 const snapshot=()=>asApp(org,async c=>({
  instance:(await c.query('SELECT id,head_version,template_key,template_version,group_id,created_by FROM canvas_instances WHERE org_id=$1 AND id=$2',[org,canvasId])).rows,
  versions:(await c.query('SELECT id,version,content_hash,markdown,created_by FROM canvas_instance_versions WHERE org_id=$1 AND instance_id=$2 ORDER BY version',[org,canvasId])).rows,
  run:(await c.query('SELECT status,lease_epoch,cancel_requested_at FROM agent_runs WHERE org_id=$1 AND id=$2',[org,run])).rows,
 }));
 const authorized=await snapshot();
 const head=Number(authorized.instance[0]!.head_version);
 expect(authorized.versions).toHaveLength(head);
 // 授权仍然在（第二条用例已 grantForRun），所以任何拒绝都不可能是"缺 grant"。
 expect(await app.get<ToolPermissionGrantStore>(TOOL_PERMISSION_GRANT_STORE).hasGrant(org,run,'wx_canvas_update')).toBe(true);

 // ① 服务层：无权限 actor 连一次 appendVersion 都不该发生。
 const {PgCanvasInstanceRepository}=await import('../../src/infrastructure/canvas/pg-canvas-instance-repository');
 const {DATABASE_PORT}=await import('../../src/application/ports/database.port');
 const {IDENTITY_REPOSITORY,DECISION_ID_FACTORY}=await import('../../src/application/identity/ports');
 const {StandardCanvasService}=await import('../../src/application/agent-run/standard-canvas-tools');
 const instances=new PgCanvasInstanceRepository(app.get(DATABASE_PORT));let appends=0;
 const append=instances.appendVersion.bind(instances);instances.appendVersion=async input=>{appends++;return append(input);};
 const service=new StandardCanvasService({instances,auth:{repo:app.get(IDENTITY_REPOSITORY),ids:app.get(DECISION_ID_FACTORY)}});
 const write={canvasId,expectedRevision:head,changes:{kind:'replace-source' as const,markdown:'# intruder rewrite'},idempotencyKey:'unauthorized-write'};
 // 完全不在这个 project 里的身份：读授权就该在 append 之前把它挡掉。
 await expect(service.update({orgId:org,userId:'unknown-user'},write)).rejects.toThrow();
 expect(appends).toBe(0);

 // ② HTTP 层：请求者调到别的组——**看得见但不该写得动**，这是 S012 说的
 //    "无权限用户对既有 canvas 的实际写入"，比"整个人不在项目里"更接近真场景。
 await asApp(org,c=>c.query('UPDATE project_memberships SET group_id=$3 WHERE org_id=$1 AND project_id=$2 AND user_id=\'alice\'',[org,project,g2]));
 expect((await invoke('wx_canvas_read',{canvasId})).status).toBe(200);
 const denied=await invoke('wx_canvas_update',write);expect(denied.status).toBe(404);
 const leak=await denied.text();
 for(const row of authorized.versions)expect(leak).not.toContain(row.markdown);
 // 之前成功过的 idempotencyKey 重放同样被拒，撤权后的重放不得变成一次读。
 expect((await invoke('wx_canvas_update',{canvasId,expectedRevision:1,changes:{kind:'replace-source',markdown:'# Evidence\n\n```mermaid\ngraph TD\n A-->B\n```\n'},idempotencyKey:'operation-1'})).status).toBe(404);
 expect(appends).toBe(0);

 // ③ revision / 版本行 / 内容 hash / run 身份逐字段不变。
 expect(await snapshot()).toEqual(authorized);

 // ④ 恢复授权后同一次写才成立，证明上面的不变不是"这个 canvas 本来就写不进去"。
 await asApp(org,c=>c.query('UPDATE project_memberships SET group_id=$3 WHERE org_id=$1 AND project_id=$2 AND user_id=\'alice\'',[org,project,g1]));
 const allowed=await invoke('wx_canvas_update',write);expect(allowed.status,await allowed.clone().text()).toBe(200);
 const after=await snapshot();
 expect(Number(after.instance[0]!.head_version)).toBe(head+1);
 expect(after.versions).toHaveLength(head+1);
 expect(after.versions.slice(0,head)).toEqual(authorized.versions);
 expect(after.versions[head]!.markdown).toBe(write.changes.markdown);
});
