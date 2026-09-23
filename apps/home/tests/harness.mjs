/**
 * harness.mjs — shared plumbing for the browser checks.
 *
 * These used to live outside the repository, which meant two things: nobody
 * else had them, and their expectations were magic numbers that went stale
 * every time the page grew. Four separate times a check reported clean because
 * it was still asserting against a page that no longer existed.
 *
 * So: expectations are DERIVED from the page wherever possible, and the suite
 * lives beside the thing it tests.
 *
 * Playwright is not a dependency of this project — it is a dev tool. If it is
 * not installed the suite skips with a clear message rather than failing, so
 * `check-all.mjs` stays runnable on a bare checkout.
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TYPES = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript',
  '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.xml': 'application/xml', '.txt': 'text/plain',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json',
};
const COMPRESSIBLE = new Set(['.html', '.css', '.js', '.svg', '.xml', '.txt', '.json', '.webmanifest']);

/** A server that compresses, because every host does and measuring without it
 *  overstates transfer sizes about fourfold for text. */
export function serve() {
  const server = createServer(async (req, res) => {
    let path = decodeURIComponent(req.url.split('?')[0]);
    if (path.endsWith('/')) path += 'index.html';
    try {
      const body = await readFile(join(ROOT, path));
      const ext = extname(path);
      const headers = { 'content-type': TYPES[ext] ?? 'application/octet-stream' };
      if (COMPRESSIBLE.has(ext) && /gzip/.test(req.headers['accept-encoding'] ?? '')) {
        const gz = gzipSync(body, { level: 9 });
        res.writeHead(200, { ...headers, 'content-encoding': 'gzip', 'content-length': gz.length });
        res.end(gz);
      } else {
        res.writeHead(200, { ...headers, 'content-length': body.length });
        res.end(body);
      }
    } catch { res.writeHead(404).end(); }
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      /* unref so a suite that throws cannot leave node alive on this handle
         alone. Before this, any error in a suite printed its stack and then
         the process simply never exited — a failure and a hang looked the
         same from outside, and both were diagnosed as "still running". */
      server.unref();
      resolve({ base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() });
    });
  });
}

/**
 * page.evaluate has NO timeout — setDefaultTimeout governs actions and
 * navigations and does not reach it. An evaluate that never resolves therefore
 * hangs the whole suite with no location, which is exactly what happened three
 * times. Racing it turns that into a named failure.
 */
export async function evaluateWithin(page, ms, label, fn, arg) {
  let timer;
  const ceiling = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`evaluate "${label}" exceeded ${ms}ms`)), ms);
  });
  try { return await Promise.race([page.evaluate(fn, arg), ceiling]); }
  finally { clearTimeout(timer); }
}

/** Resolves to the chromium launcher, or null when Playwright is absent. */
export async function launcher() {
  try {
    const { chromium } = await import('playwright');
    return chromium;
  } catch {
    return null;
  }
}

export const launchOptions = () =>
  (process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

/* ---- tiny assertion helper, so every check reports the same way ---------- */
/** The suite currently running, for the crash handler to name. */
export let current = '(not started)';

export function reporter(name) {
  const failures = [];
  /* Announced on entry. Until this existed, a suite that never returned left
     the last SUCCESSFUL line as the only clue, which points at the suite
     before the one that is actually stuck. */
  current = name;
  return {
    /* Names the CASE inside a suite. Twenty-two widths run under one suite
       name; when one of them hung, "responsive" was all the crash handler
       could say. */
    step(what) { current = `${name} · ${what}`; },
    check(condition, message) { if (!condition) failures.push(message); },
    equal(actual, expected, what) {
      if (actual !== expected) failures.push(`${what}: expected ${expected}, got ${actual}`);
    },
    note(message) { console.log(`    ${message}`); },
    finish() {
      if (failures.length) {
        console.error(`✗ ${name}`);
        failures.forEach((f) => console.error(`    ${f}`));
        return false;
      }
      console.log(`✓ ${name}`);
      return true;
    },
  };
}

/** Counts declared in the SOURCE, so a check can assert against what the page
 *  actually contains rather than a number somebody typed once. */
export async function pageFacts() {
  const html = await readFile(join(ROOT, 'index.html'), 'utf8');
  return {
    sections: (html.match(/<section\b/g) ?? []).length,
    diagrams: (html.match(/data-diagram="/g) ?? []).length,
    navLinks: (html.match(/class="nav__link"/g) ?? []).length,
    loopSteps: (html.match(/class="rail__item"/g) ?? []).length,
    archLayers: 5,
  };
}
