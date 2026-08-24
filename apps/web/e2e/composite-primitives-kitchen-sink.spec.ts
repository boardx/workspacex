import { test, expect } from "@playwright/test";

/**
 * F10 —— 复合组件收口：Breadcrumb / Pagination 原语 + kitchen-sink 展示区完整性
 * （真实浏览器）。
 *
 * `/kitchen-sink` 的 `CompositePrimitivesGallery`（`components/state/primitives-gallery.tsx`）
 * 是 Table/Menu（F09）与 Pagination（F10）复合组件签核①材料的取景组件，与
 * `overlay-primitives-kitchen-sink.spec.ts`（F02）同一套「不需要登录、不需要种子数据」的
 * 静态页面前提，因此复用同一个 project，不另起 webServer/依赖链
 * （见 `playwright.fullstack-smoke.config.ts` 的 `overlay-primitives-keyboard` project）。
 *
 * Breadcrumb 盘点结论为「不收口」（全仓只 1 处、未达 R4-A1 的 3 次门槛，见
 * `tests/ui/composite-breadcrumb-pagination.test.tsx` 头注与 design-signoff.md），
 * 因此本文件不断言任何 breadcrumb 展示区块——没有就是没有，不假装有。
 *
 * 375/768/1280 三档视口无横向溢出由 `e2e/responsive.spec.ts` 覆盖 `/kitchen-sink`
 * 整页（含本区块），不在本文件里重复断言同一件事。
 */

test.describe("kitchen sink composites", () => {
  test("Table / Menu / Pagination 复合组件展示区块均可见", async ({ page }) => {
    await page.goto("/kitchen-sink");

    await expect(page.getByTestId("section-composites")).toBeVisible();
    await expect(page.getByTestId("primitive-table")).toBeVisible();
    await expect(page.getByTestId("primitive-menu")).toBeVisible();
    await expect(page.getByTestId("primitive-pagination")).toBeVisible();
  });

  test("Pagination 页码分页：点击页码/上一页/下一页更新状态文案与边界 disabled", async ({ page }) => {
    await page.goto("/kitchen-sink");

    const status = page.getByTestId("primitive-pagination-status");
    await expect(status).toHaveText("第 1 / 5 页");
    await expect(page.getByTestId("primitive-pagination-previous")).toBeDisabled();

    await page.getByTestId("primitive-pagination-item-1").click();
    await expect(status).toHaveText("第 2 / 5 页");
    await expect(page.getByTestId("primitive-pagination-previous")).toBeEnabled();

    await page.getByTestId("primitive-pagination-next").click();
    await expect(status).toHaveText("第 3 / 5 页");

    // 跳到末页，验证下一页边界 disabled
    await page.getByTestId("primitive-pagination-item-4").click();
    await expect(status).toHaveText("第 5 / 5 页");
    await expect(page.getByTestId("primitive-pagination-next")).toBeDisabled();
  });

  test("Pagination 游标分页（加载更多）：点击后计数增加，pending 期间按钮禁用", async ({ page }) => {
    await page.goto("/kitchen-sink");

    const count = page.getByTestId("primitive-pagination-loadmore-count");
    await expect(count).toHaveText("已加载 1 批");

    const loadMore = page.getByTestId("primitive-pagination-loadmore");
    await loadMore.click();
    await expect(loadMore).toBeDisabled();
    await expect(loadMore).toHaveText("加载中…");

    await expect(count).toHaveText("已加载 2 批");
    await expect(loadMore).toBeEnabled();
  });
});
