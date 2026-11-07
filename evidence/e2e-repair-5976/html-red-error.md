# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: design-html.spec.ts >> HTML selection focusRef clear and preview navigation
- Location: e2e/design-html.spec.ts:14:5

# Error details

```
Error: expect(locator).toContainText(expected) failed

Locator: getByTestId('design-detail-focus')
Expected substring: "情绪日记"
Timeout: 5000ms
Error: element(s) not found

Call log:
  - Expect "toContainText" with timeout 5000ms
  - waiting for getByTestId('design-detail-focus')

```

```yaml
- banner:
  - button "工作台"
  - text: 工作台 / 情绪日记
  - button "分享"
- text: 说需求，AI 画界面
- region "你的需求":
  - paragraph: 你的需求（新建时说的，AI 每一轮都照着它画）
  - paragraph: 客服团队要一个像 ChatGPT 的内部对话助手：会话列表、消息流、输入区、发送/停止、空态与加载态。
- text: 把你想解决的问题说清楚，我会顺着它更新右边的原型画布和验收标准。可以先从「谁在什么场景下会用到」讲起。
- button "照着一张图画"
- text: 拖进来 / 粘贴截图也行
- textbox "告诉我要改什么，我来更新画布（回车发送，Shift+Enter 换行）"
- button "发送" [disabled]
- button "首页" [pressed]
- button "写日记"
- group "设备预览":
  - text: 设备
  - combobox "设备尺寸":
    - option "iPhone SE 375×667"
    - option "iPhone 15 393×852" [selected]
    - option "iPad 820×1180"
    - option "笔记本 1280×800"
    - option "桌面 1440×900"
    - option "幻灯片 16:9 1280×720"
  - button "旋转设备"
- group "画布视图":
  - button "画板"
  - button "单页" [pressed]
- button "预览"
- button "撤销"
- button "历史"
- button "更多"
- iframe
- paragraph: 点画布上的任意一处，这里会出现能改的地方。也可以直接在左边说你想怎么改。
- contentinfo: 移动端设计 2 页 · 已画出 2 页 苏木 · PM · 更新于 9/6 10:00
- alert
```

# Test source

