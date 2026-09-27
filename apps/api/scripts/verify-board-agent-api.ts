import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {access,writeFile} from 'node:fs/promises';
import {WhiteboardEventPage,WhiteboardObjectsSnapshot,WhiteboardOperationReceipt,type WhiteboardOperationRequest} from '@repo/contracts/whiteboard-operation';
import type {WhiteboardCommand} from '@repo/contracts/whiteboard-document';
import {FULLSTACK_E2E as F} from '../../web/e2e/fullstack-smoke-fixture';
import {assertIsolatedDatabase} from '../../../.harness/scripts/lib/test-isolation';

export function assertAgentApiTarget(env:NodeJS.ProcessEnv){
 assert.equal(env.BOARD_AGENT_API_ACCEPTANCE,'1');assert.ok(env.WORKSPACEX_ISOLATION_ID);
 assert.match(env.PGDATABASE??'',/^wsx_[a-f0-9]{20}$/);assertIsolatedDatabase({resolvedDatabase:env.PGDATABASE!,env});
 assert.ok(['127.0.0.1','localhost','::1'].includes(env.PGHOST??''));assert.ok(!env.WORKSPACEX_DEPLOY_PROFILE);
 assert.match(env.WORKSPACEX_API_PORT??'',/^\d+$/);assert.match(env.BOARD_API_RUNTIME_MARKER??'',/^[a-f0-9-]{36}$/);
 assert.ok(env.BOARD_AGENT_API_EVIDENCE);return `http://127.0.0.1:${env.WORKSPACEX_API_PORT}`;
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const geometry=(x:number,y=0)=>({x,y,width:180,height:140,rotation:0});
const note=(id:string,x=0)=>({id,schemaVersion:1 as const,kind:'sticky' as const,geometry:geometry(x),text:id,style:{fill:'#FFF2A8'},parentId:null,orderKey:id});
export async function runAgentApiAcceptance(){
 const origin=assertAgentApiTarget(process.env),output=process.env.BOARD_AGENT_API_EVIDENCE!;
 await assert.rejects(access(output),{code:'ENOENT'});
 const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim(),sha=git('rev-parse','HEAD');
 assert.equal(git('status','--porcelain','--untracked-files=all'),'','clean exact source required');
 if(process.env.BOARD_ACCEPTANCE_SHA)assert.equal(sha,process.env.BOARD_ACCEPTANCE_SHA);
 const marker=process.env.BOARD_API_RUNTIME_MARKER!,startedAt=new Date().toISOString();
 const calls:Array<{method:string;path:string;status:number;responseHash:string}>=[];
 async function call(token:string|null,method:string,path:string,data?:unknown,status:number|number[]=200){
  const response=await fetch(`${origin}${path}`,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(data===undefined?{}:{body:JSON.stringify(data)}),signal:AbortSignal.timeout(15000)});
  const body=await response.json();assert.ok((Array.isArray(status)?status:[status]).includes(response.status),`${method} ${path}: unexpected HTTP ${response.status}`);
  if(!path.includes('/auth/'))calls.push({method,path,status:response.status,responseHash:hash(body)});
  return body;
 }
 const health=await call(null,'GET','/healthz');assert.equal(health.trustworthy,true);assert.equal(health.deploymentMarker,marker);
 const login=async(email:string,password:string)=>{const body=await call(null,'POST','/auth/login',{email,password});assert.equal(typeof body.sessionToken,'string');return body.sessionToken as string;};
 const owner=await login(F.email,F.password),viewer=await login(F.memberEmail,F.memberPassword);
 const {asOwner}=await import('../tests/support/db');
 const suffix=randomUUID(),actorId=`board-api-${suffix}`,viewerActor=`board-api-viewer-${suffix}`,readActor=`board-api-read-${suffix}`;
 const actorIds=[actorId,viewerActor,readActor];let boardId:string|undefined;
 const steps:unknown[]=[];let evidence:unknown;
 try{
  await asOwner(async c=>{for(const [id,delegator,scopes] of [[actorId,F.userId,['board:read','board:write']],[viewerActor,F.memberUserId,['board:read','board:write']],[readActor,F.userId,['board:read']]] as const)await c.query("INSERT INTO whiteboard_actor_identities(org_id,actor_id,kind,delegated_by,scopes,enabled) VALUES($1,$2,'service',$3,$4,true)",[F.orgId,id,delegator,[...scopes]]);});
  const board=await call(owner,'POST','/whiteboards',{requestId:randomUUID(),name:`Agent API acceptance ${suffix}`},201);boardId=board.id;assert.equal(typeof boardId,'string');
  const prefix=`/v1/whiteboards/${boardId}`;
  const read=async(token=owner,id=actorId)=>WhiteboardObjectsSnapshot.parse(await call(token,'GET',`${prefix}/objects?actorId=${encodeURIComponent(id)}`));
  const stored=async()=>asOwner(async c=>(await c.query('SELECT (SELECT count(*)::int FROM whiteboard_operations WHERE org_id=$1 AND board_id=$2) AS operations,(SELECT count(*)::int FROM whiteboard_operation_events WHERE org_id=$1 AND board_id=$2) AS events',[F.orgId,boardId])).rows[0]);
  const actor={kind:'service' as const,actorId,orgId:F.orgId,role:'owner' as const,scopes:['board:read' as const,'board:write' as const],delegatedBy:F.userId};
  const request=async(commands:WhiteboardCommand[]):Promise<WhiteboardOperationRequest>=>({apiVersion:'2026-09-01',requestId:randomUUID(),boardId:boardId!,expectedRevision:(await read()).revision,actor,commands,provenance:{source:'public-api',model:null,skill:null,sourceArtifactId:null,sourceRevision:null,layoutHash:null,inputObjectIds:[]}});
  async function execute(name:string,commands:WhiteboardCommand[]){const input=await request(commands),receipt=WhiteboardOperationReceipt.parse(await call(owner,'POST',`${prefix}/operations`,input,201)),snapshot=await read();assert.deepEqual(snapshot.revision,receipt.revision);assert.equal(receipt.events[0]?.actor.actorId,actorId);steps.push({name,operationId:receipt.operationId,revision:receipt.revision,canonicalHash:hash(snapshot.objects)});return{input,receipt,snapshot};}
  async function reject(name:string,token:string,path:string,data:unknown,status:number|number[],method='POST'){
   const before=await read(),counts=await stored();await call(token,method,path,data,status);assert.deepEqual(await read(),before);assert.deepEqual(await stored(),counts);steps.push({name,zeroWrites:true});
  }
  const created=await execute('Create',[{type:'create',object:note('a')},{type:'create',object:note('b',230)}]);assert.deepEqual(created.snapshot.objects.map(o=>o.id),['a','b']);
  const beforeReplay=await stored(),replayed=WhiteboardOperationReceipt.parse(await call(owner,'POST',`${prefix}/operations`,created.input,201));assert.equal(replayed.replayed,true);assert.equal(replayed.operationId,created.receipt.operationId);assert.deepEqual(await stored(),beforeReplay);
  await reject('Idempotency conflict',owner,`${prefix}/operations`,{...created.input,commands:[{type:'create',object:note('forged')}]},409);
  const updated=await execute('Update',[{type:'text',id:'a',index:0,deleteCount:1,insert:'API thought'}]);assert.equal(updated.snapshot.objects.find(o=>o.id==='a')?.text,'API thought');
  const moved=await execute('Move',[{type:'geometry',id:'a',geometry:geometry(350,200)}]);assert.equal(moved.snapshot.objects.find(o=>o.id==='a')?.geometry.x,350);
  const arranged=await execute('Arrange',[{type:'geometry',id:'a',geometry:geometry(0,300)},{type:'geometry',id:'b',geometry:geometry(204,300)}]);assert.equal(arranged.receipt.events[0]?.type,'ObjectsArranged');assert.deepEqual(arranged.snapshot.objects.map(o=>[o.geometry.x,o.geometry.y]),[[0,300],[204,300]]);
  const connected=await execute('Connect',[{type:'create',object:{...note('edge'),kind:'connector',connector:{from:'a',to:'b',semanticRelation:'depends_on'}}}]);assert.deepEqual(connected.snapshot.objects.find(o=>o.id==='edge')?.connector?.from,'a');
  const movedEndpoint=await execute('Move connected endpoint',[{type:'geometry',id:'b',geometry:geometry(500,500)}]);assert.equal(movedEndpoint.snapshot.objects.find(o=>o.id==='edge')?.connector?.to,'b');
  const deleted=await execute('Delete',[{type:'delete',id:'a'}]);assert.deepEqual(deleted.snapshot.objects.map(o=>o.id),['b']);
  const forbidden=await request([{type:'text',id:'b',index:0,deleteCount:0,insert:'denied'}]);
  await reject('Foreign delegation',owner,`${prefix}/operations`,{...forbidden,actor:{...actor,actorId:viewerActor}},403);
  await reject('Missing write scope',owner,`${prefix}/operations`,{...forbidden,actor:{...actor,actorId:readActor}},403);
  await reject('Wrong tenant envelope',owner,`${prefix}/operations`,{...forbidden,actor:{...actor,orgId:`${F.orgId}-other`}},403);
  await reject('Stale CAS',owner,`${prefix}/operations`,{...forbidden,expectedRevision:{epoch:1,seq:0}},409);
  await call(owner,'PUT',`/whiteboards/${boardId}/members`,{userId:F.memberUserId,role:'viewer'});
  assert.equal((await read(viewer,viewerActor)).role,'viewer');
  await reject('Viewer write denied',viewer,`${prefix}/operations`,{...forbidden,actor:{...actor,actorId:viewerActor,delegatedBy:F.memberUserId}},403);
  // Poll with the returned pair, checking actual persisted audit events and no duplicates.
  let cursor={afterEpoch:1,afterSeq:0};const seen:string[]=[];
  for(let page=0;page<20;page++){const result=WhiteboardEventPage.parse(await call(owner,'GET',`${prefix}/events?actorId=${actorId}&afterEpoch=${cursor.afterEpoch}&afterSeq=${cursor.afterSeq}&limit=2`));seen.push(...result.events.map(e=>e.eventId));cursor={afterEpoch:result.nextEpoch,afterSeq:result.nextSeq};if(!result.events.length)break;}
  assert.equal(new Set(seen).size,seen.length);assert.equal(seen.length,(await stored()).events);
  const checkpoint=await call(owner,'POST',`/whiteboards/${boardId}/checkpoints`,{requestId:randomUUID()},201),prior=(await read()).revision;
  await call(owner,'POST',`/whiteboards/${boardId}/checkpoints/${checkpoint.manifest.checkpointId}/restore`,{requestId:randomUUID(),expectedEpoch:prior.epoch,expectedSeq:prior.seq},201);
  const afterRecovery=await execute('Post-recovery event',[{type:'text',id:'b',index:0,deleteCount:0,insert:'recovered '}]);
  const resumed=WhiteboardEventPage.parse(await call(owner,'GET',`${prefix}/events?actorId=${actorId}&afterEpoch=${cursor.afterEpoch}&afterSeq=${cursor.afterSeq}&limit=2`));assert.deepEqual(resumed.events.map(e=>e.operationId),[afterRecovery.receipt.operationId]);assert.deepEqual({epoch:resumed.nextEpoch,seq:resumed.nextSeq},afterRecovery.receipt.revision);
  await call(owner,'DELETE',`/whiteboards/${boardId}/members/${F.memberUserId}`,undefined,200);
  await reject('Revoked viewer Read',viewer,`${prefix}/objects?actorId=${viewerActor}`,undefined,404,'GET');
  await reject('Revoked viewer events',viewer,`${prefix}/events?actorId=${viewerActor}`,undefined,404,'GET');
  await asOwner(async c=>{await c.query('UPDATE whiteboard_actor_identities SET enabled=false WHERE org_id=$1 AND actor_id=$2',[F.orgId,readActor]);});
  await reject('Disabled actor events',owner,`${prefix}/events?actorId=${readActor}`,undefined,403,'GET');
  await reject('Disabled actor Read',owner,`${prefix}/objects?actorId=${readActor}`,undefined,403,'GET');
  const final=await read();assert.equal((await call(null,'GET','/healthz')).deploymentMarker,marker);assert.equal(git('rev-parse','HEAD'),sha);assert.equal(git('status','--porcelain','--untracked-files=all'),'');
  evidence={kind:'board-agent-api-basic',sha,startedAt,finishedAt:new Date().toISOString(),runtime:{deploymentMarker:marker,method:'fresh-api-marker'},boardId,steps,eventCount:(await stored()).events,finalRevision:final.revision,calls,notCovered:['generic operation receipt Undo (follow-up producer extension)','real model generation','browser projection']};
 }finally{
  try{if(boardId)await call(owner,'PATCH',`/whiteboards/${boardId}`,{archived:true});}
  finally{await asOwner(async c=>{await c.query('DELETE FROM whiteboard_actor_identities WHERE org_id=$1 AND actor_id=ANY($2::text[])',[F.orgId,actorIds]);});}
 }
 await writeFile(output,JSON.stringify(evidence,null,2),{flag:'wx',mode:0o600});
}
if(process.env.BOARD_AGENT_API_ACCEPTANCE_RUN==='1')runAgentApiAcceptance().then(()=>console.log('Board Agent API acceptance completed; inspect evidence for explicit coverage.')).catch(()=>{console.error('Board Agent API acceptance failed; credentials and response bodies suppressed.');process.exitCode=1;});
