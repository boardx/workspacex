import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * 取证：把 canvas-template-gallery 原型的每个界面态 + 关键交互各截一张，落到
 * phases/phase-02-visible-outcomes/ui-preview/canvas-template-gallery/。
 * 纯前端预览页（不接后端），对已预热 dev server（默认 3221）截图。
 */
const OUT = join(
  process.cwd(),
  "..",
  "..",
  "phases",
  "phase-02-visible-outcomes",
  "ui-preview",
  "canvas-template-gallery",
);
mkdirSync(OUT, { recursive: true });

test.use({ viewport: { width: 1280, height: 900 } });

async function goto(page: import("@playwright/test").Page, state: string, as = "facilitator") {
  await page.goto(`/preview/canvas-template-gallery?state=${state}&as=${as}`);
  await page.waitForLoadState("networkidle").catch(() => {});
}

// 七态
test("CTG default gallery", async ({ page }) => {
  await goto(page, "default");
  await expect(page.getByTestId("canvas-tpl-gallery")).toBeVisible();
  await expect(page.getByTestId("canvas-tpl-card-persona")).toBeVisible();
  await page.screenshot({ path: join(OUT, "CTG-gallery-default.png"), fullPage: true });
});

test("CTG loading", async ({ page }) => {
  await goto(page, "loading");
  await expect(page.getByTestId("loading")).toBeVisible();
  await page.screenshot({ path: join(OUT, "CTG-gallery-loading.png"), fullPage: true });
});

test("CTG empty (no match)", async ({ page }) => {
  await goto(page, "empty");
  await expect(page.getByTestId("empty")).toBeVisible();
  await page.screenshot({ path: join(OUT, "CTG-gallery-empty.png"), fullPage: true });
});

test("CTG invalid (blank quick-create without name)", async ({ page }) => {
  await goto(page, "invalid");
  await expect(page.getByTestId("err-name")).toBeVisible();
  await page.screenshot({ path: join(OUT, "CTG-gallery-invalid.png"), fullPage: true });
});

test("CTG dep-failed (engine load failed)", async ({ page }) => {
  await goto(page, "dep-failed");
  await expect(page.getByTestId("dep-failed")).toBeVisible();
  await page.screenshot({ path: join(OUT, "CTG-gallery-dep-failed.png"), fullPage: true });
});

test("CTG denied (observer role)", async ({ page }) => {
  await goto(page, "default", "observer");
  await expect(page.getByTestId("denied")).toBeVisible();
  await page.screenshot({ path: join(OUT, "CTG-gallery-denied.png"), fullPage: true });
});

test("CTG success (persona rendered on CanvasStage)", async ({ page }) => {
  await goto(page, "success");
  await expect(page.getByTestId("saved")).toBeVisible();
  await expect(page.getByTestId("canvas-tpl-started")).toBeVisible();
  // 等真实画布挂载（fabric surface 出现）
  await expect(page.getByTestId("canvas-fabric-surface")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, "CTG-success-persona-canvas.png"), fullPage: true });
});

// 关键交互补充
test("CTG filter to user category", async ({ page }) => {
  await goto(page, "default");
  await page.getByTestId("canvas-tpl-filter-user").click();
  await expect(page.getByTestId("canvas-tpl-section-user")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, "CTG-gallery-filter-user.png"), fullPage: true });
});

test("CTG pick journey-map -> canvas wired through", async ({ page }) => {
  await goto(page, "default");
  await page.getByTestId("canvas-tpl-card-journey-map").click();
  await expect(page.getByTestId("canvas-tpl-started")).toBeVisible();
  await expect(page.getByTestId("canvas-fabric-surface")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, "CTG-success-journey-canvas.png"), fullPage: true });
});

test("CTG pick mindmap starter (Tab/Enter editing)", async ({ page }) => {
  await goto(page, "default");
  await page.getByTestId("canvas-tpl-card-mindmap").click();
  await expect(page.getByTestId("canvas-tpl-started")).toBeVisible();
  await expect(page.getByTestId("canvas-fabric-surface")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(OUT, "CTG-success-mindmap-canvas.png"), fullPage: true });
});
