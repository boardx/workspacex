import type { Page } from "@playwright/test";

/**
 * design-delta `novice-progressive-disclosure`：详情页的批注、外观、多出几版对比、演示、重做、页管理、需求说明、
 * 导出、交给开发排期、从对话导入、给开发看的代码 从首屏收进「更多」菜单。菜单项沿用原来按钮的 testid。
 */
export async function openMore(page: Page): Promise<void> {
  if (await page.getByTestId("design-detail-more-menu").isVisible().catch(() => false)) return;
  await page.getByTestId("design-detail-more").click();
  await page.getByTestId("design-detail-more-menu").waitFor();
}

export async function clickMore(page: Page, testid: string, opts: { timeout?: number } = {}): Promise<void> {
  await openMore(page);
  await page.getByTestId(testid).click(opts);
}
