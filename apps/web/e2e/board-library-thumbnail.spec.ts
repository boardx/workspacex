import { test, expect, type Page } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { FULLSTACK_E2E as F } from './fullstack-smoke-fixture';
import { boardLogin, createAcceptanceBoard, operate, object, openBoard, boardHead, boardApi, apiOrigin, objectPoint } from './board-acceptance-support';
import { expectBoardSynced } from './support/board-sync-status';
import { deleteOwnedConnectorFixture } from './support/connector-acceptance-fixture';

test.describe.configure({ timeout: 180_000 });
async function pixels(page: Page, id: string) {
  const image = page.getByTestId(`board-thumbnail-${id}`).locator('img');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  return image.evaluate((element: HTMLImageElement) => {
    const canvas = document.createElement('canvas'); canvas.width = element.naturalWidth; canvas.height = element.naturalHeight;
    const ctx = canvas.getContext('2d')!; ctx.drawImage(element, 0, 0);
    const bytes = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let colored = 0, yellow = 0, magenta = 0, left = canvas.width, right = -1, top = canvas.height, bottom = -1; const points: number[] = [];
    for (let offset = 0; offset < bytes.length; offset += 4) {
      const r = bytes[offset]!, g = bytes[offset + 1]!, b = bytes[offset + 2]!;
      if (r < 240 || g < 240 || b < 240) { colored++; const pixel = offset / 4, x = pixel % canvas.width, y = Math.floor(pixel / canvas.width); left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
      if (r > 210 && g > 140 && g < 235 && b < 170) yellow++;
      if (r > 220 && b > 220 && g < 40) magenta++;
      if (offset % 128 === 0) points.push(r, g, b);
    }
    return { width: canvas.width, height: canvas.height, colored, yellow, magenta, left, right, top, bottom, digestBytes: points };
  });
}

test('Board library generates canonical thumbnails, updates after ACK, reloads and rejects unauthorized cached pixels', async ({ page, request, browser }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  let logins = 0;
  page.on('request', req => { if (req.method() === 'POST' && /\/auth\/login(?:\?|$)/.test(req.url())) logins++; });
  const token = await boardLogin(page), name = `Thumbnail acceptance ${randomUUID()}`;
  const populated = await createAcceptanceBoard(request, token, name), emptyName = `${name} empty`;
  const empty = await createAcceptanceBoard(request, token, emptyName), failures: unknown[] = [];
  try {
    await operate(request, token, populated, [
      { type: 'create', object: object('thumb-sticky', 'sticky', 0, 0, 'LEFT THUMBNAIL', 200, 160) },
      { type: 'create', object: object('thumb-text', 'text', 800, 400, 'RIGHT EDGE CONTENT', 220, 120) },
      { type: 'create', object: { ...object('thumb-edge', 'connector', 200, 80, '', 600, 380), connector: { from: 'thumb-sticky', to: 'thumb-text', fromAnchor: 'right', toAnchor: 'left', type: 'straight', endStyle: 'arrow' } } },
    ]);
    await openBoard(page, populated, 3);
    // Actual upload creates a durable authorized image; no public image URL or invented metadata.
    const png = await page.evaluate(() => {
      const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 80;
      const ctx = canvas.getContext('2d')!; ctx.fillStyle = '#FF00FF'; ctx.fillRect(0, 0, 120, 80);
      return canvas.toDataURL('image/png').split(',')[1]!;
    });
    await page.getByTestId('board-add-image').click();
    await page.getByTestId('board-image-input').setInputFiles({ name: 'thumbnail-magenta.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
    await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(4);
    await expectBoardSynced(page, 30_000);
    const initialRevision = await boardHead(request, token, populated);
    await page.goto('/studio/board');
    const first = await pixels(page, populated);
    expect(first.width).toBeLessThanOrEqual(640); expect(first.height).toBeLessThanOrEqual(360);
    expect(first.left).toBeGreaterThan(0); expect(first.right).toBeLessThan(first.width - 1); expect(first.top).toBeGreaterThan(0); expect(first.bottom).toBeLessThan(first.height - 1);
    expect(first.colored).toBeGreaterThan(100); expect(first.yellow).toBeGreaterThan(20); expect(first.magenta).toBeGreaterThan(20);
    await expect(page.getByTestId(`board-thumbnail-empty-${empty}`)).toHaveText('空白白板');
    await page.screenshot({ path: info.outputPath('thumbnail-real-library.png'), fullPage: true });
    await openBoard(page, populated, 4);
    await page.getByTestId('board-tool-select').click();
    await page.getByTestId('board-zoom-fit-board').click();
    const stickyPoint=await objectPoint(page,'thumb-sticky');
    await page.mouse.dblclick(stickyPoint.x,stickyPoint.y);
    await expect(page.getByTestId('board-thinking-editor')).toBeFocused();
    await page.getByTestId('board-thinking-editor').fill('UPDATED THUMBNAIL CONTENT');
    await page.getByTestId('board-thinking-editor').press('ControlOrMeta+Enter');
    await expect(page.getByTestId('board-a11y-mirror').locator('li[data-object-id]')).toHaveCount(4);
    await expectBoardSynced(page, 30_000);
    const editedRevision = await boardHead(request, token, populated); expect(editedRevision.seq).toBeGreaterThan(initialRevision.seq);
    await page.goto('/studio/board'); const edited = await pixels(page, populated);
    expect(edited.digestBytes).not.toEqual(first.digestBytes); expect(edited.magenta).toBeGreaterThan(20);
    await page.reload(); const reloaded = await pixels(page, populated); expect(reloaded.digestBytes).toEqual(edited.digestBytes);
    // A real viewer reads authorized pixels; owner revokes only this disposable board membership.
    await boardApi(request, token, 'PUT', `/whiteboards/${populated}/members`, { userId: F.adminUserId, role: 'viewer' });
    const viewerContext = await browser.newContext({ baseURL: info.project.use.baseURL });
    try {
      const viewerPage = await viewerContext.newPage();
      const viewerToken = await boardLogin(viewerPage, F.adminEmail, F.adminPassword);
      await viewerPage.goto('/studio/board'); await pixels(viewerPage, populated);
      await boardApi(request, token, 'DELETE', `/whiteboards/${populated}/members/${F.adminUserId}`);
      const denied = await request.get(`${apiOrigin()}/v1/whiteboards/${populated}/head`, { headers: { authorization: `Bearer ${viewerToken}` } });
      expect([403, 404]).toContain(denied.status());
      const previousBlob=await viewerPage.getByTestId(`board-thumbnail-${populated}`).locator('img').getAttribute('src');
      expect(previousBlob).toMatch(/^blob:/);
      // Use a real list action: headless bringToFront does not reliably emit window focus.
      // This keeps the cached card mounted until the actual authorized list response excludes it.
      const refreshedList=viewerPage.waitForResponse(response=>response.request().method()==='GET'&&response.url().includes('/whiteboards?')&&new URL(response.url()).searchParams.get('query')===name);
      await viewerPage.getByTestId('board-search').fill(name);
      const listResponse=await refreshedList;expect(listResponse.status()).toBe(200);
      const deniedList=await listResponse.json()as{items:Array<{id:string}>};expect(Array.isArray(deniedList.items)).toBe(true);
      expect(deniedList.items.some(item=>item.id===populated)).toBe(false);
      await expect(viewerPage.getByTestId(`board-card-${populated}`)).toHaveCount(0);
      await expect(viewerPage.getByTestId(`board-thumbnail-${populated}`).locator('img')).toHaveCount(0);
      // Removal must revoke the captured private object URL, rather than leaving reusable pixels.
      await expect.poll(()=>viewerPage.evaluate(async source=>{try{const response=await fetch(source!);return response.ok;}catch{return false;}},previousBlob)).toBe(false);
    } finally { await viewerContext.close(); }
    expect(logins).toBe(1);
    await info.attach('thumbnail evidence', { body: JSON.stringify({ initialRevision, editedRevision, first: { ...first, digestBytes: createHash('sha256').update(JSON.stringify(first.digestBytes)).digest('hex') }, edited: { ...edited, digestBytes: createHash('sha256').update(JSON.stringify(edited.digestBytes)).digest('hex') }, logins, serverAclCoverage: true }), contentType: 'application/json' });
  } catch (error) { failures.push(error); }
  finally {
    for (const [id, ownedName] of [[populated, name], [empty, emptyName]]) {
      try { await deleteOwnedConnectorFixture(request, token, id!, F.userId, ownedName!); } catch (error) { failures.push(error); }
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Thumbnail primary acceptance failure followed by any owned cleanup failures');
});