```ts
  1   | /** Routed browser fixtures prove frontend behavior, not real model/API persistence. */
  2   | import { mkdirSync } from 'node:fs';
  3   | import { resolve } from 'node:path';
  4   | import { test, expect, type Page } from '@playwright/test';
  5   | import { designHtmlPage } from '@repo/contracts';
  6   | import { DESIGN_PROJECTS, routeDrafts, routeInbox, routeDesignWorkbench } from '../scripts/lib/design-loop-fixtures.mjs';
  7   | import { clickMore } from './support/design-more';
  8   | test.use({ launchOptions: process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {}, acceptDownloads: true });
  9   | const evidence = resolve(process.cwd(), '../../evidence/design-html-20261001');
  10  | const pages = ['情绪日记', '写日记'].map((title, i) => designHtmlPage.sanitizeHtmlPage(`<style>body{margin:0;padding:24px;background:#f9f3e9;color:#304d43;font-family:serif}h1{font-size:32px}button{padding:16px;background:#304d43;color:white;border:0;border-radius:18px}</style><main><h1>${title}</h1><p>记录一点今天的心情</p><button data-goto="${1 - i}">写下心情</button></main>`).html);
  11  | const project = { ...DESIGN_PROJECTS[2], id: 'eval-HTML', name: '情绪日记', frames: ['首页', '写日记'], frameNotes: ['', ''], chat: [], prototype: pages.map((html, i) => ({ id: `html-${i}`, type: 'html', props: { html } })), frameLinks: pages.map(html => designHtmlPage.htmlPageLinks(html)) };
  12  | async function open(page: Page) { mkdirSync(evidence, { recursive: true }); await routeDrafts(page, { empty: false }); await routeInbox(page, { empty: false }); await routeDesignWorkbench(page, { extraProjects: [project] }); await page.goto('/preview/feedback-design-loop?scene=detail-eval&case=HTML'); await page.getByTestId('design-detail').waitFor(); await page.getByTestId('design-detail-view-single').click(); }
  13  | const frame = (page: Page) => page.frameLocator('[data-testid="design-html-page"]');
  14  | test('HTML selection focusRef clear and preview navigation', async ({ page }) => {
  15  |     await open(page);
  16  |     await expect(frame(page).getByRole('heading', { name: '情绪日记' })).toBeVisible();
  17  |     await page.screenshot({ path: resolve(evidence, 'html-browser-initial.png'), fullPage: true });
  18  |     await frame(page).getByRole('heading', { name: '情绪日记' }).click();
> 19  |     await expect(page.getByTestId('design-detail-focus')).toContainText('情绪日记');
      |                                                           ^ Error: expect(locator).toContainText(expected) failed
  20  |     await page.screenshot({ path: resolve(evidence, 'html-browser-selected.png'), fullPage: true });
  21  |     const posted: Record<string, unknown>[] = [];
  22  |     await page.route(url => /\/pm-designs\/eval-HTML\/chat$/.test(new URL(url).pathname), async (route) => { posted.push(route.request().postDataJSON()); await route.fallback(); });
  23  |     await page.getByTestId('design-detail-input').fill('改成今天过得怎么样');
  24  |     await page.getByTestId('design-detail-send').click();
  25  |     await expect.poll(() => posted.length).toBe(1);
  26  |     expect(posted[0]).toMatchObject({ focusNodeId: 'html-0', focusRef: expect.stringMatching(/^r\d+$/) });
  27  |     await expect(page.getByTestId('design-detail-generating')).toHaveCount(0);
  28  |     await page.getByTestId('design-detail-focus-clear').click();
  29  |     await page.getByTestId('design-detail-input').fill('保留版式');
  30  |     await page.getByTestId('design-detail-send').click();
  31  |     await expect.poll(() => posted.length).toBe(2);
  32  |     expect(posted[1]?.focusRef).toBeUndefined();
  33  |     await expect(page.getByTestId('design-detail-generating')).toHaveCount(0);
  34  |     await page.getByTestId('design-detail-mode-preview').click();
  35  |     await frame(page).getByRole('button', { name: '写下心情' }).click();
  36  |     await expect(frame(page).getByRole('heading', { name: '写日记' })).toBeVisible();
  37  |     await expect(page.getByTestId('design-detail-focus')).toHaveCount(0);
  38  |     await page.screenshot({ path: resolve(evidence, 'html-browser-preview-navigation.png'), fullPage: true });
  39  | });
  40  | test('offline HTML export iframe navigation', async ({ page, context }) => { await open(page); await clickMore(page, 'design-detail-export'); const pending = page.waitForEvent('download'); await page.getByTestId('design-detail-export-html').click(); const path = resolve(evidence, 'emotional-diary-offline.html'); await (await pending).saveAs(path); const offline = await context.newPage(); await offline.goto(`file://${path}`); const home = offline.locator('.wx-page').nth(0); const write = offline.locator('.wx-page').nth(1); await expect(home).toBeVisible();
  41  |     await offline.evaluate(() => window.dispatchEvent(new MessageEvent('message', { source: window, data: { source: 'wsx-html-page', type: 'goto', id: 'goto-1-0' } })));
  42  |     await expect(home).toBeVisible();
  43  |     await home.locator('iframe').evaluate((el) => {
  44  |       window.dispatchEvent(new MessageEvent('message', { source: (el as HTMLIFrameElement).contentWindow, data: { source: 'wsx-html-page', type: 'goto', id: 'nonexistent-link' } }));
  45  |     });
  46  |     await expect(home).toBeVisible();
  47  |     await home.frameLocator('iframe').getByRole('button', { name: '写下心情' }).click(); await expect(write).toBeVisible(); await expect(home).toBeHidden(); await offline.screenshot({ path: resolve(evidence, 'html-browser-offline-navigation.png'), fullPage: true }); });
  48  | test('375px no page horizontal overflow', async ({ page }) => { await page.setViewportSize({ width: 375, height: 812 }); await open(page); await expect(frame(page).getByRole('heading', { name: '情绪日记' })).toBeVisible(); expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true); await page.screenshot({ path: resolve(evidence, 'html-browser-mobile-375.png'), fullPage: true }); });
  49  | test('local CSS replacement changes only selected same-class element', async ({ page }) => {
  50  |     const original = designHtmlPage.sanitizeHtmlPage('<style>.action{background:#304d43;color:white}</style><main><button class="action">选中的按钮</button><button class="action">保留的按钮</button></main>').html;
  51  |     const ref = original.match(/<button[^>]*data-ref="([^"]+)"/)?.[1];
  52  |     expect(ref).toBeTruthy();
  53  |     const changed = designHtmlPage.replaceHtmlPageElement(original, ref!, '<button class="action">今天过得怎么样</button>', '.action{background:#ff0000}');
  54  |     expect(changed).not.toBeNull();
  55  |     await routeDrafts(page, { empty: false });
  56  |     await routeInbox(page, { empty: false });
  57  |     await routeDesignWorkbench(page, { extraProjects: [{ ...project, prototype: [{ id: 'html-0', type: 'html', props: { html: changed } }, project.prototype[1]] }] });
  58  |     await page.goto('/preview/feedback-design-loop?scene=detail-eval&case=HTML');
  59  |     await page.getByTestId('design-detail-view-single').click();
  60  |     const selected = frame(page).getByRole('button', { name: '今天过得怎么样' });
  61  |     const untouched = frame(page).getByRole('button', { name: '保留的按钮' });
  62  |     await expect(selected).toBeVisible();
  63  |     expect(await selected.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(255, 0, 0)');
  64  |     expect(await untouched.evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgb(48, 77, 67)');
  65  |     await page.screenshot({ path: resolve(evidence, 'html-browser-local-edit.png'), fullPage: true });
  66  |     const baseline = designHtmlPage.sanitizeHtmlPage('<style>.btn{color:#304d43}</style><main><button class="btn">选中的按钮</button><button class="btn">保留的按钮</button></main>').html;
  67  |     const targetRef = baseline.match(/<button[^>]*data-ref="([^"]+)"/)![1]!;
  68  |     const cases = [
  69  |       { name: 'unbalanced selector', css: '.btn), .btn, :is(.btn{color:red}', replacement: '<button class="btn">修改按钮</button>', color: 'rgb(48, 77, 67)', pseudo: false },
  70  |       { name: 'escaped selector', css: String.raw`.btn\), .btn, :is(.btn{color:red}`, replacement: '<button class="btn">修改按钮</button>', color: 'rgb(48, 77, 67)', pseudo: false },
  71  |       { name: 'whitespace style closing', css: '', replacement: '<style>.btn{color:red}</style ><button class="btn">修改按钮</button>', color: 'rgb(255, 0, 0)', pseudo: false },
  72  |       { name: 'scoped pseudo element', css: ".btn::before{content:'changed';color:red}", replacement: '<button class="btn">修改按钮</button>', color: 'rgb(48, 77, 67)', pseudo: true },
  73  |     ];
  74  |     for (const scenario of cases) {
  75  |       const safeHtml = designHtmlPage.replaceHtmlPageElement(baseline, targetRef, scenario.replacement, scenario.css);
  76  |       expect(safeHtml, scenario.name).not.toBeNull();
  77  |       await routeDesignWorkbench(page, { extraProjects: [{ ...project, prototype: [{ id: 'html-0', type: 'html', props: { html: safeHtml } }, project.prototype[1]] }] });
  78  |       await page.reload();
  79  |       await page.getByTestId('design-detail-view-single').click();
  80  |       const target = frame(page).getByRole('button', { name: '修改按钮' });
  81  |       const sibling = frame(page).getByRole('button', { name: '保留的按钮' });
  82  |       await expect(target).toBeVisible();
  83  |       expect(await target.evaluate(el => getComputedStyle(el).color), scenario.name).toBe(scenario.color);
  84  |       expect(await sibling.evaluate(el => getComputedStyle(el).color), scenario.name).toBe('rgb(48, 77, 67)');
  85  |       expect(await target.evaluate(el => getComputedStyle(el, '::before').content), scenario.name).toBe(scenario.pseudo ? '"changed"' : 'none');
  86  |       expect(await sibling.evaluate(el => getComputedStyle(el, '::before').content), scenario.name).toBe('none');
  87  |     }
  88  | 
  89  | });
  90  | 
  91  | test('HTML structure response invalidates selected ref before next message', async ({ page }) => {
  92  |   await open(page);
  93  |   await frame(page).getByRole('heading', { name: '情绪日记' }).click();
  94  |   await expect(page.getByTestId('design-detail-focus')).toBeVisible();
  95  |   const posted: Record<string, unknown>[] = [];
  96  |   const newHtml = designHtmlPage.sanitizeHtmlPage('<main><p>新增在前的元素</p><h1>今天过得怎么样</h1><p>记录一点今天的心情</p></main>').html;
  97  |   const changed = { ...project, tokens: { brand: null, font: 'sans', radius: 'default', density: 'default' }, prototype: [{ id: 'html-0', type: 'html', props: { html: newHtml } }, project.prototype[1]] };
  98  |   await page.route(url => /\/pm-designs\/eval-HTML\/chat$/.test(new URL(url).pathname), async route => {
  99  |     posted.push(route.request().postDataJSON());
  100 |     await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ project: changed, reply: { source: 'model', applied: ['prototype'], suggestions: [] } }) });
  101 |   });
  102 |   await page.getByTestId('design-detail-input').fill('在标题前增加正文');
  103 |   await page.getByTestId('design-detail-send').click();
  104 |   await expect(frame(page).getByRole('heading', { name: '今天过得怎么样' })).toBeVisible();
  105 |   await expect(page.getByTestId('design-detail-focus-label')).toHaveText('整页版面');
  106 |   await page.getByTestId('design-detail-input').fill('接下来改整体');
  107 |   await page.getByTestId('design-detail-send').click();
  108 |   await expect.poll(() => posted.length).toBe(2);
  109 |   expect(posted[0]?.focusRef).toMatch(/^r\d+$/);
  110 |   expect(posted[1]?.focusRef).toBeUndefined();
  111 | });
  112 | 
```