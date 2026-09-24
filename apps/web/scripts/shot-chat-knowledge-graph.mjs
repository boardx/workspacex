// 截图生成器 —— chat-knowledge-graph 束（Phase 18）UI 先行原型。ADR-023 签核第 ① 件材料。
// 纯 mock 原型页 /preview/chat-knowledge-graph，不接后端。
// 用法：BASE=http://localhost:3132 OUT=/abs/path node scripts/shot-chat-knowledge-graph.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3132";
const OUT = process.env.OUT;
const CHROME = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
if (!OUT) throw new Error("OUT env required");
mkdirSync(OUT, { recursive: true });

const VIEWPORT = { width: 1200, height: 900 };
const SHELL = '[data-testid="kg-thread-shell"]';

/**
 * [file, scene, opts] —— file 名遵循 <uc-id>-<屏名>-<状态>.png。
 * opts: { role?, click?: [testid...] 逐个点, full?: true 整页截（菜单/弹窗走 portal 到 body） }
 */
const SHOTS = [
  // 对话里：价值出现在原位（U-1 / U-4 / U-5 / uc-18-6）
  ["uc-18-1-turn-captured.png", "turn-captured", {}],
  ["uc-18-1-turn-captured-expanded.png", "turn-captured", { click: ['[data-testid="kg-turn-captured-view"]'] }],
  ["uc-18-1-turn-pending.png", "turn-pending", {}],
  ["uc-18-6-remember-card.png", "card-remember", {}],
  ["uc-18-6-remember-card-done.png", "card-remember-done", {}],
  ["uc-18-6-forget-card.png", "card-forget", {}],
  ["uc-18-6-conflict-card.png", "card-conflict", {}],
  ["uc-18-6-conflict-keep-both.png", "card-conflict", { click: ['[data-testid="kg-conflict-keep-both"]'] }],
  ["uc-18-6-recall-answer.png", "recall-answer", {}],
  // U-2 一键 对/不对 + 全部确认（uc-18-3）
  ["uc-18-3-onetap-yesno.png", "onetap", {}],
  ["uc-18-3-onetap-wrong-open.png", "onetap", { click: ['[data-testid="kg-row-no-clm-todo-migrate"]'] }],
  // 记忆面板（uc-18-3）——头部常驻可见范围 kg-visibility
  ["uc-18-3-list-normal.png", "list-normal", {}],
  ["uc-18-3-list-loading.png", "list-loading", {}],
  ["uc-18-3-list-empty.png", "list-empty", {}],
  ["uc-18-3-list-partial-failure.png", "list-partial", {}],
  ["uc-18-3-list-error.png", "list-error", {}],
  ["uc-18-3-list-readonly.png", "list-readonly", {}],
  ["uc-18-3-graph-normal.png", "graph-normal", {}],
  ["uc-18-3-graph-oversize.png", "graph-oversize", {}],
  ["uc-18-3-graph-loading.png", "graph-loading", {}],
  ["uc-18-3-graph-error.png", "graph-error", {}],
  ["uc-18-3-edit-menu-owner.png", "onetap", { full: true, click: ['[data-testid="kg-claim-edit-trigger-clm-todo-migrate"]'] }],
  ["uc-18-3-delete-confirm.png", "onetap", { full: true, click: ['[data-testid="kg-claim-edit-trigger-clm-todo-migrate"]', '[data-testid="kg-action-delete-clm-todo-migrate"]'] }],
  // 来源与召回（uc-18-2 / uc-18-5）
  ["uc-18-2-source-drawer-normal.png", "drawer-normal", {}],
  ["uc-18-5-source-drawer-revoked.png", "drawer-revoked", {}],
  ["uc-18-2-answer-citations-why-recall.png", "answer-normal", { click: ['[data-testid="kg-why-recall-toggle"]'] }],
  ["uc-18-2-answer-graph-unavailable.png", "answer-graph-down", {}],
  ["uc-18-2-answer-vector-unavailable.png", "answer-vector-down", {}],
  ["uc-18-4-answer-from-personal.png", "answer-personal", {}],
  // 记入长期记忆（uc-18-4）
  ["uc-18-4-promote-results.png", "promote-results", {}],
  ["uc-18-4-nomination-card.png", "nomination", {}],
];

async function gotoUntilReady(page, url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (resp && resp.status() === 404) { await page.waitForTimeout(700); continue; }
      await page.waitForSelector(SHELL, { state: "attached", timeout: 10000 });
      return true;
    } catch { await page.waitForTimeout(700); }
  }
  throw new Error(`shell never rendered for ${url}`);
}

/** hydration-safe：轮询点击直到目标出现（React onClick 可能还没挂上）。 */
async function robustClick(page, selector, tries = 25) {
  for (let i = 0; i < tries; i++) {
    await page.click(selector, { timeout: 1500 }).catch(() => {});
    await page.waitForTimeout(200);
    // 认为点成功：aria-expanded=true，或某个后续元素出现——这里简单等一下即可
    return;
  }
}

const errors = [];
const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

let n = 0;
for (const [file, scene, opts] of SHOTS) {
  const role = opts.role ?? "owner";
  await gotoUntilReady(page, `/preview/chat-knowledge-graph?scene=${scene}&role=${role}`);
  await page.waitForTimeout(scene.startsWith("graph") ? 2500 : 700);
  for (const sel of opts.click ?? []) {
    await robustClick(page, sel);
    await page.waitForTimeout(400);
  }
  const path = `${OUT}/${file}`;
  if (opts.full) {
    await page.screenshot({ path });
  } else {
    const el = await page.$(SHELL);
    await el.screenshot({ path });
  }
  n++;
  process.stdout.write(`  [${n}/${SHOTS.length}] ${file}\n`);
}

await browser.close();
const appErrors = errors.filter((e) => !/ERR_CONNECTION_REFUSED|Failed to load resource|favicon|hydrat/i.test(e));
console.log(`done: ${n} shots. console errors (filtered app): ${appErrors.length}`);
if (appErrors.length) appErrors.slice(0, 10).forEach((e) => console.log("  ! " + e));
