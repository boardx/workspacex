// 截图生成器 —— 「项目」首页卡片网格 + 标签过滤原型（纯 mock 签核材料）。
// 覆盖：七态 + 标签过滤命中 + 标签过滤空集 + ⋯归档二次确认。
// 用法：BASE=http://localhost:3131 OUT=/abs/path node scripts/shot-projects-cardgrid.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3131";
const OUT = process.env.OUT;
if (!OUT) throw new Error("OUT env required");
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 1360, height: 1000 };
const ROOT = '[data-testid="projects-cardgrid-screen"]';
const STATES = ["default", "loading", "empty", "invalid", "dep-failed", "denied", "success"];

/** [file, url, interaction?] */
const SHOTS = [];
for (const st of STATES) {
  const qs = st === "default" ? "" : `?state=${st}`;
  SHOTS.push([`projects-cardgrid-${st}.png`, `/preview/projects-card-grid${qs}`]);
}

// 标签过滤：选中「客户共创」→ 命中子集
SHOTS.push([
  "projects-cardgrid-tag-filtered.png", "/preview/projects-card-grid",
  async (p) => {
    await p.click('[data-testid="projects-cardgrid-tag-客户共创"]');
    await p.waitForSelector('[data-testid="projects-cardgrid-count"]');
  },
]);
// 标签过滤空集：选一个稀有组合（内部演练 + 已归档 无交集）
SHOTS.push([
  "projects-cardgrid-filter-empty.png", "/preview/projects-card-grid",
  async (p) => {
    await p.click('[data-testid="projects-cardgrid-tag-内部演练"]');
    await p.click('[data-testid="projects-cardgrid-status-archived"]');
    await p.waitForSelector('[data-testid="projects-cardgrid-filter-empty"]');
  },
]);
// 归档二次确认（危险动作影响范围说明）
SHOTS.push([
  "projects-cardgrid-archive-confirm.png", "/preview/projects-card-grid",
  async (p) => {
    await p.click('[data-testid="projects-cardgrid-card-p-01-more"]');
    await p.click('[data-testid="projects-cardgrid-menu-p-01-archive"]');
    await p.waitForSelector('[data-testid="projects-cardgrid-archive-confirm-p-01"]');
  },
]);

async function gotoUntilReady(page, url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (resp && resp.status() === 404) { await page.waitForTimeout(700); continue; }
      await page.waitForSelector(ROOT, { state: "attached", timeout: 6000 });
      return true;
    } catch { await page.waitForTimeout(700); }
  }
  throw new Error(`root never rendered for ${url}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

let n = 0;
for (const [file, url, interact] of SHOTS) {
  await gotoUntilReady(page, url);
  await page.waitForTimeout(450);
  if (interact) {
    for (let i = 0; i < 4; i++) { try { await interact(page); break; } catch { await page.waitForTimeout(500); } }
    await page.waitForTimeout(250);
  }
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  n++;
  process.stdout.write(`  ✓ ${file}\n`);
}
await browser.close();
console.log(`done: ${n} screenshots → ${OUT}`);
