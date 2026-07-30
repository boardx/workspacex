// 截图生成器 —— 研究 Studio（契约束 research / M24）。
// 覆盖：5 屏 × 七态 + owner/collaborator 视角对照 + 各屏特殊子态
//       （预览句另一取值 / 组预填 / 三种入库阻断 / 部分成功 / 只看冲突 / 目标缺失 …）。
// 用法：BASE=http://localhost:3131 OUT=/abs/path node scripts/shot-research-studio.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3131";
const OUT = process.env.OUT;
if (!OUT) throw new Error("OUT env required");
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 1360, height: 1100 };
const STATES = ["default", "loading", "empty", "invalid", "dep-failed", "denied", "success"];
const ROOT = '[data-testid="rs-main"]';

// 屏 → UC 前缀（截图命名 uc-24-N-<屏>-<状态>.png）
const SCREENS = [
  { screen: "list", prefix: "uc-24-3-list" },
  { screen: "plan", prefix: "uc-24-3-plan" },
  { screen: "new", prefix: "uc-24-1-new" },
  { screen: "detail", prefix: "uc-24-2-detail" },
  { screen: "live", prefix: "uc-24-5-live" },
];

/** [file, url] */
const SHOTS = [];
const u = (params) => {
  const p = new URLSearchParams(params);
  const s = p.toString();
  return `/research${s ? "?" + s : ""}`;
};

// ── 5 屏 × 七态 ────────────────────────────────────────────────────────
for (const { screen, prefix } of SCREENS) {
  for (const st of STATES) {
    const params = {};
    if (screen !== "list") params.screen = screen;
    if (st !== "default") params.state = st;
    SHOTS.push([`${prefix}-${st}.png`, u(params)]);
  }
  // 视角对照：owner = default 已有，补 collaborator
  const cp = { as: "collaborator" };
  if (screen !== "list") cp.screen = screen;
  SHOTS.push([`${prefix}-view-collaborator.png`, u(cp)]);
}

// ── 特殊子态 ────────────────────────────────────────────────────────────
// 新建：预览句另一取值（证明是算出来的）+ 组预填
SHOTS.push(["uc-24-1-new-preview-alt.png", u({ screen: "new", sub: "alt" })]);
SHOTS.push(["uc-24-1-new-group-prefill.png", u({ screen: "new", sub: "group-prefill" })]);
// 计划：证据目标缺失 → 渲染 —（N-8）
SHOTS.push(["uc-24-3-plan-target-missing.png", u({ screen: "plan", sub: "target-missing" })]);
// 详情/出口：三种入库阻断 + 部分成功
SHOTS.push(["uc-24-4-detail-block-no-source.png", u({ screen: "detail", sub: "block-no-source" })]);
SHOTS.push(["uc-24-4-detail-block-disputed.png", u({ screen: "detail", sub: "block-disputed" })]);
SHOTS.push(["uc-24-4-detail-block-conflict.png", u({ screen: "detail", sub: "block-conflict" })]);
SHOTS.push(["uc-24-4-detail-promote-partial.png", u({ screen: "detail", sub: "promote-partial" })]);
// 现场：只看有冲突 + 冲突为 0 空态（区块仍在）
SHOTS.push(["uc-24-5-live-conflict-filter.png", u({ screen: "live", sub: "conflict-filter" })]);
SHOTS.push(["uc-24-5-live-conflict-empty.png", u({ screen: "live", sub: "conflict-empty" })]);

async function gotoUntilReady(page, url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (resp && resp.status() === 404) { await page.waitForTimeout(700); continue; }
      await page.waitForSelector(ROOT, { state: "attached", timeout: 6000 });
      return true;
    } catch { await page.waitForTimeout(700); }
  }
  throw new Error(`root ${ROOT} never rendered for ${url}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

let n = 0;
for (const [file, url] of SHOTS) {
  await gotoUntilReady(page, url);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  n++;
  process.stdout.write(`  ✓ ${file}\n`);
}
await browser.close();
console.log(`done: ${n} screenshots → ${OUT}`);
