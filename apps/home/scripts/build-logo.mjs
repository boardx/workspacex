#!/usr/bin/env node
/**
 * build-logo.mjs — every image of the brand, cut from the product's own files.
 *
 *   assets/img/logo.webp            header, footer, social card
 *                                   ← apps/web/public/workspacex-logo.png
 *   assets/img/favicon.png          browser tab (32×32, as the web app ships it)
 *   assets/img/apple-touch-icon.png home screen (180×180, on the page colour)
 *                                   ← apps/web/public/apple-icon.png
 *
 * The site used to draw its own four-petal mark for the tab and the home
 * screen, so a visitor who opened the product from the site saw two different
 * icons for one thing. The web app already ships the icon; this uses it.
 *
 * Source: apps/web/public/workspacex-logo.png — the logo the web app already
 * ships, and the one the owner asked the site to use. It is 2051×874 with most
 * of that transparent padding, which would make the header image mostly air
 * and impossible to align to the nav's baseline. This finds the painted pixels,
 * crops to them with a hairline of margin, and scales to 2× the displayed
 * height so it stays sharp on a high-density screen.
 *
 * The source is not copied or redrawn: if the product's logo changes,
 * check-assets fails until this is re-run, so the site cannot quietly keep an
 * old one.
 *
 *   node scripts/build-logo.mjs      (needs playwright)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LOGO_SOURCE = '../web/public/workspacex-logo.png';
export const ICON_SOURCE = '../web/public/apple-icon.png';
const DISPLAY_HEIGHT = 30;               // px in the nav; see .brand__logo
/* 2×, WebP. The first cut was 3× PNG at 28 KB, and the performance gate
   rejected it: page weight went over the 180 KB budget and the Chinese page's
   slow-3G first paint to 3236 ms. A logo is the last thing that should cost
   first paint. WebP is supported by every browser this site targets. */
const SCALE = 2;

const src = readFileSync(join(root, LOGO_SOURCE)).toString('base64');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage();
const out = await page.evaluate(async ({ src, height }) => {
  const img = new Image();
  img.src = `data:image/png;base64,${src}`;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  let x0 = c.width, y0 = c.height, x1 = 0, y1 = 0;
  for (let y = 0; y < c.height; y += 1) {
    for (let x = 0; x < c.width; x += 1) {
      if (data[(y * c.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  const pad = 4;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(c.width - 1, x1 + pad); y1 = Math.min(c.height - 1, y1 + pad);
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const outH = height, outW = Math.round((w / h) * outH);
  const o = document.createElement('canvas');
  o.width = outW; o.height = outH;
  const og = o.getContext('2d');
  og.imageSmoothingQuality = 'high';
  og.drawImage(c, x0, y0, w, h, 0, 0, outW, outH);
  return { png: o.toDataURL('image/webp', 0.9).split(',')[1], w: outW, h: outH, crop: [x0, y0, w, h] };
}, { src, height: DISPLAY_HEIGHT * SCALE });
/* The icon. The tab gets it as drawn: transparent, 32 px as the web app
   ships it. A 64 px cut was sharper on a 2× screen and cost 5 KB on every
   first visit, for a 16 px square. The home screen does not: iOS fills a transparent icon with black and
   Android with white, so the pink mark sits on the page's own background with
   an eighth of margin, the way the platform masks expect. The colour is read
   from base.css rather than typed here. */
const bg = readFileSync(join(root, 'assets/css/base.css'), 'utf8').match(/--bg:\s*(#[0-9a-f]{3,8})/i)[1];
const icon = readFileSync(join(root, ICON_SOURCE)).toString('base64');
const icons = await page.evaluate(async ({ icon, bg }) => {
  const img = new Image();
  img.src = `data:image/png;base64,${icon}`;
  await img.decode();
  const draw = (size, fill, inset) => {
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    if (fill) { g.fillStyle = fill; g.fillRect(0, 0, size, size); }
    const m = Math.round(size * inset);
    g.drawImage(img, m, m, size - 2 * m, size - 2 * m);
    return c.toDataURL('image/png').split(',')[1];
  };
  return { tab: draw(32, null, 0), touch: draw(180, bg, 0.125) };
}, { icon, bg });
await browser.close();

writeFileSync(join(root, 'assets/img/favicon.png'), Buffer.from(icons.tab, 'base64'));
writeFileSync(join(root, 'assets/img/apple-touch-icon.png'), Buffer.from(icons.touch, 'base64'));
console.log('✓ wrote assets/img/favicon.png (32×32) and assets/img/apple-touch-icon.png (180×180)');
writeFileSync(join(root, 'assets/img/logo.webp'), Buffer.from(out.png, 'base64'));
console.log(`✓ wrote assets/img/logo.webp (${out.w}×${out.h}, cropped from ${out.crop.join(',')}) — display at ${DISPLAY_HEIGHT}px tall, ${Math.round(out.w / SCALE)}px wide`);
