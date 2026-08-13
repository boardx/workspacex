// 截图生成器 —— agent-tool-chain 束（TOOLCHAIN-01：活体 run 工具调用链折叠式展示）原型。
// ADR-023 签核第 ① 件（UI）材料。纯 mock 原型页 /preview/agent-tool-chain，不接后端。
//
// 收起态 + 展开态都拍；浅色/深色两态都拍。
// 用法：BASE=http://localhost:3132 OUT=/abs/path node scripts/shot-agent-tool-chain.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3132";
const OUT = process.env.OUT;
if (!OUT) throw new Error("OUT env required");
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 820, height: 900 };
const ROOT = '[data-testid="agent-tool-chain-preview"]';
const CHAIN = '[data-testid="agent-tool-chain"]';
const TOGGLE = '[data-testid="agent-tool-chain-toggle"]';
const DETAIL = '[data-testid="agent-tool-chain-detail"]';

/**
 * [file, scene, expandFirst] —— 文件名遵循 <uc-id>-<屏名>-<状态>.png（束 = TOOLCHAIN-01）。
 * expandFirst=true 时先点摘要行展开再拍。
 */
const SHOTS = [
  // 主打：3 工具全成功，默认收起一行摘要
  ["toolchain01-chain-default-collapsed.png", "collapsed", false],
  // 同一份数据的展开态
  ["toolchain01-chain-expanded.png", "collapsed", true],
  // 含失败：收起态（摘要带红色失败计数）
  ["toolchain01-chain-with-failure-collapsed.png", "failure", false],
  // 含失败：展开态（失败行走 destructive）
  ["toolchain01-chain-with-failure-expanded.png", "failure", true],
  // 模型直接作答：收起态
  ["toolchain01-chain-no-tools-collapsed.png", "no-tools", false],
  // 模型直接作答：展开态（「本次没有工具调用」）
  ["toolchain01-chain-no-tools-expanded.png", "no-tools", true],
  // 单工具：收起态
  ["toolchain01-chain-single-collapsed.png", "single", false],
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

/**
 * 展开工具链——hydration-safe：domcontentloaded 后 React 可能还没挂上 onClick，
 * 一次 click 会打空（点在未激活的按钮上，aria-expanded 不变）。这里轮询点击，
 * 直到 aria-expanded 变 true 或 detail 出现为止，绕过 hydration 竞态。
 */
async function ensureExpanded(page, tries = 20) {
  if ((await page.locator(DETAIL).count()) > 0) return;
  for (let i = 0; i < tries; i++) {
    await page.click(TOGGLE).catch(() => {});
    await page.waitForTimeout(300);
    const expanded = (await page.getAttribute(TOGGLE, "aria-expanded")) === "true";
    if (expanded && (await page.locator(DETAIL).count()) > 0) return;
  }
  throw new Error("tool chain never expanded (hydration?)");
}

async function shootScheme(page, scheme) {
  await page.emulateMedia({ colorScheme: scheme });
  const suffix = scheme === "dark" ? "-dark" : "";
  const errors = [];
  const onErr = (m) => { if (m.type() === "error") errors.push(m.text()); };
  page.on("console", onErr);

  let n = 0;
  for (const [file, scene, expandFirst] of SHOTS) {
    await gotoUntilReady(page, `/preview/agent-tool-chain?scene=${scene}`);
    await page.waitForSelector(CHAIN, { state: "visible", timeout: 8000 });
    // 给 hydration 一点时间再动它（收起态截图也要求 onClick 已就绪的稳定态）
    await page.waitForTimeout(400);
    if (expandFirst) await ensureExpanded(page);
    await page.waitForTimeout(250);
    const out = file.replace(/\.png$/, `${suffix}.png`);
    await page.screenshot({ path: `${OUT}/${out}`, fullPage: true });
    n++;
    process.stdout.write(`  ✓ ${out}\n`);
  }
  page.off("console", onErr);
  return { n, errors };
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
await page.route(/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());

let total = 0;
const allErrors = [];
for (const scheme of ["light", "dark"]) {
  const { n, errors } = await shootScheme(page, scheme);
  total += n;
  allErrors.push(...errors);
}
await browser.close();

if (allErrors.length > 0) {
  process.stderr.write(`\n⚠ console errors (${allErrors.length}):\n${allErrors.join("\n")}\n`);
  process.exit(1);
}
console.log(`done: ${total} screenshots → ${OUT} (light + dark, zero console error)`);
