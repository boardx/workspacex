import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { SESSION_TOKEN_STORAGE_KEY } from '../lib/api-client';
import { FULLSTACK_E2E } from './fullstack-smoke-fixture';

test.describe.configure({mode:'serial',timeout:120_000});
const fallback:Record<string,string|undefined>={WHITEBOARD_OWNER_EMAIL:FULLSTACK_E2E.adminEmail,WHITEBOARD_OWNER_PASSWORD:FULLSTACK_E2E.adminPassword,WHITEBOARD_API_URL:process.env.WORKSPACEX_API_PORT?`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`:undefined};
const required=(name:string)=>{const value=process.env[name]??fallback[name];if(!value)throw new Error(`Missing real whiteboard E2E fixture: ${name}`);return value;};
async function login(page:Page){await page.goto('/login');await page.getByTestId('login-email').fill(required('WHITEBOARD_OWNER_EMAIL'));await page.getByTestId('login-password').fill(required('WHITEBOARD_OWNER_PASSWORD'));await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/projects$/,{timeout:30_000});const token=await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY);expect(token).toBeTruthy();return token!;}
async function api(request:APIRequestContext,token:string,method:string,path:string,data?:unknown){const response=await request.fetch(`${required('WHITEBOARD_API_URL')}${path}`,{method,headers:{Authorization:`Bearer ${token}`},data});expect(response.ok(),`${method} ${path}: ${response.status()}`).toBe(true);return response;}
async function assertReachable(page:Page,locator:Locator){
  await locator.scrollIntoViewIfNeeded();await expect(locator).toBeVisible();
  const result=await locator.evaluate(element=>{const box=element.getBoundingClientRect(),viewport={width:document.documentElement.clientWidth,height:document.documentElement.clientHeight};const x=Math.min(viewport.width-1,Math.max(0,box.left+box.width/2)),y=Math.min(viewport.height-1,Math.max(0,box.top+box.height/2));const hit=document.elementFromPoint(x,y);return {box:{left:box.left,right:box.right,top:box.top,bottom:box.bottom},viewport,hit:Boolean(hit&&(element===hit||element.contains(hit)||hit.contains(element)))};});
  expect(result.box.left).toBeGreaterThanOrEqual(0);expect(result.box.right).toBeLessThanOrEqual(result.viewport.width);expect(result.box.top).toBeGreaterThanOrEqual(0);expect(result.box.bottom).toBeLessThanOrEqual(result.viewport.height);expect(result.hit).toBe(true);
  if(!await locator.isDisabled()){await locator.focus();await expect(locator).toBeFocused();}
}
async function assertInteractiveChildren(page:Page,panel:Locator){const controls=panel.locator('button:visible,input:visible,textarea:visible,summary:visible');for(let index=0;index<await controls.count();index+=1)await assertReachable(page,controls.nth(index));}
async function openInvalidImport(page:Page){
  const trigger=page.getByTestId('board-import-trigger');await assertReachable(page,trigger);const chooser=page.waitForEvent('filechooser');await page.keyboard.press('Enter');await (await chooser).setFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});
  const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();await expect(page.getByRole('alert')).toBeVisible();await assertReachable(page,dialog.getByRole('button',{name:'关闭'}));
  const durations=await dialog.evaluate(element=>[element,...element.querySelectorAll('*')].flatMap(item=>getComputedStyle(item).transitionDuration.split(',')).map(value=>value.endsWith('ms')?parseFloat(value):parseFloat(value)*1000));expect(Math.max(...durations)).toBeLessThanOrEqual(.01);
  await page.keyboard.press('Escape');await expect(trigger).toBeFocused();
}

