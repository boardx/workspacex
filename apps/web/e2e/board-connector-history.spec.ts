import {test,expect,type Page,type BrowserContext} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {boardLogin,boardApi,boardHead,canonicalBoardSnapshot,createAcceptanceBoard,object,createCommands,operate,dragObject,canonicalRows} from './board-acceptance-support';
import {runtimeSourceIdentity,observeRuntimeChunks,verifyRuntimeIdentity,sha256} from './board-runtime-evidence';
import {connectorAuthorityTransport} from './support/connector-authority-transport';
import {deleteOwnedConnectorFixture} from './support/connector-acceptance-fixture';
import {retainedConnector,cubicSamples} from './support/connector-c05-oracle.mjs';
import {cancelledConnectorGesture} from './support/connector-c06-oracle.mjs';
import {restoredConnectorHistory} from './support/connector-c07-oracle.mjs';

test('C07 UI deletion history restores complete Connector without overwriting peer endpoint movement',async({browser,page:owner,request:api,baseURL},info)=>{
 test.setTimeout(180_000);expect(baseURL).toBeTruthy();const source=runtimeSourceIdentity(),transport=connectorAuthorityTransport(),records:unknown[]=[],screenshots:unknown[]=[],cleanupErrors:unknown[]=[];
 let context:BrowserContext|undefined,editor:Page|undefined,ownerToken='',boardId='',failure:unknown;
 const title='C07 Connector history with surviving remote endpoint';
 const capture=async(phase:string)=>{for(const [index,page] of [owner,editor!].entries()){const path=info.outputPath(`${phase}-${index}.png`),bytes=await page.screenshot({path});screenshots.push({phase,index,path,sha256:sha256(bytes)});}};
 const synced=async(page:Page)=>{await expect(page.getByTestId('board-sync-status')).toHaveAttribute('data-sync-phase','synced');};
 try{
  context=await browser.newContext({baseURL,viewport:{width:1440,height:900}});editor=await context.newPage();const peers=[owner,editor],chunks=peers.map(observeRuntimeChunks);
  const login=async(page:Page,email:string,password:string,userId:string)=>{const response=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/auth/login')&&response.request().method()==='POST'),token=await boardLogin(page,email,password),authenticated=await response;expect(authenticated.ok()).toBe(true);const body=await authenticated.json();expect(body.userId).toBe(userId);expect(body.sessionToken).toBe(token);return token;};
  ownerToken=await login(owner,F.email,F.password,F.userId);const editorToken=await login(editor,F.adminEmail,F.adminPassword,F.adminUserId);transport.observe(owner,'original',()=>F.userId);transport.observe(editor,'peer',()=>F.adminUserId);
  boardId=await createAcceptanceBoard(api,ownerToken,title);await boardApi(api,ownerToken,'PUT',`/whiteboards/${boardId}/members`,{userId:F.adminUserId,role:'editor'});
  const relationship={from:'c07-a',to:'c07-b',fromAnchor:'right' as const,toAnchor:'left' as const,type:'curve' as const,startStyle:'circle' as const,endStyle:'diamond' as const,lineStyle:'solid' as const,strokeWidth:8,label:'C07 preserved label',semanticRelation:'depends_on',route:{kind:'curve' as const,startOffset:{x:140,y:-60},endOffset:{x:-100,y:70}},labelPosition:{t:.7,normalOffset:-23}};
  await operate(api,ownerToken,boardId,createCommands([object('c07-a','sticky',120,200,'A',140,100),object('c07-b','sticky',850,420,'B',140,100),{...object('c07-edge','connector',260,250,'C07 preserved label',590,220),style:{stroke:'#E11D48'},connector:relationship}]));
  for(const page of peers){await page.goto(`/studio/board/${boardId}`);await synced(page);}
  const runtimeBefore=await Promise.all(chunks.map(async read=>verifyRuntimeIdentity(api,source,await read()))),original=await canonicalBoardSnapshot(api,ownerToken,boardId),originalA=original.objects.find(item=>item.id==='c07-a')!,originalEdge=original.objects.find(item=>item.id==='c07-edge')!;
  const state=()=>canonicalBoardSnapshot(api,ownerToken,boardId);
  const assertAcknowledged=async(before:{epoch:number;seq:number},actor:'original'|'peer',offset:number)=>{
   for(const page of peers)await synced(page);const after=await state();expect(after.revision).toEqual({epoch:before.epoch,seq:before.seq+1});
   await expect.poll(()=>transport.snapshot().events.slice(offset).filter(event=>event.boardId===boardId&&event.client===actor&&event.direction==='received'&&event.type==='ack'&&event.seq===after.revision.seq).length).toBe(1);
   const acknowledgements=transport.snapshot().events.slice(offset).filter(event=>event.boardId===boardId&&event.client===actor&&event.direction==='received'&&event.type==='ack');expect(acknowledgements).toHaveLength(1);
   expect(typeof acknowledgements[0]!.updateId).toBe('string');expect(typeof acknowledgements[0]!.gestureId).toBe('string');const submitted=transport.snapshot().events.slice(offset).filter(event=>event.boardId===boardId&&event.client===actor&&event.direction==='sent'&&event.type==='update'&&event.updateId===acknowledgements[0]!.updateId&&event.gestureId===acknowledgements[0]!.gestureId);expect(submitted).toHaveLength(1);expect(submitted[0]!.epoch).toBe(before.epoch);
   expect((await canonicalBoardSnapshot(api,editorToken,boardId)).objects).toEqual(after.objects);records.push({phase:'acknowledged-gesture',actor,revision:after.revision,ack:acknowledgements[0]});return after;
  };
  const selectA=async()=>{const row=owner.getByTestId('board-a11y-object-c07-a');await row.focus();await row.press('Enter');await expect(row).toHaveAttribute('aria-pressed','true');const input=owner.getByTestId('board-thinking-editor');await expect(input).toBeVisible();await input.press('Escape');await expect(input).toBeHidden();await expect(row).toHaveAttribute('aria-pressed','true');};
  const clearForPaint=async(page:Page)=>{
   const before=await state();await page.getByTestId('board-tool-select').click();
   const point=await page.getByTestId('board-fabric-surface').evaluate((surface,expectedCount)=>{
    const host=surface as HTMLElement,box=host.getBoundingClientRect(),zoom=Number(host.dataset.viewportZoom),panX=Number(host.dataset.viewportPanX),panY=Number(host.dataset.viewportPanY),scenes=JSON.parse(host.dataset.objectScenes??'[]') as Array<{left:number;top:number;width:number;height:number}>;
    if(!Number.isFinite(zoom)||zoom<=0||!Number.isFinite(panX)||!Number.isFinite(panY)||![box.x,box.y,box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0)throw new Error('Invalid actual viewport');
    if(scenes.length!==expectedCount||scenes.some(scene=>![scene.left,scene.top,scene.width,scene.height].every(Number.isFinite)||scene.width<0||scene.height<0))throw new Error('Incomplete or invalid actual Fabric scene bounds');
    for(let y=80;y<box.height-100;y+=40)for(let x=40;x<box.width-40;x+=40){const sceneX=(x-panX)/zoom,sceneY=(y-panY)/zoom,top=document.elementFromPoint(box.x+x,box.y+y);if(top instanceof HTMLCanvasElement&&top.classList.contains('upper-canvas')&&!scenes.some(scene=>sceneX>=scene.left-20/zoom&&sceneX<=scene.left+scene.width+20/zoom&&sceneY>=scene.top-20/zoom&&sceneY<=scene.top+scene.height+20/zoom))return{x,y};}
    throw new Error('No independently clear upper-canvas point');
   },before.objects.length);
   await page.getByTestId('board-fabric-surface').click({position:point});await expect(page.getByTestId('board-a11y-selection-announcement')).toBeVisible();await expect(page.getByTestId('board-a11y-selection-announcement')).toHaveText('未选择对象');await expect(page.locator('[data-testid^="board-connector-handle-"]')).toHaveCount(0);await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));expect(await state()).toEqual(before);
  };
  await selectA();await owner.getByRole('button',{name:'更多白板操作',exact:true}).click();let offset=transport.snapshot().events.length;await owner.getByRole('button',{name:'删除选中',exact:true}).click();await owner.keyboard.press('Escape');
  const deleted=await assertAcknowledged(original.revision,'original',offset);expect(deleted.objects.map(item=>item.id)).toEqual(['c07-b']);await capture('cascaded-delete');
  const peerZoom=Number(await editor.getByTestId('board-fabric-surface').getAttribute('data-viewport-zoom'));expect(peerZoom).toBeGreaterThan(0);
  offset=transport.snapshot().events.length;await dragObject(editor,'c07-b',80,90);const moved=await assertAcknowledged(deleted.revision,'peer',offset),remoteB=moved.objects[0]!,originalB=original.objects.find(item=>item.id==='c07-b')!;expect(remoteB.id).toBe('c07-b');expect(remoteB).toEqual({...originalB,geometry:{...originalB.geometry,x:originalB.geometry.x+80/peerZoom,y:originalB.geometry.y+90/peerZoom}});await capture('peer-surviving-endpoint-move');
  const restored=async(phase:string)=>{
   const snapshot=await state();expect(snapshot.objects.map(item=>item.id).sort()).toEqual(['c07-a','c07-b','c07-edge']);expect(snapshot.objects.find(item=>item.id==='c07-a')).toEqual(originalA);expect(snapshot.objects.find(item=>item.id==='c07-b')).toEqual(remoteB);
   restoredConnectorHistory(original.objects,remoteB,snapshot.objects);
   const edge=snapshot.objects.find(item=>item.id==='c07-edge')!;retainedConnector(originalEdge.connector!,edge.connector!);expect(edge.style).toEqual(originalEdge.style);expect(edge.geometry).not.toEqual(originalEdge.geometry);
   const start={x:originalA.geometry.x+originalA.geometry.width,y:originalA.geometry.y+originalA.geometry.height/2},end={x:remoteB.geometry.x,y:remoteB.geometry.y+remoteB.geometry.height/2},samples=cubicSamples(start,end,relationship.route);
   for(const page of peers){await expect.poll(()=>canonicalRows(page)).toEqual(await canonicalRows(owner));const row=page.getByTestId('board-a11y-mirror').locator('[data-object-id="c07-edge"]');await expect(row).toHaveAttribute('data-connector-from','c07-a');await expect(row).toHaveAttribute('data-connector-to','c07-b');await expect(row).toHaveAttribute('data-connector-start',JSON.stringify(start));await expect(row).toHaveAttribute('data-connector-end',JSON.stringify(end));
    await clearForPaint(page);
    await expect.poll(()=>page.locator('canvas.lower-canvas').evaluate((canvas,points)=>{const element=canvas as HTMLCanvasElement,context=element.getContext('2d')!,surface=element.closest('[data-testid="board-fabric-surface"]') as HTMLElement,rect=element.getBoundingClientRect(),zoom=Number(surface.dataset.viewportZoom),px=Number(surface.dataset.viewportPanX),py=Number(surface.dataset.viewportPanY),sx=element.width/rect.width,sy=element.height/rect.height;return points.every(point=>{const x=Math.round((px+zoom*point.x)*sx),y=Math.round((py+zoom*point.y)*sy);if(x<4||y<4||x+4>=element.width||y+4>=element.height)return false;const data=context.getImageData(x-4,y-4,9,9).data;for(let i=0;i<data.length;i+=4)if(data[i]===225&&data[i+1]===29&&data[i+2]===72&&data[i+3]===255)return true;return false;});},samples)).toBe(true);
   }
   expect(await state()).toEqual(snapshot);await capture(phase);records.push({phase,revision:snapshot.revision,edge:edge.connector,remoteB:remoteB.geometry,samples});return snapshot;
  };
  for(const kind of ['撤销','重做','撤销'] as const){const before=await boardHead(api,ownerToken,boardId);offset=transport.snapshot().events.length;await owner.getByRole('button',{name:kind,exact:true}).click();await expect(owner.getByText(new RegExp(`^${kind}已由服务器确认 · 序列 ${before.seq+1}$`))).toBeVisible();const after=await assertAcknowledged(before,'original',offset);if(kind==='撤销')await restored(`restored-${after.revision.seq}`);else {expect(after.objects).toEqual([remoteB]);await capture('redo-keeps-remote-B');}}
  const final=await restored('history-final');for(const page of peers)await page.reload();for(const page of peers)await synced(page);expect((await restored('history-both-users-reloaded')).objects).toEqual(final.objects);
  // A new owner session has no old undo stack. Recreate one local delete/undo for the peer-edit conflict.
  await selectA();await owner.getByRole('button',{name:'更多白板操作',exact:true}).click();offset=transport.snapshot().events.length;await owner.getByRole('button',{name:'删除选中',exact:true}).click();await owner.keyboard.press('Escape');const conflictDeleted=await assertAcknowledged(final.revision,'original',offset);
  offset=transport.snapshot().events.length;await owner.getByRole('button',{name:'撤销',exact:true}).click();await expect(owner.getByText(new RegExp(`^撤销已由服务器确认 · 序列 ${conflictDeleted.revision.seq+1}$`))).toBeVisible();const conflictRestored=await assertAcknowledged(conflictDeleted.revision,'original',offset);
  const edgeRow=editor.getByTestId('board-a11y-object-c07-edge');await edgeRow.focus();await edgeRow.press('Enter');await editor.getByTestId('board-connector-width-open').click();offset=transport.snapshot().events.length;await editor.getByTestId('board-connector-width-12').click();await editor.keyboard.press('Escape');const peerEdited=await assertAcknowledged(conflictRestored.revision,'peer',offset);retainedConnector({...relationship,strokeWidth:12},peerEdited.objects.find(item=>item.id==='c07-edge')!.connector!);
  offset=transport.snapshot().events.length;await owner.getByRole('button',{name:'重做',exact:true}).click();await expect(owner.getByText('未重做：没有可重做的本地修改，或当前画板存在冲突。',{exact:true})).toBeVisible();await owner.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  cancelledConnectorGesture(peerEdited,await state(),transport.snapshot().events.slice(offset).filter(event=>event.boardId===boardId&&event.client==='original'));await capture('redo-rejects-restored-peer-width-edit');for(const page of peers)await page.reload();for(const page of peers)await synced(page);expect(await state()).toEqual(peerEdited);
  const runtimeAfter=await Promise.all(chunks.map(async read=>verifyRuntimeIdentity(api,source,await read())));expect(transport.snapshot().dropped).toBe(0);records.push({runtimeBefore,runtimeAfter});
 }catch(error){failure=error;}
 finally{
  if(boardId&&ownerToken){try{records.push({phase:'cleanup',...await deleteOwnedConnectorFixture(api,ownerToken,boardId,F.userId,title)});}catch(error){cleanupErrors.push(error);}}
  if(context){try{await context.close();}catch(error){cleanupErrors.push(error);}}if(cleanupErrors.length)failure=new AggregateError([...(failure?[failure]:[]),...cleanupErrors],'Connector history execution/cleanup failures');
  const path=info.outputPath('connector-history-result.json');await writeFile(path,JSON.stringify({source,status:failure?'failed':'C07-history-subcases-passed',requiredRoundComplete:false,records,screenshots,pending:['actual browser and independent visual review','C08 complete interchange','390px history']},null,2),{mode:0o600});await info.attach('connector-history-result',{path,contentType:'application/json'});
 }
 if(failure)throw failure;
});
