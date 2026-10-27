// Component browser check with explicit ledger API fixtures; does not claim live backend evidence.
const { createRequire } = require('node:module');
const { join, resolve } = require('node:path');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const root = resolve(__dirname, '../../..');
const web = join(root, 'apps/web');
const req = createRequire(join(web, 'package.json'));
const { chromium } = req('@playwright/test');
const { build } = createRequire(createRequire(req.resolve('vitest')).resolve('vite'))('esbuild');
const output = mkdtempSync(join(tmpdir(), 'usage-browser-'));
const totals = { inputTokens: '18200', outputTokens: '4600', totalTokens: '22800', callCount: 3, failedCalls: 0, reportedCalls: 2, legacyCalls: 0, unknownCalls: 1, unknownInputCalls: 1, unknownOutputCalls: 1, nativeCalls: 0 };
const model = { modelProvider: '阿里云百炼', modelId: 'qwen3.8-max', totalTokens: '22800', callCount: 3 };
const summary = { asOf: '2026-10-27T05:00:00Z', start: '2026-10-20T16:00:00Z', end: '2026-10-27T16:00:00Z', timezone: 'Asia/Shanghai', coverage: 'partial', current: totals, previous: totals, nativeUnits: [], dispatchIntents: 3, unsettledDispatchIntents: 0, truncated: { members: false, models: false, matrix: false, projects: false }, trend: [], members: [], models: [model], matrix: [], projects: [] };
const base = { id: 'internal-call-id', userId: 'internal-user-id', runId: 'internal-run-id', projectId: null, threadId: null, agentId: null, modelProvider: model.modelProvider, modelId: model.modelId, occurredAt: '2026-10-27T04:47:13Z', startedAt: null, endedAt: null, executionAttemptId: null, totalTokens: '12400', inputTokens: '10000', outputTokens: '2400', totalSource: 'reported', outcome: 'succeeded', callPurpose: null, costMicros: '24800', currency: 'CNY', priceVersion: null };
const calls = { asOf: summary.asOf, coverage: 'partial', nextCursor: null, calls: [base, { ...base, id: 'internal-call-id-2', occurredAt: '2026-10-27T03:46:32Z', totalTokens: '0', inputTokens: null, outputTokens: null, totalSource: 'unknown', costMicros: null, currency: null }, { ...base, id: 'internal-call-id-3', occurredAt: '2026-10-26T08:17:35Z', totalTokens: '10400', inputTokens: '8200', outputTokens: '2200', costMicros: '20800' }] };
(async () => {
  let server, browser;
  try {
    execFileSync('pnpm', ['exec', 'tailwindcss', '-i', 'app/globals.css', '-o', join(output, 'style.css'), '--minify'], { cwd: web, stdio: 'pipe' });
    await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import{AiUsagePanel}from'./components/admin/ai-usage-panel';createRoot(document.getElementById('root')).render(<main className="mx-auto max-w-6xl p-6"><h1 className="text-20 font-semibold">我的 AI 用量</h1><p className="mt-2 text-13 text-muted-foreground">查看我在当前组织使用的模型、调用记录和消耗量。</p><AiUsagePanel orgId="fixture-org" selfUserId="internal-user-id"/></main>);`, resolveDir: web, loader: 'tsx' }, bundle: true, outfile: join(output, 'app.js'), platform: 'browser', jsx: 'automatic', alias: { '@': web }, define: { 'process.env': JSON.stringify({ NEXT_PUBLIC_API_URL: 'http://localhost:3200', NODE_ENV: 'development' }), 'process.env.NEXT_PUBLIC_API_URL': JSON.stringify('http://localhost:3200'), 'process.env.NODE_ENV': JSON.stringify('development') } });
    server = http.createServer((request, response) => {
      if (request.url === '/app.js' || request.url === '/style.css') {
        response.setHeader('content-type', request.url.endsWith('js') ? 'application/javascript' : 'text/css');
        response.end(readFileSync(join(output, request.url.slice(1))));
      } else { response.setHeader('content-type', 'text/html'); response.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><div id="root"></div><script src="/app.js"></script></html>'); }
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('console', message => { if (message.type() === 'error') console.error('Console:', message.text()); });
    page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
    await page.route('http://localhost:3200/**', route => route.fulfill({ headers: { 'access-control-allow-origin': `http://127.0.0.1:${server.address().port}`, 'access-control-allow-credentials': 'true' }, json: route.request().url().includes('/ai-usage/calls') ? calls : summary }));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.getByText('12:47:13').waitFor({ timeout: 10000 }).catch(async error => { console.error(await page.locator('body').innerText()); throw error; });
    assert.equal(await page.getByText('internal-call-id', { exact: true }).count(), 0);
    assert.equal(await page.getByText('internal-user-id', { exact: true }).count(), 0);
    assert.equal(await page.getByText('2026年10月27日', { exact: true }).count(), 1);
    await page.screenshot({ path: join(__dirname, 'desktop.png'), fullPage: true });
    await page.getByText('计量详情').first().click();
    await page.getByText('缓存输入：未上报').first().waitFor({ state: 'visible' });
    await page.getByRole('tab', { name: '按模型汇总' }).click();
    await page.getByRole('button', { name: '查看 qwen3.8-max 的调用' }).click();
    await page.getByRole('button', { name: '自定义日期', exact: true }).click();
    await page.getByLabel('开始日期').fill('2026-10-20');
    await page.getByLabel('结束日期').fill('2026-10-27');
    await page.getByRole('button', { name: '应用日期' }).click();
    await page.getByText('12:47:13').waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'page must not overflow horizontally');
    await page.screenshot({ path: join(__dirname, 'mobile.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.screenshot({ path: join(__dirname, 'dark.png'), fullPage: true });
    assert.deepEqual(errors, []);
    console.log('PASS: desktop/mobile/dark rendering, details, model drilldown, date controls, no page overflow, no internal IDs, no browser runtime errors (fixture API).');
  } finally {
    await browser?.close();
    if (server) await new Promise(done => server.close(done));
    rmSync(output, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
