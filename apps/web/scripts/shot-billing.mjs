// 截图生成器 —— phase-21 billing-payment 契约束的签核 ① 材料。
//
// 真实组件 + mock（ADR-003），离线可渲染，不依赖后端栈。
// 用法：BASE=http://localhost:3210 node scripts/shot-billing.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3210";
const OUT = resolve(
  fileURLToPath(new URL("../../../phases/phase-21-billing-payment/ui-preview", import.meta.url)),
);
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 1180, height: 960 };

async function gotoReady(page, url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      if (resp && resp.status() >= 500) { await page.waitForTimeout(700); continue; }
      await page.waitForSelector('[data-testid="billing-preview-host"]', { state: "visible", timeout: 8000 });
      return;
    } catch { await page.waitForTimeout(700); }
  }
  throw new Error(`host never rendered for ${url}`);
}

async function assertNotBlank(page) {
  const len = (await page.evaluate(() => document.body.innerText.trim().length)) ?? 0;
  if (len < 40) throw new Error(`屏上内容过少（${len} 字），拒绝产出空图`);
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

let n = 0;
async function shoot(file, query) {
  await gotoReady(page, `${BASE}/preview/billing${query}`);
  await page.waitForTimeout(450);
  await assertNotBlank(page);
  await page.screenshot({ path: `${OUT}/${file}` });
  n += 1;
  process.stdout.write(`  ✓ ${file}\n`);
}

// ── 01 收银台（个人主体，需求 01 R8 全构成 + 订单五态） ─────────────────────
await shoot("01-cashier-default.png", "?screen=cashier&subject=personal");
await shoot("01-cashier-pending.png", "?screen=cashier&subject=personal&stage=pending");
await shoot("01-cashier-success.png", "?screen=cashier&subject=personal&state=success");
await shoot("01-cashier-expired.png", "?screen=cashier&subject=personal&stage=expired");
await shoot("01-cashier-failed.png", "?screen=cashier&subject=personal&stage=failed");
await shoot("01-cashier-empty.png", "?screen=cashier&subject=personal&state=empty");
await shoot("01-cashier-loading.png", "?screen=cashier&subject=personal&state=loading");
await shoot("01-cashier-notconfigured.png", "?screen=cashier&subject=personal&state=invalid");
await shoot("01-cashier-create-failed.png", "?screen=cashier&subject=personal&state=depfail");
// 组织主体：购买入口为组织购买（需求 01 R2）；无权限（普通成员，需求 01 E7/R5）
await shoot("01-cashier-org-pending.png", "?screen=cashier&subject=org&stage=pending");
await shoot("01-cashier-denied.png", "?screen=cashier&subject=org&state=denied");

// ── 03 订阅弹窗（需求 03 R8 + E1/E2/E5） ────────────────────────────────────
await shoot("03-subscription-free.png", "?screen=subscription&sub=free");
await shoot("03-subscription-active.png", "?screen=subscription&sub=active");
await shoot("03-subscription-trialing.png", "?screen=subscription&sub=trialing");
await shoot("03-subscription-canceled.png", "?screen=subscription&sub=canceled");
await shoot("03-subscription-syncing.png", "?screen=subscription&sub=syncing");
await shoot("03-subscription-notconfigured.png", "?screen=subscription&sub=free&state=invalid");
await shoot("03-subscription-loading.png", "?screen=subscription&sub=free&state=loading");

// ── 04 计费管理端（平台管理员，需求 04 R8） ─────────────────────────────────
await shoot("04-admin-default.png", "?screen=admin&role=platform-admin");
await shoot("04-admin-loading.png", "?screen=admin&role=platform-admin&state=loading");
await shoot("04-admin-empty.png", "?screen=admin&role=platform-admin&state=empty");
await shoot("04-admin-grant-invalid.png", "?screen=admin&role=platform-admin&state=invalid");
await shoot("04-admin-grant-confirm.png", "?screen=admin&role=platform-admin&grant=confirm");
await shoot("04-admin-grant-success.png", "?screen=admin&role=platform-admin&grant=done");
await shoot("04-admin-denied.png", "?screen=admin&role=org-admin");
await shoot("04-admin-depfail.png", "?screen=admin&role=platform-admin&state=depfail");

// ── 04 组织计费区块（组织 admin，需求 04 R3.4） ────────────────────────────
await shoot("04-org-billing-default.png", "?screen=org-billing&role=org-admin");
await shoot("04-org-billing-off.png", "?screen=org-billing&role=org-admin&billing=off");
await shoot("04-org-billing-member.png", "?screen=org-billing&role=user");

// ── 用户菜单入口（需求 01 R8 / 03 R8） ─────────────────────────────────────
await shoot("menu-entries-free.png", "?screen=menu&sub=free");
await shoot("menu-entries-subscribed.png", "?screen=menu&sub=active");

await browser.close();
process.stdout.write(`\n共 ${n} 张 → ${OUT}\n`);
