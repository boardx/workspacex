import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {SESSION_TOKEN_STORAGE_KEY} from '../lib/api-client';
import {apiOrigin,archiveAcceptanceBoard,boardApi,boardHead,boardLogin,canonicalBoardSnapshot,canonicalRows,createAcceptanceBoard} from './board-acceptance-support';
import {expectBoardSynced} from './support/board-sync-status';
import {createSpatialWsMetadataRecorder} from './support/board-spatial-ws-metadata';
import {sharedOutboxProof} from './support/board-shared-outbox-proof';
import {observeRuntimeChunks,runtimeSourceIdentity,sha256,verifyRuntimeIdentity} from './board-runtime-evidence';

// Only receipt identifiers leave IndexedDB; encrypted payloads and keys never do.
async function durableIds(page:Page,boardId:string){
 return page.evaluate(async id=>{
  const databases=await indexedDB.databases();
  if(!databases.some(database=>database.name==='workspacex-whiteboard-outbox-v1'))throw new Error('OUTBOX_DATABASE_MISSING');
  const db=await new Promise<IDBDatabase>((resolve,reject)=>{const open=indexedDB.open('workspacex-whiteboard-outbox-v1');open.onsuccess=()=>resolve(open.result);open.onerror=()=>reject(open.error);});
  try{return await new Promise<string[]>((resolve,reject)=>{
   const tx=db.transaction('updates'),read=tx.objectStore('updates').index('board').getAll(id);
   read.onerror=()=>reject(read.error);tx.onabort=()=>reject(tx.error);
   read.onsuccess=()=>resolve((read.result as Array<{id:string}>).map(row=>row.id.slice(row.id.lastIndexOf(':')+1)).sort());
  });}finally{db.close();}
 },boardId);
}

