#!/usr/bin/env node
/**
 * build-i18n.mjs — generates the prerendered Chinese page.
 *
 * Client-side language switching left the Chinese site unindexable, unlinkable
 * and unshareable: one URL, one language in the markup, and no way to send
 * somebody the Chinese page. Language belongs in the URL.
 *
 *   index.html      English, at /
 *   zh/index.html   Chinese, at /zh/   — generated from index.html + zh.js
 *
 * `--check` re-generates in memory and fails if the committed file differs, so
 * editing the English page or the dictionary without regenerating is caught
 * rather than silently shipping a stale translation.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* The dictionary is read by importing it — the same way the browser and
   check-i18n read it. It used to be scraped with a line-anchored regex that
   saw only the first key on each line, so every key written second on a line
   was defined, passed every gate, and shipped in English on /zh/. One file,
   one reader. A query string defeats the module cache in --watch-style runs. */
const ZH = (await import(`${pathToFileURL(join(root, 'assets/js/zh.js')).href}?t=${Date.now()}`)).default;
const CHECK = process.argv.includes('--check');

/* PLACEHOLDER. The public domain was not resolvable from this repository.
   This is now the ONLY place it is chosen: sitemap.xml and robots.txt are
   generated from it, and check-links.mjs fails if index.html's absolute URLs
   disagree. The README used to document that it lived in four places, which
   is documenting a defect instead of removing it. */
const SITE = 'https://workspacex.boardx.us';
/* Every page that has a Chinese twin. `path` is the URL the Chinese version
   lives at, which is what canonical, hreflang and og:url have to say. */
const PAGES = [
  {
    source: 'index.html',
    target: 'zh/index.html',
    path: '/zh/',
    enPath: '/',
    depth: 1,
    weight: { changefreq: 'weekly', priority: '1.0' },
    zh: {
      title: 'WorkspaceX — 面向人与 AI 的开放协作运行空间',
      description: 'WorkspaceX 是把上下文、智能体、行动、证据与记忆连成一条链的运行层——让意图变成工作，让工作留下证据。',
      ogTitle: 'WorkspaceX — 面向人与 AI 的开放协作运行空间',
      ogDescription: '不是另一个协作工具，而是人与 AI 真正一起把工作完成的运行层：共享上下文、可验证的行动、属于组织的记忆。',
      ogImageAlt: 'WorkspaceX——面向人与 AI 协作的开放运行空间。',
    },
  },
  {
    source: 'privacy.html',
    target: 'zh/privacy.html',
    path: '/zh/privacy.html',
    enPath: '/privacy.html',
    depth: 1,
    weight: { changefreq: 'yearly', priority: '0.3' },
    zh: {
      title: '隐私与数据 — WorkspaceX',
      description: '这个网站收集什么、不收集什么，以及为什么它没有分析工具、没有 cookie、没有第三方请求。',
      ogTitle: '隐私与数据 — WorkspaceX',
      ogDescription: '这个网站收集什么、不收集什么，以及为什么它没有分析工具、没有 cookie、没有第三方请求。',
      ogImageAlt: 'WorkspaceX——面向人与 AI 协作的开放运行空间。',
    },
  },
];

