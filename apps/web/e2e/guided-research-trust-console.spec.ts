import { expect, test } from "@playwright/test";

test("trust console validates boundaries, steering and publication readiness", async ({ page }, testInfo) => {
  await page.goto("/research?preview=trust-console");
  await expect(page.getByRole("heading", { name: "Deep Research 可信研究控制台" })).toBeVisible();
  const confirm = page.getByRole("button", { name: "确认研究边界" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("决策对象").fill("决定企业搜索供应商");
  await page.getByLabel("成功标准").fill("关键结论都有来源");
  await page.getByText("仅限指定站点").click();
  await page.getByRole("textbox", { name: "指定站点", exact: true }).fill("openai.com, exa.ai");
  await expect(confirm).toBeEnabled();
  await confirm.click();

  for (const id of ["research-activity-trace", "research-steering-controls", "research-coverage-matrix", "research-claim-evidence", "research-conflict-view", "research-quality-score", "research-publication-readiness"]) {
    await expect(page.getByTestId(id)).toBeVisible();
  }
  await expect(page.getByTestId("research-publication-readiness")).toContainText("带限制完成");
  await page.getByRole("button", { name: "暂停研究" }).click();
  await expect(page.getByTestId("research-activity-trace")).toContainText("研究已暂停");
  await page.getByRole("button", { name: "继续研究" }).click();
  await expect(page.getByTestId("research-activity-trace")).toContainText("正在核验");
  await page.getByRole("button", { name: "模拟补齐证据" }).click();
  await expect(page.getByTestId("research-publication-readiness")).toContainText("可发布");
  await expect(page.getByTestId("research-conflict-view")).toContainText("没有检测到证据冲突");
  await page.screenshot({ path: testInfo.outputPath("trust-console-ready.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("trust-console-mobile.png"), fullPage: true });
});
