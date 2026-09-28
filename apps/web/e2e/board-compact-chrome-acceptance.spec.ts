import {randomUUID} from 'node:crypto';
import {expect,test,type Page,type TestInfo} from '@playwright/test';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {SESSION_TOKEN_STORAGE_KEY} from '../lib/api-client';

const referenceViewports=[{width:1024,height:900},{width:1536,height:1024},{width:1672,height:941}] as const;
const dockOrder=['board-tool-select','board-tool-hand','board-add-sticky','board-add-text','board-add-shape','board-add-connector','board-add-draw','board-add-image','board-add-frame','board-add-more'] as const;
async function captureReference(page:Page,info:TestInfo,name:string){const path=info.outputPath(`${name}.png`);await page.screenshot({path,fullPage:false});await info.attach(name,{path,contentType:'image/png'});}
const separated=(a:{x:number;y:number;width:number;height:number},b:{x:number;y:number;width:number;height:number})=>a.x+a.width<=b.x+1||b.x+b.width<=a.x+1||a.y+a.height<=b.y+1||b.y+b.height<=a.y+1;

test('real thirty-note Board keeps compact chrome and intentional connection handles',async({page,request},info)=>{
 const api=process.env.WHITEBOARD_API_URL??`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`;
 if(!process.env.WHITEBOARD_API_URL&&!process.env.WORKSPACEX_API_PORT)throw new Error('Real isolated API URL is required');
 await page.goto('/login');await page.getByTestId('login-email').fill(F.adminEmail);await page.getByTestId('login-password').fill(F.adminPassword);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/projects/);
 const token=await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY);expect(token).toBeTruthy();
 const call=async(method:string,path:string,data?:unknown)=>{const response=await request.fetch(`${api}${path}`,{method,data,headers:{Authorization:`Bearer ${token}`}});expect(response.ok(),`${method} ${path}: ${response.status()}`).toBe(true);return response.json();};
 const board=await call('POST','/whiteboards',{requestId:randomUUID(),name:'Thirty notes · compact controls'});
 try{
  await call('POST',`/v1/whiteboards/${board.id}/operations`,{apiVersion:'2026-09-01',requestId:randomUUID(),boardId:board.id,expectedRevision:{epoch:1,seq:0},actor:{kind:'human',actorId:F.adminUserId,orgId:F.orgId,role:'owner',scopes:['board:read','board:write'],delegatedBy:null},provenance:{source:'public-api',model:null,skill:null,sourceArtifactId:null,sourceRevision:null,layoutHash:null,inputObjectIds:[]},commands:Array.from({length:30},(_,i)=>({type:'create',object:{id:`idea-${i}`,schemaVersion:1,kind:'sticky',geometry:{x:100+(i%6)*204,y:100+Math.floor(i/6)*164,width:180,height:140,rotation:0},text:`想法 ${i+1}`,style:{fill:['#FFE99A','#C6DDFF','#FBC9DF'][i%3]},parentId:null,orderKey:String(i).padStart(2,'0')}}))});
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
   expect(navigation.x+navigation.width).toBeCloseTo(width-16,0);
   expect(dock.x).toBeGreaterThanOrEqual(16);expect(dock.x+dock.width).toBeLessThanOrEqual(width-16);
   if(width<1280)expect(navigation.y+navigation.height).toBeLessThanOrEqual(dock.y-2);else{expect(navigation.y+navigation.height).toBeCloseTo(height-20,0);expect(navigation.x).toBeGreaterThanOrEqual(dock.x+dock.width+16);}for(const id of ['board-overview-fit','board-zoom-menu','board-zoom-fit-board'])await expect(page.getByTestId(id)).toBeVisible();
   if(width===1024)await expect(page.getByTestId('board-editor-header').getByRole('button',{name:'开始演示',exact:true})).toHaveCount(0);
   const dockMetrics=await page.getByTestId('board-creation-dock').locator(':scope > div').last().evaluate(el=>({clientWidth:el.clientWidth,scrollWidth:el.scrollWidth}));expect(dockMetrics.scrollWidth).toBeLessThanOrEqual(dockMetrics.clientWidth);
   const toolBounds=await Promise.all(dockOrder.map(async id=>({id,box:(await page.getByTestId(id).boundingBox())!})));for(let index=1;index<toolBounds.length;index++)expect(toolBounds[index]!.box.x).toBeGreaterThan(toolBounds[index-1]!.box.x);
   await expect.poll(async()=>{const surface=page.getByTestId('board-fabric-surface'),view=await surface.evaluate(el=>({z:Number(el.getAttribute('data-viewport-zoom')),x:Number(el.getAttribute('data-viewport-pan-x')),y:Number(el.getAttribute('data-viewport-pan-y'))}));return 100*view.z+view.x>=31&&1300*view.z+view.x<=width-31&&100*view.z+view.y>=header.y+header.height+15&&896*view.z+view.y<=dock.y-11;}).toBe(true);
   await captureReference(page,info,`reference-shell-${label}`);
   if(width===1024)continue;

   await page.getByTestId('board-tool-select').click();await page.getByTestId('board-add-draw').click();
   const drawPanel=page.getByTestId('board-draw-tool-panel');await expect(drawPanel).toBeVisible();const drawBounds=(await drawPanel.boundingBox())!;
   expect(drawBounds.width).toBeGreaterThanOrEqual(740);expect(drawBounds.width).toBeLessThanOrEqual(762);expect(drawBounds.height).toBeGreaterThanOrEqual(230);expect(drawBounds.height).toBeLessThanOrEqual(280);expect(drawBounds.x).toBeGreaterThanOrEqual(16);expect(drawBounds.x+drawBounds.width).toBeLessThanOrEqual(width-16);expect(drawBounds.y+drawBounds.height).toBeLessThanOrEqual(dock.y-2);
   for(const id of ['board-draw-pen','board-draw-marker','board-draw-pencil','board-draw-highlighter','board-draw-eraser','board-draw-stroke-8','board-draw-opacity-55','board-draw-color-custom'])await expect(page.getByTestId(id)).toBeVisible();
   await captureReference(page,info,`reference-draw-panel-${label}`);await page.getByTestId('board-draw-select').click();await expect(drawPanel).toBeHidden();

   await page.getByTestId('board-add-frame').click();const framePanel=page.getByTestId('board-frame-tool-panel');await expect(framePanel).toBeVisible();const frameBounds=(await framePanel.boundingBox())!;
   expect(frameBounds.width).toBeGreaterThanOrEqual(360);expect(frameBounds.width).toBeLessThanOrEqual(386);expect(frameBounds.height).toBeGreaterThanOrEqual(340);expect(frameBounds.height).toBeLessThanOrEqual(410);expect(frameBounds.x).toBeGreaterThanOrEqual(16);expect(frameBounds.x+frameBounds.width).toBeLessThanOrEqual(width-16);expect(frameBounds.y+frameBounds.height).toBeLessThanOrEqual(dock.y-2);
   for(const id of ['board-frame-rectangle','board-frame-rounded','board-frame-circle','board-frame-layout','board-frame-blank','board-frame-section','board-frame-grid','board-frame-timeline','board-frame-size-s','board-frame-size-m','board-frame-size-l','board-frame-size-custom'])await expect(page.getByTestId(id)).toBeVisible();
   await captureReference(page,info,`reference-frame-panel-${label}`);await page.getByRole('button',{name:'Close frame tools'}).click();await expect(framePanel).toBeHidden();

   await page.getByTestId('board-a11y-object-idea-1').evaluate((element:HTMLElement)=>element.click());
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
  // Explicit connection intent remains available without relying on hover.
  await page.getByTestId('board-add-connector').click();await expect(page.locator('[data-testid^="connector-handle-"]')).toHaveCount(120);
  await page.getByTestId('board-tool-select').click();await expect(page.locator('[data-testid^="connector-handle-"]')).toHaveCount(0);
 }finally{const latest=await call('GET',`/whiteboards/${board.id}`);await call('PATCH',`/whiteboards/${board.id}`,{archived:true,expectedLifecycleRevision:latest.lifecycleRevision});}
});
