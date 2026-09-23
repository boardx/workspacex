/**
 * 对标评测（#3933）每一轮修掉的差距在这里落一条**回归门**——`e2e/parity-eval/` 是出分的尺子
 * （基线大面积失败、不进 CI），这一份才是门：每轮的行为在真浏览器里被钉住，之后谁把它弄坏谁红。
 *
 * 数据同 `design-prototype-loop.spec.ts`：`page.route` 夹具（`scripts/lib/design-loop-fixtures.mjs`）。
 */
import { readFileSync } from "node:fs";
import { test, expect, type Page } from "@playwright/test";
import { routeDrafts, routeInbox, routeDesignWorkbench } from "../scripts/lib/design-loop-fixtures.mjs";

test.use({ launchOptions: process.env.PW_EXECUTABLE ? { executablePath: process.env.PW_EXECUTABLE } : {}, acceptDownloads: true });

async function openSample(page: Page): Promise<void> {
  await routeDrafts(page, { empty: false });
  await routeInbox(page, { empty: false });
  await routeDesignWorkbench(page, {});
  await page.goto("/preview/feedback-design-loop?scene=detail-prototype");
  await page.getByTestId("design-detail").waitFor();
}

async function appearance(page: Page): Promise<void> {
  if (await page.getByTestId("design-detail-appearance-panel").isVisible().catch(() => false)) return;
  await page.getByTestId("design-detail-appearance").click();
  await page.getByTestId("design-detail-appearance-panel").waitFor();
}

/** 样本第 2 页「历史会话」底部的「开始新对话」是主按钮（第 1 页的是危险色的「停止」）。 */
const primaryButtonBg = (page: Page) =>
  page.getByTestId("design-detail-phone").locator('[data-node-id="history-new"]')
    .evaluate((el) => getComputedStyle(el).backgroundColor);

test.describe("R1 品牌色与字体（#3933）", () => {
  test("输入品牌色 ⇒ 主按钮就是这个色；选衬线体 ⇒ 标题是衬线；刷新后都还在；导出的 HTML 跟着走", async ({ page }) => {
    await openSample(page);
    await page.getByTestId("design-detail-view-single").click();
    await page.getByTestId("design-detail-frame-1").click();
    await appearance(page);
    const input = page.getByTestId("design-detail-brand-color");
    // 打到一半：不刷画布，给人话提示。
    await input.fill("#FF5A");
    await input.press("Enter");
    await expect(page.getByTestId("design-detail-brand-invalid")).toBeVisible();
    await input.fill("#FF5A1F");
    await input.press("Enter");
    await expect.poll(() => primaryButtonBg(page)).toBe("rgb(255, 90, 31)");

    await page.getByTestId("design-detail-font-serif").click();
    const title = page.getByTestId("design-detail-phone").locator('[data-proto="text"]').first();
    await expect.poll(() => title.evaluate((el) => getComputedStyle(el).fontFamily)).toMatch(/Noto Serif SC/);

    // 刷新：夹具与真实 API 同语义（tokens 按键合并落库），重新读回来仍是品牌色 + 衬线体。
    await page.reload();
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-view-single").click();
    await page.getByTestId("design-detail-frame-1").click();
    await expect.poll(() => primaryButtonBg(page)).toBe("rgb(255, 90, 31)");
    await expect(page.getByTestId("design-detail-phone")).toHaveAttribute("data-font", "serif");

    await page.getByTestId("design-detail-export").click();
    const [d] = await Promise.all([page.waitForEvent("download"), page.getByTestId("design-detail-export-html").click()]);
    const html = readFileSync(await d.path(), "utf8");
    expect(html).toContain("Noto Serif SC");
    expect(html).toContain(`--primary:${(await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="design-detail-phone"]')!).getPropertyValue("--primary").trim()))}`);
  });
});

test.describe("R2 圆角与密度（#3933）", () => {
  test("直角 ⇒ 按钮 0 圆角；圆润 ⇒ ≥14px；宽松比紧凑间距大；刷新后还在", async ({ page }) => {
    await openSample(page);
    await page.getByTestId("design-detail-view-single").click();
    await page.getByTestId("design-detail-frame-1").click();
    const btn = page.getByTestId("design-detail-phone").locator('[data-node-id="history-new"]');
    const radius = () => btn.evaluate((el) => parseFloat(getComputedStyle(el).borderTopLeftRadius));
    const rootGap = () => page.getByTestId("design-detail-phone").locator('[data-proto="stack"]').first()
      .evaluate((el) => parseFloat(getComputedStyle(el).rowGap) || 0);
    await appearance(page);
    await page.getByTestId("design-detail-radius-sharp").click();
    await expect.poll(radius).toBe(0);
    await page.getByTestId("design-detail-radius-round").click();
    await expect.poll(radius).toBeGreaterThanOrEqual(14);
    await page.getByTestId("design-detail-density-compact").click();
    await expect.poll(rootGap).toBeLessThanOrEqual(2);
    await page.getByTestId("design-detail-density-comfortable").click();
    await expect.poll(rootGap).toBeGreaterThanOrEqual(8);

    await page.reload();
    await page.getByTestId("design-detail").waitFor();
    await page.getByTestId("design-detail-view-single").click();
    await page.getByTestId("design-detail-frame-1").click();
    await expect.poll(radius).toBeGreaterThanOrEqual(14);
    await expect.poll(rootGap).toBeGreaterThanOrEqual(8);
  });
});
