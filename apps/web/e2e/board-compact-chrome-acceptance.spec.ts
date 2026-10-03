import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {expect,test,type Page,type TestInfo} from '@playwright/test';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {SESSION_TOKEN_STORAGE_KEY} from '../lib/api-client';
import {apiOrigin,canonicalBoardSnapshot,connectByHandles,seedExistingFrame} from './board-acceptance-support';
import {compactBlankPoints} from './support/board-compact-blank';
import {verifyEditorConnectorEntry} from './support/board-editor-connector-entry';

const referenceViewports=[{width:1024,height:900},{width:1536,height:1024},{width:1672,height:941}] as const;
const dockOrder=['board-tool-select','board-tool-hand','board-add-sticky','board-add-text','board-add-shape','board-add-draw','board-add-image','board-add-more'] as const;
async function captureReference(page:Page,info:TestInfo,name:string){const path=info.outputPath(`${name}.png`);await page.screenshot({path,fullPage:false});await info.attach(name,{path,contentType:'image/png'});}
const separated=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>a.x+a.width<=b.x+1||b.x+b.width<=a.x+1||a.y+a.height<=b.y+1||b.y+b.height<=a.y+1;

test('real thirty-note Board keeps compact chrome and intentional connection handles',async({page,request},info)=>{
 const guardView={x:0,y:0,width:500,height:400,zoom:1,panX:0,panY:0};
 expect(()=>compactBlankPoints(guardView,[{geometry:{x:0,y:0,width:500,height:400,rotation:0}}])).toThrow('NO_VERIFIED_COMPACT_BLANK');
 expect(()=>compactBlankPoints(guardView,[{geometry:{x:100,y:100,width:180,height:140,rotation:5}}])).toThrow('UNSUPPORTED_COMPACT_GEOMETRY');
 expect(()=>compactBlankPoints({...guardView,zoom:NaN},[])).toThrow('INVALID_COMPACT_VIEW');
 const api=process.env.WHITEBOARD_API_URL??`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`;
 if(!process.env.WHITEBOARD_API_URL&&!process.env.WORKSPACEX_API_PORT)throw new Error('Real isolated API URL is required');
 expect(api,'canonical reads must use the same isolated API as fixture writes').toBe(apiOrigin());
 await page.goto('/login');await page.getByTestId('login-email').fill(F.adminEmail);await page.getByTestId('login-password').fill(F.adminPassword);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/(?:home|projects)$/);
 const token=await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY);expect(token).toBeTruthy();
 const call=async(method:string,path:string,data?:unknown)=>{const response=await request.fetch(`${api}${path}`,{method,data,headers:{Authorization:`Bearer ${token}`}});expect(response.ok(),`${method} ${path}: ${response.status()}`).toBe(true);return response.json();};
 const board=await call('POST','/whiteboards',{requestId:randomUUID(),name:'Thirty notes · compact controls'});
 let sentUpdates=0;const existingFrameIds:string[]=[];
 page.on('websocket',socket=>{if(socket.url().includes(`/whiteboards/${board.id}/sync`))socket.on('framesent',frame=>{
  try{if(JSON.parse(frame.payload.toString()).type==='update')sentUpdates++;}catch{/* Non-JSON protocol frames are not document updates. */}
 });});
 try{
  await call('POST',`/v1/whiteboards/${board.id}/operations`,{apiVersion:'2026-09-01',requestId:randomUUID(),boardId:board.id,expectedRevision:{epoch:1,seq:0},actor:{kind:'human',actorId:F.adminUserId,orgId:F.orgId,role:'owner',scopes:['board:read','board:write'],delegatedBy:null},provenance:{source:'public-api',model:null,skill:null,sourceArtifactId:null,sourceRevision:null,layoutHash:null,inputObjectIds:[]},commands:Array.from({length:30},(_,i)=>({type:'create',object:{id:`idea-${i}`,schemaVersion:1,kind:'sticky',geometry:{x:100+(i%6)*204,y:100+Math.floor(i/6)*164,width:180,height:140,rotation:0},text:`想法 ${i+1}`,style:{fill:['#FFE99A','#C6DDFF','#FBC9DF'][i%3]},parentId:null,orderKey:String(i).padStart(2,'0')}}))});
  const seededSnapshot=await canonicalBoardSnapshot(request,token!,board.id);expect(seededSnapshot.objects).toHaveLength(30);
  await page.goto(`/studio/board/${board.id}`);await expect(page.getByTestId('board-sync-status')).toHaveAttribute('aria-label',/已同步/);
  for(const viewport of referenceViewports){
   const {width,height}=viewport,label=`${width}x${height}`;
   await page.setViewportSize(viewport);await page.getByTestId('board-tool-select').click();await page.keyboard.press('ControlOrMeta+a');
   await expect(page.getByTestId('board-selection-layout-toolbar')).toBeVisible();await page.getByTestId('board-zoom-fit-board').click();await page.mouse.move(10,10);
   await expect(page.locator('[data-testid^="connector-handle-"]')).toHaveCount(0);
   const status=await page.getByTestId('board-sync-status').evaluate(el=>({height:el.getBoundingClientRect().height,whiteSpace:getComputedStyle(el).whiteSpace}));expect(status.whiteSpace).toBe('nowrap');expect(status.height).toBeLessThanOrEqual(32);
   const header=(await page.getByTestId('board-editor-header').boundingBox())!,navigation=(await page.getByTestId('board-navigation-controls').boundingBox())!,selection=(await page.getByTestId('board-selection-layout-toolbar').boundingBox())!;
   expect(header.height).toBeCloseTo(64,0);expect(header.width).toBeLessThanOrEqual(width);const dock=(await page.getByTestId('board-creation-dock').boundingBox())!;expect(selection.y+selection.height).toBeLessThan(dock.y);
   const headerLayout=await page.getByTestId('board-editor-header').evaluate(element=>{const bounds=element.getBoundingClientRect(),items=[...element.children].map(child=>child.getBoundingClientRect()).filter(rect=>rect.width>0&&rect.height>0).map(rect=>({left:rect.left,right:rect.right}));return{left:bounds.left,right:bounds.right,clientWidth:element.clientWidth,scrollWidth:element.scrollWidth,items};});expect(headerLayout.scrollWidth).toBeLessThanOrEqual(headerLayout.clientWidth);for(const item of headerLayout.items){expect(item.left).toBeGreaterThanOrEqual(headerLayout.left);expect(item.right).toBeLessThanOrEqual(headerLayout.right);}for(let index=1;index<headerLayout.items.length;index++)expect(headerLayout.items[index-1]!.right).toBeLessThanOrEqual(headerLayout.items[index]!.left+1);
   const navigationLayout=await page.getByTestId('board-navigation-controls').evaluate(element=>{const rect=element.getBoundingClientRect(),parent=(element as HTMLElement).offsetParent,parentRect=parent?.getBoundingClientRect();const ancestors=[];let current:HTMLElement|null=element as HTMLElement;for(let depth=0;current&&depth<5;depth++,current=current.parentElement){const bounds=current.getBoundingClientRect(),style=getComputedStyle(current),offset=current.offsetParent,offsetBounds=offset?.getBoundingClientRect();ancestors.push({depth,bounds:{x:bounds.x,y:bounds.y,width:bounds.width,height:bounds.height},position:style.position,right:style.right,overflowX:style.overflowX,overflowY:style.overflowY,fontSize:style.fontSize,clientWidth:current.clientWidth,offsetWidth:current.offsetWidth,scrollWidth:current.scrollWidth,scrollLeft:current.scrollLeft,scrollTop:current.scrollTop,offsetParent:offsetBounds?{x:offsetBounds.x,y:offsetBounds.y,width:offsetBounds.width,height:offsetBounds.height}:null});}return{navigation:{x:rect.x,y:rect.y,width:rect.width,height:rect.height},offsetParent:parentRect?{x:parentRect.x,y:parentRect.y,width:parentRect.width,height:parentRect.height,clientWidth:parent!.clientWidth}:null,ancestors,documentClientWidth:document.documentElement.clientWidth,innerWidth:window.innerWidth,innerHeight:window.innerHeight};});
   const navigationLayoutPath=info.outputPath(`navigation-layout-${label}.json`);await writeFile(navigationLayoutPath,JSON.stringify(navigationLayout,null,2),{flag:'wx',mode:0o600});
   await info.attach(`navigation-layout-${label}`,{path:navigationLayoutPath,contentType:'application/json'});
   expect(navigation.x+navigation.width).toBeCloseTo(width-16,0);
   expect(dock.x).toBeGreaterThanOrEqual(16);expect(dock.x+dock.width).toBeLessThanOrEqual(width-16);
   if(width<1280)expect(navigation.y+navigation.height).toBeLessThanOrEqual(dock.y-2);else{expect(navigation.y+navigation.height).toBeCloseTo(height-20,0);expect(navigation.x).toBeGreaterThanOrEqual(dock.x+dock.width+16);}for(const id of ['board-overview-fit','board-zoom-menu','board-zoom-fit-board'])await expect(page.getByTestId(id)).toBeVisible();
   if(width===1024)await expect(page.getByTestId('board-editor-header').getByRole('button',{name:'开始演示',exact:true})).toHaveCount(0);
   const dockMetrics=await page.getByTestId('board-creation-dock').locator(':scope > div').last().evaluate(el=>({clientWidth:el.clientWidth,scrollWidth:el.scrollWidth}));expect(dockMetrics.scrollWidth).toBeLessThanOrEqual(dockMetrics.clientWidth);
   await verifyEditorConnectorEntry(page,board.id,call,()=>captureReference(page,info,`reference-connector-picker-${label}`));
   await page.keyboard.press('ControlOrMeta+a');await expect(page.getByTestId('board-selection-layout-toolbar')).toBeVisible();
   await expect(page.locator('[data-testid^="connector-handle-"]')).toHaveCount(0);
   const toolBounds=await Promise.all(dockOrder.map(async id=>({id,box:(await page.getByTestId(id).boundingBox())!})));for(let index=1;index<toolBounds.length;index++)expect(toolBounds[index]!.box.x).toBeGreaterThan(toolBounds[index-1]!.box.x);
   await expect.poll(async()=>{const surface=page.getByTestId('board-fabric-surface'),view=await surface.evaluate(el=>({z:Number(el.getAttribute('data-viewport-zoom')),x:Number(el.getAttribute('data-viewport-pan-x')),y:Number(el.getAttribute('data-viewport-pan-y'))}));return 100*view.z+view.x>=31&&1300*view.z+view.x<=width-31&&100*view.z+view.y>=header.y+header.height+15&&896*view.z+view.y<=dock.y-11;}).toBe(true);
   await captureReference(page,info,`reference-shell-${label}`);
   if(width===1024)continue;

   await page.getByTestId('board-tool-select').click();await page.getByTestId('board-add-draw').click();
   const drawPanel=page.getByTestId('board-draw-tool-panel');await expect(drawPanel).toBeVisible();const drawBounds=(await drawPanel.boundingBox())!;
   expect(drawBounds.width).toBeLessThanOrEqual(640);expect(drawBounds.height).toBeGreaterThanOrEqual(110);expect(drawBounds.height).toBeLessThanOrEqual(180);expect(drawBounds.x).toBeGreaterThanOrEqual(16);expect(drawBounds.x+drawBounds.width).toBeLessThanOrEqual(width-16);expect(drawBounds.y+drawBounds.height).toBeLessThanOrEqual(dock.y-2);
   for(const id of ['board-draw-pen','board-draw-marker','board-draw-pencil','board-draw-highlighter','board-draw-eraser','board-draw-stroke-8','board-draw-color-custom'])await expect(page.getByTestId(id)).toBeVisible();
   await expect(page.locator('[data-testid^="board-draw-opacity-"]')).toHaveCount(0);
   for(const choice of ['pen','marker','pencil','highlighter'])await expect(page.getByTestId(`board-draw-preview-${choice}`)).toBeVisible();
   await captureReference(page,info,`reference-draw-panel-${label}`);await page.getByTestId('board-draw-select').click();await expect(drawPanel).toBeHidden();

   // R04 hides the new Frame palette; retain its historical geometry reference
   // in evidence and exercise all stored Frame properties through the visible UI.
   await info.attach('legacy-frame-palette-reference',{body:Buffer.from(JSON.stringify({reachable:false,reason:'R04 draft hides new Frame creation; design approval remains pending',width:[360,386],height:[340,410],viewportMargin:16,bottomGap:2})),contentType:'application/json'});
   const existingFrame=await seedExistingFrame(page,100,100);
   existingFrameIds.push(existingFrame);
   const frameOutline=page.getByTestId(`board-a11y-object-${existingFrame}`);
   await frameOutline.focus();await frameOutline.press('Enter');
   await expect(frameOutline).toHaveAttribute('aria-pressed','true');
   await expect(page.getByTestId('board-a11y-selection-announcement')).toHaveText('已选择 1 个对象');
   await page.getByTestId('board-inspector-expand').click();
   const frameInspector=page.getByTestId('board-context-toolbar');
   await expect(page.getByTestId('board-frame-size-presets')).toBeVisible();
   const frameLayout=await page.evaluate(()=>{
    const bounds=(id:string)=>{const element=document.querySelector(`[data-testid="${id}"]`);if(!element)throw new Error(`Missing ${id}`);const rect=element.getBoundingClientRect();return{x:rect.x,y:rect.y,width:rect.width,height:rect.height};};
    return{frame:bounds('board-context-toolbar'),header:bounds('board-editor-header'),dock:bounds('board-creation-dock')};
   });
   await info.attach(`frame-live-layout-${label}`,{body:Buffer.from(JSON.stringify({cachedHeader:header,cachedDock:dock,live:frameLayout})),contentType:'application/json'});
   const frameBounds=frameLayout.frame;
   expect(frameBounds.x).toBeGreaterThanOrEqual(16);expect(frameBounds.x+frameBounds.width).toBeLessThanOrEqual(width-16);
   expect(frameBounds.y).toBeGreaterThanOrEqual(frameLayout.header.y+frameLayout.header.height);expect(frameBounds.y+frameBounds.height).toBeLessThanOrEqual(frameLayout.dock.y-2);
   for(const name of ['区域标题','区域布局'])await expect(page.getByLabel(name,{exact:true})).toBeVisible();
   await captureReference(page,info,`reference-existing-frame-inspector-${label}`);await page.getByTestId('board-inspector-close').click();

   await page.getByTestId('board-a11y-object-idea-1').focus();await page.getByTestId('board-a11y-object-idea-1').press('Enter');
   await expect(page.getByTestId('board-a11y-object-idea-1')).toHaveAttribute('aria-pressed','true');
   await expect(page.getByTestId('board-thinking-editor')).toBeVisible();
   await page.getByTestId('board-thinking-editor').press('Escape');await expect(page.getByTestId('board-thinking-editor')).toBeHidden();
   await expect(page.getByTestId('board-a11y-object-idea-1')).toHaveAttribute('aria-pressed','true');
   await expect(page.getByTestId('board-context-toolbar')).toBeVisible();
   const toolbar=(await page.getByTestId('board-context-toolbar').boundingBox())!;expect(toolbar.width).toBeLessThanOrEqual(432);
   const selectedBounds=await page.getByTestId('board-fabric-surface').evaluate((surface,id)=>{const scene=(JSON.parse(surface.getAttribute('data-object-scenes')??'[]') as Array<{id:string;left:number;top:number;width:number;height:number}>).find(item=>item.id===id);if(!scene)throw new Error(`scene ${id} missing`);const canvas=surface.querySelector<HTMLCanvasElement>('canvas[data-fabric="top"]');if(!canvas)throw new Error('top canvas missing');const canvasBounds=canvas.getBoundingClientRect(),zoom=Number(surface.getAttribute('data-viewport-zoom')),panX=Number(surface.getAttribute('data-viewport-pan-x')),panY=Number(surface.getAttribute('data-viewport-pan-y'));return{x:canvasBounds.x+panX+scene.left*zoom,y:canvasBounds.y+panY+scene.top*zoom,width:scene.width*zoom,height:scene.height*zoom};},'idea-1');
   expect(separated(toolbar,selectedBounds),'single-selection toolbar must not cover the selected object').toBe(true);expect(toolbar.x).toBeGreaterThanOrEqual(16);expect(toolbar.x+toolbar.width).toBeLessThanOrEqual(width-16);
   await captureReference(page,info,`reference-single-selection-${label}`);await page.keyboard.press('Escape');
  }
  await page.getByTestId('board-tool-select').click();await page.keyboard.press('ControlOrMeta+a');
  await page.setViewportSize({width:390,height:844});
  const mobileHeader=page.getByTestId('board-editor-header');
  for(const button of await mobileHeader.getByRole('button').all()){
   if(!await button.isVisible())continue;
   const bounds=await button.boundingBox();expect(bounds).not.toBeNull();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.x+bounds!.width).toBeLessThanOrEqual(390);
  }
  await page.getByRole('button',{name:'更多白板操作',exact:true}).click();
  await expect(page.getByRole('region',{name:'在线成员',exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath('reference-mobile-390.png')});
  await info.attach('reference-mobile-390',{path:info.outputPath('reference-mobile-390.png'),contentType:'image/png'});
  await page.keyboard.press('Escape');await page.setViewportSize({width:1536,height:1024});
  // Hidden creation entries do not remove selected-object connection handles.
  const before=await canonicalBoardSnapshot(request,token!,board.id);
  const beforeHead=await call('GET',`/v1/whiteboards/${board.id}/head`);
  expect(before.objects.filter(object=>object.kind==='sticky')).toHaveLength(30);
  expect(before.objects.filter(object=>object.kind==='sticky').sort((a,b)=>a.id.localeCompare(b.id))).toEqual([...seededSnapshot.objects].sort((a,b)=>a.id.localeCompare(b.id)));
  expect(before.objects.filter(object=>object.kind==='frame').map(object=>object.id).sort()).toEqual([...existingFrameIds].sort());
  expect(before.objects).toHaveLength(30+existingFrameIds.length);const updatesBefore=sentUpdates;
  const note=page.getByTestId('board-a11y-object-idea-1');await note.focus();await note.press('Enter');
  await expect(note).toHaveAttribute('aria-pressed','true');
  await expect(page.getByTestId('board-thinking-editor')).toBeVisible();
  await page.getByTestId('board-thinking-editor').press('Escape');await expect(page.getByTestId('board-thinking-editor')).toBeHidden();
  await expect(note).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-testid^="connector-handle-idea-1-"]')).toHaveCount(4);
  await captureReference(page,info,'reference-connection-handles-selected');
  // Escape can dismiss an inspector without clearing selection; use explicit native canvas intent.
  await page.getByTestId('board-tool-select').click();
  const view=await page.getByTestId('board-fabric-surface').evaluate(surface=>{
   const canvas=surface.querySelector<HTMLCanvasElement>('canvas[data-fabric="top"]');if(!canvas)throw new Error('TOP_CANVAS_MISSING');
   const box=canvas.getBoundingClientRect();return{x:box.x,y:box.y,width:box.width,height:box.height,zoom:Number(surface.getAttribute('data-viewport-zoom')),panX:Number(surface.getAttribute('data-viewport-pan-x')),panY:Number(surface.getAttribute('data-viewport-pan-y'))};
  });
  let blank:ReturnType<typeof compactBlankPoints>[number]|undefined;
  for(const candidate of compactBlankPoints(view,before.objects)){
   if(await page.evaluate(({x,y})=>document.elementFromPoint(x,y)?.matches('canvas[data-fabric="top"]')===true,candidate)){blank=candidate;break;}
  }
  expect(blank,'a canonical-geometry blank point must hit the native top canvas').toBeDefined();
  await page.mouse.click(blank!.x,blank!.y);await page.mouse.move(10,10);
  await expect(note).toHaveAttribute('aria-pressed','false');
  await expect(page.locator('[data-testid^="connector-handle-"]')).toHaveCount(0);
  await captureReference(page,info,'reference-connection-handles-deselected');
  const after=await canonicalBoardSnapshot(request,token!,board.id),afterHead=await call('GET',`/v1/whiteboards/${board.id}/head`);
  expect(after).toEqual(before);expect(afterHead).toEqual(beforeHead);expect(sentUpdates).toBe(updatesBefore);
  const receipt=info.outputPath('compact-native-deselection.json');
  await writeFile(receipt,JSON.stringify({before,after,beforeHead,afterHead,blank,updatesBefore,updatesAfter:sentUpdates,escapeDeselectionVerified:false}));
  await info.attach('compact-native-deselection',{path:receipt,contentType:'application/json'});
  // Preserve the explicit deselect command and connection capability as a separate journey.
  await note.focus();await note.press('Enter');
  await expect(note).toHaveAttribute('aria-pressed','true');
  await expect(page.getByTestId('board-thinking-editor')).toBeVisible();
  await page.getByTestId('board-thinking-editor').press('Escape');
  await expect(page.getByTestId('board-thinking-editor')).toBeHidden();
  await expect(note).toHaveAttribute('aria-pressed','true');
  await expect(page.locator('[data-testid^="connector-handle-idea-1-"]')).toHaveCount(4);
  await page.getByRole('button', {name: '取消选择', exact: true}).click();
  await expect(page.getByTestId('board-a11y-selection-announcement')).toHaveText('未选择对象');
  await expect(page.locator('[data-testid^="connector-handle-"]')).toHaveCount(0);
  await verifyEditorConnectorEntry(page,board.id,call,()=>captureReference(page,info,'reference-connector-after-dismissal'));
  expect(await connectByHandles(page, 'idea-0', 'idea-1',async evidence=>{const path=info.outputPath('connector-snap-geometry.json');await writeFile(path,JSON.stringify(evidence,null,2),{flag:'wx',mode:0o600});await info.attach('connector-snap-geometry',{path,contentType:'application/json'});})).toBe(1);
 }finally{const latest=await call('GET',`/whiteboards/${board.id}`);await call('PATCH',`/whiteboards/${board.id}`,{archived:true,expectedLifecycleRevision:latest.lifecycleRevision});}
});
