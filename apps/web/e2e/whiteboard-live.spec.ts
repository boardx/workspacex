import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { SESSION_TOKEN_STORAGE_KEY } from '../lib/api-client';
import { FULLSTACK_E2E } from './fullstack-smoke-fixture';

/** Real services only: no route interception, business mocks or injected test principals. */
test.describe.configure({ mode: 'default', timeout: 120_000 });
test.use({ actionTimeout: 15_000 });
// Diagnostic evidence deliberately excludes payloads, URLs and authentication headers.
const transportEvidence: Array<Record<string, unknown>> = [];
test.beforeEach(() => { transportEvidence.length = 0; });
test.afterEach(async ({}, info) => {
  await info.attach('transport-status', { body: JSON.stringify(transportEvidence), contentType: 'application/json' });
});
function observeTransport(page: Page, actor: string) {
  page.on('websocket', socket => {
    socket.on('framereceived', event => {
      try {
        const message = JSON.parse(String(event.payload)) as Record<string, unknown>;
        if (!['sync', 'error', 'recovery', 'ack'].includes(String(message.type))) return;
        const entry: Record<string, unknown> = { actor, at: Date.now(), type: message.type };
        for (const key of ['code', 'recoverable', 'disposition', 'epoch', 'seq', 'role']) {
          const value = message[key];
          if (typeof value === 'number' || typeof value === 'boolean' || (typeof value === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(value))) entry[key] = value;
        }
        if (transportEvidence.length < 500) transportEvidence.push(entry);
      } catch { /* Non-protocol frames are not persisted. */ }
    });
  });
}
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
  observeTransport(page, actor);
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
async function archiveBoard(api: APIRequestContext, token: string, boardId: string) {
  const current = await (await request(api, token, 'GET', `/whiteboards/${boardId}`)).json() as {archived: boolean; lifecycleRevision: number};
  if (!current.archived) await request(api, token, 'PATCH', `/whiteboards/${boardId}`, {archived: true, expectedLifecycleRevision: current.lifecycleRevision});
}
async function synced(page:Page){await expect(page.getByTestId('collaborative-editor')).toBeVisible({timeout:30_000});await expect(page.getByText(/^已同步(?: · 序列 \d+)?(?: · 只读)?$/)).toBeVisible({timeout:30_000});}

