#!/usr/bin/env node
/**
 * build-aurora.mjs — renders the hero's aurora once, to an image.
 *
 * Measured: three ~50vw circles under a 44px CSS blur cost 66.7ms per frame —
 * 15fps — for the entire time they are in the tree, on the hero itself and on
 * every section below it. Hiding them off screen did not help; the compositor
 * still carried the blurred layers. A filter that never changes has no reason
 * to be recomputed at runtime, so it is baked here instead and the page ships
 * one image it can composite for free. The drift animation moves on transform
 * only, which costs nothing.
 *
 *   node scripts/build-aurora.mjs   (needs playwright, see README)
 */
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* Rendered at 1200x760 and scaled up by the page: the source is nothing but
   soft gradients, so upscaling is invisible and the file stays small. */
const W = 1200, H = 760;
/* The blob colours are the brand palette, so they read the tokens rather than
   restating them — this file was the fifth place the gradient was declared.
   `color-mix` gives the token an alpha; it runs in the headless Chromium this
   script drives, which is the only engine that ever renders this page. */
const PAGE = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="/assets/css/base.css">
<style>
  html,body{margin:0;background:var(--bg)}
  .wrap{position:relative;width:${W}px;height:${H}px;overflow:hidden;filter:blur(52px)}
  .b{position:absolute;border-radius:50%}
  .b1{width:660px;height:660px;left:2%;top:-6%;
      background:radial-gradient(circle, color-mix(in srgb, var(--c-1) 92%, transparent), transparent 66%)}
  .b2{width:720px;height:720px;right:-4%;top:4%;
      background:radial-gradient(circle, color-mix(in srgb, var(--c-2) 88%, transparent), transparent 66%)}
  .b3{width:560px;height:560px;left:34%;bottom:-16%;
      background:radial-gradient(circle, color-mix(in srgb, var(--c-3) 85%, transparent), transparent 66%)}
</style></head><body>
  <div class="wrap"><div class="b b1"></div><div class="b b2"></div><div class="b b3"></div></div>
</body></html>`;

/* Served rather than set as content, so the relative stylesheet link resolves
   and the page really is reading the same tokens the site uses. */
const server = createServer(async (req, res) => {
  if (req.url.startsWith('/assets/')) {
    try {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end(await readFile(join(root, req.url)));
      return;
    } catch { res.writeHead(404).end(); return; }
  }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(PAGE);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' });
await page.waitForTimeout(200);

/* JPEG, not PNG: the source is pure gradient, so PNG came out at 253 KB
   against 23 KB here for output nobody can tell apart at this blur radius. */
const jpeg = await page.screenshot({ type: 'jpeg', quality: 82 });
writeFileSync(join(root, 'assets/img/aurora.jpg'), jpeg);

await browser.close();
server.close();
console.log(`✓ wrote assets/img/aurora.jpg (${(jpeg.length / 1024).toFixed(1)} KB)`);
