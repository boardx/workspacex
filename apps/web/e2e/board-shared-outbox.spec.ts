import {randomUUID} from 'node:crypto';
import {expect,test,type Page} from '@playwright/test';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {SESSION_TOKEN_STORAGE_KEY} from '../lib/api-client';
import {createSpatialWsMetadataRecorder} from './support/board-spatial-ws-metadata';
import {sharedOutboxProof} from './support/board-shared-outbox-proof';

// Separate from independent-browser collaboration: these tabs deliberately share IDB.
// At most 8 creates + 16 text edits. 45s is a bounded drain SLA (~1.8s per unique
// write, including fresh sync and duplicate receipt replay), not a retry-until-green.
const DRAIN_SLA_MS=45_000;
test('same-browser tabs drain a shared durable outbox without duplicate commits',async({page,request},info)=>{
 test.setTimeout(100_000);
 const api=process.env.WHITEBOARD_API_URL??`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`;
 if(!process.env.WHITEBOARD_API_URL&&!process.env.WORKSPACEX_API_PORT)throw new Error('Isolated API URL required');
 const metadata=createSpatialWsMetadataRecorder();metadata.observe(page,'original');
 let token='',boardId='',archived=false;const evidence:Record<string,unknown>={drainSlaMs:DRAIN_SLA_MS};
 const call=async(method:string,path:string,data?:unknown)=>{const response=await request.fetch(`${api}${path}`,{method,data,headers:{Authorization:`Bearer ${token}`}});expect(response.ok()).toBe(true);return response.json();};
 const rows=(tab:Page)=>tab.locator('[data-testid="board-a11y-mirror"] li').evaluateAll(elements=>elements.map(element=>{const item=element as HTMLElement;return{id:item.dataset.objectId,kind:item.dataset.objectKind,geometry:item.dataset.geometry,parentId:item.dataset.parentId,zIndex:item.dataset.zIndex,text:item.querySelector('button')?.textContent};}).sort((a,b)=>String(a.id).localeCompare(String(b.id))));
 const synced=(tab:Page)=>tab.getByText(/^已同步(?: · 序列 \d+)?$/);
 try{
  await page.goto('/login');await page.getByTestId('login-email').fill(F.adminEmail);await page.getByTestId('login-password').fill(F.adminPassword);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/projects$/);
  token=(await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY))!;
  const board=await call('POST','/whiteboards',{requestId:randomUUID(),title:'Same-browser durable outbox'});boardId=board.id;
  await page.goto(`/studio/board/${boardId}`);await expect(synced(page)).toBeVisible();
  const initial=await call('POST',`/whiteboards/${boardId}/checkpoints`,{requestId:randomUUID()});expect(initial.manifest.seq).toBe(0);
  for(let index=0;index<8;index++)await page.getByTestId('board-add-panel').click();
  await expect(page.getByTestId('board-a11y-mirror').getByRole('button')).toHaveCount(8);
  const actions=page.getByRole('dialog',{name:'更多操作',exact:true});if(!await actions.isVisible())await page.getByRole('button',{name:'更多操作',exact:true}).click();
  await actions.getByRole('button',{name:'精确属性',exact:true}).click();
  const title=page.getByRole('textbox',{name:'区域标题',exact:true});await title.press('End');await title.pressSequentially('shared-tab-proof');
  const pending=page.getByText(/^\d+ 项修改等待服务器确认$/);await expect(pending).toBeVisible();evidence.pendingBeforePeer=await pending.textContent();
  const expected=await rows(page);expect(new Set(expected.map(row=>row.id)).size).toBe(8);expect(expected.some(row=>row.text?.includes('shared-tab-proof'))).toBe(true);
  const started=performance.now(),deadline=started+DRAIN_SLA_MS;
  const peer=await page.context().newPage();metadata.observe(peer,'peer');await peer.goto(`/studio/board/${boardId}`);
  const remaining=()=>Math.max(1,deadline-performance.now());
  await expect(synced(page)).toBeVisible({timeout:remaining()});await expect(synced(peer)).toBeVisible({timeout:remaining()});
  await expect.poll(()=>rows(peer),{timeout:remaining()}).toEqual(expected);expect(await rows(page)).toEqual(expected);
  evidence.drainMs=performance.now()-started;expect(evidence.drainMs).toBeLessThanOrEqual(DRAIN_SLA_MS);
  const final=await call('POST',`/whiteboards/${boardId}/checkpoints`,{requestId:randomUUID()});expect(final.manifest.epoch).toBe(initial.manifest.epoch);
  const transport=metadata.snapshot();expect(transport.dropped).toBe(0);expect(sharedOutboxProof(transport.events,initial.manifest.seq,final.manifest.seq)).toEqual([]);
  evidence.revisions={before:initial.manifest.seq,after:final.manifest.seq,epoch:final.manifest.epoch};
  await Promise.all([page.reload(),peer.reload()]);
  for(const tab of [page,peer]){await expect(synced(tab)).toBeVisible({timeout:10_000});await expect.poll(()=>rows(tab),{timeout:10_000}).toEqual(expected);}
  const afterReload=await call('POST',`/whiteboards/${boardId}/checkpoints`,{requestId:randomUUID()});expect(afterReload.manifest.seq).toBe(final.manifest.seq);
  expect(metadata.snapshot().dropped).toBe(0);expect(sharedOutboxProof(metadata.snapshot().events,initial.manifest.seq,afterReload.manifest.seq)).toEqual([]);
  evidence.afterReloadSeq=afterReload.manifest.seq;evidence.objectIds=expected.map(row=>row.id);evidence.status='passed';
  await peer.close();
 }finally{
  await info.attach('same-browser-outbox-evidence',{body:Buffer.from(JSON.stringify({...evidence,transport:metadata.snapshot()})),contentType:'application/json'});
  if(boardId&&token&&!archived){const board=await call('GET',`/whiteboards/${boardId}`);if(!board.archived){await call('PATCH',`/whiteboards/${boardId}`,{archived:true,expectedLifecycleRevision:board.lifecycleRevision});archived=true;}}
 }
});