test('realtime presence field convergence',async({browser,request:api,baseURL})=>{
  const ownerContext=await browser.newContext({baseURL}),editorContext=await browser.newContext({baseURL}),viewerContext=await browser.newContext({baseURL});
  const owner=await ownerContext.newPage(),editor=await editorContext.newPage(),viewer=await viewerContext.newPage();
  let boardId:string|undefined,ownerToken:string|undefined,editorToken:string|undefined,viewerToken:string|undefined;
  try{
    await test.step('authenticate the three independent users',async()=>{
      const [authenticatedOwnerToken,authenticatedEditorToken,authenticatedViewerToken]=await Promise.all([login(owner,'OWNER'),login(editor,'EDITOR'),login(viewer,'VIEWER')]);
      ownerToken=authenticatedOwnerToken;editorToken=authenticatedEditorToken;viewerToken=authenticatedViewerToken;
    });
    await test.step('create the board and grant editor/viewer access',async()=>{
      const created=await request(api,ownerToken!,'POST','/whiteboards',{requestId:randomUUID(),name:`Live collaboration ${randomUUID()}`});
      const board=await created.json() as {id:string;lifecycleRevision:number};
      boardId=board.id;
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
    await test.step('merge concurrent geometry and text fields from the same synced base in both browser contexts',async()=>{
      await owner.getByTestId('board-add-sticky').click();
      await owner.getByLabel('对象文字',{exact:true}).fill('团队中文协作便签');await synced(owner);
      const editorNote=editor.getByRole('button',{name:'图形：团队中文协作便签',exact:true});await expect(editorNote).toBeVisible({timeout:20_000});
      const objectId=(await editorNote.getAttribute('data-testid'))?.replace('board-a11y-object-','');expect(objectId).toBeTruthy();
      const commandFromBrowser=async(page:Page,token:string,commands:unknown[])=>page.evaluate(async({apiUrl,tokenValue,currentBoardId,requestId,commandsValue})=>{
        const response=await fetch(`${apiUrl.replace(/\/$/,'')}/whiteboards/${currentBoardId}/commands`,{method:'POST',headers:{Authorization:`Bearer ${tokenValue}`,'Content-Type':'application/json'},body:JSON.stringify({requestId,epoch:1,commands:commandsValue})});
        return{ok:response.ok,status:response.status,body:await response.text()};
      },{apiUrl:process.env.WHITEBOARD_BROWSER_API_URL ?? '/__fullstack_api',tokenValue:token,currentBoardId:boardId!,requestId:randomUUID(),commandsValue:commands});
      const [geometryResult,textResult]=await Promise.all([
        commandFromBrowser(owner,ownerToken!,[{type:'geometry',id:objectId,geometry:{x:640,y:360,width:180,height:140,rotation:9}}]),
        commandFromBrowser(editor,editorToken!,[{type:'text',id:objectId,index:0,deleteCount:'团队中文协作便签'.length,insert:'另一位成员的中文修改'}]),
      ]);
      expect(geometryResult,{message:geometryResult.body}).toMatchObject({ok:true});expect(textResult,{message:textResult.body}).toMatchObject({ok:true});

      // Observe live propagation first: reloading alone could hide broken WebSocket delivery.
      for (const page of [owner, editor, viewer]) {
        const live = page.getByTestId(`board-a11y-object-${objectId}`);
        await expect(live).toHaveAccessibleName('图形：另一位成员的中文修改', {timeout: 20_000});
        await expect(page.locator(`[data-object-id="${objectId}"]`)).toHaveAttribute('data-world-x', '640');
        await expect(page.locator(`[data-object-id="${objectId}"]`)).toHaveAttribute('data-world-y', '360');
        await expect(page.locator(`[data-object-id="${objectId}"]`)).toHaveAttribute('data-world-rotation', '9');
      }
      // Both independent contexts reload from the authoritative log, then a second reload
      // proves the merged fields survive checkpoint/update reconstruction.
      await Promise.all([owner.reload(),editor.reload()]);await Promise.all([synced(owner),synced(editor)]);
      for(const page of [owner,editor]){
        await expect(page.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true})).toBeVisible({timeout:20_000});
        const item=page.locator(`[data-object-id="${objectId}"]`);await expect(item).toHaveAttribute('data-world-x','640');await expect(item).toHaveAttribute('data-world-y','360');await expect(item).toHaveAttribute('data-world-rotation','9');
      }
      await owner.reload();await synced(owner);await expect(owner.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true})).toBeVisible();await expect(owner.locator(`[data-object-id="${objectId}"]`)).toHaveAttribute('data-world-x','640');

      // Enter through the accessibility mirror so the following presence assertion observes
      // the editor's selection and editing state on the converged object.
      const convergedEditorNote=editor.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true});await convergedEditorNote.focus();await convergedEditorNote.press('Enter');
    });
    await test.step('show identity-aware presence and synchronize object comments',async()=>{
      const surface=editor.getByTestId('board-live-surface'),bounds=await surface.boundingBox();expect(bounds).not.toBeNull();
      await editor.mouse.move(bounds!.x+420,bounds!.y+320);
      const editorCursor=owner.getByTestId(`peer-cursor-${required('WHITEBOARD_EDITOR_USER_ID')}`);await expect(editorCursor).toBeVisible({timeout:20_000});await expect(editorCursor).toHaveAccessibleName(/的光标$/);
      await expect(owner.locator('[data-testid^="peer-selection-"]')).toHaveAccessibleName(/正在编辑另一位成员的中文修改/);
      await owner.getByTestId('board-present-viewport').click();const presenter=editor.getByTitle(/正在演示/);await expect(presenter).toBeVisible({timeout:20_000});await presenter.click();await owner.getByTestId('board-zoom-in').click();await expect(editor.getByTestId('board-zoom-value')).toHaveText('110%',{timeout:20_000});
      await editor.getByRole('button',{name:'评论',exact:true}).click();
      await editor.getByLabel('评论内容').fill('请一起核对这个结论');
      await editor.getByLabel('提及成员').fill(required('WHITEBOARD_OWNER_USER_ID'));
      await editor.getByRole('button',{name:'发布评论'}).click();
      const indicator=owner.locator('[data-testid^="board-comment-indicator-"]');await expect(indicator).toHaveCount(1,{timeout:20_000});await indicator.click();
      await expect(owner.getByText('请一起核对这个结论')).toBeVisible();
      await owner.getByLabel('评论内容').fill('已核对，可以关闭');await owner.getByRole('button',{name:'回复'}).click();
      await expect(editor.getByText('已核对，可以关闭')).toBeVisible({timeout:20_000});
      await owner.getByRole('button',{name:'标记解决'}).click();await expect(editor.getByText('已解决')).toBeVisible({timeout:20_000});
    });
    await test.step('persist the change and expose readonly selection',async()=>{
      await owner.reload();await synced(owner);await expect(owner.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true})).toBeVisible();
      const viewerNote=viewer.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true});
      await expect(viewerNote).toBeVisible({timeout:20_000});
      await expect(viewer.getByTestId('board-add-sticky')).toBeDisabled();
      await viewerNote.focus();await viewerNote.press('Enter');await expect(viewer.getByLabel('对象文字',{exact:true})).toBeDisabled();
      await viewer.getByRole('button',{name:'评论',exact:true}).click();await viewer.getByLabel('评论内容').fill('viewer cannot publish');await expect(viewer.getByRole('button',{name:'发布评论'})).toBeDisabled();
    });
    await test.step('grant independent commenter access and persist a world-position anchored thread',async()=>{
      await request(api,ownerToken!,'PUT',`/whiteboards/${boardId}/members`,{userId:required('WHITEBOARD_VIEWER_USER_ID'),role:'commenter'});
      await expect(viewer.getByTestId('denied')).toBeVisible({timeout:30_000});await viewer.reload();await synced(viewer);
      const note=viewer.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true});await note.focus();await note.press('Enter');
      await expect(viewer.getByLabel('对象文字',{exact:true})).toBeDisabled();await viewer.getByRole('button',{name:'评论',exact:true}).click();await viewer.getByLabel('评论内容').fill('commenter can discuss without editing');await expect(viewer.getByRole('button',{name:'发布评论'})).toBeEnabled();await viewer.getByRole('button',{name:'发布评论'}).click();await expect(viewer.getByLabel('评论内容')).toHaveValue('');await expect(viewer.getByText('评论已由服务器持久化并确认。')).toBeVisible();
      const worldBody={type:'create-comment',requestId:randomUUID(),threadId:randomUUID(),commentId:randomUUID(),objectId:null,worldPosition:{x:640,y:360},body:'world anchored discussion',mentions:[],expectedRevision:0};
      await request(api,viewerToken!,'POST',`/whiteboards/${boardId}/comments/commands`,worldBody);
      const comments=await request(api,viewerToken!,'GET',`/whiteboards/${boardId}/comments`);expect((await comments.json() as {items:Array<{objectId:string|null;worldPosition:{x:number;y:number}|null}>}).items).toContainEqual(expect.objectContaining({objectId:null,worldPosition:{x:640,y:360}}));
      await request(api,ownerToken!,'PUT',`/whiteboards/${boardId}/members`,{userId:required('WHITEBOARD_VIEWER_USER_ID'),role:'viewer'});
      await expect(viewer.getByTestId('denied')).toBeVisible({timeout:30_000});
    });
    await test.step('clear the editor view after access is revoked',async()=>{
      await request(api,ownerToken!,'DELETE',`/whiteboards/${boardId}/members/${encodeURIComponent(required('WHITEBOARD_EDITOR_USER_ID'))}`);
      await expect(editor.getByTestId('denied')).toBeVisible({timeout:30_000});
      await expect(editor.getByTestId('collaborative-editor')).toHaveCount(0);
      await expect(editor.getByRole('button',{name:'图形：另一位成员的中文修改',exact:true})).toHaveCount(0);
      const revokedWrite = await api.post(`${required('WHITEBOARD_API_URL')}/whiteboards/${boardId}/commands`, {
        headers: {Authorization: `Bearer ${editorToken}`}, data: {requestId: randomUUID(), epoch: 1, commands: [{type: 'style', id: 'revoked-attempt', style: {fill: '#ffffff'}}]},
      });
      expect(revokedWrite.status()).toBe(403);
    });
  }finally{
    try { if(boardId&&ownerToken)await archiveBoard(api,ownerToken,boardId); }
    finally { await Promise.all([ownerContext.close(),editorContext.close(),viewerContext.close()]); }
  }
});

