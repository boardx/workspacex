import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve, launcher, launchOptions, ROOT } from './harness.mjs';
const chromium = await launcher();
if (!chromium) { console.log('… manual browser checks skipped — playwright is not installed'); process.exit(0); }
const axe = readFileSync(join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8');
const { base, close } = await serve();
const browser = await chromium.launch(launchOptions());
const page = await browser.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
const output = join(ROOT, 'test-results/manual');
mkdirSync(output, { recursive: true });
try {
  await page.route('**/__manual-axe.js', route => route.fulfill({ contentType: 'text/javascript', body: axe }));
  for (const width of [390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(base + '/manual/');
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.locator('article section').count(), 14);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.addScriptTag({ url: '/__manual-axe.js' });
    const violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] } })).violations.map(v => v.id));
    assert.deepEqual(violations, []);
    await page.locator('.toc a[href="#approval"]').click();
    assert.equal(new URL(page.url()).hash, '#approval');
    await page.evaluate(() => { window.__manualPrinted = false; window.print = () => { window.__manualPrinted = true; }; });
    await page.locator('[data-print]').click();
    assert.ok(await page.evaluate(() => window.__manualPrinted));
    await page.goto(base + '/manual/');
    await page.screenshot({ path: join(output, `manual-${width}.png`), fullPage: true });
  }
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.toc').isVisible(), false);
  assert.equal(await page.locator('header').isVisible(), false);
  assert.equal(await page.locator('.print-toc').isVisible(), true);
  await page.pdf({ path: join(output, 'manual.pdf'), format: 'A4', preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  for (const route of ['/', '/zh/']) {
    await page.goto(base + route);
    assert.equal(await page.locator('a[href="/manual/"]').count(), 1);
  }
  const noJs = await browser.newContext({ javaScriptEnabled: false });
  const fallback = await noJs.newPage();
  await fallback.goto(base + '/manual/');
  assert.equal(await fallback.locator('article section').count(), 14);
  assert.ok(await fallback.locator('noscript').isVisible());
  await noJs.close();
  assert.deepEqual(errors, []);
  console.log('✓ manual: three widths, WCAG, anchors, print, both homepage entries, no-JS');
} finally { await browser.close(); close(); }
