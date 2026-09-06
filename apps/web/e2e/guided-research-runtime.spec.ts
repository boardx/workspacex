import { test, expect } from "@playwright/test";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
test("research persists all five model-backed steps through the real UI, API and PostgreSQL", async ({ page }, testInfo) => {
  test.setTimeout(120000);
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.email);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto("/research");
  await page.getByTestId("research-create").click();
  await page.getByTestId("research-create-name").fill("研究全链路验证");
  await page.getByTestId("research-create-submit").click();
  await page.getByTestId("research-brief-goal").fill("核对储能并网政策");
  let releaseGeneration!: () => void;
  const generationGate = new Promise<void>((resolve) => { releaseGeneration = resolve; });
  await page.route("**/runtime/commands", async (route) => {
    const command = route.request().postDataJSON();
    if (command.node === "brief" && command.action === "confirm") await generationGate;
    await route.continue();
  });
  await page.getByTestId("research-confirm-brief").click();
  try {
    await expect(page.getByTestId("research-step-loading")).toBeVisible();
    await expect(page.getByRole("button", { name: "2. 研究方向" })).toHaveAttribute("aria-current", "step");
    await page.screenshot({ path: testInfo.outputPath("research-next-step-loading.png"), fullPage: true });
  } finally { releaseGeneration(); }
  await expect(page.getByRole("heading", { name: "研究方向", exact: true })).toBeVisible();
  await page.getByLabel("研究对话").fill("请检查研究方向");
  await page.getByRole("button", { name: "发送研究消息" }).click();
  await page.getByRole("button", { name: "应用建议" }).click();
  await page.reload();
  await expect(page.getByTestId("research-skill-messages")).toContainText("请检查研究方向");
  for (const expectedTitle of ["研究方向", "报告大纲"]) {
    await expect(page.getByRole("heading", { name: expectedTitle, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "确认并继续", exact: true })).toBeEnabled();
    if (expectedTitle === "研究方向") {
      await page.screenshot({ path: testInfo.outputPath("research-directions.png"), fullPage: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: testInfo.outputPath("research-directions-mobile.png"), fullPage: true });
      await page.setViewportSize({ width: 1280, height: 900 });
    }
    await page.getByRole("button", { name: "确认并继续", exact: true }).click();
  }
  await expect(page.getByRole("link", { name: "Research E2E policy evidence" })).toBeVisible();
  await page.getByLabel("来源处理 Research E2E policy evidence").selectOption("accepted");
  await page.getByRole("button", { name: "确认并继续", exact: true }).click();
  await expect(page.getByTestId("research-report")).toContainText("并网政策报告");
  await page.reload();
  await expect(page.getByTestId("research-report")).toContainText("并网政策报告");
  await expect(page.getByRole("link", { name: "Research E2E policy evidence" })).toHaveAttribute("href", /\/research-evidence$/);
  await page.getByRole("button", { name: "完成研究", exact: true }).click();
  await expect(page.getByRole("heading", { name: "研究报告 · 已完成" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("research-completed.png"), fullPage: true });
});
