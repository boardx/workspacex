import { expect, test, type Response } from "@playwright/test";
import { workflowRuntime } from "@repo/contracts";
import { FULLSTACK_E2E as F } from "./fullstack-smoke-fixture";
const C = workflowRuntime.workflowRuntime;
const listPath = `/__fullstack_api${C.listMyInstances.path}`;
function listResponse(response: Response) { return new URL(response.url()).pathname === listPath && response.request().method() === "GET"; }

test("My runs preserves persisted raw goals and own visibility while locale changes do not reread", async ({ page }, info) => {
  await info.attach("verification-boundary", { body: Buffer.from("Real API/PG reads of three seeded precondition instances in a private org; two owned rows visible. No workflow execution, model quality or approval behavior claim."), contentType: "text/plain" });
  const reads: string[] = [];
  page.on("request", (request) => { if (request.method() === "GET" && new URL(request.url()).pathname === listPath) reads.push(request.url()); });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/login");
  await page.getByTestId("login-email").fill(F.workflowRunsEmail);
  await page.getByTestId("login-password").fill(F.workflowRunsPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  const [initial] = await Promise.all([page.waitForResponse(listResponse), page.goto(`/workflows/runs?projectId=${encodeURIComponent(F.workflowRunsProjectId)}`)]);
  expect(initial.status()).toBe(200);
  const before = C.listMyInstances.out.parse(await initial.json());
  expect(before.items).toHaveLength(2);
  expect(before.items.every((item) => item.initiatorUserId === F.workflowRunsUserId)).toBe(true);
  expect(new Set(before.items.map((item) => item.status))).toEqual(new Set(["succeeded", "failed"]));
  expect(before.items.every((item) => item.goal === F.workflowRunsGoal)).toBe(true);
  const list = page.getByTestId("workflow-run-list");
  await expect(list.locator("li")).toHaveCount(2);
  const picker = page.getByTestId("shell-topbar").getByTestId("language-switcher");
  const count = reads.length;
  await picker.selectOption("en");
  await expect(page.getByTestId("workflow-page-title")).toHaveText("My runs");
  await expect(list).toContainText("Completed"); await expect(list).toContainText("Failed");
  await expect(list).toContainText(`Goal: ${F.workflowRunsGoal}`);
  await expect(list).toContainText(F.workflowRunsKey);
  await expect(list).not.toContainText("Private peer goal");
  await picker.selectOption("zh-CN");
  await expect(page.getByTestId("workflow-page-title")).toHaveText("我的运行");
  await expect(list).toContainText("已完成"); await expect(list).toContainText("失败");
  await picker.selectOption("en");
  expect(reads).toHaveLength(count);
  await expect(page.getByTestId("workflow-nav-back-to-project")).toHaveAttribute("href", `/projects/${encodeURIComponent(F.workflowRunsProjectId)}`);
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(list).toBeInViewport({ ratio: 1 });
    for (const link of await list.locator("li > a").all()) {
      const box = await link.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    for (const control of await list.locator('[data-testid="workflow-run-status"], time, [data-testid="workflow-run-goal"], [data-testid="workflow-run-initiator"]').all()) {
      await expect(control).toBeInViewport({ ratio: 1 });
      const box = await control.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`workflow-runs-${width}-en.png`) });
  }
  await page.setViewportSize({ width: 1280, height: 1000 });
  const [reload] = await Promise.all([page.waitForResponse(listResponse), page.reload()]);
  const after = C.listMyInstances.out.parse(await reload.json());
  expect(after.items).toEqual(before.items);
  await expect(page.getByTestId("workflow-page-title")).toHaveText("My runs");
  await expect(list.locator(`a[href="/workflows/runs/${encodeURIComponent(F.workflowRunsInstanceId)}"]`)).toBeVisible();
});
