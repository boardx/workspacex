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
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const CHECK = process.argv.includes('--check');

/* PLACEHOLDER. The public domain was not resolvable from this repository.
   It is also written into index.html, sitemap.xml and robots.txt — see the
   "Before this goes live" section of the README. */
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
    zh: {
      title: 'WorkspaceX — 面向人与 AI 的开放协作运行空间',
      description: 'WorkspaceX 是把上下文、智能体、行动、证据与记忆连成一条链的运行层——让意图变成工作，让工作留下证据。',
      ogTitle: 'WorkspaceX — 面向人与 AI 的开放协作运行空间',
      ogDescription: '不是另一个协作工具，而是人与 AI 真正一起把工作完成的运行层：共享上下文、可验证的行动、属于组织的记忆。',
    },
  },
  {
    source: 'privacy.html',
    target: 'zh/privacy.html',
    path: '/zh/privacy.html',
    enPath: '/privacy.html',
    depth: 1,
    zh: {
      title: '隐私与数据 — WorkspaceX',
      description: '这个网站收集什么、不收集什么，以及为什么它没有分析工具、没有 cookie、没有第三方请求。',
      ogTitle: '隐私与数据 — WorkspaceX',
      ogDescription: '这个网站收集什么、不收集什么，以及为什么它没有分析工具、没有 cookie、没有第三方请求。',
    },
  },
];

const escapeHtml = (s) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function build(page) {
  const html = readFileSync(join(root, page.source), 'utf8');
  const zhSource = readFileSync(join(root, 'assets/js/zh.js'), 'utf8');
  const META = { zh: page.zh };

  // Read the dictionary without importing it, so this stays a pure text
  // transform with no module cache to invalidate.
  const dict = {};
  for (const m of zhSource.matchAll(/^\s*'([\w.]+)':\s*'((?:[^'\\]|\\.)*)'/gm)) {
    dict[m[1]] = m[2].replace(/\\'/g, "'");
  }

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
  out = out.replace('<meta property="og:locale" content="en">', '<meta property="og:locale" content="zh_Hans">');
  out = out.replace('<meta property="og:locale:alternate" content="zh_Hans">', '<meta property="og:locale:alternate" content="en">');
  out = out.replace(`<link rel="canonical" href="${SITE}${page.enPath}">`, `<link rel="canonical" href="${SITE}${page.path}">`);
  out = out.replace(`<meta property="og:url" content="${SITE}${page.enPath}">`, `<meta property="og:url" content="${SITE}${page.path}">`);

  // 4. which language link is the current one
  out = out.replace(/(<a class="langswitch__btn" href="[^"]*" )aria-current="true"/, '$1');
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
  out = out.replace(/og\.png/g, 'og-zh.png');

  // 7. relative asset paths move one level down
  out = out.replace(/(href|src)="(assets\/)/g, '$1="../$2');

  // 8. mark it, so nobody edits the generated file by hand
  out = out.replace('<head>', '<head>\n<!-- GENERATED by scripts/build-i18n.mjs from index.html + assets/js/zh.js. Do not edit; run the script. -->');

  return out;
}

let stale = 0;
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
  console.log(`✓ ${PAGES.length} generated page(s) match their sources`);
}
