#!/usr/bin/env node
/**
 * eval.mjs — the acceptance set. Turns "is the site good" into a number out of
 * 10, per language, from cases a browser can actually measure.
 *
 * Ten dimensions, one point each; five cases per dimension, equal weight inside
 * it. A case returns 1 (pass), 0 (fail) or anything between for graded ones.
 * Every case runs against BOTH /  and /zh/, and the headline score is the
 * LOWER of the two: a site that is excellent in English and mediocre in
 * Chinese is a mediocre site for half its readers.
 *
 * What this is not: it measures what these cases measure. It cannot tell
 * whether the argument persuades, whether the brand feels right, or how the
 * page looks in Safari on the owner's phone. It is the floor a change must not
 * go below, not the ceiling of what "good" means.
 *
 *   node tests/eval/eval.mjs            print the score card
 *   node tests/eval/eval.mjs --record   also append to docs/eval/history.json
 *   node tests/eval/eval.mjs --min 9    exit 1 if either language is below 9
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { serve, launcher, launchOptions, ROOT } from '../harness.mjs';

const chromium = await launcher();
if (!chromium) { console.log('… eval skipped — playwright is not installed'); process.exit(0); }
const { devices } = await import('playwright');

const args = process.argv.slice(2);
const MIN = args.includes('--min') ? Number(args[args.indexOf('--min') + 1]) : null;
const RECORD = args.includes('--record');
const LANGS = [['en', '/'], ['zh', '/zh/']];

const clamp = (x) => Math.max(0, Math.min(1, x));
/* Linear grade: `good` or better scores 1, `bad` or worse scores 0. */
const grade = (v, good, bad) => clamp((bad - v) / (bad - good));
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const sources = (() => { try { return JSON.parse(read('assets/img/.sources.json')); } catch { return {}; } })();
const assetMap = read('scripts/check-assets.mjs');

/* ---- the cases ----------------------------------------------------------- */
/* Each: [id, dimension, description, fn(ctx) -> 0..1 | {score, note}] */
const inView = (sel) => (s) => {
  const e = document.querySelector(s); if (!e) return false;
  const b = e.getBoundingClientRect();
  return b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth && b.height > 0;
};

/* The page scrolls smoothly, and a jump across 15 000 px takes well over a
   second: a fixed wait read the page mid-flight. Wait until it stops. */
const settle = (page) => page.evaluate(() => new Promise((done) => {
  let last = -1; let still = 0;
  const tick = () => { if (Math.abs(scrollY - last) < 1) still += 1; else still = 0; last = scrollY; if (still >= 8) done(); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}));

/* The rendered lines of an element: the text, split where the browser
   actually wrapped it (a character whose box starts lower than the one
   before it begins a new line). */
const LINES = () => {
  window.__lines = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const lines = []; let cur = ''; let lastTop = null;
    const r = document.createRange();
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      for (let i = 0; i < n.textContent.length; i += 1) {
        r.setStart(n, i); r.setEnd(n, i + 1);
        const b = r.getClientRects()[0];
        if (!b || !b.width) { cur += n.textContent[i]; continue; }
        if (lastTop !== null && b.top > lastTop + b.height * 0.5) { lines.push(cur); cur = ''; }
        lastTop = b.top; cur += n.textContent[i];
      }
    }
    lines.push(cur);
    return lines.map((l) => l.replace(/\u200b/g, '').replace(/\s+/g, ' ').trim()).filter(Boolean);
  };
};

