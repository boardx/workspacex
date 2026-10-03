import {test,expect,type Page,type TestInfo,type APIRequestContext} from '@playwright/test';
import {randomUUID,createHash} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {boardApi,boardLogin,createAcceptanceBoard,canonicalBoardSnapshot,createCommands,object,openBoard,settled} from './board-acceptance-support';
import {observeRuntimeChunks,runtimeSourceIdentity,verifyRuntimeIdentity} from './board-runtime-evidence';
import {createSpatialWsMetadataRecorder} from './support/board-spatial-ws-metadata';
import {sampleLiteralShapeStroke,assertPoints,assertAtomicRevision,assertEraseObjects,assertStrokePixels,assertTransparentPixels,drawingPointWorld,expandedDrawingGeometry,entityCorners,entityPoint,offsetAnchor,pointerRotation,rotatePoint,transformGeometry} from './support/board-r01-oracle';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {boardImagePngFixture} from './support/board-image-fixture';
import {expectBoardSynced} from './support/board-sync-status';
import {boardToolbarPosition} from '../components/whiteboard/use-board-toolbar-position';
import {BOARD_FABRIC_VISUAL} from '../components/whiteboard/fabric/board-fabric-visual';

const root=resolve(__dirname,'../../..');
async function viewport(page:Page){
 const surface=page.getByTestId('board-fabric-surface'),box=(await surface.boundingBox())!;
 expect(box).not.toBeNull();
 const z=Number(await surface.getAttribute('data-viewport-zoom')),x=Number(await surface.getAttribute('data-viewport-pan-x')),y=Number(await surface.getAttribute('data-viewport-pan-y'));
 expect(z).toBeGreaterThan(0);expect([z,x,y].every(Number.isFinite)).toBe(true);return {z,x,y,box};
}
async function topCanvas(page:Page,point:{x:number;y:number}){expect(await page.evaluate(point=>document.elementFromPoint(point.x,point.y)?.matches('canvas.upper-canvas')??false,point)).toBe(true);}
async function capture(page:Page,info:TestInfo,name:string){const path=info.outputPath(`${name}-${page.viewportSize()!.width}.png`);await page.screenshot({path});await info.attach(name,{path,contentType:'image/png'});}
async function rgba(page:Page,point:{x:number;y:number},size=3){
 return page.getByTestId('board-fabric-surface').locator('canvas.lower-canvas').evaluate((element,{point,size})=>{
  const canvas=element as HTMLCanvasElement,box=canvas.getBoundingClientRect(),context=canvas.getContext('2d');if(!context)throw new Error('R01_PIXELS_REQUIRED');
  if(![point.x,point.y,box.x,box.y,box.width,box.height,canvas.width,canvas.height].every(Number.isFinite)||box.width<=0||box.height<=0||canvas.width<=0||canvas.height<=0||!Number.isSafeInteger(size)||size<=0)throw new Error('R01_PIXEL_GEOMETRY_INVALID');
  const x=Math.floor((point.x-box.x)*canvas.width/box.width)-Math.floor(size/2),y=Math.floor((point.y-box.y)*canvas.height/box.height)-Math.floor(size/2);
  if(x<0||y<0||x+size>canvas.width||y+size>canvas.height)throw new Error('R01_PIXEL_ROI_OUT_OF_BOUNDS');
  return [...context.getImageData(x,y,size,size).data];
 },{point,size});
}
async function shapeStrokePixels(page:Page,geometry:{x:number;y:number;width:number;height:number;rotation:number},view:Awaited<ReturnType<typeof viewport>>,held=false){
 const lower=page.getByTestId('board-fabric-surface').locator('canvas.lower-canvas');
 const grid=await lower.evaluate((element,view)=>{const canvas=element as HTMLCanvasElement,box=canvas.getBoundingClientRect();if(![box.width,box.height].every(Number.isFinite)||box.width<=0||box.height<=0)throw new Error('R01_STROKE_GRID_INVALID');return {sx:canvas.width/box.width,sy:canvas.height/box.height,zoom:view.z,panX:view.box.x-box.x+view.x,panY:view.box.y-box.y+view.y};},view);
 const selectionChrome=held?{color:BOARD_FABRIC_VISUAL.selection.borderColor,borderWidth:BOARD_FABRIC_VISUAL.selection.borderScaleFactor,padding:0}:undefined;
 const samples=await lower.evaluate(sampleLiteralShapeStroke,{geometry,grid,selectionChrome});
 const fill=await lower.evaluate(sampleLiteralShapeStroke,{geometry,grid,variant:'none' as const});
 for(const [edge,sample] of samples.entries()){if(!sample.reference.some((value,index)=>Math.abs(value-fill[edge]!.reference[index]!)>5))throw new Error(held?'R01_EMPTY_CHROME_COMPOSITE_REFERENCE':'R01_EMPTY_STROKE_REFERENCE');for(let index=0;index<sample.reference.length;index++)if(Math.abs(sample.reference[index]!-sample.observed[index]!)>5)throw new Error(held?'R01_LITERAL_CHROME_COMPOSITE_MISMATCH':'R01_LITERAL_STROKE_PIXEL_MISMATCH');}
}
async function withBoard(page:Page,api:APIRequestContext,info:TestInfo,run:(binding:{token:string;boardId:string;transport:ReturnType<typeof createSpatialWsMetadataRecorder>})=>Promise<void>){
 let boardId:string|undefined,token:string|undefined,serverActor:string|undefined,source:ReturnType<typeof runtimeSourceIdentity>|undefined,verify:(()=>Promise<unknown>)|undefined,beforeProof:unknown,afterProof:unknown,failure:unknown;
 const title=`R01 native matrix ${randomUUID()}`,transport=createSpatialWsMetadataRecorder(),chunks=observeRuntimeChunks(page);transport.observe(page,'original');
 try{
  source=runtimeSourceIdentity();
  const manifestPath=process.env.BOARD_CONNECTOR_RUNTIME_MANIFEST;if(!manifestPath)throw new Error('R01_NATIVE_MANIFEST_REQUIRED');
  const verifierPath=join(root,'apps/web/e2e/support/native-runtime/runtime-attestation.mjs'),selectorPath=join(root,'scripts/local-session/board-runtime-source-files.mjs'),authority=await import(pathToFileURL(verifierPath).href),selector=await import(pathToFileURL(selectorPath).href);
  const sourceFiles=selector.listRuntimeSourceFiles(root);
  verify=async()=>{const manifestBytes=await readFile(manifestPath),verifierBytes=await readFile(verifierPath),selectorBytes=await readFile(selectorPath),identity=authority.verifyRuntimeManifest({manifestPath,root,base:process.env.BOARD_R01_WEB_URL,origin:`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`,sourceFiles});expect(JSON.parse(manifestBytes.toString()).head).toBe(process.env.BOARD_ACCEPTANCE_SHA);return {identity,manifestHash:createHash('sha256').update(manifestBytes).digest('hex'),verifierHash:createHash('sha256').update(verifierBytes).digest('hex'),selectorHash:createHash('sha256').update(selectorBytes).digest('hex')};};beforeProof=await verify();
  token=await boardLogin(page);const identity=await(await boardApi(api,token,'GET','/kernel/probe/whoami')).json();expect(identity.userId).toBe(F.userId);serverActor=identity.userId;boardId=await createAcceptanceBoard(api,token,title);
  await run({token,boardId,transport});await verifyRuntimeIdentity(api,source,await chunks());
 }catch(error){failure=error;throw error;}
 finally{
  const errors:unknown[]=[];
  let owned=false;if(boardId&&token)try{const board=await(await boardApi(api,token,'GET',`/whiteboards/${boardId}`)).json();expect(board.ownerId).toBe(F.userId);expect(board.name).toBe(title);owned=true;}catch(error){errors.push(error);}
  try{afterProof=await verify?.();expect(afterProof).toEqual(beforeProof);}catch(error){errors.push(error);}
  try{const screenshots=await Promise.all(info.attachments.filter(item=>item.contentType==='image/png'&&item.path).map(async item=>({name:item.name,sha256:createHash('sha256').update(await readFile(item.path!)).digest('hex')})));await writeFile(info.outputPath('r01-result.json'),JSON.stringify({source,serverActor,beforeProof,afterProof,screenshots,status:failure||errors.length?'failed':'functional-cases-passed',completed:false,cleanupPending:owned,boardId:owned?boardId:null,title:owned?title:null,hardwareTrackpad:'unverified',cancellationEvidence:'browser-dispatched pointercancel and blur; trusted mouse pan and release',transport:transport.snapshot()}),{mode:0o600});}catch(error){errors.push(error);}
  if(errors.length)throw new AggregateError(failure?[failure,...errors]:errors,'R01_FINAL_PROOF_FAILED');
 }
}

