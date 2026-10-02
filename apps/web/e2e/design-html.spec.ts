/** Routed browser fixtures prove frontend behavior, not real model/API persistence. */
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import { designHtmlPage } from '@repo/contracts';
import { DESIGN_PROJECTS, routeDrafts, routeInbox, routeDesignWorkbench } from '../scripts/lib/design-loop-fixtures.mjs';
import { clickMore } from './support/design-more';
test.use({ launchOptions: process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {}, acceptDownloads: true });
const evidence = resolve(process.cwd(), '../../evidence/design-html-20261001');
const pages = ['情绪日记', '写日记'].map((title, i) => designHtmlPage.sanitizeHtmlPage(`<style>body{margin:0;padding:24px;background:#f9f3e9;color:#304d43;font-family:serif}h1{font-size:32px}button{padding:16px;background:#304d43;color:white;border:0;border-radius:18px}</style><main><h1>${title}</h1><p>记录一点今天的心情</p><button data-goto="${1 - i}">写下心情</button></main>`).html);
const project = { ...DESIGN_PROJECTS[2], id: 'eval-HTML', name: '情绪日记', frames: ['首页', '写日记'], frameNotes: ['', ''], chat: [], prototype: pages.map((html, i) => ({ id: `html-${i}`, type: 'html', props: { html } })), frameLinks: pages.map(html => designHtmlPage.htmlPageLinks(html)) };
async function open(page: Page) { mkdirSync(evidence, { recursive: true }); await routeDrafts(page, { empty: false }); await routeInbox(page, { empty: false }); await routeDesignWorkbench(page, { extraProjects: [project] }); await page.goto('/preview/feedback-design-loop?scene=detail-eval&case=HTML'); await page.getByTestId('design-detail').waitFor(); await page.getByTestId('design-detail-view-single').click(); }
const frame = (page: Page) => page.frameLocator('[data-testid="design-html-page"]');
test('HTML selection focusRef clear and preview navigation', async ({ page }) => {
    await open(page);
    await expect(frame(page).getByRole('heading', { name: '情绪日记' })).toBeVisible();
    await page.screenshot({ path: resolve(evidence, 'html-browser-initial.png'), fullPage: true });
    await frame(page).getByRole('heading', { name: '情绪日记' }).click();
    await expect(page.getByTestId('design-detail-focus')).toContainText('情绪日记');
    await page.screenshot({ path: resolve(evidence, 'html-browser-selected.png'), fullPage: true });
    const posted: Record<string, unknown>[] = [];
    await page.route(url => /\/pm-designs\/eval-HTML\/chat$/.test(new URL(url).pathname), async (route) => { posted.push(route.request().postDataJSON()); await route.fallback(); });
    await page.getByTestId('design-detail-input').fill('改成今天过得怎么样');
    await page.getByTestId('design-detail-send').click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ focusNodeId: 'html-0', focusRef: expect.stringMatching(/^r\d+$/) });
    await expect(page.getByTestId('design-detail-generating')).toHaveCount(0);
    await page.getByTestId('design-detail-focus-clear').click();
    await page.getByTestId('design-detail-input').fill('保留版式');
    await page.getByTestId('design-detail-send').click();
    await expect.poll(() => posted.length).toBe(2);
    expect(posted[1]?.focusRef).toBeUndefined();
    await expect(page.getByTestId('design-detail-generating')).toHaveCount(0);
    await page.getByTestId('design-detail-mode-preview').click();
    await frame(page).getByRole('button', { name: '写下心情' }).click();
    await expect(frame(page).getByRole('heading', { name: '写日记' })).toBeVisible();
    await expect(page.getByTestId('design-detail-focus')).toHaveCount(0);
    await page.screenshot({ path: resolve(evidence, 'html-browser-preview-navigation.png'), fullPage: true });
});
test('offline HTML export iframe navigation', async ({ page, context }) => { await open(page); await clickMore(page, 'design-detail-export'); const pending = page.waitForEvent('download'); await page.getByTestId('design-detail-export-html').click(); const path = resolve(evidence, 'emotional-diary-offline.html'); await (await pending).saveAs(path); const offline = await context.newPage(); await offline.goto(`file://${path}`); const home = offline.locator('.wx-page').nth(0); const write = offline.locator('.wx-page').nth(1); await expect(home).toBeVisible();
    await offline.evaluate(() => window.dispatchEvent(new MessageEvent('message', { source: window, data: { source: 'wsx-html-page', type: 'goto', id: 'goto-1-0' } })));
    await expect(home).toBeVisible();
    await home.locator('iframe').evaluate((el) => {
      window.dispatchEvent(new MessageEvent('message', { source: (el as HTMLIFrameElement).contentWindow, data: { source: 'wsx-html-page', type: 'goto', id: 'nonexistent-link' } }));
    });
    await expect(home).toBeVisible();
    await home.frameLocator('iframe').getByRole('button', { name: '写下心情' }).click(); await expect(write).toBeVisible(); await expect(home).toBeHidden(); await offline.screenshot({ path: resolve(evidence, 'html-browser-offline-navigation.png'), fullPage: true }); });
