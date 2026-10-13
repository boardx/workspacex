import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { serve, launcher, launchOptions, ROOT } from './harness.mjs';

const chromium = await launcher();
if (!chromium) {
  console.log('… aidt browser checks skipped — playwright is not installed');
  process.exit(0);
}
const { base, close } = await serve();
const browser = await chromium.launch(launchOptions());
const axe = readFileSync(join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8');
const evidence = join(ROOT, 'test-results/aidt');
mkdirSync(evidence, { recursive: true });
try {
  for (const [language, route] of [['en', '/aidt/'], ['zh-Hans', '/zh/aidt/']]) {
    for (const width of [320, 390, 760, 1440]) {
      const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const missing = [];
      page.on('response', r => { if (r.status() >= 400) missing.push(r.url()); });
      const response = await page.goto(base + route);
      assert.equal(response.status(), 200);
      assert.equal(await page.locator('html').getAttribute('lang'), language);
      assert.equal(await page.locator('h1').count(), 1);
      assert.ok(await page.locator('h1').isVisible());
      assert.equal(await page.locator('.aidt-step').count(), 6);
      assert.equal(await page.locator('.aidt-mindset').count(), 7);
      assert.match(await page.locator('#contact .btn').getAttribute('href'), /^mailto:hello@boardx\.us\?subject=/);
      const other = page.locator('.langswitch__btn:not([aria-current])');
      await other.click();
      assert.equal(await page.locator('html').getAttribute('lang'), language === 'en' ? 'zh-Hans' : 'en');
      await page.goto(base + route);
      assert.ok(await page.locator('.aidt-hero-art img').evaluate(img => img.complete && img.naturalWidth > 0), `${route}: illustration loads`);
      const processSummary = page.locator('#process details > summary');
      await processSummary.focus();
      await processSummary.press('Enter');
      assert.ok(await page.locator('.aidt-step__output').first().isVisible(), `${route}: keyboard reveals stage guidance without JS`);
      const layout = await page.evaluate(() => ({
        overflow: document.documentElement.scrollWidth > innerWidth,
        hidden: [...document.querySelectorAll('h1,h2,h3,.btn,.aidt-header a')].filter(e => {
          const r = e.getBoundingClientRect();
          return r.left < -1 || r.right > innerWidth + 1;
        }).map(e => e.textContent.trim()),
      }));
      assert.equal(layout.overflow, false, `${route} at ${width}: page overflow`);
      assert.deepEqual(layout.hidden, [], `${route} at ${width}: clipped content`);
      await processSummary.press('Enter');
      assert.equal(await page.locator('.aidt-step__output').first().isVisible(), false, `${route}: keyboard collapses stage guidance`);
      await page.locator('.aidt-hero .aidt-actions a[href="#education"]').click();
      await page.waitForTimeout(800);
      assert.ok(await page.locator('#education-title').isVisible());
      const partners = page.locator('.aidt-partners');
      await partners.evaluate(element => element.scrollIntoView({ behavior: 'instant' }));
      await page.waitForFunction(() => [...document.querySelectorAll('.aidt-partner img')]
        .every(img => img.complete && img.naturalWidth > 0), { }, { polling: 100, timeout: 10000 });
      assert.equal(await partners.locator('img').count(), 2);
      assert.equal(await page.locator('#education a[href^="mailto:hello@boardx.us?subject=AIDT%20"]').count(), 2);
      await page.screenshot({ path: join(evidence, `partners-${language}-${width}.png`) });
      await page.locator('.aidt-hero a[href="#workshop"]').click();
      await page.waitForTimeout(800);
      assert.ok(await page.locator('#workshop-title').isVisible());
      assert.deepEqual(missing, []);
      await page.screenshot({ path: join(evidence, `${language}-${width}.png`), fullPage: true });
      await context.close();
    }
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    await page.goto(base + route);
    await page.locator('details').evaluateAll(items => items.forEach(item => { item.open = true; }));
    await page.evaluate(axe);
    const violations = await page.evaluate(async () => (await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa'] },
    })).violations.map(v => `${v.id}: ${v.nodes.map(n => n.target).join(', ')}`));
    assert.deepEqual(violations, [], `${route}: accessibility`);
    await context.close();
  }
  // Both direct fragments and clicks must clear the fixed navigation and
  // avoid retaining the large decorative section padding above the heading.
  for (const route of ['/', '/zh/']) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    await page.goto(base + route + '#trust');
    await page.waitForTimeout(300);
    const position = await page.evaluate(() => ({
      heading: document.querySelector('#trust h2').getBoundingClientRect().top,
      nav: document.querySelector('.nav').getBoundingClientRect().bottom,
    }));
    assert.ok(position.heading > position.nav, `${route}: heading hidden behind nav`);
    assert.ok(position.heading - position.nav < 120, `${route}: excessive anchor gap`);
    await context.close();
  }
  console.log('✓ aidt: EN/ZH, 4 widths, no-JS navigation, higher education and workshop CTAs, partner logos, accessibility and homepage fragments');
} finally {
  await browser.close();
  close();
}