test('N01-N02 auxiliary pan held release cancellation and Select pointer wheel preserve the document',async({page,request:api},info)=>withBoard(page,api,info,async({token,boardId,transport})=>{
 const tile=object(randomUUID(),'rectangle',120,120,'',80,80);tile.style={fill:'#22C55E',stroke:'#22C55E'};
 await boardApi(api,token,'POST',`/whiteboards/${boardId}/commands`,{requestId:randomUUID(),epoch:1,commands:createCommands([tile])});await openBoard(page,boardId,1);
 await page.getByTestId('board-tool-select').click();const before=await canonicalBoardSnapshot(api,token,boardId);
 const unchanged=async()=>{expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(before);expect(transport.snapshot().events.filter(event=>event.direction==='sent'&&event.type==='update')).toEqual([]);await expect(page.getByTestId('board-a11y-selection-announcement')).toHaveText('未选择对象');};
 for(const button of ['middle','right'] as const)for(const finish of ['release','escape','pointercancel','blur'] as const){
  const v=await viewport(page),start={x:Math.round(v.box.x+30),y:Math.round(v.box.y+70)},delta={x:24,y:18};await topCanvas(page,start);
  const center={x:v.box.x+v.x+160*v.z,y:v.box.y+v.y+160*v.z},literalFill=await rgba(page,center);
  expect(literalFill.filter((value,index)=>index%4===1&&value===197).length).toBeGreaterThan(0);
  const movedEdge={x:v.box.x+v.x+200*v.z+delta.x/2,y:center.y+delta.y/2};
  const outside=await rgba(page,movedEdge);expect(outside.filter((value,index)=>index%4===3&&value!==0)).toEqual([]);
  await page.mouse.move(start.x,start.y);await page.mouse.down({button});await page.mouse.move(start.x+delta.x,start.y+delta.y,{steps:8});await settled(page);
  expect(await rgba(page,movedEdge)).toEqual(literalFill);await unchanged();await capture(page,info,`${button}-${finish}-held`);
  if(finish==='escape')await page.keyboard.press('Escape');
  if(finish==='pointercancel')await page.getByTestId('board-fabric-surface').locator('canvas.upper-canvas').dispatchEvent('pointercancel',{pointerId:1,pointerType:'mouse',isPrimary:true});
  if(finish==='blur')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
  await page.mouse.up({button});await settled(page);const next=await viewport(page);
  assertPoints([{x:next.x,y:next.y}],[{x:v.x+(finish==='release'?delta.x:0),y:v.y+(finish==='release'?delta.y:0)}]);await unchanged();
  await topCanvas(page,start);await page.mouse.click(start.x,start.y);await unchanged();await settled(page);await expectBoardSynced(page);await unchanged();
 }
 const v=await viewport(page),anchor={x:Math.round(v.box.x+250),y:Math.round(v.box.y+150)};await topCanvas(page,anchor);await page.mouse.move(anchor.x,anchor.y);
 await page.mouse.wheel(13,29);await expect.poll(async()=>{const next=await viewport(page);return [next.x,next.y,next.z];}).toEqual([v.x-13,v.y-29,v.z]);await unchanged();
 for(const modifier of ['Control','Meta'] as const){
  const prior=await viewport(page),world={x:(anchor.x-prior.box.x-prior.x)/prior.z,y:(anchor.y-prior.box.y-prior.y)/prior.z};
  await page.keyboard.down(modifier);try{await page.mouse.wheel(0,-37);}finally{await page.keyboard.up(modifier);}
  await expect.poll(async()=>(await viewport(page)).z).toBeGreaterThan(prior.z);const after=await viewport(page);
  assertPoints([{x:(anchor.x-after.box.x-after.x)/after.z,y:(anchor.y-after.box.y-after.y)/after.z}],[world]);await unchanged();await capture(page,info,`pointer-zoom-${modifier}`);
  await page.keyboard.down(modifier);try{await page.mouse.wheel(0,37);}finally{await page.keyboard.up(modifier);}
  await expect.poll(async()=>(await viewport(page)).z).toBeLessThan(after.z);const out=await viewport(page);
  assertPoints([{x:(anchor.x-out.box.x-out.x)/out.z,y:(anchor.y-out.box.y-out.y)/out.z}],[world]);expect(out.z).toBeCloseTo(prior.z,6);await unchanged();await capture(page,info,`pointer-zoom-out-${modifier}`);
 }
}));

