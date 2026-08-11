// 截图生成器 —— chat-viz 束（VZ-01：AI 气泡内 markdown + ```mermaid 渲染）三态原型。
// ADR-023 签核第 ① 件（UI）材料。纯 mock 原型页 /preview/chat-viz，不接后端。
//
// 用法：BASE=http://localhost:3131 OUT=/abs/path node scripts/shot-chat-viz.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3131";
const OUT = process.env.OUT;
if (!OUT) throw new Error("OUT env required");
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 820, height: 1100 };
const ROOT = '[data-testid="chat-viz-preview"]';
const LOADING = '[data-testid="chat-ai-mermaid-loading"]';

/** [file, scene, waitFor] —— 文件名遵循 <uc-id>-<屏名>-<状态>.png（束 = VZ-01 chat-viz） */
const SHOTS = [
  ["vz01-markdown.png", "markdown", '[data-testid="chat-ai-markdown"] table'],
  ["vz01-mermaid-flowchart.png", "mermaid", '[data-testid="chat-ai-mermaid"] svg'],
  ["vz01-mermaid-out-of-whitelist-error.png", "error", '[data-testid="chat-ai-mermaid-error"]'],
];

async function gotoUntilReady(page, url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (resp && resp.status() === 404) { await page.waitForTimeout(700); continue; }
      await page.waitForSelector(ROOT, { state: "attached", timeout: 8000 });
      return true;
    } catch { await page.waitForTimeout(700); }
  }
  throw new Error(`root ${ROOT} never rendered for ${url}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

let n = 0;
for (const [file, scene, waitFor] of SHOTS) {
  await gotoUntilReady(page, `/preview/chat-viz?scene=${scene}`);
  // 等实质内容渲染完（表格/SVG/错误态）
  try { await page.waitForSelector(waitFor, { state: "visible", timeout: 12000 }); }
  catch { process.stdout.write(`  ! ${file}: waitFor ${waitFor} timed out, shooting anyway\n`); }
  // mermaid 异步渲染：等所有「渲染图中…」占位消失，避免截到半渲染态
  try { await page.waitForFunction((sel) => document.querySelectorAll(sel).length === 0, LOADING, { timeout: 12000 }); }
  catch { process.stdout.write(`  ! ${file}: loading placeholders still present\n`); }
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  n++;
  process.stdout.write(`  ✓ ${file}\n`);
}
await browser.close();
console.log(`done: ${n} screenshots → ${OUT}`);