const CASES = [
  /* 1 · first impression — what a visitor sees before scrolling */
  ['fold.h1.desk', '首屏', 'Headline fully visible on a 1280×800 screen',
    async (c) => +(await c.desk.evaluate(inView(), 'h1'))],
  ['fold.cta.desk', '首屏', 'Primary call to action visible on a 1280×800 screen',
    async (c) => +(await c.desk.evaluate(inView(), '.hero__actions .btn--primary'))],
  ['fold.h1.phone', '首屏', 'Headline fully visible on an iPhone 13',
    async (c) => +(await c.phone.evaluate(inView(), 'h1'))],
  ['fold.cta.phone', '首屏', 'Primary call to action visible without scrolling on an iPhone 13',
    async (c) => +(await c.phone.evaluate(inView(), '.hero__actions .btn--primary'))],
  ['fold.value.phone', '首屏', 'The one-sentence value proposition visible without scrolling on an iPhone 13',
    async (c) => +(await c.phone.evaluate(inView(), '.hero__sub'))],

  /* 2 · navigation */
  ['nav.coverage', '导航', 'Every titled section is reachable from the nav or the footer',
    async (c) => c.desk.evaluate(() => {
      const ids = [...document.querySelectorAll('main section[id]')].filter((s) => s.querySelector(':scope h2, :scope > .wrap h2, h2')).map((s) => s.id);
      const linked = new Set([...document.querySelectorAll('.nav a[href^="#"], footer a[href^="#"]')].map((a) => a.getAttribute('href').slice(1)));
      const missing = ids.filter((id) => !linked.has(id));
      return { score: 1 - missing.length / Math.max(1, ids.length), note: missing.length ? `unlinked: ${missing.join(', ')}` : '' };
    })],
  ['nav.current', '导航', 'Scrolling to a section marks its nav link as current',
    async (c) => {
      const targets = await c.desk.evaluate(() => [...document.querySelectorAll('.nav__link[href^="#"]')].map((a) => a.getAttribute('href')));
      let ok = 0; const sample = targets.slice(0, 4);
      for (const h of sample) {
        await c.desk.evaluate((h) => document.querySelector(h)?.scrollIntoView({ block: 'start' }), h);
        await settle(c.desk);
        ok += await c.desk.evaluate((h) => document.querySelector(`.nav__link[href="${h}"]`)?.getAttribute('aria-current') === 'true', h) ? 1 : 0;
      }
      await c.desk.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' })); await settle(c.desk);
      return { score: ok / sample.length, note: `${ok}/${sample.length}` };
    }],
  ['nav.langswitch.keeps.place', '导航', 'Switching language from inside a section lands on the same section',
    async (c) => {
      await c.desk.evaluate(() => { location.hash = '#architecture'; });
      await c.desk.waitForTimeout(100); await settle(c.desk);
      const href = await c.desk.evaluate(() => {
        const a = [...document.querySelectorAll('.langswitch__btn')].find((b) => b.getAttribute('aria-current') !== 'true');
        return a ? a.href : '';
      });
      await c.desk.evaluate(() => { history.replaceState(null, '', location.pathname); window.scrollTo({ top: 0, behavior: 'instant' }); }); await settle(c.desk);
      return { score: +href.endsWith('#architecture'), note: href.replace(/^https?:\/\/[^/]+/, '') };
    }],
  ['nav.hint.keeps.place', '导航', 'The "also in the other language" offer lands on the same section too',
    async (c) => {
      /* The offer appears when the browser prefers the other language, so it
         is opened with that preference. */
      const ctx = await c.browser.newContext({ viewport: { width: 1280, height: 800 }, locale: c.lang === 'zh' ? 'en-US' : 'zh-CN' });
      const p = await ctx.newPage();
      await p.goto(`${c.base}${c.path}#architecture`, { waitUntil: 'load' });
      await p.waitForTimeout(400); await settle(p);
      await p.evaluate(() => window.scrollBy(0, 1)); await p.waitForTimeout(200);
      const href = await p.evaluate(() => document.querySelector('.langhint__go')?.getAttribute('href') || 'no offer');
      await ctx.close();
      return { score: +href.endsWith('#architecture'), note: href };
    }],
  ['nav.skip', '导航', 'The skip link is the first focusable element and targets <main>',
    async (c) => c.desk.evaluate(() => {
      const first = [...document.querySelectorAll('a[href], button, [tabindex="0"]')][0];
      const target = first && document.querySelector(first.getAttribute('href') || '#none');
      return +(!!first && first.classList.contains('skip-link') && target?.tagName === 'MAIN');
    })],
  ['nav.home', '导航', 'The logo links back to the top of the page',
    async (c) => c.desk.evaluate(() => {
      const a = document.querySelector('.nav .brand__home, .nav a.brand');
      return +(!!a && /^(#top|\/|\/zh\/|\.\/)$/.test(a.getAttribute('href')));
    })],

  /* 3 · accessibility */
  ['a11y.axe', '可访问性', 'axe-core: WCAG 2.1 AA + best practice, zero violations',
    async (c) => {
      await c.desk.addScriptTag({ url: '/__axe.js' });
      const v = await c.desk.evaluate(async () => (await window.axe.run(document, { resultTypes: ['violations'], runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] } })).violations.map((x) => x.id));
      return { score: clamp(1 - v.length / 5), note: v.join(', ') };
    }],
  ['a11y.focus', '可访问性', 'Every interactive element shows a visible focus indicator',
    async (c) => {
      const res = await c.desk.evaluate(() => {
        const els = [...document.querySelectorAll('.nav a, .hero a, .btn, .switch__btn, .cases__tab, summary')].filter((e) => e.offsetWidth);
        let bad = [];
        for (const e of els.slice(0, 30)) {
          const before = getComputedStyle(e); const b = [before.outlineStyle, before.outlineWidth, before.boxShadow].join();
          e.focus({ focusVisible: true });
          const a = getComputedStyle(e); const after = [a.outlineStyle, a.outlineWidth, a.boxShadow].join();
          if (after === b || (a.outlineStyle === 'none' && a.boxShadow === 'none')) bad.push(e.textContent.trim().slice(0, 12));
          e.blur();
        }
        return { n: Math.min(30, els.length), bad };
      });
      return { score: 1 - res.bad.length / res.n, note: res.bad.slice(0, 3).join(' | ') };
    }],
  ['a11y.reduced', '可访问性', 'With reduced motion requested, nothing animates indefinitely',
    async (c) => {
      const n = await c.reduced.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity).length);
      return { score: +(n === 0), note: n ? `${n} infinite animations` : '' };
    }],
  ['a11y.reduced.story', '可访问性', 'With reduced motion, the trust diagram still shows what its caption describes: a failing check caught and rolled back',
    async (c) => c.reduced.evaluate(() => {
      const d = document.querySelector('.d-harness'); if (!d) return { score: 0, note: 'no diagram' };
      const parts = [d.querySelector('.d-harness__rollback')?.getAttribute('data-on') === 'true', !!d.querySelector('.d-harness__gate[data-state="fail"]')];
      return { score: parts.filter(Boolean).length / 2, note: parts.join(',') };
    })],
  ['a11y.svgcontrast', '可访问性', 'Diagram labels reach 4.5:1 against the page (axe does not look inside SVG)',
    async (c) => c.desk.evaluate(() => {
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const bg = [8, 7, 11];
      const bad = [];
      const texts = [...document.querySelectorAll('main svg text')].filter((t) => t.getBBox().width > 0 && t.textContent.trim() && !t.closest('[aria-hidden="true"] [aria-hidden="true"]'));
      for (const t of texts) {
        const cs = getComputedStyle(t); const m = cs.fill.match(/[\d.]+/g); if (!m) continue;
        let a = parseFloat(cs.fillOpacity ?? 1) * (m[3] !== undefined ? +m[3] : 1);
        for (let e = t; e && e.tagName !== 'svg'; e = e.parentElement) a *= parseFloat(getComputedStyle(e).opacity);
        if (a < 0.05) continue;   // not shown yet (a reveal still pending), not low-contrast
        const col = [0, 1, 2].map((i) => +m[i] * a + bg[i] * (1 - a));
        const ratio = (lum(col) + 0.05) / (lum(bg) + 0.05);
        if (ratio < 4.5) bad.push(`${t.textContent.trim().slice(0, 12)} ${ratio.toFixed(1)}`);
      }
      return { score: 1 - bad.length / Math.max(1, texts.length), note: `${bad.length}/${texts.length}: ${bad.slice(0, 3).join(' | ')}` };
    })],
  ['a11y.headings', '可访问性', 'One h1, and no heading level is skipped',
    async (c) => c.desk.evaluate(() => {
      const hs = [...document.querySelectorAll('h1,h2,h3,h4')].map((h) => +h.tagName[1]);
      let skips = 0; for (let i = 1; i < hs.length; i += 1) if (hs[i] > hs[i - 1] + 1) skips += 1;
      return +(hs.filter((x) => x === 1).length === 1 && skips === 0);
    })],
  ['a11y.lang.runs', '可访问性', 'Text in the other language is marked with its own lang attribute',
    async (c) => c.desk.evaluate((lang) => {
      const other = lang === 'zh' ? /\b[A-Za-z]{3,}(\s+[A-Za-z]{3,}){3,}/ : /[一-鿿]{2,}/;
      const bad = [...document.querySelectorAll('body *')].filter((e) => [...e.childNodes].some((n) => n.nodeType === 3 && other.test(n.textContent)))
        .filter((e) => !e.closest(`[lang]:not([lang^="${lang}"])`) && !e.closest('script, style, svg'));
      return { score: +(bad.length === 0), note: bad.slice(0, 3).map((e) => e.textContent.trim().slice(0, 20)).join(' | ') };
    }, c.lang)],

  /* 4 · performance (desktop, compressed, cold) */
  ['perf.lcp', '性能', 'Largest contentful paint (desktop, cold): ≤ 600 ms full marks, ≥ 1500 ms zero',
    async (c) => ({ score: grade(c.metrics.lcp, 600, 1500), note: `${Math.round(c.metrics.lcp)} ms` })],
  ['perf.cls', '性能', 'Cumulative layout shift: ≤ 0.01 full marks, ≥ 0.1 zero',
    async (c) => ({ score: grade(c.metrics.cls, 0.01, 0.1), note: c.metrics.cls.toFixed(3) })],
  ['perf.weight', '性能', 'Transfer on first load: ≤ 150 KB full marks, ≥ 220 KB zero',
    async (c) => ({ score: grade(c.metrics.kb, 150, 220), note: `${c.metrics.kb.toFixed(1)} KB` })],
  ['perf.requests', '性能', 'Requests on first load: ≤ 15 full marks, ≥ 30 zero',
    async (c) => ({ score: grade(c.metrics.requests, 15, 30), note: `${c.metrics.requests}` })],
  ['perf.imgsize', '性能', 'Every image declares its size, so it cannot shift the layout',
    async (c) => c.desk.evaluate(() => { const bad = [...document.images].filter((i) => !i.getAttribute('width') || !i.getAttribute('height')); return +(bad.length === 0); })],

  /* 5 · mobile */
  ['mob.overflow', '移动端', 'No sideways scroll on iPhone SE (320) or iPhone 13',
    async (c) => { const a = await c.se.evaluate(() => document.documentElement.scrollWidth - innerWidth); const b = await c.phone.evaluate(() => document.documentElement.scrollWidth - innerWidth); return +(a <= 0 && b <= 0); }],
  ['mob.targets', '移动端', 'Every visible touch target is at least 44×44',
    async (c) => c.phone.evaluate(() => {
      const els = [...document.querySelectorAll('a[href], button, summary, [role="tab"]')].filter((e) => e.offsetWidth && !e.closest('[hidden], .nav__links, .nav__actions') && !e.classList.contains('skip-link') && !e.closest('svg') && parseFloat(getComputedStyle(e).opacity) > 0.05 && getComputedStyle(e).visibility !== 'hidden');
      const small = els.filter((e) => e.offsetWidth < 44 || e.offsetHeight < 44);
      return { score: 1 - small.length / els.length, note: small.slice(0, 3).map((e) => `${e.textContent.trim().slice(0, 10)} ${e.offsetWidth}×${e.offsetHeight}`).join(' | ') };
    })],
  ['mob.textfloor', '移动端', 'No text under 12px on a phone',
    async (c) => c.phone.evaluate(() => {
      const t = [...document.querySelectorAll('body *')].filter((e) => !e.closest('svg, .visually-hidden') && e.offsetWidth && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1));
      const tiny = t.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 12);
      return { score: 1 - tiny.length / t.length, note: tiny.length ? `${tiny.length} elements, e.g. ${tiny[0].className || tiny[0].tagName}` : '' };
    })],
  ['mob.linelen', '移动端', 'Body text lines are comfortable on a phone (not wider than the screen minus margins)',
    async (c) => c.phone.evaluate(() => { const ps = [...document.querySelectorAll('main p')].filter((p) => p.offsetWidth && !p.closest('.visually-hidden')); const bad = ps.filter((p) => p.getBoundingClientRect().left < 12 || p.getBoundingClientRect().right > innerWidth - 12); return { score: 1 - bad.length / ps.length, note: bad.length ? `${bad.length} paragraphs touch the edge` : '' }; })],
  ['mob.menu', '移动端', 'The menu opens with a tap and closes when a link is tapped',
    async (c) => {
      await c.phone.tap('.nav__burger'); await c.phone.waitForTimeout(400);
      const open = await c.phone.evaluate(() => document.querySelector('.nav__burger').getAttribute('aria-expanded'));
      await c.phone.tap('.nav__links a[href^="#"]'); await c.phone.waitForTimeout(600);
      const shut = await c.phone.evaluate(() => document.querySelector('.nav__burger').getAttribute('aria-expanded'));
      await c.phone.evaluate(() => window.scrollTo(0, 0)); await c.phone.waitForTimeout(300);
      return +(open === 'true' && shut === 'false');
    }],

  /* 6 · bilingual */
  ['bi.htmllang', '双语', 'The document declares its own language',
    async (c) => c.desk.evaluate((lang) => +(document.documentElement.lang.startsWith(lang)), c.lang)],
  ['bi.hreflang', '双语', 'hreflang names both languages and x-default',
    async (c) => c.desk.evaluate(() => { const h = [...document.querySelectorAll('link[rel="alternate"][hreflang]')].map((l) => l.hreflang); return +(['en', 'zh-Hans', 'x-default'].every((x) => h.includes(x))); })],
  ['bi.nomixed', '双语', 'No visible sentence left in the other language',
    async (c) => c.desk.evaluate((lang) => {
      const text = [...document.querySelectorAll('main p, main li, main h2, main h3, main dd, main summary')].filter((e) => e.offsetWidth || e.closest('details')).map((e) => e.textContent);
      const bad = lang === 'zh' ? text.filter((t) => /\b[A-Za-z]+(\s+[A-Za-z,’']+){5,}/.test(t)) : text.filter((t) => /[一-鿿]/.test(t));
      return { score: +(bad.length === 0), note: bad.slice(0, 2).map((t) => t.trim().slice(0, 30)).join(' | ') };
    }, c.lang)],
  ['bi.meta', '双语', 'Title, description and social card text are in this language',
    async (c) => c.desk.evaluate((lang) => {
      const han = (s) => /[一-鿿]/.test(s || '');
      const vals = [document.title, document.querySelector('meta[name="description"]')?.content, document.querySelector('meta[property="og:title"]')?.content, document.querySelector('meta[property="og:description"]')?.content, document.querySelector('meta[property="og:image:alt"]')?.content];
      const ok = vals.filter((v) => (lang === 'zh' ? han(v) : !han(v)));
      return { score: ok.length / vals.length, note: `${ok.length}/${vals.length}` };
    }, c.lang)],
  ['bi.samedesign', '双语', 'Every heading is the same size in both languages (Han may be up to 20% smaller, never larger)',
    async (c) => {
      const sizes = (page) => page.evaluate(() => [...document.querySelectorAll('h1, h2, h3, h4')].map((h) => parseFloat(getComputedStyle(h).fontSize)));
      const ctx = await c.browser.newContext({ viewport: { width: 1280, height: 800 } });
      const other = await ctx.newPage();
      await other.goto(`${c.base}${c.lang === 'zh' ? '/' : '/zh/'}`, { waitUntil: 'load' });
      const [mine, theirs] = [await sizes(c.desk), await sizes(other)];
      await ctx.close();
      const [en, zh] = c.lang === 'zh' ? [theirs, mine] : [mine, theirs];
      const bad = en.map((e, i) => [e, zh[i], i]).filter(([e, z]) => !(z / e >= 0.8 && z / e <= 1.02));
      return { score: 1 - bad.length / en.length, note: bad.slice(0, 3).map(([e, z, i]) => `#${i} ${e}→${z}px`).join(' | ') };
    }],
  ['bi.cardimage', '双语', 'The social card image is the one made for this language',
    async (c) => c.desk.evaluate((lang) => { const u = document.querySelector('meta[property="og:image"]')?.content || ''; return +(lang === 'zh' ? /og-zh\./.test(u) : /\/og\./.test(u)); }, c.lang)],

  /* 7 · brand */
  ['brand.header', '品牌', 'The header shows the product logo, and it loaded',
    async (c) => c.desk.evaluate(() => { const i = document.querySelector('.nav .brand__logo'); return +(!!i && i.complete && i.naturalWidth > 0); })],
  ['brand.footer', '品牌', 'The footer shows the product logo',
    async (c) => c.desk.evaluate(() => +(!!document.querySelector('footer .brand__logo'))) ],
  ['brand.favicon', '品牌', 'The browser-tab icon is made from the product logo',
    async () => +(/'favicon\.(svg|png)'\s*:\s*\[[^\]]*\.\.\/web\/public\/(workspacex-logo|apple-icon)\.png/.test(assetMap))],
  ['brand.touchicon', '品牌', 'The home-screen icon is made from the product logo',
    async () => +(/'apple-touch-icon\.png'\s*:\s*\[[^\]]*\.\.\/web\/public\/(workspacex-logo|apple-icon)\.png/.test(assetMap))],
  ['brand.card', '品牌', 'The social card carries the product logo',
    async () => +(/'og\.jpg'\s*:\s*\[[^\]]*\.\.\/web\/public\/(workspacex-logo|apple-icon)\.png/.test(assetMap))],

  /* 8 · search and sharing */
  ['seo.title', '搜索与分享', 'Title length suits a results page (en 30–65 chars, zh 12–32)',
    async (c) => c.desk.evaluate((lang) => { const n = [...document.title].length; const [lo, hi] = lang === 'zh' ? [12, 32] : [30, 65]; return { score: +(n >= lo && n <= hi), note: `${n}` }; }, c.lang)],
  ['seo.desc', '搜索与分享', 'Description length suits a results page (en 110–160, zh 45–85)',
    async (c) => c.desk.evaluate((lang) => { const n = [...(document.querySelector('meta[name="description"]')?.content || '')].length; const [lo, hi] = lang === 'zh' ? [45, 85] : [110, 160]; return { score: +(n >= lo && n <= hi), note: `${n}` }; }, c.lang)],
  ['seo.og', '搜索与分享', 'Social card has title, description, image, image alt and url',
    async (c) => c.desk.evaluate(() => { const need = ['og:title', 'og:description', 'og:image', 'og:image:alt', 'og:url']; const have = need.filter((p) => document.querySelector(`meta[property="${p}"]`)?.content); return have.length / need.length; })],
  ['seo.jsonld', '搜索与分享', 'Structured data parses and names the organisation, its site and its logo',
    async (c) => c.desk.evaluate(() => {
      try {
        const all = [...document.querySelectorAll('script[type="application/ld+json"]')].flatMap((s) => { const j = JSON.parse(s.textContent); return j['@graph'] || [j]; });
        const org = all.find((x) => /Organization/.test(x['@type']));
        const parts = [!!org, !!org?.name, !!org?.url, !!org?.logo];
        return { score: parts.filter(Boolean).length / parts.length, note: org ? `logo: ${JSON.stringify(org.logo)?.slice(0, 50)}` : 'no Organization' };
      } catch (e) { return { score: 0, note: 'does not parse' }; }
    })],
  ['seo.canonical', '搜索与分享', 'Canonical URL points at this page',
    async (c) => c.desk.evaluate((path) => { const u = document.querySelector('link[rel="canonical"]')?.href || ''; return +(new URL(u).pathname === path); }, c.path)],

  /* 9 · conversion */
  ['conv.routes', '转化', 'Sign-up is reachable from the nav, the hero and the closing section',
    async (c) => c.desk.evaluate(() => { const at = (s) => [...document.querySelectorAll(`${s} a[href*="devapp"]`)].length > 0; const parts = [at('.nav'), at('.hero'), at('#contact')]; return parts.filter(Boolean).length / 3; })],
  ['conv.contact', '转化', 'A human contact is one click away in the footer',
    async (c) => c.desk.evaluate(() => +(!!document.querySelector('footer a[href^="mailto:"]')))],
  ['conv.doors', '转化', 'The closing section offers a route for each kind of visitor (four)',
    async (c) => c.desk.evaluate(() => +(document.querySelectorAll('#contact .door').length === 4))],
  ['conv.onelabel', '转化', 'One destination, one name: every primary button to the same place says the same thing',
    async (c) => c.desk.evaluate(() => {
      const by = new Map();
      for (const a of document.querySelectorAll('a.btn--primary')) {
        const k = a.href; const t = a.textContent.replace(/\s+/g, ' ').trim();
        by.set(k, (by.get(k) || new Set()).add(t));
      }
      const bad = [...by].filter(([, ts]) => ts.size > 1);
      return { score: +(bad.length === 0), note: bad.map(([h, ts]) => `${h.replace(/^https?:\/\//, '')}: ${[...ts].join(' / ')}`).join(' ; ') };
    })],
  ['conv.mailto', '转化', 'A button that opens the mail client says so, with the address',
    async (c) => c.desk.evaluate(() => {
      const bs = [...document.querySelectorAll('a.btn[href^="mailto:"]')];
      const bad = bs.filter((b) => !b.textContent.includes(b.getAttribute('href').slice(7).split('?')[0]));
      return { score: bs.length ? 1 - bad.length / bs.length : 1, note: bad.map((b) => b.textContent.trim().slice(0, 30)).join(' | ') };
    })],
  ['conv.faq', '转化', 'The FAQ answers data, open source, security, training and free tier',
    async (c) => c.desk.evaluate(() => { const q = [...document.querySelectorAll('.faq__item summary')].map((s) => s.textContent.toLowerCase()).join(' '); const topics = [/data|数据/, /open source|开源/, /security|安全/, /train|训练/, /free|免费/]; return topics.filter((t) => t.test(q)).length / topics.length; })],
  ['conv.ctaverb', '转化', 'Every primary button starts with a verb the reader can act on',
    async (c) => c.desk.evaluate((lang) => { const b = [...document.querySelectorAll('.btn--primary')].map((x) => x.textContent.trim()); const ok = b.filter((t) => (lang === 'zh' ? /^(免费)?(进入|注册|开始|试|打开|联系)/.test(t) : /^(Launch|Sign|Start|Try|Open|Get|Talk|Book)/.test(t))); return { score: ok.length / b.length, note: b.join(' | ') }; }, c.lang)],

  /* 10 · readability */
  ['read.sentence', '可读性', 'Average sentence length (en ≤ 20 words full marks, ≥ 30 zero; zh ≤ 40 chars, ≥ 65 zero)',
    async (c) => ({ score: c.lang === 'zh' ? grade(c.text.avg, 40, 65) : grade(c.text.avg, 20, 30), note: c.text.avg.toFixed(1) })],
  ['read.long', '可读性', 'Share of very long sentences (en > 35 words, zh > 80 chars): ≤ 5% full marks, ≥ 25% zero',
    async (c) => ({ score: grade(c.text.longPct, 5, 25), note: `${c.text.longPct.toFixed(1)}%` })],
  ['read.lead', '可读性', 'Every section lead fits in a glance (en ≤ 45 words, zh ≤ 90 chars)',
    async (c) => c.desk.evaluate((lang) => { const ls = [...document.querySelectorAll('.section__head .lead')]; const n = (t) => (lang === 'zh' ? [...t.replace(/\s/g, '')].length : t.trim().split(/\s+/).length); const bad = ls.filter((l) => n(l.textContent) > (lang === 'zh' ? 90 : 45)); return { score: 1 - bad.length / ls.length, note: `${bad.length}/${ls.length} too long` }; }, c.lang)],
  ['read.para', '可读性', 'No paragraph is a wall (en ≤ 90 words, zh ≤ 180 chars)',
    async (c) => c.desk.evaluate((lang) => { const ps = [...document.querySelectorAll('main p')]; const n = (t) => (lang === 'zh' ? [...t.replace(/\s/g, '')].length : t.trim().split(/\s+/).length); const bad = ps.filter((p) => n(p.textContent) > (lang === 'zh' ? 180 : 90)); return { score: 1 - bad.length / ps.length, note: `${bad.length}/${ps.length} too long` }; }, c.lang)],
  ['read.wordsplit', '可读性', 'No heading wraps inside a word (zh: at a word boundary; en: never before a dash)',
    async (c) => {
      let bad = [];
      for (const page of [c.desk, c.phone]) {
        await page.evaluate(LINES);
        bad = bad.concat(await page.evaluate((lang) => {
          const seg = new Intl.Segmenter('zh', { granularity: 'word' });
          const out = [];
          for (const h of document.querySelectorAll('main h1, main h2, main h3, main summary')) {
            if (!h.offsetWidth) continue;
            const ls = window.__lines(h);
            for (let i = 1; i < ls.length; i += 1) {
              const a = ls[i - 1]; const b = ls[i];
              if (/^[—–]/.test(b)) { out.push(`…${a.slice(-4)} / ${b.slice(0, 4)}…`); continue; }
              if (lang !== 'zh' || !/\p{Script=Han}$/u.test(a) || !/^\p{Script=Han}/u.test(b)) continue;
              const joined = a.slice(-6) + b.slice(0, 6);
              const cut = a.slice(-6).length;
              const at = [...seg.segment(joined)].some((x) => x.index === cut);
              if (!at) out.push(`${a.slice(-3)}/${b.slice(0, 3)}`);
            }
          }
          return out;
        }, c.lang));
      }
      return { score: clamp(1 - bad.length / 6), note: `${bad.length}: ${bad.slice(0, 4).join(' | ')}` };
    }],
  ['read.orphan', '可读性', 'On a phone, no paragraph ends on a line of one Han character or one short word',
    async (c) => {
      await c.phone.evaluate(LINES);
      return c.phone.evaluate((lang) => {
        const els = [...document.querySelectorAll('main p, main li, main h2, main h3, main summary, main dd')].filter((e) => e.offsetWidth && !e.closest('.visually-hidden') && !e.querySelector('p, li'));
        const bad = [];
        for (const e of els) {
          const ls = window.__lines(e); if (ls.length < 2) continue;
          const last = ls[ls.length - 1];
          const core = last.replace(/[\p{P}\s]/gu, '');
          if (lang === 'zh' ? [...core].length === 1 && /\p{Script=Han}/u.test(core) : /^\S{1,4}$/.test(last) && ls.length > 2) bad.push(`${ls[ls.length - 2].slice(-6)} / ${last}`);
        }
        return { n: bad.length, note: `${bad.length}/${els.length}: ${bad.slice(0, 3).join(' | ')}` };
      }, c.lang).then((r) => ({ score: clamp(1 - r.n / 10), note: r.note }));
    }],
  ['read.scan', '可读性', 'Each section can be skimmed: a heading plus a list, cards, a diagram or sub-headings',
    async (c) => c.desk.evaluate(() => { const ss = [...document.querySelectorAll('main > section.section, main > section')].filter((s) => s.querySelector('h2')); const ok = ss.filter((s) => s.querySelector('ul, ol, dl, .card, [data-diagram], .grid, details') || s.querySelectorAll('h3').length >= 2); return { score: ok.length / ss.length, note: `${ok.length}/${ss.length}` }; })],
];

/* ---- run ----------------------------------------------------------------- */
const axe = (() => { try { return readFileSync(join(ROOT, 'node_modules/axe-core/axe.min.js'), 'utf8'); } catch { return null; } })();
const { base, close } = await serve();
const browser = await chromium.launch(launchOptions());

async function open(path, opts = {}) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  if (axe) await page.route('**/__axe.js', (r) => r.fulfill({ status: 200, contentType: 'text/javascript', body: axe }));
  await page.goto(base + path, { waitUntil: 'load' });
  await page.waitForTimeout(900);
  return page;
}

async function measure(path) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__lcp = 0; window.__cls = 0;
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(base + path, { waitUntil: 'load' });
  await page.waitForTimeout(1500);
  const m = await page.evaluate(() => {
    const nav = performance.getEntriesByType('navigation')[0];
    const res = performance.getEntriesByType('resource');
    const bytes = (nav?.transferSize || 0) + res.reduce((a, r) => a + (r.transferSize || 0), 0);
    return { lcp: window.__lcp, cls: window.__cls, kb: bytes / 1024, requests: res.length + 1 };
  });
  await ctx.close();
  return m;
}

