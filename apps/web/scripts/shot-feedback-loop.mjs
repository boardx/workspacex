// 截图生成器 —— `feedback-loop` 束（FB-2 采集 + FB-3 后台真栈化）。
// ADR-023 签核第 ① 件（UI）材料。取材页 /preview/feedback-loop，**渲染的是真组件**；
// 数据由本脚本 page.route() 拦截 `**/feedback**` 提供——截出来的屏与生产只差数据，不差代码。
//
// 浅色/深色两态都拍：uiux-standards 要求两态都可读，只拍一态等于只验了一半。
// 用法：BASE=http://localhost:3132 OUT=/abs/path node scripts/shot-feedback-loop.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3132";
const OUT = process.env.OUT;
if (!OUT) throw new Error("OUT env required");
mkdirSync(OUT, { recursive: true });

const ROOT = '[data-testid="feedback-loop-preview"]';

/** 固定的取材数据。⚠ 与生产投影同形（`FeedbackItem`），字段少一个都会让屏上少一块。 */
const ITEMS = [
  {
    id: "fb-1", kind: "缺陷", target: { kind: "product" }, targetLabel: null,
    title: "批准卡不记得上次的 token 预算",
    detail: "每次都要重填，第三次之后就不想用了。",
    status: "待处理", statusReason: null, votes: 7, votedByMe: false, submittedByMe: true,
    occurredRoute: "/chat", appVersion: "2026.08.15", createdAt: "2026-08-15T02:14:00.000Z",
  },
  {
    id: "fb-2", kind: "需求", target: { kind: "product" }, targetLabel: null,
    title: "希望能按项目筛选录音",
    detail: "现在录音列表是全组织的，找上周那场要翻很久。",
    status: "已进入迭代", statusReason: "排期到本轮迭代", votes: 3, votedByMe: true, submittedByMe: false,
    occurredRoute: "/rec", appVersion: "2026.08.14", createdAt: "2026-08-14T09:02:00.000Z",
  },
  {
    id: "fb-3", kind: "缺陷", target: { kind: "agent", agentId: "agent-research" }, targetLabel: "调研助手",
    title: "上传三个文件只读了一个",
    detail: null,
    status: "待处理", statusReason: null, votes: 5, votedByMe: false, submittedByMe: false,
    occurredRoute: "/chat", appVersion: "2026.08.15", createdAt: "2026-08-15T01:40:00.000Z",
  },
  {
    id: "fb-4", kind: "需求", target: { kind: "skill", skillId: "skill-meeting-notes" }, targetLabel: "会议纪要",
    title: "输出格式希望固定成表格",
    detail: "有时候给表格有时候给段落，下游没法直接用。",
    status: "已修复", statusReason: null, votes: 9, votedByMe: false, submittedByMe: false,
    occurredRoute: "/chat", appVersion: "2026.08.12", createdAt: "2026-08-12T14:20:00.000Z",
  },
];

const COUNTS = { total: 4, 待处理: 2, 已进入迭代: 1, 已修复: 1, 不做: 0 };

/** [file, scene, theme, prepare] */
const SHOTS = [
  ["fb-entries-light.png", "entries", "light", null],
  ["fb-entries-dark.png", "entries", "dark", null],
  ["fb-dialog-submit-product-light.png", "dialog-product", "light", null],
  ["fb-dialog-submit-product-dark.png", "dialog-product", "dark", null],
  ["fb-dialog-submit-skill-light.png", "dialog-skill", "light", null],
  ["fb-dialog-mine-light.png", "dialog-product", "light", openMineTab],
  ["fb-admin-two-columns-light.png", "admin", "light", null],
  ["fb-admin-two-columns-dark.png", "admin", "dark", null],
  ["fb-admin-decline-reason-light.png", "admin", "light", openDeclineReason],
];

async function openMineTab(page) {
  await clickUntil(page, '[data-testid="feedback-tab-mine"]', '[data-testid="feedback-mine-list"]');
}

async function openDeclineReason(page) {
  await clickUntil(
    page,
    '[data-testid="admin-feedback-to-不做-fb-1"]',
    '[data-testid="admin-feedback-decline-fb-1"]',
  );
}

/**
 * hydration-safe 点击：`domcontentloaded` 之后 React 可能还没挂上 onClick，
 * 一次 click 会打空而截图看起来「功能没做」。轮询点到目标出现为止。
 */
async function clickUntil(page, selector, expect, tries = 25) {
  for (let i = 0; i < tries; i++) {
    if ((await page.locator(expect).count()) > 0) return;
    await page.locator(selector).first().click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }
  throw new Error(`clickUntil: ${expect} never appeared after clicking ${selector}`);
}

async function gotoUntilReady(page, url, tries = 60) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (resp && resp.status() === 404) { await page.waitForTimeout(700); continue; }
      await page.waitForSelector(ROOT, { state: "attached", timeout: 8000 });
      return;
    } catch { await page.waitForTimeout(700); }
  }
  throw new Error(`root ${ROOT} never rendered for ${url}`);
}

const browser = await chromium.launch();
for (const [file, scene, theme, prepare] of SHOTS) {
  const context = await browser.newContext({
    viewport: { width: scene === "admin" ? 1280 : 900, height: 900 },
    colorScheme: theme,
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  // ⚠ 拦截而不是起后端：截图脚本要能在任何机器上重跑出**同一张图**。
  //   连真库的话，图会随那台机器上的数据变，而签核签的是图。
  // ⚠ 用**路径谓词**而不是 glob。第一版写的是 `**/feedback**`，它同时匹配了取材页自己
  //   （`/preview/feedback-loop`），于是页面本体被换成了一段 JSON，屏永远渲染不出来。
  //   glob 里的 `feedback` 与 `feedback-loop` 分不开；`pathname === "/feedback"` 分得开。
  const pathIs = (want) => (url) => {
    try { return new URL(url).pathname === want; } catch { return false; }
  };
  await page.route(pathIs("/feedback/counts"), (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(COUNTS) }),
  );
  await page.route(pathIs("/feedback"), (route) => {
    const url = route.request().url();
    if (route.request().method() !== "GET") {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ feedbackId: "fb-new", status: "待处理" }) });
    }
    const mine = url.includes("scope=mine");
    const items = mine ? ITEMS.filter((i) => i.submittedByMe) : ITEMS;
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items }) });
  });

  await gotoUntilReady(page, `/preview/feedback-loop?scene=${scene}`);
  if (prepare) await prepare(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: scene === "admin" });
  console.log(`✓ ${file}`);
  await context.close();
}
await browser.close();
