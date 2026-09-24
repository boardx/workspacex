#!/usr/bin/env node
/**
 * webkit.test.mjs — the page in Safari's engine.
 *
 * Every other browser suite runs in Chromium, and most of this site's Chinese
 * readers on a phone are on iOS, where every browser is WebKit. Things that
 * have differed between the two on this page: `text-wrap`, `color-mix`,
 * `local()` font matching, `position: sticky` inside a grid, smooth-scroll
 * timing, and module scripts. This suite does not re-run everything; it asks
 * WebKit the questions a Safari reader would notice first, in both languages,
 * on an iPhone and on a Mac-sized window:
 *
 *   - no script error, and the script actually ran (diagrams drawn);
 *   - nothing scrolls sideways on the phone;
 *   - after scrolling through, nothing is left invisible;
 *   - the menu opens with a tap and closes when a link is tapped;
 *   - the Chinese page renders as Chinese.
 *
 * It also saves a full-page screenshot per page and viewport to
 * test-results/webkit/, which CI uploads — the one way anybody without an
 * iPhone to hand can look at the page as Safari draws it.
 *
 * Skips itself when WebKit is not installed (this machine has Chromium only);
 * CI installs it.
 */
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, reporter, ROOT } from './harness.mjs';

let webkit; let devices;
try {
  ({ webkit, devices } = await import('playwright'));
  const { existsSync } = await import('node:fs');
  if (!existsSync(webkit.executablePath())) webkit = null;
} catch { webkit = null; }
if (!webkit) { console.log('… webkit suite skipped — WebKit is not installed here (CI runs it)'); process.exit(0); }

const OUT = join(ROOT, 'test-results/webkit');
mkdirSync(OUT, { recursive: true });
const hosts = (readFileSync(join(ROOT, 'index.html'), 'utf8').match(/data-diagram="/g) ?? []).length;

const { base, close } = await serve();
const browser = await webkit.launch();
const { defaultBrowserType: _d, ...iphone } = devices['iPhone 13'];
const VIEWPORTS = [['iphone', iphone], ['mac', { viewport: { width: 1280, height: 800 } }]];
let ok = true;

for (const [lang, path] of [['en', '/'], ['zh', '/zh/']]) {
  for (const [name, opts] of VIEWPORTS) {
    const r = reporter(`webkit [${lang}, ${name}] — Safari's engine`);
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 80)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 80)); });
    await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForTimeout(800);

    const boot = await page.evaluate(() => ({
      js: document.documentElement.classList.contains('js'),
      drawn: [...document.querySelectorAll('[data-diagram]')].filter((h) => h.querySelector('svg')).length,
      overflow: document.documentElement.scrollWidth - innerWidth,
      han: (document.body.innerText.match(/[一-鿿]/g) ?? []).length,
    }));
    r.check(boot.js, 'the script never ran');
    r.equal(boot.drawn, hosts, 'diagrams drawn');
    r.check(boot.overflow <= 0, `the page scrolls sideways by ${boot.overflow}px`);
    if (lang === 'zh') r.check(boot.han > 1500, `only ${boot.han} Han characters rendered`);

    // Scroll through in steps, as a reader does, then look for anything the
    // reveal system left behind.
    await page.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += innerHeight * 0.5) {
        window.scrollTo(0, y);
        await new Promise((d) => requestAnimationFrame(() => setTimeout(d, 100)));
      }
    });
    await page.waitForTimeout(900);
    const hidden = await page.evaluate(() => [...document.querySelectorAll('[data-reveal], [data-stagger]')]
      .filter((e) => parseFloat(getComputedStyle(e).opacity) < 0.5).map((e) => e.className || e.tagName).slice(0, 3));
    r.equal(hidden.length, 0, `left invisible after scrolling through: ${hidden.join(', ')}`);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(300);

    if (name === 'iphone') {
      await page.tap('.nav__burger'); await page.waitForTimeout(400);
      const open = await page.getAttribute('.nav__burger', 'aria-expanded');
      await page.tap('.nav__links a[href^="#"]'); await page.waitForTimeout(600);
      const shut = await page.getAttribute('.nav__burger', 'aria-expanded');
      r.check(open === 'true' && shut === 'false', `menu: opened ${open}, closed ${shut}`);
    }

    /* WebKit refuses an image over 32 767 px on a side, and the phone page is
       taller than that at 3× — so the page is saved in 10 000 px slices. A
       screenshot that fails is a failure of this suite, not a crash of it. */
    await page.evaluate(() => window.scrollTo(0, 0));
    try {
      const { height, width } = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, width: innerWidth }));
      const SLICE = 10000;
      for (let y = 0, i = 1; y < height; y += SLICE, i += 1) {
        await page.screenshot({ path: join(OUT, `${lang}-${name}-${i}.png`), fullPage: true, clip: { x: 0, y, width, height: Math.min(SLICE, height - y) } });
      }
    } catch (e) { r.check(false, `screenshot failed: ${e.message.split('\n')[0]}`); }
    r.equal(errors.length, 0, `script errors: ${errors.slice(0, 2).join(' | ')}`);
    await ctx.close();
    ok = r.finish() && ok;
  }
}

await browser.close(); close();
if (!ok) process.exit(1);
console.log(`webkit checks passed — screenshots in ${OUT}`);
