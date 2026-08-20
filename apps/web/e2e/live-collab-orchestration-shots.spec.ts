import { test, expect, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 取证：把 Phase 10「现场协作编排」UI 先行原型的 9 个屏 + 七态 + 视角差异各截一张，
 * 落到 phases/phase-10-live-collaboration-orchestration/ui-preview/。
 * 纯前端 mock 预览页（不接后端），对已预热 dev server（默认 3242）截图。
 */
const OUT = join(
  process.cwd(), "..", "..",
  "phases", "phase-10-live-collaboration-orchestration", "ui-preview",
);
mkdirSync(OUT, { recursive: true });

test.use({ viewport: { width: 1320, height: 1000 } });

async function goto(page: Page, screen: string, state = "default", as = "facilitator") {
  await page.goto(`/preview/live-collab-orchestration?screen=${screen}&state=${state}&as=${as}`);
  await page.waitForLoadState("networkidle").catch(() => {});
  await expect(page.getByTestId("lc-orchestration-preview")).toBeVisible();
}
async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage: true });
}

/* ── 9 个屏 · 默认态（对应人类提供的 8 张截图）── */

test("stage-default (主持台全场默认 + 环节状态条)", async ({ page }) => {
  await goto(page, "stage-default");
  await expect(page.getByTestId("lc-stage-bar")).toBeVisible();
  await expect(page.getByTestId("lc-stage-subviews")).toBeVisible();
  await shot(page, "stage-default-default");
});

test("viewer-switcher expanded (展开态含分组状态后缀)", async ({ page }) => {
  await goto(page, "stage-default");
  await page.getByTestId("lc-viewer-trigger").click();
  await expect(page.getByTestId("lc-viewer-menu")).toBeVisible();
  await expect(page.getByTestId("lc-viewer-option-g3")).toBeVisible();
  await shot(page, "viewer-switcher-expanded");
});

test("group-graph (分组·本组图谱)", async ({ page }) => {
  await goto(page, "group-graph");
  await expect(page.getByTestId("lc-group-graph")).toBeVisible();
  await expect(page.getByTestId("lc-module-sidebar")).toBeVisible();
  await shot(page, "group-graph-default");
});

test("group-survey (分组·问卷)", async ({ page }) => {
  await goto(page, "group-survey");
  await expect(page.getByTestId("lc-module-list-survey")).toBeVisible();
  await shot(page, "group-survey-default");
});

test("group-research (分组·深度研究)", async ({ page }) => {
  await goto(page, "group-research");
  await expect(page.getByTestId("lc-module-list-research")).toBeVisible();
  await shot(page, "group-research-default");
});

test("group-interview (分组·用户访谈)", async ({ page }) => {
  await goto(page, "group-interview");
  await expect(page.getByTestId("lc-module-list-interview")).toBeVisible();
  await shot(page, "group-interview-default");
});

test("group-chat (分组·与AI的对话)", async ({ page }) => {
  await goto(page, "group-chat");
  await expect(page.getByTestId("lc-module-list-chat")).toBeVisible();
  await shot(page, "group-chat-default");
});

test("stage-checkin (主持台·分组与签到)", async ({ page }) => {
  await goto(page, "stage-checkin");
  await expect(page.getByTestId("lc-checkin-grid")).toBeVisible();
  await shot(page, "stage-checkin-default");
});

test("stage-graph (主持台·知识图谱决策推演)", async ({ page }) => {
  await goto(page, "stage-graph");
  await expect(page.getByTestId("lc-stage-graph")).toBeVisible();
  await shot(page, "stage-graph-default");
});

test("stage-kanban (主持台·看板)", async ({ page }) => {
  await goto(page, "stage-kanban");
  await expect(page.getByTestId("lc-kanban-grid")).toBeVisible();
  await shot(page, "stage-kanban-default");
});

/* ── 七态（代表屏各取一张，配合上面的 default 覆盖全七态）── */

test("state:loading (加载)", async ({ page }) => {
  await goto(page, "stage-default", "loading");
  await expect(page.getByTestId("loading")).toBeVisible();
  await shot(page, "stage-default-loading");
});

test("state:empty (空 · 签到)", async ({ page }) => {
  await goto(page, "stage-checkin", "empty");
  await expect(page.getByTestId("empty")).toBeVisible();
  await shot(page, "stage-checkin-empty");
});

test("state:invalid (校验失败 · 签到链接)", async ({ page }) => {
  await goto(page, "stage-checkin", "invalid");
  await expect(page.getByTestId("err-link")).toBeVisible();
  await shot(page, "stage-checkin-invalid");
});

test("state:dep-failed (依赖失败 · 看板 phase-02 未签)", async ({ page }) => {
  await goto(page, "stage-kanban", "dep-failed");
  await expect(page.getByTestId("dep-failed")).toBeVisible();
  await shot(page, "stage-kanban-dep-failed");
});

test("state:denied (无权限 · 组员看全场)", async ({ page }) => {
  await goto(page, "stage-default", "default", "member");
  await expect(page.getByTestId("denied")).toBeVisible();
  await shot(page, "stage-default-denied");
});

test("state:success (成功 · 看板广播已发)", async ({ page }) => {
  await goto(page, "stage-kanban", "success");
  await expect(page.getByTestId("saved")).toBeVisible();
  await shot(page, "stage-kanban-success");
});

/* ── 视角差异（同一屏不同角色，人类核对「四视角真的改变界面」）── */

test("role:member (组员视角 · 分组对话 · 视角锁定本组)", async ({ page }) => {
  await goto(page, "group-chat", "default", "member");
  await expect(page.getByTestId("lc-viewer-trigger")).toBeDisabled();
  await shot(page, "role-member-group-chat");
});

test("role:observer (观察者视角 · 全场只读默认)", async ({ page }) => {
  await goto(page, "stage-default", "default", "observer");
  await expect(page.getByTestId("lc-role-scope-note")).toBeVisible();
  await shot(page, "role-observer-stage-default");
});
