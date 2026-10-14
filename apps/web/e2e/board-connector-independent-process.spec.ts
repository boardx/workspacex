import {connectorBoardLogin} from './support/connector-authenticated-login';
import {test,expect,chromium,type Page,type Browser} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import * as Y from 'yjs';
import type {WhiteboardConnector} from '@repo/contracts/whiteboard-document';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {boardApi,boardHead,canonicalBoardSnapshot,createAcceptanceBoard,object,createCommands,operate} from './board-acceptance-support';
import {runtimeSourceIdentity,observeRuntimeChunks,verifyRuntimeIdentity,sha256} from './board-runtime-evidence';
import {independentProcessIds,cubicSamples,curveMeasurement,acceptedGesture,retainedConnector,connectorStorageReference,navigationPrefetchAbort,glyphBounds,glyphProof,strokeRasterProof} from './support/connector-c05-oracle.mjs';
import {deleteOwnedConnectorFixture} from './support/connector-acceptance-fixture';
import {verifyConnectorRuntimeManifest} from './support/connector-runtime-manifest';

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
 const sha=runtimeSourceIdentity(),browsers:Browser[]=[],pages:Page[]=[],records:unknown[]=[],cleanup:unknown[]=[],cleanupErrors:unknown[]=[],processIds:number[]=[],browserErrors:string[]=[];
 let boardId='',ownerToken='',failure:unknown;
 const navigationPrefetchAborts:Array<{process:number;method:string;pathname:string;errorText:string;nextRouterPrefetch:true}>=[];
 const screenshots:Array<{phase:string;process:number;path:string;sha256:string}>=[];
 const traffic:Array<Array<{direction:'sent'|'received';type:string;updateId?:string;gestureId?:string;epoch?:number;seq?:number;code?:string}>>=[[],[],[]];
 // Private protocol replicas predict concurrent CRDT resolution independently of API projection.
 // Binary content stays in memory; public evidence retains only protocol identity and numeric outcomes.
 const protocolDocs=Array.from({length:3},()=>new Y.Doc());
 const submittedUpdates=new Map<string,Uint8Array>();
 const capture=async(phase:string)=>{for(let index=0;index<pages.length;index++){const path=info.outputPath(`${phase}-process-${index}.png`),bytes=await pages[index]!.screenshot({path});screenshots.push({phase,process:index,path,sha256:sha256(bytes)});}};
 let manifestBefore:Awaited<ReturnType<typeof verifyConnectorRuntimeManifest>>|undefined;
 try{
  manifestBefore=await verifyConnectorRuntimeManifest();records.push({phase:'runtime-manifest-before',...manifestBefore});
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
     if(typeof message.update==='string'){
      const bytes=new Uint8Array(Buffer.from(message.update,'base64'));
      if(direction==='received'&&(message.type==='sync'||message.type==='update'))Y.applyUpdate(protocolDocs[index]!,bytes);
      if(direction==='sent'&&message.type==='update'&&typeof message.updateId==='string')submittedUpdates.set(message.updateId,bytes);
     }
     // Retain protocol identity only, never credentials or document payload bytes.
     traffic[index]!.push({direction,type:String(message.type),...(typeof message.updateId==='string'?{updateId:message.updateId}:{}),...(typeof message.gestureId==='string'?{gestureId:message.gestureId}:{}),...(typeof message.epoch==='number'?{epoch:message.epoch}:{}),...(typeof message.seq==='number'?{seq:message.seq}:{}),...(typeof message.code==='string'?{code:message.code}:{})});
    };
    socket.on('framesent',frame=>observe('sent',frame.payload));socket.on('framereceived',frame=>observe('received',frame.payload));
   });
   page.on('pageerror',()=>browserErrors.push(`process-${index}:pageerror`));page.on('console',message=>{if(message.type()==='error')browserErrors.push(`process-${index}:console-error`);});
   page.on('requestfailed',request=>{
    const method=request.method(),pathname=new URL(request.url()).pathname,rawError=request.failure()?.errorText??'UNKNOWN',errorText=/^net::ERR_[A-Z_]+$/.test(rawError)?rawError:'UNKNOWN',prefetch=request.headers()['next-router-prefetch'];
    if(navigationPrefetchAbort({method,pathname,errorText,prefetch,knownProjectPath:`/projects/${encodeURIComponent(F.projectId)}`})){navigationPrefetchAborts.push({process:index,method,pathname,errorText,nextRouterPrefetch:true});return;}
    browserErrors.push(`process-${index}:${method}:${pathname}:request-failed:${errorText}:nextRouterPrefetch=${prefetch==='1'}:rsc=${request.headers()['rsc']==='1'}`);
   });
  }
  independentProcessIds(processIds);
  const nativeStrokeCounterexamples=await pages[0]!.evaluate(()=>{
   const result:Array<{angle:number;width:number;scan:Array<{offset:number;ink:boolean}>}>=[];
   for(const angle of [0,Math.PI/4])for(const width of [8,10,12]){
    const canvas=document.createElement('canvas');canvas.width=200;canvas.height=200;
    const context=canvas.getContext('2d')!;context.fillStyle='#FFFFFF';context.fillRect(0,0,200,200);
    context.strokeStyle='#E11D48';context.lineWidth=width;context.beginPath();
    context.moveTo(100-70*Math.cos(angle),100-70*Math.sin(angle));context.lineTo(100+70*Math.cos(angle),100+70*Math.sin(angle));context.stroke();
    const scan=Array.from({length:61},(_,index)=>{
     const offset=index-30,rgba=context.getImageData(Math.round(100-Math.sin(angle)*offset),Math.round(100+Math.cos(angle)*offset),1,1).data;
     return {offset,ink:rgba[0]===225&&rgba[1]===29&&rgba[2]===72&&rgba[3]===255};
    });result.push({angle,width,scan});
   }return result;
  });
  for(const angle of [0,Math.PI/4]){
   const reference=nativeStrokeCounterexamples.find(sample=>sample.angle===angle&&sample.width===12)!;
   strokeRasterProof(reference.scan,reference.scan);
   for(const width of [8,10])expect(()=>strokeRasterProof(nativeStrokeCounterexamples.find(sample=>sample.angle===angle&&sample.width===width)!.scan,reference.scan),'Real narrow native stroke must reject against independently rendered nominal12').toThrow();
  }
  records.push({phase:'native-stroke-negative-controls',cases:nativeStrokeCounterexamples.map(sample=>({angle:sample.angle,width:sample.width,fullInkCount:sample.scan.filter(point=>point.ink).length}))});

  const [owner,editor,viewer]=pages as [Page,Page,Page],chunkReaders=pages.map(observeRuntimeChunks);
  const accounts:Array<[string,string,string]>=[[F.email,F.password,F.userId],[F.adminEmail,F.adminPassword,F.adminUserId],[F.leadEmail,F.leadPassword,F.leadUserId]];
  const tokens:string[]=[],identities:string[]=[];
  for(let index=0;index<pages.length;index++){
   tokens.push(await connectorBoardLogin(pages[index]!,info,accounts[index]![0],accounts[index]![1],accounts[index]![2]));
   identities.push(accounts[index]![2]!);
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
   const relation=authoritative.edge.connector!,label=relation.label;
   if(typeof label!=='string'||!label.trim())throw new Error('Expected complete nonempty Connector label for local text and glyph verification');
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
     // The current screenshot-approved trigger is icon-only; inspect the
     // actual width palette instead of expecting obsolete numeric button text.
     await page.getByTestId('board-connector-width-open').click();
     const widthGroup=page.getByRole('group',{name:'连接线粗细预设',exact:true});
     await expect(widthGroup).toBeVisible();
     const activeWidth=widthGroup.getByRole('button',{name:`${relation.strokeWidth} px`,exact:true});
     await expect(activeWidth).toHaveAttribute('aria-pressed','true');
     await expect(widthGroup.locator('button[aria-pressed="true"]')).toHaveCount(1);
     await expect(activeWidth.locator('span[aria-hidden="true"]')).toHaveCSS('height',`${relation.strokeWidth}px`);
     await page.keyboard.press('Escape');
     await page.getByTestId('board-connector-label-open').click();await expect(page.getByTestId('board-connector-label')).toHaveValue(label);await page.keyboard.press('Escape');
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
    // Protocol/DOM readiness precedes Fabric's requestRenderAll frame. Wait for
    // two actual paint callbacks, then ensure the sampled canonical head stayed fixed.
    await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
    expect(await state(),`${phase}: canonical state must stay fixed across paint frames`).toEqual(authoritative);
    const raster=await page.locator('canvas.lower-canvas').evaluate((canvas,input)=>{
     const element=canvas as HTMLCanvasElement,context=element.getContext('2d')!,surface=element.closest('[data-testid="board-fabric-surface"]') as HTMLElement,rect=element.getBoundingClientRect();
     const zoom=Number(surface.dataset.viewportZoom),panX=Number(surface.dataset.viewportPanX),panY=Number(surface.dataset.viewportPanY),scale=element.width/rect.width;
     const px=(x:number)=>Math.round((panX+zoom*x)*scale),py=(y:number)=>Math.round((panY+zoom*y)*scale);
     const x=px(input.labelPoint.x)-150,y=py(input.labelPoint.y)-30;
     if(x<0||y<0||x+300>element.width||y+60>element.height)throw new Error('Label raster must fit actual canvas');
     const label=Array.from(context.getImageData(x,y,300,60).data);
     const golden=document.createElement('canvas');golden.width=300;golden.height=60;const goldenContext=golden.getContext('2d')!;
     // Native Canvas text is an independent glyph oracle, not Fabric or a copy of its rendered bytes.
     goldenContext.font=`${13*zoom*scale}px "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif`;goldenContext.fillStyle='#000000';
     // Preserve the floating bitmap center relative to the integer crop.
     // Rounding this center first changes subpixel rasterization of small glyphs.
     const centerX=(panX+zoom*input.labelPoint.x)*scale-x,centerY=(panY+zoom*input.labelPoint.y)*scale-y;
     goldenContext.textAlign='center';goldenContext.textBaseline='alphabetic';
     const metrics=goldenContext.measureText(input.label),ascent=metrics.actualBoundingBoxAscent,descent=metrics.actualBoundingBoxDescent;
     if(![centerX,centerY,ascent,descent].every(Number.isFinite)||ascent+descent<=0)throw new Error('C05_NATIVE_GLYPH_METRICS_REQUIRED');
     // Center the independently measured ink around labelPosition, rather than
     // copying Fabric's private 1.13/0.222 line-box baseline constants.
     const baselineY=centerY+(ascent-descent)/2;
     // The actual label has opaque white paper. A transparent oracle changes
     // the existing alpha>200 mask's coverage meaning even for the same font.
     goldenContext.fillStyle='#FFFFFF';goldenContext.fillRect(0,0,300,60);
     goldenContext.fillStyle=input.textColor;goldenContext.fillText(input.label,centerX,baselineY);
     const t=.12,u=1-t,{start,end,route}=input;
     const dx=3*u*u*route.startOffset.x+6*u*t*(end.x+route.endOffset.x-start.x-route.startOffset.x)-3*t*t*route.endOffset.x;
     const dy=3*u*u*route.startOffset.y+6*u*t*(end.y+route.endOffset.y-start.y-route.startOffset.y)-3*t*t*route.endOffset.y;
     const length=Math.hypot(dx,dy),normal={x:-dy/length,y:dx/length},point=input.sample;
     const strokeReference=document.createElement('canvas');strokeReference.width=element.width;strokeReference.height=element.height;
     const strokeContext=strokeReference.getContext('2d')!;strokeContext.fillStyle='#FFFFFF';strokeContext.fillRect(0,0,strokeReference.width,strokeReference.height);
     const physical=(point:{x:number;y:number})=>({x:(panX+zoom*point.x)*scale,y:(panY+zoom*point.y)*scale});
     const p0=physical(start),p1=physical({x:start.x+route.startOffset.x,y:start.y+route.startOffset.y}),p2=physical({x:end.x+route.endOffset.x,y:end.y+route.endOffset.y}),p3=physical(end);
     strokeContext.strokeStyle='#E11D48';strokeContext.lineWidth=input.width*zoom*scale;strokeContext.beginPath();strokeContext.moveTo(p0.x,p0.y);strokeContext.bezierCurveTo(p1.x,p1.y,p2.x,p2.y,p3.x,p3.y);strokeContext.stroke();
     let referenceInkLength=0;const coverageScan:Array<{offset:number;rgba:number[];referenceRgba:number[]}>=[];
     let lineWidth=0;const bitmapSamples=new Set<string>();const scan:Array<{offset:number;ink:boolean}>=[];
     // Keep every 1px normal-distance sample. Rounded bitmap coordinates may
     // repeat on a diagonal; deduplicating them undercounts physical thickness.
     for(let offset=-30;offset<=30;offset++){
      const x=px(point.x)+Math.round(normal.x*offset),y=py(point.y)+Math.round(normal.y*offset);
      bitmapSamples.add(`${x}:${y}`);
      const rgba=context.getImageData(x,y,1,1).data,ink=rgba[0]===225&&rgba[1]===29&&rgba[2]===72&&rgba[3]===255;if(ink)lineWidth++;scan.push({offset,ink});
      const referenceRgba=strokeContext.getImageData(x,y,1,1).data;
      if(referenceRgba[0]===225&&referenceRgba[1]===29&&referenceRgba[2]===72&&referenceRgba[3]===255)referenceInkLength++;
      coverageScan.push({offset,rgba:Array.from(rgba),referenceRgba:Array.from(referenceRgba)});
     }
     return {label,golden:Array.from(goldenContext.getImageData(0,0,300,60).data),scan,lineWidth,expectedWidth:input.width*zoom*scale,zoom,scale,normal,referenceInkLength,coverageScan,scalarSpacing:1,duplicateCount:scan.length-bitmapSamples.size,reference:{centerX,centerY,baselineY,ascent,descent,fontAscent:metrics.fontBoundingBoxAscent,fontDescent:metrics.fontBoundingBoxDescent}};
    },{start,end,route,label,labelPoint,sample:samples[0]!,width:relation.strokeWidth!,textColor:authoritative.edge.style.color??'#29261E'});
    await info.attach(`${phase}-process-${pages.indexOf(page)}-glyph-metrics`,{body:JSON.stringify({reference:raster.reference,actual:glyphBounds(raster.label),expected:glyphBounds(raster.golden)}),contentType:'application/json'});
    glyphProof(raster.label,raster.golden);
    const strokeDiagnostic={phase,process:pages.indexOf(page),inkLength:raster.lineWidth,expectedPixelWidth:raster.expectedWidth,delta:raster.lineWidth-raster.expectedWidth,zoom:raster.zoom,scale:raster.scale,canonicalWidth:relation.strokeWidth,normal:raster.normal,referenceInkLength:raster.referenceInkLength,coverageScan:raster.coverageScan,scalarSpacing:raster.scalarSpacing,duplicateCount:raster.duplicateCount,firstInkOffset:raster.scan.find(sample=>sample.ink)?.offset,lastInkOffset:raster.scan.findLast(sample=>sample.ink)?.offset,from:start,to:end};
    await info.attach(`${phase}-process-${pages.indexOf(page)}-stroke-metrics`,{body:JSON.stringify(strokeDiagnostic),contentType:'application/json'});
    const referenceScan=raster.coverageScan.map(sample=>({offset:sample.offset,ink:sample.referenceRgba[0]===225&&sample.referenceRgba[1]===29&&sample.referenceRgba[2]===72&&sample.referenceRgba[3]===255}));
    strokeRasterProof(raster.scan,referenceScan);
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
  const concurrentBaseline=Y.encodeStateAsUpdate(protocolDocs[0]!);
  await Promise.all([owner.getByTestId('board-connector-width-4').click(),editor.getByTestId('board-connector-width-12').click()]);
  await owner.keyboard.press('Escape');await editor.keyboard.press('Escape');
  const sameField=await stable('same-field-width-converged');proof(sameFieldBefore.head,sameField.head,sameFieldOffsets,[0,1]);
  const concurrentUpdates=[0,1].map(index=>{
   const sent=traffic[index]!.slice(sameFieldOffsets[index]).filter(frame=>frame.direction==='sent'&&frame.type==='update');
   expect(sent).toHaveLength(1);
   const bytes=submittedUpdates.get(sent[0]!.updateId!);expect(bytes).toBeDefined();return bytes!;
  });
  const predictConnector=(order:number[],baseline=concurrentBaseline,updates=concurrentUpdates):WhiteboardConnector=>{
   const reference=new Y.Doc();try{
    Y.applyUpdate(reference,baseline);
    for(const index of order)Y.applyUpdate(reference,updates[index]!);
    const connector=connectorStorageReference(reference.getMap<Y.Map<unknown>>('objects').get(edgeId)!.toJSON());
    return structuredClone(connector);
   }finally{reference.destroy();}
  };
  // Each actual update must independently carry its intended width, before resolving the conflict.
  expect(predictConnector([0]).strokeWidth).toBe(4);expect(predictConnector([1]).strokeWidth).toBe(12);
  const predictedConnector=predictConnector([0,1]),predictedWidth=predictedConnector.strokeWidth;
  expect(predictConnector([1,0]),'Concurrent Yjs winner must be independent of delivery order').toEqual(predictedConnector);
  expect(sameField.edge.connector).toEqual(predictedConnector);
  for(const [index,replica] of protocolDocs.entries()){
   expect(connectorStorageReference(replica.getMap<Y.Map<unknown>>('objects').get(edgeId)!.toJSON()),`Process ${index} authoritative stream must match independent reference`).toEqual(predictedConnector);
  }
  expect(sameField.edge.connector!.strokeWidth,'Canonical width must match independently replayed CRDT winner').toBe(predictedWidth);
  records.push({phase:'same-field-independent-CRDT-proof',baselineSha256:sha256(Buffer.from(concurrentBaseline)),individualWidths:[4,12],predictedWidth,deliveryOrdersAgree:true});
  retainedConnector({...sameFieldBefore.edge.connector!,strokeWidth:predictedWidth},sameField.edge.connector!);
  await select(owner);await select(editor);const beforeRace=await state(),raceOffsets=traffic.map(frames=>frames.length),endpointBaseline=Y.encodeStateAsUpdate(protocolDocs[0]!);
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
  const endpointUpdates=[0,1].map(index=>{
   const sent=traffic[index]!.slice(raceOffsets[index]).filter(frame=>frame.direction==='sent'&&frame.type==='update');
   expect(sent).toHaveLength(1);const bytes=submittedUpdates.get(sent[0]!.updateId!);expect(bytes).toBeDefined();return bytes!;
  });
  const expectedFrom={x:290+fromDelta.x,y:270+fromDelta.y},expectedTo={x:1050+toDelta.x,y:470+toDelta.y};
  const individualEndpoints=[predictConnector([0],endpointBaseline,endpointUpdates),predictConnector([1],endpointBaseline,endpointUpdates)];
  retainedConnector({...beforeRace.edge.connector!,from:undefined,fromPoint:expectedFrom},individualEndpoints[0]!);
  retainedConnector({...beforeRace.edge.connector!,to:undefined,toPoint:expectedTo},individualEndpoints[1]!);
  const expectedRace={...beforeRace.edge.connector!,from:undefined,to:undefined,fromPoint:expectedFrom,toPoint:expectedTo};
  retainedConnector(expectedRace,predictConnector([0,1],endpointBaseline,endpointUpdates));
  expect(predictConnector([1,0],endpointBaseline,endpointUpdates)).toEqual(predictConnector([0,1],endpointBaseline,endpointUpdates));
  for(const replica of protocolDocs)retainedConnector(expectedRace,connectorStorageReference(replica.getMap<Y.Map<unknown>>('objects').get(edgeId)!.toJSON()));
  records.push({phase:'concurrent-endpoint-intent-proof',baselineSha256:sha256(Buffer.from(endpointBaseline)),updateSha256:endpointUpdates.map(bytes=>sha256(Buffer.from(bytes))),individualEndpoints:individualEndpoints.map((connector,process)=>({process,from:connector.from,to:connector.to,fromPoint:connector.fromPoint,toPoint:connector.toPoint})),expectedFrom,expectedTo});

  await expect(owner.getByTestId('board-fabric-surface')).toHaveAttribute('data-viewport-zoom',fromDelta.zoom!);await expect(editor.getByTestId('board-fabric-surface')).toHaveAttribute('data-viewport-zoom',toDelta.zoom!);
  retainedConnector({...beforeRace.edge.connector!,from:undefined,to:undefined,fromPoint:{x:290+fromDelta.x,y:270+fromDelta.y},toPoint:{x:1050+toDelta.x,y:470+toDelta.y}},raced.edge.connector!);
  for(const page of pages)await page.reload();expect((await stable('all-processes-reloaded')).objects).toEqual(raced.objects);
  await viewer.getByTestId(`board-a11y-object-${edgeId}`).focus();await viewer.getByTestId(`board-a11y-object-${edgeId}`).press('Enter');
  await expect(viewer.getByTestId('board-connector-width-open')).toBeDisabled();await expect(viewer.getByTestId('board-connector-label-open')).toBeDisabled();await expect(viewer.getByTestId('board-connector-handle-from')).toHaveCount(0);
  const runtimeAfter=await Promise.all(chunkReaders.map(async read=>verifyRuntimeIdentity(api,sha,await read())));
  records.push({phase:'navigation-prefetch-aborts',count:navigationPrefetchAborts.length,requests:navigationPrefetchAborts});
  expect(browserErrors).toEqual([]);records.push({runtimeBefore,runtimeAfter,identities,processIds,traffic,independentBrowserLaunches:browsers.length,engines:browsers.map(browser=>browser.version())});
 }catch(error){failure=error;}
 finally{
  if(boardId&&ownerToken){try{cleanup.push(await deleteOwnedConnectorFixture(api,ownerToken,boardId,F.userId,'C05 independent Connector processes'));}catch(error){cleanupErrors.push(error);}}
  for(const replica of protocolDocs)replica.destroy();submittedUpdates.clear();
  for(const browser of browsers){try{await browser.close();}catch(error){cleanupErrors.push(error);}}
  try{expect(manifestBefore).toBeTruthy();records.push({phase:'runtime-manifest-after',...await verifyConnectorRuntimeManifest(manifestBefore)});}catch(error){cleanupErrors.push(error);}
  if(cleanupErrors.length)failure=new AggregateError([...(failure?[failure]:[]),...cleanupErrors],'Connector process execution/cleanup/provenance failures');
  const path=info.outputPath('connector-independent-process-result.json');await writeFile(path,JSON.stringify({sha,status:failure?'failed':'C05-process-subcases-passed',requiredC05Complete:false,requiredRoundComplete:false,records,screenshots,cleanup,browserErrors,navigationPrefetchAbortCount:navigationPrefetchAborts.length,navigationPrefetchAborts,pending:['C05 actual browser execution and independent visual review','C06 complete denial and gesture races','C07 concurrent history','C08 full-field interchange','390px independent-process case']},null,2),{mode:0o600});await info.attach('connector-independent-process-result',{path,contentType:'application/json'});
 }
 if(failure)throw failure;
});
