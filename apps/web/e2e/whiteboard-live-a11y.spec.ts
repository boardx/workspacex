import { randomUUID } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SESSION_TOKEN_STORAGE_KEY } from '../lib/api-client';
import { FULLSTACK_E2E } from './fullstack-smoke-fixture';

test.describe.configure({ mode: 'serial', timeout: 120_000 });
const fallbacks: Record<string,string|undefined> = {
  WHITEBOARD_OWNER_EMAIL: FULLSTACK_E2E.adminEmail, WHITEBOARD_OWNER_PASSWORD: FULLSTACK_E2E.adminPassword,
  WHITEBOARD_VIEWER_EMAIL: FULLSTACK_E2E.email, WHITEBOARD_VIEWER_PASSWORD: FULLSTACK_E2E.password,
  WHITEBOARD_VIEWER_USER_ID: FULLSTACK_E2E.userId,
  WHITEBOARD_API_URL: process.env.WORKSPACEX_API_PORT ? `http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}` : undefined,
};
function required(name:string){const value=process.env[name]??fallbacks[name];if(!value)throw new Error(`Missing real whiteboard E2E fixture: ${name}`);return value;}
async function login(page:Page,actor:'OWNER'|'VIEWER'){
  await page.goto('/login');await page.getByTestId('login-email').fill(required(`WHITEBOARD_${actor}_EMAIL`));
  await page.getByTestId('login-password').fill(required(`WHITEBOARD_${actor}_PASSWORD`));await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/projects$/,{timeout:30_000});const token=await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY);expect(token).toBeTruthy();return token!;
}
async function api(request:APIRequestContext,token:string,method:string,path:string,data?:unknown){
  const response=await request.fetch(`${required('WHITEBOARD_API_URL')}${path}`,{method,headers:{Authorization:`Bearer ${token}`},data});
  expect(response.ok(),`${method} ${path}: ${response.status()}`).toBe(true);return response;
}
async function synced(page:Page){await expect(page.getByTestId('collaborative-editor')).toBeVisible({timeout:30_000});await expect(page.getByText(/^已同步(?: · 只读)?$/)).toBeVisible({timeout:30_000});}

