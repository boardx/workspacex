// F964 保真度核对用截图脚本 —— 只拍成果沉淀 tab（复用 shot-project-v2.mjs 同一套机制）。
// ⚠ **实测本脚本当前跑不通**（2026-08-20）：`/projects/[projectId]/page.tsx` 自
//   issue #1316（安全修复：不再在这里组装 mock 身份，见该文件头注）起不再向
//   `ProjectWorkbench` 传 `identity`，`AppShell` 因此总是落到 `SessionAppShell`
//   ——没有真实登录会话就被重定向到 `/login`，`[data-testid="project-workbench"]`
//   永远不会渲染。`shot-project-v2.mjs`（本脚本仿照的母版）指向同一条路由，
//   同样会被这条安全修复挡住，不只是本脚本的问题。
//   ⇒ **要重新跑通，需要先起真实登录会话**（docker DB + 迁移 + 种子用户 + 真实
//   `POST /auth/login` 拿 token，写入 `SESSION_TOKEN_STORAGE_KEY` 对应的
//   localStorage 键，或改造本脚本走 `apps/web/playwright.fullstack-smoke.config.ts`
//   那一套真栈 fixture），不是简单的「换一个 mock query 参数」能解决的。
//   F964 的 UIUX 保真度评分因此改用结构化代码走查（非像素级截图对比），
//   见 sprint-17 的 progress.md / session-handoff.md 里的记录。
// 用法（需要先解决上面的登录问题）：
//   BASE=http://localhost:3131 OUT=/abs/path node scripts/shot-project-results-f964.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3131";
const OUT = process.env.OUT;
if (!OUT) throw new Error("OUT env required");
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 1360, height: 1000 };
const STATES = ["default", "loading", "empty", "invalid", "dep-failed", "denied", "success"];
const VIEWS = ["groupLead", "member", "observer"];

const SHOTS = [];
for (const st of STATES) {
  const q = new URLSearchParams({ tab: "results" });
  if (st !== "default") q.set("state", st);
  SHOTS.push([`uc-00-3-results-${st}.png`, `/projects/p1?${q.toString()}`, '[data-testid="project-workbench"]']);
}
for (const v of VIEWS) {
  const q = new URLSearchParams({ tab: "results", as: v });
  SHOTS.push([`uc-00-3-results-${v}.png`, `/projects/p1?${q.toString()}`, '[data-testid="project-workbench"]']);
}

async function gotoUntilReady(page, url, rootSel, tries = 40) {
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
for (const [file, url, rootSel] of SHOTS) {
  await gotoUntilReady(page, url, rootSel);
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  n++;
  process.stdout.write(`  ✓ ${file}\n`);
}
await browser.close();
console.log(`done: ${n} screenshots → ${OUT}`);
