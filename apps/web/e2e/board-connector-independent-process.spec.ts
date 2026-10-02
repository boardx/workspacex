import {test,expect,chromium,type Page,type Browser} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {boardLogin,boardApi,boardHead,canonicalBoardSnapshot,createAcceptanceBoard,object,createCommands,operate} from './board-acceptance-support';
import {runtimeSourceIdentity,observeRuntimeChunks,verifyRuntimeIdentity,sha256} from './board-runtime-evidence';
import {independentProcessIds,cubicSamples,curveMeasurement,acceptedGesture,retainedConnector,glyphProof,strokeProof} from './support/connector-c05-oracle.mjs';
import {deleteOwnedConnectorFixture} from './support/connector-acceptance-fixture';

const edgeId='c05-edge',ink='#E11D48';
async function synced(page:Page){
 const status=page.getByTestId('board-sync-status');
 await expect(status).toHaveAttribute('data-sync-phase','synced');
 await expect(status).toHaveAttribute('aria-label',/^已同步(?: · 序列 \d+)?(?: · 只读)?$/);
 await expect(status.locator('svg')).toBeVisible();
}
async function select(page:Page){const row=page.getByTestId(`board-a11y-object-${edgeId}`);await row.focus();await row.press('Enter');await expect(page.getByTestId('board-connector-toolbar')).toBeVisible();}
async function moveHandle(page:Page,id:string,dx:number,dy:number,held=false){
 const handle=page.getByTestId(`board-connector-handle-${id}`),box=await handle.boundingBox();expect(box).not.toBeNull();
 await page.mouse.move(box!.x+box!.width/2,box!.y+box!.height/2);await page.mouse.down();
 await page.mouse.move(box!.x+box!.width/2+dx,box!.y+box!.height/2+dy,{steps:10});
 if(!held)await page.mouse.up();
}

