import {createHash,randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {expectBoardSynced} from './support/board-sync-status';
import {CreateBoard} from '@repo/contracts/whiteboard';
import {WHITEBOARD_SYNC} from '@repo/contracts/whiteboard-sync';
import {chromium,expect,test as baseTest,type Page,type CDPSession} from '@playwright/test';
import {createOwnedLifecycleBrowser} from './support/board-owned-lifecycle-browser.mjs';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {SESSION_TOKEN_STORAGE_KEY} from '../lib/api-client';
import {createSpatialWsMetadataRecorder,spatialFrameMetadata,installNativeSocketCloseObserver} from './support/board-spatial-ws-metadata';
import {sharedOutboxProof} from './support/board-shared-outbox-proof';

// Ordinary Playwright pages enable focus emulation and remain visibly captured
// when minimized. Own only this test's browser/default context so native hide
// and JS suspension are genuine, while both tabs still share the same durable storage.
const TEST_BUDGET_MS=180_000;
const test=baseTest.extend<{ownedBrowser:Awaited<ReturnType<typeof createOwnedLifecycleBrowser>>}>({
 ownedBrowser:async({},use,info)=>{
  const owned=await createOwnedLifecycleBrowser(chromium,{testBudgetMs:TEST_BUDGET_MS,teardownBudgetMs:10_000,chromiumSandbox:info.project.use.launchOptions?.chromiumSandbox});let primary:unknown,failed=false;
  try{await use(owned);}catch(error){failed=true;primary=error;throw error;}
  finally{try{await owned.close();}catch{const cleanup=new Error('OWNED_BROWSER_CLEANUP_FAILED');throw failed?new AggregateError([primary,cleanup],'PRIMARY_AND_OWNED_BROWSER_CLEANUP_FAILED'):cleanup;}}
 },
});

// Separate from independent-browser collaboration: these tabs deliberately share IDB.
// Eight real UI sticky creates + 16 UI text edits. 45s is a bounded drain SLA (~1.8s per unique
// write, including fresh sync and duplicate receipt replay), not a retry-until-green.
const DRAIN_SLA_MS=45_000;
test('same-browser tabs drain a shared durable outbox without duplicate commits',async({request,ownedBrowser},info)=>{
 // Keep the suite-level 180s budget so fixture setup and cleanup cannot consume
 // the dedicated 45s drain SLA and then close the API context before archiving.
 test.setTimeout(TEST_BUDGET_MS);
 const api=process.env.WHITEBOARD_API_URL??`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`;
 if(!process.env.WHITEBOARD_API_URL&&!process.env.WORKSPACEX_API_PORT)throw new Error('Isolated API URL required');
 if(!info.project.use.baseURL)throw new Error('Isolated web URL required');
 const page=ownedBrowser.page;
 const boardUrl=(path:string)=>new URL(path,info.project.use.baseURL).href;
 page.setDefaultTimeout(15_000);
 page.setDefaultNavigationTimeout(15_000);
 const metadata=createSpatialWsMetadataRecorder();metadata.observe(page,'original','route-upstream');
 const receiptMarker=process.env.BOARD_ACCEPTANCE_RUNTIME_MARKER;
 if(!receiptMarker||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(receiptMarker))throw new Error('PROVIDER_RECEIPT_BUILD_MARKER_REQUIRED');
 const receiptBinding='boardProviderReceipt'+receiptMarker.replaceAll('-','');
 const observeProviderReceipts=async(tab:Page,client:'original'|'peer')=>{
  await tab.exposeBinding(receiptBinding,(source,value)=>{if(source.page===tab&&source.frame===tab.mainFrame())metadata.providerReceipt(client,value,receiptMarker);});
 };
 await observeProviderReceipts(page,'original');

 const socketBinding=`boardSocketClose${randomUUID().replaceAll('-','')}`,socketStateKey=socketBinding+'State';
 await page.exposeBinding(socketBinding,(_source,value)=>metadata.nativeClose('original',value,'route-upstream'));
 await page.addInitScript(installNativeSocketCloseObserver,{binding:socketBinding,stateKey:socketStateKey});
 const socketSession=await page.context().newCDPSession(page),stopSocketObservation=metadata.observeCdp(socketSession,'original','route-upstream');
 await socketSession.send('Network.enable');
 let nextRouteSocketOrdinal=0;

 const chunks:Array<{path:string;sha256:string;bytes:number}>=[],chunkReads:Array<Promise<void>>=[];
 page.on('response',response=>{const path=new URL(response.url()).pathname;if(path.startsWith('/_next/static/')&&path.endsWith('.js')&&response.status()===200)chunkReads.push(response.body().then(body=>{chunks.push({path,sha256:createHash('sha256').update(body).digest('hex'),bytes:body.length});}).catch(()=>undefined));});
 const http:Array<{method:string;path:string;status:number}>=[];
 const milestones:Array<{name:string;elapsedMs:number}>=[];
 const mark=(name:string)=>milestones.push({name,elapsedMs:Math.round(metadata.elapsedMs())});
 let token='',boardId='',archived=false,peer:Page|undefined;const evidence:Record<string,unknown>={drainSlaMs:DRAIN_SLA_MS,http,milestones};
 let ownerLifecycle:CDPSession|undefined,ownerPaused=false,primaryFailed=false;
 let primaryFailure:unknown;
 let ownerWindow:{windowId:number;bounds:{left?:number;top?:number;width?:number;height?:number;windowState:'normal'|'minimized'|'maximized'|'fullscreen'}}|undefined,ownerWindowChanged=false,ownerHiddenObserved=false;
 let nativeVisibility:{state?:string;trustedChanges?:number;untrustedChanges?:number;sameDocument?:number}|undefined;
 let lifecycleReady=0,nativeCountsCaptured=false;
 const captureNativeCounts=async()=>{
  if(!ownerLifecycle)throw new Error("OWNED_LIFECYCLE_SESSION_MISSING");
  const observed=await ownerLifecycle.send("Runtime.evaluate",{expression:`globalThis[${JSON.stringify(lifecycleBinding+"Counts")}]`,returnByValue:true});
  expect(observed.exceptionDetails,"Owned native lifecycle counts must be readable").toBeUndefined();
  const counts=observed.result.value as Record<string,unknown>|undefined;
  expect(counts,"Owned native lifecycle counts must exist").toBeDefined();
  for(const key of ["freeze","resume","untrusted"]){expect(typeof counts?.[key]).toBe("number");expect(Number.isSafeInteger(counts?.[key])).toBe(true);expect(counts?.[key]).toBeGreaterThanOrEqual(0);}
  evidence.ownerNativeLifecycleCounts={freeze:counts!.freeze,resume:counts!.resume,untrusted:counts!.untrusted};nativeCountsCaptured=true;
 };
 const lifecycleBinding=`boardOutboxLifecycle${randomUUID().replaceAll('-','')}`;
 const lifecycleEvents={freeze:0,resume:0};
 const debuggerEvents={paused:0,resumed:0};
 const onDebuggerPaused=()=>{debuggerEvents.paused++;mark('debugger-paused-observed');};
 const onDebuggerResumed=()=>{debuggerEvents.resumed++;mark('debugger-resumed-observed');};
 const recordVisibility=(stage:'before-pause'|'native-visibilitychange'|'after-resume',value:{state?:string;trustedChanges?:number;untrustedChanges?:number;sameDocument?:number}|undefined)=>{
  if(!value||!['visible','hidden'].includes(value.state??'')||![0,1].includes(value.sameDocument??-1))return;
  if(!['trustedChanges','untrustedChanges'].every(key=>{const n=value[key as 'trustedChanges'|'untrustedChanges'];return Number.isSafeInteger(n)&&n!>=0&&n!<=1_000_000;}))return;
  nativeVisibility=value;
  if(value.state==='hidden'&&value.sameDocument===1&&(value.trustedChanges??0)>0)ownerHiddenObserved=true;
  const safe={elapsedMs:Math.round(metadata.elapsedMs()),stage,state:value.state,trustedChanges:value.trustedChanges,untrustedChanges:value.untrustedChanges,sameDocument:value.sameDocument};
  console.info('OWNED_LIFECYCLE_VISIBILITY',JSON.stringify(safe));
  const samples=(evidence.ownerVisibilitySamples??=[]) as unknown[];samples.push(safe);
 };
 const captureVisibility=async(stage:'before-pause'|'after-resume')=>{
  if(!ownerLifecycle)throw new Error('OWNED_LIFECYCLE_SESSION_MISSING');
  const sample=await ownerLifecycle.send('Runtime.evaluate',{expression:`(()=>{const observed=globalThis[${JSON.stringify(lifecycleBinding+'Visibility')}];return {state:document.visibilityState,trustedChanges:observed?.trustedChanges,untrustedChanges:observed?.untrustedChanges,sameDocument:observed?.document===document?1:0};})()`,returnByValue:true});
  expect(sample.exceptionDetails,'Owned visibility sample must be readable').toBeUndefined();
  const value=sample.result.value as {state?:string;trustedChanges?:number;untrustedChanges?:number;sameDocument?:number}|undefined;
  expect(['visible','hidden']).toContain(value?.state);
  for(const key of ['trustedChanges','untrustedChanges'] as const){expect(Number.isSafeInteger(value?.[key])).toBe(true);expect(value?.[key]).toBeGreaterThanOrEqual(0);expect(value?.[key]).toBeLessThanOrEqual(1_000_000);}
  expect([0,1]).toContain(value?.sameDocument);
  recordVisibility(stage,value);
  expect(value!.sameDocument,'Lifecycle observation must remain on the original document').toBe(1);
 };

 const restoreOwnerWindow=async(timeout:number)=>{
  if(!ownerWindowChanged)return;
  if(!ownerLifecycle||!ownerWindow)throw new Error('OWNED_WINDOW_IDENTITY_MISSING');
  await ownerLifecycle.send('Browser.setWindowBounds',{windowId:ownerWindow.windowId,bounds:{windowState:'normal'}});
  const {left,top,width,height,windowState}=ownerWindow.bounds;
  await ownerLifecycle.send('Browser.setWindowBounds',{windowId:ownerWindow.windowId,bounds:{left,top,width,height}});
  if(windowState!=='normal')await ownerLifecycle.send('Browser.setWindowBounds',{windowId:ownerWindow.windowId,bounds:{windowState}});
  expect((await ownerLifecycle.send('Browser.getWindowBounds',{windowId:ownerWindow.windowId})).bounds).toEqual(ownerWindow.bounds);
  if(!ownerHiddenObserved&&!ownerPaused)await captureVisibility('after-resume');
  await expect.poll(()=>nativeVisibility?.state==='visible'&&nativeVisibility.sameDocument===1&&(!ownerHiddenObserved||(nativeVisibility.trustedChanges??0)>=2),{timeout,message:'Owned window must restore genuine visible lifecycle on the original document'}).toBe(true);
  ownerWindowChanged=false;
 };

 const ackGate:{routeSocketOrdinal:number|null;releaseAlive:null;updateId:string|null;release:(()=>void)|null;heldAt:number|null;releasedAt:number|null}={routeSocketOrdinal:null,releaseAlive:null,updateId:null,release:null,heldAt:null,releasedAt:null};
 const call=async(method:string,path:string,data?:unknown)=>{const safePath=new URL(path,'http://diagnostic.invalid').pathname,index=http.push({method,path:safePath,status:0})-1;const response=await request.fetch(`${api}${path}`,{method,data,timeout:15_000,headers:{Authorization:`Bearer ${token}`}});const status=response.status();http[index]!.status=status;
  // Record only routing metadata, never credentials, request/response bodies or query strings.
  expect(response.ok(),`Board fixture HTTP ${method} ${safePath}: ${status}`).toBe(true);return response.json();};
 const objectRows=(tab:Page)=>tab.locator('[data-testid="board-a11y-mirror"] li[data-object-id]');
 const rows=(tab:Page)=>objectRows(tab).evaluateAll(elements=>elements.map(element=>{const item=element as HTMLElement;return{id:item.dataset.objectId,kind:item.dataset.objectKind,geometry:item.dataset.geometry,parentId:item.dataset.parentId,zIndex:item.dataset.zIndex,text:item.querySelector('button')?.textContent};}).sort((a,b)=>String(a.id).localeCompare(String(b.id))));
 try{
  if(info.project.use.viewport)await page.setViewportSize(info.project.use.viewport);
  await page.goto(boardUrl('/login'));await page.getByTestId('login-email').fill(F.adminEmail);await page.getByTestId('login-password').fill(F.adminPassword);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/home$/);mark('authenticated');
  token=(await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY))!;
  const board=await call('POST','/whiteboards',CreateBoard.parse({requestId:randomUUID(),name:'Same-browser durable outbox'}));boardId=board.id;mark('board-created');
  // Keep one real server receipt unacknowledged in the original tab. The
  // original target is later debugger-paused so its lease-renewal timer stops;
  // the unmodified durable claim must expire before the peer replays that ID.
  // Every other frame is forwarded unchanged to the actual API.
  await page.routeWebSocket(url=>url.pathname===WHITEBOARD_SYNC.path.replace(':boardId',encodeURIComponent(boardId)),socket=>{
   const socketOrdinal=++nextRouteSocketOrdinal;const server=socket.connectToServer();
   socket.onMessage(message=>server.send(message));
   server.onMessage(message=>{
    const frame=spatialFrameMetadata(message);
    if(frame.type==='ack'&&frame.updateId&&ackGate.updateId===null){
     ackGate.routeSocketOrdinal=socketOrdinal;ackGate.updateId=frame.updateId;ackGate.heldAt=performance.now();
     ackGate.release=()=>{ackGate.release=null;ackGate.releasedAt=performance.now();socket.send(message);};
    }else socket.send(message);
   });
  });
  await page.goto(boardUrl(`/studio/board/${boardId}`));await expectBoardSynced(page);mark('board-opened');
  const initial=await call('POST',`/whiteboards/${boardId}/checkpoints`,{requestId:randomUUID()});expect(initial.manifest.seq).toBe(0);mark('initial-checkpoint');
  const surface=page.getByTestId('board-fabric-surface');
  await surface.hover();await page.keyboard.down('ControlOrMeta');try{await page.mouse.wheel(0,100_000);}finally{await page.keyboard.up('ControlOrMeta');}await expect(page.getByTestId('board-zoom-value')).toHaveText('5%');
  const createdIds:string[]=[];
  for(let index=0;index<8;index++){
   await page.getByTestId('board-tool-select').click();
   await page.keyboard.press('n');
   await surface.click({position:{x:120+(index%4)*80,y:100+Math.floor(index/4)*80}});
   await expect(objectRows(page),`Sticky gesture ${index+1} must create exactly one object`).toHaveCount(index+1);
   const created=await rows(page);expect(created).toHaveLength(index+1);expect(created.every(row=>row.kind==='sticky')).toBe(true);
   const ids=created.map(row=>row.id);expect(new Set(ids).size).toBe(index+1);expect(ids).toEqual(expect.arrayContaining(createdIds));createdIds.splice(0,createdIds.length,...ids.filter((id):id is string=>Boolean(id)));
  }
  await page.keyboard.press('Escape');
  await expect(objectRows(page)).toHaveCount(8);mark('stickies-created');
  for(const id of createdIds){
   for(const suffix of ['queued','shared-tab-proof']){
    const outline=page.getByTestId(`board-a11y-object-${id}`);await outline.focus();await outline.press('Enter');
    const title=page.getByRole('textbox',{name:'对象文字',exact:true});
    await title.fill(`Sticky ${id} ${suffix}`);await title.press('ControlOrMeta+Enter');
    await expect(title).toHaveCount(0);
    await expect(outline.locator('..')).toHaveAttribute('data-object-text',`Sticky ${id} ${suffix}`);
   }
  }
  const pending=page.getByTestId('board-sync-status');await expect(pending).toHaveAttribute('aria-label',/^\d+ 项修改等待服务器确认$/);evidence.pendingBeforePeer=await pending.getAttribute('aria-label');
  mark('local-updates-queued');
  const expected=await rows(page);expect(expected).toHaveLength(8);expect(expected.every(row=>row.kind==='sticky')).toBe(true);expect(expected.map(row=>row.id)).toEqual([...createdIds].sort());expect(expected.every(row=>row.text?.includes('shared-tab-proof'))).toBe(true);
  const started=performance.now(),deadline=started+DRAIN_SLA_MS;
  const remaining=()=>Math.max(1,deadline-performance.now());
  // A suspended original tab cannot renew its in-flight claim. Keep its actual
  // server ACK held, without editing durable records or shortening the lease.
  await expect.poll(()=>ackGate.updateId!==null&&ackGate.release!==null,{timeout:remaining(),message:'Actual contract route must capture one real server ACK'}).toBe(true);
  evidence.ackGate={updateId:ackGate.updateId,held:true,routeSocketOrdinal:ackGate.routeSocketOrdinal,releaseAlive:null};
  ownerLifecycle=await page.context().newCDPSession(page);
  ownerLifecycle.on('Debugger.paused',onDebuggerPaused);ownerLifecycle.on('Debugger.resumed',onDebuggerResumed);
  await ownerLifecycle.send('Debugger.enable');
  await ownerLifecycle.send('Runtime.enable');
  await ownerLifecycle.send('Runtime.addBinding',{name:lifecycleBinding});
  ownerLifecycle.on('Runtime.bindingCalled',event=>{
   if(event.name!==lifecycleBinding)return;
   try{const observed=JSON.parse(event.payload) as {type?:string;trusted?:boolean;state?:string;trustedChanges?:number;untrustedChanges?:number;sameDocument?:number};
    if(observed.type==='visibilitychange'){recordVisibility('native-visibilitychange',observed);return;}
    if(observed.type==='ready'){lifecycleReady++;return;}
    if(observed.trusted===true&&(observed.type==='freeze'||observed.type==='resume')){lifecycleEvents[observed.type]++;mark(`native-${observed.type}-observed`);}
   }catch{/* Unknown payload is never lifecycle proof. */}
  });
  const installedLifecycle=await ownerLifecycle.send('Runtime.evaluate',{expression:`globalThis[${JSON.stringify(lifecycleBinding+'Counts')}] = {freeze:0,resume:0,untrusted:0};globalThis[${JSON.stringify(lifecycleBinding+'Visibility')}]={document,trustedChanges:0,untrustedChanges:0};globalThis[${JSON.stringify(lifecycleBinding+'Handlers')}] = Object.fromEntries(['freeze','resume','visibilitychange'].map(type=>{const notify=globalThis[${JSON.stringify(lifecycleBinding)}];const listener=event=>{const counts=globalThis[${JSON.stringify(lifecycleBinding+'Counts')}];if(type==='visibilitychange'){const visibility=globalThis[${JSON.stringify(lifecycleBinding+'Visibility')}];if(event.isTrusted)visibility.trustedChanges++;else visibility.untrustedChanges++;notify(JSON.stringify({type:'visibilitychange',state:document.visibilityState,trustedChanges:visibility.trustedChanges,untrustedChanges:visibility.untrustedChanges,sameDocument:visibility.document===document?1:0}));return;}if(event.isTrusted)counts[event.type]++;else counts.untrusted++;notify(JSON.stringify({type:event.type,trusted:event.isTrusted}));};document.addEventListener(type,listener);return [type,listener];}));globalThis[${JSON.stringify(lifecycleBinding)}](JSON.stringify({type:'ready'}));`});
  expect(installedLifecycle.exceptionDetails,'Owned lifecycle observers must actually install').toBeUndefined();
  await expect.poll(()=>lifecycleReady,{timeout:remaining(),message:'Owned lifecycle binding must prove readiness before pausing'}).toBe(1);
  evidence.lifecycleObserverReady=lifecycleReady;
  // Pause original JS without triggering Chromium's freeze-induced socket failure.
  // Same-renderer peer execution is still required below; inability to execute fails.
  await captureVisibility('before-pause');
  expect(nativeVisibility?.state,'Owned window must initially be visible').toBe('visible');
  const observedWindow=await ownerLifecycle.send('Browser.getWindowForTarget');
  const originalState=observedWindow.bounds.windowState;
  if(originalState!=='normal'&&originalState!=='maximized'&&originalState!=='fullscreen')throw new Error('OWNED_WINDOW_STATE_UNSUPPORTED');
  ownerWindow={windowId:observedWindow.windowId,bounds:{...observedWindow.bounds,windowState:originalState}};
  expect(Number.isSafeInteger(ownerWindow.windowId)).toBe(true);
  expect(['normal','maximized','fullscreen']).toContain(ownerWindow.bounds.windowState);
  for(const key of ['left','top','width','height'] as const)expect(Number.isFinite(ownerWindow.bounds[key])).toBe(true);
  // Chromium 151 headless owns one window per target. Minimize through the
  // browser, then require its trusted hidden transition before JS suspension.
  ownerWindowChanged=true;
  if(ownerWindow.bounds.windowState==='fullscreen')await ownerLifecycle.send('Browser.setWindowBounds',{windowId:ownerWindow.windowId,bounds:{windowState:'normal'}});
  mark('minimize-requested');
  await ownerLifecycle.send('Browser.setWindowBounds',{windowId:ownerWindow.windowId,bounds:{windowState:'minimized'}});mark('minimize-completed');
  expect((await ownerLifecycle.send('Browser.getWindowBounds',{windowId:ownerWindow.windowId})).bounds.windowState).toBe('minimized');
  await expect.poll(()=>nativeVisibility?.state==='hidden'&&nativeVisibility.sameDocument===1&&(nativeVisibility.trustedChanges??0)>=1,{timeout:remaining(),message:'Owned window must genuinely hide on the original document before JS suspension'}).toBe(true);
  mark('trusted-hidden-confirmed');
  ownerPaused=true;mark('debugger-pause-requested');await ownerLifecycle.send('Debugger.pause');mark('debugger-pause-completed');
  await expect.poll(()=>debuggerEvents.paused,{timeout:remaining(),message:'Original target must actually report Debugger.paused'}).toBe(1);
  expect(lifecycleEvents.freeze,'Debugger suspension must not be labeled native freeze').toBe(0);
  evidence.ownerLifecycleControl='debugger-paused';mark('original-tab-paused');
  const testPeer=await page.context().newPage();peer=testPeer;if(info.project.use.viewport)await testPeer.setViewportSize(info.project.use.viewport);testPeer.setDefaultTimeout(15_000);testPeer.setDefaultNavigationTimeout(15_000);await observeProviderReceipts(testPeer,'peer');metadata.observe(testPeer,'peer');await testPeer.goto(boardUrl(`/studio/board/${boardId}`));mark('peer-opened');
  await expect.poll(()=>metadata.snapshot().events.some(event=>event.client==='peer'&&event.direction==='received'&&event.type==='sync'),{timeout:remaining(),message:'Peer must independently execute and receive authoritative sync while original target JS is paused'}).toBe(true);
  await expect.poll(()=>{
   const id=ackGate.updateId;
   return id!==null&&metadata.snapshot().events.some(event=>event.client==='peer'&&event.direction==='sent'&&event.type==='update'&&event.updateId===id);
  },{timeout:remaining(),message:'Peer must replay the actual held-ACK receipt after its durable claim expires'}).toBe(true);
  // Request delivery of the captured receipt before resuming timers. Actual
  // delivery and lease fencing are verified by the real synced/receipt proof.
  expect(debuggerEvents.resumed,'Original target must remain paused until peer replay proof').toBe(0);
  expect(ackGate.release).not.toBeNull();ackGate.release!();mark('original-real-ack-released');
  await ownerLifecycle.send('Debugger.resume');
  await expect.poll(()=>debuggerEvents.resumed,{timeout:remaining(),message:'Original target must actually report Debugger.resumed'}).toBe(1);ownerPaused=false;mark('original-tab-resumed');
  expect(lifecycleEvents).toEqual({freeze:0,resume:0});evidence.ownerDebuggerEvents={...debuggerEvents};
  await restoreOwnerWindow(remaining());
  await captureVisibility('after-resume');
  evidence.ownerLifecycleEvents={...lifecycleEvents};
  evidence.ackGate={updateId:ackGate.updateId,routeSocketOrdinal:ackGate.routeSocketOrdinal,releaseAlive:null,heldMs:ackGate.releasedAt!-ackGate.heldAt!};
  await expectBoardSynced(page,remaining());await expectBoardSynced(testPeer,remaining());
  await expect.poll(()=>rows(testPeer),{timeout:remaining()}).toEqual(expected);expect(await rows(page)).toEqual(expected);
  mark('peer-converged');
  evidence.drainMs=performance.now()-started;expect(evidence.drainMs).toBeLessThanOrEqual(DRAIN_SLA_MS);
  const final=await call('POST',`/whiteboards/${boardId}/checkpoints`,{requestId:randomUUID()});expect(final.manifest.epoch).toBe(initial.manifest.epoch);
  expect(final.manifest.seq-initial.manifest.seq).toBe(24);
  evidence.uiCreates=8;evidence.uiEdits=16;
  const transport=metadata.snapshot();expect(transport.dropped).toBe(0);expect(sharedOutboxProof(transport.events,initial.manifest.seq,final.manifest.seq,'shared','provider-accepted')).toEqual([]);
  evidence.revisions={before:initial.manifest.seq,after:final.manifest.seq,epoch:final.manifest.epoch};
  await captureNativeCounts();
  await Promise.all([page.reload(),testPeer.reload()]);
  mark('both-reloaded');
  for(const tab of [page,testPeer]){await expectBoardSynced(tab,10_000);await expect.poll(()=>rows(tab),{timeout:10_000}).toEqual(expected);}
  const afterReload=await call('POST',`/whiteboards/${boardId}/checkpoints`,{requestId:randomUUID()});expect(afterReload.manifest.seq).toBe(final.manifest.seq);
  expect(metadata.snapshot().dropped).toBe(0);expect(sharedOutboxProof(metadata.snapshot().events,initial.manifest.seq,afterReload.manifest.seq,'shared','provider-accepted')).toEqual([]);
  await Promise.all(chunkReads);expect(chunks.some(chunk=>chunk.path.includes('/app/studio/board/'))).toBe(true);
  ownedBrowser.assertLive();
  evidence.afterReloadSeq=afterReload.manifest.seq;evidence.objectIds=expected.map(row=>row.id);evidence.status='passed';
  await testPeer.close();peer=undefined;
 }catch(error){primaryFailed=true;primaryFailure=error;throw error;}finally{
  const lifecycleCleanupErrors:string[]=[];
  const restoreVisibilityNeeded=ownerPaused||ownerWindowChanged;
  if(ownerPaused){
   try{await ownerLifecycle?.send('Debugger.resume');await expect.poll(()=>debuggerEvents.resumed,{timeout:5000,message:'Owned paused target must actually resume during cleanup'}).toBe(1);ownerPaused=false;}catch(error){lifecycleCleanupErrors.push(`restore: ${String(error)}`);}
  }
  try{await restoreOwnerWindow(5000);}catch(error){lifecycleCleanupErrors.push(`window-restore: ${String(error)}`);}
  try{if(restoreVisibilityNeeded&&ownerLifecycle&&!ownerPaused&&!ownerWindowChanged)await captureVisibility('after-resume');}catch(error){lifecycleCleanupErrors.push(`visibility-after-restore: ${String(error)}`);}
  try{ackGate.release?.();}catch(error){lifecycleCleanupErrors.push(`release: ${String(error)}`);}
  if(ownerPaused)lifecycleCleanupErrors.push('counts: OWNER_STILL_PAUSED_NOT_READ');
  else try{if(ownerLifecycle&&!nativeCountsCaptured)await captureNativeCounts();}catch(error){lifecycleCleanupErrors.push(`counts: ${String(error)}`);}
  if(ownerPaused)lifecycleCleanupErrors.push('listeners: OWNER_STILL_PAUSED_NOT_REMOVED');
  else try{if(ownerLifecycle){const removed=await ownerLifecycle.send('Runtime.evaluate',{expression:`for(const [type,listener] of Object.entries(globalThis[${JSON.stringify(lifecycleBinding+'Handlers')}]??{}))document.removeEventListener(type,listener);delete globalThis[${JSON.stringify(lifecycleBinding+'Handlers')}];delete globalThis[${JSON.stringify(lifecycleBinding+'Counts')}];delete globalThis[${JSON.stringify(lifecycleBinding+'Visibility')}];`});expect(removed.exceptionDetails,'Owned lifecycle observers must actually be removed').toBeUndefined();}}catch(error){lifecycleCleanupErrors.push(`listeners: ${String(error)}`);}
  try{await ownerLifecycle?.send('Runtime.removeBinding',{name:lifecycleBinding});}catch(error){lifecycleCleanupErrors.push(`binding: ${String(error)}`);}
  if(ownerPaused)lifecycleCleanupErrors.push('SOCKET_DIAGNOSTIC_OWNER_STILL_PAUSED');
  else try{const removed=await socketSession.send('Runtime.evaluate',{expression:`(()=>{const state=globalThis[${JSON.stringify(socketStateKey)}];if(!state)return;for(const [socket,listener] of state.listeners)socket.removeEventListener('close',listener);if(globalThis.WebSocket===state.observer)globalThis.WebSocket=state.original;delete globalThis[${JSON.stringify(socketStateKey)}];})()`});expect(removed.exceptionDetails,'Owned socket observation must be removed').toBeUndefined();}catch{lifecycleCleanupErrors.push('SOCKET_DIAGNOSTIC_REMOVE_FAILED');}
  try{stopSocketObservation();}catch{lifecycleCleanupErrors.push('SOCKET_DIAGNOSTIC_STOP_FAILED');}try{await socketSession.detach();}catch{lifecycleCleanupErrors.push('SOCKET_DIAGNOSTIC_DETACH_FAILED');}
  try{if(ownerLifecycle&&!ownerPaused){ownerLifecycle.off('Debugger.paused',onDebuggerPaused);ownerLifecycle.off('Debugger.resumed',onDebuggerResumed);await ownerLifecycle.send('Debugger.disable');}}catch{lifecycleCleanupErrors.push('OWNED_DEBUGGER_CLEANUP_FAILED');}
  try{await ownerLifecycle?.detach();}catch(error){lifecycleCleanupErrors.push(`detach: ${String(error)}`);}
  evidence.lifecycleCleanupErrors=lifecycleCleanupErrors;evidence.ownerLifecycleEvents={...lifecycleEvents};evidence.ownerDebuggerEvents={...debuggerEvents};
  try{await peer?.close();}catch(error){lifecycleCleanupErrors.push(`peer: ${String(error)}`);}
  if(boardId&&token&&!archived){try{const board=await call('GET',`/whiteboards/${boardId}`);if(!board.archived){await call('PATCH',`/whiteboards/${boardId}`,{archived:true,expectedLifecycleRevision:board.lifecycleRevision});archived=true;}}catch(error){evidence.cleanupError=String(error);}}
  try{await Promise.all(chunkReads);}catch(error){lifecycleCleanupErrors.push(`chunks: ${String(error)}`);}evidence.browserChunks=chunks;
  const evidencePath=info.outputPath('same-browser-outbox-evidence.json');
  try{await writeFile(evidencePath,JSON.stringify({...evidence,transport:metadata.snapshot()},null,2));}catch(error){lifecycleCleanupErrors.push(`evidence: ${String(error)}`);}
  try{await info.attach('same-browser-outbox-evidence',{path:evidencePath,contentType:'application/json'});}catch(error){lifecycleCleanupErrors.push(`attachment: ${String(error)}`);}
  if(lifecycleCleanupErrors.length){const cleanupFailure=new Error('OWNED_TAB_LIFECYCLE_CLEANUP_FAILED');throw primaryFailed?new AggregateError([primaryFailure,cleanupFailure],'PRIMARY_AND_OWNED_TAB_CLEANUP_FAILED'):cleanupFailure;}
 }
});