test('live Board reflows at 100%, 200% and 400% equivalents with platform zoom, panels and reduced motion',async({page,request,context})=>{
  const token=await login(page);let boardId:string|undefined;
  try{
    const created=await api(request,token,'POST','/whiteboards',{requestId:randomUUID(),name:`Reflow Board ${randomUUID()}`});boardId=(await created.json() as {id:string}).id;await page.emulateMedia({reducedMotion:'reduce'});
    for(const viewport of [{width:1280,height:1024,label:'100%'},{width:640,height:512,label:'200%'},{width:320,height:256,label:'400%'}]){
      await page.setViewportSize(viewport);await page.goto(`/studio/board/${boardId}`);await expect(page.getByTestId('collaborative-editor')).toBeVisible({timeout:30_000});await expect(page.getByText(/^已同步$/)).toBeVisible({timeout:30_000});
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),{message:`${viewport.label} has no page horizontal overflow`}).toBe(true);
      expect(await page.getByTestId('board-live-surface').evaluate(element=>getComputedStyle(element).touchAction)).toBe('auto');expect(await page.evaluate(()=>({root:getComputedStyle(document.documentElement).touchAction,marker:document.documentElement.dataset.liveBoardMounted}))).toEqual({root:'auto',marker:'true'});
      expect(await page.evaluate(()=>{const event=new WheelEvent('wheel',{ctrlKey:true,cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(false);
      await assertReachable(page,page.getByTestId('board-import-trigger'));await assertReachable(page,page.getByTestId('board-add-sticky'));
      if(viewport.label==='100%'){
        await page.getByTestId('board-add-sticky').focus();await page.keyboard.press('Enter');await page.keyboard.press('Enter');const editor=page.getByLabel('对象文字',{exact:true});await expect(editor).toBeFocused();await editor.fill('可重排便利贴');await page.keyboard.press('Escape');
        await page.getByRole('button',{name:'平移',exact:true}).focus();await page.keyboard.press('Enter');const canvas=page.getByTestId('board-live-surface'),box=await canvas.boundingBox(),layer=canvas.locator(':scope > div').first(),before=await layer.getAttribute('style');await page.mouse.move(box!.x+50,box!.y+50);await page.mouse.down();await page.mouse.move(box!.x+80,box!.y+70);await page.mouse.up();expect(await layer.getAttribute('style')).not.toBe(before);
        await context.setOffline(true);await expect(page.getByText(/连接中断/)).toBeVisible({timeout:30_000});await context.setOffline(false);await expect(page.getByText(/^已同步$/)).toBeVisible({timeout:30_000});
      }else{const canvas=page.getByTestId('board-live-surface');await canvas.focus();await page.keyboard.press('Space');await page.keyboard.press('ArrowRight');await expect(canvas).toBeFocused();}
      await openInvalidImport(page);
      const inspector=page.getByTestId('board-object-inspector');if(await inspector.count())await assertInteractiveChildren(page,inspector);
      const workshopToggle=page.getByRole('button',{name:'工作坊 展开'});await assertReachable(page,workshopToggle);await page.keyboard.press('Enter');const workshop=page.getByTestId('board-workshop-panel');await expect(workshop).toBeVisible();await expect(inspector).toHaveCount(0);await expect(workshop.getByLabel('评论内容')).toBeVisible({timeout:30_000});await assertInteractiveChildren(page,workshop);
      const closeWorkshop=page.getByRole('button',{name:'工作坊 收起'});await closeWorkshop.focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'工作坊 展开'})).toBeVisible();
      const discussionToggle=page.getByTestId('board-discussion-toggle');await assertReachable(page,discussionToggle);await page.keyboard.press('Enter');const discussion=page.getByTestId('board-discussion-panel');await expect(discussion).toBeVisible();await expect(inspector).toHaveCount(0);await assertInteractiveChildren(page,discussion);await page.keyboard.press('Escape');await expect(discussionToggle).toBeFocused();
      await page.getByRole('button',{name:'放大',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByTestId('board-live-announcer')).toContainText('缩放 110%');const viewportLayer=page.getByTestId('board-live-surface').locator(':scope > div').first();expect(await viewportLayer.evaluate(element=>getComputedStyle(element).transitionDuration)).toMatch(/^(0s|0\.001ms)$/);
    }
    await page.goto('/projects');await expect.poll(()=>page.evaluate(()=>document.documentElement.dataset.liveBoardMounted??null)).toBeNull();expect(await page.evaluate(()=>{const event=new WheelEvent('wheel',{ctrlKey:true,cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(true);
  }finally{await context.setOffline(false);if(boardId)await api(request,token,'PATCH',`/whiteboards/${boardId}`,{archived:true});}
});