const escapeHtml = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function build(page) {
  const html = readFileSync(join(root, page.source), 'utf8');
  const META = { zh: page.zh };
  const dict = ZH;

  let out = html;

  // 1. swap every translatable node
  out = out.replace(
    /(<([a-z0-9]+)\b[^>]*\sdata-i18n="([\w.]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    (whole, open, tag, key, _body, close) =>
      (dict[key] === undefined ? whole : `${open}${escapeHtml(dict[key])}${close}`),
  );
  out = out.replace(
    /(<([a-z0-9]+)\b[^>]*\sdata-i18n-html="([\w.]+)"[^>]*>)([\s\S]*?)(<\/\2>)/g,
    (whole, open, tag, key, _body, close) =>
      (dict[key] === undefined ? whole : `${open}${dict[key]}${close}`),
  );

  /* 1a. Headings and short labels break between words, not inside them.
         Breaking between any two Han characters is correct for running text
         — it is how Chinese is typeset — but a display heading that ends a
         line on 三个尺 and starts the next on 度 splits a word in the one
         place a reader looks hardest. Seven of the fourteen section headings
         did. A word segmenter (the ICU dictionary Node ships) finds the word
         boundaries at build time; each gets a zero-width space, and the CSS
         sets `word-break: keep-all` on [data-phrase] so those are the only
         places a line may break inside Han. Section and card headings only:
         running text breaking between characters is how Chinese is typeset.
         Not <wbr>: 228 of those cost the Chinese page 150–200 ms of first
         paint on slow 3G, measured, where the same breaks as U+200B cost
         nothing measurable. */
  const seg = new Intl.Segmenter('zh', { granularity: 'word' });
  const HAN = /\p{Script=Han}/u;
  /* The product's own vocabulary is not in ICU's dictionary: it splits
     智能|体 and 闭|环. Offsets inside one of these never get a break. */
  const TERMS = ['智能体', '闭环', '上下文', '工作空间', '工作单元', '证据链', '可验证', '开放内核', '运行时', '连接器', '本体', '尺度', '上线', '交付物', '经济体', '三个', '三类', '一类'];
  const locked = (text) => {
    const no = new Set();
    for (const term of TERMS) for (let i = text.indexOf(term); i >= 0; i = text.indexOf(term, i + 1)) {
      for (let k = i + 1; k < i + term.length; k += 1) no.add(k);
    }
    return no;
  };
  out = out.replace(
    /(<([a-z0-9]+)\b)([^>]*\sdata-i18n="[\w.]+"[^>]*>)([^<]*)(<\/\2>)/g,
    (whole, start, tag, rest, body, close) => {
      const hanCount = [...body].filter((ch) => HAN.test(ch)).length;
      if (!hanCount || !/^h[23]$/.test(tag)) return whole;
      const parts = [...seg.segment(body)];
      const no = locked(body);
      let joined = '';
      parts.forEach((x, i) => {
        const prev = parts[i - 1];
        if (prev && x.isWordLike && prev.isWordLike && HAN.test(x.segment) && HAN.test(prev.segment) && !no.has(x.index)) joined += '\u200b';
        joined += x.segment;
      });
      return joined === body ? whole : `${start} data-phrase${rest}${joined}${close}`;
    },
  );

  /* 1b. aria-labels. They are copy too, and every one of them was staying in
         English on the Chinese page — invisible unless you are using the
         screen reader they exist for. */
  out = out.replace(/aria-label="[^"]*"(\s+data-i18n-aria="([\w.]+)")/g,
    (whole, tail, key) => (dict[key] === undefined ? whole : `aria-label="${escapeHtml(dict[key])}"${tail}`));

  // 2. document language
  out = out.replace('<html lang="en"', '<html lang="zh-Hans"');

  // 3. head: title, description, og
  out = out.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(META.zh.title)}</title>`);
  out = out.replace(/(<meta name="description" content=")[^"]*(")/, `$1${escapeHtml(META.zh.description)}$2`);
  out = out.replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escapeHtml(META.zh.ogTitle)}$2`);
  out = out.replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${escapeHtml(META.zh.ogDescription)}$2`);
  /* og:locale is language_TERRITORY — Open Graph's own grammar, and the set
     the social crawlers accept is a list of territories (zh_CN, zh_TW,
     zh_HK), not of scripts. `zh_Hans` is the right answer to a different
     question: it is what hreflang wants, and it was pasted into this slot.
     The two standards disagree and the page now says each one in its own
     place — hreflang stays zh-Hans above, og:locale is zh_CN here. */
  out = out.replace('<meta property="og:locale" content="en_US">', '<meta property="og:locale" content="zh_CN">');
  out = out.replace('<meta property="og:locale:alternate" content="zh_CN">', '<meta property="og:locale:alternate" content="en_US">');
  out = out.replace(`<link rel="canonical" href="${SITE}${page.enPath}">`, `<link rel="canonical" href="${SITE}${page.path}">`);
  out = out.replace(`<meta property="og:url" content="${SITE}${page.enPath}">`, `<meta property="og:url" content="${SITE}${page.path}">`);

  // 4. which language link is the current one
  out = out.replace(/(<a class="langswitch__btn" href="[^"]*" )aria-current="true"/, '$1');
  /* The English button on a Chinese page is foreign text too: "EN" was being
     read with a Chinese voice. The same defect the zh button's lang="zh-Hans"
     exists to prevent, fixed in one direction only. Applied after the
     aria-current strip, because that is what changes the tag it matches. */
  out = out.replace(/(<a class="langswitch__btn" href="\/"\s+hreflang="en")>/, '$1 lang="en">');
  out = out.replace(new RegExp(`(<a class="langswitch__btn" href="${page.path.replace(/\//g, '\\/')}" )`), '$1aria-current="true" ');

  /* 5. internal links follow the reader into their language.
        Without this the Chinese home page links to the ENGLISH privacy page,
        and the Chinese privacy page's "back to the site" lands in English —
        both were shipping. The language switch is exempt by definition: it is
        the one control that must point at the other language. */
  const LINK_MAP = new Map(PAGES.map((pg) => [pg.enPath, pg.path]));
  out = out.replace(/<a\b[^>]*>/g, (tag) => {
    if (tag.includes('langswitch__btn')) return tag;
    return tag.replace(/href="(\/[^"]*)"/, (whole, href) =>
      (LINK_MAP.has(href) ? `href="${LINK_MAP.get(href)}"` : whole));
  });

  // 6. the Chinese card, not the English one
  out = out.replace(/og\.jpg/g, 'og-zh.jpg');
  /* The card's alt text is what a screen reader announces for a shared
     link. It was staying English on the Chinese page — invisible unless
     you are the person it exists for, which is how it survived. */
  out = out.replace(/(<meta property="og:image:alt" content=")[^"]*(")/,
    `$1${escapeHtml(META.zh.ogImageAlt)}$2`);
  out = out.replace(/(<meta name="twitter:image:alt" content=")[^"]*(")/,
    `$1${escapeHtml(META.zh.ogImageAlt)}$2`);

  /* The JSON-LD block was copied through untouched: on /zh/ it declared the
     English url and an English description, so the one machine-readable
     statement the page makes about itself described a different page. */
  out = out.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, (block) => block
    .replace(`"url": "${SITE}${page.enPath}"`, `"url": "${SITE}${page.path}"`)
    .replace(/("description":\s*")[^"]*(")/, `$1${META.zh.description.replace(/"/g, '\\"')}$2`)
    .replace('"inLanguage": ["en", "zh-Hans"]', '"inLanguage": ["zh-Hans", "en"]'));

  // 7. relative asset paths move one level down
  /* `depth` was declared on every page and read by nothing: the rule below
     hardcoded a single "../", so a page two levels down would have emitted
     asset paths that silently 404. A field that looks authoritative and
     governs nothing is worse than no field. */
  const up = '../'.repeat(page.depth);
  out = out.replace(/(href|src)="(assets\/)/g, `$1="${up}$2`);
  /* Its own manifest, so the install prompt is in the reader's language. */
  out = out.replace('assets/site.webmanifest', 'assets/site.zh.webmanifest');

  // 8. mark it, so nobody edits the generated file by hand
  out = out.replace('<head>', '<head>\n<!-- GENERATED by scripts/build-i18n.mjs from index.html + assets/js/zh.js. Do not edit; run the script. -->');

  return out;
}

/* The sitemap used to be hand-maintained beside this list — a second
   declaration of "what pages exist", which is the duplication that has bitten
   this project five times. Adding a page here now adds it to the sitemap, and
   forgetting to is a build failure rather than a page search engines never
   hear about. `weight` is the only thing the sitemap knows that PAGES did
   not. */
const sitemap = () => {
  const rows = PAGES.flatMap((pg) => [
    { loc: SITE + pg.enPath, en: pg.enPath, zh: pg.path, ...pg.weight },
    { loc: SITE + pg.path, en: pg.enPath, zh: pg.path, ...pg.weight },
  ]);
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${rows.map((r) => `  <url>
    <loc>${r.loc}</loc>
    <xhtml:link rel="alternate" hreflang="en" href="${SITE}${r.en}"/>
    <xhtml:link rel="alternate" hreflang="zh-Hans" href="${SITE}${r.zh}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${SITE}${r.en}"/>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;
};

let stale = 0;
const robots = () => `User-agent: *
Allow: /

Sitemap: ${SITE}/sitemap.xml
`;

for (const [name, generated] of [['sitemap.xml', sitemap()], ['robots.txt', robots()]]) {
  const target = join(root, name);
  if (CHECK) {
    let current = '';
    try { current = readFileSync(target, 'utf8'); } catch { /* missing */ }
    if (current !== generated) { console.error(`✗ ${name} is out of date — run: node scripts/build-i18n.mjs`); stale += 1; }
  } else {
    writeFileSync(target, generated);
    console.log(`✓ wrote ${name}`);
  }
}
for (const page of PAGES) {
  const generated = build(page);
  const target = join(root, page.target);

  if (CHECK) {
    let current = '';
    try { current = readFileSync(target, 'utf8'); } catch { /* missing */ }
    if (current !== generated) {
      console.error(`✗ ${page.target} is out of date — run: node scripts/build-i18n.mjs`);
      stale += 1;
    }
  } else {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, generated);
    console.log(`✓ wrote ${page.target} (${(generated.length / 1024).toFixed(1)} KB)`);
  }
}
if (CHECK) {
  if (stale) process.exit(1);
  console.log(`✓ ${PAGES.length} generated page(s) + the sitemap match their sources`);
}
