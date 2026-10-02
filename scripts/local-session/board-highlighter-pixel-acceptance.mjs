#!/usr/bin/env node
// LEGACY SOURCE ARCHIVE (#5001): not executed/accepted against this PR. See docs/design/board-acceptance-history/README.md.
import assert from 'node:assert/strict';
import {createHash, randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name, fallback) => process.argv.includes(`--${name}`) ? process.argv[process.argv.indexOf(`--${name}`) + 1] : fallback;
const base = arg('base', 'http://127.0.0.1:3317'), apiOrigin = arg('api', 'http://127.0.0.1:3320');
const storageState = arg('storage-state'), out = resolve(arg('out', '/private/tmp/wsx-board-highlighter-pixels'));
assert(storageState, 'Provide --storage-state with an explicitly exported authenticated session.');
const {chromium} = createRequire(join(root, 'apps/web/package.json'))('playwright-core');
mkdirSync(out,{recursive:true});
const results=[], browserErrors=[];
let browser,page,token,boardId,completed=false,activeBrush='highlighter';
const redact=value=>String(value).replaceAll(token??'\0','[token]');
const poll=async(read,predicate,label)=>{const until=Date.now()+30000;do{const value=await read();if(predicate(value))return value;await new Promise(resolve=>setTimeout(resolve,100));}while(Date.now()<until);throw new Error(`Timed out: ${label}`);};
const api=async(method,path,data)=>{const response=await page.request.fetch(`${apiOrigin}${path}`,{method,data,headers:{authorization:`Bearer ${token}`}});assert(response.ok(),`${method} ${path}: ${response.status()}`);return response;};
const snapshot=async()=>{const exported=await(await api('POST',`/whiteboards/${boardId}/imports/standard-export`,{requestId:randomUUID()})).json();const payload=await(await api('GET',exported.downloadPath)).json(),bytes=Buffer.from(payload.contentBase64,'base64');assert.equal(createHash('sha256').update(bytes).digest('hex'),exported.sha256);assert.equal(bytes.length,exported.sizeBytes);const value=JSON.parse(bytes.toString('utf8'));assert.equal(value.board.id,boardId);return value.objects;};
const synced=async()=>{await page.getByTestId('board-sync-status').waitFor();await poll(()=>page.getByTestId('board-sync-status').getAttribute('data-sync-state'),value=>value==='saved','saved');};
const canvas=()=>page.getByTestId('board-fabric-surface').locator('canvas.lower-canvas');
const frame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
const capture=async name=>{await frame();await page.screenshot({path:join(out,`${name}.png`)});};
const pixels=async points=>{await frame();return canvas().evaluate((element,points)=>{const context=element.getContext('2d'),bounds=element.getBoundingClientRect();return points.map(({x,y})=>({x,y,rgba:[...context.getImageData(Math.round(x*element.width/bounds.width),Math.round(y*element.height/bounds.height),1,1).data]}));},points);};
const effectiveAlpha=rgba=>rgba[3]<255?rgba[3]/255:(255-rgba[0])/(255-37);
const uniform=samples=>{const alphas=samples.map(sample=>effectiveAlpha(sample.rgba));assert(alphas.every(alpha=>alpha>.25&&alpha<.43),`Expected single .35 brush alpha: ${JSON.stringify(samples)}`);assert(Math.max(...alphas)-Math.min(...alphas)<.025,`Joint darkening: ${JSON.stringify(samples)}`);return alphas;};
const samePremultipliedPixels=(actual,expected)=>{assert.equal(actual.length,expected.length);for(let index=0;index<actual.length;index++){const a=actual[index].rgba,b=expected[index].rgba;assert.equal(a[3],b[3],'live/persist alpha must match exactly');for(let channel=0;channel<3;channel++)assert(Math.abs(Math.round(a[channel]*a[3]/255)-Math.round(b[channel]*b[3]/255))<=1,'live/persist premultiplied color differs by at most one 8-bit rounding step');}};
const horizontalInkGeometry = async () => {
 const objects=await snapshot(),object=objects.find(value=>value.extensionData?.contentObject?.type==='drawing');assert(object);
 const stroke=object.extensionData.contentObject.strokes.find(value=>value.tool==='highlighter');assert(stroke&&stroke.points.length>=2);
 const points=stroke.points,minX=Math.min(...points.map(point=>point.x)),minY=Math.min(...points.map(point=>point.y)),maxX=Math.max(...points.map(point=>point.x)),maxY=Math.max(...points.map(point=>point.y));
 const intrinsic={width:Math.max(1,maxX-minX),height:Math.max(1,maxY-minY)};
 const surface=page.getByTestId('board-fabric-surface'),zoom=Number(await surface.getAttribute('data-viewport-zoom')),panX=Number(await surface.getAttribute('data-viewport-pan-x')),panY=Number(await surface.getAttribute('data-viewport-pan-y'));
 const scaleX=object.geometry.width/intrinsic.width,scaleY=object.geometry.height/intrinsic.height;
 assert.equal(object.geometry.rotation,0);assert(Math.abs(scaleX-scaleY)<.001,'isotropic acceptance stroke transform');
 const scene=point=>({x:(object.geometry.x+(point.x-minX)*scaleX)*zoom+panX,y:(object.geometry.y+(point.y-minY)*scaleY)*zoom+panY});
 const segments=points.slice(1).map((point,index)=>({from:scene(points[index]),to:scene(point),width:stroke.width*(.35+.65*Math.max(.1,(points[index].pressure+point.pressure)/2))*scaleY*zoom})).filter(segment=>Math.hypot(segment.to.x-segment.from.x,segment.to.y-segment.from.y)>.01);
 assert(segments.length);const first=segments[0],last=segments.at(-1);assert(Math.abs(first.from.y-last.to.y)<.001,'horizontal acceptance stroke');
 const x=(first.from.x+last.to.x)/2,y=first.from.y;
 const expectedWidth=Math.max(...segments.filter(segment=>x>=Math.min(segment.from.x,segment.to.x)&&x<=Math.max(segment.from.x,segment.to.x)).map(segment=>segment.width));
 const body=await pixels(Array.from({length:61},(_,index)=>({x:Math.round(x),y:Math.round(y)-30+index})));
 const occupied=body.filter(sample=>effectiveAlpha(sample.rgba)>.02);assert(occupied.length,'horizontal ink remains visible');
 const actualHeight=occupied.at(-1).y-occupied[0].y+1;assert(Math.abs(actualHeight-expectedWidth)<=2,`pressure-derived thickness expected ${expectedWidth}px, rendered ${actualHeight}px`);
 const maxRadius=Math.max(...segments.map(segment=>segment.width))/2;
 const capPoints=[{x:Math.round(first.from.x-first.width/4),y:Math.round(y)},{x:Math.floor(first.from.x-maxRadius-2),y:Math.round(y)},{x:Math.round(last.to.x+last.width/4),y:Math.round(y)},{x:Math.ceil(last.to.x+maxRadius+2),y:Math.round(y)}];
 const caps=await pixels(capPoints);uniform([caps[0],caps[2]]);assert(effectiveAlpha(caps[1].rgba)<.02&&effectiveAlpha(caps[3].rgba)<.02,'round caps do not extend beyond their pressure-derived radius');
 return{objectId:object.id,nominalWidth:stroke.width,segmentWidths:segments.map(segment=>segment.width),expectedThickness:expectedWidth,actualHeight,body,caps};
};
const startStroke=async points=>{if(await page.getByTestId('board-add-draw').getAttribute('aria-pressed')!=='true'){await page.getByTestId('board-add-draw').click();await page.getByTestId(`board-draw-${activeBrush}`).click();if(activeBrush==='highlighter')await page.getByTestId('board-draw-color-2563eb').click();}const bounds=await canvas().boundingBox();assert(bounds);await page.mouse.move(bounds.x+points[0].x,bounds.y+points[0].y);await page.mouse.down();for(const point of points.slice(1))await page.mouse.move(bounds.x+point.x,bounds.y+point.y,{steps:Math.max(2,Math.round(Math.hypot(point.x-points[0].x,point.y-points[0].y)/8))});await frame();};
const finishStroke=async()=>{await page.mouse.up();await synced();await page.getByTestId('board-tool-select').click();await page.getByTestId('board-fabric-surface').click({position:{x:1100,y:150}});await frame();};
const check=async(name,run)=>{try{const detail=await run();results.push({name,ok:true,detail});console.log('PASS',name);}catch(error){results.push({name,ok:false,detail:redact(error.stack??error)});await page?.screenshot({path:join(out,`failure-${results.length}.png`)}).catch(()=>{});throw error;}};
try{
 browser=await chromium.launch(process.env.PW_EXECUTABLE?{executablePath:process.env.PW_EXECUTABLE}:{});
 const context=await browser.newContext({storageState,viewport:{width:1440,height:900},locale:'zh-CN'});page=await context.newPage();page.setDefaultTimeout(30000);
 page.on('pageerror',error=>browserErrors.push(redact(error.message)));page.on('console',message=>{if(message.type()==='error')browserErrors.push(redact(message.text()));});
 const origin=(await context.storageState()).origins.find(value=>value.origin===new URL(base).origin);assert(origin);
 const local=new Map(origin.localStorage.map(item=>[item.name,item.value]));token=local.get('wsx.sessionToken');assert(token);const session=JSON.parse(local.get('wsx.session'));
 assert(session.version===2&&session.revision===local.get('wsx.sessionCommit')&&session.orgs.includes(session.currentOrgId)&&Date.parse(session.expiresAt)>Date.now());
 await api('GET',`/identity/me?orgId=${encodeURIComponent(session.currentOrgId)}`);
 boardId=(await(await api('POST','/whiteboards',{requestId:randomUUID(),name:`Highlighter pixels ${randomUUID()}`})).json()).id;assert(boardId);await page.goto(`${base}/studio/board/${boardId}`);await synced();
 await page.getByTestId('board-add-draw').click();await page.getByTestId('board-draw-highlighter').click();await page.getByTestId('board-draw-color-2563eb').click();
 const horizontal=Array.from({length:25},(_,index)=>({x:315+index*12,y:200}));
 let horizontalSaved,foldSaved,crossSaved;
 await check('actual live and persisted horizontal highlighter has uniform alpha at sample joins',async()=>{
  await startStroke([{x:300,y:200},{x:660,y:200}]);const live=await pixels(horizontal);uniform(live);await capture('horizontal-live');await finishStroke();horizontalSaved=await pixels(horizontal);uniform(horizontalSaved);await capture('horizontal-saved');
  samePremultipliedPixels(horizontalSaved,live);const inkGeometry=await horizontalInkGeometry();return{live,persisted:horizontalSaved,inkGeometry,pixelComparison:'exact alpha; premultiplied RGB difference <= 1 due to 8-bit Fabric cache compositing'};
 });
 const fold=[{x:320,y:330},{x:360,y:330},{x:400,y:330},{x:450,y:330},{x:450,y:350},{x:450,y:390}];
 await check('actual folded highlighter keeps corner alpha uniform live and saved',async()=>{
  await startStroke([{x:300,y:330},{x:450,y:330},{x:450,y:420}]);const live=await pixels(fold);uniform(live);await capture('fold-live');await finishStroke();foldSaved=await pixels(fold);uniform(foldSaved);await capture('fold-saved');samePremultipliedPixels(foldSaved,live);return{live,persisted:foldSaved};
 });
 await check('independent strokes naturally darken only their crossing',async()=>{
  await startStroke([{x:480,y:140},{x:480,y:260}]);await finishStroke();crossSaved=await pixels([{x:480,y:200},{x:480,y:170},{x:360,y:200}]);
  const alpha=crossSaved.map(sample=>effectiveAlpha(sample.rgba));assert(alpha[0]>.48&&alpha[0]<.68);assert(alpha[0]>alpha[1]+.15);uniform(crossSaved.slice(1));await capture('independent-crossing');return{samples:crossSaved,alpha};
 });
 await check('reload retains horizontal fold and crossing product pixels',async()=>{
  const before=await snapshot();await page.reload();await synced();await poll(()=>page.getByTestId('board-a11y-mirror').locator('li[data-object-id]').count(),count=>count===before.length,'reloaded projections');
  const reloadedHorizontal=await pixels(horizontal.filter(point=>Math.abs(point.x-480)>20));uniform(reloadedHorizontal);
  const original=horizontalSaved.filter(point=>Math.abs(point.x-480)>20);assert.deepEqual(reloadedHorizontal.map(sample=>sample.rgba),original.map(sample=>sample.rgba));
  assert.deepEqual((await pixels(fold)).map(sample=>sample.rgba),foldSaved.map(sample=>sample.rgba));assert.deepEqual((await pixels(crossSaved)).map(sample=>sample.rgba),crossSaved.map(sample=>sample.rgba));await capture('reloaded');return{objectCount:before.length,horizontal:reloadedHorizontal};
 });
 await check('eraser removes drawing pixels and preserves unrelated sticky object',async()=>{
  await page.getByTestId('board-add-sticky').click();await page.getByTestId('board-fabric-surface').click({position:{x:1050,y:350}});const editor=page.getByTestId('board-thinking-editor');await editor.waitFor();await editor.fill('Keep this sticky');await editor.press('Control+Enter');await page.keyboard.press('Escape');await synced();
  const sticky=(await snapshot()).find(object=>object.kind==='sticky');assert(sticky);
  activeBrush='eraser';await startStroke([{x:400,y:180},{x:400,y:220}]);await finishStroke();
  const samples=await pixels([{x:400,y:200},{x:360,y:200}]);assert(effectiveAlpha(samples[0].rgba)<.02,'mask clears actual ink');uniform(samples.slice(1));
  assert.deepEqual((await snapshot()).find(object=>object.id===sticky.id),sticky);await capture('eraser-preserves-sticky');return{samples,preservedStickyId:sticky.id};
 });
 await check('browser runtime contains no page or console errors',async()=>{assert.equal(browserErrors.length,0,JSON.stringify(browserErrors));return{count:browserErrors.length};});completed=true;
}catch(error){if(!results.some(result=>!result.ok))results.push({name:'setup',ok:false,detail:redact(error.stack??error)});}
finally{if(page)await page.mouse.up().catch(()=>{});await browser?.close();const ok=completed&&results.length===6&&results.every(result=>result.ok);writeFileSync(join(out,'results.json'),JSON.stringify({ok,boardId,base,apiOrigin,results,browserErrors},null,2));writeFileSync(join(out,'report.md'),`# Product Highlighter Pixel Acceptance\n\nResult: ${ok?'PASS':'FAIL'}\n\n${results.map(result=>`- ${result.ok?'PASS':'FAIL'} ${result.name}`).join('\n')}\n\nHorizontal thickness and both round caps are checked against persisted sample pressure and the actual geometry/viewport transform. Live/persisted alpha must match exactly; RGB is compared in premultiplied space with at most one 8-bit rounding unit from Fabric cache compositing. The observed straight RGB green values 97 and 100 at alpha 89 differ by one premultiplied unit, not opacity.\n\nPixels are sampled from the actual product lower Fabric canvas using its DOM bounds and physical pixel ratio. No substitute Path2D rendering, mock API, or seeded drawing is used. Real mouse input pressure is fixed by the browser; native tablet pressure is outside this evidence.\n`);process.exitCode=ok?0:1;}
