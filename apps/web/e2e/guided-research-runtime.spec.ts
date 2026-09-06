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
  const sourceLink = page.getByRole("link", { name: "Research E2E policy evidence" });
  const sourceUrl = await sourceLink.getAttribute("href");
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  await sourceLink.hover();
  await expect(page.getByRole("tooltip")).toContainText("Research E2E policy evidence");
  await page.getByRole("tooltip").hover();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("research-source-description.png"), fullPage: true });
  await page.getByRole("button", { name: "删除来源 Research E2E policy evidence" }).click();
  await expect(sourceLink).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "添加来源" })).toBeVisible();
  await expect(sourceLink).toHaveCount(0);
  await page.getByRole("button", { name: "添加来源" }).click();
  await page.getByLabel("来源链接").fill(sourceUrl!);
  await page.getByRole("button", { name: "添加", exact: true }).click();
  await expect(sourceLink).toBeVisible();
  await page.reload();
  await expect(sourceLink).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "查看描述 Research E2E policy evidence" }).click();
  await expect(page.getByRole("tooltip")).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("research-sources-mobile.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.keyboard.press("Escape");
  const reportResponse = page.waitForResponse((response) => response.url().endsWith("/runtime/commands/stream") && response.request().postDataJSON()?.node === "research");
  await page.getByRole("button", { name: "确认并继续", exact: true }).click();
  const streamResponse = await reportResponse;
  expect(streamResponse.headers()["content-type"]).toContain("text/event-stream");
  await expect(page.getByTestId("research-report-preview-text")).toContainText("并网政策报告", { timeout: 30000 });
  await expect(page.getByTestId("research-report")).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath("research-report-streaming.png"), fullPage: true });
  // Reload disconnects SSE. The server-owned generation must continue, not be replayed.
  await page.reload();
  await expect(page.getByTestId("research-report-preview-text")).toContainText("并网政策报告", { timeout: 10000 });
  await expect(page.getByTestId("research-report")).toContainText("并网政策报告", { timeout: 60000 });
  const runtimeResponse = await page.request.get(streamResponse.url().replace(/\/commands\/stream$/, ""), { headers: { authorization: streamResponse.request().headers()["authorization"]! } });
  expect(runtimeResponse.ok()).toBeTruthy();
  const runtime = await runtimeResponse.json();
  expect(runtime.modelCalls.filter((call: { node: string }) => call.node === "report")).toHaveLength(1);
  await page.reload();
  await expect(page.getByTestId("research-report")).toContainText("并网政策报告");
  await expect(page.getByRole("link", { name: "Research E2E policy evidence" })).toHaveAttribute("href", /\/research-evidence$/);
  await page.getByRole("button", { name: "完成研究", exact: true }).click();
  await expect(page.getByRole("heading", { name: "研究报告 · 已完成" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("research-completed.png"), fullPage: true });
});
