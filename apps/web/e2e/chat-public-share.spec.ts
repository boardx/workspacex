import { expect, test } from '@playwright/test';
import {FULLSTACK_E2E as F} from './fullstack-smoke-fixture';
import {chatPublicShareThreadId} from './chat-public-share-fixture';
import {boardLogin} from './board-acceptance-support';
import {captureBoardLogin} from './support/board-login-capture.mjs';
// Browser rendering coverage with a deterministic API response. API persistence/revocation
// must be verified separately against the real database; this spec makes no such claim.
const token = 't'.repeat(43);
const snapshot = { title: '朋友分享的对话', messages: [
  { authorKind: 'human', text: '## 问题\n请解释这段代码。', createdAt: '2026-10-13T00:00:00Z', attachments: [] },
  { authorKind: 'agent', text: '```typescript\nconst veryLongLine = "' + 'example'.repeat(80) + '";\n```\n<script>window.pwned=true</script>\n[恶意链接](javascript:alert(1))', createdAt: '2026-10-13T00:00:01Z', attachments: [{ filename: '示例.png', mime: 'image/png', bytes: 68, imageData: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aM1cAAAAASUVORK5CYII=' }] },
] };
for (const width of [375, 1440]) {
  test(`anonymous snapshot: image, code and no page overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/chat/shares/' + token, async route => {
      expect(route.request().headers()).not.toHaveProperty('authorization');
      await route.fulfill({ json: { snapshot, createdAt: '2026-10-13T00:00:02Z' } });
    });
    await page.goto('/share/chat/' + token);
    await expect(page.getByRole('heading', { name: snapshot.title })).toBeVisible();
    await expect(page.getByText('无需账号即可查看', { exact: false })).toBeVisible();
    const image = page.getByRole('img', { name: '示例.png' });
    await expect(image).toBeVisible();
    expect(await image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await expect(page.locator('[data-testid="shared-chat-message"] pre')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await page.evaluate(() => (window as typeof window & { pwned?: boolean }).pwned)).toBeUndefined();
    expect(await page.locator('a[href^="javascript:"]').count()).toBe(0);
    await page.screenshot({ path: `test-results/chat-public-share-${width}.png`, fullPage: true });
  });
}
test('revoked or nonexistent anonymous link gives an actionable error', async ({ page }) => {
  await page.route('**/chat/shares/' + token, route => route.fulfill({ status: 404, json: { message: 'not found' } }));
  await page.goto('/share/chat/' + token);
  await expect(page.getByTestId('public-chat-share').getByRole('alert')).toHaveText('分享链接已失效或不存在。重试');
  await expect(page.getByRole('button', { name: '重试' })).toBeVisible();
});

test('real owner publishes, anonymous friends read on phone/desktop, then owner revokes', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const explicitFixture=Boolean(process.env.CHAT_SHARE_E2E_PASSWORD);
  const login=await captureBoardLogin(page,()=>boardLogin(page,process.env.CHAT_SHARE_E2E_EMAIL??F.email,process.env.CHAT_SHARE_E2E_PASSWORD??F.password));
  expect(login.posts,'CHAT_SHARE_LOGIN_SINGLE_POST').toBe(1);
  expect(login.status,'CHAT_SHARE_LOGIN_HTTP_OK').toBe(200);
  expect(login.jsonParsed,'CHAT_SHARE_LOGIN_JSON').toBe(true);
  if(!explicitFixture){
    expect(login.body!==null&&typeof login.body==='object'&&'userId' in login.body&&login.body.userId===F.userId,'CHAT_SHARE_OWNER_ACTOR').toBe(true);
  }
  expect(typeof login.token==='string'&&login.token.length>0,'CHAT_SHARE_REAL_SESSION').toBe(true);
  await page.goto('/chat/' + (process.env.CHAT_SHARE_E2E_THREAD??chatPublicShareThreadId(F.userId)));
  await page.getByTestId('chat-share-open').click();
  await expect(page.getByTestId('chat-share-preview').getByTestId('shared-chat-messages')).toBeVisible();
  await page.getByTestId('chat-share-create').click();
  const link = await page.getByTestId('chat-share-url').inputValue();
  expect(link).toContain('/share/chat/');
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByTestId('chat-share-copy').click();
  await expect(page.getByTestId('chat-share-copy')).toHaveText('已复制');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(link);
  for (const width of [375, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const reader = await context.newPage();
    const bearerLeaks: string[] = [];
    reader.on('request', request => { if (request.url().includes('/chat/shares/') && request.headers()['authorization']) bearerLeaks.push(request.url()); });
    await reader.goto(link);
    await expect(reader.getByRole('heading', { name: '与朋友分享的对话' })).toBeVisible();
    await expect(reader.getByTestId('shared-chat-messages')).toBeVisible();
    const image = reader.getByRole('img').first();
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0)).toBe(true);
    await expect(reader.locator('[data-testid="shared-chat-message"] pre').first()).toBeVisible();
    expect(await reader.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect(await reader.evaluate(() => localStorage.getItem('wsx.sessionToken'))).toBeNull();
    expect(bearerLeaks).toEqual([]);
    expect(await reader.evaluate(()=>(window as typeof window & {shareXss?:boolean}).shareXss)).toBeUndefined();
    expect(await reader.locator('a[href^="javascript:"]').count()).toBe(0);
    await reader.screenshot({ path: `test-results/chat-public-share-real-${width}.png`, fullPage: true });
    await context.close();
  }
  await page.getByTestId('chat-share-revoke').first().click();
  await expect(page.getByTestId('chat-share-url')).toHaveCount(0);
  const revoked = await browser.newContext();
  const reader = await revoked.newPage();
  const response = reader.waitForResponse(r => r.url().includes('/chat/shares/'));
  await reader.goto(link);
  expect((await response).status()).toBe(404);
  await expect(reader.getByTestId('public-chat-share').getByRole('alert')).toContainText('分享链接已失效或不存在');
  await revoked.close();
});