test('comments anchor ACL',async({browser,request:api,baseURL})=>{
  const ownerContext=await browser.newContext({baseURL}),commenterContext=await browser.newContext({baseURL});
  const owner=await ownerContext.newPage(),commenter=await commenterContext.newPage();let boardId:string|undefined,ownerToken:string|undefined,commenterToken:string|undefined;
  try{
    [ownerToken,commenterToken]=await Promise.all([login(owner,'OWNER'),login(commenter,'VIEWER')]);
    const created=await request(api,ownerToken,'POST','/whiteboards',{requestId:randomUUID(),name:`Comment ACL ${randomUUID()}`});boardId=(await created.json() as {id:string}).id;
    await request(api,ownerToken,'PUT',`/whiteboards/${boardId}/members`,{userId:required('WHITEBOARD_VIEWER_USER_ID'),role:'commenter'});
    await owner.goto(`/studio/board/${boardId}`);await commenter.goto(`/studio/board/${boardId}`);await Promise.all([synced(owner),synced(commenter)]);
    await owner.getByTestId('board-add-sticky').click();await owner.getByLabel('对象文字',{exact:true}).fill('comment anchor target');await synced(owner);
    const target=commenter.getByRole('button',{name:'图形：comment anchor target',exact:true});await expect(target).toBeVisible({timeout:20_000});await target.focus();await target.press('Enter');
    await expect(commenter.getByLabel('对象文字',{exact:true})).toBeDisabled();await commenter.getByRole('button',{name:'评论',exact:true}).click();await commenter.getByLabel('评论内容').fill('object anchored by commenter');await commenter.getByRole('button',{name:'发布评论'}).click();
    await owner.reload();await synced(owner);const indicator=owner.locator('[data-testid^="board-comment-indicator-"]');await expect(indicator).toHaveCount(1,{timeout:20_000});await indicator.click();await expect(owner.getByText('object anchored by commenter')).toBeVisible();
    const worldBody={type:'create-comment',requestId:randomUUID(),threadId:randomUUID(),commentId:randomUUID(),objectId:null,worldPosition:{x:320,y:240},body:'world anchor',mentions:[],expectedRevision:0};
    await request(api,commenterToken,'POST',`/whiteboards/${boardId}/comments/commands`,worldBody);
    const listed=await request(api,commenterToken,'GET',`/whiteboards/${boardId}/comments`),items=(await listed.json() as {items:Array<{objectId:string|null;worldPosition:{x:number;y:number}|null}>}).items;
    expect(items).toContainEqual(expect.objectContaining({objectId:null,worldPosition:{x:320,y:240}}));
    await request(api,ownerToken,'PUT',`/whiteboards/${boardId}/members`,{userId:required('WHITEBOARD_VIEWER_USER_ID'),role:'viewer'});await expect(commenter.getByTestId('denied')).toBeVisible({timeout:30_000});
    const denied=await api.post(`${required('WHITEBOARD_API_URL').replace(/\/$/,'')}/whiteboards/${boardId}/comments/commands`,{headers:{Authorization:`Bearer ${commenterToken}`},data:{...worldBody,requestId:randomUUID(),threadId:randomUUID(),commentId:randomUUID()}});expect(denied.status()).toBe(403);
  }finally{try{if(boardId&&ownerToken)await archiveBoard(api,ownerToken,boardId);}finally{await Promise.all([ownerContext.close(),commenterContext.close()]);}}
});

