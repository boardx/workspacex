import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type Locator, type APIRequestContext } from '@playwright/test';
import { SESSION_TOKEN_STORAGE_KEY } from '../lib/api-client';
import { FULLSTACK_E2E } from './fullstack-smoke-fixture';

/** Real services only: no route interception, business mocks or injected test principals. */
test.describe.configure({ mode: 'serial', timeout: 120_000 });
const fullstackFallbacks: Record<string, string | undefined> = {
  WHITEBOARD_OWNER_EMAIL: FULLSTACK_E2E.adminEmail,
  WHITEBOARD_OWNER_PASSWORD: FULLSTACK_E2E.adminPassword,
  WHITEBOARD_OWNER_USER_ID: FULLSTACK_E2E.adminUserId,
  WHITEBOARD_EDITOR_EMAIL: FULLSTACK_E2E.leadEmail,
  WHITEBOARD_EDITOR_PASSWORD: FULLSTACK_E2E.leadPassword,
  WHITEBOARD_EDITOR_USER_ID: FULLSTACK_E2E.leadUserId,
  WHITEBOARD_VIEWER_EMAIL: FULLSTACK_E2E.email,
  WHITEBOARD_VIEWER_PASSWORD: FULLSTACK_E2E.password,
  WHITEBOARD_VIEWER_USER_ID: FULLSTACK_E2E.userId,
  WHITEBOARD_API_URL: process.env.WORKSPACEX_API_PORT
    ? `http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`
    : undefined,
};
function required(name: string): string { const value=process.env[name]??fullstackFallbacks[name]; if(!value)throw new Error(`Missing real whiteboard E2E fixture: ${name}; see e2e/whiteboard-live-fixture.md`);return value; }
async function login(page: Page, actor: 'OWNER'|'EDITOR'|'VIEWER') {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(required(`WHITEBOARD_${actor}_EMAIL`));
  await page.getByTestId('login-password').fill(required(`WHITEBOARD_${actor}_PASSWORD`));
  await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/projects$/, {timeout:30_000});
  const token=await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY);
  expect(token,'real login issued session token').toBeTruthy();return token!;
}
async function request(api: APIRequestContext, token: string, method: string, path: string, data?: unknown) {
  const response=await api.fetch(`${required('WHITEBOARD_API_URL').replace(/\/$/,'')}${path}`,{method,headers:{Authorization:`Bearer ${token}`},data});
  expect(response.ok(),`${method} ${path} returned ${response.status()}`).toBe(true);return response;
}
async function synced(page:Page){await expect(page.getByTestId('collaborative-editor')).toBeVisible({timeout:30_000});await expect(page.getByText(/^已同步(?: · 只读)?$/)).toBeVisible({timeout:30_000});}
async function dragBy(page: Page, object: Locator, dx: number, dy: number) {
  const box = await object.boundingBox();
  expect(box, 'Board object has a draggable box').toBeTruthy();
  const x = box!.x + box!.width / 2, y = box!.y + box!.height / 2;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 4 }); await page.mouse.up();
}
async function keyboardSelect(page: Page, object: Locator, additive = false) {
  await object.focus();
  if (additive) await page.keyboard.down('Shift');
  await page.keyboard.press('Enter');
  if (additive) await page.keyboard.up('Shift');
}
async function objectTop(object: Locator) { return object.evaluate(node => Number.parseFloat((node as HTMLElement).style.top)); }