test('N05 transformed multi drawing erase preserves image Sticky Shape and locked ink in one durable history transaction',async({page,request:api},info)=>withBoard(page,api,info,async({token,boardId,transport})=>{
 await openBoard(page,boardId,0);const surface=page.getByTestId('board-fabric-surface');
 for(let index=0;index<3;index++){
  await page.getByTestId('board-tool-select').click();const v=await viewport(page),blank={x:v.box.x+20,y:v.box.y+30};await topCanvas(page,blank);await page.mouse.click(blank.x,blank.y);
  await expect(page.getByTestId('board-a11y-selection-announcement')).toHaveText('未选择对象');await page.getByTestId('board-add-draw').click();await page.getByTestId('board-draw-pen').click();await page.getByTestId('board-draw-stroke-20').click();await page.getByTestId('board-draw-color-18181b').click();
  const start={x:Math.round(v.box.x+40+index*80),y:Math.round(v.box.y+90+index*35)},end={x:start.x+40,y:start.y+20};await topCanvas(page,start);await topCanvas(page,end);
  await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:12});await page.mouse.up();
  await expect.poll(async()=>(await canonicalBoardSnapshot(api,token,boardId)).objects.filter(object=>object.kind==='drawing').length).toBe(index+1);
 }
 await page.getByTestId('board-draw-select').click();const drawings=(await canonicalBoardSnapshot(api,token,boardId)).objects.filter(object=>object.kind==='drawing');
 expect(drawings).toHaveLength(3);
 const geometries=[{x:65,y:200,width:96,height:48,rotation:25},{x:195,y:230,width:80,height:40,rotation:-18},{x:125,y:120,width:65,height:32,rotation:40}];
 const sticky=object(randomUUID(),'sticky',65,345,'',60,45),shape=object(randomUUID(),'rectangle',265,345,'',55,45);
 sticky.extensionData={thinkingInput:{sticky:{variant:'rectangle',sizing:'fixed',color:'#FACC15'}}};shape.style={fill:'#22C55E'};
 await boardApi(api,token,'POST',`/whiteboards/${boardId}/commands`,{requestId:randomUUID(),epoch:1,commands:[...drawings.map((object,index)=>({type:'geometry',id:object.id,geometry:geometries[index]})),{type:'state',id:drawings[2]!.id,locked:true},...createCommands([sticky,shape])]});
 await page.getByTestId('board-add-image').click();await page.getByLabel('上传图片').setInputFiles({name:'r01-protected.png',mimeType:'image/png',buffer:boardImagePngFixture()});
 await expect.poll(async()=>(await canonicalBoardSnapshot(api,token,boardId)).objects.filter(object=>object.kind==='image').length).toBe(1);
 const image=(await canonicalBoardSnapshot(api,token,boardId)).objects.find(object=>object.kind==='image')!;
 await boardApi(api,token,'POST',`/whiteboards/${boardId}/commands`,{requestId:randomUUID(),epoch:1,commands:[{type:'geometry',id:image.id,geometry:{x:160,y:345,width:64,height:48,rotation:0}}]});
 await expect(surface.locator('canvas.lower-canvas')).toHaveCount(1);await page.getByTestId('board-tool-select').click();
 const v=await viewport(page),screen=(point:{x:number;y:number})=>({x:v.box.x+v.x+point.x*v.z,y:v.box.y+v.y+point.y*v.z});
 const clearSelection=async()=>{const current=await viewport(page),blank={x:current.box.x+current.x+20*current.z,y:current.box.y+current.y+30*current.z};await topCanvas(page,blank);await page.mouse.click(blank.x,blank.y);await expect(page.getByTestId('board-a11y-selection-announcement')).toHaveText('未选择对象');await settled(page);};await clearSelection();
 const baseline=await canonicalBoardSnapshot(api,token,boardId),sites=drawings.map((drawing,index)=>{
  const content=drawing.extensionData!.contentObject as {strokes:Array<{tool:string;color:string;width:number;opacity:number;points:Array<{x:number;y:number}>}>};
  expect(content.strokes).toHaveLength(1);expect(content.strokes[0]).toMatchObject({tool:'pen',color:'#18181B',width:20,opacity:1});
  const points=content.strokes[0]!.points,minX=Math.min(...points.map(point=>point.x)),maxX=Math.max(...points.map(point=>point.x)),minY=Math.min(...points.map(point=>point.y)),maxY=Math.max(...points.map(point=>point.y));
  expect(maxX-minX).toBeGreaterThan(0);expect(maxY-minY).toBeGreaterThan(0);const middle=points[Math.floor(points.length/2)]!,geometry=geometries[index]!;
  const point=entityPoint(geometry,{x:(middle.x-minX)*geometry.width/(maxX-minX),y:(middle.y-minY)*geometry.height/(maxY-minY)}),normal=rotatePoint({x:0,y:30},{x:0,y:0},geometry.rotation+Math.atan2(geometry.height,geometry.width)*180/Math.PI);
  return {point,guard:{x:point.x+normal.x,y:point.y+normal.y}};
 });
 const ink=await Promise.all(sites.map(site=>rgba(page,screen(site.point),11))),guards=await Promise.all(sites.map(site=>rgba(page,screen(site.guard),11)));
 for(let index=0;index<3;index++)assertStrokePixels(ink[index]!,[guards[index]!],[24,24,27]);
 const protectedSites=[{x:95,y:367},{x:185,y:367},{x:200,y:377},{x:290,y:367}];
 await expect.poll(()=>rgba(page,screen(protectedSites[1]!))).toEqual(Array.from({length:9},()=>[231,29,73,255]).flat());
 const protectedPixels=await Promise.all(protectedSites.map(point=>rgba(page,screen(point))));
 await page.getByTestId('board-add-draw').click();await page.getByTestId('board-draw-eraser').click();
 const route=[sites[0]!.point,sites[1]!.point,sites[2]!.point,...protectedSites],start=screen(route[0]!);
 // Observe trusted native inputs only; no Fabric state is read or changed.
 const eventStart=transport.snapshot().events.length,updates=()=>transport.snapshot().events.slice(eventStart).filter(event=>event.direction==='sent'&&event.type==='update');
 const trace=await page.evaluateHandle(()=>{
  let active=false;const points:Array<{x:number;y:number}>=[];
  const record=(event:MouseEvent)=>{if(active&&event.isTrusted)points.push({x:event.clientX,y:event.clientY});};
  const down=(event:MouseEvent)=>{if(event.isTrusted&&event.button===0){active=true;record(event);}},up=(event:MouseEvent)=>{record(event);active=false;};
  document.addEventListener('mousedown',down,true);document.addEventListener('mousemove',record,true);document.addEventListener('mouseup',up,true);
  return {points,dispose(){document.removeEventListener('mousedown',down,true);document.removeEventListener('mousemove',record,true);document.removeEventListener('mouseup',up,true);}};
 });
 let inputs:Array<{x:number;y:number}>=[];
 try{
  await topCanvas(page,start);await page.mouse.move(start.x,start.y);await page.mouse.down();
  for(const point of route.slice(1)){const position=screen(point);await topCanvas(page,position);await page.mouse.move(position.x,position.y,{steps:16});}
  expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(baseline);expect(updates()).toEqual([]);await capture(page,info,'multi-erase-held');await page.mouse.up();
 }finally{try{await page.mouse.up();}finally{inputs=await trace.evaluate(state=>{state.dispose();return state.points;});await trace.dispose();}}
 expect(inputs.length).toBeGreaterThan(route.length);const worldInputs=inputs.map(point=>({x:(point.x-v.box.x-v.x)/v.z,y:(point.y-v.box.y-v.y)/v.z}));
 for(const point of route){const intended=screen(point);expect(Math.min(...inputs.map(input=>Math.hypot(input.x-intended.x,input.y-intended.y)))).toBeLessThanOrEqual(1);}
 await expect.poll(async()=>(await canonicalBoardSnapshot(api,token,boardId)).revision.seq).toBe(baseline.revision.seq+1);
 const erased=await canonicalBoardSnapshot(api,token,boardId);assertAtomicRevision(baseline.revision,erased.revision,1);
 expect(updates()).toHaveLength(1);const sent=updates()[0]!;expect(sent.client).toBe('original');expect(typeof sent.updateId).toBe('string');expect(typeof sent.gestureId).toBe('string');expect(sent.epoch).toBe(baseline.revision.epoch);
 if(typeof sent.updateId!=='string')throw new Error('R01_UPDATE_ID_REQUIRED');const eraseUpdateId=sent.updateId;
 await expect.poll(()=>transport.snapshot().events.slice(eventStart).filter(event=>event.direction==='received'&&event.type==='ack'&&event.client===sent.client&&event.socketId===sent.socketId&&event.updateId===sent.updateId&&event.gestureId===sent.gestureId&&event.seq===erased.revision.seq).length).toBe(1);
 const expansions=Object.fromEntries(drawings.slice(0,2).map(drawing=>{const original=baseline.objects.find(object=>object.id===drawing.id)!,content=original.extensionData!.contentObject as {strokes:Array<{points:Array<{x:number;y:number}>}>};return [drawing.id,expandedDrawingGeometry(original.geometry,content.strokes.flatMap(stroke=>stroke.points),worldInputs)];}));
 assertEraseObjects(baseline.objects,erased.objects,drawings.slice(0,2).map(drawing=>drawing.id),expansions);
 for(const drawing of drawings.slice(0,2)){
  const original=baseline.objects.find(object=>object.id===drawing.id)!,after=erased.objects.find(object=>object.id===drawing.id)!;
  const originalStrokes=(original.extensionData!.contentObject as {strokes:Array<{id:string;points:Array<{x:number;y:number}>}>}).strokes,afterStrokes=(after.extensionData!.contentObject as {strokes:Array<{tool:string;color:string;width:number;opacity:number;erases:string[];points:Array<{x:number;y:number;pressure:number}>}>}).strokes;
  const oldPoints=originalStrokes.flatMap(stroke=>stroke.points),newPoints=afterStrokes.flatMap(stroke=>stroke.points);
  for(const point of oldPoints)assertPoints([drawingPointWorld(after.geometry,newPoints,point)],[drawingPointWorld(original.geometry,oldPoints,point)]);
  const mask=afterStrokes.at(-1)!;expect(mask.erases).toEqual(originalStrokes.map(stroke=>stroke.id));
  expect(mask.tool).toBe('eraser');expect(mask.color).toBe('#FFFFFF');expect(mask.opacity).toBe(1);expect(mask.points.every(point=>point.pressure===.5)).toBe(true);
  const xs=oldPoints.map(point=>point.x),ys=oldPoints.map(point=>point.y);expect(mask.width).toBeCloseTo(24*Math.min(Math.max(1,Math.max(...xs)-Math.min(...xs))/Math.max(1,original.geometry.width),Math.max(1,Math.max(...ys)-Math.min(...ys))/Math.max(1,original.geometry.height)),4);
  const maskWorld=mask.points.map(point=>drawingPointWorld(after.geometry,newPoints,point));expect(maskWorld.length).toBeGreaterThan(1);
  for(const actual of maskWorld)expect(Math.min(...worldInputs.map(input=>Math.hypot(input.x-actual.x,input.y-actual.y)))).toBeLessThanOrEqual(.01);
  for(const input of worldInputs)expect(Math.min(...maskWorld.map(actual=>Math.hypot(input.x-actual.x,input.y-actual.y)))).toBeLessThanOrEqual(.01);
 }
 await page.getByTestId('board-draw-select').click();await clearSelection();
 const erasedInk=await Promise.all(sites.map(site=>rgba(page,screen(site.point),11)));
 for(let index=0;index<2;index++){assertStrokePixels(erasedInk[index]!,[guards[index]!],[24,24,27],true);assertTransparentPixels(erasedInk[index]!);}
 expect(erasedInk[2]).toEqual(ink[2]);expect(await Promise.all(protectedSites.map(point=>rgba(page,screen(point))))).toEqual(protectedPixels);await capture(page,info,'multi-erase-protected');
 const assertHistoryReceipt=async(start:number,beforeRevision:typeof erased.revision,expected:typeof erased,previousUpdateId:string)=>{
  const historyEvents=()=>transport.snapshot().events.slice(start),historyUpdates=()=>historyEvents().filter(event=>event.direction==='sent'&&event.type==='update');
  await expect.poll(()=>historyUpdates().length).toBe(1);const update=historyUpdates()[0]!;
  expect(update.client).toBe('original');expect(typeof update.updateId).toBe('string');expect(update.updateId).not.toBe(previousUpdateId);expect(typeof update.gestureId).toBe('string');expect(update.epoch).toBe(beforeRevision.epoch);
  if(typeof update.updateId!=='string')throw new Error('R01_HISTORY_UPDATE_ID_REQUIRED');
  const matchingAcks=()=>historyEvents().filter(event=>event.direction==='received'&&event.type==='ack'&&event.client===update.client&&event.socketId===update.socketId&&event.updateId===update.updateId&&event.gestureId===update.gestureId&&event.seq===expected.revision.seq);
  await expect.poll(()=>matchingAcks().length).toBe(1);await settled(page);await expectBoardSynced(page);
  expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(expected);expect(historyUpdates()).toHaveLength(1);expect(matchingAcks()).toHaveLength(1);
  return update.updateId;
 };
 const undoStart=transport.snapshot().events.length;await page.keyboard.press('ControlOrMeta+z');await expect.poll(async()=>(await canonicalBoardSnapshot(api,token,boardId)).objects).toEqual(baseline.objects);
 const undone=await canonicalBoardSnapshot(api,token,boardId);assertAtomicRevision(erased.revision,undone.revision,1);const undoUpdateId=await assertHistoryReceipt(undoStart,erased.revision,undone,eraseUpdateId);
 await clearSelection();expect(await Promise.all(sites.map(site=>rgba(page,screen(site.point),11)))).toEqual(ink);await assertHistoryReceipt(undoStart,erased.revision,undone,eraseUpdateId);
 const redoStart=transport.snapshot().events.length;await page.keyboard.press('ControlOrMeta+Shift+z');await expect.poll(async()=>(await canonicalBoardSnapshot(api,token,boardId)).objects).toEqual(erased.objects);
 const redone=await canonicalBoardSnapshot(api,token,boardId);assertAtomicRevision(undone.revision,redone.revision,1);assertAtomicRevision(erased.revision,redone.revision,2);await assertHistoryReceipt(redoStart,undone.revision,redone,undoUpdateId);
 await clearSelection();expect(await Promise.all(sites.map(site=>rgba(page,screen(site.point),11)))).toEqual(erasedInk);await assertHistoryReceipt(redoStart,undone.revision,redone,undoUpdateId);
 await page.getByTestId('board-add-draw').click();await page.getByTestId('board-draw-eraser').click();const emptyStart=transport.snapshot().events.length,empty=screen({x:20,y:30});await topCanvas(page,empty);await page.mouse.move(empty.x,empty.y);await page.mouse.down();await page.mouse.move(empty.x+10,empty.y+5);await page.mouse.up();expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(redone);await settled(page);await expectBoardSynced(page);expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(redone);expect(transport.snapshot().events.slice(emptyStart).filter(event=>event.direction==='sent'&&event.type==='update')).toEqual([]);
 await page.reload();await expectBoardSynced(page);await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(6);expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(redone);await clearSelection();
 const refreshed=await viewport(page),refreshScreen=(point:{x:number;y:number})=>({x:refreshed.box.x+refreshed.x+point.x*refreshed.z,y:refreshed.box.y+refreshed.y+point.y*refreshed.z});
 for(let index=0;index<2;index++)assertTransparentPixels(await rgba(page,refreshScreen(sites[index]!.point),11));
 assertStrokePixels(await rgba(page,refreshScreen(sites[2]!.point),11),[await rgba(page,refreshScreen(sites[2]!.guard),11)],[24,24,27]);
 expect(await Promise.all(protectedSites.map(point=>rgba(page,refreshScreen(point))))).toEqual(protectedPixels);await capture(page,info,'multi-erase-refreshed');
}));

