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

test('meeting-room display pairs once, stays read-only, follows the presenter and clears revoked content',async({browser,request:api,baseURL})=>{
  const ownerContext=await browser.newContext({baseURL}),roomContext=await browser.newContext({baseURL});
  const owner=await ownerContext.newPage(),room=await roomContext.newPage();
  let boardId:string|undefined,ownerToken:string|undefined;
  try{
    ownerToken=await login(owner,'OWNER');
    const created=await request(api,ownerToken,'POST','/whiteboards',{requestId:randomUUID(),name:`Room display ${randomUUID()}`});
    boardId=(await created.json() as {id:string}).id;
    await owner.goto(`/studio/board/${boardId}`);await synced(owner);
    await owner.getByTestId('board-add-sticky').click();
    await owner.getByLabel('对象文字',{exact:true}).fill('会议室只读便签');await synced(owner);

    await owner.getByTestId('room-present-open').click();
    const pairingPayload=owner.getByTestId('room-pairing-payload');
    await expect(pairingPayload).toBeVisible({timeout:20_000});
    const payload=await pairingPayload.inputValue();
    expect(JSON.parse(payload)).toEqual(expect.objectContaining({orgId:expect.any(String),pairingId:expect.any(String),code:expect.any(String)}));

    await room.setViewportSize({width:1280,height:900});
    await room.goto('/studio/board/room');
    await expect(room.getByTestId('shell-rail')).toHaveCount(0);
    await expect(room.getByTestId('shell-mobile-tabs')).toHaveCount(0);
    const shell=await room.getByTestId('shell-main').boundingBox();
    expect(shell?.x).toBe(0);expect(shell?.width).toBe(1280);expect(shell?.height).toBe(900);
    await room.getByTestId('room-join-payload').fill(payload);
    await room.getByTestId('room-join').click();
    await expect(room.getByText(/会议室只读 · \d+ 次更新/)).toBeVisible({timeout:20_000});
    await expect(room.getByRole('button',{name:'图形：会议室只读便签',exact:true})).toBeVisible();
    await expect(room.getByTestId('board-add-sticky')).toBeDisabled();
    await expect(room.getByLabel('白板名称')).toBeDisabled();
    await expect(owner.getByTestId('room-connected')).toBeVisible({timeout:10_000});
    await owner.getByRole('button',{name:'关闭',exact:true}).click();

    const roomCanvas=room.getByTestId('board-live-surface').locator(':scope > div').first();
    await owner.getByRole('button',{name:'放大',exact:true}).click();
    await expect(roomCanvas).toHaveAttribute('style',/scale\(1\.1\)/,{timeout:10_000});
    await room.keyboard.press('Escape');
    await expect(room.getByText('已退出跟随')).toBeVisible();
    const transformAfterEscape=await roomCanvas.getAttribute('style');
    await owner.getByRole('button',{name:'放大',exact:true}).click();
    await room.waitForTimeout(2_500);
    expect(await roomCanvas.getAttribute('style')).toBe(transformAfterEscape);
    await room.getByTestId('room-follow-toggle').click();
    await expect(roomCanvas).toHaveAttribute('style',/scale\(1\.2\)/,{timeout:5_000});

    await room.reload();
    await expect(room.getByText(/会议室只读 · \d+ 次更新/)).toBeVisible({timeout:5_000});
    await expect(room.getByTestId('room-join-payload')).toHaveCount(0);
    await owner.reload();await synced(owner);
    await owner.getByTestId('room-present-open').click();
    await expect(owner.getByTestId('room-connected')).toBeVisible();
    await owner.getByRole('button',{name:'关闭',exact:true}).click();

    const safeTransform=await roomCanvas.getAttribute('style');
    await roomContext.setOffline(true);
    await owner.getByRole('button',{name:'放大',exact:true}).click();
    await expect(room.getByText('连接暂时中断，正在恢复…').first()).toBeVisible({timeout:5_000});
    expect(await roomCanvas.getAttribute('style')).toBe(safeTransform);
    await room.waitForTimeout(10_000);
    expect(await roomCanvas.getAttribute('style')).toBe(safeTransform);
    await roomContext.setOffline(false);
    await expect(roomCanvas).toHaveAttribute('style',/scale\(1\.3\)/,{timeout:5_000});

    await owner.getByTestId('room-present-open').click();
    await owner.getByRole('button',{name:'断开会议室',exact:true}).click();
    await expect(room.getByRole('alert').filter({hasText:'会议室连接已过期或被主持人断开'})).toBeVisible({timeout:10_000});
    await expect(room.getByTestId('collaborative-editor')).toHaveCount(0);
    await expect(room.getByRole('button',{name:'图形：会议室只读便签',exact:true})).toHaveCount(0);
    expect(await room.evaluate(()=>sessionStorage.getItem('wsx.board.room.active'))).toBeNull();
    await room.reload();await expect(room.getByTestId('room-join-payload')).toBeVisible();
  }finally{
    try { if(boardId&&ownerToken)await request(api,ownerToken,'PATCH',`/whiteboards/${boardId}`,{archived:true}); }
    finally { await Promise.all([ownerContext.close(),roomContext.close()]); }
  }
});
