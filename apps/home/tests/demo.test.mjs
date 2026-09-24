#!/usr/bin/env node
/**
 * demo.test.mjs — the scripted demo, operated the way a visitor operates it.
 *
 * Every expectation is read from assets/js/demo.js, so adding a scenario, a
 * source or a claim changes what is asserted without anyone editing this.
 * Both languages; both a reader who allows motion and one who does not.
 *
 *   - nothing is fetched until the reader does something (the first-load
 *     budget does not pay for a demo nobody opened);
 *   - once scrolled to, it mounts, with one tab per scenario;
 *   - arrow keys move between scenarios;
 *   - a run shows every step, then every claim — the withdrawn ones struck
 *     through and marked, the rest citing at least one source;
 *   - every check starts closed (the first render had them all open), and
 *     "Doubt this" opens it with the cited sources, lighting them on the left;
 *   - the button to the app says what every other button to the app says;
 *   - axe finds nothing in the mounted demo; nothing is logged.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { serve, launcher, launchOptions, reporter, ROOT } from './harness.mjs';
import { SCENARIOS, UI } from '../assets/js/demo.js';

const chromium = await launcher();
if (!chromium) { console.log('… demo checks skipped — playwright is not installed'); process.exit(0); }

let axe = null;
try { axe = readFileSync(join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8'); } catch { /* absent */ }

const { base, close } = await serve();
const browser = await chromium.launch(launchOptions());
let ok = true;

const mount = async (page) => {
  await page.evaluate(() => window.scrollBy(0, 1));
  await page.evaluate(() => document.getElementById('demo').scrollIntoView());
  await page.waitForSelector('.demo.is-live', { timeout: 5000 });
};

