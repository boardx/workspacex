// 截图生成器 —— UC-17.8 研发闭环（反馈 → 设计 → 排期）。签核第 ① 件（UI）材料。
// 取材页 /preview/feedback-design-loop（渲染真组件 + 固定 seed，不写 localStorage）。
// 草稿（UC-17.8 B1 真栈）：由本脚本 `page.route()` 拦 `/feedback/drafts*` 提供固定数据——
// 同 shot-feedback-loop.mjs 的范式，不再 seed localStorage 草稿。
// 浅/深两态都拍；每屏至少默认/空/校验失败/成功，外加看板拖放悬停、drawer、生成中过渡、推送成功页。
// 用法：BASE=http://localhost:3187 OUT=/abs/path node scripts/shot-feedback-design-loop.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3187";
const OUT = process.env.OUT;
if (!OUT) throw new Error("OUT env required");
mkdirSync(OUT, { recursive: true });

const ROOT = '[data-testid="feedback-design-loop-preview"]';

/** 固定的草稿取材数据。⚠ 与契约 `FeedbackDraft` 同形，字段少一个屏上就少一块。 */
const NOW = "2026-09-03T02:14:00.000Z";
const DRAFTS = [
  {
    id: "draft-batch-token", kind: "缺陷", target: { kind: "product" },
    title: "批准卡不记得上次的 token 预算",
    detail: "每次批准都要重填 token 预算，第三次之后就不想用了。期望能记住上一次填的值。",
    structured: { reproFrequencyEnv: "每次 · Chrome 128", expectedResult: "记住上次的值", actualResult: "每次都是空的" },
    attachments: [{ id: "att-1", url: "/feedback/attachments/att-1", mime: "image/png" }],
    chat: [{ role: "user", kind: "message", text: "批准卡不记得上次的 token 预算，每次都要重填。", at: NOW }],
    refineSeeded: false, occurredRoute: "/chat", appVersion: "2026.09.03", createdAt: NOW, updatedAt: NOW,
  },
  {
    id: "draft-rec-filter", kind: "需求", target: { kind: "product" },
    title: "希望能按项目筛选录音",
    detail: "现在录音列表是全组织的，找上周那场要翻很久。希望能按项目、按时间范围筛。",
    structured: null, attachments: [],
    chat: [{ role: "user", kind: "message", text: "录音列表能不能按项目筛选？", at: NOW }],
    refineSeeded: false, occurredRoute: "/rec", appVersion: "2026.09.03", createdAt: "2026-09-02T09:02:00.000Z", updatedAt: "2026-09-02T09:02:00.000Z",
  },
  {
    id: "draft-export-table", kind: "需求", target: { kind: "skill", skillId: "skill-meeting-notes" },
    title: "会议纪要输出希望固定成表格",
    detail: "有时候给表格有时候给段落，下游没法直接用。希望能在 skill 设置里固定输出格式。",
    structured: { useScenario: "导出纪要到下游表格", expectedCapability: "固定输出格式", priorityScope: "中 · 所有导出入口" },
    attachments: [],
    chat: [
      { role: "user", kind: "message", text: "会议纪要的输出格式不稳定，希望能固定成表格。", at: NOW },
      { role: "ai", kind: "message", text: "这个需求的边界在哪：只影响当前场景，还是所有相关入口都要一起改？优先级怎么排？", at: NOW },
      { role: "user", kind: "message", text: "所有导出入口都要一致，优先级中等。", at: NOW },
      { role: "ai", kind: "message", text: "已记录，还有想补充的吗？", at: NOW },
    ],
    refineSeeded: true, occurredRoute: "/chat", appVersion: "2026.09.03", createdAt: "2026-09-01T14:20:00.000Z", updatedAt: "2026-09-01T14:20:00.000Z",
  },
];

/** 拦 `/feedback/drafts*`：列表 / 计数 / 建 / 改（回整条草稿，追加的对话由"服务端"补 AI 回执）/ 删 / 提交。 */
async function routeDrafts(page, { empty }) {
  const json = (route, body, status = 200) =>
    route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
  const drafts = empty ? [] : DRAFTS.map((d) => ({ ...d, chat: [...d.chat] }));
  await page.route((url) => new URL(url).pathname.startsWith("/feedback/drafts"), (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const method = req.method();
    if (path === "/feedback/drafts/count") return json(route, { count: drafts.length });
    if (path === "/feedback/drafts" && method === "GET") return json(route, { items: drafts });
    if (path === "/feedback/drafts" && method === "POST") return json(route, { draftId: "draft-new" }, 201);
    const m = /^\/feedback\/drafts\/([^/]+)(\/submit)?$/.exec(path);
    if (!m) return json(route, { reasonCode: "DRAFT_NOT_FOUND" }, 404);
    const draft = drafts.find((d) => d.id === decodeURIComponent(m[1]));
    if (!draft) return json(route, { reasonCode: "DRAFT_NOT_FOUND" }, 404);
    if (m[2]) return json(route, { feedbackId: "fb-from-draft", status: "待处理" });
    if (method === "DELETE") return json(route, { draftId: draft.id });
    if (method === "PATCH") {
      const body = req.postDataJSON() ?? {};
      if (body.kind) draft.kind = body.kind;
      if (typeof body.detail === "string") draft.detail = body.detail;
      if (body.appendChat) {
        draft.chat.push({ ...body.appendChat, at: NOW });
        draft.chat.push({ role: "ai", kind: "message", text: "已记录，还有想补充的吗？", at: NOW });
      }
      return json(route, { draft });
    }
    return json(route, {}, 405);
  });
}

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
  await routeDrafts(page, { empty: scene === "drafts-empty" });
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