test('live Board core editing is keyboard operable and restores focus',async({browser,request,baseURL})=>{
  const mod=process.platform==='darwin'?'Meta':'Control';
  const ownerContext=await browser.newContext({baseURL}),viewerContext=await browser.newContext({baseURL});
  const owner=await ownerContext.newPage(),viewer=await viewerContext.newPage();let boardId:string|undefined,token:string|undefined;
  try{
    token=await login(owner,'OWNER');await login(viewer,'VIEWER');
    const created=await api(request,token,'POST','/whiteboards',{requestId:randomUUID(),name:`Keyboard Board ${randomUUID()}`});boardId=(await created.json() as {id:string}).id;
    await api(request,token,'PUT',`/whiteboards/${boardId}/members`,{userId:required('WHITEBOARD_VIEWER_USER_ID'),role:'viewer'});
    await owner.goto(`/studio/board/${boardId}`);await synced(owner);await viewer.goto(`/studio/board/${boardId}`);await synced(viewer);

    // Core scenario: focus targets directly, then perform every product action with page.keyboard.
    await owner.getByTestId('board-add-sticky').focus();await owner.keyboard.press('Enter');
    const canvas=owner.getByTestId('board-live-surface');await expect(canvas).toBeFocused();
    await owner.keyboard.press(`${mod}+Shift+ArrowLeft`);await owner.keyboard.press('Enter');
    await expect(owner.getByLabel('对象文字',{exact:true})).toBeFocused();await owner.keyboard.press(`${mod}+A`);await owner.keyboard.insertText('键盘想法一');
    await owner.getByTestId('board-add-sticky').focus();await owner.keyboard.press('Enter');await owner.keyboard.press('Enter');
    await owner.keyboard.press(`${mod}+A`);await owner.keyboard.insertText('键盘想法二');
    await expect(owner.getByRole('button',{name:'图形：键盘想法一',exact:true})).toBeVisible();await expect(owner.getByRole('button',{name:'图形：键盘想法二',exact:true})).toBeVisible();
    await expect(viewer.getByRole('button',{name:'图形：键盘想法一',exact:true})).toBeVisible();await expect(viewer.getByRole('button',{name:'图形：键盘想法二',exact:true})).toBeVisible();await synced(owner);
    await owner.reload();await synced(owner);await expect(owner.getByRole('button',{name:'图形：键盘想法一',exact:true})).toBeVisible();await expect(owner.getByRole('button',{name:'图形：键盘想法二',exact:true})).toBeVisible();await canvas.focus();await expect(canvas).toBeFocused();
    const focusStyle=await canvas.evaluate(element=>getComputedStyle(element).boxShadow);expect(focusStyle).not.toBe('none');
    await owner.keyboard.press('Enter');await owner.keyboard.press('ArrowRight');await owner.keyboard.press('Shift+Space');
    await expect(owner.getByTestId('board-live-announcer')).toContainText('2 个已选对象');
    const first=owner.getByRole('button',{name:'图形：键盘想法一',exact:true});const before=await first.boundingBox();
    await owner.keyboard.press(`${mod}+Shift+ArrowDown`);await expect.poll(async()=>await first.boundingBox()).toMatchObject({y:(before?.y??0)+10});
    await owner.getByRole('button',{name:'连接',exact:true}).focus();await owner.keyboard.press('Enter');await expect(canvas).toBeFocused();await expect(owner.getByTestId('board-live-announcer')).toContainText('连接工具');
    await owner.keyboard.press('ArrowLeft');await expect(owner.getByTestId('board-live-announcer')).toContainText('键盘想法一');await owner.keyboard.press('Space');await expect(owner.getByTestId('board-live-announcer')).toContainText('连接起点');
    await owner.keyboard.press('ArrowRight');await expect(owner.getByTestId('board-live-announcer')).toContainText('键盘想法二');await owner.keyboard.press('Space');
    await expect(owner.getByRole('img',{name:'连接线：键盘想法一 到 键盘想法二'})).toBeVisible();
    await expect(viewer.getByRole('img',{name:'连接线：键盘想法一 到 键盘想法二'})).toBeVisible();
    await expect(owner.getByTestId('board-live-announcer')).toContainText('已建立连接');await expect(owner.getByTestId('board-live-announcer')).toContainText('键盘想法一');await expect(owner.getByTestId('board-live-announcer')).toContainText('键盘想法二');
    await owner.getByRole('button',{name:'放大',exact:true}).focus();await owner.keyboard.press('Enter');await expect(owner.getByTestId('board-live-announcer')).toContainText('缩放 110%');
    await canvas.focus();await owner.keyboard.press('Space');await owner.keyboard.press('Delete');await expect(owner.getByRole('button',{name:'图形：键盘想法二',exact:true})).toHaveCount(0);await expect(viewer.getByRole('button',{name:'图形：键盘想法二',exact:true})).toHaveCount(0);await expect(canvas).toBeFocused();
    await owner.keyboard.press(`${mod}+z`);await expect(owner.getByTestId('board-live-announcer')).toContainText('已撤销本地修改');await expect(owner.getByRole('button',{name:'图形：键盘想法二',exact:true})).toBeVisible();await expect(viewer.getByRole('button',{name:'图形：键盘想法二',exact:true})).toBeVisible();await expect(canvas).toBeFocused();

    await owner.getByTestId('board-discussion-toggle').focus();await owner.keyboard.press('Enter');await expect(owner.getByRole('heading',{name:'评论与任务'})).toBeFocused();
    const panelAxe=await new AxeBuilder({page:owner}).withTags(['cat.keyboard']).analyze();expect(panelAxe.violations,JSON.stringify(panelAxe.violations,null,2)).toEqual([]);
    await owner.keyboard.press('Escape');await expect(owner.getByTestId('board-discussion-toggle')).toBeFocused();
    const importTrigger=owner.getByTestId('board-import-trigger');await importTrigger.focus();await expect(importTrigger).toBeFocused();
    const importFocusStyle=await importTrigger.evaluate(element=>getComputedStyle(element).boxShadow);expect(importFocusStyle).not.toBe('none');
    const fileChooserPromise=owner.waitForEvent('filechooser');await owner.keyboard.press('Enter');const fileChooser=await fileChooserPromise;
    await fileChooser.setFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{}')});
    await expect(owner.getByRole('dialog')).toBeVisible();const dialogAxe=await new AxeBuilder({page:owner}).withTags(['cat.keyboard']).analyze();expect(dialogAxe.violations,JSON.stringify(dialogAxe.violations,null,2)).toEqual([]);
    await owner.keyboard.press('Escape');await expect(importTrigger).toBeFocused();await expect(owner.getByTestId('board-import-file')).not.toBeFocused();
    const axe=await new AxeBuilder({page:owner}).withTags(['cat.keyboard']).analyze();expect(axe.violations,JSON.stringify(axe.violations,null,2)).toEqual([]);

    const viewerCanvas=viewer.getByTestId('board-live-surface');await viewerCanvas.focus();await viewer.keyboard.press('Enter');
    const viewerBefore=await viewer.getByRole('button',{name:'图形：键盘想法一',exact:true}).boundingBox();await viewer.keyboard.press(`${mod}+ArrowRight`);expect(await viewer.getByRole('button',{name:'图形：键盘想法一',exact:true}).boundingBox()).toEqual(viewerBefore);await expect(viewer.getByTestId('board-live-announcer')).toContainText('只读');
    await api(request,token,'DELETE',`/whiteboards/${boardId}/members/${encodeURIComponent(required('WHITEBOARD_VIEWER_USER_ID'))}`);
    const denied=viewer.getByRole('alert');await expect(denied).toBeVisible({timeout:30_000});await expect(denied).toBeFocused();await expect(viewerCanvas).toHaveCount(0);
  }finally{
    try{if(boardId&&token)await api(request,token,'PATCH',`/whiteboards/${boardId}`,{archived:true});}finally{await Promise.all([ownerContext.close(),viewerContext.close()]);}
  }
});
