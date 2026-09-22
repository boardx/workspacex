#!/usr/bin/env node
/**
 * browser.test.mjs — what a stylesheet cannot tell you.
 *
 * Accessibility, keyboard operation, responsiveness, the interactive pieces,
 * the no-JavaScript path, and the Chinese page. Every expectation that can be
 * derived from the source is derived, because the version of this suite that
 * lived outside the repository went stale four times by asserting against
 * counts that had changed.
 *
 *   node tests/browser.test.mjs
 *   CHROMIUM_PATH=/path/to/chrome node tests/browser.test.mjs
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, launcher, launchOptions, reporter, pageFacts, ROOT } from './harness.mjs';

const chromium = await launcher();
if (!chromium) {
  console.log('… browser checks skipped — playwright is not installed');
  console.log('  npm i -D playwright  (and set CHROMIUM_PATH if the browser lives elsewhere)');
  process.exit(0);
}

const facts = await pageFacts();
const { base, close } = await serve();
const browser = await chromium.launch(launchOptions());
let ok = true;

const WIDTHS = [320, 360, 390, 430, 600, 768, 900, 1024, 1280, 1440, 1920];

/* Every behavioural suite runs against both languages. It used to run the
   keyboard, interaction, degradation and compatibility checks against the
   English page only — so the Chinese page, which is a separately generated
   document, could have had broken tabs or an unreachable menu and nothing
   would have said so. */
const LANGS = [['en', '/'], ['zh', '/zh/']];