async function text(page, lang) {
  return page.evaluate((lang) => {
    const blocks = [...document.querySelectorAll('main p, main li, main dd, main summary')].map((e) => e.textContent.replace(/\s+/g, ' ').trim()).filter(Boolean);
    const sentences = blocks.flatMap((b) => (lang === 'zh' ? b.split(/[。！？]/) : b.split(/(?<=[.!?])\s+/))).map((s) => s.trim()).filter((s) => s.length > 3);
    const size = (s) => (lang === 'zh' ? [...s.replace(/\s/g, '')].length : s.split(/\s+/).length);
    const lens = sentences.map(size);
    const avg = lens.reduce((a, b) => a + b, 0) / lens.length;
    const longPct = 100 * lens.filter((n) => n > (lang === 'zh' ? 80 : 35)).length / lens.length;
    return { avg, longPct, n: lens.length };
  }, lang);
}

const results = {};
for (const [lang, path] of LANGS) {
  const { defaultBrowserType: _a, ...iphone } = devices['iPhone 13'];
  const { defaultBrowserType: _b, ...se } = devices['iPhone SE'];
  const c = {
    lang, path, browser, base,
    desk: await open(path, { viewport: { width: 1280, height: 800 } }),
    phone: await open(path, iphone),
    se: await open(path, se),
    reduced: await open(path, { viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }),
    metrics: await measure(path),
  };
  c.text = await text(c.desk, lang);
  results[lang] = [];
  for (const [id, dim, desc, fn] of CASES) {
    let out;
    try { out = await fn(c); } catch (e) { out = { score: 0, note: `error: ${e.message.split('\n')[0].slice(0, 60)}` }; }
    const score = typeof out === 'object' ? out.score : out;
    results[lang].push({ id, dim, desc, score: clamp(Number(score) || 0), note: typeof out === 'object' ? out.note || '' : '' });
  }
}
await browser.close(); close();

