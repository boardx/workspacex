import { setShellLocale } from "./shell-locale";
import { expect, test, type Page, type Response } from "@playwright/test";
import { board } from "@repo/contracts";
import { FULLSTACK_E2E } from "./fullstack-smoke-fixture";
function apiPath(url: string) { return new URL(url).pathname.replace(/^\/__fullstack_api/, ""); }
function isResponse(response: Response, path: string, method: string) { return new URL(response.url()).pathname.startsWith("/__fullstack_api/") && apiPath(response.url()) === path && response.request().method() === method; }
async function language(page: Page, locale: "en" | "zh-CN") {
  await setShellLocale(page, locale);
  await expect(page.locator("html")).toHaveAttribute("lang", locale);
}

test("live tasks retain raw drafts and persisted fields across languages and real status transitions", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  const reads: string[] = [];
  page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/__fullstack_api/") && request.method() === "GET" && ["/tasks", "/tasks/today"].includes(apiPath(request.url()))) reads.push(request.url()); });
  await page.goto("/login");
  await page.getByTestId("login-email").fill(FULLSTACK_E2E.tasksEmail);
  await page.getByTestId("login-password").fill(FULLSTACK_E2E.tasksPassword);
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/home$/);
  await page.goto("/tasks");
  await expect(page.getByTestId("tasks-live-other-tasks")).toContainText("没有其他待办");
  const title = `I18N_${FULLSTACK_E2E.orgId.slice(-12)}_任务 {status}`;
  await expect(page.getByRole("heading", { name: title, exact: true })).toHaveCount(0);
  await page.getByTestId("tasks-new-task-live").click();
  await page.getByTestId("tasks-new-task-title").fill(`  ${title}  `);
  await page.getByTestId("tasks-new-task-due").fill("2026-12-31");
  await page.getByTestId("tasks-new-task-risk").selectOption("R2");
  const readCount = reads.length;
  await language(page, "en");
  await expect(page.getByRole("heading", { name: "My today", exact: true })).toBeVisible();
  await expect(page.getByTestId("tasks-new-task-title")).toHaveValue(`  ${title}  `);
  await expect(page.getByTestId("tasks-new-task-due")).toHaveValue("2026-12-31");
  await expect(page.getByTestId("tasks-new-task-risk")).toHaveValue("R2");
  await language(page, "zh-CN"); await language(page, "en");
  expect(reads).toHaveLength(readCount);
  const [created] = await Promise.all([
    page.waitForResponse((response) => isResponse(response, "/tasks", "POST")),
    page.getByTestId("tasks-new-task-submit").click(),
  ]);
  expect(created.status()).toBe(201);
  expect(created.request().postDataJSON()).toEqual({ projectId: FULLSTACK_E2E.projectId, title, ownerUserId: FULLSTACK_E2E.tasksUserId, dueAt: "2026-12-31T00:00:00.000Z", riskLevel: "R2" });
  const result = await created.json();
  expect(typeof result.id).toBe("string"); expect(result.id.length).toBeGreaterThan(0);
  expect(board.TaskStatus.parse(result.status)).toBe("todo");
  expect(board.SourceKind.parse(result.sourceKind)).toBe("手工创建");
  const card = page.getByTestId(`tasks-live-card-${result.id}`);
  await expect(card.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(page.getByTestId("tasks-live-other-tasks").getByRole("status")).toHaveCount(0);
  const [reloaded] = await Promise.all([page.waitForResponse((response) => isResponse(response, "/tasks", "GET")), page.reload()]);
  expect(reloaded.status()).toBe(200);
  const persisted = (await reloaded.json()).cards.find((item: { id: string }) => item.id === result.id);
  expect(persisted).toMatchObject({ id: result.id, title, status: "todo", sourceKind: "手工创建", ownerUserId: FULLSTACK_E2E.tasksUserId, dueAt: "2026-12-31T00:00:00.000Z", riskLevel: "R2" });
  await expect(card).toBeVisible();
  const [advanced] = await Promise.all([page.waitForResponse((response) => isResponse(response, `/tasks/${result.id}/status`, "PATCH")), page.getByTestId(`tasks-live-advance-${result.id}`).click()]);
  expect(advanced.status()).toBe(200); expect(advanced.request().postDataJSON()).toEqual({ toStatus: "in_progress", reason: null });
  expect(await advanced.json()).toMatchObject({ fromStatus: "todo", toStatus: "in_progress", auditEventId: null });
  await expect(page.getByTestId(`tasks-live-advance-${result.id}`)).toHaveText("Submit for review");
  const [returned] = await Promise.all([page.waitForResponse((response) => isResponse(response, `/tasks/${result.id}/status`, "PATCH")), page.getByTestId(`tasks-live-block-${result.id}`).click()]);
  expect(returned.status()).toBe(200); expect(returned.request().postDataJSON()).toEqual({ toStatus: "todo", reason: "退回上一步" });
  const back = await returned.json(); expect(back).toMatchObject({ fromStatus: "in_progress", toStatus: "todo" });
  expect(typeof back.auditEventId).toBe("string"); expect(back.auditEventId.length).toBeGreaterThan(0);
  await expect(page.getByTestId(`tasks-live-advance-${result.id}`)).toHaveText("Start work");
  await expect(page.getByTestId("tasks-live-other-tasks").getByRole("status")).toHaveCount(0);
  const [finalRead] = await Promise.all([page.waitForResponse((response) => isResponse(response, "/tasks", "GET")), page.reload()]);
  expect((await finalRead.json()).cards.find((item: { id: string }) => item.id === result.id)).toMatchObject({ title, status: "todo", riskLevel: "R2" });
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 1000 }); await card.scrollIntoViewIfNeeded();
    await expect(card).toBeInViewport({ ratio: 1 });
    const box = await card.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    for (const control of [page.getByTestId(`tasks-live-advance-${result.id}`), page.getByTestId(`tasks-live-block-${result.id}`)]) {
      await expect(control).toBeInViewport({ ratio: 1 });
      const controlBox = await control.boundingBox(); expect(controlBox!.x).toBeGreaterThanOrEqual(box!.x); expect(controlBox!.x + controlBox!.width).toBeLessThanOrEqual(box!.x + box!.width);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`tasks-${width}-en.png`) });
  }
  const systemCopy = await page.getByTestId("tasks-live-board").evaluate((element) => { const clone = element.cloneNode(true) as HTMLElement; clone.querySelectorAll("article h3").forEach((node) => node.remove()); return clone.textContent ?? ""; });
  expect(systemCopy).not.toMatch(/\p{Script=Han}/u);
});
