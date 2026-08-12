import { test, expect } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

/**
 * VZ-02 取证：把 chat-diagram-fabric 原型的每个界面态各截一张，落到
 * phases/phase-02-visible-outcomes/ui-preview/chat-diagram-fabric/。
 * 纯前端预览页（不接后端），走独立 dev server（playwright.config.ts 的 3197）。
 */
const OUT = join(
  process.cwd(),
  "..",
  "..",
  "phases",
  "phase-02-visible-outcomes",
  "ui-preview",
  "chat-diagram-fabric",
);
mkdirSync(OUT, { recursive: true });

test.use({ viewport: { width: 1280, height: 900 } });

test("VZ-02 fabric bubble (default rendered)", async ({ page }) => {
  await page.goto("/preview/chat-diagram-fabric?scene=fabric");
  const bubble = page.getByTestId("chat-diagram-fabric");
  await expect(bubble).toBeVisible();
  // fabric 渲染完成
  await expect(bubble).toHaveAttribute("data-ready", "true", { timeout: 20_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: join(OUT, "VZ-02-bubble-default.png"), fullPage: true });
});

test("VZ-02 maximize -> editable modal (default)", async ({ page }) => {
  await page.goto("/preview/chat-diagram-fabric?scene=fabric");
  await expect(page.getByTestId("chat-diagram-fabric")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 20_000 },
  );
  await page.getByTestId("chat-diagram-maximize").click();
  const modal = page.getByTestId("chat-diagram-canvas-modal");
  await expect(modal).toBeVisible();
  // 画布挂载 + 渲染
  await expect(page.getByTestId("canvas-fabric-surface")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, "VZ-02-modal-editable.png") });

  // 保存前置提示态（右栏）
  await expect(page.getByTestId("chat-diagram-save-hint")).toBeVisible();
});

test("VZ-02 edit (add node) then save -> saved state", async ({ page }) => {
  await page.goto("/preview/chat-diagram-fabric?scene=fabric");
  await expect(page.getByTestId("chat-diagram-fabric")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 20_000 },
  );
  await page.getByTestId("chat-diagram-maximize").click();
  await expect(page.getByTestId("chat-diagram-canvas-modal")).toBeVisible();
  await expect(page.getByTestId("canvas-fabric-surface")).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);

  // 选「＋节点」工具，在画布空白处点一下落一个新节点（CanvasStage 的真实编辑路径）
  await page.getByTestId("chat-diagram-tool-node").click();
  const surface = page.getByTestId("canvas-fabric-surface");
  const box = await surface.boundingBox();
  if (box) {
    await page.mouse.click(box.x + box.width - 140, box.y + 120);
  }
  await page.waitForTimeout(400);
  // 应出现「有未保存的改动」
  await expect(page.getByTestId("chat-diagram-dirty")).toBeVisible();
  await page.screenshot({ path: join(OUT, "VZ-02-modal-after-edit.png") });

  // 保存 → 已保存态 + 右栏显示将落 canvas artifact 的 mermaid 源
  await page.getByTestId("chat-diagram-save").click();
  await expect(page.getByTestId("chat-diagram-saved")).toBeVisible();
  await expect(page.getByTestId("chat-diagram-saved-source")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(OUT, "VZ-02-modal-saved.png") });
});

test("VZ-02 invalid mermaid -> honest error box (no broken canvas)", async ({ page }) => {
  await page.goto("/preview/chat-diagram-fabric?scene=error");
  const errors = page.getByTestId("chat-ai-mermaid-error");
  await expect(errors.first()).toBeVisible();
  // 两个错误态：越界图类型 + 语法错，且不产生 fabric 画布
  await expect(errors).toHaveCount(2);
  await expect(page.getByTestId("chat-diagram-fabric")).toHaveCount(0);
  await page.screenshot({ path: join(OUT, "VZ-02-error-box.png"), fullPage: true });
});
