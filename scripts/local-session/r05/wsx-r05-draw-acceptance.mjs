// Private preparation only. Requires a fresh empty board and exact R05 runtime.
import assert from 'node:assert/strict';
import {readFileSync, mkdirSync, writeFileSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {join,dirname,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createFailureState,recordFailure,reportFailure} from './wsx-r05-safe-failure.mjs';
const driverFiles=['wsx-r05-draw-acceptance.mjs','wsx-r05-draw-pixel-oracle.mjs','wsx-r05-instrument-projection-oracle.mjs','wsx-r05-multi-eraser-acceptance.mjs','wsx-r05-multi-eraser-oracle.mjs','wsx-r05-panel-oracle.mjs','wsx-r05-blending-oracle.mjs','wsx-r05-safe-failure.mjs'].map(name=>fileURLToPath(new URL(name,import.meta.url)));
const hashDrivers=()=>Object.fromEntries(driverFiles.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,all)=>value.startsWith('--')?[...pairs,[value.slice(2),all[index+1]]]:pairs,[]));
let browser,outputReady=false;
const failureState=createFailureState();
try{
for(const key of ['root','base','api','manifest','storage-state','board','out','source-sha','panel-baseline','panel-baseline-sha'])assert(args[key],`--${key} required`);
const output=resolve(args.out),temporaryRoots=[realpathSync(tmpdir()),...(existsSync('/private/tmp')?[realpathSync('/private/tmp')]:[])];
let parent=dirname(output);
assert.equal(realpathSync(parent),parent,'Output parent must be physical, not an alias');
while(!temporaryRoots.includes(parent)){const stat=lstatSync(parent);assert(!stat.isSymbolicLink()&&stat.isDirectory()&&stat.uid===process.getuid()&&(stat.mode&0o777)===0o700,'Output ancestors must be private and owned');const next=dirname(parent);assert.notEqual(next,parent,'Output must be under the system temporary root');parent=next;}
mkdirSync(output,{mode:0o700});outputReady=true;
const initialDriverHashes=hashDrivers();
const {assertPanelCompression}=await import('./wsx-r05-panel-oracle.mjs');
const {assertStrokePixelOracle}=await import('./wsx-r05-draw-pixel-oracle.mjs');
const {assertInstrumentProjection}=await import('./wsx-r05-instrument-projection-oracle.mjs');
const {runMultiEraserAcceptance}=await import('./wsx-r05-multi-eraser-acceptance.mjs');
const {assertBlendingPixels}=await import('./wsx-r05-blending-oracle.mjs');
const root=args.root;
const {verifyRuntimeManifest,listRuntimeSourceFiles}=await import(join(root,'apps/web/e2e/support/native-runtime/runtime-attestation.mjs'));
assert(/^[a-f0-9]{40}$/.test(args['source-sha']),'Exact production union SHA required');
assert.equal(execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),args['source-sha']);
assert.equal(execFileSync('git',['status','--porcelain'],{cwd:root,encoding:'utf8'}).trim(),'','Clean frozen production union required');
const panelBaselineBytes=readFileSync(args['panel-baseline']);
assert.equal(createHash('sha256').update(panelBaselineBytes).digest('hex'),args['panel-baseline-sha'],'Actual reference capture must be frozen before acceptance');
const panelBaselines=JSON.parse(panelBaselineBytes);
assert.equal(panelBaselines.sourceHead,'d1df49f490d9721d313fd0bc751b2a0f23e190b2','Use the actual parent of the human-requested compact panel change');
assert.equal(panelBaselines.capturedFromBrowser,true,'No CSS-estimated baseline');
const {createAcceptanceRequestScheduler}=await import(join(root,'scripts/local-session/board-navigation-acceptance-scheduler.mjs'));
const {sourceFiles:navSources}=await import(join(root,'scripts/local-session/board-navigation-acceptance-runtime.mjs'));
const {assertHeldUncommitted,assertReleasedOnce}=await import(join(root,'scripts/local-session/board-navigation-acceptance-classifier.mjs'));
const manifest=JSON.parse(readFileSync(args.manifest,'utf8'));
assert.equal(manifest.head,args['source-sha'],'Startup must attest the actual frozen production union');
const sourceFiles=listRuntimeSourceFiles(root);
for(const required of navSources)assert(sourceFiles.includes(required),`Manifest missing runtime/core dependency ${required}`);
for(const required of ['apps/web/components/whiteboard/board-draw-tool-panel.tsx','apps/web/components/whiteboard/drawing-tool-style.ts','apps/web/components/whiteboard/fabric/board-fabric-surface.tsx','apps/web/components/whiteboard/collaborative-editor.tsx'])assert(sourceFiles.includes(required),`Manifest missing ${required}`);
const manifestBytes=readFileSync(args.manifest);
const attest=()=>{assert.deepEqual(readFileSync(args.manifest),manifestBytes,'Runtime manifest may not change during the draw matrix');return verifyRuntimeManifest({manifestPath:args.manifest,root,base:args.base,origin:args.api,sourceFiles});};
const initialAttestation=attest();
const require=createRequire(join(root,'apps/web/package.json'));
const {chromium}=require('playwright-core');
const {register}=createRequire(join(root,'package.json'))('tsx/esm/api');register();
const {drawingChoiceStyle}=await import(join(root,'apps/web/components/whiteboard/drawing-tool-style.ts'));
const {readBoardContent}=await import(join(root,'apps/web/components/whiteboard/board-content-adapter.ts'));
const scheduler=createAcceptanceRequestScheduler();
browser=await chromium.launch();
const context=await browser.newContext({storageState:args['storage-state']});
const page=await context.newPage();const results=[];let token;
let boardId=args.board;
const poll=async(read,check)=>{const end=Date.now()+30000;do{const value=await read();if(check(value))return value;await new Promise(r=>setTimeout(r,150));}while(Date.now()<end);throw Error('ASSERTION_TIMED_OUT');};
const api=async(method,path,data)=>scheduler.run(async()=>{const response=await page.request.fetch(args.api+path,{method,data,headers:{authorization:`Bearer ${token}`}});assert.notEqual(response.status(),429,'429 is a hard failure, not retried');assert(response.ok(),`${method} ${path} ${response.status()}`);return response.json();});
const snapshot=async()=>{const exported=await api('POST',`/whiteboards/${boardId}/imports/standard-export`,{requestId:crypto.randomUUID()});const payload=await api('GET',exported.downloadPath);return JSON.parse(Buffer.from(payload.contentBase64,'base64').toString());};
const objects=async()=>{const value=await snapshot();assert(Array.isArray(value.objects),'standard export objects required');return value.objects;};
const state=async()=>({head:await api('GET',`/v1/whiteboards/${boardId}/head`),objects:await objects()});
const strokes=rows=>rows.filter(row=>row.kind==='drawing').flatMap(row=>row.extensionData.contentObject.strokes);
const screenshots=[];
const screenshot=async(name)=>{const path=join(args.out,`${name}.png`),bytes=await page.screenshot({path}),receipt={name,path,sha256:createHash('sha256').update(bytes).digest('hex')};screenshots.push(receipt);return receipt;};
const freshBoard=async(name)=>{const board=await api('POST','/whiteboards',{requestId:crypto.randomUUID(),name:`R05 private ${name}`});boardId=board.id;await page.goto(`${args.base}/studio/board/${boardId}`);await page.getByTestId('board-add-draw').waitFor();assert.equal((await objects()).length,0);};
const inkSamples=points=>page.locator('canvas.lower-canvas').evaluate((canvas,points)=>{const rect=canvas.getBoundingClientRect(),ctx=canvas.getContext('2d');return points.map(point=>{const rgba=Array.from(ctx.getImageData(Math.round((point.x-rect.x)*canvas.width/rect.width),Math.round((point.y-rect.y)*canvas.height/rect.height),1,1).data);return{point,rgba,darkness:(255-(rgba[0]+rgba[1]+rgba[2])/3)*rgba[3]/255};});},points);
const viewport=()=>page.getByTestId('board-fabric-surface').evaluate(surface=>{const box=surface.getBoundingClientRect();return{left:box.x,top:box.y,zoom:Number(surface.dataset.viewportZoom),panX:Number(surface.dataset.viewportPanX),panY:Number(surface.dataset.viewportPanY)};});
const setRealZoom=async(target)=>{const before=await state(),view=await viewport();assert(Object.values(view).every(Number.isFinite)&&view.zoom>0);if(Math.abs(view.zoom-target)>.001){await page.mouse.move(200,650);await page.keyboard.down('Control');try{await page.mouse.wheel(0,Math.log(target/view.zoom)/Math.log(.998));}finally{await page.keyboard.up('Control');}}await poll(viewport,value=>Math.abs(value.zoom-target)<.001);assert.deepEqual(await state(),before,'Real wheel zoom must not write a board operation');};
const deselectForPixels=async(label)=>{
 const baseline=await state();await screenshot(`${label}-selected-chrome`);await page.getByTestId('board-tool-select').click();
 const emptyPoint={x:50,y:550};
 const emptyHit=await page.evaluate(({point,count})=>{const hit=document.elementFromPoint(point.x,point.y),surface=document.querySelector('[data-testid="board-fabric-surface"]');if(!(hit instanceof HTMLCanvasElement)||hit.dataset.fabric!=='top'||!surface?.contains(hit))return false;const box=surface.getBoundingClientRect(),z=Number(surface.dataset.viewportZoom),panX=Number(surface.dataset.viewportPanX),panY=Number(surface.dataset.viewportPanY),scene=JSON.parse(surface.dataset.objectScenes??'[]');if(scene.length!==count||![box.x,box.y,z,panX,panY].every(Number.isFinite)||z<=0)return false;return scene.every(object=>{if(![object.left,object.top,object.width,object.height].every(Number.isFinite)||object.width<0||object.height<0)return false;const left=box.x+panX+object.left*z,top=box.y+panY+object.top*z;return point.x<left-24||point.x>left+object.width*z+24||point.y<top-24||point.y>top+object.height*z+24;});},{point:emptyPoint,count:baseline.objects.length});
 assert(emptyHit,'Deselect click must hit upper canvas and stay outside every object and its controls');await page.mouse.click(emptyPoint.x,emptyPoint.y);
 await page.getByTestId('board-a11y-mirror').waitFor({state:'attached'});assert.equal(await page.getByTestId('board-a11y-mirror').locator('li[data-object-id]').count(),baseline.objects.length,'Selection mirror must actually represent the measured objects');
 assert.equal(await page.getByTestId('board-a11y-mirror').locator('li [aria-pressed="true"]').count(),0,'Natural Select and empty-canvas click must clear selection chrome before ink measurement');
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 assert.deepEqual(await state(),baseline,'Deselect must not change canonical objects, head or epoch');
};
try{
 await page.goto(`${args.base}/studio/board/${args.board}`);
 token=await page.evaluate(()=>localStorage.getItem('wsx.sessionToken'));assert(token,'Authenticated private storage state required');
 await page.getByTestId('board-add-draw').waitFor();assert.equal((await objects()).length,0,'Use a fresh dedicated board');
 for(const width of [1440,390]){
  await page.setViewportSize({width,height:900});
  for(const choice of ['pen','marker','pencil','highlighter']){
   await freshBoard(`${width}-${choice}-instrument`);await setRealZoom(choice==='pencil'?4:1);
   await page.getByTestId('board-add-draw').click();await page.getByTestId(`board-draw-${choice}`).click();
   const baseline=await state(),before=strokes(baseline.objects).length,y=200,viewBefore=await viewport(),expectedZoom=choice==='pencil'?4:1;assert(Math.abs(viewBefore.zoom-expectedZoom)<.001);
   await page.evaluate(()=>document.fonts.ready);
   const panelScreenshot=await screenshot(`${width}-${choice}-panel`);
   const panel=await page.getByTestId('board-draw-tool-panel').boundingBox();assert(panel&&panel.x>=0&&panel.x+panel.width<=width&&panel.y>=64);
   const fontFamily=await page.getByTestId('board-draw-tool-panel').evaluate(element=>getComputedStyle(element).fontFamily);
   const referencePanel=panelBaselines.samples.find(sample=>sample.viewport.width===width&&sample.choice===choice);
   assert(referencePanel,'Every instrument and viewport needs an actual reference measurement');
   assert.equal(referencePanel.sourceHead,panelBaselines.sourceHead,'Every reference sample must bind the actual old panel source');
   results.push({width,choice,panelCompression:assertPanelCompression({before:referencePanel,after:{sourceHead:args['source-sha'],screenshotSha256:panelScreenshot.sha256,viewport:{width,height:900},fontFamily,fontsReady:await page.evaluate(()=>document.fonts.status==='loaded'),box:panel}})});
   assert.equal(await page.locator('[data-testid^="board-draw-opacity-"]').count(),0);
   const background=(await inkSamples([{x:180,y}]))[0].rgba;
   await page.mouse.move(80,y);await page.mouse.down();await page.mouse.move(Math.min(280,width-60),y,{steps:20});
   assertHeldUncommitted(baseline,await state());
   assert.equal(strokes(await objects()).length,before,'Held pointer must not persist');
   await page.mouse.up();
   const updated=await poll(objects,rows=>strokes(rows).length===before+1),stroke=strokes(updated).at(-1),style=drawingChoiceStyle(choice);
   assertReleasedOnce(baseline,await state());
   assert.equal(stroke.tool,choice==='pencil'?'pen':choice);assert.equal(stroke.width,style.width);assert.equal(stroke.opacity,style.opacity);assert.equal(stroke.color,style.color);
   assert.deepEqual(await viewport(),viewBefore,'Drawing must not change zoom/pan');assertInstrumentProjection({choice,stroke,view:viewBefore,start:{x:80,y},end:{x:Math.min(280,width-60),y}});
   await deselectForPixels(`${width}-${choice}`);
   const pixels=await page.locator('canvas[data-fabric="main"]').evaluateAll((canvases,{x,y})=>{const canvas=canvases[0]??document.querySelector('canvas.lower-canvas');if(!canvas)throw Error('Real Fabric lower canvas required');const rect=canvas.getBoundingClientRect(),ctx=canvas.getContext('2d');return Array.from(ctx.getImageData(Math.round((x-rect.x)*canvas.width/rect.width),Math.round((y-rect.y)*canvas.height/rect.height),1,1).data);},{x:180,y});
   assert(pixels[3]>0,'Actual pixel must be painted');assert(pixels.slice(0,3).some(channel=>channel<245),'Stroke cannot be blank');
   const rgb=style.color.match(/[0-9A-F]{2}/gi).map(hex=>parseInt(hex,16)),a=style.opacity,b=background[3]/255,outAlpha=a+b*(1-a),expectedRGBA=[...rgb.map((channel,index)=>(channel*a+background[index]*b*(1-a))/outAlpha),outAlpha*255];
   assert(expectedRGBA.every((channel,index)=>Math.abs(pixels[index]-channel)<=10),`Real rawRGBA must match single expected source-over alpha: ${JSON.stringify({choice,pixels,expectedRGBA,background,viewport:viewBefore})}`);
   await screenshot(`${width}-${choice}-committed`);results.push({width,choice,pixels,viewport:viewBefore,alphaLane:choice==='pencil'?'native default width at real 4x zoom for full-pixel coverage':'native default at 1x',stroke:{tool:stroke.tool,width:stroke.width,color:stroke.color,opacity:stroke.opacity}});
   const expectedInstrumentObjects=await objects();
   for(const zoom of [.5,2]){
    await setRealZoom(zoom);const beforeUndo=await state();assert.deepEqual(beforeUndo.objects,expectedInstrumentObjects,'Viewport zoom must preserve full style and geometry');
    await page.keyboard.press('Control+z');await poll(objects,rows=>rows.length===0);const instrumentUndone=await state();assertReleasedOnce(beforeUndo,instrumentUndone);await deselectForPixels(`${width}-${choice}-${zoom}-undo`);await screenshot(`${width}-${choice}-${zoom}-undo`);
    await page.keyboard.press('Control+Shift+z');await poll(objects,rows=>JSON.stringify(rows)===JSON.stringify(expectedInstrumentObjects));const instrumentRestored=await state();assertReleasedOnce(instrumentUndone,instrumentRestored);await deselectForPixels(`${width}-${choice}-${zoom}-redo`);
    const restoredView=await viewport(),sceneCenter={x:(180-viewBefore.left-viewBefore.panX)/viewBefore.zoom,y:(y-viewBefore.top-viewBefore.panY)/viewBefore.zoom},clientCenter={x:restoredView.left+restoredView.panX+sceneCenter.x*restoredView.zoom,y:restoredView.top+restoredView.panY+sceneCenter.y*restoredView.zoom};
    const restoredInk=await inkSamples([-1,0,1].flatMap(dx=>[-1,0,1].map(dy=>({x:clientCenter.x+dx,y:clientCenter.y+dy}))));assert(restoredInk.some(sample=>sample.rgba[3]>0&&sample.rgba.slice(0,3).some(channel=>channel<245)),'Restored instrument must actually paint at the independently projected gesture center');await screenshot(`${width}-${choice}-${zoom}-redo`);
    await page.reload();await page.getByTestId('board-add-draw').waitFor();assert.deepEqual(await state(),instrumentRestored,'Refresh preserves exact style/width/color/geometry and does not append history');await setRealZoom(zoom);await deselectForPixels(`${width}-${choice}-${zoom}-refresh`);
    const refreshedView=await viewport(),refreshedCenter={x:refreshedView.left+refreshedView.panX+sceneCenter.x*refreshedView.zoom,y:refreshedView.top+refreshedView.panY+sceneCenter.y*refreshedView.zoom},refreshedInk=await inkSamples([-1,0,1].flatMap(dx=>[-1,0,1].map(dy=>({x:refreshedCenter.x+dx,y:refreshedCenter.y+dy}))));assert(refreshedInk.some(sample=>sample.rgba[3]>0&&sample.rgba.slice(0,3).some(channel=>channel<245)),'Refresh must actually paint the independently projected instrument at the required zoom');await screenshot(`${width}-${choice}-${zoom}-refresh`);results.push({width,choice,zoom,restoredInk,refreshedInk,refreshPixelScope:'independent-center-ink-presence-not-exact-RGBA-equality-across-viewport-pan'});
   }
   await freshBoard(`${width}-${choice}-cancel`);await setRealZoom(1);await page.getByTestId('board-add-draw').click();await page.getByTestId(`board-draw-${choice}`).click();const cancelBefore=await state(),cancelPoints=[{x:120,y:260},{x:160,y:260},{x:200,y:260}],cancelPixels=(await inkSamples(cancelPoints)).map(sample=>sample.rgba);
   await page.mouse.move(100,260);await page.mouse.down();await page.mouse.move(220,260,{steps:20});assertHeldUncommitted(cancelBefore,await state());await page.keyboard.press('Escape');await page.mouse.up();assertHeldUncommitted(cancelBefore,await state());await deselectForPixels(`${width}-${choice}-cancelled`);assert.deepEqual((await inkSamples(cancelPoints)).map(sample=>sample.rgba),cancelPixels,'Cancelled stroke must leave no real pixel fragment');await screenshot(`${width}-${choice}-cancelled`);
  }
  await freshBoard(`${width}-highlighter-blending`);await setRealZoom(1);
  await page.getByTestId('board-add-draw').click();await page.getByTestId('board-draw-highlighter').click();
  const blendingStart=await state(),blendingViewport=await viewport(),samePoints=[{x:140,y:240},{x:180,y:240},{x:220,y:240}],crossPoints=[{x:180,y:237},{x:180,y:240},{x:180,y:243}];
  const blendingBackground=await inkSamples([...samePoints,...crossPoints]);assert(blendingBackground.every(sample=>JSON.stringify(sample.rgba)===JSON.stringify(blendingBackground[0].rgba)),'Independent blending samples must start on the same unpainted background');
  await page.mouse.move(100,240);await page.mouse.down();await page.mouse.move(260,240,{steps:24});await page.mouse.move(100,240,{steps:24});await page.mouse.move(260,240,{steps:24});
  assertHeldUncommitted(blendingStart,await state());await page.mouse.up();await poll(objects,rows=>rows.length===1);const singleLayerState=await state();assertReleasedOnce(blendingStart,singleLayerState);
  const highlighterStyle=drawingChoiceStyle('highlighter'),firstHighlighter=strokes(singleLayerState.objects);assert.equal(firstHighlighter.length,1);assert.equal(firstHighlighter[0].tool,'highlighter');assert.equal(firstHighlighter[0].width,highlighterStyle.width);assert.equal(firstHighlighter[0].opacity,highlighterStyle.opacity);assert.equal(firstHighlighter[0].color,highlighterStyle.color);assert.deepEqual(await viewport(),blendingViewport);
  await deselectForPixels(`${width}-same-stroke-alpha`);const sameStrokePixels=(await inkSamples(samePoints)).map(sample=>sample.rgba);await screenshot(`${width}-highlighter-no-dark-seams`);
  await page.getByTestId('board-add-draw').click();await page.getByTestId('board-draw-highlighter').click();await page.mouse.move(180,180);await page.mouse.down();await page.mouse.move(180,300,{steps:24});assertHeldUncommitted(singleLayerState,await state());await page.mouse.up();await poll(objects,rows=>rows.length===2);const doubleLayerState=await state();assertReleasedOnce(singleLayerState,doubleLayerState);assert.deepEqual(await viewport(),blendingViewport);
  const highlightStrokes=strokes(doubleLayerState.objects);assert.equal(highlightStrokes.length,2);assert(highlightStrokes.every(stroke=>stroke.tool==='highlighter'&&stroke.width===highlighterStyle.width&&stroke.opacity===highlighterStyle.opacity&&stroke.color===highlighterStyle.color));
  await deselectForPixels(`${width}-cross-stroke-alpha`);const crossStrokePixels=(await inkSamples(crossPoints)).map(sample=>sample.rgba);
  const blendingProof=assertBlendingPixels({background:blendingBackground[0].rgba,color:highlighterStyle.color,opacity:highlighterStyle.opacity,sameStroke:sameStrokePixels,crossStroke:crossStrokePixels});await screenshot(`${width}-highlighter-cross-stroke-blending`);
  await page.reload();await page.getByTestId('board-add-draw').waitFor();assert.deepEqual(await state(),doubleLayerState);await deselectForPixels(`${width}-highlighter-blending-reloaded`);assert.deepEqual((await inkSamples(crossPoints)).map(sample=>sample.rgba),crossStrokePixels);await screenshot(`${width}-highlighter-blending-reloaded`);results.push({width,blendingProof,sameStrokePixels,crossStrokePixels});
  await freshBoard(`${width}-eraser-history`);await setRealZoom(1);await page.getByTestId('board-add-draw').click();await page.getByTestId('board-draw-pen').click();const fixtureBaseline=await state();await page.mouse.move(80,200);await page.mouse.down();await page.mouse.move(280,200,{steps:20});assertHeldUncommitted(fixtureBaseline,await state());await page.mouse.up();await poll(objects,rows=>rows.length===1);assertReleasedOnce(fixtureBaseline,await state());await deselectForPixels(`${width}-eraser-fixture`);
  await page.getByTestId('board-add-draw').click();await page.getByTestId('board-draw-eraser').click();const eraseBaseline=await state(),beforeErase=eraseBaseline.objects;
  const eraserPoint={x:175,y:200},beforeInk=(await inkSamples([eraserPoint]))[0];assert(beforeInk.darkness>60);
  await page.mouse.move(175,185);await page.mouse.down();await page.mouse.move(175,215,{steps:12});assertHeldUncommitted(eraseBaseline,await state());await page.mouse.up();
  const erased=await poll(objects,rows=>JSON.stringify(rows)!==JSON.stringify(beforeErase));assert.equal(erased.length,beforeErase.length,'Eraser must only add drawing masks');
  const erasedState=await state();assertReleasedOnce(eraseBaseline,erasedState);
  await deselectForPixels(`${width}-erased`);
  assert((await inkSamples([eraserPoint]))[0].darkness<25,'Mask must actually remove the original lower-canvas ink');
  assert(strokes(erased).some(stroke=>stroke.tool==='eraser'),'Erasure mask required');await screenshot(`${width}-erased`);
  await page.keyboard.press('Meta+z');await poll(objects,rows=>JSON.stringify(rows)===JSON.stringify(beforeErase));const undoneState=await state();assertReleasedOnce(erasedState,undoneState);await screenshot(`${width}-single-undo`);
  await deselectForPixels(`${width}-undo`);
  assert.deepEqual((await inkSamples([eraserPoint]))[0].rgba,beforeInk.rgba,'Undo must restore exact original ink');
  await page.keyboard.press('Meta+Shift+z');await poll(objects,rows=>JSON.stringify(rows)===JSON.stringify(erased));const redoState=await state();assertReleasedOnce(undoneState,redoState);await screenshot(`${width}-single-redo`);
  await deselectForPixels(`${width}-redo`);
  assert((await inkSamples([eraserPoint]))[0].darkness<25,'Redo must actually erase ink');
  await page.reload();await page.getByTestId('board-add-draw').waitFor();assert.deepEqual(await objects(),erased);await screenshot(`${width}-reload`);
  assert.deepEqual(await state(),redoState,'Reload must not add empty operations');
  await deselectForPixels(`${width}-reload`);
  assert((await inkSamples([eraserPoint]))[0].darkness<25,'Reload must preserve erased pixels');
  // Fixture exclusions must be exercised through the real erase pointer, not a mocked hit test.
  await freshBoard(`${width}-eraser-exclusions`);
  await setRealZoom(1);const stickyBaseline=await state();await page.getByTestId('board-add-sticky').click();assertHeldUncommitted(stickyBaseline,await state());await page.mouse.click(120,300);await poll(objects,rows=>rows.length===1&&rows[0].kind==='sticky');assertReleasedOnce(stickyBaseline,await state());
  assert.equal(await page.getByTestId('board-tool-select').getAttribute('aria-pressed'),'true');await page.getByTestId('board-thinking-editor').waitFor({state:'visible'});await page.getByTestId('board-thinking-editor').press('Escape');assert.equal(await page.getByTestId('board-thinking-editor').count(),0);const stickyCreated=await state();await page.mouse.click(50,650);assertHeldUncommitted(stickyCreated,await state());
  const shapeBaseline=await state();await page.getByTestId('board-add-shape').click();assertHeldUncommitted(shapeBaseline,await state());await page.mouse.click(260,500);await poll(objects,rows=>rows.length===2);assertReleasedOnce(shapeBaseline,await state());
  assert.equal(await page.getByTestId('board-tool-select').getAttribute('aria-pressed'),'true');const shapeCreated=await state();await page.mouse.click(50,650);assertHeldUncommitted(shapeCreated,await state());
  await deselectForPixels(`${width}-exclusions-fixture`);const protectedState=await state(),protectedObjects=protectedState.objects,protectedShape=protectedObjects.find(row=>row.kind==='rectangle'&&readBoardContent(row)?.type==='shape');assert(protectedShape,'Canonical Rectangle with shape content is required');
  const exclusionView=await viewport(),protectedPoints=protectedObjects.map(row=>({x:exclusionView.left+exclusionView.panX+(row.geometry.x+row.geometry.width/2)*exclusionView.zoom,y:exclusionView.top+exclusionView.panY+(row.geometry.y+row.geometry.height/2)*exclusionView.zoom}));assert(protectedPoints.length===2&&protectedPoints.every(point=>point.x>30&&point.x<width-30&&point.y>90&&point.y<850));for(const [index,row] of protectedObjects.entries()){const expected=row.kind==='sticky'?{x:120,y:300}:{x:260,y:500};assert(Math.abs(protectedPoints[index].x-expected.x)<1&&Math.abs(protectedPoints[index].y-expected.y)<1,'Canonical protected center must match the independent creation pointer');}const protectedPixels=await inkSamples(protectedPoints);assert(protectedPixels.every(pixel=>pixel.rgba[3]>200),'Protected fixtures must actually paint at the planned erase centers');
  await page.getByTestId('board-add-draw').click();await page.getByTestId('board-draw-eraser').click();
  for(const point of protectedPoints){await page.mouse.move(point.x-20,point.y);await page.mouse.down();await page.mouse.move(point.x+20,point.y,{steps:8});assertHeldUncommitted(protectedState,await state());await page.mouse.up();assertHeldUncommitted(protectedState,await state());}
  await deselectForPixels(`${width}-protected-after-erase`);assertHeldUncommitted(protectedState,await state());assert.deepEqual(await objects(),protectedObjects,'Eraser must not mutate Sticky or Rectangle shape');assert.deepEqual((await inkSamples(protectedPoints)).map(p=>p.rgba),protectedPixels.map(p=>p.rgba),'Actual protected center pixels must remain unchanged');await screenshot(`${width}-sticky-shape-protected`);
  results.push(await runMultiEraserAcceptance({width,page,freshBoard,setRealZoom,viewport,state,objects,poll,assertHeldUncommitted,assertReleasedOnce,deselectForPixels,inkSamples,screenshot}));
  for(const strokeWidth of [3,8,20])for(const [direction,end] of Object.entries({horizontal:{x:220,y:250},vertical:{x:120,y:350},diagonal:{x:190,y:320}})){
   await freshBoard(`${width}-${strokeWidth}-${direction}`);await setRealZoom(1);await page.getByTestId('board-add-draw').click();await page.getByTestId('board-draw-pen').click();await page.getByTestId(`board-draw-stroke-${strokeWidth}`).click();
   const start={x:120,y:250},baseline=await state();await page.mouse.move(start.x,start.y);await page.mouse.down();await page.mouse.move(end.x,end.y,{steps:20});assertHeldUncommitted(baseline,await state());await page.mouse.up();
   const persisted=await poll(objects,rows=>rows.length===1),stroke=strokes(persisted)[0];assert.equal(stroke.width,strokeWidth);assert.equal(stroke.tool,'pen');assert.equal(stroke.color,'#18181B');assert.equal(stroke.opacity,1);
   assertReleasedOnce(baseline,await state());
   await deselectForPixels(`${width}-${strokeWidth}-${direction}`);
   assert(stroke.points.every(point=>Math.abs(point.pressure-.5)<.01),'Mouse pressure contract must be .5; do not derive expected width from measured pixels');
   const effective=strokeWidth*(.35+.5*.65),radius=effective/2,dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy),u={x:dx/length,y:dy/length},n={x:-u.y,y:u.x},center={x:(start.x+end.x)/2,y:(start.y+end.y)/2};
   const points=[center,{x:start.x-u.x*radius*.6,y:start.y-u.y*radius*.6},{x:end.x+u.x*radius*.6,y:end.y+u.y*radius*.6},{x:center.x+n.x*radius*.6,y:center.y+n.y*radius*.6},{x:center.x-n.x*radius*.6,y:center.y-n.y*radius*.6},{x:start.x-u.x*(radius+2),y:start.y-u.y*(radius+2)},{x:end.x+u.x*(radius+2),y:end.y+u.y*(radius+2)},{x:center.x+n.x*(radius+2),y:center.y+n.y*(radius+2)},{x:center.x-n.x*(radius+2),y:center.y-n.y*(radius+2)}];
   const samples=await inkSamples(points),scan=await inkSamples(Array.from({length:41},(_,index)=>({x:center.x+n.x*(index-20),y:center.y+n.y*(index-20)}))),thickness=assertStrokePixelOracle({samples,scan,effective,strokeWidth});
   const persistedState=await state();await screenshot(`${width}-${strokeWidth}-${direction}-caps-width`);await page.reload();await page.getByTestId('board-add-draw').waitFor();assert.deepEqual(await state(),persistedState);await deselectForPixels(`${width}-${strokeWidth}-${direction}-reload`);const reloadSamples=await inkSamples(points);assert.deepEqual(reloadSamples.map(sample=>sample.rgba),samples.map(sample=>sample.rgba),'Reload must preserve exact cap/width pixels');results.push({width,strokeWidth,direction,effective,thickness,samples});
  }
 }
 const finalAttestation=attest(),runnerHashes=hashDrivers();assert.deepEqual(runnerHashes,initialDriverHashes,'All executed driver/oracle files must remain unchanged');writeFileSync(join(args.out,'draw-result.json'),JSON.stringify({status:'scoped-draw-checks-passed',initialAttestation,finalAttestation,runnerHashes,screenshots,results,pacing:scheduler.statistics,limitations:['No native macOS trackpad attestation','Does not certify full backlog or full visual CI','Dedicated private boards retained for inspection; archive after evidence review']},null,2),{mode:0o600});
}catch(error){await screenshot('strict-failure').catch(()=>{console.error('R05_FAILURE_SCREENSHOT_UNAVAILABLE');});try{writeFileSync(join(args.out,'draw-failure.json'),JSON.stringify({reason:'R05_ACCEPTANCE_FAILED',state:await state(),screenshots,requiredSuiteComplete:false},null,2),{mode:0o600});}catch{console.error('R05_FAILURE_CANONICAL_UNAVAILABLE');}throw error;}
}catch(error){
 recordFailure(failureState,error);
 if(outputReady){try{writeFileSync(join(args.out,'draw-terminal-failure.json'),JSON.stringify({status:'failed',reason:'R05_SETUP_OR_ACCEPTANCE_FAILED',requiredSuiteComplete:false,browserVisualAccepted:false},null,2),{mode:0o600,flag:'wx'});}catch{console.error('R05_TERMINAL_RECEIPT_UNAVAILABLE');}}
}finally{if(browser){try{await browser.close();}catch(cleanupError){if(outputReady){try{writeFileSync(join(args.out,'draw-cleanup-failure.json'),JSON.stringify({status:'failed',reason:'R05_BROWSER_CLOSE_FAILED',requiredSuiteComplete:false,browserVisualAccepted:false}),{mode:0o600,flag:'wx'});}catch{console.error('R05_CLEANUP_RECEIPT_UNAVAILABLE');}}recordFailure(failureState,cleanupError);}}}
reportFailure(failureState);
