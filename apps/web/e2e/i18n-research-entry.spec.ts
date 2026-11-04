import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { research as C } from "@repo/contracts";
import { FULLSTACK_E2E as F } from "./fullstack-smoke-fixture";

const pathOf = (url: string) => new URL(url).pathname.replace(/^\/__fullstack_api/, "");

test("research locale preserves the real intake, plan, saved report and history management journey", async ({ page, context }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const rawName = `研究原名 {count} ${randomUUID()}`;
  const rawGoal = "核对储能并网政策，保留原始研究目标。";
  const rawPlan = "核实政策适用范围与实施约束";
  let commands = 0;
  page.on("request", request => {
    if (/\/runtime\/commands(?:\/stream)?$/.test(pathOf(request.url())) && request.method() === "POST") commands++;
  });
  await page.goto("/login");
  await page.getByTestId("language-switcher").selectOption("en");
  await page.getByTestId("login-email").fill(F.email);
  await page.getByTestId("login-password").fill(F.password);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  // Immersive research routes have no global picker. A real same-context page
  // sends the application's BroadcastChannel locale update without remounting research.
  const languagePage = await context.newPage();
  await languagePage.goto("/research");
  const language = async (locale: "en" | "zh-CN") => {
    await languagePage.getByTestId("language-switcher").first().selectOption(locale);
  };
  const screenshot = async (name: string) => {
    for (const width of [375, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      const progress = page.getByTestId("research-flow-progress");
      if (new URL(page.url()).pathname === "/research") {
        await expect(progress).toHaveCount(0);
      } else {
        await expect(progress).toHaveCount(1);
        for (const text of ["Confirm research details", "Research plan", "Generate report"]) {
          const label = progress.getByText(text, { exact: true });
          expect(await label.evaluate(element => {
            const cell = element.closest("li")!.getBoundingClientRect();
            const bounds = element.getBoundingClientRect();
            return element.scrollWidth <= element.clientWidth && bounds.left >= cell.left - 1 && bounds.right <= cell.right + 1;
          })).toBe(true);
        }
      }
      await page.screenshot({ path: test.info().outputPath(`${name}-${width}.png`), fullPage: true });
    }
  };
  await page.goto("/research");
  await expect(page.getByRole("heading", { name: "Research", exact: true })).toBeVisible();
  await page.getByTestId("research-create").click();
  await expect(page).toHaveURL(/\/research\/new$/);
  await page.getByText("Add research details", { exact: true }).click();
  await page.getByTestId("research-brief-topic").fill(rawName);
  await page.getByTestId("research-brief-goal").fill(rawGoal);
  await language("zh-CN");
  await expect(page.getByRole("heading", { name: "告诉 AI 你想研究什么" })).toBeVisible();
  await expect(page.getByTestId("research-brief-topic")).toHaveValue(rawName);
  await language("en");
  await expect(page.getByRole("heading", { name: "Tell AI what you want to research" })).toBeVisible();
  await page.getByTestId("research-flow-back").click();
  await expect(page.getByRole("heading", { name: "Unsaved research changes" })).toBeVisible();
  await screenshot("intake-unsaved-en");
  await page.getByRole("button", { name: "Keep editing", exact: true }).click();
  const created = page.waitForResponse(response => pathOf(response.url()) === C.operations.createGuidedResearchSession.path && response.request().method() === "POST");
  await page.getByTestId("research-confirm-brief").click();
  const createResponse = await created;
  expect(createResponse.ok()).toBe(true);
  expect(createResponse.request().postDataJSON().brief).toMatchObject({ topic: rawName, goal: rawGoal });
  await expect(page).toHaveURL(/\/research\/[^/]+\/plan$/);
  await page.getByRole("button", { name: "Previous step", exact: true }).click();
  await expect(page).toHaveURL(/\/research\/[^/]+\/import$/);
  await expect(page.getByRole("textbox", { name: "Research requirements", exact: true })).toHaveValue(rawGoal);
  const beforeImportSwitch = commands;
  await language("zh-CN");
  await expect(page.getByRole("textbox", { name: "研究需求", exact: true })).toHaveValue(rawGoal);
  await language("en");
  await page.getByTestId("research-flow-progress").getByRole("button", { name: /Research plan$/ }).click();
  await expect(page).toHaveURL(/\/research\/[^/]+\/plan$/);
  expect(commands).toBe(beforeImportSwitch);
  await page.getByRole("button", { name: /^Edit plan 1/ }).click();
  const plan = page.getByRole("textbox", { name: "Plan 1", exact: true });
  await plan.fill(rawPlan);
  const beforeSwitch = commands;
  await language("zh-CN");
  await expect(page.getByRole("textbox", { name: "计划 1", exact: true })).toHaveValue(rawPlan);
  await language("en");
  await expect(plan).toHaveValue(rawPlan);
  expect(commands).toBe(beforeSwitch);
  await page.getByRole("button", { name: "Save plan", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Save research plan?" })).toBeVisible();
  await screenshot("plan-confirm-en");
  const saved = page.waitForResponse(response => response.url().endsWith("/runtime/commands") && response.request().method() === "POST" && response.request().postDataJSON()?.action === "save");
  await page.getByRole("button", { name: "Confirm save", exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /^Edit plan 1/ }).click();
  await expect(plan).toHaveValue(rawPlan);
  await plan.press("Enter");
  const generated = page.waitForResponse(response => response.url().endsWith("/runtime/commands/stream") && response.request().postDataJSON()?.action === "generate_report");
  await page.getByRole("button", { name: "Generate report", exact: true }).click();
  const stream = await generated;
  expect(stream.headers()["content-type"]).toContain("application/x-ndjson");
  await expect(page).toHaveURL(/\/research\/[^/]+\/report$/);
  await expect(page.getByTestId("research-report-document")).toBeVisible({ timeout: 60_000 });
  const runtimeUrl = stream.url().replace(/\/commands\/stream$/, "");
  const runtime = await page.request.get(runtimeUrl, { headers: { authorization: stream.request().headers()["authorization"]! } });
  expect(runtime.ok()).toBe(true);
  const body = C.GuidedResearchRuntime.parse(await runtime.json());
  expect(body.completed).toBe(true);
  expect(body.brief.goal).toBe(rawGoal);
  expect(body.outline[0]!.title).toBe(rawPlan);
  await expect(page.getByTestId("research-report-document")).toContainText(body.report!.title);
  await expect(page.getByTestId("research-report-document")).toContainText("执行摘要");
  await expect(page.getByTestId("guided-research-report-contents")).toContainText("Report contents");
  const terminalCommands = commands;
  await language("zh-CN");
  await expect(page.getByTestId("research-report-document")).toContainText("执行摘要");
  await language("en");
  await expect(page.getByRole("button", { name: "Generate PDF", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Generate Word", exact: true })).toBeEnabled();
  expect(commands).toBe(terminalCommands);
  const unchanged = await page.request.get(runtimeUrl, { headers: { authorization: stream.request().headers()["authorization"]! } });
  expect(unchanged.ok()).toBe(true);
  expect(JSON.stringify(C.GuidedResearchRuntime.parse(await unchanged.json()).report)).toBe(JSON.stringify(body.report));
  await screenshot("report-en");
  await page.getByTestId("research-report-more-actions").click();
  await expect(page.getByRole("menuitem", { name: "Regenerate report", exact: true })).toBeVisible();
  const regenerated = page.waitForResponse(response => response.url().endsWith("/runtime/commands/stream") && response.request().postDataJSON()?.action === "generate_report");
  await page.getByRole("menuitem", { name: "Regenerate report", exact: true }).click();
  const regeneration = await regenerated;
  expect(regeneration.headers()["content-type"]).toContain("application/x-ndjson");
  await expect.poll(async () => {
    const response = await page.request.get(runtimeUrl, { headers: { authorization: stream.request().headers()["authorization"]! } });
    expect(response.ok()).toBe(true);
    const saved = C.GuidedResearchRuntime.parse(await response.json());
    return saved.version > regeneration.request().postDataJSON().expectedVersion && !saved.busy && saved.completed && Boolean(saved.reportPrevious?.report);
  }, { timeout: 60_000 }).toBe(true);
  const history = page.getByTestId("research-report-history");
  await expect(history.locator("summary")).toHaveText("Previous report · Historical content, read only");
  await history.locator("summary").click();
  const previousReport = history.getByRole("article");
  await expect(previousReport).toHaveCount(1);
  await expect(previousReport).toContainText(body.report!.title);
  await language("zh-CN");
  await expect(history.locator("summary")).toHaveText("上一轮报告 · 历史内容，仅供查看");
  await language("en");
  await expect(previousReport).toContainText(body.report!.title);
  expect(commands).toBe(terminalCommands + 1);
  await screenshot("report-history-en");
  await page.getByTestId("research-flow-back").click();
  await expect(page).toHaveURL(/\/research$/);
  const id = body.sessionId;
  await page.getByTestId(`research-history-actions-${id}`).click();
  await page.getByTestId(`research-history-edit-${id}`).click();
  await page.getByTestId("research-edit-name").fill(rawName);
  await page.getByTestId("research-edit-tag-input").fill("原始标签");
  await language("zh-CN"); await language("en");
  await expect(page.getByTestId("research-edit-tag-input")).toHaveValue("原始标签");
  await screenshot("metadata-en");
  await page.getByTestId("research-edit-submit").click();
  await expect(page.getByTestId("research-edit-dialog")).not.toBeVisible();
  await page.reload();
  await expect(page.getByTestId(`research-history-${id}`)).toContainText(rawName);
  await expect(page.getByTestId(`research-history-${id}`)).toContainText("原始标签");
  await page.getByTestId(`research-history-actions-${id}`).click();
  await page.getByTestId(`research-history-delete-${id}`).click();
  await expect(page.getByRole("heading", { name: "Delete research?" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByTestId(`research-history-${id}`)).toBeVisible();
  expect(errors).toEqual([]);
});
