#!/usr/bin/env node
/**
 * Real login, API, PGlite, browser and configured provider acceptance.
 * No routes are mocked. A synthetic emotion-journal brief is sent to the real model.
 * --project reuses a generated project to check selection/edit/persistence/export.
 * Run: node scripts/local-session/design-html-session.mjs
 * --data-dir /private/tmp/wsx-html-data --base http://127.0.0.1:3192
 * --api http://127.0.0.1:3292 --out evidence/design-html-20261001/fullstack
 * Requires the separately running stack and explicit real-provider authorization.
 */
import { createRequire } from 'node:module';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index < 0 ? fallback : process.argv[index + 1];
};
const base = arg('base', 'http://127.0.0.1:3192');
const api = arg('api', 'http://127.0.0.1:3292');
const data = arg('data-dir', '/private/tmp/wsx-html-data');
const out = resolve(arg('out', join(root, 'evidence/design-html-20261001/fullstack')));
mkdirSync(out, { recursive: true });
const { chromium } = createRequire(join(root, 'apps/web/package.json'))('playwright-core');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, locale: 'zh-CN', timezoneId: 'Asia/Shanghai' });
page.setDefaultTimeout(120000);
const exportOnly = process.argv.includes('--export-only');
const results = exportOnly ? JSON.parse(readFileSync(join(out, 'results.json'), 'utf8')).results.filter(result => !result.name.includes('HTML 下载') && !result.name.includes('预览模式') && !result.name.includes('修复后真实浏览器重新登录') && !result.name.includes('375px')) : [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log('PASS', name);
  } catch (error) {
    results.push({ name, ok: false, detail: error.message });
    console.log('FAIL', name, error.message);
    await page.screenshot({ path: join(out, `failure-${results.length}.png`), fullPage: true }).catch(() => {});
  }
}
await check(exportOnly ? '修复后真实浏览器重新登录' : '真实浏览器登录', async () => {
  await page.goto(`${base}/login?next=%2Fstudio%2Fdesign-workbench`);
  await page.getByTestId('login-email').fill('me@local.workspacex');
  await page.getByTestId('login-password').fill(JSON.parse(readFileSync(join(data, 'secrets.json'), 'utf8')).adminPassword);
  await page.getByTestId('login-submit').click();
  await page.waitForURL(url => !url.pathname.startsWith('/login'));
});
const token = await page.evaluate(() => localStorage.getItem('wsx.sessionToken'));
async function request(path, body) {
  const response = await fetch(`${api}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json();
  if (!response.ok) throw Error(`${response.status} ${JSON.stringify(result)}`);
  return result;
}
let project;
const existing = arg('project', null);
if (existing) {
  project = (await request('/pm-designs')).items.find(item => item.id === existing);
  if (!project) throw Error('Project not found');
} else {
  await check('真实 API 新建与 DashScope 生成 HTML 两页', async () => {
    project = (await request('/pm-designs', {
      name: '情绪日记·真实模型验收', template: 'mobile', problem: '情绪日记移动应用：首页与写日记两页',
    })).project;
    const response = await request(`/pm-designs/${project.id}/chat`, {
      text: '请设计一个情绪日记移动端应用，两页：首页展示今天的心情及近期日记，第二页写日记。使用温暖米白、苔绿配色，克制自然的留白。只画两页。',
      maxScreens: 2,
    });
    writeFileSync(join(out, 'real-model-result.json'), JSON.stringify(response, null, 2));
    project = response.project;
    if (project.prototype.length !== 2 || project.prototype.some(node => node.type !== 'html')) throw Error('Real model did not generate two HTML pages');
  });
}
if (!exportOnly) {
let selectedRef, oldTitle;
await check('浏览器显示 HTML 并选择标题元素', async () => {
  await page.goto(`${base}/studio/design-workbench/${project.id}`);
  await page.getByTestId('design-detail').waitFor();
  await page.getByTestId('design-detail-view-single').click();
  const title = page.frameLocator('[data-testid="design-html-page"]').locator(arg('select-ref', null) ? `[data-ref="${arg('select-ref', null)}"]` : 'h1,h2,[class*=title]').first();
  oldTitle = await title.innerText();
  selectedRef = await title.getAttribute('data-ref');
  await title.click();
  await page.getByTestId('design-detail-focus-label').waitFor();
  await page.screenshot({ path: join(out, '01-selected.png'), fullPage: true });
  if (!selectedRef) throw Error('Selected heading has no data-ref');
});
await check('真实模型只改选中标题、刷新后持久化', async () => {
  const originalHtml = project.prototype[0].props.html;
  writeFileSync(join(out, 'pre-edit-project.json'), JSON.stringify(project, null, 2));
  await page.getByTestId('design-detail-input').fill('只把选中的标题改成“记录此刻的心情”，保留其它布局内容');
  const [httpResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith(`/pm-designs/${project.id}/chat`) && response.request().method() === 'POST', { timeout: 180000 }),
    page.getByTestId('design-detail-send').click(),
  ]);
  const sent = httpResponse.request().postDataJSON();
  if (sent.focusRef !== selectedRef) throw Error('UI sent incorrect selection reference');
  const response = await httpResponse.json();
  if (response.reply.source !== 'model') throw Error('Real provider returned fallback');
  writeFileSync(join(out, 'real-model-edit-result.json'), JSON.stringify(response, null, 2));
  if (response.project.prototype[1].props.html !== project.prototype[1].props.html) throw Error('Unselected page changed');
  const maskSelection = html => html.replace(new RegExp(String.raw`<([a-z0-9]+)([^>]*data-ref="${selectedRef}"[^>]*)>[\s\S]*?</\1>`), '<selected-element/>');
  if (maskSelection(originalHtml) !== maskSelection(response.project.prototype[0].props.html)) throw Error('Unselected HTML changed');
  if (response.project.prototype[0].props.html === originalHtml) throw Error('Selected page did not change');
  await page.reload();
  await page.getByTestId('design-detail').waitFor();
  await page.getByTestId('design-detail-view-single').click();
  const editedTitle = page.frameLocator('[data-testid="design-html-page"]').locator(`[data-ref="${selectedRef}"]`);
  await editedTitle.waitFor();
  if ((await editedTitle.innerText()) !== '记录此刻的心情') throw Error('Selected title mismatch');
  await page.screenshot({ path: join(out, '02-persisted.png'), fullPage: true });
});
await check('浏览器撤销及刷新持久化', async () => {
  await page.getByTestId('design-detail-undo').click();
  await page.frameLocator('[data-testid="design-html-page"]').getByText(oldTitle, { exact: true }).waitFor();
  await page.reload();
  await page.getByTestId('design-detail-view-single').click();
  await page.frameLocator('[data-testid="design-html-page"]').getByText(oldTitle, { exact: true }).waitFor();
  await page.screenshot({ path: join(out, '03-undo-persisted.png'), fullPage: true });
});
} else {
  await page.goto(`${base}/studio/design-workbench/${project.id}`);
  await page.getByTestId('design-detail').waitFor();
  await page.getByTestId('design-detail-view-single').click();
  if (!project.frameLinks?.[0]?.length) throw Error('API frameLinks still absent');
  writeFileSync(join(out, 'post-fix-project.json'), JSON.stringify(project, null, 2));
  await page.screenshot({ path: join(out, '00-generated.png'), fullPage: true });
}
await check('真实预览模式页面跳转', async () => {
  await page.getByTestId('design-detail-mode-preview').click();
  await page.frameLocator('[data-testid="design-html-page"]').locator('[data-goto="1"]').first().click();
  await page.waitForFunction(() => document.querySelector('[data-testid="design-detail-frame-1"]')?.getAttribute('aria-pressed') === 'true');
  await page.screenshot({ path: join(out, '06-preview-navigation.png'), fullPage: true });
  await page.getByTestId('design-detail-frame-0').click();
  await page.getByTestId('design-detail-mode-edit').click();
});
await check('真实 HTML 下载与导出页面跳转', async () => {
  await page.getByTestId('design-detail-more').click();
  await page.getByTestId('design-detail-export').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('design-detail-export-html').click()]);
  const path = join(out, 'prototype.html');
  await download.saveAs(path);
  const exported = await browser.newPage({ viewport: { width: 1000, height: 900 } });
  await exported.goto(`file://${path}`);
  await exported.screenshot({ path: join(out, '04-exported.png'), fullPage: true });
  const link = exported.frameLocator('iframe').first().locator('[data-goto]').first();
  if (await link.count()) {
    await link.click();
    await exported.waitForFunction(() => document.querySelectorAll('section')[1]?.hidden === false);
    await exported.screenshot({ path: join(out, '05-export-navigation.png'), fullPage: true });
  } else throw Error('No export navigation target');
  await exported.close();
});
await check('真实项目375px手机无水平溢出', async () => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload();
  await page.getByTestId('design-detail').waitFor();
  await page.getByTestId('design-detail-view-single').click();
  await page.frameLocator('[data-testid="design-html-page"]').locator('[data-ref]').first().waitFor();
  const frame = page.frames().find(frame => frame !== page.mainFrame());
  const metrics = await frame.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  const outer = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  writeFileSync(join(out, 'mobile-metrics.json'), JSON.stringify({ iframe: metrics, outer }, null, 2));
  await page.screenshot({ path: join(out, '07-mobile-375.png'), fullPage: true });
  if (metrics.scrollWidth > metrics.clientWidth + 1 || outer.scrollWidth > outer.clientWidth + 1) throw Error('Horizontal overflow');
});
writeFileSync(join(out, 'results.json'), JSON.stringify({ model: 'real configured DashScope', url: `${base}/studio/design-workbench/${project?.id}`, results }, null, 2));
writeFileSync(join(out, 'report.md'), `# 真栈与真实模型验收\n\n测试项目：${base}/studio/design-workbench/${project?.id}\n\n模型：已配置 DashScope，虚构情绪日记需求。无 route mock、无固定回复。\n\n${results.map(result => `- ${result.ok ? '通过' : '失败'}：${result.name}${result.detail ? `（${result.detail}）` : ''}`).join('\n')}\n`);
await browser.close();
process.exit(results.every(result => result.ok) ? 0 : 1);
