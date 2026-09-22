#!/usr/bin/env node
/**
 * perf.test.mjs — a budget, not a measurement.
 *
 * Every number here was earned by a specific fix and can be lost by a careless
 * one. The two that mattered most were invisible for twelve rounds each: a
 * 15 fps scroll caused by a CSS blur nobody suspected, and a first paint that
 * waited six seconds for six stylesheets. Both were regressions waiting to
 * happen again, so they are budgets now.
 *
 * Measured against a COMPRESSING server, because every real host compresses
 * and measuring without it overstates transfer about fourfold for text.
 */
import { serve, launcher, launchOptions, reporter } from './harness.mjs';

const chromium = await launcher();
if (!chromium) {
  console.log('… performance budget skipped — playwright is not installed');
  process.exit(0);
}

/* Set just above what the page currently does, so drift is caught while it is
   still small. Raising a number here should take an argument, not a shrug. */
const BUDGET = {
  transferKb: 180,       // currently ~146 KB compressed, cold load
  lcpDesktopMs: 900,
  lcpSlow3gMs: 3200,     // 400 kbps, 400 ms RTT, 4x CPU
  cls: 0.02,
  frameMedianMs: 20,     // 60fps is 16.7
  longFramePct: 2,       // share of frames over 33ms while scrolling the scene
};

const { base, close } = await serve();
const browser = await chromium.launch(launchOptions());
const r = reporter('performance budget');

/* Both languages. The budget measured the English page only, for twenty-seven
   rounds — and /zh/ is a separately generated document with different text,
   a different LCP element and, it turns out, a preload that does not serve
   it. A budget that watches one of two pages is half a budget. */
async function profile({ cpu, net, width, height, path = '/' }) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (cpu) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
  if (net) {
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...net });
  }
  let bytes = 0;
  page.on('response', (res) => {
    const len = Number(res.headers()['content-length'] ?? 0);
    if (len) bytes += len;
  });
  await page.goto(base + path, { waitUntil: 'load' });
  await page.waitForTimeout(1600);
  const vitals = await page.evaluate(() => new Promise((done) => {
    const out = { lcp: 0, cls: 0 };
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { out.lcp = Math.round(e.startTime); }))
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) out.cls += e.value; }))
      .observe({ type: 'layout-shift', buffered: true });
    setTimeout(() => done({ lcp: out.lcp, cls: +out.cls.toFixed(4) }), 400);
  }));
  const frames = await page.evaluate(async () => {
    const track = document.querySelector('.scene__track');
    if (!track) return null;
    const box = track.getBoundingClientRect();
    const start = box.top + window.scrollY - window.innerHeight * 0.5;
    const distance = box.height + window.innerHeight;
    const times = []; let last = performance.now();
    await new Promise((done) => {
      const t0 = performance.now(); const D = 2200;
      (function step(now) {
        times.push(now - last); last = now;
        const k = (now - t0) / D;
        window.scrollTo(0, start + distance * Math.min(1, k));
        if (k < 1) requestAnimationFrame(step); else done();
      })(performance.now());
    });
    times.shift();
    const sorted = [...times].sort((a, b) => a - b);
    return {
      median: +sorted[Math.floor(sorted.length / 2)].toFixed(1),
      longPct: +(times.filter((t) => t > 33.4).length / times.length * 100).toFixed(1),
    };
  });
  await ctx.close();
  return { bytes, ...vitals, frames };
}

for (const [lang, path] of [['en', '/'], ['zh', '/zh/']]) {
  const desktop = await profile({ width: 1440, height: 900, path });
  r.note(`desktop [${lang}] — ${(desktop.bytes / 1024).toFixed(1)} KB, LCP ${desktop.lcp}ms, CLS ${desktop.cls}, frames ${desktop.frames.median}ms median / ${desktop.frames.longPct}% over 33ms`);
  r.check(desktop.bytes / 1024 <= BUDGET.transferKb, `[${lang}] transfer ${(desktop.bytes / 1024).toFixed(1)} KB over budget ${BUDGET.transferKb} KB`);
  r.check(desktop.lcp <= BUDGET.lcpDesktopMs, `[${lang}] desktop LCP ${desktop.lcp}ms over budget ${BUDGET.lcpDesktopMs}ms`);
  r.check(desktop.cls <= BUDGET.cls, `[${lang}] desktop CLS ${desktop.cls} over budget ${BUDGET.cls}`);
  r.check(desktop.frames.median <= BUDGET.frameMedianMs, `[${lang}] frame median ${desktop.frames.median}ms over budget ${BUDGET.frameMedianMs}ms`);
  r.check(desktop.frames.longPct <= BUDGET.longFramePct, `[${lang}] ${desktop.frames.longPct}% of frames over 33ms, budget ${BUDGET.longFramePct}%`);

  const slow = await profile({
    cpu: 4, width: 390, height: 844, path,
    net: { latency: 400, downloadThroughput: 400 * 1024 / 8, uploadThroughput: 400 * 1024 / 8 },
  });
  r.note(`slow 3G [${lang}] — LCP ${slow.lcp}ms, CLS ${slow.cls}, frames ${slow.frames.median}ms median`);
  r.check(slow.lcp <= BUDGET.lcpSlow3gMs, `[${lang}] slow-3G LCP ${slow.lcp}ms over budget ${BUDGET.lcpSlow3gMs}ms`);
  r.check(slow.cls <= BUDGET.cls, `[${lang}] slow-3G CLS ${slow.cls} over budget ${BUDGET.cls}`);
}

await browser.close();
close();
process.exit(r.finish() ? 0 : 1);
