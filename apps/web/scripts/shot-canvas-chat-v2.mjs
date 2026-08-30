// One-off screenshot generator for canvas-v2 (template editor) + chat-v2 (preset).
// Robust against Next dev recompile churn (concurrent edits): retries goto until
// the screen's root testid renders (reloads on transient 404 / not-found).
// Usage: OUT_CANVAS=... OUT_CHAT=... node scripts/shot-canvas-chat-v2.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3131";
const OUT_CANVAS = process.env.OUT_CANVAS;
const OUT_CHAT = process.env.OUT_CHAT;
mkdirSync(OUT_CANVAS, { recursive: true });
mkdirSync(OUT_CHAT, { recursive: true });

const VIEWPORT = { width: 1440, height: 1320 };
const CANVAS_ROOT = '[data-testid="canvas-template-editor"]';
const CHAT_ROOT = '[data-testid="chat-preset"]';

/** [file, url, interaction?] */
const CANVAS = [
  ["uc-7-1-template-editor-default.png", "/canvas/template-editor"],
  ["uc-7-1-template-editor-loading.png", "/canvas/template-editor?state=loading"],
  ["uc-7-1-template-editor-empty.png", "/canvas/template-editor?state=empty"],
  ["uc-7-1-template-editor-invalid.png", "/canvas/template-editor?state=invalid"],
  ["uc-7-1-template-editor-dep-failed.png", "/canvas/template-editor?state=dep-failed"],
  ["uc-7-1-template-editor-denied.png", "/canvas/template-editor?state=denied"],
  ["uc-7-1-template-editor-success.png", "/canvas/template-editor?state=success"],
  ["uc-7-1-template-editor-observer.png", "/canvas/template-editor?as=observer"],
  ["uc-7-1-template-editor-member.png", "/canvas/template-editor?as=member"],
  ["uc-7-1-template-editor-zone-influence.png", "/canvas/template-editor", async (p) => {
    await p.click('[data-testid="tpled-zone-04"]');
  }],
  ["uc-7-1-template-editor-publish-confirm.png", "/canvas/template-editor", async (p) => {
    await p.click('[data-testid="tpled-publish"]');
    await p.waitForSelector('[data-testid="tpled-confirm"]');
  }],
];

const CHAT = [
  ["uc-8-4-preset-default.png", "/chat/preset"],
  ["uc-8-4-preset-loading.png", "/chat/preset?state=loading"],
  ["uc-8-4-preset-empty.png", "/chat/preset?state=empty"],
  ["uc-8-4-preset-invalid.png", "/chat/preset?state=invalid"],
  ["uc-8-4-preset-dep-failed.png", "/chat/preset?state=dep-failed"],
  ["uc-8-4-preset-denied.png", "/chat/preset?state=denied"],
  ["uc-8-4-preset-success.png", "/chat/preset?state=success"],
  ["uc-8-4-preset-consumer-member.png", "/chat/preset?as=member"],
  ["uc-8-4-preset-consumer-observer.png", "/chat/preset?as=observer"],
  ["uc-8-4-preset-editor.png", "/chat/preset", async (p) => {
    await p.click('[data-testid="chat-preset-new"]');
    await p.waitForSelector('[data-testid="chat-preset-editor"]');
  }],
  ["uc-8-4-preset-scope-violation.png", "/chat/preset", async (p) => {
    await p.click('[data-testid="chat-preset-new"]');
    await p.waitForSelector('[data-testid="chat-preset-editor"]');
    await p.click('[data-testid="chat-preset-target-group-4"]');
    await p.waitForSelector('[data-testid="err-preset-scope"]');
  }],
];

async function gotoUntilReady(page, url, rootSel, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (resp && resp.status() === 404) { await page.waitForTimeout(700); continue; }
      await page.waitForSelector(rootSel, { state: "attached", timeout: 5000 });
      return true;
    } catch {
      await page.waitForTimeout(700);
    }
  }
  throw new Error(`root ${rootSel} never rendered for ${url}`);
}

async function run(page, list, outDir, rootSel) {
  for (const [file, url, interact] of list) {
    await gotoUntilReady(page, url, rootSel);
    await page.waitForTimeout(500);
    if (interact) {
      for (let i = 0; i < 4; i++) {
        try { await interact(page); break; } catch { await page.waitForTimeout(600); }
      }
      await page.waitForTimeout(300);
    }
    await page.screenshot({ path: `${outDir}/${file}`, fullPage: false });
    process.stdout.write(`  ✓ ${file}\n`);
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
console.log("canvas-v2:");
await run(page, CANVAS, OUT_CANVAS, CANVAS_ROOT);
console.log("chat-v2:");
await run(page, CHAT, OUT_CHAT, CHAT_ROOT);
await browser.close();
console.log("done");
