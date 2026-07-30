// 截图生成器 —— project 域 v2（project-v2）。
// 覆盖：项目列表（增删改查）、Layout B 工作台（7 tab × 七态 × 四视角）、
//       新建项目向导、组织停用只读、Layout A 项目主页（待裁决）。
// 用法：BASE=http://localhost:3131 OUT=/abs/path node scripts/shot-project-v2.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3131";
const OUT = process.env.OUT;
if (!OUT) throw new Error("OUT env required");
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 1360, height: 1000 };
const STATES = ["default", "loading", "empty", "invalid", "dep-failed", "denied", "success"];
const VIEWS = ["groupLead", "member", "observer"]; // facilitator = default 视角
const TAB_PREFIX = {
  overview: "uc-00-2-overview",
  research: "uc-00-2-research",
  prep: "uc-2-2-prep",
  live: "uc-5-1-live",
  results: "uc-00-3-results",
  todo: "uc-11-1-todo",
  settings: "uc-2-2-settings",
};

/** [file, url, rootSel, interaction?] */
const SHOTS = [];

// ── Layout B 工作台：每 tab 七态（facilitator）+ 三视角（default 态）──────────
for (const [tab, prefix] of Object.entries(TAB_PREFIX)) {
  for (const st of STATES) {
    const q = new URLSearchParams();
    if (tab !== "overview") q.set("tab", tab);
    if (st !== "default") q.set("state", st);
    const qs = q.toString();
    SHOTS.push([`${prefix}-${st}.png`, `/project${qs ? "?" + qs : ""}`, '[data-testid="project-workbench"]']);
  }
  for (const v of VIEWS) {
    const q = new URLSearchParams();
    if (tab !== "overview") q.set("tab", tab);
    q.set("as", v);
    SHOTS.push([`${prefix}-${v}.png`, `/project?${q.toString()}`, '[data-testid="project-workbench"]']);
  }
}

// ── 项目列表（/projects）：七态 + ⋯菜单 + 已归档筛选 ────────────────────────
for (const st of STATES) {
  const qs = st === "default" ? "" : `?state=${st}`;
  SHOTS.push([`uc-00-2-allprojects-${st}.png`, `/projects${qs}`, '[data-testid="projects-screen"]']);
}
SHOTS.push([
  "uc-00-2-allprojects-more-menu.png", "/projects", '[data-testid="projects-screen"]',
  async (p) => { await p.click('[data-testid="projects-card-p1-more"]'); await p.waitForSelector('[data-testid="projects-more-menu-p1"]'); },
]);
SHOTS.push([
  "uc-00-2-allprojects-archived.png", "/projects", '[data-testid="projects-screen"]',
  async (p) => { await p.click('[data-testid="projects-filter-archived"]'); await p.waitForSelector('[data-testid="projects-filter-empty"]'); },
]);

// ── 新建项目向导（/project/new）：七态 + 从空白选中 ────────────────────────
for (const st of STATES) {
  const qs = st === "default" ? "" : `?state=${st}`;
  SHOTS.push([`uc-2-2-newproject-${st}.png`, `/project/new${qs}`, '[data-testid="project-new"]']);
}
SHOTS.push([
  "uc-2-2-newproject-scratch.png", "/project/new", '[data-testid="project-new"]',
  async (p) => { await p.click('[data-testid="project-new-scratch-scratch"]'); await p.waitForTimeout(200); },
]);

// ── 组织停用只读（/project?orgState=disabled）──────────────────────────────
SHOTS.push(["uc-00-1-orgdisabled-overview.png", "/project?orgState=disabled", '[data-testid="project-org-disabled-banner"]']);
SHOTS.push(["uc-00-1-orgdisabled-results.png", "/project?orgState=disabled&tab=results", '[data-testid="project-org-disabled-banner"]']);
SHOTS.push(["uc-00-1-orgdisabled-observer.png", "/project?orgState=disabled&as=observer", '[data-testid="project-org-disabled-banner"]']);

// ── Layout A 项目主页（/projects/p1）：两版并存·待裁决 ─────────────────────
SHOTS.push(["uc-00-2-projecthome-default.png", "/projects/p1", '[data-testid="project-home-surfaces"]']);
SHOTS.push(["uc-00-2-projecthome-observer.png", "/projects/p1?as=observer", '[data-testid="project-home-surfaces"]']);

async function gotoUntilReady(page, url, rootSel, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (resp && resp.status() === 404) { await page.waitForTimeout(700); continue; }
      await page.waitForSelector(rootSel, { state: "attached", timeout: 6000 });
      return true;
    } catch { await page.waitForTimeout(700); }
  }
  throw new Error(`root ${rootSel} never rendered for ${url}`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

let n = 0;
for (const [file, url, rootSel, interact] of SHOTS) {
  await gotoUntilReady(page, url, rootSel);
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
