/**
 * UC-17.8 B5.3 迭代 10 —— 原型画布主链路 e2e（真组件 + `page.route` 夹具，同 `design-loop-responsive.spec.ts`
 * 的范式）：在真实浏览器里把「起手 → 生成 → 画板 → 点选 → 属性面板 → 历史预览 → 导出」整条路走一遍。
 *
 * 为什么不是真栈：主链路的核心是**模型写回**，真栈 e2e 没有模型时只会走固定回执（B5.2 的 fallback），
 * 画布永远是占位块——那条路径 `fullstack-smoke` 已经覆盖。这里要证的是前端这条闭环在真浏览器（不是
 * jsdom）里的真实行为：pointer capture、wheel、剪贴板、下载事件。夹具见 `scripts/lib/design-loop-fixtures.mjs`。
 */
import { test, expect, type Page } from "@playwright/test";
import { routeDrafts, routeInbox, routeDesignWorkbench } from "../scripts/lib/design-loop-fixtures.mjs";

async function open(page: Page, scene: string): Promise<void> {
  await routeDrafts(page, { empty: false });
  await routeInbox(page, { empty: false });
  await routeDesignWorkbench(page, {});
  await page.goto(`/preview/feedback-design-loop?scene=${scene}`);
  await page.getByTestId("design-detail").waitFor();
}

test.describe("原型画布主链路（迭代 10）", () => {
  test("空项目：起手模板 → 发送 → 生成中（秒数 / 取消可见）→ 回复 + 建议 chips", async ({ page }) => {
    await open(page, "detail-prototype-empty");
    const starters = page.getByTestId("design-detail-starters");
    await expect(starters.locator("button")).toHaveCount(3);
    await page.getByTestId("design-detail-starter-对话助手").click();
    await expect(page.getByTestId("design-detail-suggestions")).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("design-detail-suggestions").locator("button")).toHaveCount(3);
    await expect(page.getByTestId("design-detail-starters")).toHaveCount(0);
    // 生成中态：夹具对含「附件」的消息故意晚 3s 回 ⇒ 能看到秒数与「取消」
    await page.getByTestId("design-detail-input").fill("输入区加一个附件按钮");
    await page.getByTestId("design-detail-send").click();
    await expect(page.getByTestId("design-detail-generating")).toBeVisible();
    await expect(page.getByTestId("design-detail-cancel")).toBeVisible();
    await expect(page.getByTestId("design-detail-elapsed")).toHaveText(/\d+s/);
    await expect(page.getByTestId("design-detail-generating")).toHaveCount(0, { timeout: 10_000 });
  });

  test("画板：三页并排、缩放按钮、Ctrl+滚轮、空白拖拽、点标题聚焦；切单页只剩一块屏", async ({ page }) => {
    await open(page, "detail-prototype");
    const board = page.getByTestId("design-detail-board");
    await expect(page.getByTestId("design-detail-phone")).toHaveCount(3);
    await page.getByTestId("design-detail-zoom-reset").click();
    await expect(page.getByTestId("design-detail-zoom-level")).toHaveText("100%");
    await page.getByTestId("design-detail-zoom-in").click();
    await expect(page.getByTestId("design-detail-zoom-level")).toHaveText("120%");
    const before = await page.getByTestId("design-detail-board-stage").evaluate((el) => (el as HTMLElement).style.transform);
    const box = (await board.boundingBox())!;
    // 空白处拖拽（画板右下角一片没有画板的区域）
    await page.mouse.move(box.x + box.width - 80, box.y + 40);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 140, box.y + 90, { steps: 5 });
    await page.mouse.up();
    const after = await page.getByTestId("design-detail-board-stage").evaluate((el) => (el as HTMLElement).style.transform);
    expect(after).not.toBe(before);
    // Ctrl + 滚轮缩放
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.keyboard.down("Control");
    await page.mouse.wheel(0, -120);
    await page.keyboard.up("Control");
    await expect(page.getByTestId("design-detail-zoom-level")).not.toHaveText("120%");
    // 点第 3 页标题 ⇒ 标签条同步
    await page.getByTestId("design-detail-board-frame-2").locator("[data-board-title]").click();
    await expect(page.getByTestId("design-detail-frame-2")).toHaveClass(/bg-card/);
    await page.getByTestId("design-detail-view-single").click();
    await expect(page.getByTestId("design-detail-phone")).toHaveCount(1);
    await expect(page.getByTestId("design-detail-phone-tree")).toContainText("本月用量");
  });

  test("点选节点 ⇒ 焦点 chip + 属性面板；改文案「应用」发 setProps；键盘 Enter 也能选", async ({ page }) => {
    await open(page, "detail-prototype");
    await page.getByTestId("design-detail-view-single").click();
    const posted: unknown[] = [];
    await page.route((url) => /\/pm-designs\/[^/]+\/prototype\/patch$/.test(new URL(url).pathname), async (route) => {
      posted.push(route.request().postDataJSON());
      await route.fallback();
    });
    await page.locator('[data-proto="button"]').first().click();
    await expect(page.getByTestId("design-detail-focus")).toContainText("按钮「停止」");
    await expect(page.getByTestId("design-inspector")).toBeVisible();
    await page.getByTestId("design-inspector-label").fill("发送");
    await page.getByTestId("design-inspector-apply").click();
    await expect.poll(() => posted.length).toBe(1);
    expect(posted[0]).toMatchObject({ ops: [{ op: "setProps", props: { label: "发送" } }] });
    // 键盘：Tab 到导航栏节点后 Enter
    await page.getByTestId("design-detail-focus-clear").click();
    await page.locator('[data-proto="navbar"]').first().focus();
    await page.keyboard.press("Enter");
    await expect(page.getByTestId("design-detail-focus")).toContainText("导航栏");
  });

  test("版本历史：打开 → 预览 v1 横幅 → 退出；导出菜单：JSON 触发下载、复制进剪贴板", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await open(page, "detail-prototype");
    await page.getByTestId("design-detail-history-toggle").click();
    await expect(page.getByTestId("design-history-item-2")).toBeVisible();
    await page.getByTestId("design-history-preview-1").click();
    await expect(page.getByTestId("design-detail-preview-banner")).toContainText("v1");
    await page.getByTestId("design-detail-preview-exit").click();
    await expect(page.getByTestId("design-detail-preview-banner")).toHaveCount(0);
    await page.getByTestId("design-detail-export").click();
    const download = page.waitForEvent("download");
    await page.getByTestId("design-detail-export-json").click();
    expect((await download).suggestedFilename()).toMatch(/\.prototype\.json$/);
    await page.getByTestId("design-detail-export").click();
    await page.getByTestId("design-detail-export-copy").click();
    await expect(page.getByTestId("design-detail-export-copy")).toContainText("已复制");
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    expect(clip).toContain('"screens"');
  });
});
