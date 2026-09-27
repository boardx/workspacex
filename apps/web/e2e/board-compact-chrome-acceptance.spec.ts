import {randomUUID} from 'node:crypto';
import {expect,test} from '@playwright/test';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {SESSION_TOKEN_STORAGE_KEY} from '../lib/api-client';

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
  for(const width of [1024,1280,1440]){
   await page.setViewportSize({width,height:900});await page.getByTestId('board-tool-select').click();await page.keyboard.press('ControlOrMeta+a');
   await expect(page.getByTestId('board-selection-layout-toolbar')).toBeVisible();await page.getByTestId('board-zoom-fit-board').click();await page.mouse.move(10,10);
   await expect(page.locator('[data-testid^="connector-handle-"]')).toHaveCount(0);
   const status=await page.getByTestId('board-sync-status').evaluate(el=>({height:el.getBoundingClientRect().height,whiteSpace:getComputedStyle(el).whiteSpace}));expect(status.whiteSpace).toBe('nowrap');expect(status.height).toBeLessThanOrEqual(32);
   const header=(await page.getByTestId('board-editor-header').boundingBox())!,navigation=(await page.getByTestId('board-navigation-controls').boundingBox())!,selection=(await page.getByTestId('board-selection-layout-toolbar').boundingBox())!;
   expect(header.height).toBeLessThanOrEqual(72);expect(header.width).toBeLessThanOrEqual(width);const dock=(await page.getByTestId('board-creation-dock').boundingBox())!;expect(selection.y+selection.height).toBeLessThan(dock.y);expect(navigation.y).toBeGreaterThanOrEqual(header.y+header.height);expect(navigation.y).toBeLessThan(160);expect(navigation.x).toBeGreaterThanOrEqual(0);expect(navigation.x+navigation.width).toBeLessThanOrEqual(width);
   await expect.poll(async()=>{const surface=page.getByTestId('board-fabric-surface'),view=await surface.evaluate(el=>({z:Number(el.getAttribute('data-viewport-zoom')),x:Number(el.getAttribute('data-viewport-pan-x')),y:Number(el.getAttribute('data-viewport-pan-y'))}));return 100*view.z+view.x>=31&&1300*view.z+view.x<=width-31&&100*view.z+view.y>=header.y+header.height+15&&896*view.z+view.y<=dock.y-11;}).toBe(true);
   await info.attach(`compact-chrome-${width}`,{body:await page.screenshot(),contentType:'image/png'});
   await page.getByRole('button',{name:'图形：想法 2',exact:true}).click();await page.keyboard.press('Escape');
   await expect(page.getByTestId('board-context-toolbar')).toBeVisible();
   await page.getByTestId('board-add-sticky').click();await expect(page.getByTestId('board-sticky-picker')).toBeVisible();
   const palette=(await page.getByTestId('board-sticky-picker').boundingBox())!,stickyTool=(await page.getByTestId('board-add-sticky').boundingBox())!;
   expect(palette.y+palette.height).toBeLessThan(stickyTool.y);expect(palette.x).toBeGreaterThanOrEqual(0);expect(palette.x+palette.width).toBeLessThanOrEqual(width);
   await info.attach(`reference-selection-palette-${width}`,{body:await page.screenshot(),contentType:'image/png'});
  }
  await page.getByTestId('board-tool-select').click();await page.keyboard.press('ControlOrMeta+a');
  // Explicit connection intent remains available without relying on hover.
  await page.getByTestId('board-add-connector').click();await expect(page.locator('[data-testid^="connector-handle-"]')).toHaveCount(120);
  await page.getByTestId('board-tool-select').click();await expect(page.locator('[data-testid^="connector-handle-"]')).toHaveCount(0);
 }finally{const latest=await call('GET',`/whiteboards/${board.id}`);await call('PATCH',`/whiteboards/${board.id}`,{archived:true,expectedLifecycleRevision:latest.lifecycleRevision});}
});
