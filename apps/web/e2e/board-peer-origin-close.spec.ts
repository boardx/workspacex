import {test,expect,type Page} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {dirname,join} from 'node:path';
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
 let ownedProxy:{proof:{listener:string};dispose:()=>Promise<void>}|undefined;
 let verifyProxySources:(()=>Promise<void>)|undefined;
 const proxyUrl=process.env.BOARD_SYNC_FAULT_PROXY_URL,controlSecret=process.env.BOARD_SYNC_FAULT_CONTROL_SECRET;
 if(!proxyUrl||!controlSecret||controlSecret.length<32)throw new Error('Explicit private scoped transport fixture required');
 const proxyOrigin=new URL(proxyUrl);
 if(proxyOrigin.hostname!=='127.0.0.1'||proxyOrigin.protocol!=='http:'||proxyOrigin.pathname!=='/'||proxyOrigin.search||proxyOrigin.hash||proxyOrigin.username||proxyOrigin.password)throw new Error('Invalid isolated proxy origin');
 const actualProxyBindings:boolean[]=[];
 for(const page of [origin,peer])page.on('websocket',socket=>{
  const url=new URL(socket.url());if(url.pathname!==`/v1/whiteboards/${boardId}/sync`)return;
  actualProxyBindings.push(url.protocol==='ws:'&&url.hostname===proxyOrigin.hostname&&url.port===proxyOrigin.port&&!url.search&&!url.hash&&!url.username&&!url.password);
 });
 const proxyControl=async(command:string)=>{
  const response=await api.post(`${proxyOrigin.origin}/__board_fault/${command}`,{headers:{'x-board-fault-control':controlSecret}});
  expect(response.status()).toBe(200);
 };
 const proxyReceipt=async()=>{
  const response=await api.get(`${proxyOrigin.origin}/__board_fault/receipt`,{headers:{'x-board-fault-control':controlSecret}});
  expect(response.status()).toBe(200);
  const receipt=await response.json() as {boardSha256:string;deniedUpgradeCount:number;complete:boolean;dropped:number;requests:Array<{event:string;status?:number}>};
  expect(receipt.boardSha256).toBe(sha256(boardId));expect(receipt.complete).toBe(true);expect(receipt.dropped).toBe(0);
  return receipt;
 };
 const cloudProof=async(phase:'synced'|'offline',label:string)=>{
  const status=peer.getByTestId('board-sync-status'),icon=status.locator('svg'),viewport=peer.viewportSize();expect(viewport).not.toBeNull();
  await expect(status).toHaveAttribute('data-sync-phase',phase);await expect(icon).toHaveCount(1);await expect(icon).toBeVisible();
  await expect(icon).toHaveClass(phase==='offline'?/lucide-cloud-off/:/lucide-cloud(?:\s|$)/);
  const bounds=await icon.boundingBox();expect(bounds).not.toBeNull();expect(bounds!.width).toBeGreaterThanOrEqual(19);expect(bounds!.height).toBeGreaterThanOrEqual(19);
  expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport!.width);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(64);
  await expect(peer.getByTestId('board-sync-banner')).toHaveCount(0); // testid-gate: absent Legacy sync banner was removed.
  await info.attach(`${label}-${viewport!.width}`,{body:await status.screenshot(),contentType:'image/png'});
 };
 try{
  const login=origin.waitForResponse(response=>new URL(response.url()).pathname==='/auth/login'&&response.request().method()==='POST');
  token=await boardLogin(origin);const identity=await (await login).json();expect(identity.userId).toBe(F.userId);expect(identity.sessionToken===token).toBe(true);
  boardId=await createAcceptanceBoard(api,token,title);
  const bridgePath=process.env.BOARD_SYNC_FAULT_BRIDGE_PATH,bridgeHash=process.env.BOARD_SYNC_FAULT_BRIDGE_SHA,templatePath=process.env.BOARD_SYNC_FAULT_TEMPLATE_PATH;
  if(!bridgePath||!bridgeHash||!templatePath||sha256(await readFile(bridgePath))!==bridgeHash)throw new Error('Verified owned proxy bridge required');
  const expectedProxySources=JSON.parse(process.env.BOARD_SYNC_FAULT_SOURCE_HASHES??'null') as Record<string,string>|null;
  const names=['wsx-r08-owned-proxy-bridge.mjs','wsx-r08-fault-proxy.mjs','wsx-r08-proxy-policy.mjs'];
  if(!expectedProxySources||Object.keys(expectedProxySources).sort().join(',')!==[...names].sort().join(','))throw new Error('Complete transport source closure required');
  verifyProxySources=async()=>{for(const name of names){const expectedHash=expectedProxySources[name];if(typeof expectedHash!=='string'||!/^[a-f0-9]{64}$/.test(expectedHash)||sha256(await readFile(join(dirname(bridgePath),name)))!==expectedHash)throw new Error('Transport source changed');}};
  await verifyProxySources();
  const secondLogin=await api.post(`${apiOrigin()}/auth/login`,{data:{email:F.email,password:F.password}});expect(secondLogin.status()).toBe(200);
  const secondSession=await secondLogin.json();expect(secondSession.userId).toBe(identity.userId);expect(typeof secondSession.sessionToken).toBe('string');expect(secondSession.sessionToken===token).toBe(false);
  const bridge=await import(pathToFileURL(bridgePath).href);
  ownedProxy=await bridge.prepareOwnedProxy({templatePath,boardId,userId:identity.userId,title,tokens:[token,secondSession.sessionToken]});
  if(!ownedProxy)throw new Error('Owned proxy did not start');
  expect(ownedProxy.proof.listener).toBe(proxyOrigin.origin);
  const owned=await (await boardApi(api,token,'GET',`/whiteboards/${boardId}`)).json();expect(owned.ownerId).toBe(identity.userId);expect(owned.name).toBe(title);
  const initial=await boardHead(api,token,boardId);
  await boardApi(api,token,'POST',`/whiteboards/${boardId}/commands`,{requestId:randomUUID(),epoch:initial.epoch,commands:[{type:'create',object:{id:objectId,kind:'sticky',schemaVersion:1,geometry:{x:100,y:160,width:180,height:140,rotation:0},text:'Baseline',style:{},parentId:null,orderKey:''}}]});
  for(const page of [origin,peer]){
   await page.goto(`/studio/board/${boardId}`);await expectBoardSynced(page);
   await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(1);
  }
  expect(peer.context()).toBe(context);expect((await peer.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY))===token).toBe(true);
  expect(actualProxyBindings.length).toBeGreaterThanOrEqual(2);expect(actualProxyBindings.every(Boolean)).toBe(true);
  const runtimeBefore=await verifyRuntimeIdentity(api,sourceSha,await chunks()),before=await canonicalBoardSnapshot(api,token,boardId);
  runtimeStarted=true;
  await cloudProof('synced','cloud-initial');
  await context.setOffline(true);
  for(const page of [origin,peer])await expect(page.getByTestId('board-sync-status')).toHaveAttribute('data-sync-phase','offline');
  await expect.poll(()=>transport.snapshot().events.filter(event=>event.direction==='close').length).toBeGreaterThanOrEqual(2);
  for(const page of [origin,peer])await expect(page.getByTestId('board-sync-status')).not.toHaveAttribute('aria-label',/^已同步/);
  await cloudProof('offline','cloud-offline');
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
  await cloudProof('synced','cloud-recovered');
  // This is a real upstream handshake fault, not a browser route or protocol mock.
  const faultBefore=await canonicalBoardSnapshot(api,token,boardId),receiptBefore=await proxyReceipt();
  expect(receiptBefore.deniedUpgradeCount).toBe(0);expect(receiptBefore.requests.filter(event=>event.event==='upgrade'&&event.status===101).length).toBeGreaterThanOrEqual(3);
  await context.setOffline(true);await proxyControl('drop');
  await expect(peer.getByTestId('board-sync-status')).toHaveAttribute('data-sync-phase','offline');
  const peerOutline=peer.getByTestId(`board-a11y-object-${objectId}`);await peerOutline.focus();await peerOutline.press('Enter');
  const faultEditor=peer.getByRole('textbox',{name:'对象文字',exact:true});await faultEditor.fill('Recovered after real 503');await faultEditor.press('ControlOrMeta+Enter');
  await expect(faultEditor).toHaveCount(0);await expect.poll(()=>durableIds(peer,boardId)).toHaveLength(1);
  const faultIds=await durableIds(peer,boardId);expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(faultBefore);
  await proxyControl('deny-once');const faultStarted=performance.now();await context.setOffline(false);
  await expect.poll(async()=>(await proxyReceipt()).deniedUpgradeCount,{timeout:45_000}).toBe(1);
  await expectBoardSynced(peer,45_000-(performance.now()-faultStarted));
  await expect.poll(()=>durableIds(peer,boardId),{timeout:45_000-(performance.now()-faultStarted)}).toEqual([]);
  const faultAfter=await canonicalBoardSnapshot(api,token,boardId),faultReceipt=await proxyReceipt();
  expect(faultAfter.revision).toEqual({epoch:faultBefore.revision.epoch,seq:faultBefore.revision.seq+1});
  expect(faultAfter.objects).toEqual(faultBefore.objects.map(object=>({...object,text:'Recovered after real 503'})));
  const attempts=faultReceipt.requests.slice(receiptBefore.requests.length).filter(event=>event.event==='upgrade');
  expect(attempts.map(event=>event.status)).toEqual([503,101]);
  const faultAcks=transport.snapshot().events.filter(event=>event.client==='peer'&&event.direction==='received'&&event.type==='ack'&&typeof event.updateId==='string'&&faultIds.includes(event.updateId));expect(faultAcks).toHaveLength(1);
  expect(performance.now()-faultStarted).toBeLessThanOrEqual(45_000);
  await info.attach('peer-real-503-recovered',{body:await peer.screenshot(),contentType:'image/png'});
  observations.push({phase:'real-503-recovery',before:faultBefore.revision,after:faultAfter.revision,receipt:faultReceipt,elapsedMs:performance.now()-faultStarted});
  await peer.reload();await expectBoardSynced(peer);expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(faultAfter);expect(await durableIds(peer,boardId)).toEqual([]);
  await info.attach('peer-reload-persisted',{body:await peer.screenshot(),contentType:'image/png'});
  observations.push({phase:'runtime-end',runtimeBefore,runtimeAfter:await verifyRuntimeIdentity(api,sourceSha,await chunks())});
 }catch(error){
  failure=error;
  if(!peer.isClosed()){
   try{await info.attach('origin-close-failure',{body:await peer.screenshot(),contentType:'image/png'});observations.push({phase:'failed',head:boardId&&token?await boardHead(api,token,boardId):null,syncLabel:await peer.getByTestId('board-sync-status').getAttribute('aria-label')});}
   catch(diagnosticError){cleanupErrors.push(diagnosticError);}
  }
 }finally{
  try{await proxyControl('restore');}catch(error){cleanupErrors.push(error);}
  try{await context.setOffline(false);}catch(error){cleanupErrors.push(error);}
  if(boardId&&token)try{
   const owned=await (await boardApi(api,token,'GET',`/whiteboards/${boardId}`)).json();expect(owned.ownerId).toBe(F.userId);expect(owned.name).toBe(title);
   await archiveAcceptanceBoard(api,token,boardId);const archived=await (await boardApi(api,token,'GET',`/whiteboards/${boardId}`)).json();
   await boardApi(api,token,'DELETE',`/whiteboards/${boardId}`,{requestId:randomUUID(),confirmation:'PERMANENTLY_DELETE',expectedLifecycleRevision:archived.lifecycleRevision});
   expect((await api.get(`${apiOrigin()}/whiteboards/${boardId}`,{headers:{authorization:`Bearer ${token}`}})).status()).toBe(404);
  }catch(error){cleanupErrors.push(error);}
  try{await peer.close();}catch(error){cleanupErrors.push(error);}
  if(ownedProxy)try{await ownedProxy.dispose();}catch(error){cleanupErrors.push(error);}
  if(verifyProxySources)try{await verifyProxySources();}catch(error){cleanupErrors.push(error);}
  try{expect(actualProxyBindings.length).toBeGreaterThanOrEqual(2);expect(actualProxyBindings.every(Boolean)).toBe(true);}catch(error){cleanupErrors.push(error);}
  if(runtimeStarted)try{observations.push({phase:'post-cleanup-runtime',proof:await verifyRuntimeIdentity(api,sourceSha,await chunks())});}catch(error){cleanupErrors.push(error);}
  try{await writeFile(info.outputPath('origin-close-result.json'),JSON.stringify({sourceSha,status:failure||cleanupErrors.length?'failed':'passed',viewport:info.project.use.viewport,observations,transport:transport.snapshot(),sameProfile:true,independentBrowserUsers:false,failedReconnect:observations.some(value=>value.phase==='real-503-recovery'),permissionLateWrites:'unit-only-not-browser-claimed'},null,2),{mode:0o600});}catch(error){cleanupErrors.push(error);}
 }
 if(failure||cleanupErrors.length)throw new AggregateError([...(failure?[failure]:[]),...cleanupErrors],'Origin-close acceptance or cleanup failed');
});
