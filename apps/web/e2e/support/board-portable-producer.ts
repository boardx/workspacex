import {strict as assert} from 'node:assert';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import type {APIRequestContext} from '@playwright/test';
const digest=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
/** Executes only when called by the real isolated acceptance lane. Does not start services.
 * sourceBoard must be a disposable migration fixture with hierarchy, connector and an image.
 * source/target URLs and tokens may name different instances and tenants.
 */
export async function producePortableRoundtripEvidence(input:{api:APIRequestContext;sourceUrl:string;targetUrl:string;sourceToken:string;targetToken:string;sourceBoardId:string}){
 const call=async(url:string,token:string,method:string,path:string,data?:unknown)=>{const response=await input.api.fetch(`${url}${path}`,{method,headers:{Authorization:`Bearer ${token}`},data});assert(response.ok(),`${method} ${path}: ${response.status()} ${await response.text()}`);return response;};
 const exported=await(await call(input.sourceUrl,input.sourceToken,'POST',`/whiteboards/${input.sourceBoardId}/portable/export`,{})).json(),bytes=Buffer.from(exported.contentBase64,'base64');assert.equal(digest(bytes),exported.sha256);assert.equal(bytes.length,exported.sizeBytes);
 const bundle=JSON.parse(bytes.toString());assert(bundle.objects.content.some((object:any)=>object.parentId),'fixture needs hierarchy');assert(bundle.objects.content.some((object:any)=>object.connector),'fixture needs connector');assert(bundle.media.length>0,'fixture needs real images');assert(!bytes.toString().includes('whiteboards/tenants/'));
 const target=await(await call(input.targetUrl,input.targetToken,'POST','/whiteboards',{requestId:randomUUID(),name:`Portable acceptance ${randomUUID()}`})).json(),requestId=randomUUID(),payload={requestId,expectedEpoch:1,file:{sha256:exported.sha256,sizeBytes:exported.sizeBytes,contentBase64:exported.contentBase64}};
 const accepted=await(await call(input.targetUrl,input.targetToken,'POST',`/whiteboards/${target.id}/portable/import`,payload)).json();assert.equal(accepted.objectCount,bundle.objects.content.length);
 const replay=await(await call(input.targetUrl,input.targetToken,'POST',`/whiteboards/${target.id}/portable/import`,payload)).json();assert.equal(replay.replayed,true);assert.equal(replay.seq,accepted.seq);
 const roundtrip=await(await call(input.targetUrl,input.targetToken,'POST',`/whiteboards/${target.id}/portable/export`,{})).json(),targetBundle=JSON.parse(Buffer.from(roundtrip.contentBase64,'base64').toString());
 const id=(source:string)=>`portable_${digest(`${requestId}:${source}`).slice(0,32)}`,actual=new Map(targetBundle.objects.content.map((object:any)=>[object.id,object]));assert.equal(actual.size,bundle.objects.content.length);
 for(const source of bundle.objects.content){const expected=structuredClone(source);expected.id=id(source.id);expected.parentId=source.parentId?id(source.parentId):null;delete expected.restoredFrom;if(expected.connector){if(expected.connector.from)expected.connector.from=id(expected.connector.from);if(expected.connector.to)expected.connector.to=id(expected.connector.to);}const resetImage=(content:any)=>{if(content?.type==='image')content.replacementOf=null;else if(content?.type==='template')for(const child of content.objects??[])resetImage(child.content);};resetImage(expected.extensionData?.contentObject);assert.deepEqual(actual.get(expected.id),expected);}
 const sharp=createRequire(resolve(__dirname,'../../../api/package.json'))('sharp') as (bytes:Uint8Array)=>{raw():{toBuffer(options:{resolveWithObject:true}):Promise<{data:Buffer;info:{width:number;height:number}}>}};
 const images=[];
 for(const media of bundle.media){const response=await call(input.targetUrl,input.targetToken,'GET',`/whiteboards/${target.id}/assets/${media.assetId}/content`),image=await response.body();assert.equal(digest(image),media.sha256);assert.equal(image.length,media.sizeBytes);const decoded=await sharp(image).raw().toBuffer({resolveWithObject:true});assert(decoded.info.width>0&&decoded.info.height>0);images.push({hash:digest(image),width:decoded.info.width,height:decoded.info.height,pixelHash:digest(decoded.data)});}
 // A changed envelope with the same request ID must not execute another batch.
 const changed=structuredClone(bundle);changed.objects.content[0].text+=' changed';const objectBytes=Buffer.from(JSON.stringify(changed.objects.content));changed.objects.sha256=digest(objectBytes);changed.objects.sizeBytes=objectBytes.length;const changedBytes=Buffer.from(JSON.stringify(changed));
 const conflict=await input.api.post(`${input.targetUrl}/whiteboards/${target.id}/portable/import`,{headers:{Authorization:`Bearer ${input.targetToken}`},data:{...payload,file:{sha256:digest(changedBytes),sizeBytes:changedBytes.length,contentBase64:changedBytes.toString('base64')}}});assert.equal(conflict.status(),409);
 return{sourceBoardId:input.sourceBoardId,targetBoardId:target.id,requestId,exportHash:exported.sha256,accepted,replay,canonicalEquivalent:true,images};
}