test('C05 distinct browser processes converge on Connector style path and concurrent endpoint edits',async({request:api,baseURL},info)=>{
 test.setTimeout(240_000);
 expect(baseURL,'An existing isolated production runtime URL is required').toBeTruthy();
 const sha=runtimeSourceIdentity(),browsers:Browser[]=[],pages:Page[]=[],records:unknown[]=[],cleanup:unknown[]=[],processIds:number[]=[],browserErrors:string[]=[];
 let boardId='',ownerToken='',failure:unknown;
 const screenshots:Array<{phase:string;process:number;path:string;sha256:string}>=[];
 const traffic:Array<Array<{direction:'sent'|'received';type:string;updateId?:string;gestureId?:string;epoch?:number;seq?:number;code?:string}>>=[[],[],[]];
 const capture=async(phase:string)=>{for(let index=0;index<pages.length;index++){const path=info.outputPath(`${phase}-process-${index}.png`),bytes=await pages[index]!.screenshot({path});screenshots.push({phase,process:index,path,sha256:sha256(bytes)});}};
 try{
  // Each launch creates a separate browser process, not two contexts of one browser.
  for(let index=0;index<3;index++){
   const browser=await chromium.launch();browsers.push(browser);
   const session=await browser.newBrowserCDPSession();const processes=await session.send('SystemInfo.getProcessInfo');await session.detach();
   const browserProcess=processes.processInfo.find(process=>process.type==='browser');expect(browserProcess).toBeTruthy();processIds.push(browserProcess!.id);
   const context=await browser.newContext({baseURL,viewport:{width:1440,height:900}}),page=await context.newPage();pages.push(page);
   page.on('websocket',socket=>{
    const observe=(direction:'sent'|'received',payload:string|Buffer)=>{
     let message:Record<string,unknown>;try{message=JSON.parse(String(payload));}catch{return;}
     if(!['update','ack','sync','error','recovery'].includes(String(message.type)))return;
     // Retain protocol identity only, never credentials or document payload bytes.
     traffic[index]!.push({direction,type:String(message.type),...(typeof message.updateId==='string'?{updateId:message.updateId}:{}),...(typeof message.gestureId==='string'?{gestureId:message.gestureId}:{}),...(typeof message.epoch==='number'?{epoch:message.epoch}:{}),...(typeof message.seq==='number'?{seq:message.seq}:{}),...(typeof message.code==='string'?{code:message.code}:{})});
    };
    socket.on('framesent',frame=>observe('sent',frame.payload));socket.on('framereceived',frame=>observe('received',frame.payload));
   });
   page.on('pageerror',()=>browserErrors.push(`process-${index}:pageerror`));page.on('console',message=>{if(message.type()==='error')browserErrors.push(`process-${index}:console-error`);});
   page.on('requestfailed',request=>browserErrors.push(`process-${index}:${request.method()}:${new URL(request.url()).pathname}:request-failed`));
  }
  independentProcessIds(processIds);
  const [owner,editor,viewer]=pages as [Page,Page,Page],chunkReaders=pages.map(observeRuntimeChunks);
  const accounts=[[F.email,F.password,F.userId],[F.adminEmail,F.adminPassword,F.adminUserId],[F.leadEmail,F.leadPassword,F.leadUserId]];
  const tokens:string[]=[],identities:string[]=[];
  for(let index=0;index<pages.length;index++){
   const response=pages[index]!.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/auth/login')&&r.request().method()==='POST');
   tokens.push(await boardLogin(pages[index]!,accounts[index]![0],accounts[index]![1]));
   const login=await response;expect(login.ok()).toBe(true);const authenticated=await login.json();
   expect(authenticated.userId).toBe(accounts[index]![2]);expect(authenticated.sessionToken).toBe(tokens[index]);identities.push(authenticated.userId);
  }
  expect(new Set(identities).size).toBe(3);ownerToken=tokens[0]!;
  boardId=await createAcceptanceBoard(api,ownerToken,'C05 independent Connector processes');
  await boardApi(api,ownerToken,'PUT',`/whiteboards/${boardId}/members`,{userId:identities[1],role:'editor'});
  await boardApi(api,ownerToken,'PUT',`/whiteboards/${boardId}/members`,{userId:identities[2],role:'viewer'});
  await operate(api,ownerToken,boardId,createCommands([
   object('c05-a','sticky',150,220,'A',140,100),object('c05-b','sticky',1050,420,'B',140,100),
   {...object(edgeId,'connector',290,270,'C05',760,200),style:{stroke:ink},connector:{from:'c05-a',to:'c05-b',fromAnchor:'right',toAnchor:'left',type:'curve',startStyle:'none',endStyle:'none',lineStyle:'solid',strokeWidth:4,label:'C05',semanticRelation:'depends_on',route:{kind:'curve',startOffset:{x:180,y:0},endOffset:{x:-180,y:0}},labelPosition:{t:.5,normalOffset:20}}},
  ]));
  for(const page of pages){await page.goto(`/studio/board/${boardId}`);await synced(page);await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(3);}
  const runtimeBefore=await Promise.all(chunkReaders.map(async read=>verifyRuntimeIdentity(api,sha,await read())));
  const state=async()=>{const snapshot=await canonicalBoardSnapshot(api,ownerToken,boardId);return {head:await boardHead(api,ownerToken,boardId),edge:snapshot.objects.find(item=>item.id===edgeId)!,objects:snapshot.objects};};
  const proof=(before:{epoch:number;seq:number},after:{epoch:number;seq:number},offsets:number[],actors:number[])=>{
   const frames=traffic.flatMap((items,index)=>items.slice(offsets[index]).map(frame=>({...frame,process:index})));
   const submitted=frames.filter(frame=>frame.direction==='sent'&&frame.type==='update'),acks=frames.filter(frame=>frame.direction==='received'&&frame.type==='ack');
   acceptedGesture(before,after,submitted,acks,actors);records.push({phase:'gesture-ACK-proof',before,after,actors,submitted,acks});
  };
  const stable=async(phase:string)=>{
   for(const page of pages)await synced(page);
   const authoritative=await state();expect(authoritative.edge.connector).toBeTruthy();
   for(const frames of traffic){
    const revisions=frames.filter(frame=>frame.direction==='received'&&(frame.type==='sync'||frame.type==='update'));
    expect(revisions.length,'each real browser must receive an authoritative sync').toBeGreaterThan(0);
    expect(revisions.at(-1)!.epoch).toBe(authoritative.head.epoch);
    expect(Math.max(...frames.filter(frame=>frame.direction==='received'&&typeof frame.seq==='number').map(frame=>frame.seq!))).toBe(authoritative.head.seq);
   }
   for(const token of tokens.slice(0,2)){const snapshot=await canonicalBoardSnapshot(api,token,boardId);expect(snapshot.revision).toEqual(authoritative.head);expect(snapshot.objects).toEqual(authoritative.objects);}
   expect(await boardHead(api,tokens[2]!,boardId)).toEqual(authoritative.head);
   // Read the actual lower canvas. The cubic oracle is independent of production path helpers.
   const relation=authoritative.edge.connector!;
   const anchor=(id:string,side:'right'|'left')=>{const node=authoritative.objects.find(item=>item.id===id)!;return {x:node.geometry.x+(side==='right'?node.geometry.width:0),y:node.geometry.y+node.geometry.height/2};};
   const start=relation.fromPoint??anchor(relation.from!,'right'),end=relation.toPoint??anchor(relation.to!,'left');
   expect(relation.type).toBe('curve');expect(relation.route?.kind).toBe('curve');
   const route=relation.route as {kind:'curve';startOffset:{x:number;y:number};endOffset:{x:number;y:number}};
   const samples=cubicSamples(start,end,route);
   const localRaster:Array<{process:number;labelHash:string;lineWidth:number;expectedWidth:number}>=[];
   for(const page of pages){
    if(page!==viewer)await select(page);
    else {await page.getByTestId(`board-a11y-object-${edgeId}`).focus();await page.getByTestId(`board-a11y-object-${edgeId}`).press('Enter');}
    if(page!==viewer){
     await expect(page.getByTestId('board-connector-width-open')).toHaveText(String(relation.strokeWidth));
     await page.getByTestId('board-connector-label-open').click();await expect(page.getByTestId('board-connector-label')).toHaveValue(relation.label);await page.keyboard.press('Escape');
     await page.getByTestId('board-connector-path-open').click();await expect(page.getByTestId('board-connector-curve')).toHaveAttribute('aria-pressed','true');await page.keyboard.press('Escape');
    }
    const viewport=await page.getByTestId('board-fabric-surface').evaluate(surface=>({zoom:Number((surface as HTMLElement).dataset.viewportZoom),x:Number((surface as HTMLElement).dataset.viewportPanX),y:Number((surface as HTMLElement).dataset.viewportPanY)}));
    const surface=await page.getByTestId('board-fabric-surface').boundingBox();expect(surface).not.toBeNull();
    const labelPoint=curveMeasurement(start,end,route,relation.labelPosition??{t:.5,normalOffset:0}).point;
    for(const [name,point] of (page===viewer?[]:[['from',start],['to',end],['curve-start',{x:start.x+route.startOffset.x,y:start.y+route.startOffset.y}],['curve-end',{x:end.x+route.endOffset.x,y:end.y+route.endOffset.y}],['label',labelPoint]] as Array<[string,{x:number;y:number}]>)){
     const box=await page.getByTestId(`board-connector-handle-${name}`).boundingBox();expect(box).not.toBeNull();
     expect(Math.abs(box!.x+box!.width/2-surface!.x-viewport.x-point.x*viewport.zoom)).toBeLessThan(1);
     expect(Math.abs(box!.y+box!.height/2-surface!.y-viewport.y-point.y*viewport.zoom)).toBeLessThan(1);
    }
    await page.getByTestId('board-tool-select').click();await page.getByTestId('board-fabric-surface').click({position:{x:70,y:650}});
    await expect.poll(()=>page.locator('canvas.lower-canvas').evaluate((canvas,points)=>{
     const element=canvas as HTMLCanvasElement,ctx=element.getContext('2d')!,surface=element.closest('[data-testid="board-fabric-surface"]') as HTMLElement;
     const zoom=Number(surface.dataset.viewportZoom),panX=Number(surface.dataset.viewportPanX),panY=Number(surface.dataset.viewportPanY),rect=element.getBoundingClientRect(),sx=element.width/rect.width,sy=element.height/rect.height;
     return points.every(point=>{const x=Math.round((panX+zoom*point.x)*sx),y=Math.round((panY+zoom*point.y)*sy);if(x<4||y<4||x+4>=element.width||y+4>=element.height)return false;const data=ctx.getImageData(x-4,y-4,9,9).data;for(let i=0;i<data.length;i+=4)if(data[i]===225&&data[i+1]===29&&data[i+2]===72&&data[i+3]===255)return true;return false;});
    },samples),{message:`${phase}: persisted red Connector must paint independent cubic samples`}).toBe(true);
    const raster=await page.locator('canvas.lower-canvas').evaluate((canvas,input)=>{
     const element=canvas as HTMLCanvasElement,context=element.getContext('2d')!,surface=element.closest('[data-testid="board-fabric-surface"]') as HTMLElement,rect=element.getBoundingClientRect();
     const zoom=Number(surface.dataset.viewportZoom),panX=Number(surface.dataset.viewportPanX),panY=Number(surface.dataset.viewportPanY),scale=element.width/rect.width;
     const px=(x:number)=>Math.round((panX+zoom*x)*scale),py=(y:number)=>Math.round((panY+zoom*y)*scale);
     const x=px(input.labelPoint.x)-150,y=py(input.labelPoint.y)-30;
     if(x<0||y<0||x+300>element.width||y+60>element.height)throw new Error('Label raster must fit actual canvas');
     const label=Array.from(context.getImageData(x,y,300,60).data);
     const golden=document.createElement('canvas');golden.width=300;golden.height=60;const goldenContext=golden.getContext('2d')!;
     // Native Canvas text is an independent glyph oracle, not Fabric or a copy of its rendered bytes.
     goldenContext.font=`${13*zoom*scale}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;goldenContext.fillStyle='#000000';goldenContext.fillText(input.label,150,30+13*zoom*scale*.9);
     const t=.12,u=1-t,{start,end,route}=input;
     const dx=3*u*u*route.startOffset.x+6*u*t*(end.x+route.endOffset.x-start.x-route.startOffset.x)-3*t*t*route.endOffset.x;
     const dy=3*u*u*route.startOffset.y+6*u*t*(end.y+route.endOffset.y-start.y-route.startOffset.y)-3*t*t*route.endOffset.y;
     const length=Math.hypot(dx,dy),normal={x:-dy/length,y:dx/length},point=input.sample;
     let lineWidth=0;const visited=new Set<string>(),scan:Array<{offset:number;ink:boolean}>=[];
     for(let offset=-30;offset<=30;offset++){
      const x=px(point.x)+Math.round(normal.x*offset),y=py(point.y)+Math.round(normal.y*offset),key=`${x}:${y}`;if(visited.has(key))continue;visited.add(key);
      const rgba=context.getImageData(x,y,1,1).data,ink=rgba[0]===225&&rgba[1]===29&&rgba[2]===72&&rgba[3]===255;if(ink)lineWidth++;scan.push({offset,ink});
     }
     return {label,golden:Array.from(goldenContext.getImageData(0,0,300,60).data),scan,lineWidth,expectedWidth:input.width*zoom*scale,zoom,scale};
    },{start,end,route,label:relation.label,labelPoint,sample:samples[0]!,width:relation.strokeWidth!});
    glyphProof(raster.label,raster.golden);
    strokeProof(raster.scan,raster.expectedWidth);
    localRaster.push({process:pages.indexOf(page),labelHash:sha256(Buffer.from(raster.label)),lineWidth:raster.lineWidth,expectedWidth:raster.expectedWidth});
   }
   // Identical fixed viewports must render the same actual glyphs, including the viewer.
   expect(new Set(localRaster.map(item=>item.labelHash)).size,`${phase}: viewer label raster must equal the editor whose actual textarea was verified`).toBe(1);
   records.push({phase:`${phase}-local-raster`,localRaster});
   expect(await state()).toEqual(authoritative);await capture(phase);records.push({phase,head:authoritative.head,connector:relation,samples});return authoritative;
  };
  const initial=await stable('seeded-baseline');
  let previous=initial,offsets=traffic.map(frames=>frames.length);
  await select(editor);await editor.getByTestId('board-connector-width-open').click();await editor.getByTestId('board-connector-width-8').click();await editor.keyboard.press('Escape');
  const widened=await stable('editor-width');expect(widened.edge.connector?.strokeWidth).toBe(8);proof(previous.head,widened.head,offsets,[1]);previous=widened;offsets=traffic.map(frames=>frames.length);
  await select(owner);const routeZoom=Number(await owner.getByTestId('board-fabric-surface').getAttribute('data-viewport-zoom'));expect(routeZoom).toBeGreaterThan(0);await moveHandle(owner,'curve-start',0,80);
  const routed=await stable('owner-route');expect(routed.edge.connector?.route).toEqual({kind:'curve',startOffset:{x:180,y:80/routeZoom},endOffset:{x:-180,y:0}});proof(previous.head,routed.head,offsets,[0]);previous=routed;offsets=traffic.map(frames=>frames.length);
  await select(editor);await editor.getByTestId('board-connector-label-open').click();await editor.getByTestId('board-connector-label').fill('Independent C05 label');await editor.getByTestId('board-connector-label-save').click();await editor.keyboard.press('Escape');
  const labelled=await stable('editor-label');expect(labelled.edge.connector?.label).toBe('Independent C05 label');proof(previous.head,labelled.head,offsets,[1]);previous=labelled;offsets=traffic.map(frames=>frames.length);
  await select(owner);const labelZoom=Number(await owner.getByTestId('board-fabric-surface').getAttribute('data-viewport-zoom'));
  const labelBefore=curveMeasurement({x:290,y:270},{x:1050,y:470},routed.edge.connector!.route as {kind:'curve';startOffset:{x:number;y:number};endOffset:{x:number;y:number}},previous.edge.connector!.labelPosition!,undefined).point;
  const expectedLabel=curveMeasurement({x:290,y:270},{x:1050,y:470},routed.edge.connector!.route as {kind:'curve';startOffset:{x:number;y:number};endOffset:{x:number;y:number}},previous.edge.connector!.labelPosition!,{x:labelBefore.x,y:labelBefore.y+45/labelZoom});await moveHandle(owner,'label',0,45);
  const positioned=await stable('owner-label-position');expect(positioned.edge.connector?.labelPosition?.t).toBeCloseTo(expectedLabel.t!,2);expect(Math.abs(positioned.edge.connector!.labelPosition!.normalOffset-expectedLabel.normalOffset!)).toBeLessThan(.5);proof(previous.head,positioned.head,offsets,[0]);
  await select(owner);await select(editor);
  await owner.getByTestId('board-connector-width-open').click();await editor.getByTestId('board-connector-width-open').click();
  const sameFieldBefore=await state(),sameFieldOffsets=traffic.map(frames=>frames.length);
  await Promise.all([owner.getByTestId('board-connector-width-4').click(),editor.getByTestId('board-connector-width-12').click()]);
  await owner.keyboard.press('Escape');await editor.keyboard.press('Escape');
  const sameField=await stable('same-field-width-converged');proof(sameFieldBefore.head,sameField.head,sameFieldOffsets,[0,1]);
  const finalWidthWriter=traffic.findIndex((frames,index)=>frames.slice(sameFieldOffsets[index]).some(frame=>frame.direction==='received'&&frame.type==='ack'&&frame.seq===sameField.head.seq));
  expect(finalWidthWriter).toBeGreaterThanOrEqual(0);expect(finalWidthWriter).toBeLessThan(2);expect(sameField.edge.connector!.strokeWidth).toBe(finalWidthWriter===0?4:12);
  retainedConnector({...sameFieldBefore.edge.connector!,strokeWidth:sameField.edge.connector!.strokeWidth},sameField.edge.connector!);
  await select(owner);await select(editor);const beforeRace=await state(),raceOffsets=traffic.map(frames=>frames.length);
  const sceneDelta=async(page:Page,dx:number,dy:number)=>{const zoom=await page.getByTestId('board-fabric-surface').getAttribute('data-viewport-zoom');expect(Number(zoom)).toBeGreaterThan(0);return {x:dx/Number(zoom),y:dy/Number(zoom),zoom};};
  const fromDelta=await sceneDelta(owner,-30,60),toDelta=await sceneDelta(editor,30,-60);
  await owner.keyboard.down('Meta');await editor.keyboard.down('Meta');
  try{
   await Promise.all([moveHandle(owner,'from',-30,60,true),moveHandle(editor,'to',30,-60,true)]);
   expect(await state(),'held concurrent endpoint previews must not write canonical').toEqual(beforeRace);await capture('concurrent-held');
   await Promise.all([owner.mouse.up(),editor.mouse.up()]);
  }finally{await owner.keyboard.up('Meta');await editor.keyboard.up('Meta');await owner.mouse.up();await editor.mouse.up();}
  const raced=await stable('concurrent-released');
  expect(raced.head.epoch).toBe(beforeRace.head.epoch);
  proof(beforeRace.head,raced.head,raceOffsets,[0,1]);
  const accepted=traffic.flatMap((frames,index)=>frames.slice(raceOffsets[index]).filter(frame=>frame.direction==='received'&&frame.type==='ack').map(ack=>{
   expect(index,'viewer must not submit or receive a local write ACK').toBeLessThan(2);
   const submitted=frames.slice(raceOffsets[index]).filter(frame=>frame.direction==='sent'&&frame.type==='update'&&frame.updateId===ack.updateId&&frame.gestureId===ack.gestureId);
   expect(submitted).toHaveLength(1);expect(submitted[0]!.epoch).toBe(beforeRace.head.epoch);
   expect(ack.seq).toBeGreaterThan(beforeRace.head.seq);expect(ack.seq).toBeLessThanOrEqual(raced.head.seq);
   return {process:index,userId:identities[index],updateId:ack.updateId,gestureId:ack.gestureId,seq:ack.seq};
  }));
  expect(accepted).toHaveLength(raced.head.seq-beforeRace.head.seq);expect(new Set(accepted.map(ack=>ack.seq)).size).toBe(accepted.length);
  records.push({phase:'concurrent-ACK-attribution',before:beforeRace.head,after:raced.head,accepted});
  await expect(owner.getByTestId('board-fabric-surface')).toHaveAttribute('data-viewport-zoom',fromDelta.zoom!);await expect(editor.getByTestId('board-fabric-surface')).toHaveAttribute('data-viewport-zoom',toDelta.zoom!);
  retainedConnector({...beforeRace.edge.connector!,from:undefined,to:undefined,fromPoint:{x:290+fromDelta.x,y:270+fromDelta.y},toPoint:{x:1050+toDelta.x,y:470+toDelta.y}},raced.edge.connector!);
  for(const page of pages)await page.reload();expect((await stable('all-processes-reloaded')).objects).toEqual(raced.objects);
  await viewer.getByTestId(`board-a11y-object-${edgeId}`).focus();await viewer.getByTestId(`board-a11y-object-${edgeId}`).press('Enter');
  await expect(viewer.getByTestId('board-connector-width-open')).toBeDisabled();await expect(viewer.getByTestId('board-connector-label-open')).toBeDisabled();await expect(viewer.getByTestId('board-connector-handle-from')).toHaveCount(0);
  const runtimeAfter=await Promise.all(chunkReaders.map(async read=>verifyRuntimeIdentity(api,sha,await read())));
  expect(browserErrors).toEqual([]);records.push({runtimeBefore,runtimeAfter,identities,processIds,traffic,independentBrowserLaunches:browsers.length,engines:browsers.map(browser=>browser.version())});
 }catch(error){failure=error;}
 finally{
  if(boardId&&ownerToken){try{cleanup.push(await deleteOwnedConnectorFixture(api,ownerToken,boardId,F.userId,'C05 independent Connector processes'));}catch(error){failure??=error;}}
  for(const browser of browsers){try{await browser.close();}catch(error){failure??=error;}}
  const path=info.outputPath('connector-independent-process-result.json');await writeFile(path,JSON.stringify({sha,status:failure?'failed':'C05-process-subcases-passed',requiredC05Complete:false,requiredRoundComplete:false,records,screenshots,cleanup,browserErrors,pending:['C05 actual browser execution and independent visual review','C06 complete denial and gesture races','C07 concurrent history','C08 full-field interchange','390px independent-process case']},null,2),{mode:0o600});await info.attach('connector-independent-process-result',{path,contentType:'application/json'});
 }
 if(failure)throw failure;
});
