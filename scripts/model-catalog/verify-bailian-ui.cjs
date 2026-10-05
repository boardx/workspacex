/** Real component browser evidence. No app server, DB, login, inference, or installation. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');

const repository = path.resolve(__dirname, '../..');
const web = path.join(repository, 'apps/web');
const fromWeb = createRequire(path.join(web, 'package.json'));
const fromVitest = createRequire(fromWeb.resolve('vitest/package.json'));
const fromVite = createRequire(fromVitest.resolve('vite'));
const esbuild = fromVite('esbuild');
const { chromium } = fromWeb('playwright-core');
const fromAxe = createRequire(fromWeb.resolve('@axe-core/playwright'));
const output = process.argv[2] ? path.resolve(process.argv[2]) : fs.mkdtempSync(path.join(os.tmpdir(), 'wsx-bailian-ui-'));
fs.mkdirSync(output, { recursive: true });

const entry = path.join(output, 'entry.tsx');
fs.writeFileSync(entry, `
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { BailianModelCatalog } from ${JSON.stringify(path.join(web, 'components/admin/bailian-model-catalog'))};
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-7xl p-4"><p className="mb-4 text-sm text-muted-foreground">组件验收环境：真实公共目录组件与 JSON；未登录组织后台，未调用模型。</p><BailianModelCatalog onViewOrganizationModels={() => { document.getElementById('notice')!.textContent='已触发回组织模型池动作（组件验收环境）'; }}/><p id="notice" /></main>);
`);
esbuild.buildSync({
  entryPoints: [entry], outfile: path.join(output, 'app.js'), bundle: true,
  platform: 'browser', jsx: 'automatic', alias: { '@': web },
  nodePaths: [path.join(web, 'node_modules'), path.join(repository, 'node_modules')],
  define: { 'process.env': '{}', 'process.env.NODE_ENV': '"production"' }, minify: true,
});
const css = spawnSync(path.join(web, 'node_modules/.bin/tailwindcss'), [
  '-c', 'tailwind.config.ts', '-i', 'app/globals.css', '-o', path.join(output, 'style.css'),
  '--content', `./components/admin/bailian-model-catalog.tsx,./components/admin/panel.tsx,./components/ui/*.tsx,${entry}`,
], { cwd: web, encoding: 'utf8' });
fs.writeFileSync(path.join(output, 'css.log'), css.stdout + css.stderr);
if (css.status !== 0) throw new Error('Component CSS verification failed');
fs.writeFileSync(path.join(output, 'index.html'), '<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>百炼目录组件验收</title><link rel="stylesheet" href="style.css"></head><body><div id="root"></div><script src="app.js"></script></body></html>');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const checks = [];
    for (const width of [375, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(pathToFileURL(path.join(output, 'index.html')).href);
      await page.getByTestId('bailian-model-qwen3.8-max').waitFor();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
      const cards = await page.getByTestId('bailian-model-list').locator(':scope > *').count();
      await page.addScriptTag({ path: fromAxe.resolve('axe-core/axe.min.js') });
      const accessibilityViolations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } })).violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.length })));
      if (overflow || cards !== 12 || accessibilityViolations.length) throw new Error(`Directory verification failed at ${width}: ${JSON.stringify({ overflow, cards, accessibilityViolations })}`);
      await page.screenshot({ path: path.join(output, `catalog-${width}.png`), fullPage: true });
      await page.getByTestId('bailian-model-qwen3.8-max').click();
      await page.getByTestId('bailian-model-detail').waitFor();
      const drawerOverflow = await page.getByTestId('bailian-model-detail').evaluate((element) => element.scrollWidth > element.clientWidth);
      if (drawerOverflow) throw new Error(`Drawer overflow at ${width}`);
      checks.push({ width, overflow, cards, accessibilityViolations, drawerOverflow });
      await page.keyboard.press('Escape');
    }
    await page.getByTestId('bailian-model-qwen3.8-max').click();
    await page.getByTestId('bailian-model-detail').waitFor();
    await page.screenshot({ path: path.join(output, 'detail-1280.png'), fullPage: true });
    await page.getByTestId('bailian-model-detail-close').click();
    await page.getByTestId('bailian-search').fill('MiniMax/speech-2.8-hd');
    await page.getByTestId('bailian-model-MiniMax/speech-2.8-hd').waitFor();
    await page.screenshot({ path: path.join(output, 'search-1280.png'), fullPage: true });
    if (pageErrors.length) throw new Error(pageErrors.join('\n'));
    const result = { scope: 'real-component-public-catalog-fixture-not-authenticated-org-e2e', checks, pageErrors };
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ output, ...result }));
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
