import { expect, test } from '@playwright/test';

test('Miro Mural import report', async ({ page }) => {
  const boardId='20000000-0000-4000-8000-000000000001',importId='30000000-0000-5000-a000-000000000001';
  await page.addInitScript(()=>localStorage.setItem('session_token','board-import-e2e'));
  await page.route('http://localhost:3200/**',async route=>{const request=route.request(),url=new URL(request.url());
    if(request.method()==='GET'&&url.pathname===`/whiteboards/${boardId}`)return route.fulfill({json:{id:boardId,name:'Import target',ownerId:'owner',role:'owner',archived:false,lifecycleRevision:1,tagIds:[],tagsRevision:1,createdAt:'2026-09-26T00:00:00.000Z',updatedAt:'2026-09-26T00:00:00.000Z'}});
    if(request.method()==='POST'&&url.pathname===`/whiteboards/${boardId}/imports`)return route.fulfill({json:{importId,boardId,source:'miro',sourceBoardId:'source-1',sourceRevision:'rev-7',fileName:'board.json',mimeType:'application/json',sizeBytes:44,sha256:'a'.repeat(64),stage:'uploaded',counts:null,createdAt:'2026-09-26T00:00:00.000Z',updatedAt:'2026-09-26T00:00:00.000Z'}});
    const report={importId,counts:{discovered:2,accepted:1,unsupported:1,assets:0},issues:[{code:'UNSUPPORTED_ITEM',sourceId:'video',sourceType:'video',detail:'video is not supported'}],items:[{sourceId:'note',sourceType:'sticker',outcome:'success',reasonCode:null,detail:null},{sourceId:'video',sourceType:'video',outcome:'skipped',reasonCode:'UNSUPPORTED_ITEM',detail:'video is not supported'}],exportFormat:'workspacex.whiteboard-import-report.v1',executable:true};
    if(url.pathname.endsWith('/preflight'))return route.fulfill({json:report});
    if(url.pathname.endsWith('/execute'))return route.fulfill({json:{status:{importId,boardId,source:'miro',sourceBoardId:'source-1',sourceRevision:'rev-7',fileName:'board.json',mimeType:'application/json',sizeBytes:44,sha256:'a'.repeat(64),stage:'completed',counts:report.counts,createdAt:'2026-09-26T00:00:00.000Z',updatedAt:'2026-09-26T00:00:00.000Z'},report,epoch:1,seq:1,replayed:false}});
    return route.abort();});
  await page.goto(`/studio/board/${boardId}`);
  await page.getByTestId('board-import-open').click();
  await page.getByTestId('board-import-source-id').fill('source-1');await page.getByTestId('board-import-revision').fill('rev-7');
  await page.getByTestId('board-import-file').setInputFiles({name:'board.json',mimeType:'application/json',buffer:Buffer.from('{"widgets":[{"id":"note","type":"sticker"}]}')});
  await page.getByTestId('board-import-submit').click();
  await expect(page.getByTestId('board-import-progress')).toContainText('导入完成');
  await expect(page.getByTestId('board-import-report')).toContainText('成功 1 · 降级 0 · 跳过 1 · 失败 0');
  await expect(page.getByTestId('board-import-report')).toContainText('UNSUPPORTED_ITEM');
  const download=page.waitForEvent('download');await page.getByTestId('board-import-report-download').click();expect((await download).suggestedFilename()).toBe(`whiteboard-import-${importId}.json`);
});
