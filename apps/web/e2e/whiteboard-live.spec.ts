import { randomUUID } from 'node:crypto';
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
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

test('independent users collaborate, persist, enforce viewer permissions and clear revoked view',async({browser,request:api,baseURL})=>{
  const ownerContext=await browser.newContext({baseURL}),editorContext=await browser.newContext({baseURL}),viewerContext=await browser.newContext({baseURL});
  const owner=await ownerContext.newPage(),editor=await editorContext.newPage(),viewer=await viewerContext.newPage();
  let boardId:string|undefined,ownerToken:string|undefined;
  try{
    await test.step('authenticate the three independent users',async()=>{
      const [authenticatedOwnerToken]=await Promise.all([login(owner,'OWNER'),login(editor,'EDITOR'),login(viewer,'VIEWER')]);
      ownerToken=authenticatedOwnerToken;
    });
    await test.step('create the board and grant editor/viewer access',async()=>{
      const created=await request(api,ownerToken!,'POST','/whiteboards',{requestId:randomUUID(),name:`Live collaboration ${randomUUID()}`});
      boardId=(await created.json() as {id:string}).id;
      await Promise.all([
        request(api,ownerToken!,'PUT',`/whiteboards/${boardId}/members`,{userId:required('WHITEBOARD_EDITOR_USER_ID'),role:'editor'}),
        request(api,ownerToken!,'PUT',`/whiteboards/${boardId}/members`,{userId:required('WHITEBOARD_VIEWER_USER_ID'),role:'viewer'}),
      ]);
    });
    await test.step('connect all three clients',async()=>{
      await Promise.all([owner,editor,viewer].map(async page=>{await page.goto(`/studio/board/${boardId}`);await synced(page);}));
    });
    await test.step('keep the board fullscreen at supported viewport widths',async()=>{
      for(const width of [375,768,1280]){
        await owner.setViewportSize({width,height:900});
        await expect(owner.getByTestId('shell-rail')).toHaveCount(0);
        await expect(owner.getByTestId('shell-mobile-tabs')).toHaveCount(0);
        const box=await owner.getByTestId('shell-main').boundingBox();expect(box?.x).toBe(0);expect(box?.width).toBe(width);expect(box?.height).toBe(900);
      }
    });
    await test.step('synchronize owner creation and editor changes',async()=>{
      await owner.getByTestId('board-add-sticky').click();
      await owner.getByLabel('对象文字',{exact:true}).fill('团队中文协作便签');await synced(owner);
      const editorNote=editor.getByRole('button',{name:'图形：团队中文协作便签',exact:true});await expect(editorNote).toBeVisible({timeout:20_000});
      // The outline is visually hidden until keyboard focus enters it. A pointer click is
      // intercepted by Fabric's upper canvas, while focus + Enter exercises its intended
      // accessible interaction without bypassing actionability checks.
      await editorNote.focus();await editorNote.press('Enter');await editor.getByLabel('对象文字',{exact:true}).fill('另一位成员的中文修改');await synced(editor);
      await expect(owner.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true})).toBeVisible({timeout:20_000});
    });
    await test.step('persist the change and expose readonly selection',async()=>{
      await owner.reload();await synced(owner);await expect(owner.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true})).toBeVisible();
      const viewerNote=viewer.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true});
      await expect(viewerNote).toBeVisible({timeout:20_000});
      await expect(viewer.getByTestId('board-add-sticky')).toBeDisabled();
      await viewerNote.focus();await viewerNote.press('Enter');await expect(viewer.getByLabel('对象文字',{exact:true})).toBeDisabled();
    });
    await test.step('clear the editor view after access is revoked',async()=>{
      await request(api,ownerToken!,'DELETE',`/whiteboards/${boardId}/members/${encodeURIComponent(required('WHITEBOARD_EDITOR_USER_ID'))}`);
      await expect(editor.getByTestId('denied')).toBeVisible({timeout:30_000});
      await expect(editor.getByTestId('collaborative-editor')).toHaveCount(0);
      await expect(editor.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true})).toHaveCount(0);
    });
  }finally{
    try { if(boardId&&ownerToken)await request(api,ownerToken,'PATCH',`/whiteboards/${boardId}`,{archived:true}); }
    finally { await Promise.all([ownerContext.close(),editorContext.close(),viewerContext.close()]); }
  }
});
