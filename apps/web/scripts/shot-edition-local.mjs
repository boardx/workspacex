/**
 * 本地版界面取证（#3749 质量线 R1–R10 的「界面有明显变化」那一半）。
 * 打在真跑着的 web（WORKSPACEX_EDITION=local，API 走同源代理）上，不是 mock。
 */
/* eslint-disable */
import { createRequire } from "node:module";
const require = createRequire("file:///Users/shenyanbin/Documents/wsx-wt/chat10/apps/web/package.json");
const pw = require("@playwright/test");
const chromium = pw.chromium ?? pw.default?.chromium;
import { mkdirSync } from "node:fs";
const OUT = "/Users/shenyanbin/Documents/wsx-wt/chat10/evidence/local-desktop/chat-quality/shots";
mkdirSync(OUT, { recursive: true });
const WEB = "http://127.0.0.1:3312";
const SESSION = {
  userId: "u-9b6922a30a5ce94eb9e320bc9a1ab1c6",
  orgs: ["org-d76964ad8b554c22", "org-local-88ced53c-c97d-4ba9-a2d2-2b0f9c2c1f01"],
  currentOrgId: "org-d76964ad8b554c22",
  expiresAt: "2026-10-21T19:34:11.019Z",
  token: "g79hmeHcYf_QC6CsxkqUB-4OL6vhixX_kvX2yIyssBc",
};
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto(`${WEB}/login`);
await page.evaluate((s) => {
  const rev = crypto.randomUUID();
  localStorage.setItem("wsx.session", JSON.stringify({
    version: 2, revision: rev, userId: s.userId, orgs: s.orgs,
    currentOrgId: s.currentOrgId, expiresAt: s.expiresAt,
  }));
  localStorage.setItem("wsx.sessionToken", s.token);
  localStorage.setItem("wsx.sessionCommit", rev);
}, SESSION);
await page.goto(`${WEB}/chat`);
await page.waitForSelector('[data-testid="edition-banner"]', { timeout: 60_000 });
await page.waitForTimeout(2500);

const edition = await page.evaluate(() => document.documentElement.dataset.edition);
console.log("html[data-edition] =", edition);
console.log("banner text =", (await page.locator('[data-testid="edition-banner"]').innerText()).replace(/\n/g, " | "));

await page.screenshot({ path: `${OUT}/01-chat-local-banner.png` });

// 展开「与在线版有 N 项能力不同」
await page.click('[data-testid="edition-banner-toggle"]');
await page.waitForSelector('[data-testid="edition-egress-facts"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/02-egress-facts-and-capability-gaps.png` });
const gaps = await page.locator('[data-testid="edition-capability-gaps"] > li').count();
const facts = await page.locator('[data-testid="edition-egress-facts"] > li').count();
console.log(`capability gaps rendered = ${gaps}, egress facts rendered = ${facts}`);

// 切换对话框（这份部署没配在线地址 ⇒ 必须走「如实说」那一支，不画确认按钮）
await page.click('[data-testid="edition-switch-open"]');
await page.waitForSelector('[data-testid="edition-switch-dialog"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/03-switch-to-cloud-dialog.png` });
console.log("confirm button present =", await page.locator('[data-testid="edition-switch-confirm"]').count());
console.log("unconfigured notice   =", (await page.locator('[data-testid="edition-switch-unconfigured"]').innerText()).replace(/\n/g, " "));
console.log("notes rendered        =", await page.locator('[data-testid="edition-switch-notes"] > li').count());

// 窄屏：改动前那条本地提示是 hidden lg:block，笔记本以下整条不渲染
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 430, height: 860 });
await page.waitForTimeout(600);
console.log("banner still visible at 430px =", await page.locator('[data-testid="edition-banner"]').isVisible());
await page.screenshot({ path: `${OUT}/04-banner-at-phone-width.png` });
await browser.close();
