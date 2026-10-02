import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import type {Browser,BrowserContext,Page} from '@playwright/test';

const args=process.argv.slice(2),arg=(n:string)=>args.includes(`--${n}`)?args[args.indexOf(`--${n}`)+1]:undefined;
const root=arg('root'),base=arg('base'),api=arg('api'),state=arg('storage-state'),manifestPath=arg('runtime-manifest'),out=arg('out'),width=Number(arg('width')??1440),expectedHead=arg('expected-head');
assert(root&&base&&api&&state&&manifestPath&&out&&expectedHead&&/^[a-f0-9]{40}$/.test(expectedHead));assert([1440,390].includes(width));assert(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true,mode:0o700});
const hash=(b:any)=>createHash('sha256').update(b).digest('hex');
const driverPath=fileURLToPath(import.meta.url),driverHash=hash(fs.readFileSync(driverPath));
const owned=['apps/web/components/whiteboard/board-bottom-dock.tsx','apps/web/components/whiteboard/board-sticky-picker.tsx','apps/web/components/whiteboard/board-tool-preview.tsx','apps/web/components/whiteboard/collaborative-thinking-editor.tsx'];
const manifestBytes=fs.readFileSync(manifestPath),manifest=JSON.parse(manifestBytes.toString('utf8'));assert.equal(manifest.ready,true);assert.equal(manifest.head,expectedHead);assert.equal(manifest.webBase,base);assert.equal(manifest.apiBase,api);
const provenance=owned.map(file=>{const actual=hash(fs.readFileSync(path.join(root,file))),ref=spawnSync('git',['show',`${expectedHead}:${file}`],{cwd:root});assert.equal(ref.status,0);const expected=hash(ref.stdout);assert.equal(actual,expected,`${file} must equal latest explicit PR source, not previous screenshots`);assert.equal(manifest.sourceHashes[file],actual,`${file} must be bound to running source`);return{file,sha256:actual};});
process.env.WORKSPACEX_API_PORT=new URL(api).port;
async function main(){
 const runtime=await import(pathToFileURL(path.join(root,'scripts/local-session/board-acceptance-runtime.mjs')).href);
 const navigation=await import(pathToFileURL(path.join(root,'scripts/local-session/board-navigation-acceptance-runtime.mjs')).href);
 const generator=arg('source-generator'),generatorHash=arg('source-generator-sha');assert(generator&&generatorHash);assert.equal(generatorHash,'12e27e01a3057acd468857d7dffe404d975af1868375d74480f0e76ec38aabca');assert.equal(hash(fs.readFileSync(generator)),generatorHash);
 const {listRuntimeSourceFiles}=await import(pathToFileURL(generator).href);
 const required=[...new Set([...listRuntimeSourceFiles(root),...navigation.sourceFiles,...owned])];
 for(const file of required)assert(manifest.sourceHashes[file],`runtime must attest ${file}`);
 assert.deepEqual(Object.keys(manifest.sourceHashes).sort(),required.sort());
 const runtimeOptions={manifestPath,root,base,origin:api,sourceFiles:Object.keys(manifest.sourceHashes)};
 const evidenceBefore=runtime.verifyRuntimeManifest(runtimeOptions);
 const support=await import(pathToFileURL(path.join(root,'apps/web/e2e/board-acceptance-support.ts')).href);
 const {chromium,expect}=createRequire(path.join(root,'apps/web/package.json'))('@playwright/test');
 const {createAcceptanceRequestScheduler}=await import(pathToFileURL(path.join(root,'scripts/local-session/board-navigation-acceptance-scheduler.mjs')).href),scheduler=createAcceptanceRequestScheduler();
 let browser:Browser|undefined,context:BrowserContext|undefined,page:Page,setupFailure:unknown;
 try {
 browser=await chromium.launch({headless:true});context=await browser.newContext({storageState:state,baseURL:base,viewport:{width,height:900}});page=await context.newPage();
 const {createSpatialWsMetadataRecorder}=await import(pathToFileURL(path.join(root,'apps/web/e2e/support/board-spatial-ws-metadata.ts')).href);
 const transport=createSpatialWsMetadataRecorder();transport.observe(page,'original');let transactionCursor=0;
 const {expectBoardSynced}=await import(pathToFileURL(path.join(root,'apps/web/e2e/support/board-sync-status.ts')).href);
 const request=new Proxy(context.request,{get(target,key){if(key==='fetch')return(...a:Parameters<typeof target.fetch>)=>scheduler.run(()=>target.fetch(...a));const m=Reflect.get(target,key,target);return typeof m==='function'?m.bind(target):m;}});
 await context.route(/\/v1\//,(route:any)=>scheduler.run(async()=>{const r=await route.fetch({maxRetries:0});assert.notEqual(r.status(),429);await route.fulfill({response:r});}));
 await context.addInitScript(()=>{(window as any).__nativeToolDrag=[];for(const type of ['dragstart','drop','dragend'])document.addEventListener(type,e=>{const event=e as DragEvent;(window as any).__nativeToolDrag.push({type,isTrusted:event.isTrusted,types:[...(event.dataTransfer?.types??[])],target:(event.target as Element)?.closest('[data-testid]')?.getAttribute('data-testid')});},true);});
 const storage=JSON.parse(fs.readFileSync(state,'utf8')).origins.find((o:any)=>o.origin===new URL(base).origin),local=new Map<string,string>(storage.localStorage.map((o:any)=>[o.name,o.value])),token=local.get('wsx.sessionToken');assert(token);
 const results:any[]=[],shots:any[]=[],errors:any[]=[];let id:string|undefined,failure:string|null=null,deleted=false;
 page.on('pageerror',()=>errors.push({kind:'pageerror'}));page.on('response',(r:any)=>{if(r.status()>=400)errors.push({kind:'http',status:r.status()});});
 const shot=async(name:string)=>{const file=path.join(out,`${name}.png`),bytes=await page.screenshot({path:file});shots.push({file,bytes:bytes.length,sha256:hash(bytes)});};
 const physical=async(locator:any)=>{await locator.scrollIntoViewIfNeeded();await support.settled(page);const b=await locator.boundingBox();assert(b);const hit=await locator.evaluate((e:any)=>{const r=e.getBoundingClientRect(),actual=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return !!actual&&e.contains(actual);});assert(hit,'real center target must not be clipped or occluded');return b;};
 const blank=async(x:number,y:number)=>{const surface=page.getByTestId('board-fabric-surface'),b=await surface.boundingBox();assert(b);const client={x:b.x+x,y:b.y+y};assert.equal(await page.evaluate(p=>(document.elementFromPoint(p.x,p.y) as HTMLElement)?.dataset.fabric,client),'top');await page.mouse.click(client.x,client.y);};
 const uniqueTitle=`R04 native tools ${width} ${randomUUID()}`,session=JSON.parse(String(local.get('wsx.session')));assert(session.userId);
 try{
 const {FULLSTACK_E2E:F}=await import(pathToFileURL(path.join(root,'apps/web/e2e/fullstack-smoke-fixture.ts')).href);assert.equal(session.userId,F.userId,'command actor must match authenticated owner');
 id=await support.createAcceptanceBoard(request,token,uniqueTitle);await support.openBoard(page,id,0);
 const actualOwner=await(await support.boardApi(request,token,'GET',`/whiteboards/${id}`)).json();assert.equal(actualOwner.ownerId,session.userId);assert.equal(actualOwner.name,uniqueTitle);
 const read=async()=>(await support.canonicalBoardSnapshot(request,token,id)).objects;
 const head=async()=>support.boardHead(request,token,id);
 const core=await import(pathToFileURL(path.join(root,'packages/whiteboard-core/src/index.ts')).href);
 const creationView=async()=>({objects:await read(),head:await head()});
 const zeroWrites=async(before:any)=>{await support.settled(page);await expectBoardSynced(page);assert.deepEqual(await creationView(),before);assert.deepEqual(transport.snapshot().events.slice(transactionCursor).filter(e=>e.direction==='sent'&&e.type==='update'),[]);};
 const assertSingleCommit=async(before:any)=>{await expect.poll(async()=>(await head()).seq).toBe(before.seq+1);await expectBoardSynced(page);await support.settled(page);const after=await head();assert.equal(after.epoch,before.epoch);assert.equal(after.seq,before.seq+1);const sent=transport.snapshot().events.slice(transactionCursor).filter(e=>e.direction==='sent'&&e.type==='update');assert.equal(sent.length,1);const submitted=sent[0];assert(submitted.updateId);await expect.poll(()=>transport.snapshot().events.filter(e=>e.direction==='received'&&e.type==='ack'&&e.socketId===submitted.socketId&&e.updateId===submitted.updateId&&e.seq===after.seq).length).toBe(1);assert.equal(transport.snapshot().dropped,0);transactionCursor=transport.snapshot().events.length;return after;};
 const arm=async(kind:string)=>{const trigger=page.getByTestId(`board-add-${kind}`),b=await physical(trigger);assert.equal(await page.getByTestId(`board-add-${kind}-submenu`).count(),1);await trigger.click();await support.settled(page);const picker=page.getByTestId('board-tool-picker'),p=await picker.boundingBox();assert(p);assert(p.y+p.height<=b.y+1,'tool submenu is above its own trigger');assert(p.x>=0&&p.x+p.width<=width&&p.y>=64,'submenu is not clipped by viewport chrome');await shot(`${kind}-submenu-${width}`);return picker;};
 for(const [toolIndex,kind] of ['sticky','text','shape'].entries()){
 const before=await read(),beforeHead=await head();await arm(kind);assert.deepEqual(await read(),before);assert.deepEqual(await head(),beforeHead,'arming creates nothing');
 if(kind==='sticky')for(const [colorName,color] of Object.entries(core.STICKY_COLOR_PRESETS)){
  await page.getByTestId(`board-sticky-default-${colorName}`).click();
  for(const variant of ['square','rectangle','circle']){
   const option=page.getByTestId(`board-sticky-${variant}`);await physical(option);await option.click();
   for(const preview of [option.locator('[data-sticky-variant]'),page.getByTestId('board-add-sticky').locator('[data-sticky-variant]')]){
    assert.equal(await preview.getAttribute('data-sticky-variant'),variant);
    const visual=await preview.evaluate(e=>({color:getComputedStyle(e).backgroundColor,radius:getComputedStyle(e).borderRadius,width:e.getBoundingClientRect().width,height:e.getBoundingClientRect().height}));
    const expectedColor=await page.evaluate(color=>{const e=document.createElement('span');e.style.color=String(color);document.body.append(e);const result=getComputedStyle(e).color;e.remove();return result;},color);
    assert.equal(visual.color,expectedColor);assert.equal(visual.radius,variant==='circle'?'50%':'2px');assert.equal(visual.width,variant==='rectangle'?30:24);assert.equal(visual.height,variant==='rectangle'?19:24);
   }
   await zeroWrites({objects:before,head:beforeHead});await shot(`sticky-${colorName}-${variant}-preview`);
  }
 }
 if(kind==='shape')for(const variant of ['rectangle','rounded-rectangle','circle','ellipse','diamond','triangle','hexagon','cloud','database','document','process','decision','terminator','data','predefined-process']){
  const option=page.getByTestId(`board-shape-${variant}`);await physical(option);await option.click();const svg=option.locator('svg');assert.equal(await svg.getAttribute('fill'),'none');assert((await svg.locator('path,rect,ellipse').count())>0);assert.equal(await page.getByTestId('board-add-shape').locator('svg:not(.submenu)').innerHTML(),await svg.innerHTML());await zeroWrites({objects:before,head:beforeHead});await shot(`shape-${variant}-preview`);
 }
 if(kind==='sticky'){await page.getByTestId('board-sticky-default-blue').click();await page.getByTestId('board-sticky-circle').click();const preview=page.getByTestId('board-add-sticky').locator('[data-sticky-variant]');assert.equal(await preview.getAttribute('data-sticky-variant'),'circle');const style=await preview.evaluate(e=>({bg:getComputedStyle(e).backgroundColor,radius:getComputedStyle(e).borderRadius,box:e.getBoundingClientRect().toJSON()}));assert.equal(style.radius,'50%');assert.equal(style.box.width,style.box.height);assert.equal(style.bg,await page.getByTestId('board-sticky-circle').locator('[data-sticky-variant]').evaluate(e=>getComputedStyle(e).backgroundColor));results.push({case:'sticky-preview',style});await shot('sticky-color-circle-preview');}
 if(kind==='text'){const expected={title:[36,'700'],heading:[24,'700'],subheading:[18,'700'],body:[14,'400'],caption:[12,'400']};const visual=[];for(const [preset,[size,weight]] of Object.entries(expected)){const option=page.getByTestId(`board-text-${preset}`);await physical(option);const css=await option.locator('span').evaluate(e=>({size:parseFloat(getComputedStyle(e).fontSize),weight:getComputedStyle(e).fontWeight}));assert.equal(css.size,size);assert.equal(css.weight,weight);visual.push({preset,...css});}results.push({case:'text-presets',visual});await shot('text-real-typography');await page.getByTestId('board-text-heading').click();}
 if(kind==='shape'){const icons=[];for(const variant of ['rectangle','circle','diamond','triangle']){const option=page.getByTestId(`board-shape-${variant}`);await physical(option);const svg=option.locator('svg');assert.equal(await svg.getAttribute('fill'),'none');icons.push(await svg.innerHTML());}assert.equal(new Set(icons).size,icons.length);results.push({case:'shape-real-outlines',icons});await shot('shape-real-outlines');await page.getByTestId('board-shape-diamond').click();}
 await blank(width===390?85:400+toolIndex*260,width===390?130+toolIndex*230:200);await expect.poll(read).toHaveLength(before.length+1);await expect(page.getByTestId('board-tool-select')).toHaveAttribute('aria-pressed','true');await expect(page.getByTestId(`board-add-${kind}`)).toHaveAttribute('aria-pressed','false');const committedHead=await assertSingleCommit(beforeHead);
 const after=await read(),created=after.find((o:any)=>!before.some((b:any)=>b.id===o.id));assert(created);assert.equal(created.kind,kind==='shape'?'extension':kind);if(kind==='sticky'){assert.equal(created.style.fill.toUpperCase(),'#C6DDFF');assert.equal(created.extensionData.thinkingInput.sticky.variant,'circle');}if(kind==='text'){assert.equal(created.extensionData.thinkingInput.text.preset,'heading');assert.equal(created.style.fontSize,32);}if(kind==='shape'){assert.equal(created.extensionData.contentObject.type,'shape');assert.equal(created.extensionData.contentObject.variant,'diamond');}await shot(`${kind}-single-created`);
 const editor=page.getByTestId('board-thinking-editor');if(await editor.count()){await expect(editor).toBeVisible();await editor.press('Escape');await expect(editor).toHaveCount(0);}
 await blank(width===390?300:1250,50);await zeroWrites({objects:after,head:committedHead});results.push({case:`${kind}-one-shot`,createdId:created.id,count:after.length,beforeHead,committedHead});
 }
 for(const kind of ['sticky','text','shape']){
 const cancellationBaseline=await creationView();await arm(kind);await page.evaluate(()=>(window as any).__nativeToolDrag=[]);
 const dragButton=page.getByTestId(`board-add-${kind}`),dragBox=await physical(dragButton),outside={x:width/2,y:30};assert.notEqual(await page.evaluate(point=>(document.elementFromPoint(point.x,point.y) as HTMLElement)?.dataset.fabric,outside),'top');
 await page.mouse.move(dragBox.x+dragBox.width/2,dragBox.y+dragBox.height/2);await page.mouse.down();try{await page.mouse.move(dragBox.x+dragBox.width/2+10,dragBox.y+dragBox.height/2-10,{steps:3});await page.mouse.move(outside.x,outside.y,{steps:16});}finally{await page.mouse.up();}
 const cancelledEvents=await page.evaluate(()=>(window as any).__nativeToolDrag);assert(cancelledEvents.some((event:any)=>event.type==='dragstart'&&event.isTrusted));assert(cancelledEvents.some((event:any)=>event.type==='dragend'&&event.isTrusted));await expect(page.getByTestId('board-tool-select')).toHaveAttribute('aria-pressed','true');await zeroWrites(cancellationBaseline);await blank(width===390?300:1250,50);await zeroWrites(cancellationBaseline);await shot(`${kind}-cancelled-drag-zero-write`);
 await arm(kind);const palette=page.getByTestId(kind==='sticky'?'board-sticky-rectangle':kind==='text'?'board-text-body':'board-shape-circle'),b=await physical(palette),before=await read();await page.evaluate(()=>(window as any).__nativeToolDrag=[]);
 await page.getByTestId('board-zoom-fit-board').click();await support.settled(page);const stage=page.getByTestId('board-fabric-surface'),stageBox=await stage.boundingBox();assert(stageBox);const currentZoom=Number(await stage.getAttribute('data-viewport-zoom'));await page.mouse.move(stageBox.x+20,stageBox.y+100);await page.keyboard.down('Control');try{await page.mouse.wheel(0,Math.log(1.54/currentZoom)/Math.log(.998));}finally{await page.keyboard.up('Control');}await support.settled(page);assert(Math.abs(Number(await stage.getAttribute('data-viewport-zoom'))-1.54)<.0001,'native DND exercised at genuine fractional zoom, not identity viewport');
 const surfaceLocator=page.getByTestId('board-fabric-surface'),surface=await surfaceLocator.boundingBox();assert(surface);const drop={x:surface.x+(width===390?190:700),y:surface.y+500},zoom=Number(await surfaceLocator.getAttribute('data-viewport-zoom')),panX=Number(await surfaceLocator.getAttribute('data-viewport-pan-x')),panY=Number(await surfaceLocator.getAttribute('data-viewport-pan-y')),expectedScene={x:(drop.x-surface.x-panX)/zoom,y:(drop.y-surface.y-panY)/zoom};
 const freshPalette=await physical(palette),dragHead=await head();assert.equal(await page.evaluate(p=>(document.elementFromPoint(p.x,p.y) as HTMLElement)?.dataset.fabric,drop),'top','native DND drop must hit unobstructed canvas');
 await page.mouse.move(freshPalette.x+freshPalette.width/2,freshPalette.y+freshPalette.height/2);await page.mouse.down();await page.mouse.move(freshPalette.x+freshPalette.width/2+8,freshPalette.y+freshPalette.height/2-8,{steps:3});await page.mouse.move(drop.x,drop.y,{steps:16});await page.mouse.up();
 await expect.poll(read).toHaveLength(before.length+1);const events=await page.evaluate(()=>(window as any).__nativeToolDrag);assert(events.some((e:any)=>e.type==='dragstart'&&e.isTrusted&&e.types.includes('application/x-workspacex-board-tool')));assert(events.some((e:any)=>e.type==='drop'&&e.isTrusted&&e.types.includes('application/x-workspacex-board-tool')));
 await expect(page.getByTestId('board-tool-select')).toHaveAttribute('aria-pressed','true');const dragCommittedHead=await assertSingleCommit(dragHead),after=await read(),created=after.find((o:any)=>!before.some((old:any)=>old.id===o.id));assert(created);assert.equal(created.kind,kind==='shape'?'extension':kind);if(kind==='sticky')assert.equal(created.extensionData.thinkingInput.sticky.variant,'rectangle');if(kind==='text'){assert.equal(created.extensionData.thinkingInput.text.preset,'body');assert.equal(created.style.fontSize,18);}if(kind==='shape'){assert.equal(created.extensionData.contentObject.type,'shape');assert.equal(created.extensionData.contentObject.variant,'circle');}assert(Math.abs(created.geometry.x+created.geometry.width/2-expectedScene.x)<=1&&Math.abs(created.geometry.y+created.geometry.height/2-expectedScene.y)<=1,'native drop uses correct inverse viewport coordinates');await blank(width===390?300:1250,50);assert.deepEqual(await read(),after);assert.deepEqual(await head(),dragCommittedHead);results.push({case:`${kind}-native-DND`,events,expectedScene,created,dragHead,dragCommittedHead});await shot(`${kind}-native-DND-created`);
 }
 const frameId=`r04-existing-frame-${randomUUID()}`,arrowId=`r04-existing-arrow-${randomUUID()}`;
 const frame={...support.object(frameId,'frame',20,80,'Existing Frame',220,160),extensionData:{spatial:{version:1,mode:'freeform',autoExpand:false,clipContent:false,padding:24,gap:24,columns:3,flowDirection:'horizontal'}}};
 const arrow={...support.object(arrowId,'connector',20,330,'',220,1),style:{stroke:'#18181B'},connector:{fromPoint:{x:20,y:330},toPoint:{x:240,y:330},fromAnchor:'right',toAnchor:'left',type:'straight',startStyle:'none',endStyle:'arrow',lineStyle:'solid',strokeWidth:4,label:'',semanticRelation:''}};
 const oldHead=await head();await support.operate(request,token,id,support.createCommands([frame,arrow]));await expect.poll(read).toHaveLength(8);await expect.poll(async()=>(await head()).seq).toBe(oldHead.seq+1);assert.equal((await head()).epoch,oldHead.epoch);await expectBoardSynced(page);await support.settled(page);transactionCursor=transport.snapshot().events.length;
 await page.getByTestId('board-zoom-fit-board').click();await support.settled(page);
 const legacyPixels=async()=>{
  const surface=page.getByTestId('board-fabric-surface'),box=await surface.boundingBox();assert(box&&box.width>0&&box.height>0);
  const zoom=Number(await surface.getAttribute('data-viewport-zoom')),panX=Number(await surface.getAttribute('data-viewport-pan-x')),panY=Number(await surface.getAttribute('data-viewport-pan-y'));assert([zoom,panX,panY].every(Number.isFinite)&&zoom>0);
  return surface.locator('canvas.lower-canvas').evaluate((element,{box,zoom,panX,panY})=>{
   const canvas=element as HTMLCanvasElement,rect=canvas.getBoundingClientRect(),ctx=canvas.getContext('2d');if(!ctx||rect.width<=0||rect.height<=0)throw Error('R04_LEGACY_CANVAS_REQUIRED');
   return [{x:130,y:80},{x:130,y:330}].map(world=>{const x=Math.floor((box.x+panX+world.x*zoom-rect.x)*canvas.width/rect.width)-2,y=Math.floor((box.y+panY+world.y*zoom-rect.y)*canvas.height/rect.height)-2;if(x<0||y<0||x+5>canvas.width||y+5>canvas.height)throw Error('R04_LEGACY_PIXEL_OUTSIDE');return [...ctx.getImageData(x,y,5,5).data];});
  },{box,zoom,panX,panY});
 };
 const originalLegacyPixels=await legacyPixels();for(const pixels of originalLegacyPixels)assert(pixels.some((value,index)=>index%4===3&&value>0),'existing objects must visibly paint before preservation test');await shot('existing-frame-arrow-before');
 const beforeShortcuts=await read(),protectedHead=await head();assert.equal(await page.getByTestId('board-add-frame').count(),0);assert.equal(await page.getByTestId('board-add-arrow').count(),0);
 for(const key of ['f','c']){await page.getByTestId('board-fabric-surface').focus();await page.keyboard.press(key);await blank(width===390?300:1250,50);assert.deepEqual(await read(),beforeShortcuts);assert.deepEqual(await head(),protectedHead);await expect(page.getByTestId('board-tool-select')).toHaveAttribute('aria-pressed','true');}results.push({case:'hidden-frame-arrow-shortcuts-denied',protectedIds:[frameId,arrowId]});
 assert.deepEqual(await legacyPixels(),originalLegacyPixels);await shot('existing-frame-arrow-after-hidden-shortcuts');
 await arm('more');await page.keyboard.press('Escape');await page.getByTestId('board-tool-select').click();
 const draw=page.getByTestId('board-add-draw'),d=await physical(draw);assert.equal(await page.getByTestId('board-add-draw-submenu').count(),1);await draw.click();const panel=await page.getByTestId('board-draw-tool-panel').boundingBox();assert(panel&&panel.y+panel.height<=d.y+1&&panel.x>=0&&panel.x+panel.width<=width,'Draw submenu must also be above its own trigger without clipping');await shot('draw-submenu-anchor');await page.getByTestId('board-draw-select').click();results.push({case:'all-tool-submenu-above-trigger'});
 await expect(page.getByTestId('board-tool-select')).toHaveAttribute('aria-pressed','true');await blank(width===390?300:1250,50);
 const final=await read(),finalHead=await head();await page.reload();await expectBoardSynced(page);await expect.poll(read).toEqual(final);assert.deepEqual(await head(),finalHead);assert.deepEqual(await legacyPixels(),originalLegacyPixels);await shot('tools-reload-persisted');results.push({case:'reload-zero-loss',count:final.length,finalHead,protectedIds:[frameId,arrowId]});
 }catch(e){failure='R04_CASE_FAILED';throw e;}finally{
 try{await page.goto('about:blank');if(id){const original=await(await support.boardApi(request,token,'GET',`/whiteboards/${id}`)).json();assert.equal(original.ownerId,session.userId);assert.equal(original.name,uniqueTitle);await support.archiveAcceptanceBoard(request,token,id);const metadata=await(await support.boardApi(request,token,'GET',`/whiteboards/${id}`)).json();await support.boardApi(request,token,'DELETE',`/whiteboards/${id}`,{requestId:randomUUID(),confirmation:'PERMANENTLY_DELETE',expectedLifecycleRevision:metadata.lifecycleRevision});const fresh=await scheduler.run(()=>context.request.get(`${api}/whiteboards/${id}`,{headers:{authorization:`Bearer ${token}`}}));assert.equal(fresh.status(),404);deleted=true;}}catch(e){errors.push({kind:'cleanup'});}
 await browser.close();let evidenceAfter;try{evidenceAfter=runtime.verifyRuntimeManifest(runtimeOptions);assert.deepEqual(evidenceAfter,evidenceBefore);}catch(e){errors.push({kind:'runtime-attestation'});}const stable=provenance.every(p=>hash(fs.readFileSync(path.join(root,p.file)))===p.sha256),passed=!failure&&errors.length===0&&deleted&&stable&&results.length===12;
 assert.equal(hash(fs.readFileSync(driverPath)),driverHash);assert.equal(hash(fs.readFileSync(generator)),generatorHash);assert.equal(hash(fs.readFileSync(manifestPath)),hash(manifestBytes));
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({status:passed?'r04-tools-subset-pass':'fail',expectedHead,manifestHead:manifest.head,driverHash,generatorHash,evidenceBefore,evidenceAfter,provenance,stable,width,failure:failure?'R04_CASE_FAILED':null,results,errors,deleted,shots,requestPacing:scheduler.statistics,coverageComplete:false},null,2),{flag:'wx',mode:0o600});if(!passed)process.exitCode=1;
 }
 }catch(error){setupFailure=error;throw error;}finally{
 const cleanupFailures:unknown[]=[];
 try{if(context&&browser?.isConnected())await context.close();}catch(error){cleanupFailures.push(error);}
 try{if(browser?.isConnected())await browser.close();}catch(error){cleanupFailures.push(error);}
 if(setupFailure&&!fs.existsSync(path.join(out,'report.json')))fs.writeFileSync(path.join(out,'report.json'),JSON.stringify({status:'fail',expectedHead,driverHash,coverageComplete:false,stage:'setup-or-cleanup',browserClosed:!browser?.isConnected(),cleanupFailures:cleanupFailures.length}),{flag:'wx',mode:0o600});
 if(cleanupFailures.length)throw new AggregateError(setupFailure?[setupFailure,...cleanupFailures]:cleanupFailures,'R04_RESOURCE_CLEANUP_FAILED');
 }
}
main().catch(()=>{console.error('R04 acceptance failed; see private artifact.');process.exitCode=1;});
