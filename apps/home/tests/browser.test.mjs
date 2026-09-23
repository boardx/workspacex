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
import * as H from './harness.mjs';
import { serve, launcher, launchOptions, reporter, pageFacts, evaluateWithin, ROOT } from './harness.mjs';

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

/* A suite that throws used to print a stack and then hang forever, because
   the browser and the server were still open and nothing tore them down.
   Every failure therefore looked like a stall. These three turn any crash —
   including one inside page.evaluate — into a named failure and an exit. */
const bail = async (what, err) => {
  console.error(`\n✗ ${H.current} — ${what}: ${err?.message ?? err}`);
  console.error(`    browser connected: ${browser.isConnected()}`);
  try { close(); } catch { /* already down */ }
  try { await browser.close(); } catch { /* already down */ }
  process.exit(1);
};
process.on('uncaughtException', (e) => { bail('threw', e); });
process.on('unhandledRejection', (e) => { bail('rejected', e); });
/* And a ceiling, so a genuinely stuck await cannot burn a CI job silently. */
const watchdog = setTimeout(() => bail('exceeded its time budget', new Error('300s')), 300_000);
watchdog.unref();

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

  /* The ceiling used to be a literal 60, and the page has 58 focusable
     elements. Three more controls and the last of them would have dropped out
     of this check in silence. Derived, with headroom. */
  const focusable = await page.evaluate(() => [...document.querySelectorAll(
    'a[href], button, input, select, textarea, summary, [tabindex]:not([tabindex="-1"])')]
    /* Visible, not inside a closed panel, and not explicitly out of the tab
       order. Both exclusions are things the browser is doing correctly and a
       naive count reads as a failure: links inside the five hidden discipline
       panels, and the five unselected tabs, which carry tabindex="-1" because
       a tablist is a ROVING tab stop — one stop for the whole group, arrows
       to move within it. `button` matches whatever its tabindex says, so the
       first version of this count treated a correct widget as five missing
       controls. */
    .filter((e) => e.getAttribute('tabindex') !== '-1'
                && !e.closest('[hidden]')
                && (e.getBoundingClientRect().width > 0 || e.ownerSVGElement || e.tagName === 'g'))
    .length);

  const stops = [];
  for (let i = 0; i < focusable + 5; i += 1) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const cs = getComputedStyle(a);
      /* The arch layers are SVG groups with no outline of their own — their
         indicator is a stroke on a child plate. That used to be waved through
         with `|| !!a.querySelector('.d-arch__plate')`, which passes whether or
         not the rule that draws it still exists. Measure the plate instead. */
      const plate = a.querySelector?.('.d-arch__plate');
      const plateStroke = plate ? getComputedStyle(plate).strokeWidth : null;
      return {
        label: (a.textContent || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 40),
        ring: cs.outlineWidth !== '0px' || (plate ? parseFloat(plateStroke) > 0 : false),
      };
    });
    if (!info) break;
    stops.push(info);
  }
  stops.filter((s) => !s.ring).forEach((s) => r.check(false, `no focus indicator on "${s.label}"`));
  r.check(stops.length >= focusable - 2, `only ${stops.length} of ${focusable} focusable elements were reachable by Tab`);

  // every loop step is a control, derived from the source
  const railStops = await page.evaluate(() => document.querySelectorAll('.rail__item').length);
  r.equal(railStops, facts.loopSteps, 'loop steps reachable');

  // and activating one moves the ring
  await page.locator('.rail__item[data-step="4"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1100);
  const centre = await page.evaluate(() => document.querySelector('.d-loop__title')?.textContent);
  r.check(!!centre, 'the loop reports no active stage after Enter');

  /* Reachable is not operable. The interaction suite CLICKS these three; a
     widget that a mouse can drive and a keyboard cannot would pass both
     suites. Each is driven from the keyboard here and its state re-read. */
  await page.locator('.switch__btn').nth(0).focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  const switched = await page.evaluate(() =>
    document.querySelector('.switch__btn:nth-child(2)')?.getAttribute('aria-pressed'));
  r.equal(switched, 'true', 'the compare switch does not respond to ArrowRight');

  const firstLayer = page.locator('[data-layer]').first();
  await firstLayer.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(250);
  const layerPressed = await page.evaluate(() =>
    document.querySelector('[data-layer]')?.getAttribute('aria-pressed'));
  r.equal(layerPressed, 'true', 'an architecture layer does not respond to Enter');

  await page.locator('.cases__tab').first().focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(250);
  const tabbed = await page.evaluate(() => ({
    selected: document.querySelectorAll('.cases__tab[aria-selected="true"]').length,
    second: document.querySelectorAll('.cases__tab')[1]?.getAttribute('aria-selected'),
  }));
  r.equal(tabbed.selected, 1, 'discipline tabs with aria-selected after ArrowRight');
  r.equal(tabbed.second, 'true', 'ArrowRight does not move the discipline selection');

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
      r.step(`${path} @${width} · context`);
      const ctx = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await ctx.newPage();
      /* Without this a stuck action waits forever. It cost two full runs
         diagnosed as "still going" before the suite could say otherwise. */
      page.setDefaultTimeout(20_000);
      r.step(`${path} @${width} · goto`);
      await page.goto(base + path, { waitUntil: 'networkidle' });
      /* What this suite asserts — sideways overflow, svg text under 9 px, a
         clipped nav — needs the page LAID OUT, not animated. It used to walk
         the page in twenty-nine steps, which meant twenty-nine renderer
         round-trips per case and 638 across the suite, and roughly half of
         all runs stalled on one of them.

         Measured, in these contexts: a single scrollTo is 2 ms, no task runs
         over 50 ms, the heap is flat, and requestAnimationFrame fires exactly
         ONCE and never again — the renderer is not producing frames at all,
         so nothing in the page is running to block anything. The stall is in
         waiting on a frame that never comes, and the fix is to stop asking
         for hundreds of them. Bottom and back is enough to force layout of
         everything below the fold. */
      r.step(`${path} @${width} · scroll`);
      await evaluateWithin(page, 15_000, `to bottom ${path} @${width}`,
        () => window.scrollTo(0, document.body.scrollHeight));
      await page.waitForTimeout(120);
      await evaluateWithin(page, 15_000, `to top ${path} @${width}`, () => window.scrollTo(0, 0));

      r.step(`${path} @${width} · measure`);
      const res = await evaluateWithin(page, 30_000, `measure ${path} @${width}`, () => {
        /* `scrollX` after scrolling right cannot detect anything: the page
           sets overflow-x: clip, so there is nothing to scroll and the value
           is always 0. That assertion passed for twenty-six rounds without
           ever being able to fail. What matters is whether an element sits
           past the viewport edge, where clip makes it UNREACHABLE rather
           than merely ugly. */
        const past = [];
        document.querySelectorAll('.nav__inner *, .btn, .chip, h1, h2, h3, .card, .cases__tab')
          .forEach((el) => {
            const b = el.getBoundingClientRect();
            if (b.width > 0 && b.right > window.innerWidth + 1) {
              past.push(`${(el.className || el.tagName).toString().trim().slice(0, 16)}@${Math.round(b.right)}`);
            }
          });
        /* Position, not just size. The rule below measures how BIG a label is
           and never where it ended up, so a longer translation or a renamed
           gate could run past the edge of its own viewBox and be clipped with
           nothing to say so. */
        const outside = [];
        document.querySelectorAll('[data-diagram] svg').forEach((sv) => {
          const vb = sv.viewBox.baseVal;
          if (!vb?.width) return;
          const kind = sv.closest('[data-diagram]')?.dataset.diagram ?? '?';
          sv.querySelectorAll('text').forEach((tx) => {
            const b = tx.getBBox();
            if (b.x < -1 || b.y < -1 || b.x + b.width > vb.width + 1 || b.y + b.height > vb.height + 1) {
              outside.push(`${kind}:"${tx.textContent.trim().slice(0, 12)}"`);
            }
          });
        });

        const tiny = [];
        document.querySelectorAll('svg text').forEach((t) => {
          const vb = t.ownerSVGElement?.viewBox.baseVal;
          if (!vb?.width) return;
          const scale = t.ownerSVGElement.getBoundingClientRect().width / vb.width;
          const px = parseFloat(getComputedStyle(t).fontSize) * scale;
          if (px < 9) tiny.push(`${t.textContent.slice(0, 12)}=${px.toFixed(1)}px`);
        });
        const nav = document.querySelector('.nav__actions').getBoundingClientRect();

        /* "Does the nav reach past the viewport" and "is the nav legible" are
           different questions, and only the first was being asked. Adding one
           link slid the last one UNDERNEATH the language switch — entirely
           inside the viewport, entirely unreadable, and green. */
        const bar = [...document.querySelectorAll('.nav__inner > *')]
          .flatMap((g) => (g.matches('.nav__links, .nav__actions, .brand')
            ? [...g.children].filter((c) => c.offsetParent !== null) : [g]))
          .map((el) => ({ el, r: el.getBoundingClientRect() }))
          .filter(({ r }) => r.width > 0 && r.height > 0);
        const overlaps = [];
        for (let i = 0; i < bar.length; i += 1) {
          for (let j = i + 1; j < bar.length; j += 1) {
            const a = bar[i].r; const b = bar[j].r;
            const dx = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const dy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (dx > 1 && dy > 1) {
              overlaps.push(`${bar[i].el.textContent.trim().slice(0, 10)}/${bar[j].el.textContent.trim().slice(0, 10)}`);
            }
          }
        }
        return { past: [...new Set(past)].slice(0, 4), tiny: [...new Set(tiny)],
                 outside: [...new Set(outside)].slice(0, 3),
                 navRight: Math.round(nav.right),
                 vw: window.innerWidth, overlaps: [...new Set(overlaps)] };
      });
      r.check(res.past.length === 0, `${path} @${width}: past the right edge — ${res.past.join(', ')}`);
      r.check(res.tiny.length === 0, `${path} @${width}: svg text under 9px — ${res.tiny.slice(0, 3).join(', ')}`);
      r.check(res.outside.length === 0, `${path} @${width}: svg text outside its viewBox — ${res.outside.slice(0, 2).join(', ')}`);
      r.check(res.navRight <= res.vw, `${path} @${width}: nav actions clipped at x=${res.navRight}`);
      r.check(res.overlaps.length === 0, `${path} @${width}: nav items overlap — ${res.overlaps.slice(0, 3).join(', ')}`);
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

/* ---------------------------------------------------- addressability --- */
/* The six discipline panels are the only place the argument is made in a
   named profession, and for thirty-two rounds there was no way to send
   anybody to one: the fragment was ignored on load and never written when a
   tab was chosen, so the panel a reader was looking at had no address. */
for (const [lang, path] of LANGS) {
  const r = reporter(`addressable [${lang}] — a discipline can be linked to`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);

  /* Arriving on a deep link selects that panel, not the first one. */
  await page.goto(`${base}${path}#panel-edu`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const arrived = await evaluateWithin(page, 15_000, 'deep link', () => ({
    shown: [...document.querySelectorAll('.case')].filter((c) => !c.hasAttribute('hidden')).map((c) => c.id),
    selected: document.querySelectorAll('.cases__tab[aria-selected="true"]').length,
  }));
  r.equal(arrived.shown.join(','), 'panel-edu', 'the deep-linked panel is the visible one');
  r.equal(arrived.selected, 1, 'exactly one tab is selected after a deep link');

  /* Choosing one gives it an address, without piling up history entries. */
  await page.goto(base + path, { waitUntil: 'networkidle' });
  const depth = await evaluateWithin(page, 15_000, 'history depth', () => history.length);
  await page.locator('.cases__tab').nth(2).click();
  await page.waitForTimeout(400);
  const after = await evaluateWithin(page, 15_000, 'after choosing', () => ({
    hash: location.hash, depth: history.length,
    shown: [...document.querySelectorAll('.case')].filter((c) => !c.hasAttribute('hidden')).map((c) => c.id)[0],
  }));
  r.check(after.hash.length > 1, 'choosing a discipline leaves no address in the URL');
  r.equal(after.hash.slice(1), after.shown, 'the URL names the panel actually shown');
  r.equal(after.depth, depth, 'choosing a discipline pushed a history entry');
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

/* -------------------------------------------------------- text resize --- */
/* WCAG 1.4.4: text has to reach 200% without losing content or function.
   Nothing checked it, and it failed — in English only, because the Chinese
   strings are short enough to fit. A single-language check would have called
   it clean, which is the same lesson as round 21 in a new place.
   The cause was never the type: it was every clamp FLOOR, every `ch` measure
   and every `min-width: auto` grid item, each of which grows with the text
   and none of which is bounded by the screen. */
for (const [lang, path] of LANGS) {
  const r = reporter(`text resize [${lang}] — 200%, the reader's own setting`);
  for (const width of [390, 768, 1280]) {
    r.step(`${path} @${width}`);
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(20_000);
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await evaluateWithin(page, 15_000, 'double the text', () => {
      document.documentElement.style.fontSize = '32px';
    });
    await page.waitForTimeout(250);
    const past = await evaluateWithin(page, 15_000, `measure ${width}`, () => {
      const out = [];
      document.querySelectorAll('.nav__inner *, .btn, .chip, h1, h2, h3, p, .card, .cases__tab')
        .forEach((el) => {
          const b = el.getBoundingClientRect();
          if (b.width > 0 && b.right > window.innerWidth + 1) {
            out.push(`${(el.className || el.tagName).toString().trim().slice(0, 16)}@${Math.round(b.right)}`);
          }
        });
      return [...new Set(out)].slice(0, 4);
    });
    r.check(past.length === 0, `@${width} at 200% text: past the right edge — ${past.join(', ')}`);
    await ctx.close();
  }
  ok = r.finish() && ok;
}

/* ------------------------------------------------------------- motion --- */
/* The probe that root-caused the responsive stall found something worse than
   the stall: requestAnimationFrame fires ONCE in these contexts and never
   again, because a headless renderer with nothing asking for frames does not
   produce any. Everything in motion.js and the diagram scale sync is driven
   by rAF — so the pinned loop scene, the hero parallax, the reading progress
   and --dscale had never been executed by a single check. Eleven suites, and
   an entire subsystem untested.
   A screenshot forces a frame, which is what makes rAF run at all here. */
{
  const r = reporter('motion — the rAF layer actually runs');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto(base + '/', { waitUntil: 'networkidle' });

  const frame = async () => { await page.screenshot({ clip: { x: 0, y: 0, width: 8, height: 8 } }); };
  await frame();
  const ticks = await evaluateWithin(page, 15_000, 'rAF alive', () => new Promise((res) => {
    let n = 0;
    const t = () => { n += 1; if (n < 3) requestAnimationFrame(t); else res(n); };
    requestAnimationFrame(t);
    setTimeout(() => res(n), 3000);
  }));
  await frame();
  r.check(ticks >= 3, `requestAnimationFrame produced ${ticks} of 3 frames — the motion layer never ran`);

  /* Reading progress is written by a rAF scroll handler. */
  const scene = await evaluateWithin(page, 15_000, 'scroll into scene',
    () => { const t = document.querySelector('[data-scene="loop"]'); window.scrollTo(0, t.offsetTop + t.offsetHeight * 0.5); return true; });
  r.check(scene, 'the loop scene is in the document');
  for (let i = 0; i < 6; i += 1) await frame();
  const state = await evaluateWithin(page, 15_000, 'read motion state', () => ({
    read: parseFloat(getComputedStyle(document.querySelector('.nav__progress i')).getPropertyValue('--read')) || 0,
    current: document.querySelectorAll('#loop-rail [aria-current="true"]').length,
    scaled: [...document.querySelectorAll('[data-diagram] svg')]
      .filter((s) => parseFloat(getComputedStyle(s).getPropertyValue('--dscale')) > 0).length,
    diagrams: document.querySelectorAll('[data-diagram] svg').length,
    /* t() falls back to the key itself, so a missing diagram string draws
       "d.chain.memory" into the picture. Nothing could see that: the static
       side cannot resolve `t(`d.chain.${key}`)`, and the header of
       diagram-strings.js claimed a check that had never been written. */
    rawKeys: [...document.querySelectorAll('[data-diagram] svg text')]
      .map((n) => n.textContent.trim()).filter((v) => /^d\.[a-z]/.test(v)),
    /* Text drawn ON the brand gradient. axe does not evaluate SVG text over a
       gradient fill, so white-on-gradient — 2.19:1 over the orange stop —
       passed every accessibility run for thirty-three rounds. The page solved
       this once for buttons and called the answer --on-grad.

       "On" means the boxes actually overlap. The first version of this asked
       only whether the same <g> held a gradient-filled shape, and reported the
       axis diagram, whose labels sit above the line and whose only gradient is
       a 4px dot at the far end. A group is not a position. */
    onGradient: (() => {
      const ink = getComputedStyle(document.documentElement)
        .getPropertyValue('--on-grad').trim();
      const light = (c) => /^rgba?\((2[0-9]\d|1[89]\d), *(2[0-9]\d|1[89]\d), *(2[0-9]\d|1[89]\d)/.test(c);
      const bad = [];
      document.querySelectorAll('[data-diagram] svg').forEach((svgEl) => {
        const painted = [...svgEl.querySelectorAll('circle, rect, path, ellipse')]
          .filter((sh) => /^url\(/.test(sh.getAttribute('fill') ?? ''))
          .map((sh) => sh.getBoundingClientRect());
        if (!painted.length) return;
        svgEl.querySelectorAll('text').forEach((text) => {
          const fill = getComputedStyle(text).fill;
          if (fill === ink || !light(fill)) return;
          const t = text.getBoundingClientRect();
          const over = painted.some((p) =>
            Math.min(t.right, p.right) - Math.max(t.left, p.left) > t.width * 0.4 &&
            Math.min(t.bottom, p.bottom) - Math.max(t.top, p.top) > t.height * 0.4);
          if (over) bad.push(`${text.textContent.trim().slice(0, 12)}=${fill}`);
        });
      });
      return [...new Set(bad)];
    })(),
  }));
  r.check(state.read > 0, `reading progress stayed at ${state.read} after scrolling half the page`);
  r.check(state.current === 1, `the loop rail marks ${state.current} current steps, expected 1`);
  /* Against the count in the SOURCE, not against itself: `scaled === diagrams`
     is vacuously true when nothing rendered at all, which is exactly the
     failure it was supposed to catch. */
  r.equal(state.diagrams, facts.diagrams, 'diagrams that actually rendered');
  r.equal(state.scaled, facts.diagrams, 'diagrams with --dscale resolved');
  r.check(state.onGradient.length === 0,
    `light text drawn on the brand gradient — ${state.onGradient.slice(0, 3).join(', ')}`);
  r.check(state.rawKeys.length === 0,
    `untranslated diagram keys drawn as labels — ${state.rawKeys.slice(0, 3).join(', ')}`);
  await ctx.close();
  ok = r.finish() && ok;
}

/* ------------------------------------------------------------ console --- */
/* All five pages log nothing today, and nothing kept it that way. A module
   throwing after boot, an asset 404ing, a deprecation warning from an engine
   — none of it is visible to any other suite here, because the degradation
   suite only ever watches failures it caused on purpose. */
{
  const r = reporter('console — five pages, nothing logged');
  for (const path of ['/', '/zh/', '/privacy.html', '/zh/privacy.html', '/404.html']) {
    r.step(path);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const noise = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') noise.push(`${m.type()}: ${m.text().slice(0, 70)}`);
    });
    page.on('pageerror', (e) => noise.push(`threw: ${e.message.slice(0, 70)}`));
    page.on('requestfailed', (q) => noise.push(`failed: ${q.url().split('/').pop()}`));
    await page.goto(base + path, { waitUntil: 'networkidle' });
    await evaluateWithin(page, 15_000, `scroll ${path}`, () => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(900);
    r.equal(noise.length, 0, `${path} logged ${noise.length}: ${noise.slice(0, 2).join(' | ')}`);
    await ctx.close();
  }
  ok = r.finish() && ok;
}

/* --------------------------------------------------------- resilience --- */
/* Two failure paths were covered — scripting switched off, and one module
   aborting — and the one in between was not: JavaScript enabled and the
   scripts simply never arriving, which is what a proxy, a CDN outage or a
   blocker actually does. That path runs on neither the <noscript> block nor
   the module's own code; it runs on the `html:not(.js)` failsafe, which
   nothing had ever exercised. Nor had a missing stylesheet, a missing font,
   a light-scheme visitor, forced colors, or a phone held sideways. */
{
  const r = reporter('resilience — missing resources and display preferences');

  const BLOCKED = [
    ['every script', '**/assets/js/*.js'],
    ['the stylesheet', '**/site.css'],
    ['the fonts', '**/*.woff2'],
    ['the hero image', '**/aurora.jpg'],
  ];
  for (const [what, pattern] of BLOCKED) {
    r.step(`blocked: ${what}`);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message.slice(0, 60)));
    await page.route(pattern, (route) => route.abort());
    await page.goto(base + '/', { waitUntil: 'load' });
    /* Past the 1.2s reveal failsafe, not on it — sampling exactly on that
       boundary reported thirty invisible elements that were about to appear.
       Then scroll: when only a font or an image is missing the scripts still
       run, so below-the-fold content is waiting on the observer rather than
       broken, and asserting without scrolling accuses a working page. */
    await page.waitForTimeout(2400);
    await evaluateWithin(page, 15_000, 'to bottom', () => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
    await evaluateWithin(page, 15_000, 'to top', () => window.scrollTo(0, 0));
    await page.waitForTimeout(900);
    const state = await evaluateWithin(page, 15_000, `blocked ${what}`, () => ({
      words: document.body.innerText.trim().split(/\s+/).length,
      invisible: [...document.querySelectorAll('[data-reveal], [data-stagger]')]
        .filter((e) => parseFloat(getComputedStyle(e).opacity) < 0.5).length,
      nav: !!document.querySelector('.nav a[href]'),
    }));
    r.check(state.words > 900, `with ${what} blocked, only ${state.words} words render`);
    r.equal(state.invisible, 0, `elements still invisible with ${what} blocked`);
    r.check(state.nav, `the navigation is unusable with ${what} blocked`);
    r.equal(errors.length, 0, `page errors with ${what} blocked${errors[0] ? `: ${errors[0]}` : ''}`);
    await ctx.close();
  }

  const MODES = [
    ['a light-scheme visitor', { colorScheme: 'light' }],
    ['forced colors', { forcedColors: 'active' }],
    ['a phone held sideways', { viewport: { width: 640, height: 360 } }],
  ];
  for (const [what, opts] of MODES) {
    r.step(`mode: ${what}`);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...opts });
    const page = await ctx.newPage();
    await page.goto(base + '/', { waitUntil: 'networkidle' });
    await evaluateWithin(page, 15_000, 'to bottom', () => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
    await evaluateWithin(page, 15_000, 'to top', () => window.scrollTo(0, 0));
    await page.waitForTimeout(1200);
    const state = await evaluateWithin(page, 15_000, `mode ${what}`, () => ({
      words: document.body.innerText.trim().split(/\s+/).length,
      /* Transparent text is the specific way this page can fail here: the
         wordmark is painted through background-clip, and a mode that drops
         background images while keeping the transparent fill erases it. */
      invisibleText: [...document.querySelectorAll('h1, h2, h3, .brand__name, .btn, .nav__link')]
        .filter((e) => {
          const cs = getComputedStyle(e);
          return cs.webkitTextFillColor === 'rgba(0, 0, 0, 0)' && cs.backgroundImage === 'none';
        }).map((e) => (e.className || e.tagName).toString().slice(0, 18)),
      past: [...document.querySelectorAll('.btn, h1, .chip, .nav__inner *')]
        .filter((e) => e.getBoundingClientRect().width > 0
                    && e.getBoundingClientRect().right > window.innerWidth + 1).length,
    }));
    r.check(state.words > 900, `with ${what}, only ${state.words} words render`);
    r.equal(state.invisibleText.length, 0, `text painted transparent with ${what} — ${state.invisibleText.slice(0, 3).join(', ')}`);
    r.equal(state.past, 0, `content past the right edge with ${what}`);
    await ctx.close();
  }
  ok = r.finish() && ok;
}

/* -------------------------------------------------------- accumulation --- */
/* Nothing here had ever been run twice. Every suite loads the page, exercises
   it once and closes the context, so anything that grows per re-wire grew
   unobserved: crossing the narrow breakpoint rebuilds the diagrams and
   re-wires the loop scene, and a reader who rotates a tablet, drags a window
   or opens devtools crosses it repeatedly.
   Measured before the fix, at three crossings: rail click handlers 6 -> 42,
   one click on a step firing seven smooth scrolls to the same place; and
   twelve IntersectionObservers created, none disconnected. */
{
  const r = reporter('accumulation — the page re-wired, five times over');
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__io = { made: 0, gone: 0 };
    const IO = window.IntersectionObserver;
    window.IntersectionObserver = class extends IO {
      constructor(...a) { super(...a); window.__io.made += 1; }
      disconnect() { window.__io.gone += 1; return super.disconnect(); }
    };
    /* Counting scrollTo calls is the only honest way to count LIVE handlers.
       A tally of addEventListener grows when a rebuilt element gets a handler
       its detached predecessor also had — which is not a leak, and reading it
       as one accuses working code. The arch diagram's rows look exactly like
       that: 5 -> 35 on the tally, and zero of them still attached to
       anything in the document. */
    window.__scrolls = 0;
    const real = window.scrollTo.bind(window);
    window.scrollTo = (...a) => { window.__scrolls += 1; return real(...a); };
  });
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.waitForTimeout(1200);

  const state = async () => evaluateWithin(page, 15_000, 'accumulation state', () => ({
    live: window.__io.made - window.__io.gone,
    nodes: document.getElementsByTagName('*').length,
    svgs: document.querySelectorAll('svg').length,
    history: history.length,
  }));
  const clickRail = async () => evaluateWithin(page, 15_000, 'rail click', () => {
    window.__scrolls = 0;
    document.querySelector('.rail__item')?.click();
    return window.__scrolls;
  });

  const boot = await state();
  r.equal(await clickRail(), 1, 'a rail click at boot does not scroll exactly once');

  for (let i = 0; i < 5; i += 1) {
    r.step(`crossing ${i + 1}`);
    await page.setViewportSize({ width: 700, height: 900 });
    await page.waitForTimeout(350);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.waitForTimeout(350);
  }
  const after = await state();

  r.equal(await clickRail(), 1, 'after five crossings, one rail click scrolls more than once');
  r.equal(after.live, boot.live, 'live IntersectionObservers after five crossings');
  r.equal(after.nodes, boot.nodes, 'DOM nodes after five crossings');
  r.equal(after.svgs, boot.svgs, 'svg elements after five crossings');

  /* And the same question of the controls that do not rebuild: a hundred and
     twenty clicks must leave the document exactly the size it was. */
  r.step('120 clicks');
  await evaluateWithin(page, 20_000, 'clicks', () => {
    const tabs = [...document.querySelectorAll('.cases__tab')];
    const sw = [...document.querySelectorAll('.switch__btn')];
    const layers = [...document.querySelectorAll('[data-layer]')];
    for (let i = 0; i < 40; i += 1) {
      tabs[i % tabs.length].click();
      sw[i % sw.length].click();
      layers[i % layers.length].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
  });
  await page.waitForTimeout(600);
  const clicked = await state();
  r.equal(clicked.nodes, boot.nodes, 'DOM nodes after 120 clicks');
  r.equal(clicked.live, boot.live, 'live IntersectionObservers after 120 clicks');
  r.equal(clicked.history, boot.history, 'history entries after 120 clicks');
  await ctx.close();
  ok = r.finish() && ok;
}

/* ------------------------------------------------------- forced colors --- */
/* The resilience suite has run in forced colors since it was written, and it
   asked the wrong question: does anything render, is any text transparent, is
   anything past the edge. All three passed while three of the page's selected
   states were, by measurement, indistinguishable from their unselected
   neighbours — because the state was carried by a gradient, and this mode
   drops background images.
   So this suite asks the only question that matters about an indicator: does
   the chosen one look different from the others? Each pair is compared as a
   computed signature, in forced colors and out of it. */
{
  const r = reporter('forced colors — you can still tell what is selected');

  const signature = (el) => {
    const c = getComputedStyle(el);
    const before = getComputedStyle(el, '::before');
    const after = getComputedStyle(el, '::after');
    return [c.color, c.backgroundColor, c.backgroundImage, c.borderColor, c.outlineColor,
      c.fontWeight, c.textDecorationLine,
      before.backgroundColor, before.backgroundImage,
      after.backgroundColor, after.backgroundImage].join(' | ');
  };

  for (const [lang, path] of LANGS) {
    for (const forced of ['active', 'none']) {
      r.step(`${lang} · forcedColors:${forced}`);
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 900 }, colorScheme: 'dark', forcedColors: forced,
      });
      const page = await ctx.newPage();
      await page.goto(base + path, { waitUntil: 'load' });
      await page.waitForTimeout(900);
      /* Into a section, so a nav link is actually current. Measuring at the
         top of the page found none and quietly fell back to the first link —
         which is not current, so the comparison was of one unselected link
         against another and could only ever pass. */
      await evaluateWithin(page, 15_000, 'to loop', () => document.getElementById('loop')?.scrollIntoView());
      await page.waitForTimeout(900);

      const pairs = await evaluateWithin(page, 15_000, 'indicator pairs', (src) => {
        const signature = eval(`(${src})`);
        const pair = (name, on, off) => (on && off
          ? { name, same: signature(on) === signature(off) }
          : { name, missing: true });
        const tabs = [...document.querySelectorAll('.cases__tab')];
        const sw = [...document.querySelectorAll('.switch__btn')];
        const ls = [...document.querySelectorAll('.langswitch__btn')];
        const rail = [...document.querySelectorAll('.rail__item')];
        const nav = [...document.querySelectorAll('.nav__link')];
        const navOn = nav.find((a) => a.getAttribute('aria-current') === 'true');
        return [
          pair('discipline tab', tabs.find((t) => t.getAttribute('aria-selected') === 'true'),
            tabs.find((t) => t.getAttribute('aria-selected') !== 'true')),
          pair('segmented switch', sw.find((b) => b.getAttribute('aria-pressed') === 'true'),
            sw.find((b) => b.getAttribute('aria-pressed') !== 'true')),
          pair('language switch', ls.find((b) => b.getAttribute('aria-current') === 'true'),
            ls.find((b) => b.getAttribute('aria-current') !== 'true')),
          pair('loop rail', rail.find((li) => li.getAttribute('aria-current') === 'true'),
            rail.find((li) => li.getAttribute('aria-current') !== 'true')),
          pair('nav link', navOn, nav.find((a) => a !== navOn)),
        ];
      }, signature.toString());

      for (const p of pairs) {
        r.check(!p.missing, `${p.name}: no pair to compare — the markup moved`);
        if (!p.missing) r.check(!p.same, `${p.name}: selected and unselected are identical`);
      }

      /* The pair comparison is necessary and not sufficient: the discipline
         tab differed pre-fix by font-weight and a 6%-black wash over a black
         canvas, so "not identical" passed while the only thing a reader could
         actually see — the 2px marker — was painting nothing at all. These
         two markers are the page's smallest indicators; they either paint or
         they do not. */
      const markers = await evaluateWithin(page, 15_000, 'markers', () => {
        const paints = (el, pseudo) => {
          if (!el) return null;
          const c = getComputedStyle(el, pseudo);
          if (c.content === 'none') return false;
          const alpha = /rgba\([^)]*,\s*0\)/.test(c.backgroundColor);
          return c.backgroundImage !== 'none' || !alpha;
        };
        const tab = document.querySelector('.cases__tab[aria-selected="true"]');
        const nav = document.querySelector('.nav__link[aria-current="true"]');
        return { tab: paints(tab, '::before'), nav: paints(nav, '::after') };
      });
      r.check(markers.tab !== false, 'the selected discipline tab paints no marker');
      r.check(markers.nav !== false, 'the current nav link paints no underline');
      await ctx.close();
    }
  }
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
    switchLangs: [...document.querySelectorAll('.langswitch__btn')]
      .map((a) => a.getAttribute('lang') ?? a.getAttribute('hreflang') ?? '?').join('|'),
  }));
  r.check(/^zh/.test(stat.lang), `lang is "${stat.lang}"`);
  /* Both switch buttons name their own language, in both directions. The
     zh->en half was added in round 25 and never gated; mutation testing put
     it back and nothing noticed. A fix with no script is this repository's
     own named failure mode. */
  r.equal(stat.switchLangs, 'en|zh-Hans', 'the language switch labels its own languages');
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
