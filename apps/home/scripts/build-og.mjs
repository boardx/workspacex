#!/usr/bin/env node
/**
 * build-og.mjs — renders scripts/og-card.html to assets/img/og.jpg at 1200x630.
 *
 * The card is a real page using the site's own tokens and typeface, so it
 * cannot drift away from the design the way a hand-drawn image does. Playwright
 * is a dev-only tool here; the output is committed, so nobody needs it to
 * deploy. Run it after changing the card or the brand.
 *
 *   node scripts/build-og.mjs   (needs playwright available, see README)
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = { '.html': 'text/html', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(req.url.split('?')[0]));
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
for (const [lang, file] of [['en', 'og.jpg'], ['zh', 'og-zh.jpg']]) {
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${port}/scripts/og-card.html?lang=${lang}`, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
  /* JPEG, not PNG. The card is a photographic gradient: PNG stored it
     losslessly at 254 KB, JPEG at quality 92 is visually identical and a
     fifth of that. Nothing on the page loads these, which is exactly why
     half a megabyte of them sat in the repository unnoticed — the
     performance budget only measures what the page actually fetches. */
  await page.screenshot({ path: join(root, 'assets/img', file), type: 'jpeg', quality: 92 });
  await page.close();
  console.log(`✓ wrote assets/img/${file} (1200x630, ${lang})`);
}
await browser.close();
server.close();
