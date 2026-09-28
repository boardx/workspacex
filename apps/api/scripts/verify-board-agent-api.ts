import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {access,writeFile} from 'node:fs/promises';
import {WhiteboardEventPage,WhiteboardObjectsSnapshot,WhiteboardOperationReceipt,type WhiteboardOperationEvent} from '@repo/contracts/whiteboard-operation';
import {WhiteboardServiceActorCreated} from '@repo/contracts/whiteboard-actor';
import type {WhiteboardCommand,WhiteboardObject} from '@repo/contracts/whiteboard-document';
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
let diagnostic:{stage:string;method?:string;path?:string;status?:number}={stage:'target-validation'};
export async function runAgentApiAcceptance(){
 const origin=assertAgentApiTarget(process.env),output=process.env.BOARD_AGENT_API_EVIDENCE!;
 await assert.rejects(access(output),{code:'ENOENT'});
 const git=(...args:string[])=>execFileSync('git',args,{encoding:'utf8'}).trim(),sha=git('rev-parse','HEAD');
 assert.equal(git('status','--porcelain','--untracked-files=all'),'','clean exact source required');
 if(process.env.BOARD_ACCEPTANCE_SHA)assert.equal(sha,process.env.BOARD_ACCEPTANCE_SHA);
 const marker=process.env.BOARD_API_RUNTIME_MARKER!,startedAt=new Date().toISOString();
 const calls:Array<{method:string;path:string;status:number;responseHash:string}>=[];
 async function call(token:string|null,method:string,path:string,data?:unknown,status:number|number[]=200,actorCredential?:string){
  diagnostic={stage:'http-request',method,path:path.replace(/[a-f0-9]{8}-[a-f0-9-]{27,}/g,'<id>')};
  const response=await fetch(`${origin}${path}`,{
   method,
   headers:{
    'Content-Type':'application/json',
    ...(token?{Authorization:`Bearer ${token}`}:{ }),
    ...(actorCredential?{'x-board-actor-credential':actorCredential}:{ }),
   },
   ...(data===undefined?{ }:{body:JSON.stringify(data)}),
   signal:AbortSignal.timeout(15000),
  });
  diagnostic={...diagnostic,stage:'http-response',status:response.status};
  const body=await response.json();assert.ok((Array.isArray(status)?status:[status]).includes(response.status),`${method} ${path}: unexpected HTTP ${response.status}`);
  if(!path.includes('/auth/'))calls.push({method,path,status:response.status,responseHash:hash(body)});
  return body;
 }
 const health=await call(null,'GET','/healthz');assert.equal(health.trustworthy,true);assert.equal(health.deploymentMarker,marker);
 const login=async(email:string,password:string)=>{const body=await call(null,'POST','/auth/login',{email,password});assert.equal(typeof body.sessionToken,'string');return body.sessionToken as string;};
 const owner=await login(F.email,F.password),viewer=await login(F.memberEmail,F.memberPassword);
 const {asOwner}=await import('../tests/support/db');
 const suffix=randomUUID();let actorId:string|undefined,actorCredential:string|undefined,readActor:string|undefined,readCredential:string|undefined;
 let boardId:string|undefined;const ownedBoards:string[]=[];const createdActors:Array<{boardId:string;actorId:string}>=[];
 const steps:unknown[]=[];let evidence:unknown;
 try{
  const board=await call(owner,'POST','/whiteboards',{requestId:randomUUID(),name:`Agent API acceptance ${suffix}`},201);boardId=board.id;assert.equal(typeof boardId,'string');ownedBoards.push(boardId!);
  const prefix=`/v1/whiteboards/${boardId}`;
  const createdActor=WhiteboardServiceActorCreated.parse(await call(owner,'POST',`${prefix}/actors/service`,{label:'Agent API acceptance',scopes:['board:read','board:write'],expiresInDays:1},201));
  actorId=createdActor.actor.actorId;actorCredential=createdActor.credential;createdActors.push({boardId:boardId!,actorId:createdActor.actor.actorId});
  const createdReadActor=WhiteboardServiceActorCreated.parse(await call(owner,'POST',`${prefix}/actors/service`,{label:'Read-only acceptance',scopes:['board:read'],expiresInDays:1},201));
  readActor=createdReadActor.actor.actorId;readCredential=createdReadActor.credential;createdActors.push({boardId:boardId!,actorId:createdReadActor.actor.actorId});
  const read=async(token=owner,credential=actorCredential)=>WhiteboardObjectsSnapshot.parse(await call(token,'GET',`${prefix}/service/objects`,undefined,200,credential));
  const stored=async()=>asOwner(async c=>(await c.query('SELECT (SELECT count(*)::int FROM whiteboard_operations WHERE org_id=$1 AND board_id=$2) AS operations,(SELECT count(*)::int FROM whiteboard_operation_events WHERE org_id=$1 AND board_id=$2) AS events',[F.orgId,boardId])).rows[0]);
  const request=async(commands:WhiteboardCommand[])=>({apiVersion:'2026-09-01' as const,requestId:randomUUID(),expectedRevision:(await read()).revision,commands,provenance:{source:'public-api' as const,model:null,skill:null,sourceArtifactId:null,sourceRevision:null,layoutHash:null,inputObjectIds:[]}});
  async function execute(name:string,commands:WhiteboardCommand[]){const input=await request(commands),receipt=WhiteboardOperationReceipt.parse(await call(owner,'POST',`${prefix}/service/operations`,input,201,actorCredential)),snapshot=await read();assert.deepEqual(snapshot.revision,receipt.revision);assert.equal(receipt.events[0]?.actor.actorId,actorId);steps.push({name,operationId:receipt.operationId,revision:receipt.revision,canonicalHash:hash(snapshot.objects)});return{input,receipt,snapshot};}
  async function reject(name:string,token:string,path:string,data:unknown,status:number|number[],method='POST',credential=actorCredential){
   const before=await read(),counts=await stored();await call(token,method,path,data,status,credential);assert.deepEqual(await read(),before);assert.deepEqual(await stored(),counts);steps.push({name,zeroWrites:true});
  }
  const created=await execute('Create',[{type:'create',object:note('a')},{type:'create',object:note('b',230)}]);assert.deepEqual(created.snapshot.objects.map((o:WhiteboardObject)=>o.id),['a','b']);
  const beforeReplay=await stored(),replayed=WhiteboardOperationReceipt.parse(await call(owner,'POST',`${prefix}/service/operations`,created.input,201,actorCredential));assert.equal(replayed.replayed,true);assert.equal(replayed.operationId,created.receipt.operationId);assert.deepEqual(await stored(),beforeReplay);
  await reject('Idempotency conflict',owner,`${prefix}/service/operations`,{...created.input,commands:[{type:'create',object:note('forged')}]},409);
  const updated=await execute('Update',[{type:'text',id:'a',index:0,deleteCount:1,insert:'API thought'}]);assert.equal(updated.snapshot.objects.find((o:WhiteboardObject)=>o.id==='a')?.text,'API thought');
  const moved=await execute('Move',[{type:'geometry',id:'a',geometry:geometry(350,200)}]);assert.equal(moved.snapshot.objects.find((o:WhiteboardObject)=>o.id==='a')?.geometry.x,350);
  const arranged=await execute('Arrange',[{type:'geometry',id:'a',geometry:geometry(0,300)},{type:'geometry',id:'b',geometry:geometry(204,300)}]);assert.equal(arranged.receipt.events[0]?.type,'ObjectsArranged');assert.deepEqual(arranged.snapshot.objects.map((o:WhiteboardObject)=>[o.geometry.x,o.geometry.y]),[[0,300],[204,300]]);
  const connected=await execute('Connect',[{type:'create',object:{...note('edge'),kind:'connector',connector:{from:'a',to:'b',semanticRelation:'depends_on'}}}]);assert.deepEqual(connected.snapshot.objects.find((o:WhiteboardObject)=>o.id==='edge')?.connector?.from,'a');
  const movedEndpoint=await execute('Move connected endpoint',[{type:'geometry',id:'b',geometry:geometry(500,500)}]);assert.equal(movedEndpoint.snapshot.objects.find((o:WhiteboardObject)=>o.id==='edge')?.connector?.to,'b');
  const commentId=randomUUID(),threadId=randomUUID();
  await call(owner,'POST',`/whiteboards/${boardId}/comments/commands`,{type:'create-comment',requestId:randomUUID(),threadId,commentId,objectId:'a',body:'Keep this original comment binding',mentions:[],expectedRevision:0},201);
  const deleted=await execute('Delete',[{type:'delete',id:'a'}]);assert.deepEqual(deleted.snapshot.objects.map((o:WhiteboardObject)=>o.id),['b']);
  const undo=async(receipt:WhiteboardOperationReceipt)=>WhiteboardOperationReceipt.parse(await call(owner,'POST',`${prefix}/service/operations/${receipt.operationId}/undo`,{expectedRevision:receipt.revision},201,actorCredential));
  const restored=await undo(deleted.receipt);assert.equal(restored.events[0]?.type,'OperationUndone');assert.deepEqual((await read()).objects,movedEndpoint.snapshot.objects);
  const restoredThread=(await call(owner,'GET',`/whiteboards/${boardId}/comments`)).items.find((thread:any)=>thread.id===threadId);assert.ok(restoredThread);assert.equal(restoredThread.objectId,'a');assert.notEqual(restoredThread.status,'object-deleted');assert.equal(restoredThread.comments[0].id,commentId);assert.equal(restoredThread.comments[0].body,'Keep this original comment binding');
  const undoCounts=await stored(),undoReplay=await undo(deleted.receipt);assert.equal(undoReplay.replayed,true);assert.equal(undoReplay.operationId,restored.operationId);assert.deepEqual(await stored(),undoCounts);
  const redone=await undo(restored);assert.deepEqual((await read()).objects,deleted.snapshot.objects);
  steps.push({name:'Authoritative receipt Undo and Redo retain original object/connector IDs',undo:restored.operationId,redo:redone.operationId});
  await reject('Client-supplied inverse denied',owner,`${prefix}/service/operations/${redone.operationId}/undo`,{expectedRevision:redone.revision,commands:[{type:'delete',id:'b'}]},400);
  await reject('Stale Undo cannot overwrite later work',owner,`${prefix}/service/operations/${moved.receipt.operationId}/undo`,{expectedRevision:moved.receipt.revision},409);
  const forbidden=await request([{type:'text',id:'b',index:0,deleteCount:0,insert:'denied'}]);
  await reject('Client actor spoofing denied',owner,`${prefix}/service/operations`,{...forbidden,actor:{actorId:'spoofed'}},400);
  await reject('Missing write scope',owner,`${prefix}/service/operations`,forbidden,403,'POST',readCredential);
  await reject('Client tenant envelope denied',owner,`${prefix}/service/operations`,{...forbidden,orgId:`${F.orgId}-other`},400);
  await reject('Stale CAS',owner,`${prefix}/service/operations`,{...forbidden,expectedRevision:{epoch:1,seq:0}},409);
  await call(owner,'PUT',`/whiteboards/${boardId}/members`,{userId:F.memberUserId,role:'viewer'});
  await reject('Cross-delegator viewer denied',viewer,`${prefix}/service/operations`,forbidden,401);
  // Poll with the returned pair, checking actual persisted audit events and no duplicates.
  let cursor={afterEpoch:1,afterSeq:0};const seen:string[]=[];
  for(let page=0;page<20;page++){const result=WhiteboardEventPage.parse(await call(owner,'GET',`${prefix}/service/events?afterEpoch=${cursor.afterEpoch}&afterSeq=${cursor.afterSeq}&limit=2`,undefined,200,actorCredential));seen.push(...result.events.map((e:WhiteboardOperationEvent)=>e.eventId));cursor={afterEpoch:result.nextEpoch,afterSeq:result.nextSeq};if(!result.events.length)break;}
  assert.equal(new Set(seen).size,seen.length);assert.equal(seen.length,(await stored()).events);
  const checkpoint=await call(owner,'POST',`/whiteboards/${boardId}/checkpoints`,{requestId:randomUUID()},201),prior=(await read()).revision;
  await call(owner,'POST',`/whiteboards/${boardId}/checkpoints/${checkpoint.manifest.checkpointId}/restore`,{requestId:randomUUID(),expectedEpoch:prior.epoch,expectedSeq:prior.seq},201);
  const afterRecovery=await execute('Post-recovery event',[{type:'text',id:'b',index:0,deleteCount:0,insert:'recovered '}]);
  const resumed=WhiteboardEventPage.parse(await call(owner,'GET',`${prefix}/service/events?afterEpoch=${cursor.afterEpoch}&afterSeq=${cursor.afterSeq}&limit=2`,undefined,200,actorCredential));assert.deepEqual(resumed.events.map((e:WhiteboardOperationEvent)=>e.operationId),[afterRecovery.receipt.operationId]);assert.deepEqual({epoch:resumed.nextEpoch,seq:resumed.nextSeq},afterRecovery.receipt.revision);
  await call(owner,'DELETE',`/whiteboards/${boardId}/members/${F.memberUserId}`,undefined,200);
  await reject('Removed viewer cannot use owner delegation',viewer,`${prefix}/service/objects`,undefined,401,'GET');
  await call(owner,'DELETE',`${prefix}/actors/service/${readActor}`,undefined,200);
  await reject('Revoked actor events',owner,`${prefix}/service/events`,undefined,401,'GET',readCredential);
  await reject('Revoked actor Read',owner,`${prefix}/service/objects`,undefined,401,'GET',readCredential);
  // A separate real board keeps the operation endpoint's per-board budget intact.
  const undoBoard=await call(owner,'POST','/whiteboards',{requestId:randomUUID(),name:`Receipt Undo acceptance ${suffix}`},201);ownedBoards.push(undoBoard.id);
  const undoPrefix=`/v1/whiteboards/${undoBoard.id}`;
  const undoActor=WhiteboardServiceActorCreated.parse(await call(owner,'POST',`${undoPrefix}/actors/service`,{label:'Undo acceptance',scopes:['board:read','board:write'],expiresInDays:1},201));createdActors.push({boardId:undoBoard.id,actorId:undoActor.actor.actorId});
  const undoRead=async()=>WhiteboardObjectsSnapshot.parse(await call(owner,'GET',`${undoPrefix}/service/objects`,undefined,200,undoActor.credential));
  const batches:Array<[string,WhiteboardCommand[]]>=[
   ['Create',[{type:'create',object:note('ua')},{type:'create',object:note('ub',204)},{type:'create',object:{...note('panel'),kind:'frame',geometry:{...geometry(-100,-100),width:1000,height:1000}}}]],
   ['Update',[{type:'text',id:'ua',index:0,deleteCount:2,insert:'Updated through public API'},{type:'style',id:'ua',style:{fill:'#aaffaa'}}]],
   ['Move',[{type:'geometry',id:'ua',geometry:geometry(400,200)}]],
   ['Arrange',[{type:'geometry',id:'ua',geometry:geometry(0,400)},{type:'geometry',id:'ub',geometry:geometry(204,400)}]],
   ['Connect',[{type:'create',object:{...note('ue'),kind:'connector',connector:{from:'ua',to:'ub',semanticRelation:'depends_on'}}}]],
   ['Parent',[{type:'parent',id:'ua',parentId:'panel',orderKey:'a'}]],
   ['Delete with attached relationship',[{type:'delete',id:'ua'}]],
  ];
  for(const [name,commands]of batches){
   const before=await undoRead(),input={apiVersion:'2026-09-01',requestId:randomUUID(),expectedRevision:before.revision,commands,provenance:{source:'public-api',model:null,skill:null,sourceArtifactId:null,sourceRevision:null,layoutHash:null,inputObjectIds:[]}};
   const receipt=WhiteboardOperationReceipt.parse(await call(owner,'POST',`${undoPrefix}/service/operations`,input,201,undoActor.credential)),after=await undoRead();assert.deepEqual(after.revision,receipt.revision);assert.notDeepEqual(after.objects,before.objects);
   const undone=WhiteboardOperationReceipt.parse(await call(owner,'POST',`${undoPrefix}/service/operations/${receipt.operationId}/undo`,{expectedRevision:receipt.revision},201,undoActor.credential));assert.deepEqual((await undoRead()).objects,before.objects);
   const redone=WhiteboardOperationReceipt.parse(await call(owner,'POST',`${undoPrefix}/service/operations/${undone.operationId}/undo`,{expectedRevision:undone.revision},201,undoActor.credential));assert.deepEqual((await undoRead()).objects,after.objects);
   steps.push({name:`${name} receipt Undo/Redo`,boardId:undoBoard.id,operationId:receipt.operationId,undoId:undone.operationId,redoId:redone.operationId,beforeHash:hash(before.objects),afterHash:hash(after.objects)});
  }
  const final=await read();assert.equal((await call(null,'GET','/healthz')).deploymentMarker,marker);assert.equal(git('rev-parse','HEAD'),sha);assert.equal(git('status','--porcelain','--untracked-files=all'),'');
  evidence={kind:'board-agent-api',sha,startedAt,finishedAt:new Date().toISOString(),runtime:{deploymentMarker:marker,method:'fresh-api-marker'},boardId,steps,eventCount:(await stored()).events,finalRevision:final.revision,calls,notCovered:['real model generation','browser projection']};
 }catch(error){console.error('Board API primary failure',JSON.stringify(diagnostic));throw error;}finally{
  try{
   for(const actor of createdActors){await call(owner,'DELETE',`/v1/whiteboards/${actor.boardId}/actors/service/${actor.actorId}`,undefined,[200,404]);}
   for(const id of ownedBoards){const current=await call(owner,'GET',`/whiteboards/${id}`);if(!current.archived)await call(owner,'PATCH',`/whiteboards/${id}`,{archived:true,expectedLifecycleRevision:current.lifecycleRevision});}
  } finally { /* lifecycle endpoints own actor cleanup; no privileged DB mutation */ }
 }
 await writeFile(output,JSON.stringify(evidence,null,2),{flag:'wx',mode:0o600});
}
if(process.env.BOARD_AGENT_API_ACCEPTANCE_RUN==='1')runAgentApiAcceptance().then(()=>console.log('Board Agent API acceptance completed; inspect evidence for explicit coverage.')).catch((error:unknown)=>{const value=error as {name?:string;code?:string;stack?:string};console.error('Board Agent API acceptance failed',JSON.stringify({...diagnostic,errorType:['AssertionError','AbortError','TimeoutError'].includes(value.name??'')?value.name:'Error',code:/^[A-Z0-9_]{1,40}$/.test(value.code??'')?value.code:undefined,sourceLine:value.stack?.match(/verify-board-agent-api\.ts:(\d+):\d+/)?.[1]}));process.exitCode=1;});
