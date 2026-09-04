// 截图生成器 —— UC-17.8 研发闭环（反馈 → 设计 → 排期）。签核第 ① 件（UI）材料。
// 取材页 /preview/feedback-design-loop（渲染真组件 + 固定 seed，不写 localStorage）。
// 浅/深两态都拍；每屏至少默认/空/校验失败/成功，外加看板拖放悬停、drawer、生成中过渡、推送成功页。
// 用法：BASE=http://localhost:3187 OUT=/abs/path node scripts/shot-feedback-design-loop.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3187";
const OUT = process.env.OUT;
if (!OUT) throw new Error("OUT env required");
mkdirSync(OUT, { recursive: true });

const ROOT = '[data-testid="feedback-design-loop-preview"]';

/** [file, scene, state, theme, prepare, viewport] */
const SHOTS = [
  // 快速反馈弹窗
  ["dialog-default-light.png", "dialog", "default", "light", null],
  ["dialog-default-dark.png", "dialog", "default", "dark", null],
  ["dialog-req-light.png", "dialog", "default", "light", clickReq],
  ["dialog-draft-saved-light.png", "dialog", "default", "light", saveDraft],
  // 反馈草稿
  ["drafts-default-light.png", "drafts", "default", "light", null],
  ["drafts-default-dark.png", "drafts", "default", "dark", null],
  ["drafts-empty-light.png", "drafts-empty", "empty", "light", null],
  ["drafts-edit-drawer-light.png", "drafts", "default", "light", openFirstDraft],
  ["drafts-refine-light.png", "drafts", "default", "light", openRefine],
  // 运营收件箱
  ["inbox-board-light.png", "inbox-board", "default", "light", null],
  ["inbox-board-dark.png", "inbox-board", "default", "dark", null],
  ["inbox-board-draghover-light.png", "inbox-board", "default", "light", hoverColumn],
  ["inbox-list-light.png", "inbox-board", "default", "light", switchList],
  ["inbox-drawer-light.png", "inbox-board", "default", "light", openInboxDrawer],
  ["inbox-decline-invalid-light.png", "inbox-board", "default", "light", openDecline],
  ["inbox-success-light.png", "inbox-board", "default", "light", startProcessing],
  ["inbox-empty-light.png", "inbox-empty", "empty", "light", null],
  ["inbox-loading-light.png", "inbox-board", "loading", "light", null],
  ["inbox-denied-light.png", "inbox-board", "denied", "light", null],
  ["inbox-depfailed-light.png", "inbox-board", "dep-failed", "light", null],
  // PM 设计工作台
  ["workbench-default-light.png", "workbench", "default", "light", null],
  ["workbench-default-dark.png", "workbench", "default", "dark", null],
  ["workbench-empty-light.png", "workbench-empty", "empty", "light", null],
  ["workbench-new-dialog-light.png", "workbench", "default", "light", openNewDesign],
  ["workbench-new-invalid-light.png", "workbench", "default", "light", openNewDesignEmpty],
  // 设计详情全屏（深色 IDE）
  ["detail-canvas-dark.png", "detail", "default", "dark", null],
  ["detail-spec-dark.png", "detail", "default", "dark", openSpec],
  ["detail-push-confirm-dark.png", "detail", "default", "dark", openPushConfirm],
  ["detail-push-success-dark.png", "detail", "default", "dark", doPush],
];

async function clickReq(page) { await click(page, '[data-testid="feedback-kind-需求"]'); }
async function saveDraft(page) {
  await page.fill('[data-testid="feedback-detail-input"]', "批准卡不记得上次的 token 预算，每次都要重填。");
  await click(page, '[data-testid="feedback-save-draft"]');
  await page.waitForTimeout(200);
}
async function openFirstDraft(page) { await clickFirst(page, '[data-testid^="draft-open-"]', '[data-testid="draft-edit-drawer"]'); }
async function openRefine(page) { await clickFirst(page, '[data-testid^="draft-refine-"]', '[data-testid="draft-refine-overlay"]'); }
async function hoverColumn(page) {
  const card = page.locator('[data-testid="inbox-card-B-1"]').first();
  const col = page.locator('[data-testid="inbox-column-doing"]').first();
  await card.hover();
  await page.mouse.down();
  const box = await col.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 6 });
  await page.waitForTimeout(300);
}
async function switchList(page) { await click(page, '[data-testid="inbox-view-list"]'); await page.waitForSelector('[data-testid="inbox-list"]'); }
async function openInboxDrawer(page) { await clickUntil(page, '[data-testid="inbox-card-B-1"]', '[data-testid="inbox-drawer"]'); }
async function openDecline(page) {
  await clickUntil(page, '[data-testid="inbox-card-B-1"]', '[data-testid="inbox-drawer"]');
  await clickUntil(page, '[data-testid="inbox-action-decline"]', '[data-testid="inbox-decline-form"]');
}
async function startProcessing(page) {
  await clickUntil(page, '[data-testid="inbox-card-B-1"]', '[data-testid="inbox-drawer"]');
  await clickUntil(page, '[data-testid="inbox-action-start"]', '[data-testid="saved"]');
}
async function openNewDesign(page) { await clickUntil(page, '[data-testid="workbench-new"]', '[data-testid="project-dialog"]'); }
async function openNewDesignEmpty(page) {
  await clickUntil(page, '[data-testid="workbench-new"]', '[data-testid="project-dialog"]');
  await page.fill('[data-testid="project-dialog-name"]', "abc");
  await page.fill('[data-testid="project-dialog-name"]', "");
}
async function openSpec(page) { await clickUntil(page, '[data-testid="design-detail-tab-spec"]', '[data-testid="design-detail-spec"]'); }
async function openPushConfirm(page) { await clickUntil(page, '[data-testid="design-detail-push"]', '[data-testid="design-push-confirm"]'); }
async function doPush(page) {
  await clickUntil(page, '[data-testid="design-detail-push"]', '[data-testid="design-push-confirm"]');
  await clickUntil(page, '[data-testid="design-push-confirm-submit"]', '[data-testid="design-push-success"]');
}

async function click(page, sel) { await page.locator(sel).first().click({ timeout: 4000 }); }
async function clickFirst(page, sel, expect) { await clickUntil(page, sel, expect); }
async function clickUntil(page, selector, expect, tries = 25) {
  for (let i = 0; i < tries; i++) {
    if ((await page.locator(expect).count()) > 0) return;
    await page.locator(selector).first().click({ timeout: 3000 }).catch(() => undefined);
    await page.waitForTimeout(250);
  }
  throw new Error(`clickUntil: ${expect} never appeared after clicking ${selector}`);
}

async function gotoReady(page, url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await page.goto(BASE + url, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (resp && resp.status() === 404) { await page.waitForTimeout(700); continue; }
      await page.waitForSelector(ROOT, { state: "attached", timeout: 8000 });
      return;
    } catch { await page.waitForTimeout(700); }
  }
  throw new Error(`场景加载失败：${url}`);
}

const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
for (const [file, scene, state, theme, prepare] of SHOTS) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: theme, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await gotoReady(page, `/preview/feedback-design-loop?scene=${scene}&state=${state}`);
  await page.waitForTimeout(500);
  if (prepare) await prepare(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${file}` });
  console.log(`✓ ${file}`);
  await context.close();
}
await browser.close();
console.log("done");