test('independent users collaborate, persist, enforce viewer permissions and clear revoked view',async({browser,request:api,baseURL})=>{
  const ownerContext=await browser.newContext({baseURL}),editorContext=await browser.newContext({baseURL}),viewerContext=await browser.newContext({baseURL});
  const owner=await ownerContext.newPage(),editor=await editorContext.newPage(),viewer=await viewerContext.newPage();
  let boardId:string|undefined,ownerToken:string|undefined;
  try{
    ownerToken=await login(owner,'OWNER');await login(editor,'EDITOR');await login(viewer,'VIEWER');
    const created=await request(api,ownerToken,'POST','/whiteboards',{requestId:randomUUID(),name:`Live collaboration ${randomUUID()}`});
    boardId=(await created.json() as {id:string}).id;
    await request(api,ownerToken,'PUT',`/whiteboards/${boardId}/members`,{userId:required('WHITEBOARD_EDITOR_USER_ID'),role:'editor'});
    await request(api,ownerToken,'PUT',`/whiteboards/${boardId}/members`,{userId:required('WHITEBOARD_VIEWER_USER_ID'),role:'viewer'});
    for(const page of [owner,editor,viewer]){await page.goto(`/studio/board/${boardId}`);await synced(page);}
    for(const width of [375,768,1280]){
      await owner.setViewportSize({width,height:900});
      await expect(owner.getByTestId('shell-rail')).toHaveCount(0);
      await expect(owner.getByTestId('shell-mobile-tabs')).toHaveCount(0);
      const box=await owner.getByTestId('shell-main').boundingBox();expect(box?.x).toBe(0);expect(box?.width).toBe(width);expect(box?.height).toBe(900);
    }
    await owner.getByTestId('board-add-sticky').click();
    await owner.getByLabel('对象文字',{exact:true}).fill('团队中文协作便签');await synced(owner);
    const first=owner.getByRole('button',{name:'图形：团队中文协作便签',exact:true});await dragBy(owner,first,40,30);
    await owner.getByTestId('board-add-sticky').click();await owner.getByLabel('对象文字',{exact:true}).fill('批量排列二');await dragBy(owner,owner.getByRole('button',{name:'图形：批量排列二',exact:true}),180,120);
    await owner.getByTestId('board-add-sticky').click();await owner.getByLabel('对象文字',{exact:true}).fill('批量排列三');await dragBy(owner,owner.getByRole('button',{name:'图形：批量排列三',exact:true}),340,210);await synced(owner);
    const second=owner.getByRole('button',{name:'图形：批量排列二',exact:true}),third=owner.getByRole('button',{name:'图形：批量排列三',exact:true});
    const before=await Promise.all([objectTop(first),objectTop(second),objectTop(third)]);
    await keyboardSelect(owner,first);await keyboardSelect(owner,second,true);await keyboardSelect(owner,third,true);
    await test.info().attach('board-bulk-before',{body:await owner.screenshot(),contentType:'image/png'});
    await owner.getByTestId('board-align-top').focus();await owner.keyboard.press('Enter');
    await expect(owner.getByText(/一次撤销可恢复整批/)).toBeVisible();
    await expect.poll(async()=>Promise.all([objectTop(first),objectTop(second),objectTop(third)])).toEqual([Math.min(...before),Math.min(...before),Math.min(...before)]);
    await test.info().attach('board-bulk-after',{body:await owner.screenshot(),contentType:'image/png'});
    await owner.getByText('撤销',{exact:true}).focus();await owner.keyboard.press('Enter');
    await expect.poll(async()=>Promise.all([objectTop(first),objectTop(second),objectTop(third)])).toEqual(before);
    const editorNote=editor.getByRole('button',{name:'图形：团队中文协作便签',exact:true});await expect(editorNote).toBeVisible({timeout:20_000});
    await editorNote.click();await editor.getByLabel('对象文字',{exact:true}).fill('另一位成员的中文修改');await synced(editor);
    await expect(owner.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true})).toBeVisible({timeout:20_000});
    await owner.reload();await synced(owner);await expect(owner.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true})).toBeVisible();
    await expect(viewer.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true})).toBeVisible({timeout:20_000});
    await expect(viewer.getByTestId('board-add-sticky')).toBeDisabled();
    await viewer.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true}).click();await expect(viewer.getByLabel('对象文字',{exact:true})).toBeDisabled();
    await request(api,ownerToken,'DELETE',`/whiteboards/${boardId}/members/${encodeURIComponent(required('WHITEBOARD_EDITOR_USER_ID'))}`);
    await expect(editor.getByTestId('denied')).toBeVisible({timeout:30_000});
    await expect(editor.getByTestId('collaborative-editor')).toHaveCount(0);
    await expect(editor.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true})).toHaveCount(0);
  }finally{
    try { if(boardId&&ownerToken)await request(api,ownerToken,'PATCH',`/whiteboards/${boardId}`,{archived:true}); }
    finally { await Promise.all([ownerContext.close(),editorContext.close(),viewerContext.close()]); }
  }
});
