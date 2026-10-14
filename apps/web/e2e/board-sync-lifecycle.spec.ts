import {captureBoardLogin} from './support/board-login-capture.mjs';
import {whiteboardSync} from '@repo/contracts';
import {primaryFailure,acceptanceFailureSecrets} from './support/board-primary-failure';
import {test,expect,chromium,type Page,type Browser,type BrowserContext} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {SESSION_TOKEN_STORAGE_KEY} from '../lib/api-client';
import {apiOrigin,boardApi,boardLogin,boardHead,createAcceptanceBoard,canonicalBoardSnapshot,canonicalRows,objectPoint,settled} from './board-acceptance-support';
import {expectBoardSynced} from './support/board-sync-status';
import {createSpatialWsMetadataRecorder} from './support/board-spatial-ws-metadata';
import {observeRuntimeChunks,runtimeSourceIdentity,verifyRuntimeIdentity,sha256} from './board-runtime-evidence';

async function durableIds(page:Page,boardId:string){return page.evaluate(async id=>{
 if(!(await indexedDB.databases()).some(database=>database.name==='workspacex-whiteboard-outbox-v1'))throw new Error('OUTBOX_DATABASE_MISSING');
 const db=await new Promise<IDBDatabase>((resolve,reject)=>{const request=indexedDB.open('workspacex-whiteboard-outbox-v1');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
 try{return await new Promise<string[]>((resolve,reject)=>{const tx=db.transaction('updates'),request=tx.objectStore('updates').index('board').getAll(id);request.onerror=()=>reject(request.error);tx.onabort=()=>reject(tx.error);request.onsuccess=()=>resolve((request.result as Array<{id:string}>).map(row=>row.id.slice(row.id.lastIndexOf(':')+1)).sort());});}finally{db.close();}
},boardId);}

test('S01-S03 independent processes and users prove pending ACK, offline convergence and no late lifecycle writes',async({page:owner,request:api,baseURL},info)=>{
 test.setTimeout(240_000);
 const sourceSha=runtimeSourceIdentity(),chunks=observeRuntimeChunks(owner);
 let secondBrowser:Browser|undefined,peerContext:BrowserContext|undefined;
 const transport=createSpatialWsMetadataRecorder();transport.observe(owner,'original');
 const errors:unknown[]=[];let failureCaptured=false;let stage='setup';let failureStage='SETUP';let failure:unknown,ownerToken='',boardId='',runtimeBefore:Awaited<ReturnType<typeof verifyRuntimeIdentity>>|undefined;
 let proxy:{dispose:()=>Promise<void>}|undefined;
 const observations:Array<Record<string,unknown>>=[];
 const privateSecrets=acceptanceFailureSecrets(F);
 const title=`R08 closed origin lifecycle ${randomUUID()}`;let cleanupPending=false;
 const proxyUrl=process.env.BOARD_SYNC_FAULT_PROXY_URL,secret=process.env.BOARD_SYNC_FAULT_CONTROL_SECRET;
 if(typeof secret==='string')privateSecrets.push(secret);
 const bridgePath=process.env.BOARD_SYNC_FAULT_BRIDGE_PATH,templatePath=process.env.BOARD_SYNC_FAULT_TEMPLATE_PATH;
 let expectedSources:Record<string,string>|null=null;
 const names=['wsx-r08-owned-proxy-bridge.mjs','wsx-r08-fault-proxy.mjs','wsx-r08-proxy-policy.mjs'];
 const sourceProof=async()=>{
  if(!bridgePath||!expectedSources||Object.keys(expectedSources).sort().join(',')!==[...names].sort().join(','))throw new Error('Complete proxy source closure required');
  for(const name of names){const hash=expectedSources[name];if(!/^[a-f0-9]{64}$/.test(hash??'')||sha256(await readFile(join(dirname(bridgePath),name)))!==hash)throw new Error('Proxy source mismatch');}
 };
 const bindings:boolean[]=[];
 const control=async(command:string)=>{const response=await api.post(`${new URL(proxyUrl!).origin}/__board_fault/${command}`,{headers:{'x-board-fault-control':secret!}});expect(response.status()).toBe(200);};
 const cloud=async(page:Page,phase:'pending'|'synced'|'offline',name:string)=>{
  const status=page.getByTestId('board-sync-status');await expect(status).toHaveAttribute('data-sync-phase',phase);
  await expect(page.getByTestId('board-sync-banner')).toHaveCount(0); // testid-gate: absent Legacy sync feedback belongs in the header cloud; standalone banner was removed.
  if(phase==='pending'){await expect(status).not.toHaveAttribute('aria-label',/^已同步/);await expect(status.locator('svg')).toHaveClass(/lucide-loader-circle/);const animation=await status.locator('svg').evaluate(element=>{const style=getComputedStyle(element);return {name:style.animationName,state:style.animationPlayState,duration:style.animationDuration};});expect(animation.name).not.toBe('none');expect(animation.state).toBe('running');expect(parseFloat(animation.duration)).toBeGreaterThan(0);}
  const bounds=await status.locator('svg').boundingBox(),viewport=page.viewportSize()!;expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(viewport.width);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(64);
  const path=info.outputPath(`${name}-${viewport.width}.png`);await page.screenshot({path});
  await info.attach(`${name}-${viewport.width}`,{path,contentType:'image/png'});
 };
 const edit=async(page:Page,id:string,text:string)=>{const outline=page.getByTestId(`board-a11y-object-${id}`);await outline.focus();await outline.press('Enter');const editor=page.getByRole('textbox',{name:'对象文字',exact:true});await expect(editor).toBeVisible();await editor.fill(text);await editor.press('ControlOrMeta+Enter');await expect(editor).toHaveCount(0);};
 try{
  expectedSources=JSON.parse(process.env.BOARD_SYNC_FAULT_SOURCE_HASHES??'null') as Record<string,string>|null;
  if(!proxyUrl||!secret||secret.length<32||!bridgePath||!templatePath)throw new Error('Explicit private owned transport required');
  const url=new URL(proxyUrl);if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)throw new Error('Non-loopback proxy');
  await sourceProof();
  secondBrowser=await chromium.launch();peerContext=await secondBrowser.newContext({baseURL,viewport:owner.viewportSize()!});let peer=await peerContext.newPage();transport.observe(peer,'peer');
  for(const page of [owner,peer])page.on('websocket',socket=>{const observed=new URL(socket.url());if(observed.pathname===whiteboardSync.WHITEBOARD_SYNC.path.replace(':boardId',encodeURIComponent(boardId)))bindings.push(observed.protocol==='ws:'&&observed.hostname===url.hostname&&observed.port===url.port&&!observed.search&&!observed.hash&&!observed.username&&!observed.password);});
  stage='login-owner';ownerToken=await boardLogin(owner);privateSecrets.push(ownerToken);stage='login-peer';const peerToken=await boardLogin(peer,F.leadEmail,F.leadPassword);privateSecrets.push(peerToken);
  const identities=[];for(const token of [ownerToken,peerToken]){const response=await api.get(`${apiOrigin()}/kernel/probe/whoami`,{headers:{authorization:`Bearer ${token}`}});expect(response.status()).toBe(200);identities.push(await response.json());}
  expect(identities.map(identity=>identity.userId)).toEqual([F.userId,F.leadUserId]);expect(F.userId).not.toBe(F.leadUserId);expect(peerToken).not.toBe(ownerToken);
  stage='create-board';boardId=await createAcceptanceBoard(api,ownerToken,title);
  await boardApi(api,ownerToken,'PUT',`/whiteboards/${boardId}/members`,{userId:F.leadUserId,role:'editor'});
  stage='proxy-start';const bridge=await import(pathToFileURL(bridgePath).href);proxy=await bridge.prepareOwnedProxy({templatePath,boardId,userId:F.userId,title,tokens:[ownerToken,peerToken],participantUserIds:[F.userId,F.leadUserId]});
  const objectId=randomUUID(),initial=await boardHead(api,ownerToken,boardId);
  await boardApi(api,ownerToken,'POST',`/whiteboards/${boardId}/commands`,{requestId:randomUUID(),epoch:initial.epoch,commands:[{type:'create',object:{id:objectId,kind:'sticky',schemaVersion:1,geometry:{x:100,y:160,width:180,height:140,rotation:0},text:'Lifecycle baseline',style:{},parentId:null,orderKey:''}}]});
  for(const page of [owner,peer]){failureStage=page===owner?'INITIAL_ORIGIN_SYNC':'INITIAL_PEER_SYNC';await page.goto(`/studio/board/${boardId}`);await expectBoardSynced(page);}
  expect(await peer.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY)).toBe(peerToken);expect(peer.context()).not.toBe(owner.context());expect(secondBrowser).not.toBe(owner.context().browser());
  expect(bindings.length).toBeGreaterThanOrEqual(2);expect(bindings.every(Boolean)).toBe(true);
  runtimeBefore=await verifyRuntimeIdentity(api,sourceSha,await chunks());
  for(const gesture of ['drag','text','undo'] as const){
   failureStage=`${gesture.toUpperCase()}_READY`;await expectBoardSynced(owner);const before=await canonicalBoardSnapshot(api,ownerToken,boardId),metadataBefore=transport.snapshot().events.length;
   await owner.keyboard.press('Escape');await owner.getByTestId('board-tool-select').click();await owner.getByTestId('board-zoom-fit-board').click();
   if(gesture==='drag'){
    // Fit zoom is fractional; Chromium mouse coordinates are CSS-pixel quantized.
    // Use the real zoom UI to make a 40x24 CSS-pixel gesture exactly 40x24 world units.
    await owner.getByTestId('board-zoom-menu').click();
    await owner.getByRole('menuitem',{name:'实际大小 100%',exact:true}).click();
    await expect(owner.getByTestId('board-fabric-surface')).toHaveAttribute('data-viewport-zoom','1');
    await settled(owner);
    // Zoom preserves pan: a fitted pan can leave the note offscreen at 100%.
    // Recenter through the actual Hand gesture before the measured write gesture.
    const surface=owner.getByTestId('board-fabric-surface');
    const pan=await surface.evaluate(el=>{
     const r=el.getBoundingClientRect(),px=Number(el.getAttribute('data-viewport-pan-x')),py=Number(el.getAttribute('data-viewport-pan-y'));
     const start={x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};
     // Independent seeded world center (190,230); keep release away from edge pan.
     return {start,dx:Math.round(r.width/2-px-190),dy:Math.round(r.height/2-py-230)};
    });
    await owner.getByTestId('board-tool-hand').click();
    expect(await owner.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS',pan.start)).toBe(true);
    await owner.mouse.move(pan.start.x,pan.start.y);await owner.mouse.down();
    await owner.mouse.move(pan.start.x+pan.dx,pan.start.y+pan.dy,{steps:12});await owner.mouse.up();
    await owner.getByTestId('board-tool-select').click();await settled(owner);
    await expect(surface).toHaveAttribute('data-viewport-zoom','1');

   }
   const point=gesture==='drag'?await objectPoint(owner,objectId):null;
   if(point){
    expect(point.zoom).toBe(1);point.x=Math.round(point.x);point.y=Math.round(point.y);
    expect(await owner.evaluate(p=>document.elementFromPoint(p.x,p.y)?.tagName==='CANVAS',point)).toBe(true);
   }
   failureStage=`${gesture.toUpperCase()}_HOLD`;await control('hold-writes');
   if(gesture==='drag'){await owner.mouse.move(point!.x,point!.y);await owner.mouse.down();await owner.mouse.move(point!.x+40*point!.zoom,point!.y+24*point!.zoom,{steps:12});await owner.mouse.up();}
   else if(gesture==='text')await edit(owner,objectId,'Acknowledged text');
   else {
    failureStage='UNDO_UI';
    if((owner.viewportSize()?.width??1440)<640){await owner.getByTestId('board-fabric-surface').focus();await owner.keyboard.press('ControlOrMeta+z');}
    else await owner.getByRole('button',{name:'撤销',exact:true}).click();
   }
   failureStage=`${gesture.toUpperCase()}_PENDING`;await cloud(owner,'pending',`${gesture}-pending`);expect(await canonicalBoardSnapshot(api,ownerToken,boardId)).toEqual(before);
   await expect.poll(()=>durableIds(owner,boardId)).not.toEqual([]);const receipts=await durableIds(owner,boardId);
   expect(transport.snapshot().events.slice(metadataBefore).filter(event=>event.client==='original'&&event.direction==='received'&&event.type==='ack')).toHaveLength(0);
   const expected=await canonicalRows(owner);expect(expected).not.toEqual(await canonicalRows(peer));
   failureStage=`${gesture.toUpperCase()}_ACK`;await control('release-writes');await expectBoardSynced(owner);await expectBoardSynced(peer);await expect.poll(()=>canonicalRows(peer)).toEqual(expected);
   const after=await canonicalBoardSnapshot(api,ownerToken,boardId);expect(after.revision.seq).toBeGreaterThan(before.revision.seq);
   const acks=transport.snapshot().events.slice(metadataBefore).filter(event=>event.client==='original'&&event.direction==='received'&&event.type==='ack');expect(acks.length).toBeGreaterThan(0);expect(new Set(acks.map(event=>event.updateId)).size).toBe(acks.length);
   expect(acks.map(event=>event.updateId).sort()).toEqual(receipts);expect(after.revision).toEqual({epoch:before.revision.epoch,seq:before.revision.seq+acks.length});
   expect(after.objects).toEqual(before.objects.map(object=>object.id!==objectId?object:gesture==='drag'?{...object,geometry:{...object.geometry,x:object.geometry.x+40,y:object.geometry.y+24}}:{...object,text:gesture==='text'?'Acknowledged text':'Lifecycle baseline'}));
   await expect.poll(()=>durableIds(owner,boardId)).toEqual([]);
   await cloud(owner,'synced',`${gesture}-acked`);observations.push({gesture,before:before.revision,after:after.revision,acks:acks.map(event=>event.updateId)});
  }
  failureStage='PEER_OFFLINE';const offlineBefore=await canonicalBoardSnapshot(api,ownerToken,boardId);await peerContext.setOffline(true);await cloud(peer,'offline','independent-peer-offline');
  const retry=peer.getByTestId('board-retry-sync');await expect(retry).toBeVisible();const retryBounds=await retry.boundingBox();expect(retryBounds).not.toBeNull();expect(retryBounds!.x).toBeGreaterThanOrEqual(0);expect(retryBounds!.x+retryBounds!.width).toBeLessThanOrEqual(peer.viewportSize()!.width);
  await retry.click();await expect(peer.getByTestId('board-sync-status')).toHaveAttribute('data-sync-phase','offline');await expect(peer.getByTestId('board-sync-status')).not.toHaveAttribute('aria-label',/^已同步/);expect(await canonicalBoardSnapshot(api,ownerToken,boardId)).toEqual(offlineBefore);
  await edit(peer,objectId,'Independent offline text');await expect.poll(()=>durableIds(peer,boardId)).not.toEqual([]);expect(await canonicalBoardSnapshot(api,ownerToken,boardId)).toEqual(offlineBefore);
  failureStage='PEER_RECOVERY';await peerContext.setOffline(false);await expectBoardSynced(peer,45_000);await expect.poll(()=>canonicalRows(owner),{timeout:45_000}).toEqual(await canonicalRows(peer));
  const recovered=await canonicalBoardSnapshot(api,ownerToken,boardId);expect(recovered.objects).toEqual(offlineBefore.objects.map(object=>object.id===objectId?{...object,text:'Independent offline text'}:object));await expect.poll(()=>durableIds(peer,boardId)).toEqual([]);await peer.reload();await expectBoardSynced(peer);expect(await canonicalBoardSnapshot(api,ownerToken,boardId)).toEqual(recovered);await cloud(peer,'synced','independent-peer-refreshed');
  const revokedEvents=transport.snapshot().events.length;
  failureStage='VIEWER_UNMOUNT';await boardApi(api,ownerToken,'PUT',`/whiteboards/${boardId}/members`,{userId:F.leadUserId,role:'viewer'});
  // Live role revocation intentionally clears and unmounts the old document.
  await expect(peer.getByTestId('denied')).toBeVisible();
  await expect(peer.getByTestId('board-fabric-surface')).toHaveCount(0);
  const viewerResponse=await boardApi(api,peerToken,'GET',`/whiteboards/${boardId}`);
  expect((await viewerResponse.json()).role).toBe('viewer');
  const viewerHead=await boardHead(api,peerToken,boardId);
  const rejectedWrite=await api.post(`${apiOrigin()}/whiteboards/${boardId}/commands`,{headers:{authorization:`Bearer ${peerToken}`},data:{requestId:randomUUID(),epoch:viewerHead.epoch,commands:[{type:'delete',id:objectId}]}});
  expect(rejectedWrite.status()).toBe(403);expect(await boardHead(api,ownerToken,boardId)).toEqual(viewerHead);
  await expect.poll(()=>durableIds(peer,boardId)).toEqual([]);
  expect(transport.snapshot().events.slice(revokedEvents).filter(event=>event.client==='peer'&&event.direction==='sent'&&event.type==='update')).toHaveLength(0);
  // A fresh actual viewer session has no revoked outbox from the former editor.
  failureStage='VIEWER_REAUTH';await peerContext.close();
  peerContext=await secondBrowser.newContext({baseURL,viewport:owner.viewportSize()!});peer=await peerContext.newPage();
  const viewerTransport=createSpatialWsMetadataRecorder();viewerTransport.observe(peer,'peer');
  const viewerChunks=observeRuntimeChunks(peer);
  const viewerLogin=await captureBoardLogin(peer,()=>boardLogin(peer,F.leadEmail,F.leadPassword));
  expect(viewerLogin.posts).toBe(1);expect(viewerLogin.status).toBe(200);expect((viewerLogin.body as {userId:string}).userId).toBe(F.leadUserId);
  const viewerToken=viewerLogin.token;privateSecrets.push(viewerToken);
  expect(viewerToken).not.toBe(peerToken);expect((await (await boardApi(api,viewerToken,'GET',`/whiteboards/${boardId}`)).json()).role).toBe('viewer');
  await peer.goto(`/studio/board/${boardId}`);await expectBoardSynced(peer,30_000,true);
  await expect(peer.getByTestId('board-add-sticky')).toBeDisabled();
  observations.push({phase:'viewer-runtime-before',...await verifyRuntimeIdentity(api,sourceSha,await viewerChunks())});

  const readonlyBefore=await canonicalBoardSnapshot(api,ownerToken,boardId),readonlyEvents=viewerTransport.snapshot().events.length;
  const viewerOutline=peer.getByTestId(`board-a11y-object-${objectId}`);await viewerOutline.focus();await viewerOutline.press('Enter');await expect(viewerOutline).toHaveAttribute('aria-pressed','true');await expect(peer.getByRole('textbox',{name:'对象文字',exact:true})).toHaveCount(0);
  const readonlyPoint=await objectPoint(peer,objectId);await peer.mouse.move(readonlyPoint.x,readonlyPoint.y);await peer.mouse.down();await peer.mouse.move(readonlyPoint.x+20*readonlyPoint.zoom,readonlyPoint.y+20*readonlyPoint.zoom,{steps:8});await peer.mouse.up();await peer.mouse.dblclick(readonlyPoint.x,readonlyPoint.y);await expect(peer.getByRole('textbox',{name:'对象文字',exact:true})).toHaveCount(0);
  // Viewer Fabric objects are intentionally non-selectable/evented. Pointer
  // attempts can clear outline selection; prove no write, then explicitly select
  // through the actual accessible outline before exercising destructive keys.
  expect(await canonicalBoardSnapshot(api,ownerToken,boardId)).toEqual(readonlyBefore);
  expect(viewerTransport.snapshot().events.slice(readonlyEvents).filter(event=>event.client==='peer'&&event.direction==='sent'&&event.type==='update')).toHaveLength(0);
  await viewerOutline.focus();await viewerOutline.press('Enter');
  await expect(viewerOutline).toHaveAttribute('aria-pressed','true');await peer.keyboard.press('Delete');await peer.keyboard.press('ControlOrMeta+z');await peer.keyboard.press('n');
  const peerSocket=viewerTransport.snapshot().events.filter(event=>event.client==='peer'&&event.direction==='open').at(-1)?.socketId;expect(typeof peerSocket).toBe('number');
  // Navigate through the real SPA Back action: keep this renderer/CDP target
  // alive so the native WebSocket close from provider cleanup remains observable.
  await peer.getByRole('button',{name:'返回白板',exact:true}).click();
  await expect(peer).toHaveURL(/\/studio\/board(?:\?.*)?$/);
  await expect(peer.getByTestId('collaborative-editor')).toHaveCount(0);
  await expect.poll(()=>viewerTransport.snapshot().events.slice(readonlyEvents).some(event=>event.client==='peer'&&event.direction==='close'&&event.socketId===peerSocket)).toBe(true);
  // A real quiet interval catches detached timers; no mocked provider is involved.
  await peer.waitForTimeout(1500);expect(await canonicalBoardSnapshot(api,ownerToken,boardId)).toEqual(readonlyBefore);
  expect(viewerTransport.snapshot().events.slice(readonlyEvents).filter(event=>event.client==='peer'&&event.direction==='sent'&&event.type==='update')).toHaveLength(0);
  expect(bindings.every(Boolean)).toBe(true);observations.push({phase:'readonly-unmount',lateUpdates:0,before:readonlyBefore.revision,after:(await boardHead(api,ownerToken,boardId))});
  expect(viewerTransport.snapshot().dropped).toBe(0);observations.push({phase:'viewer-transport',client:'viewer',...viewerTransport.snapshot()});
  observations.push({phase:'viewer-runtime-after',...await verifyRuntimeIdentity(api,sourceSha,await viewerChunks())});
  expect(transport.snapshot().events.slice(revokedEvents).filter(event=>event.client==='peer'&&event.direction==='sent'&&event.type==='update')).toHaveLength(0);
  failureStage='OWNER_UNMOUNT';
  // Populate the real client-router cache through the user's navigation path.
  // A full page.goto while offline cannot load a new HTML document.
  await owner.getByRole('button',{name:'返回白板',exact:true}).click();
  await expect(owner).toHaveURL(/\/studio\/board(?:\?.*)?$/);
  await expect(owner.getByTestId(`board-open-${boardId}`)).toBeVisible();
  await owner.getByTestId(`board-open-${boardId}`).click();await expectBoardSynced(owner);
  const unmountBefore=await canonicalBoardSnapshot(api,ownerToken,boardId);await owner.context().setOffline(true);await cloud(owner,'offline','owner-before-unmount');
  await edit(owner,objectId,'Unsubmitted detached editor');const unmountEvents=transport.snapshot().events.length;
  expect(await owner.evaluate(()=>navigator.onLine)).toBe(false);
  await owner.getByRole('button',{name:'返回白板',exact:true}).click();
  await expect(owner).toHaveURL(/\/studio\/board(?:\?.*)?$/);
  await expect(owner.getByTestId('collaborative-editor')).toHaveCount(0);
  await expect(owner.getByTestId('whiteboard-library')).toBeVisible();
  expect(await owner.evaluate(()=>navigator.onLine)).toBe(false);
  await owner.context().setOffline(false);
  await owner.waitForTimeout(1500);expect(await canonicalBoardSnapshot(api,ownerToken,boardId)).toEqual(unmountBefore);
  expect(transport.snapshot().events.slice(unmountEvents).filter(event=>event.client==='original'&&event.direction==='open')).toHaveLength(0);
  expect(transport.snapshot().events.slice(unmountEvents).filter(event=>event.client==='original'&&event.direction==='sent'&&event.type==='update')).toHaveLength(0);
  expect(transport.snapshot().dropped).toBe(0);observations.push({phase:'editable-offline-unmount',lateUpdates:0,before:unmountBefore.revision,after:await boardHead(api,ownerToken,boardId)});
 }catch(error){failureCaptured=true;failure=error;}
 finally{
  // Fixed stage only: no browser query, raw error, URL or object identifiers.
  let stageTimer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([info.attach('sync-lifecycle-failure-stage',{body:Buffer.from(JSON.stringify({schemaVersion:1,sourceHead:sourceSha,failureCaptured,stage:failureStage})),contentType:'application/json'}),new Promise<never>((_,reject)=>{stageTimer=setTimeout(()=>reject(new Error('SYNC_STAGE_ATTACHMENT_TIMEOUT')),500);})]);}catch(error){errors.push(error);}finally{if(stageTimer)clearTimeout(stageTimer);}
  try{if(proxy)await control('restore');}catch(error){errors.push(error);}
  try{await owner.context().setOffline(false);}catch(error){errors.push(error);}
  try{if(peerContext)await peerContext.setOffline(false);}catch(error){errors.push(error);}
  try{if(peerContext)await peerContext.close();}catch(error){errors.push(error);}
  try{if(secondBrowser)await secondBrowser.close();}catch(error){errors.push(error);}
  if(boardId&&ownerToken)try{const owned=await (await boardApi(api,ownerToken,'GET',`/whiteboards/${boardId}`)).json();expect(owned.id).toBe(boardId);expect(owned.ownerId).toBe(F.userId);expect(owned.name).toBe(title);cleanupPending=true;observations.push({phase:'preserve-owned-cleanup',boardId,title,ownerId:owned.ownerId,cleanupPending:true});}catch(error){errors.push(error);}
  try{if(proxy)await proxy.dispose();}catch(error){errors.push(error);}
  try{await sourceProof();}catch(error){errors.push(error);}
  let runtimeAfter:Awaited<ReturnType<typeof verifyRuntimeIdentity>>|undefined;
  if(runtimeBefore)try{runtimeAfter=await verifyRuntimeIdentity(api,sourceSha,runtimeBefore.chunks);}catch(error){errors.push(error);}
  try{await writeFile(info.outputPath('sync-lifecycle-result.json'),JSON.stringify({sourceSha,stage,primaryFailure:primaryFailure(failure,privateSecrets),secondaryErrors:errors.map(error=>primaryFailure(error,privateSecrets)),status:failureCaptured||errors.length?'failed':'functional-cases-passed',completed:false,runtimeBefore:runtimeBefore??null,runtimeAfter:runtimeAfter??null,observations,cleanupPending,independentBrowserProcesses:Boolean(runtimeBefore),independentUsers:Boolean(runtimeBefore),approved:false},null,2),{mode:0o600});}catch(error){errors.push(error);}
 }
 if(failureCaptured||errors.length)throw new AggregateError([...(failureCaptured?[failure]:[]),...errors],'SYNC_LIFECYCLE_OR_CLEANUP_FAILED');
});
