// 截图生成器 —— agent-interrupts 契约束的签核 ① 材料（三屏 × 七态 + 关键变体）。
//
// 真实组件 + mock（ADR-003），离线可渲染，不依赖后端栈。
// 用法：BASE=http://localhost:3210 node scripts/shot-agent-interrupts.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE ?? "http://localhost:3210";
const OUT = resolve(
  fileURLToPath(new URL("../../../phases/phase-01-run-a-project/ui-preview/agent-interrupts", import.meta.url)),
);
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 1180, height: 1000 };

async function gotoReady(page, url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
      if (resp && resp.status() >= 500) { await page.waitForTimeout(700); continue; }
      await page.waitForSelector('[data-testid="agent-interrupts-host"]', { state: "visible", timeout: 8000 });
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
  await gotoReady(page, `${BASE}/preview/agent-interrupts${query}`);
  await page.waitForTimeout(350);
  await assertNotBlank(page);
  const target = page.locator('main > div'); // 居中的 max-w-3xl 容器（含切换器 + 卡片）
  await target.screenshot({ path: `${OUT}/${file}` });
  n += 1;
  process.stdout.write(`  ✓ ${file}\n`);
}

const STATES = ["default", "loading", "empty", "invalid", "dep-failed", "denied", "success"];

// UC-1 confirm_intent
for (const s of STATES) await shoot(`uc-1-confirm-intent-${s}.png`, `?screen=confirm-intent&state=${s}`);
await shoot("uc-1-confirm-intent-edit.png", "?screen=confirm-intent&variant=edit");
await shoot("uc-1-confirm-intent-observer.png", "?screen=confirm-intent&as=observer");

// UC-2 fill_params
for (const s of STATES) await shoot(`uc-2-fill-params-${s}.png`, `?screen=fill-params&state=${s}`);

// UC-3 choose_option
for (const s of STATES) await shoot(`uc-3-choose-option-${s}.png`, `?screen=choose-option&state=${s}`);
await shoot("uc-3-choose-option-two.png", "?screen=choose-option&variant=two");
await shoot("uc-3-choose-option-selected.png", "?screen=choose-option&variant=selected");

await browser.close();
process.stdout.write(`\n共 ${n} 张 → ${OUT}\n`);