/* ---------------------------------------------------------------- a11y --- */
{
  const r = reporter('accessibility — axe-core, both languages');
  let axe = null;
  try { axe = readFileSync(join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8'); }
  catch { try { axe = readFileSync(require.resolve?.('axe-core/axe.min.js') ?? '', 'utf8'); } catch { /* absent */ } }

  if (!axe) r.note('axe-core not installed — skipped');
  else {
    for (const [lang, path] of [['en', '/'], ['zh', '/zh/'], ['en', '/privacy.html'], ['zh', '/zh/privacy.html'], ['en', '/404.html']]) {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      const page = await ctx.newPage();
      await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
      await page.addScriptTag({ content: axe });
      const res = await page.evaluate(async () => window.axe.run(document, {
        resultTypes: ['violations'],
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
      }));
      res.violations.forEach((v) => r.check(false, `${path} [${lang}] ${v.impact} ${v.id} — ${v.nodes.length} node(s)`));
      await ctx.close();
    }
  }
  ok = r.finish() && ok;
}

/* ------------------------------------------------------------ keyboard --- */
for (const [lang, path] of LANGS) {
  const r = reporter(`keyboard [${lang}] — every control reachable and operable`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(base + path, { waitUntil: 'networkidle' });

  const stops = [];
  for (let i = 0; i < 60; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const cs = getComputedStyle(a);
      return {
        label: (a.textContent || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        ring: cs.outlineWidth !== '0px' || !!a.querySelector?.('.d-arch__plate'),
      };
    });
    if (!info) break;
    stops.push(info);
  }
  stops.filter((s) => !s.ring).forEach((s) => r.check(false, `no focus indicator on "${s.label}"`));
  r.check(stops.length > 20, `only ${stops.length} tab stops found`);

  // every loop step is a control, derived from the source
  const railStops = await page.evaluate(() => document.querySelectorAll('.rail__item').length);
  r.equal(railStops, facts.loopSteps, 'loop steps reachable');

  // and activating one moves the ring
  await page.locator('.rail__item[data-step="4"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1100);
  const centre = await page.evaluate(() => document.querySelector('.d-loop__title')?.textContent);
  r.check(!!centre, 'the loop reports no active stage after Enter');

  // the mobile menu opens and Escape closes it
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.click('#burger');
  const opened = await page.evaluate(() => document.getElementById('navlinks').dataset.open);
  await page.keyboard.press('Escape');
  const closed = await page.evaluate(() => document.getElementById('navlinks').dataset.open);
  r.equal(opened, 'true', 'burger opens the menu');
  r.check(closed !== 'true', 'Escape did not close the menu');
  await ctx.close();
  ok = r.finish() && ok;
}

/* ---------------------------------------------------------- responsive --- */
{
  const r = reporter(`responsive — ${WIDTHS.length} widths, both languages`);
  for (const path of ['/', '/zh/']) {
    for (const width of WIDTHS) {
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.evaluate(async () => {
        const step = window.innerHeight * 0.8;
        for (let y = 0; y < document.body.scrollHeight; y += step) {
          window.scrollTo(0, y); await new Promise((d) => setTimeout(d, 30));
        }
        window.scrollTo(0, 0);
      });
      const res = await page.evaluate(() => {
        window.scrollTo(9999, window.scrollY);
        const scrolledX = window.scrollX;
        window.scrollTo(0, window.scrollY);
        const tiny = [];
        document.querySelectorAll('svg text').forEach((t) => {
          const vb = t.ownerSVGElement?.viewBox.baseVal;
          if (!vb?.width) return;
          const scale = t.ownerSVGElement.getBoundingClientRect().width / vb.width;
          const px = parseFloat(getComputedStyle(t).fontSize) * scale;
          if (px < 9) tiny.push(`${t.textContent.slice(0, 12)}=${px.toFixed(1)}px`);
        });
        const nav = document.querySelector('.nav__actions').getBoundingClientRect();
        return { scrolledX, tiny: [...new Set(tiny)], navRight: Math.round(nav.right), vw: window.innerWidth };
      });
      r.check(res.scrolledX === 0, `${path} @${width}: page scrolls sideways`);
      r.check(res.tiny.length === 0, `${path} @${width}: svg text under 9px — ${res.tiny.slice(0, 3).join(', ')}`);
      r.check(res.navRight <= res.vw, `${path} @${width}: nav actions clipped at x=${res.navRight}`);
      await ctx.close();
    }
  }
  ok = r.finish() && ok;
}

/* --------------------------------------------------------- interaction --- */
for (const [lang, path] of LANGS) {
  const r = reporter(`interaction [${lang}] — switch, layers and discipline tabs`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => r.check(false, `page error: ${e.message}`));
  await page.goto(base + path, { waitUntil: 'networkidle' });

  await page.locator('.switch').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const heightBefore = await page.evaluate(() => Math.round(document.querySelector('#problem .stage').getBoundingClientRect().height));
  await page.click('.switch__btn[data-view="chain"]');
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    pane: document.querySelector('#problem .compare__pane.is-on')?.dataset.view,
    /* Perceivable, not merely displayed: the captions share a grid cell and
       are hidden with `visibility`, so `display` says nothing useful here. */
    captions: [...document.querySelectorAll('#problem .stage__caption')]
      .filter((c) => getComputedStyle(c).visibility !== 'hidden' && c.getAttribute('aria-hidden') !== 'true').length,
    height: Math.round(document.querySelector('#problem .stage').getBoundingClientRect().height),
  }));
  r.equal(after.pane, 'chain', 'compare switch pane');
  r.equal(after.captions, 1, 'captions visible after switching');
  r.check(Math.abs(heightBefore - after.height) <= 8, `stage jumps ${heightBefore}px → ${after.height}px on switch`);

  await page.locator('#architecture').scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const layers = await page.evaluate(() => document.querySelectorAll('[data-layer]').length);
  r.equal(layers, facts.archLayers, 'selectable architecture layers');
  await page.click('[data-layer="l4"]');
  await page.waitForTimeout(300);
  const impact = await page.evaluate(() => ({
    model: [...document.querySelectorAll('[data-impacted="true"]')].map((n) => n.dataset.layer),
    details: document.querySelectorAll('#arch-detail p:not([hidden])').length,
  }));
  // the whole point of the interaction: swapping the model reaches nothing else
  r.equal(impact.model.length, 0, 'layers disturbed by a model swap');
  r.equal(impact.details, 1, 'detail paragraphs shown');

  /* the discipline tabs: a real tablist, so only the selected tab is in the
     tab order and the arrow keys move between them */
  await page.locator('.cases').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const tabsInit = await page.evaluate(() => ({
    tabs: document.querySelectorAll('.cases__tab').length,
    visiblePanels: [...document.querySelectorAll('.case')].filter((c) => !c.hasAttribute('hidden')).length,
    inTabOrder: [...document.querySelectorAll('.cases__tab')].filter((t) => t.tabIndex === 0).length,
  }));
  r.equal(tabsInit.tabs, 6, 'discipline tabs');
  r.equal(tabsInit.visiblePanels, 1, 'panels visible at once');
  r.equal(tabsInit.inTabOrder, 1, 'tabs in the tab order');

  await page.locator('.cases__tab[data-case="edu"]').click();
  await page.waitForTimeout(250);
  const picked = await page.evaluate(() => ({
    panel: [...document.querySelectorAll('.case')].find((c) => !c.hasAttribute('hidden'))?.dataset.case,
    han: /[\u4e00-\u9fff]/.test(document.querySelector('.case:not([hidden]) .case__work')?.textContent ?? ''),
  }));
  r.equal(picked.panel, 'edu', 'panel shown after clicking a tab');
  if (lang === 'zh') r.check(picked.han, 'the discipline panel is not translated');
  if (lang === 'en') r.check(!picked.han, 'the English panel contains Han characters');

  await page.locator('.cases__tab[data-case="edu"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(200);
  const arrowed = await page.evaluate(() => ({
    panel: [...document.querySelectorAll('.case')].find((c) => !c.hasAttribute('hidden'))?.dataset.case,
    focused: document.activeElement?.dataset.case,
  }));
  r.equal(arrowed.panel, 'finance', 'ArrowRight moves the panel');
  r.equal(arrowed.focused, 'finance', 'ArrowRight moves focus');

  await ctx.close();
  ok = r.finish() && ok;
}

/* ------------------------------------------------------------- no-JS ----- */
for (const [lang, path] of LANGS) {
  const r = reporter(`degradation [${lang}] — no JavaScript, and a failed module`);
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
  const page = await noJs.newPage();
  await page.goto(base + path, { waitUntil: 'load' });
  await page.waitForTimeout(400);
  const res = await page.evaluate(() => ({
    hidden: [...document.querySelectorAll('[data-reveal], [data-stagger]')]
      .filter((e) => parseFloat(getComputedStyle(e).opacity) < 0.5).length,
    navVisible: getComputedStyle(document.getElementById('navlinks')).display !== 'none',
    words: document.body.innerText.trim().split(/\s+/).length,
    han: (document.body.innerText.match(/[\u4e00-\u9fff]/g) ?? []).length,
    panels: [...document.querySelectorAll('.case')].filter((c) => !c.hasAttribute('hidden')).length,
  }));
  r.equal(res.hidden, 0, 'elements left invisible without JS');
  r.check(res.navVisible, 'the navigation is unreachable without JS on a phone');
  /* Chinese has no spaces, so splitting on whitespace undercounts it by an
     order of magnitude. Measure each language by something it actually has. */
  if (lang === 'zh') r.check(res.han > 1500, `only ${res.han} Han characters render without JS`);
  else r.check(res.words > 900, `only ${res.words} words render without JS`);
  r.check(res.panels >= 1, 'no discipline panel is readable without JS');
  await noJs.close();

  // a module that fails to load must not take the content with it
  const broken = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await broken.newPage();
  await page2.route('**/diagrams.js', (route) => route.abort());
  await page2.goto(base + path, { waitUntil: 'load' });
  await page2.waitForTimeout(2200);
  const stillHidden = await page2.evaluate(() =>
    [...document.querySelectorAll('[data-reveal]')].filter((e) => parseFloat(getComputedStyle(e).opacity) < 0.5).length);
  r.equal(stillHidden, 0, 'elements left invisible when a module fails');
  await broken.close();
  ok = r.finish() && ok;
}

/* ---------------------------------------------------------- bilingual --- */
{
  const r = reporter('bilingual — the Chinese page stands on its own');
  const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 } });
  const page = await noJs.newPage();
  await page.goto(base + '/zh/', { waitUntil: 'load' });
  const stat = await page.evaluate(() => ({
    lang: document.documentElement.lang,
    han: (document.body.innerText.match(/[一-鿿]/g) ?? []).length,
    sections: document.querySelectorAll('section').length,
  }));
  r.check(/^zh/.test(stat.lang), `lang is "${stat.lang}"`);
  r.check(stat.han > 800, `only ${stat.han} Han characters without JS`);
  r.equal(stat.sections, facts.sections, 'sections present without JS');
  await noJs.close();

  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page2 = await ctx.newPage();
  page2.on('pageerror', (e) => r.check(false, `zh page error: ${e.message}`));
  await page2.goto(base + '/zh/', { waitUntil: 'networkidle' });
  await page2.waitForTimeout(600);
  const live = await page2.evaluate(() => ({
    diagrams: document.querySelectorAll('[data-diagram] svg').length,
    chainLabel: document.querySelector('.d-chain text')?.textContent ?? '',
    styles: [...document.styleSheets].every((s) => { try { return s.cssRules.length > 0; } catch { return false; } }),
  }));
  r.equal(live.diagrams, facts.diagrams, 'diagrams drawn on the Chinese page');
  r.check(/[一-鿿]/.test(live.chainLabel), `diagram labels not translated: "${live.chainLabel}"`);
  r.check(live.styles, 'a stylesheet failed to resolve from /zh/');
  await ctx.close();
  ok = r.finish() && ok;
}

/* --------------------------------------------------------- older webkit -- */
for (const [lang, path] of LANGS) {
  const r = reporter(`compatibility [${lang}] — MediaQueryList without addEventListener`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => {
      const mql = real(q);
      return {
        get matches() { return mql.matches; }, media: mql.media,
        addListener: (fn) => mql.addListener(fn), removeListener: (fn) => mql.removeListener(fn),
      };
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(base + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const res = await page.evaluate(() => ({
    booted: document.documentElement.classList.contains('js'),
    diagrams: document.querySelectorAll('[data-diagram] svg').length,
    arch: !!document.querySelector('[data-layer][data-selected="true"]'),
  }));
  r.check(res.booted, 'boot aborted on the legacy media-query path');
  r.equal(res.diagrams, facts.diagrams, 'diagrams drawn on the legacy path');
  r.check(res.arch, 'the architecture explorer did not initialise');
  errors.forEach((e) => r.check(false, `error: ${e}`));
  await ctx.close();
  ok = r.finish() && ok;
}

await browser.close();
close();
console.log(ok ? '\nbrowser checks passed' : '\nbrowser checks FAILED');
process.exit(ok ? 0 : 1);
