import {randomUUID} from 'node:crypto';
import {CreateBoard} from '@repo/contracts/whiteboard';
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
 // Keep the suite-level 180s budget so fixture setup and cleanup cannot consume
 // the dedicated 45s drain SLA and then close the API context before archiving.
 test.setTimeout(180_000);
 page.setDefaultTimeout(15_000);
 page.setDefaultNavigationTimeout(15_000);
 const api=process.env.WHITEBOARD_API_URL??`http://127.0.0.1:${process.env.WORKSPACEX_API_PORT}`;
 if(!process.env.WHITEBOARD_API_URL&&!process.env.WORKSPACEX_API_PORT)throw new Error('Isolated API URL required');
 const metadata=createSpatialWsMetadataRecorder();metadata.observe(page,'original');
 const http:Array<{method:string;path:string;status:number}>=[];
 const startedAt=performance.now();const milestones:Array<{name:string;elapsedMs:number}>=[];
 const mark=(name:string)=>milestones.push({name,elapsedMs:Math.round(performance.now()-startedAt)});
 let token='',boardId='',archived=false,peer:Page|undefined;const evidence:Record<string,unknown>={drainSlaMs:DRAIN_SLA_MS,http,milestones};
 const call=async(method:string,path:string,data?:unknown)=>{const safePath=new URL(path,'http://diagnostic.invalid').pathname,index=http.push({method,path:safePath,status:0})-1;const response=await request.fetch(`${api}${path}`,{method,data,timeout:15_000,headers:{Authorization:`Bearer ${token}`}});const status=response.status();http[index]!.status=status;
  // Record only routing metadata, never credentials, request/response bodies or query strings.
  expect(response.ok(),`Board fixture HTTP ${method} ${safePath}: ${status}`).toBe(true);return response.json();};
 const objectRows=(tab:Page)=>tab.locator('[data-testid="board-a11y-mirror"] li[data-object-id]');
 const rows=(tab:Page)=>objectRows(tab).evaluateAll(elements=>elements.map(element=>{const item=element as HTMLElement;return{id:item.dataset.objectId,kind:item.dataset.objectKind,geometry:item.dataset.geometry,parentId:item.dataset.parentId,zIndex:item.dataset.zIndex,text:item.querySelector('button')?.textContent};}).sort((a,b)=>String(a.id).localeCompare(String(b.id))));
 const synced=(tab:Page)=>tab.getByText(/^已同步(?: · 序列 \d+)?$/);
 try{
  await page.goto('/login');await page.getByTestId('login-email').fill(F.adminEmail);await page.getByTestId('login-password').fill(F.adminPassword);await page.getByTestId('login-submit').click();await expect(page).toHaveURL(/\/projects$/);mark('authenticated');
  token=(await page.evaluate(key=>localStorage.getItem(key),SESSION_TOKEN_STORAGE_KEY))!;
  const board=await call('POST','/whiteboards',CreateBoard.parse({requestId:randomUUID(),name:'Same-browser durable outbox'}));boardId=board.id;mark('board-created');
  await page.goto(`/studio/board/${boardId}`);await expect(synced(page)).toBeVisible();mark('board-opened');
  const initial=await call('POST',`/whiteboards/${boardId}/checkpoints`,{requestId:randomUUID()});expect(initial.manifest.seq).toBe(0);mark('initial-checkpoint');
  const surface=page.getByTestId('board-fabric-surface');
  await surface.hover();await page.mouse.wheel(0,100_000);await expect(page.getByTestId('board-zoom-value')).toHaveText('5%');
  await page.getByTestId('board-add-frame').click();
  await expect(page.getByTestId('board-frame-tool-panel')).toBeVisible();
  const createdIds:string[]=[];
  for(let index=0;index<8;index++){
   await surface.click({position:{x:120+(index%4)*80,y:100+Math.floor(index/4)*80}});
   await expect(objectRows(page),`Frame gesture ${index+1} must create exactly one object`).toHaveCount(index+1);
   const created=await rows(page);expect(created).toHaveLength(index+1);expect(created.every(row=>row.kind==='panel')).toBe(true);
   const ids=created.map(row=>row.id);expect(new Set(ids).size).toBe(index+1);createdIds.splice(0,createdIds.length,...ids.filter((id):id is string=>Boolean(id)));
  }
  await page.getByRole('button',{name:'Close frame tools'}).click();
  await expect(objectRows(page)).toHaveCount(8);
  mark('panels-created');
  await page.getByTestId('board-inspector-expand').click();
  const title=page.getByRole('textbox',{name:'区域标题',exact:true});await title.fill(`${await title.inputValue()}shared-tab-proof`);
  const pending=page.getByText(/^\d+ 项修改等待服务器确认$/);await expect(pending).toBeVisible();evidence.pendingBeforePeer=await pending.textContent();
  mark('local-updates-queued');
  const expected=await rows(page);expect(expected).toHaveLength(8);expect(expected.every(row=>row.kind==='panel')).toBe(true);expect(expected.map(row=>row.id)).toEqual(createdIds);expect(expected.some(row=>row.text?.includes('shared-tab-proof'))).toBe(true);
  const started=performance.now(),deadline=started+DRAIN_SLA_MS;
  const testPeer=await page.context().newPage();peer=testPeer;testPeer.setDefaultTimeout(15_000);testPeer.setDefaultNavigationTimeout(15_000);metadata.observe(testPeer,'peer');await testPeer.goto(`/studio/board/${boardId}`);mark('peer-opened');
  const remaining=()=>Math.max(1,deadline-performance.now());
  await expect(synced(page)).toBeVisible({timeout:remaining()});await expect(synced(testPeer)).toBeVisible({timeout:remaining()});
  await expect.poll(()=>rows(testPeer),{timeout:remaining()}).toEqual(expected);expect(await rows(page)).toEqual(expected);
  mark('peer-converged');
  evidence.drainMs=performance.now()-started;expect(evidence.drainMs).toBeLessThanOrEqual(DRAIN_SLA_MS);
  const final=await call('POST',`/whiteboards/${boardId}/checkpoints`,{requestId:randomUUID()});expect(final.manifest.epoch).toBe(initial.manifest.epoch);
  const transport=metadata.snapshot();expect(transport.dropped).toBe(0);expect(sharedOutboxProof(transport.events,initial.manifest.seq,final.manifest.seq)).toEqual([]);
  evidence.revisions={before:initial.manifest.seq,after:final.manifest.seq,epoch:final.manifest.epoch};
  await Promise.all([page.reload(),testPeer.reload()]);
  mark('both-reloaded');
  for(const tab of [page,testPeer]){await expect(synced(tab)).toBeVisible({timeout:10_000});await expect.poll(()=>rows(tab),{timeout:10_000}).toEqual(expected);}
  const afterReload=await call('POST',`/whiteboards/${boardId}/checkpoints`,{requestId:randomUUID()});expect(afterReload.manifest.seq).toBe(final.manifest.seq);
  expect(metadata.snapshot().dropped).toBe(0);expect(sharedOutboxProof(metadata.snapshot().events,initial.manifest.seq,afterReload.manifest.seq)).toEqual([]);
  evidence.afterReloadSeq=afterReload.manifest.seq;evidence.objectIds=expected.map(row=>row.id);evidence.status='passed';
  await testPeer.close();peer=undefined;
 }finally{
  await peer?.close().catch(()=>undefined);
  if(boardId&&token&&!archived){try{const board=await call('GET',`/whiteboards/${boardId}`);if(!board.archived){await call('PATCH',`/whiteboards/${boardId}`,{archived:true,expectedLifecycleRevision:board.lifecycleRevision});archived=true;}}catch(error){evidence.cleanupError=String(error);}}
  await info.attach('same-browser-outbox-evidence',{body:Buffer.from(JSON.stringify({...evidence,transport:metadata.snapshot()})),contentType:'application/json'});
 }
});