test('undo offline reconnect recovery',async({browser,request:api,baseURL})=>{
  const context=await browser.newContext({baseURL}),owner=await context.newPage();let boardId:string|undefined,token:string|undefined;
  try{
    token=await login(owner,'OWNER');const created=await request(api,token,'POST','/whiteboards',{requestId:randomUUID(),name:`Offline undo ${randomUUID()}`});boardId=(await created.json() as {id:string}).id;
    const geometry={x:100,y:100,width:180,height:140,rotation:0},object=(id:string,text:string)=>({id,schemaVersion:1,kind:'sticky',geometry,text,style:{},parentId:null,orderKey:id});
    await request(api,token,'POST',`/whiteboards/${boardId}/commands`,{requestId:randomUUID(),epoch:1,commands:[
      {type:'create',object:object('undo-target','offline target')},{type:'create',object:object('undo-peer','reference peer')},
      {type:'create',object:{...object('undo-edge','reference edge'),kind:'connector',connector:{from:'undo-target',to:'undo-peer',semanticRelation:'references'}}},
    ]});
    await owner.goto(`/studio/board/${boardId}`);await synced(owner);
    await expect(owner.getByTestId('board-a11y-object-undo-target')).toBeVisible();await expect(owner.getByTestId('board-a11y-object-undo-edge')).toBeAttached();
    await context.setOffline(true);await expect(owner.getByText(/连接中断/)).toBeVisible({timeout:20_000});
    const target=owner.getByTestId('board-a11y-object-undo-target');await target.focus();await target.press('Enter');await owner.getByRole('button',{name:'删除选中'}).click();await expect(target).toHaveCount(0);await expect(owner.getByTestId('board-a11y-object-undo-edge')).toHaveCount(0);
    await owner.getByRole('button',{name:'撤销',exact:true}).click();await expect(owner.getByTestId('board-a11y-object-undo-target')).toBeAttached();await expect(owner.getByTestId('board-a11y-object-undo-edge')).toBeAttached();await expect(owner.getByText('撤销已在本地应用，正在等待服务器确认')).toBeVisible();
    await context.setOffline(false);await expect(owner.getByText(/撤销已由服务器确认 · 序列/)).toBeVisible({timeout:30_000});
    await owner.reload();await synced(owner);await expect(owner.getByTestId('board-a11y-object-undo-target')).toBeAttached();await expect(owner.getByTestId('board-a11y-object-undo-edge')).toBeAttached();
    const baseCheckpoint=await request(api,token,'POST',`/whiteboards/${boardId}/checkpoints`,{requestId:randomUUID()}),baseManifest=(await baseCheckpoint.json() as {manifest:{checkpointId:string;epoch:number;seq:number}}).manifest;
    await request(api,token,'POST',`/whiteboards/${boardId}/commands`,{requestId:randomUUID(),epoch:baseManifest.epoch,commands:[{type:'style',id:'undo-target',style:{fill:'#fde68a'}}]});
    const corruptCheckpoint=await request(api,token,'POST',`/whiteboards/${boardId}/checkpoints`,{requestId:randomUUID()}),corruptManifest=(await corruptCheckpoint.json() as {manifest:{checkpointId:string;epoch:number;seq:number;objectKey:string}}).manifest;
    const objectRoot=process.env.WORKSPACEX_OBJECT_ROOT??join(tmpdir(),'workspacex-objects');await writeFile(join(objectRoot,corruptManifest.objectKey),new Uint8Array([9,9,9]));
    const restoredResponse=await request(api,token,'POST',`/whiteboards/${boardId}/checkpoints/${corruptManifest.checkpointId}/restore`,{requestId:randomUUID(),expectedEpoch:corruptManifest.epoch,expectedSeq:corruptManifest.seq});
    const restored=await restoredResponse.json() as {auditEvents:Array<{type:string;fallbackCheckpointId?:string;requestedCheckpointId?:string}>};expect(restored.auditEvents).toContainEqual(expect.objectContaining({type:'CheckpointFallbackUsed',fallbackCheckpointId:baseManifest.checkpointId,requestedCheckpointId:corruptManifest.checkpointId}));
    await owner.reload();await synced(owner);await expect(owner.getByTestId('board-a11y-object-undo-target')).toBeAttached();await expect(owner.getByTestId('board-a11y-object-undo-edge')).toBeAttached();
  }finally{try{await context.setOffline(false);if(boardId&&token)await archiveBoard(api,token,boardId);}finally{await context.close();}}
});