for (const [lang, path] of [['en', '/'], ['zh', '/zh/']]) {
  /* ---- a reader who prefers less motion: every run is instant ---------- */
  {
    const r = reporter(`demo [${lang}] — load, tabs, run, doubt`);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    const fetched = [];
    page.on('request', (q) => { if (q.url().includes('/demo.js')) fetched.push(q.url()); });

    await page.goto(base + path, { waitUntil: 'load' });
    await page.waitForTimeout(1200);
    r.equal(fetched.length, 0, 'demo.js requests before the reader did anything');
    await mount(page);
    r.equal(fetched.length, 1, 'demo.js requests after scrolling to it');

    /* Each card names a reader and their question, in the order the data
       gives; the topic name is carried by the situation heading instead. */
    const tabs = await page.$$eval('.demo__tab', (ts) => ts.map((t) => `${t.dataset.scenario}:${t.querySelector('.demo__tabwho')?.textContent}:${t.querySelector('.demo__tabask')?.textContent}`));
    r.equal(tabs.join('|'), SCENARIOS.map((s) => `${s.id}:${s[lang].who}:${s[lang].ask}`).join('|'), 'scenario cards');
    r.check(await page.$eval('.demo__note', (n) => n.offsetHeight > 0), 'the "scripted demo" note is not visible');

    await page.focus('.demo__tab[aria-selected="true"]');
    await page.keyboard.press('ArrowRight');
    const moved = await page.evaluate(() => ({
      selected: document.querySelector('.demo__tab[aria-selected="true"]')?.dataset.scenario,
      focused: document.activeElement?.dataset?.scenario,
    }));
    r.check(moved.selected === SCENARIOS[1].id && moved.focused === SCENARIOS[1].id, `ArrowRight: selected ${moved.selected}, focus on ${moved.focused}`);

    for (const s of SCENARIOS) {
      const d = s[lang];
      await page.click(`.demo__tab[data-scenario="${s.id}"]`);
      r.equal(await page.textContent('.demo__task'), d.task, `${s.id}: the task shown`);
      r.equal(await page.$$eval('.demo__src', (x) => x.length), d.sources.length, `${s.id}: sources listed`);
      await page.click('.demo__run');
      await page.waitForSelector('.demo__result:not([hidden])', { timeout: 2000 });

      const shown = await page.evaluate(() => ({
        steps: document.querySelectorAll('.demo__step').length,
        claims: [...document.querySelectorAll('.demo__claim')].map((c) => ({
          ok: c.dataset.ok === 'true',
          struck: !!c.querySelector('.demo__claimtext s'),
          cites: [...c.querySelectorAll('.demo__claimmeta .demo__cite:not(.demo__cite--none)')].map((x) => x.textContent),
          checkOpen: [...c.querySelectorAll('.demo__check')].some((k) => k.offsetHeight > 0),
        })),
        cta: document.querySelector('.demo__next .btn--primary'),
      }));
      r.equal(shown.steps, d.steps.length, `${s.id}: steps shown`);
      r.equal(shown.claims.length, d.claims.length, `${s.id}: claims shown`);
      shown.claims.forEach((c, i) => {
        const want = d.claims[i];
        r.check(c.ok === want.ok && c.struck === !want.ok, `${s.id}: claim ${i + 1} verdict ${c.ok}/struck ${c.struck}`);
        r.equal(c.cites.join(','), want.cites.map((n) => `S${n + 1}`).join(','), `${s.id}: claim ${i + 1} citations`);
        /* Verified claims wait to be doubted; the withdrawn one opens by
           itself — it is the point of the run. */
        r.check(c.checkOpen === !want.ok, `${s.id}: claim ${i + 1}'s check is ${c.checkOpen ? 'open' : 'closed'} (${want.ok ? 'verified — should wait to be asked' : 'withdrawn — should open by itself'})`);
      });

      /* Doubt the first verified claim: its check opens, quoting exactly its
         sources, and those sources light up in the list. */
      const first = d.claims.findIndex((c) => c.ok);
      await page.click(`.demo__claim:nth-child(${first + 1}) .demo__doubt`);
      const doubted = await page.evaluate((n) => {
        const c = document.querySelectorAll('.demo__claim')[n];
        return {
          open: c.querySelector('.demo__check').offsetHeight > 0,
          expanded: c.querySelector('.demo__doubt').getAttribute('aria-expanded'),
          quoted: c.querySelectorAll('.demo__cited li').length,
          lit: [...document.querySelectorAll('.demo__src.is-used')].map((x) => x.dataset.src),
        };
      }, first);
      r.check(doubted.open && doubted.expanded === 'true', `${s.id}: "Doubt this" did not open the check`);
      r.equal(doubted.quoted, d.claims[first].cites.length, `${s.id}: sources quoted in the check`);
      r.equal(doubted.lit.sort().join(','), d.claims[first].cites.map((n) => `S${n + 1}`).sort().join(','), `${s.id}: sources lit`);
    }

    /* The reader's call, and what they take away. Put the withdrawn claim
       back: the strike lifts and the objection stays in view. Then copy the
       note: it carries the answer, the sources and the reader's decision. */
    const last = SCENARIOS[SCENARIOS.length - 1];
    const lastD = last[lang];
    const outAt = lastD.claims.findIndex((c) => !c.ok);
    await page.click(`.demo__claim:nth-child(${outAt + 1}) .demo__decidebtn:nth-child(2)`);
    const overruled = await page.evaluate((n) => {
      const li = document.querySelectorAll('.demo__claim')[n];
      return {
        cls: li.classList.contains('is-overruled'), lifted: !!li.querySelector('s.is-lifted'),
        said: li.querySelector('.demo__decided')?.textContent,
        label: li.querySelector('.demo__verdict strong')?.textContent,
        status: document.querySelector('.demo__status')?.textContent,
      };
    }, outAt);
    r.check(overruled.cls && overruled.lifted && overruled.said === UI[lang].putBackDone, `putting a withdrawn claim back: ${JSON.stringify(overruled)}`);
    /* Nothing on screen may still call it withdrawn once the reader put it
       back — the first version did, twice. */
    r.check(overruled.label?.includes(UI[lang].overruledLabel) && overruled.status === UI[lang].doneBack,
      `after putting it back, the label says "${overruled.label}" and the status "${overruled.status}"`);
    await page.click(`.demo__claim:nth-child(${outAt + 1}) .demo__doubt`);
    const stillSaid = await page.evaluate((n) => (document.querySelectorAll('.demo__claim')[n].querySelector('.demo__decided')?.offsetHeight ?? 0) > 0, outAt);
    r.check(stillSaid, 'the reader’s decision disappears when the check is folded away');
    await page.click('.demo__copy');
    await page.waitForTimeout(200);
    const noteText = await page.evaluate(async () => {
      try { return await navigator.clipboard.readText(); } catch { return document.querySelector('.demo__notetext')?.value ?? ''; }
    });
    r.check(noteText.includes(lastD.headline) && noteText.includes(UI[lang].noteBack) && noteText.includes(UI[lang].noteFoot),
      `the copied note is missing the answer, the reader's decision or the sample label: "${noteText.slice(0, 80)}"`);

    const cta = await page.$eval('.demo__next .btn--primary', (a) => ({ href: a.href, text: a.textContent.trim() }));
    const hero = await page.$eval('.hero .btn--primary', (a) => ({ href: a.href, text: a.textContent.trim() }));
    r.check(cta.href === hero.href && cta.text === hero.text && cta.text === UI[lang].cta, `app button: "${cta.text}" ${cta.href} vs hero "${hero.text}" ${hero.href}`);

    if (axe) {
      await page.route('**/__axe.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: axe }));
      await page.addScriptTag({ url: '/__axe.js' });
      const res = await page.evaluate(async () => window.axe.run('#demo', {
        resultTypes: ['violations'],
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
      }));
      res.violations.forEach((v) => r.check(false, `axe: ${v.impact} ${v.id} — ${v.nodes.length} node(s): ${v.nodes.slice(0, 2).map((n) => n.target.join(' ') + ' ' + (n.any[0]?.message ?? '')).join(' ; ')}`));
    } else r.note('axe-core not installed — the accessibility pass was skipped');

    r.equal(errors.length, 0, `console errors: ${errors.slice(0, 2).join(' | ')}`);
    await ctx.close();
    ok = r.finish() && ok;
  }

  /* ---- a report's own sentence, when one has been read ---------------- */
  /* Each registered finding renders as the register holds it: the sentence
     (with an ellipsis where it was cut from inside a longer one), the source
     linked, whom it describes, and on /zh/ a translation marked as one. A
     PDF source also shows its page; the registered ones are web pages, so
     that is proved on a fixture injected in transit into a scenario that
     has no finding — and a scenario with none shows nothing. */
  {
    const r = reporter(`demo [${lang}] — a report's own sentence, as registered`);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const bare = SCENARIOS.filter((x) => !x.en.research);
    const fixture = { src: 'fixture', quote: 'Only 37 percent report EBIT impact.', firm: 'Fixture & Co', title: 'A report', date: '2026-08', url: 'https://example.com/report.pdf', page: 3, about: 'A survey of executives.' };
    await page.route('**/assets/js/demo.js', async (route) => {
      const res = await route.fetch();
      const id = bare[0].id;
      const body = (await res.text())
        .replace(`id: '${id}',\n    en: {\n`, `id: '${id}',\n    en: {\n      research: ${JSON.stringify(fixture)},\n`)
        .replace(new RegExp(`(id: '${id}',[\\s\\S]*?\\n    zh: \\{\\n)`), `$1      research: ${JSON.stringify({ ...fixture, gloss: '只有 37% 报告了影响。', about: '对高管的调查。' })},\n`);
      await route.fulfill({ response: res, body });
    });
    await page.goto(base + path, { waitUntil: 'load' });
    await mount(page);
    const read = () => page.evaluate(() => {
      const f = document.querySelector('.demo__research');
      return f && { quote: f.querySelector('.demo__rquote')?.textContent, gloss: f.querySelector('.demo__rgloss')?.textContent ?? null,
        href: f.querySelector('a')?.getAttribute('href'), caption: f.querySelector('.demo__rsource')?.textContent,
        about: f.querySelector('.demo__rabout')?.textContent };
    });
    for (const s of SCENARIOS.filter((x) => x.en.research)) {
      const want = s[lang].research;
      await page.click(`.demo__tab[data-scenario="${s.id}"]`);
      const got = await read();
      const q = `${/^[a-z]/.test(want.quote) ? '…' : ''}${want.quote}${/[.!?]$/.test(want.quote) ? '' : '…'}`;
      r.check(got?.quote === `“${q}”`, `${s.id}: the quote shown — ${got?.quote?.slice(0, 60)}`);
      r.check(got?.href === want.url && got.caption.includes(want.firm) && got.caption.includes(want.date) && got.about === want.about, `${s.id}: the source line — ${JSON.stringify(got)}`);
      r.check(lang === 'zh' ? got?.gloss?.includes(want.gloss) : got?.gloss === null, `${s.id}: the translation line on /${lang}: ${got?.gloss}`);
    }
    await page.click(`.demo__tab[data-scenario="${bare[0].id}"]`);
    const fx = await read();
    r.check(fx?.caption.includes(UI[lang].page(3)), `a PDF source shows its page: ${fx?.caption}`);
    await page.click(`.demo__tab[data-scenario="${bare[1].id}"]`);
    r.equal(await page.$$eval('.demo__research', (x) => x.length), 0, 'research blocks on a scenario with no registered finding');
    await ctx.close();
    ok = r.finish() && ok;
  }

  /* ---- a scenario can be linked to ------------------------------------- */
  {
    const r = reporter(`demo [${lang}] — a scenario can be linked to`);
    const pick = SCENARIOS[SCENARIOS.length - 1];
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    const before = await page.goto(`${base}${path}#demo-${pick.id}`, { waitUntil: 'load' }).then(() => page.evaluate(() => history.length));
    await page.waitForSelector('.demo.is-live', { timeout: 6000 }).catch(() => {});
    const opened = await page.evaluate(() => document.querySelector('.demo__tab[aria-selected="true"]')?.dataset.scenario ?? 'never mounted');
    r.equal(opened, pick.id, `/#demo-${pick.id} opened on`);
    await page.click(`.demo__tab[data-scenario="${SCENARIOS[0].id}"]`);
    await page.click(`.demo__tab[data-scenario="${SCENARIOS[1].id}"]`);
    const after = await page.evaluate(() => ({ hash: location.hash, len: history.length }));
    r.equal(after.hash, `#demo-${SCENARIOS[1].id}`, 'the address after choosing a scenario');
    r.equal(after.len, before, 'history entries added by choosing scenarios');
    await ctx.close();
    ok = r.finish() && ok;
  }

  /* ---- with motion: the run plays out, and can't be started twice ------ */
  {
    const r = reporter(`demo [${lang}] — the animated run, on a phone`);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const page = await ctx.newPage();
    await page.goto(base + path, { waitUntil: 'load' });
    await mount(page);
    /* On a phone the button once sat below all five sources, a thousand
       pixels after the task it answers. */
    const order = await page.evaluate(() => ({
      run: document.querySelector('.demo__run').getBoundingClientRect().top,
      source: document.querySelector('.demo__src').getBoundingClientRect().top,
    }));
    r.check(order.run < order.source, `the run button is ${Math.round(order.run - order.source)}px below the first source`);
    await page.tap('.demo__run');
    await page.waitForTimeout(300);
    const mid = await page.evaluate(() => ({
      disabled: document.querySelector('.demo__run').disabled,
      steps: document.querySelectorAll('.demo__step').length,
      result: !document.querySelector('.demo__result').hidden,
    }));
    r.check(mid.disabled && mid.steps >= 1 && !mid.result, `mid-run: disabled ${mid.disabled}, ${mid.steps} steps, result shown ${mid.result}`);
    await page.waitForSelector('.demo__result:not([hidden])', { timeout: 8000 });
    const end = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - innerWidth,
      small: [...document.querySelectorAll('#demo button, #demo a[href]')].filter((e) => e.offsetWidth && (e.offsetWidth < 44 || e.offsetHeight < 44)).map((e) => e.textContent.trim().slice(0, 12)),
    }));
    r.check(end.overflow <= 0, `the page scrolls sideways by ${end.overflow}px`);
    r.equal(end.small.length, 0, `touch targets under 44px: ${end.small.join(' | ')}`);
    await ctx.close();
    ok = r.finish() && ok;
  }
}

await browser.close(); close();
if (!ok) process.exit(1);
console.log('demo checks passed');
