import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Locator, type Page } from '@playwright/test';
import { SESSION_TOKEN_STORAGE_KEY } from '../lib/api-client';
import { FULLSTACK_E2E } from './fullstack-smoke-fixture';

test.describe.configure({mode:'serial',timeout:120_000});
const fallback:Record<string,string|undefined>={
  WHITEBOARD_OWNER_EMAIL:FULLSTACK_E2E.adminEmail,
  WHITEBOARD_OWNER_PASSWORD:FULLSTACK_E2E.adminPassword,
  WHITEBOARD_API_URL:process.env.WORKSPACEX_API_PORT?`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`:undefined,
};
const required=(name:string)=>{const value=process.env[name]??fallback[name];if(!value)throw new Error(`Missing real whiteboard E2E fixture: ${name}`);return value;};
async function login(page:Page){
  await page.goto('/login');await page.getByTestId('login-email').fill(required('WHITEBOARD_OWNER_EMAIL'));
  await page.getByTestId('login-password').fill(required('WHITEBOARD_OWNER_PASSWORD'));await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/projects$/,{timeout:30_000});const token=await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY);expect(token).toBeTruthy();return token!;
}
async function api(request:APIRequestContext,token:string,method:string,path:string,data?:unknown){
  const response=await request.fetch(`${required('WHITEBOARD_API_URL')}${path}`,{method,headers:{Authorization:`Bearer ${token}`},data});
  expect(response.ok(),`${method} ${path}: ${response.status()}`).toBe(true);return response;
}
async function assertInsideViewport(page:Page,locator:Locator){
  await locator.focus();const box=await locator.boundingBox();const viewport=page.viewportSize();expect(box).not.toBeNull();expect(viewport).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport!.width);
  expect(box!.y).toBeGreaterThanOrEqual(0);expect(box!.y+box!.height).toBeLessThanOrEqual(viewport!.height);
}

test('live Board reflows at 200% and 400% equivalent viewports and reduces motion',async({page,request})=>{
  const token=await login(page);let boardId:string|undefined;
  try{
    const created=await api(request,token,'POST','/whiteboards',{requestId:randomUUID(),name:`Reflow Board ${randomUUID()}`});boardId=(await created.json() as {id:string}).id;
    await page.emulateMedia({reducedMotion:'reduce'});
    for(const viewport of [{width:640,height:512},{width:320,height:256}]){
      await page.setViewportSize(viewport);await page.goto(`/studio/board/${boardId}`);
      await expect(page.getByTestId('collaborative-editor')).toBeVisible({timeout:30_000});await expect(page.getByText(/^已同步$/)).toBeVisible({timeout:30_000});
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      expect(await page.evaluate(()=>{const event=new WheelEvent('wheel',{ctrlKey:true,cancelable:true});window.dispatchEvent(event);return {prevented:event.defaultPrevented,touchAction:getComputedStyle(document.documentElement).touchAction};})).toEqual({prevented:false,touchAction:'auto'});
      await assertInsideViewport(page,page.getByTestId('board-import-trigger'));
      await assertInsideViewport(page,page.getByTestId('board-add-sticky'));
      await page.keyboard.press('Enter');await expect(page.getByTestId('board-object-inspector')).toBeVisible();
      await assertInsideViewport(page,page.getByLabel('对象文字',{exact:true}));
      await assertInsideViewport(page,page.getByRole('button',{name:'工作坊 展开'}));
      await page.keyboard.press('Enter');await expect(page.getByTestId('board-workshop-panel')).toBeVisible();
      await assertInsideViewport(page,page.getByTestId('board-discussion-toggle'));
      await page.keyboard.press('Enter');await expect(page.getByTestId('board-discussion-panel')).toBeVisible();
      await page.keyboard.press('Escape');await expect(page.getByTestId('board-discussion-toggle')).toBeFocused();
      await page.getByRole('button',{name:'放大',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByTestId('board-live-announcer')).toContainText('缩放 110%');
      const transitionMs=await page.getByTestId('board-import-trigger').evaluate(element=>{const value=getComputedStyle(element).transitionDuration;return value.endsWith('ms')?parseFloat(value):parseFloat(value)*1000;});
      expect(transitionMs).toBeLessThanOrEqual(.01);
    }
  }finally{if(boardId)await api(request,token,'PATCH',`/whiteboards/${boardId}`,{archived:true});}
});