/* ---- score --------------------------------------------------------------- */
const dims = [...new Set(CASES.map((x) => x[1]))];
const card = {};
for (const lang of Object.keys(results)) {
  card[lang] = {};
  for (const d of dims) {
    const rs = results[lang].filter((r) => r.dim === d);
    card[lang][d] = rs.reduce((a, r) => a + r.score, 0) / rs.length;
  }
  card[lang].total = Object.values(card[lang]).reduce((a, b) => a + b, 0);
}
const pad = (s, n) => s + ' '.repeat(Math.max(0, n - [...s].reduce((w, ch) => w + (/[一-鿿]/.test(ch) ? 2 : 1), 0)));
console.log(`\n  ${pad('dimension', 14)}   en     zh`);
for (const d of dims) console.log(`  ${pad(d, 14)}  ${card.en[d].toFixed(2)}   ${card.zh[d].toFixed(2)}`);
console.log(`  ${pad('TOTAL / 10', 14)}  ${card.en.total.toFixed(2)}   ${card.zh.total.toFixed(2)}`);
const score = Math.min(card.en.total, card.zh.total);
console.log(`\n  score = min(en, zh) = ${score.toFixed(2)} / 10\n`);
const misses = [];
for (const lang of Object.keys(results)) for (const r of results[lang]) if (r.score < 0.999) misses.push({ lang, ...r });
misses.sort((a, b) => a.score - b.score);
if (misses.length) {
  console.log('  below full marks:');
  for (const m of misses) console.log(`   ${m.score.toFixed(2)}  [${m.lang}] ${m.id} — ${m.desc}${m.note ? `  (${m.note})` : ''}`);
}

if (RECORD) {
  const file = join(ROOT, 'docs/eval/history.json');
  const hist = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const label = args.includes('--label') ? args[args.indexOf('--label') + 1] : '';
  hist.push({ at: new Date().toISOString(), label, score: +score.toFixed(2), en: +card.en.total.toFixed(2), zh: +card.zh.total.toFixed(2), dims: card, misses: misses.map((m) => `${m.lang}:${m.id}:${m.score.toFixed(2)}`) });
  writeFileSync(file, `${JSON.stringify(hist, null, 2)}\n`);
}
if (MIN !== null && score < MIN) { console.error(`✗ eval score ${score.toFixed(2)} is below ${MIN}`); process.exit(1); }
