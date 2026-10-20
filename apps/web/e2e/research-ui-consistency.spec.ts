import { test, expect } from "@playwright/test";

for (const width of [1280, 768, 375]) {
  test(`R3 research entry, errors and assistant at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/research/new");
    const goal = page.getByRole("textbox", { name: "研究目标", exact: true });
    await expect(goal).toBeVisible();
    const next = page.getByTestId("research-confirm-brief");
    await expect(next).toBeDisabled();
    await page.screenshot({ path: info.outputPath(`empty-entry-${width}.png`), fullPage: true });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await goal.fill("研究长内容与可访问性。".repeat(60));
    await expect(next).toBeEnabled();
    await page.getByRole("button", { name: "AI 助手", exact: true }).click();
    const close = page.getByRole("button", { name: "关闭研究助手" });
    await expect(close).toBeFocused();
    await page.screenshot({ path: info.outputPath(`assistant-${width}.png`), fullPage: true });
    await close.press("Escape");
    await expect(page.getByRole("button", { name: "AI 助手", exact: true })).toBeFocused();
    await page.locator('input[type="file"]').setInputFiles({ name: "unsupported.pdf", mimeType: "application/pdf", buffer: Buffer.from("invalid fixture") });
    await expect(page.getByTestId("research-step-main").getByRole("alert")).toContainText("请选择 TXT");
    await expect(goal).toHaveValue("研究长内容与可访问性。".repeat(60));
    await page.screenshot({ path: info.outputPath(`input-error-${width}.png`), fullPage: true });
    await page.locator('input[type="file"]').setInputFiles({ name: "requirements.txt", mimeType: "text/plain", buffer: Buffer.from("补充研究边界") });
    await expect(goal).toHaveValue(/补充研究边界/);
    await expect(page.getByTestId("research-step-main").getByRole("alert")).toHaveCount(0);
    // No credentials/backend/model: exercise visible create failure, not successful persistence.
    await next.click();
    await expect(page.getByTestId("err-research-create")).toBeVisible();
    await expect(goal).toHaveValue(/补充研究边界/);
    await expect(next).toBeEnabled();
    await page.screenshot({ path: info.outputPath(`create-recovery-${width}.png`), fullPage: true });
  });
  test(`R3 report directory and reference sample at ${width}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/research?preview=prototype-fidelity&stage=report");
    await expect(page.getByTestId("guided-research-report-body")).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const toggle = page.getByRole("button", { name: "报告目录", exact: true });
    if (width < 1280) {
      await expect(toggle).toBeVisible();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await toggle.click();
    } else await expect(toggle).toBeHidden();
    await page.screenshot({ path: info.outputPath(`report-${width}.png`), fullPage: true });
  });
}

test("R3 fixture intake and plan editing reach sources; report reading is a separate fixed sample", async ({ page }, info) => {
  await page.goto("/research?preview=prototype-fidelity&stage=import");
  await page.getByRole("textbox", { name: "研究目标", exact: true }).fill("核对研究界面交互的一致性");
  await page.getByTestId("research-confirm-brief").click();
  await expect(page).toHaveURL(/stage=topic/);
  await page.getByRole("link", { name: "下一步：研究计划" }).click();
  await expect(page).toHaveURL(/stage=plan/);
  await page.waitForLoadState("networkidle");
  const editor = page.getByTestId("guided-research-markdown-editor");
  await editor.fill((await editor.inputValue()).replace("执行摘要", "界面验收摘要"));
  await page.getByRole("button", { name: "保存 Markdown", exact: true }).click();
  await expect(page.getByTestId("guided-research-markdown-editor")).toHaveCount(0);
  await page.getByTestId("research-plan-actions").getByRole("button", { name: "生成报告" }).click();
  await expect(page).toHaveURL(/stage=research/);
  // The three-step header already considers research part of report; it is not a model completion control.
  // This fixed preview does not execute a research engine, so inspect the report as a separate sample.
  await page.goto("/research?preview=prototype-fidelity&stage=report");
  await expect(page.getByTestId("guided-research-report-body")).toBeVisible();
  await page.screenshot({ path: info.outputPath("fixture-navigation.png"), fullPage: true });
});
