// 截图生成器 —— plan-control 束（TW-P0-3 可编辑计划 + 六态工作流）原型。
// ADR-023 签核第 ① 件（UI）材料。纯 mock 原型页 /preview/plan-control，不接后端。
// 八屏 G-01～G-08，各一张。用法：BASE=http://localhost:3132 OUT=/abs/path node scripts/shot-plan-control.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3132";
const OUT = process.env.OUT;
if (!OUT) throw new Error("OUT env required");
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 860, height: 960 };
const ROOT = '[data-testid="plan-control-preview"]';

// [screen-query, 输出文件名] —— 文件名遵循 <uc-id>-<屏名>-<状态>.png（束 = TW-P0-3）
const SHOTS = [
  ["g01", "g-01-plan-readonly-three-status.png"],
  ["g02", "g-02-plan-edit-actions.png"],
  ["g03", "g-03-plan-reorder-dragging.png"],
  ["g04", "g-04-constraint-inline-input.png"],
  ["g05", "g-05-phase-indicator-six-states.png"],
  ["g06", "g-06-confirm-gate-vs-simple.png"],
  ["g07", "g-07-run-progress-and-pending-apply.png"],
  ["g08", "g-08-failure-two-recovery.png"],
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

const errors = [];
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

let n = 0;
for (const [screen, file] of SHOTS) {
  await gotoUntilReady(page, `/preview/plan-control?screen=${screen}`);
  await page.waitForTimeout(450); // hydration 稳定
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  n++;
  process.stdout.write(`  ✓ ${file}\n`);
}
await browser.close();

if (errors.length > 0) {
  process.stderr.write(`\n⚠ console errors (${errors.length}):\n${errors.join("\n")}\n`);
  process.exit(1);
}
console.log(`done: ${n} screenshots → ${OUT} (zero console error)`);