test('375px no page horizontal overflow', async ({ page }) => { await page.setViewportSize({ width: 375, height: 812 }); await open(page); await expect(frame(page).getByRole('heading', { name: '情绪日记' })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await page.screenshot({ path: resolve(evidence, 'html-browser-mobile-375.png'), fullPage: true }); });
test('local CSS replacement changes only selected same-class element', async ({ page }) => {
    const original = designHtmlPage.sanitizeHtmlPage('<style>.action{background:#304d43;color:white}</style><main><button class="action">选中的按钮</button><button class="action">保留的按钮</button></main>').html;
    const ref = original.match(/<button[^>]*data-ref="([^"]+)"/)?.[1];
    expect(ref).toBeTruthy();
    const changed = designHtmlPage.replaceHtmlPageElement(original, ref!, '<button class="action">今天过得怎么样</button>', '.action{background:#ff0000}');
    expect(changed).not.toBeNull();
    await routeDrafts(page, { empty: false });
    await routeInbox(page, { empty: false });
    await routeDesignWorkbench(page, { extraProjects: [{ ...project, prototype: [{ id: 'html-0', type: 'html', props: { html: changed } }, project.prototype[1]] }] });
    await page.goto('/preview/feedback-design-loop?scene=detail-eval&case=HTML');
    await page.getByTestId('design-detail-view-single').click();
    const selected = frame(page).getByRole('button', { name: '今天过得怎么样' });
    const untouched = frame(page).getByRole('button', { name: '保留的按钮' });
    await expect(selected).toBeVisible();
    expect(await selected.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 0, 0)');
    expect(await untouched.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(48, 77, 67)');
    await page.screenshot({ path: resolve(evidence, 'html-browser-local-edit.png'), fullPage: true });
    const baseline = designHtmlPage.sanitizeHtmlPage('<style>.btn{color:#304d43}</style><main><button class="btn">选中的按钮</button><button class="btn">保留的按钮</button></main>').html;
    const targetRef = baseline.match(/<button[^>]*data-ref="([^"]+)"/)![1]!;
    const cases = [
      { name: 'unbalanced selector', css: '.btn), .btn, :is(.btn{color:red}', replacement: '<button class="btn">修改按钮</button>', color: 'rgb(48, 77, 67)', pseudo: false },
      { name: 'escaped selector', css: String.raw`.btn\), .btn, :is(.btn{color:red}`, replacement: '<button class="btn">修改按钮</button>', color: 'rgb(48, 77, 67)', pseudo: false },
      { name: 'whitespace style closing', css: '', replacement: '<style>.btn{color:red}</style ><button class="btn">修改按钮</button>', color: 'rgb(255, 0, 0)', pseudo: false },
      { name: 'scoped pseudo element', css: ".btn::before{content:'changed';color:red}", replacement: '<button class="btn">修改按钮</button>', color: 'rgb(48, 77, 67)', pseudo: true },
    ];
    for (const scenario of cases) {
      const safeHtml = designHtmlPage.replaceHtmlPageElement(baseline, targetRef, scenario.replacement, scenario.css);
      expect(safeHtml, scenario.name).not.toBeNull();
      await routeDesignWorkbench(page, { extraProjects: [{ ...project, prototype: [{ id: 'html-0', type: 'html', props: { html: safeHtml } }, project.prototype[1]] }] });
      await page.reload();
      await page.getByTestId('design-detail-view-single').click();
      const target = frame(page).getByRole('button', { name: '修改按钮' });
      const sibling = frame(page).getByRole('button', { name: '保留的按钮' });
      await expect(target).toBeVisible();
      expect(await target.evaluate(el => getComputedStyle(el).color), scenario.name).toBe(scenario.color);
      expect(await sibling.evaluate(el => getComputedStyle(el).color), scenario.name).toBe('rgb(48, 77, 67)');
      expect(await target.evaluate(el => getComputedStyle(el, '::before').content), scenario.name).toBe(scenario.pseudo ? '"changed"' : 'none');
      expect(await sibling.evaluate(el => getComputedStyle(el, '::before').content), scenario.name).toBe('none');
    }

});

test('HTML structure response invalidates selected ref before next message', async ({ page }) => {
  await open(page);
  await frame(page).getByRole('heading', { name: '情绪日记' }).click();
  await expect(page.getByTestId('design-detail-focus')).toBeVisible();
  const posted: Record<string, unknown>[] = [];
  const newHtml = designHtmlPage.sanitizeHtmlPage('<main><p>新增在前的元素</p><h1>今天过得怎么样</h1><p>记录一点今天的心情</p></main>').html;
  const changed = { ...project, tokens: { brand: null, font: 'sans', radius: 'default', density: 'default' }, prototype: [{ id: 'html-0', type: 'html', props: { html: newHtml } }, project.prototype[1]] };
  await page.route(url => /\/pm-designs\/eval-HTML\/chat$/.test(new URL(url).pathname), async route => {
    posted.push(route.request().postDataJSON());
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ project: changed, reply: { source: 'model', applied: ['prototype'], suggestions: [] } }) });
  });
  await page.getByTestId('design-detail-input').fill('在标题前增加正文');
  await page.getByTestId('design-detail-send').click();
  await expect(frame(page).getByRole('heading', { name: '今天过得怎么样' })).toBeVisible();
  await expect(page.getByTestId('design-detail-focus-label')).toHaveText('整页版面');
  await page.getByTestId('design-detail-input').fill('接下来改整体');
  await page.getByTestId('design-detail-send').click();
  await expect.poll(() => posted.length).toBe(2);
  expect(posted[0]?.focusRef).toMatch(/^r\d+$/);
  expect(posted[1]?.focusRef).toBeUndefined();
});