test('same-profile live peer recovers a closed origin without reload and ACKs each durable receipt once',async({page:origin,request:api},info)=>{
 test.setTimeout(180_000);
 const sourceSha=runtimeSourceIdentity(),context=origin.context(),peer=await context.newPage();
 const chunks=observeRuntimeChunks(peer),transport=createSpatialWsMetadataRecorder();transport.observe(origin,'original');transport.observe(peer,'peer');
 const title=`R08 closed origin ${randomUUID()}`,objectId=randomUUID(),observations:Array<Record<string,unknown>>=[];
 let token='',boardId='',failure:unknown,runtimeStarted=false;
 const cleanupErrors:unknown[]=[];
 try{
  const login=origin.waitForResponse(response=>new URL(response.url()).pathname==='/auth/login'&&response.request().method()==='POST');
  token=await boardLogin(origin);const identity=await (await login).json();expect(identity.userId).toBe(F.userId);expect(identity.sessionToken===token).toBe(true);
  boardId=await createAcceptanceBoard(api,token,title);
  const owned=await (await boardApi(api,token,'GET',`/whiteboards/${boardId}`)).json();expect(owned.ownerId).toBe(identity.userId);expect(owned.name).toBe(title);
  const initial=await boardHead(api,token,boardId);
  await boardApi(api,token,'POST',`/whiteboards/${boardId}/commands`,{requestId:randomUUID(),epoch:initial.epoch,commands:[{type:'create',object:{id:objectId,kind:'sticky',schemaVersion:1,geometry:{x:100,y:160,width:180,height:140,rotation:0},text:'Baseline',style:{},parentId:null,orderKey:''}}]});
  for(const page of [origin,peer]){
   await page.goto(`/studio/board/${boardId}`);await expectBoardSynced(page);
   await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(1);
  }
  expect(peer.context()).toBe(context);expect((await peer.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY))===token).toBe(true);
  const runtimeBefore=await verifyRuntimeIdentity(api,sourceSha,await chunks()),before=await canonicalBoardSnapshot(api,token,boardId);
  runtimeStarted=true;
  await context.setOffline(true);
  for(const page of [origin,peer])await expect(page.getByTestId('board-sync-status')).toHaveAttribute('data-sync-phase','offline');
  const outline=origin.getByTestId(`board-a11y-object-${objectId}`);
  for(const [index,text] of ['Closed origin first','Closed origin final'].entries()){
   await outline.focus();await outline.press('Enter');
   const editor=origin.getByRole('textbox',{name:'对象文字',exact:true});await expect(editor).toBeVisible();await editor.fill(text);await editor.press('ControlOrMeta+Enter');
   await expect(editor).toHaveCount(0);await expect(outline.locator('..')).toHaveAttribute('data-object-text',text);
   await expect.poll(()=>durableIds(peer,boardId)).toHaveLength(index+1);
   expect(await durableIds(origin,boardId)).toEqual(await durableIds(peer,boardId));
   expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(before);
  }
  const pendingIds=await durableIds(peer,boardId);expect(new Set(pendingIds).size).toBe(2);expect(pendingIds.every(id=>/^[0-9a-f-]{36}$/i.test(id))).toBe(true);
  const expected=await canonicalRows(origin);expect(expected).toHaveLength(1);
  expect(transport.snapshot().events.filter(event=>event.client==='peer'&&event.direction==='sent'&&event.type==='update')).toEqual([]);
  await info.attach('origin-offline-two-receipts',{body:await origin.screenshot(),contentType:'image/png'});
  await origin.close();expect(origin.isClosed()).toBe(true);expect(peer.isClosed()).toBe(false);expect(await durableIds(peer,boardId)).toEqual(pendingIds);
  const started=performance.now(),remaining=()=>{const budget=45_000-(performance.now()-started);expect(budget).toBeGreaterThan(0);return budget;};
  await context.setOffline(false);
  // No reload, navigation, new page, or manual retry before peer convergence.
  await expect.poll(()=>canonicalRows(peer),{timeout:remaining()}).toEqual(expected);await expectBoardSynced(peer,remaining());
  const after=await canonicalBoardSnapshot(api,token,boardId);expect(after.revision).toEqual({epoch:before.revision.epoch,seq:before.revision.seq+2});
  expect(after.objects).toEqual(before.objects.map(object=>({...object,text:'Closed origin final'})));
  const metadata=transport.snapshot();expect(metadata.dropped).toBe(0);
  const sends=metadata.events.filter(event=>event.client==='peer'&&event.direction==='sent'&&event.type==='update');
  expect(sends).toHaveLength(2);expect(sends.map(event=>event.updateId).sort()).toEqual(pendingIds);
  const acks=metadata.events.filter(event=>event.client==='peer'&&event.direction==='received'&&event.type==='ack');
  expect(acks).toHaveLength(2);expect(acks.map(event=>event.updateId).sort()).toEqual(pendingIds);
  expect(sharedOutboxProof(metadata.events,before.revision.seq,after.revision.seq,'distinct')).toEqual([]);
  await expect.poll(()=>durableIds(peer,boardId),{timeout:remaining()}).toEqual([]);
  expect(performance.now()-started).toBeLessThanOrEqual(45_000);
  observations.push({phase:'same-profile-takeover',before:before.revision,after:after.revision,pendingIds,elapsedMs:performance.now()-started,rowsSha256:sha256(JSON.stringify(expected))});
  await info.attach('peer-recovered-without-reload',{body:await peer.screenshot(),contentType:'image/png'});
  await peer.reload();await expectBoardSynced(peer);expect(await canonicalRows(peer)).toEqual(expected);expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(after);expect(await durableIds(peer,boardId)).toEqual([]);
  await info.attach('peer-reload-persisted',{body:await peer.screenshot(),contentType:'image/png'});
  observations.push({phase:'runtime-end',runtimeBefore,runtimeAfter:await verifyRuntimeIdentity(api,sourceSha,await chunks())});
 }catch(error){
  failure=error;
  if(!peer.isClosed()){
   try{await info.attach('origin-close-failure',{body:await peer.screenshot(),contentType:'image/png'});observations.push({phase:'failed',head:boardId&&token?await boardHead(api,token,boardId):null,syncLabel:await peer.getByTestId('board-sync-status').getAttribute('aria-label')});}
   catch(diagnosticError){cleanupErrors.push(diagnosticError);}
  }
 }finally{
  try{await context.setOffline(false);}catch(error){cleanupErrors.push(error);}
  if(boardId&&token)try{
   const owned=await (await boardApi(api,token,'GET',`/whiteboards/${boardId}`)).json();expect(owned.ownerId).toBe(F.userId);expect(owned.name).toBe(title);
   await archiveAcceptanceBoard(api,token,boardId);const archived=await (await boardApi(api,token,'GET',`/whiteboards/${boardId}`)).json();
   await boardApi(api,token,'DELETE',`/whiteboards/${boardId}`,{requestId:randomUUID(),confirmation:'PERMANENTLY_DELETE',expectedLifecycleRevision:archived.lifecycleRevision});
   expect((await api.get(`${apiOrigin()}/whiteboards/${boardId}`,{headers:{authorization:`Bearer ${token}`}})).status()).toBe(404);
  }catch(error){cleanupErrors.push(error);}
  try{await peer.close();}catch(error){cleanupErrors.push(error);}
  if(runtimeStarted)try{observations.push({phase:'post-cleanup-runtime',proof:await verifyRuntimeIdentity(api,sourceSha,await chunks())});}catch(error){cleanupErrors.push(error);}
  try{await writeFile(info.outputPath('origin-close-result.json'),JSON.stringify({sourceSha,status:failure||cleanupErrors.length?'failed':'passed',observations,transport:transport.snapshot(),sameProfile:true,independentBrowserUsers:false},null,2),{mode:0o600});}catch(error){cleanupErrors.push(error);}
 }
 if(failure||cleanupErrors.length)throw new AggregateError([...(failure?[failure]:[]),...cleanupErrors],'Origin-close acceptance or cleanup failed');
});