/** Real READ COMMITTED lock-race gate. Supply two dedicated pg clients and a
 * disposable board where editorId is a member (not owner). The caller owns the
 * clients/service lifecycle. Revocation is intentionally committed and retained. */
export async function producePortableRevocationRaceEvidence(input:{api:APIRequestContext;url:string;editorToken:string;editorId:string;orgId:string;boardId:string;file:{sha256:string;sizeBytes:number;contentBase64:string};locker:{query(sql:string,values?:unknown[]):Promise<{rows:any[]}>};observer:{query(sql:string,values?:unknown[]):Promise<{rows:any[]}>}}){
 const {locker,observer}=input;let committed=false,request:ReturnType<APIRequestContext['post']>|undefined;
 const metadata=async()=>{await observer.query('BEGIN');try{await observer.query("SELECT set_config('app.current_org',$1,true)",[input.orgId]);const result=await observer.query(`SELECT d.epoch,d.seq::text,(SELECT count(*)::int FROM whiteboard_portable_imports i WHERE i.org_id=d.org_id AND i.board_id=d.board_id) AS receipts,(SELECT count(*)::int FROM whiteboard_image_assets a WHERE a.org_id=d.org_id AND a.board_id=d.board_id) AS assets FROM whiteboard_documents d WHERE d.org_id=$1 AND d.board_id=$2`,[input.orgId,input.boardId]);await observer.query('COMMIT');return result.rows;}catch(error){await observer.query('ROLLBACK');throw error;}};
 const before=await metadata();assert.equal(before.length,1,'fixture needs an initialized document');
 await locker.query('BEGIN');
 try{
  await locker.query("SELECT set_config('app.current_org',$1,true)",[input.orgId]);const locked=await locker.query('SELECT owner_id FROM whiteboards WHERE org_id=$1 AND id=$2 FOR UPDATE',[input.orgId,input.boardId]);assert.notEqual(locked.rows[0]?.owner_id,input.editorId);
  const removed=await locker.query('DELETE FROM whiteboard_members WHERE org_id=$1 AND board_id=$2 AND user_id=$3 RETURNING role',[input.orgId,input.boardId,input.editorId]);assert.equal(removed.rows[0]?.role,'editor');
  const pid=Number((await locker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
  request=input.api.post(`${input.url}/whiteboards/${input.boardId}/portable/import`,{headers:{Authorization:`Bearer ${input.editorToken}`},data:{requestId:randomUUID(),expectedEpoch:Number(before[0].epoch),file:input.file}});
  // Observe an actual blocked DB backend before releasing the revocation lock.
  let blocked=false;const deadline=Date.now()+10000;
  while(Date.now()<deadline){const waiting=await observer.query('SELECT pid FROM pg_stat_activity WHERE $1::int=ANY(pg_blocking_pids(pid))',[pid]);if(waiting.rows.length){blocked=true;break;}await new Promise(resolve=>setTimeout(resolve,25));}
  assert(blocked,'import never reached the board lock; race evidence is invalid');
  await locker.query('COMMIT');committed=true;const response=await request;assert.equal(response.status(),404);assert.deepEqual(await metadata(),before);
  return{boardId:input.boardId,blockedBeforeRevocationCommit:true,status:response.status(),metadataUnchanged:true};
 }finally{if(!committed)await locker.query('ROLLBACK');if(request)await request.catch(()=>undefined);}
}
