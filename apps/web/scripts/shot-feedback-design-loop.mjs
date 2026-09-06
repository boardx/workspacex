// 截图生成器 —— UC-17.8 研发闭环（反馈 → 设计 → 排期）。签核第 ① 件（UI）材料。
// 取材页 /preview/feedback-design-loop（渲染真组件 + 固定 seed，不写 localStorage）。
// 草稿（UC-17.8 B1 真栈）：由本脚本 `page.route()` 拦 `/feedback/drafts*` 提供固定数据——
// 同 shot-feedback-loop.mjs 的范式，不再 seed localStorage 草稿。
// 收件箱（UC-17.8 B3.4 真栈）：同样由 `page.route()` 拦 `/inbox`、`/inbox/counts`、
// `/feedback/:id/status`、`/feedback/:id/events`、`/system/error-logs/:id` 提供固定数据/回执——
// `DesignLoopProvider` 不再持有收件箱 mock，屏幕自己打这几条真实契约路径。
// 浅/深两态都拍；每屏至少默认/空/校验失败/成功，外加看板拖放悬停、drawer、生成中过渡、推送成功页。
// 设计工作台（UC-17.8 B4.6）：`workbench-*`/`detail-*` 这 16 张不落进 OUT，改落进
// `<OUT 的上级>/design-workbench/`——它们是契约束 `design-workbench` 自己的 ui.md 材料，
// 有自己的目录（`ui-material-map.json` 一束一目录），不与本脚本其余场景的目录混在一起。
// 用法：BASE=http://localhost:3187 OUT=/abs/path node scripts/shot-feedback-design-loop.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
// 取材夹具（草稿 / 收件箱 / 设计工作台的固定数据 + page.route 拦截）：单一事实源，与
// e2e/design-loop-responsive.spec.ts 共用，见该文件头。
import { routeDrafts, routeInbox, routeDesignWorkbench } from "./lib/design-loop-fixtures.mjs";

const BASE = process.env.BASE ?? "http://localhost:3187";
const OUT = process.env.OUT;
if (!OUT) throw new Error("OUT env required");
mkdirSync(OUT, { recursive: true });
const DESIGN_WORKBENCH_OUT = join(dirname(OUT), "design-workbench");
// UC-17.8 B5.3：`detail-prototype-*` 是契约束 `design-prototype` 自己的材料，落它自己的目录。
const DESIGN_PROTOTYPE_OUT = join(dirname(OUT), "design-prototype");
const outDirFor = (file) =>
  file.startsWith("detail-prototype-") ? DESIGN_PROTOTYPE_OUT
  : file.startsWith("workbench-") || file.startsWith("detail-") ? DESIGN_WORKBENCH_OUT : OUT;

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
  // 新增（UC-17.8 B4.6，B4.5 切真栈后才有的三态 + 一个真实等待过渡）
  ["workbench-loading-light.png", "workbench", "loading", "light", null],
  ["workbench-denied-light.png", "workbench", "denied", "light", null],
  ["workbench-depfailed-light.png", "workbench", "dep-failed", "light", null],
  ["workbench-generating-light.png", "workbench", "default", "light", createSlow],
  // 设计详情全屏（深色 IDE）
  ["detail-canvas-dark.png", "detail", "default", "dark", null],
  ["detail-spec-dark.png", "detail", "default", "dark", openSpec],
  ["detail-push-confirm-dark.png", "detail", "default", "dark", openPushConfirm],
  ["detail-push-success-dark.png", "detail", "default", "dark", doPush],
  // 新增（UC-17.8 B4.6，B4.5 切真栈后才有的两态）
  ["detail-loading-dark.png", "detail-loading", "default", "dark", null],
  ["detail-depfailed-dark.png", "detail-depfailed", "default", "dark", null],
  ["detail-missing-dark.png", "detail-missing", "default", "dark", null],
  // 新增（UC-17.8 B5.3，原型画布从占位块变成模型生成的组件树）
  // 迭代 4 起默认是画板视图：detail-prototype-dark 拍画板；单页类的三张先切到单页
  ["detail-prototype-dark.png", "detail-prototype", "default", "dark", null],
  ["detail-prototype-page2-dark.png", "detail-prototype", "default", "dark", openSecondFrame],
  ["detail-prototype-generating-dark.png", "detail-prototype", "default", "dark", sendSlow],
  ["detail-prototype-single-dark.png", "detail-prototype", "default", "dark", singleView],
  // 迭代 2：点选画布节点 ⇒ 描边 + 对话面板上方的焦点 chip
  ["detail-prototype-focus-dark.png", "detail-prototype", "default", "dark", selectNode],
  // 迭代 6：第三页「用量」——新原语一屏
  ["detail-prototype-page3-dark.png", "detail-prototype", "default", "dark", openThirdFrame],
  // 迭代 9：空项目的起手模板；发送后 AI 回复下的建议 chips
  ["detail-prototype-starters-dark.png", "detail-prototype-empty", "default", "dark", null],
  ["detail-prototype-suggestions-dark.png", "detail-prototype", "default", "dark", sendAndWait],
  // 迭代 8：导出菜单打开
  ["detail-prototype-export-dark.png", "detail-prototype", "default", "dark", openExport],
  // 迭代 5：选中节点后的属性面板（与 focus 同一动作，右栏多出字段）
  ["detail-prototype-inspector-dark.png", "detail-prototype", "default", "dark", selectNodeInspector],
  // 迭代 3：打开版本历史并预览 v1
  ["detail-prototype-history-dark.png", "detail-prototype", "default", "dark", openHistoryPreview],
];