for(const matrixZoom of [.5,2])test(`N03-N04 native Sticky Shape Drawing multi transform at zoom ${matrixZoom} and nonzero pan preserves atomic history`,async({page,request:api},info)=>withBoard(page,api,info,async({token,boardId,transport})=>{
 const a=object(randomUUID(),'sticky',60,150,'',30,25),b=object(randomUUID(),'rectangle',120,175,'',40,35),drawing=object(randomUUID(),'drawing',95,210,'',35,21),edge=object(randomUUID(),'connector',130,175,'',60,50);
 a.geometry.rotation=17;b.geometry.rotation=-21;a.style={fill:'#22C55E'};b.style={fill:'#2563EB'};
 a.extensionData={thinkingInput:{sticky:{variant:'rectangle',sizing:'fixed',color:'#22C55E'}}};b.extensionData={contentObject:{version:1,type:'shape',variant:'rectangle',fill:'#2563EB',borderColor:'#2563EB',borderWidth:0,borderStyle:'solid',opacity:1,radius:0,textColor:'#000000',horizontalAlign:'center',verticalAlign:'middle'}};drawing.geometry.rotation=11;drawing.extensionData={contentObject:{version:1,type:'drawing',strokes:[{id:randomUUID(),tool:'pen',color:'#DC2626',width:24,opacity:1,points:[{x:0,y:0,pressure:.5},{x:50,y:30,pressure:.5}]}]}};
 (b.extensionData.contentObject as {borderWidth:number}).borderWidth=1;
 (b.extensionData.contentObject as {borderColor:string}).borderColor='#18181B';
 const fromOffset={x:7,y:-9},toOffset={x:-5,y:8};edge.style={stroke:'#18181B'};
 edge.connector={from:a.id,to:b.id,fromAnchor:'right',toAnchor:'left',fromOffset,toOffset,type:'straight',startStyle:'none',endStyle:'none',lineStyle:'solid',label:'',semanticRelation:''};
 const initialFrom=offsetAnchor(a.geometry,'right',fromOffset),initialTo=offsetAnchor(b.geometry,'left',toOffset);edge.geometry={x:Math.min(initialFrom.x,initialTo.x),y:Math.min(initialFrom.y,initialTo.y),width:Math.max(1,Math.abs(initialFrom.x-initialTo.x)),height:Math.max(1,Math.abs(initialFrom.y-initialTo.y)),rotation:0};
 await boardApi(api,token,'POST',`/whiteboards/${boardId}/commands`,{requestId:randomUUID(),epoch:1,commands:createCommands([a,b,drawing,edge])});await openBoard(page,boardId,4);
 await page.getByTestId('board-zoom-menu').click();await page.getByText('实际大小 100%',{exact:true}).click();
 for(let index=0;index<Math.round(Math.abs(matrixZoom-1)*10);index++){await page.getByTestId('board-zoom-menu').click();await page.getByTestId(matrixZoom<1?'board-zoom-out':'board-zoom-in').click();}
 expect((await viewport(page)).z).toBeCloseTo(matrixZoom,6);const initial=await viewport(page),pan={x:matrixZoom===2?-80:35,y:matrixZoom===2?-180:45};await page.mouse.move(initial.box.x+20,initial.box.y+30);await page.mouse.wheel(initial.x-pan.x,initial.y-pan.y);await expect.poll(async()=>{const v=await viewport(page);return [v.x,v.y];}).toEqual([pan.x,pan.y]);
 for(const gesture of ['move','rotate','scale'] as const)for(const outcome of ['cancel','commit'] as const){
  const before=await canonicalBoardSnapshot(api,token,boardId),baseline=[a.id,b.id,drawing.id].map(id=>before.objects.find(object=>object.id===id)!);
  const v=await viewport(page),screen=(point:{x:number;y:number})=>({x:v.box.x+v.x+point.x*v.z,y:v.box.y+v.y+point.y*v.z});
  const blank={x:v.box.x+20,y:v.box.y+30};await topCanvas(page,blank);await page.mouse.click(blank.x,blank.y);
  for(const [index,value] of baseline.entries()){
   const point=screen(entityPoint(value.geometry,{x:value.geometry.width/2,y:value.geometry.height/2}));await topCanvas(page,point);
   if(index)await page.keyboard.down('Shift');try{await page.mouse.click(point.x,point.y);}finally{if(index)await page.keyboard.up('Shift');}
  }
  await expect(page.getByTestId('board-a11y-selection-announcement')).toHaveText('已选择 3 个对象');
  const corners=baseline.flatMap(value=>entityCorners(value.geometry)),left=Math.min(...corners.map(point=>point.x)),right=Math.max(...corners.map(point=>point.x)),top=Math.min(...corners.map(point=>point.y)),bottom=Math.max(...corners.map(point=>point.y));
  const pivot={x:(left+right)/2,y:(top+bottom)/2},screenPivot=screen(pivot);
  const rawStart=gesture==='move'?screen(entityPoint(baseline[0]!.geometry,{x:20,y:20})):gesture==='rotate'?{x:screenPivot.x,y:screen({x:pivot.x,y:bottom}).y+40}:screen({x:right,y:bottom});
  const start={x:Math.round(rawStart.x),y:Math.round(rawStart.y)};
  const rawEnd=gesture==='move'?{x:start.x+21,y:start.y+23}:gesture==='rotate'?rotatePoint(start,screenPivot,23):{x:screenPivot.x+(start.x-screenPivot.x)*1.2,y:screenPivot.y+(start.y-screenPivot.y)*1.2};
  const end={x:Math.round(rawEnd.x),y:Math.round(rawEnd.y)};await topCanvas(page,start);
  const degrees=gesture==='rotate'?pointerRotation(screenPivot,start,end):0;
  const scale=gesture==='scale'?2*(Math.abs((end.x-screenPivot.x)/v.z)+Math.abs((end.y-screenPivot.y)/v.z))/(right-left+bottom-top):1;
  const delta=gesture==='move'?{x:(end.x-start.x)/v.z,y:(end.y-start.y)/v.z}:{x:0,y:0};
  const expected=baseline.map(value=>({...value,geometry:transformGeometry(value.geometry,pivot,degrees,scale,delta)}));
  const verifyLiveMenu=async()=>{
   const observed=await page.getByTestId('board-selection-layout-toolbar').evaluate(element=>{const toolbar=element.getBoundingClientRect(),parent=(element as HTMLElement).offsetParent;if(!parent)throw new Error('R01_MENU_PARENT_REQUIRED');const frame=parent.getBoundingClientRect();return {origin:{x:frame.x,y:frame.y},position:{x:toolbar.x-frame.x,y:toolbar.y-frame.y},frame:{width:frame.width,height:frame.height},size:{width:toolbar.width,height:toolbar.height},chrome:Array.from(document.querySelectorAll('[data-board-chrome]')).map(node=>{const rect=node.getBoundingClientRect();return {x:rect.x-frame.x,y:rect.y-frame.y,width:rect.width,height:rect.height};}).filter(rect=>rect.width>0&&rect.height>0)};});
   assertPoints([observed.origin],[{x:v.box.x,y:v.box.y}],.01);
   const corners=expected.flatMap(value=>entityCorners(value.geometry)),xs=corners.map(point=>point.x),ys=corners.map(point=>point.y),geometry={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
   const position=boardToolbarPosition(geometry,{zoom:v.z,panX:v.x,panY:v.y,fitRequest:0},observed.frame,observed.size,observed.chrome);assertPoints([observed.position],[{x:Number(position.left),y:Number(position.top)}],2);
  };
  const verifyEntityPixels=async(project:(point:{x:number;y:number})=>{x:number;y:number},view=v,held=true)=>{
   for(const value of expected){const color=value.id===a.id?[34,197,94]:value.id===b.id?[37,99,235]:[220,38,38];
    for(const fraction of [.3,.5,.7]){const pixels=await rgba(page,project(entityPoint(value.geometry,{x:value.geometry.width*fraction,y:value.geometry.height*(value.id===drawing.id?fraction:.5)})));for(let index=0;index<pixels.length;index+=4){expect(pixels.slice(index,index+3)).toEqual(color);expect(pixels[index+3]).toBe(255);}}
    const guard=await rgba(page,project(entityPoint(value.geometry,{x:value.geometry.width/2,y:-7})));expect(guard.filter((_,index)=>index%4===3)).toEqual([0,0,0,0,0,0,0,0,0]);
   }
   await shapeStrokePixels(page,expected.find(value=>value.id===b.id)!.geometry,view,held);
   const from=offsetAnchor(expected[0]!.geometry,'right',fromOffset),to=offsetAnchor(expected[1]!.geometry,'left',toOffset);
   for(const fraction of [.23,.37,.63]){const pixels=await rgba(page,project({x:from.x+(to.x-from.x)*fraction,y:from.y+(to.y-from.y)*fraction}));expect(pixels.filter((value,index)=>index%4===0&&Math.abs(value-24)<=2&&Math.abs(pixels[index+1]!-24)<=2&&Math.abs(pixels[index+2]!-27)<=2&&pixels[index+3]!>0).length).toBeGreaterThan(0);}
  };
  const eventStart=transport.snapshot().events.length,updates=()=>transport.snapshot().events.slice(eventStart).filter(event=>event.direction==='sent'&&event.type==='update');
  if(gesture==='scale')await page.keyboard.down('Alt');
  let gestureFailure:unknown;
  try{
   await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:12});await settled(page);
   const scenes=await page.getByTestId('board-fabric-surface').getAttribute('data-object-scenes');
   const actual=JSON.parse(scenes!) as Array<{id:string;worldCorners:Array<{x:number;y:number}>;transformMatrix:number[]}>;
   for(const value of expected){
    const projected=actual.find(item=>item.id===value.id)!;expect(projected).toBeTruthy();expect(projected.transformMatrix).toHaveLength(6);expect(projected.transformMatrix.every(Number.isFinite)).toBe(true);
    const predicted=entityCorners(value.geometry);assertPoints(projected.worldCorners,predicted,.01);assertPoints(projected.worldCorners.map(screen),predicted.map(screen),2);
    const center=screen(entityPoint(value.geometry,{x:value.geometry.width/2,y:value.geometry.height/2})),pixels=await rgba(page,center),color=value.id===a.id?[34,197,94]:value.id===b.id?[37,99,235]:[220,38,38];
    expect(pixels.filter((pixel,index)=>index%4===0&&color.every((channel,offset)=>Math.abs(pixels[index+offset]!-channel)<=2)).length).toBeGreaterThan(0);
   }
   const from=offsetAnchor(expected[0]!.geometry,'right',fromOffset),to=offsetAnchor(expected[1]!.geometry,'left',toOffset);
   for(const fraction of [.23,.37,.63]){const pixels=await rgba(page,screen({x:from.x+(to.x-from.x)*fraction,y:from.y+(to.y-from.y)*fraction}));expect(pixels.filter((value,index)=>index%4===0&&Math.abs(value-24)<=2&&Math.abs(pixels[index+1]!-24)<=2&&Math.abs(pixels[index+2]!-27)<=2&&pixels[index+3]!>0).length).toBeGreaterThan(0);}
   await verifyEntityPixels(screen);
   await verifyLiveMenu();
   expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(before);expect(updates()).toEqual([]);await capture(page,info,`multi-${gesture}-${outcome}-held`);
   if(outcome==='cancel'){
    await page.keyboard.press('Escape');await page.mouse.up();await settled(page);expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(before);expect(updates()).toEqual([]);
    const restored=JSON.parse((await page.getByTestId('board-fabric-surface').getAttribute('data-object-scenes'))!) as Array<{id:string;worldCorners:Array<{x:number;y:number}>}>;
    for(const value of baseline)assertPoints(restored.find(item=>item.id===value.id)!.worldCorners,entityCorners(value.geometry));
    await topCanvas(page,blank);await page.mouse.click(blank.x,blank.y);expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(before);expect(updates()).toEqual([]);await settled(page);await expectBoardSynced(page);expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(before);expect(updates()).toEqual([]);await capture(page,info,`multi-${gesture}-canceled`);continue;
   }
   await page.mouse.up();
  }catch(error){gestureFailure=error;throw error;}finally{const failures:unknown[]=[];try{await page.mouse.up();}catch(error){failures.push(error);}try{if(gesture==='scale')await page.keyboard.up('Alt');}catch(error){failures.push(error);}if(failures.length)throw new AggregateError(gestureFailure?[gestureFailure,...failures]:failures,'R01_GESTURE_CLEANUP_FAILED');}
  await expect.poll(async()=>(await canonicalBoardSnapshot(api,token,boardId)).revision.seq).toBe(before.revision.seq+1);
  const after=await canonicalBoardSnapshot(api,token,boardId);assertAtomicRevision(before.revision,after.revision,1);
  expect(updates()).toHaveLength(1);
  const sent=updates()[0]!;expect(sent.client).toBe('original');expect(sent.epoch).toBe(before.revision.epoch);expect(typeof sent.updateId).toBe('string');expect(typeof sent.gestureId).toBe('string');await expect.poll(()=>transport.snapshot().events.slice(eventStart).filter(event=>event.direction==='received'&&event.type==='ack'&&event.client===sent.client&&event.socketId===sent.socketId&&event.updateId===sent.updateId&&event.gestureId===sent.gestureId&&event.seq===after.revision.seq).length).toBe(1);await settled(page);await expectBoardSynced(page);expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(after);expect(updates()).toHaveLength(1);
  for(const value of expected){const saved=after.objects.find(object=>object.id===value.id)!;assertPoints(entityCorners(saved.geometry),entityCorners(value.geometry),.01);expect(saved.geometry.rotation).toBeCloseTo(value.geometry.rotation,4);expect({...saved,geometry:value.geometry}).toEqual(value);}
  const savedEdge=after.objects.find(object=>object.id===edge.id)!,from=offsetAnchor(expected[0]!.geometry,'right',fromOffset),to=offsetAnchor(expected[1]!.geometry,'left',toOffset),expectedEdgeGeometry={x:Math.min(from.x,to.x),y:Math.min(from.y,to.y),width:Math.max(1,Math.abs(to.x-from.x)),height:Math.max(1,Math.abs(to.y-from.y)),rotation:0};assertPoints(entityCorners(savedEdge.geometry),entityCorners(expectedEdgeGeometry),.01);expect({...savedEdge,geometry:before.objects.find(object=>object.id===edge.id)!.geometry}).toEqual(before.objects.find(object=>object.id===edge.id));
  await page.keyboard.press('ControlOrMeta+z');await expect.poll(async()=>(await canonicalBoardSnapshot(api,token,boardId)).objects).toEqual(before.objects);assertAtomicRevision(after.revision,(await canonicalBoardSnapshot(api,token,boardId)).revision,1);
  await page.keyboard.press('ControlOrMeta+Shift+z');await expect.poll(async()=>(await canonicalBoardSnapshot(api,token,boardId)).objects).toEqual(after.objects);const redone=await canonicalBoardSnapshot(api,token,boardId);assertAtomicRevision(after.revision,redone.revision,2);
  await page.reload();await expectBoardSynced(page);await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(4);expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(redone);
  const refreshedScenes=JSON.parse((await page.getByTestId('board-fabric-surface').getAttribute('data-object-scenes'))!) as Array<{id:string;worldCorners:Array<{x:number;y:number}>}>;
  for(const value of expected)assertPoints(refreshedScenes.find(item=>item.id===value.id)!.worldCorners,entityCorners(value.geometry),.01);
  await page.getByTestId('board-tool-select').click();const fresh=await viewport(page),freshBlank={x:fresh.box.x+20,y:fresh.box.y+30},clearEventStart=transport.snapshot().events.length;await topCanvas(page,freshBlank);await page.mouse.click(freshBlank.x,freshBlank.y);await expect(page.getByTestId('board-a11y-selection-announcement')).toHaveText('未选择对象');await expect(page.getByTestId('board-selection-layout-toolbar')).toHaveCount(0);await expect.poll(()=>page.getByTestId('board-fabric-surface').getAttribute('data-selection-scene')).toBeNull();await settled(page);await expectBoardSynced(page);expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(redone);expect(transport.snapshot().events.slice(clearEventStart).filter(event=>event.direction==='sent'&&event.type==='update')).toEqual([]);await verifyEntityPixels(point=>({x:fresh.box.x+fresh.x+point.x*fresh.z,y:fresh.box.y+fresh.y+point.y*fresh.z}),fresh,false);await settled(page);expect(await canonicalBoardSnapshot(api,token,boardId)).toEqual(redone);expect(transport.snapshot().events.slice(clearEventStart).filter(event=>event.direction==='sent'&&event.type==='update')).toEqual([]);
  await capture(page,info,`multi-${gesture}-refreshed`);
 }
}));