test('multi-user undo redo preserves the other editor and survives reload', async ({browser, request: api, baseURL}) => {
  const ownerContext = await browser.newContext({baseURL}), editorContext = await browser.newContext({baseURL});
  const owner = await ownerContext.newPage(), editor = await editorContext.newPage();
  let boardId: string | undefined, token: string | undefined;
  try {
    [token] = await Promise.all([login(owner, 'OWNER'), login(editor, 'EDITOR')]);
    boardId = (await (await request(api, token, 'POST', '/whiteboards', {requestId: randomUUID(), name: `Independent undo ${randomUUID()}`})).json() as {id: string}).id;
    await request(api, token, 'PUT', `/whiteboards/${boardId}/members`, {userId: required('WHITEBOARD_EDITOR_USER_ID'), role: 'editor'});
    await request(api, token, 'POST', `/whiteboards/${boardId}/commands`, {requestId: randomUUID(), epoch: 1, commands: ['owner', 'editor'].map((actor, index) => ({type: 'create', object: {
      id: `${actor}-note`, schemaVersion: 1, kind: 'sticky', geometry: {x: 120 + index * 240, y: 180, width: 180, height: 140, rotation: 0},
      text: `${actor} original`, style: {}, parentId: null, orderKey: actor,
    }}))});
    await Promise.all([owner, editor].map(async page => {await page.goto(`/studio/board/${boardId}`); await synced(page);}));
    const assertBoth = async (ownerText: string, editorText: string) => {
      for (const page of [owner, editor]) {
        await expect(page.getByTestId('board-a11y-object-owner-note')).toHaveAccessibleName(`图形：${ownerText}`, {timeout: 20_000});
        await expect(page.getByTestId('board-a11y-object-editor-note')).toHaveAccessibleName(`图形：${editorText}`, {timeout: 20_000});
      }
    };
    const edit = async (page: Page, id: string, text: string) => {
      const note = page.getByTestId(`board-a11y-object-${id}`); await note.focus(); await note.press('Enter');
      await page.getByLabel('对象文字', {exact: true}).fill(text);
      await page.getByLabel('对象文字', {exact: true}).press('Escape'); await synced(page);
    };
    await edit(owner, 'owner-note', 'owner changed');
    await assertBoth('owner changed', 'editor original');
    await edit(editor, 'editor-note', 'editor changed');
    await assertBoth('owner changed', 'editor changed');
    await owner.getByRole('button', {name: '撤销', exact: true}).click();
    await assertBoth('owner original', 'editor changed');
    await editor.getByRole('button', {name: '撤销', exact: true}).click();
    await assertBoth('owner original', 'editor original');
    await owner.getByRole('button', {name: '重做', exact: true}).click();
    await assertBoth('owner changed', 'editor original');
    await editor.getByRole('button', {name: '重做', exact: true}).click();
    await assertBoth('owner changed', 'editor changed');
    await Promise.all([owner, editor].map(async page => {await page.reload(); await synced(page);}));
    await assertBoth('owner changed', 'editor changed');
  } finally {
    try {if (boardId && token) await archiveBoard(api, token, boardId);}
    finally {await Promise.all([ownerContext.close(), editorContext.close()]);}
  }
});