async function clickReq(page) { await click(page, '[data-testid="feedback-kind-需求"]'); }
async function saveDraft(page) {
  await page.fill('[data-testid="feedback-detail-input"]', "批准卡不记得上次的 token 预算，每次都要重填。");
  await click(page, '[data-testid="feedback-save-draft"]');
  await page.waitForSelector('[data-testid="feedback-draft-saved"]', { timeout: 4000 });
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
async function createSlow(page) {
  await clickUntil(page, '[data-testid="workbench-new"]', '[data-testid="project-dialog"]');
  await page.fill('[data-testid="project-dialog-name"]', "移动端登录页重设计");
  await click(page, '[data-testid="project-dialog-submit"]');
  await page.waitForSelector('[data-testid="workbench-generating"]', { timeout: 4000 });
}
async function singleView(page) { await clickUntil(page, '[data-testid="design-detail-view-single"]', '[data-testid="design-detail-phone-tree"]'); await page.waitForTimeout(200); }
async function openThirdFrame(page) { await singleView(page); await click(page, '[data-testid="design-detail-frame-2"]'); }
async function openSecondFrame(page) { await singleView(page); await click(page, '[data-testid="design-detail-frame-1"]'); }
async function openHistoryPreview(page) {
  await singleView(page);
  await clickUntil(page, '[data-testid="design-detail-history-toggle"]', '[data-testid="design-history"]');
  await clickUntil(page, '[data-testid="design-history-preview-1"]', '[data-testid="design-detail-preview-banner"]');
}
async function sendAndWait(page) {
  await singleView(page);
  await page.fill('[data-testid="design-detail-input"]', "输入区加一个附件按钮，消息流里给 AI 回复加复制按钮");
  await click(page, '[data-testid="design-detail-send"]');
  await page.waitForSelector('[data-testid="design-detail-suggestions"]', { timeout: 8000 });
}
async function openExport(page) { await clickUntil(page, '[data-testid="design-detail-export"]', '[data-testid="design-detail-export-menu"]'); }
async function selectNodeInspector(page) {
  await selectNode(page);
  await page.waitForSelector('[data-testid="design-inspector"]', { timeout: 4000 });
  // 与 focus 那张的区别：这里把文案改成未应用的草稿态，「应用」按钮由灰转亮。
  await page.fill('[data-testid="design-inspector-label"]', "停止生成");
  await page.waitForSelector('[data-testid="design-inspector-apply"]:not([disabled])', { timeout: 4000 });
}
async function selectNode(page) {
  await singleView(page);
  await page.locator('[data-proto="button"]').first().click();
  await page.waitForSelector('[data-testid="design-detail-focus"]', { timeout: 4000 });
}
async function sendSlow(page) {
  await singleView(page);
  await page.fill('[data-testid="design-detail-input"]', "输入区加一个附件按钮，消息流里给 AI 回复加复制按钮");
  await click(page, '[data-testid="design-detail-send"]');
  await page.waitForSelector('[data-testid="design-detail-generating"]', { timeout: 4000 });
  // 等到计时器真的走过一秒再拍：恒为 0s 的静态图无法自证计时器在动（rev-uiux 复评登记项）。
  await page.waitForFunction(() => {
    const el = document.querySelector('[data-testid="design-detail-elapsed"]');
    return el !== null && /[1-9]\d*s/.test(el.textContent ?? "");
  }, { timeout: 4000 });
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

// 可选 SHOTS_FILTER：正则，只跑文件名匹配的条目（调试/重跑单个屏用，默认跑全部）。
const filterRe = process.env.SHOTS_FILTER ? new RegExp(process.env.SHOTS_FILTER) : null;
const shotsToRun = filterRe ? SHOTS.filter(([file]) => filterRe.test(file)) : SHOTS;

mkdirSync(DESIGN_WORKBENCH_OUT, { recursive: true });
mkdirSync(DESIGN_PROTOTYPE_OUT, { recursive: true });
const browser = await chromium.launch(process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {});
for (const [file, scene, state, theme, prepare] of shotsToRun) {
  const context = await browser.newContext({ viewport: { width: 1360, height: 900 }, colorScheme: theme, deviceScaleFactor: 2 });
  const page = await context.newPage();
  await routeDrafts(page, { empty: scene === "drafts-empty" });
  await routeInbox(page, { empty: scene === "inbox-empty" });
  await routeDesignWorkbench(page, {
    empty: scene === "workbench-empty",
    slow: scene === "detail-loading",
    failList: scene === "detail-depfailed",
  });
  await gotoReady(page, `/preview/feedback-design-loop?scene=${scene}&state=${state}`);
  await page.waitForTimeout(500);
  if (prepare) await prepare(page);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${outDirFor(file)}/${file}` });
  console.log(`✓ ${file}`);
  await context.close();
}
await browser.close();
console.log("done");
