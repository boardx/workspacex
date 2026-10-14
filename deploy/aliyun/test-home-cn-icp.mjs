// Run from the repository root. Fails (does not skip) if Playwright is absent.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = resolve(import.meta.dirname, '../..');
const modulePath = process.env.PLAYWRIGHT_MODULE;
const { chromium } = modulePath ? await import(pathToFileURL(modulePath))
  : await import('../../apps/home/node_modules/playwright/index.mjs');
const temporary = mkdtempSync(join(tmpdir(), 'home-cn-icp-'));
const us = join(temporary, 'us'), cn = join(temporary, 'cn');
const output = resolve(process.env.ICP_EVIDENCE_DIR || join(temporary, 'screenshots'));
mkdirSync(output, { recursive: true });
function fingerprint(directory) {
  return readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter(item => item.isFile()).map(item => {
      const filename = join(item.parentPath, item.name);
      return [filename.slice(directory.length), createHash('sha256').update(readFileSync(filename)).digest('hex')];
    }).sort((a, b) => a[0].localeCompare(b[0]));
}
execFileSync(process.execPath, ['apps/home/scripts/package-pages.mjs', us], { cwd: root });
const before = fingerprint(us);
execFileSync('python3', ['deploy/aliyun/home_cn_language_package.py', us, cn], { cwd: root });
assert.deepEqual(fingerprint(us), before, 'CN packaging must preserve US bytes');
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const region = url.pathname.startsWith('/us/') ? 'us' : 'cn';
  let path = url.pathname.replace(/^\/us/, '');
  if (path.endsWith('/')) path += 'index.html';
  if (!extname(path)) path += '.html';
  const filename = resolve(region === 'us' ? us : cn, '.' + path);
  try {
    assert.ok(filename.startsWith((region === 'us' ? us : cn) + '/'));
    response.setHeader('Content-Type', ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' })[extname(path)] || 'application/octet-stream');
    response.end(readFileSync(filename));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}) });
let checks = 0;
try {
  for (const javaScriptEnabled of [true, false]) {
    for (const width of [320, 390, 768, 1440]) {
      const context = await browser.newContext({ javaScriptEnabled, viewport: { width, height: 900 } });
      const page = await context.newPage();
      for (const path of ['/', '/en/', '/zh/', '/privacy', '/en/privacy', '/zh/privacy', '/manual/', '/404.html']) {
        await page.goto(base + path);
        const link = page.locator('[data-cn-icp] a');
        assert.equal(await link.count(), 1);
        assert.equal(await link.textContent(), '粤ICP备2021115740号');
        assert.equal(await link.getAttribute('href'), 'https://beian.miit.gov.cn/');
        await link.scrollIntoViewIfNeeded();
        assert.ok(await link.isVisible(), `${path} ${width} JS=${javaScriptEnabled}`);
        const box = await link.boundingBox();
        assert.ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= width + 1, 'visible mobile touch target');
        const overflow = await page.evaluate(() => {
          const footer = document.querySelector('[data-cn-icp]');
          const parent = footer.parentNode, next = footer.nextSibling;
          const current = document.documentElement.scrollWidth;
          footer.remove();
          const baseline = document.documentElement.scrollWidth;
          parent.insertBefore(footer, next);
          return { current, baseline };
        });
        assert.ok(overflow.current <= Math.max(width, overflow.baseline), `ICP adds no overflow: ${path} width=${width} JS=${javaScriptEnabled}`);
        if (width === 390 && path === '/' && !javaScriptEnabled) {
          await page.locator('footer').screenshot({ path: join(output, 'cn-mobile-no-js-footer.png') });
        }
        checks++;
      }
      for (const path of ['/', '/zh/', '/privacy', '/zh/privacy', '/manual/', '/404.html']) {
        await page.goto(base + '/us' + path);
        assert.equal(await page.locator('[data-cn-icp]').count(), 0);
        assert.ok(!(await page.content()).includes('粤ICP备2021115740号'), 'no ICP on US even Chinese language');
        checks++;
      }
      await context.close();
    }
  }
  assert.deepEqual(fingerprint(us), before);
  console.log(`PASS ${checks} CN/US browser checks, 4 widths, JS on/off; US bytes unchanged`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  rmSync(temporary, { recursive: true, force: true });
}
